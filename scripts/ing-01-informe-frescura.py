#!/usr/bin/env python3
"""Informe de cierre de ING-01 (WP-6): sondeo y avisos 429 por día.

Lee el namespace `ECO/Ingesta` de CloudWatch (las métricas que `eco-ingestion`
publica al cierre de cada corrida) y responde, por día UTC:

  1. ¿alguna query activa pasó más de 1 hora sin un sondeo completado?
     (`MinutosSinSondeoMax` > 60, o un hueco de más de 60 min sin corridas)
  2. ¿cuántos avisos 429 hubo? (criterio: menos de 10 al día)

Solo lee CloudWatch: no llama a Brandwatch ni toca la base.

Uso (credenciales de AWS en el entorno, como en CLAUDE.md):

    set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
    python3 scripts/ing-01-informe-frescura.py                 # 13 a 20-nov-2026
    python3 scripts/ing-01-informe-frescura.py --desde 2026-11-14 --hasta 2026-11-20

Sale con código 0 si todos los días de la ventana están cerrados y cumplen,
1 si algún día no cumple, 2 si todavía faltan días por cerrar.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

NAMESPACE = "ECO/Ingesta"
ALARMAS = ["eco-ingesta-callada", "eco-ingesta-query-desatendida", "eco-ingesta-429-dia"]
PASO_S = 300  # el cron corre cada 5 min
LIMITE_SIN_SONDEO_MIN = 60
LIMITE_429_DIA = 10

# (id, métrica, estadístico)
SERIES = [
    ("corridas", "QueriesSondeadas", "SampleCount"),
    ("sondeadas", "QueriesSondeadas", "Sum"),
    ("fallidas", "QueriesFallidas", "Sum"),
    ("abortadas", "CorridaAbortada", "Sum"),
    ("avisos429", "Avisos429", "Sum"),
    ("peticiones", "Peticiones", "Sum"),
    ("sin_sondeo", "MinutosSinSondeoMax", "Maximum"),
    ("cuota", "CuotaUsadaMax", "Maximum"),
]


def aws(*args: str) -> dict:
    out = subprocess.run(
        ["aws", *args, "--output", "json"], check=True, capture_output=True, text=True
    ).stdout
    return json.loads(out) if out.strip() else {}


def leer_series(inicio: datetime, fin: datetime) -> dict[str, dict[datetime, float]]:
    """Cada serie como {inicio del periodo de 5 min (UTC): valor}."""
    consultas = [
        {
            "Id": sid,
            "MetricStat": {
                "Metric": {"Namespace": NAMESPACE, "MetricName": metrica},
                "Period": PASO_S,
                "Stat": stat,
            },
        }
        for sid, metrica, stat in SERIES
    ]
    series: dict[str, dict[datetime, float]] = {sid: {} for sid, _, _ in SERIES}
    token = None
    while True:
        args = [
            "cloudwatch", "get-metric-data",
            "--start-time", inicio.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "--end-time", fin.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "--metric-data-queries", json.dumps(consultas),
        ]
        if token:
            args += ["--next-token", token]
        res = aws(*args)
        for r in res.get("MetricDataResults", []):
            for ts, valor in zip(r["Timestamps"], r["Values"]):
                series[r["Id"]][datetime.fromisoformat(ts).astimezone(timezone.utc)] = valor
        token = res.get("NextToken")
        if not token:
            return series


def resumen_dia(dia: date, series: dict[str, dict[datetime, float]], ahora: datetime) -> dict:
    ini = datetime(dia.year, dia.month, dia.day, tzinfo=timezone.utc)
    fin = ini + timedelta(days=1)
    corte = min(fin, ahora)

    def del_dia(sid: str) -> dict[datetime, float]:
        return {t: v for t, v in series[sid].items() if ini <= t < fin}

    corridas = del_dia("corridas")
    r: dict = {"dia": dia, "cerrado": ahora >= fin, "con_datos": bool(corridas)}
    if not corridas:
        return r

    r["corridas"] = int(sum(corridas.values()))
    for sid in ("sondeadas", "fallidas", "abortadas", "avisos429", "peticiones"):
        r[sid] = int(sum(del_dia(sid).values()))
    for sid in ("sin_sondeo", "cuota"):
        valores = del_dia(sid).values()
        r[sid] = max(valores) if valores else None

    # Hueco más largo sin ninguna corrida dentro del día (hasta ahora si el día
    # sigue abierto). Un día sin la métrica al principio (el 13-nov empezó a
    # publicarse a las 18:36 UTC) se marca como parcial, no como hueco.
    marcas = sorted(corridas)
    r["primera"] = marcas[0]
    r["parcial_desde"] = marcas[0] if marcas[0] - ini > timedelta(minutes=15) else None
    hueco = timedelta(0)
    for a, b in zip(marcas, marcas[1:] + [corte]):
        hueco = max(hueco, b - a)
    r["hueco_min"] = round(hueco.total_seconds() / 60)

    r["cumple_sondeo"] = (r["sin_sondeo"] or 0) <= LIMITE_SIN_SONDEO_MIN and r[
        "hueco_min"
    ] <= LIMITE_SIN_SONDEO_MIN
    r["cumple_429"] = r["avisos429"] < LIMITE_429_DIA
    return r


def estado(r: dict) -> str:
    if not r["con_datos"]:
        return "sin datos" if r["cerrado"] else "falta"
    if not (r["cumple_sondeo"] and r["cumple_429"]):
        return "NO CUMPLE"
    if not r["cerrado"]:
        return "en curso (cumple hasta ahora)"
    if r["parcial_desde"]:
        return f"cumple (parcial: métrica desde {r['parcial_desde']:%H:%M} UTC)"
    return "cumple"


def fmt(v) -> str:
    if v is None:
        return "n/d"
    return f"{v:g}" if isinstance(v, float) else str(v)


def alarmas_en_ventana(inicio: datetime, fin: datetime) -> list[str]:
    lineas = []
    estados = {
        a["AlarmName"]: a["StateValue"]
        for a in aws("cloudwatch", "describe-alarms", "--alarm-names", *ALARMAS).get(
            "MetricAlarms", []
        )
    }
    for nombre in ALARMAS:
        hist = aws(
            "cloudwatch", "describe-alarm-history",
            "--alarm-name", nombre,
            "--history-item-type", "StateUpdate",
            "--start-date", inicio.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "--end-date", fin.strftime("%Y-%m-%dT%H:%M:%SZ"),
        ).get("AlarmHistoryItems", [])
        saltos = sorted(
            datetime.fromisoformat(h["Timestamp"]).astimezone(timezone.utc)
            for h in hist
            if h["HistorySummary"].endswith("to ALARM")
        )
        cuando = ", ".join(f"{t:%d-%b %H:%M}" for t in saltos) or "ninguna"
        lineas.append(
            f"| `{nombre}` | {estados.get(nombre, 'NO EXISTE')} | {len(saltos)} | {cuando} |"
        )
    return lineas


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--desde", default="2026-11-13", help="primer día UTC (AAAA-MM-DD)")
    p.add_argument("--hasta", default="2026-11-20", help="último día UTC, incluido")
    p.add_argument("--ahora", help="solo para pruebas: instante ISO que hace de «ahora»")
    a = p.parse_args()

    desde, hasta = date.fromisoformat(a.desde), date.fromisoformat(a.hasta)
    ahora = (
        datetime.fromisoformat(a.ahora).astimezone(timezone.utc)
        if a.ahora
        else datetime.now(timezone.utc)
    )
    inicio = datetime(desde.year, desde.month, desde.day, tzinfo=timezone.utc)
    fin = datetime(hasta.year, hasta.month, hasta.day, tzinfo=timezone.utc) + timedelta(days=1)
    dias = [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)]

    series = leer_series(inicio, min(fin, ahora)) if ahora > inicio else {s[0]: {} for s in SERIES}
    filas = [resumen_dia(d, series, ahora) for d in dias]

    print(f"## ING-01 · sondeo y avisos 429, {desde:%d-%b} a {hasta:%d-%b-%Y} (UTC)")
    print(f"\nLeído de CloudWatch `{NAMESPACE}` el {ahora:%d-%b-%Y %H:%M} UTC.\n")
    print("| Día | Corridas | Queries sondeadas | Fallidas | Corridas abortadas | Avisos 429 "
          "| Máx. min sin sondeo | Hueco máx. entre corridas (min) | Cuota vista máx. | Peticiones | Estado |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in filas:
        if not r["con_datos"]:
            print(f"| {r['dia']:%d-%b} | | | | | | | | | | {estado(r)} |")
            continue
        print(
            f"| {r['dia']:%d-%b} | {r['corridas']} | {r['sondeadas']} | {r['fallidas']} "
            f"| {r['abortadas']} | {r['avisos429']} | {fmt(r['sin_sondeo'])} | {r['hueco_min']} "
            f"| {fmt(r['cuota'])} | {r['peticiones']} | {estado(r)} |"
        )

    cerrados = [r for r in filas if r["cerrado"] and r["con_datos"]]
    completos = [r for r in cerrados if not r["parcial_desde"]]
    fallan = [r for r in filas if r["con_datos"] and not (r["cumple_sondeo"] and r["cumple_429"])]
    faltan = [r["dia"] for r in filas if not r["cerrado"]]

    print("\n**Lectura.**")
    print(f"- Días cerrados con dato: {len(cerrados)} de {len(dias)} "
          f"({len(completos)} completos, {len(cerrados) - len(completos)} parciales).")
    if cerrados:
        peor = max(cerrados, key=lambda r: max(r["sin_sondeo"] or 0, r["hueco_min"]))
        print(f"- Más de 1 hora sin sondeo: "
              f"{'NO' if all(r['cumple_sondeo'] for r in cerrados) else 'SÍ'}. Peor día "
              f"{peor['dia']:%d-%b}: {fmt(peor['sin_sondeo'])} min sin sondeo, "
              f"hueco de {peor['hueco_min']} min entre corridas.")
        print(f"- Avisos 429: {sum(r['avisos429'] for r in cerrados)} en total; "
              f"máximo en un día {max(r['avisos429'] for r in cerrados)} (límite: menos de {LIMITE_429_DIA}).")
    if fallan:
        print("- **No cumplen:** " + ", ".join(f"{r['dia']:%d-%b}" for r in fallan) + ".")
    if faltan:
        print("- **Faltan por cerrar:** " + ", ".join(f"{d:%d-%b}" for d in faltan) + ".")

    print("\n| Alarma | Estado ahora | Veces en ALARM en la ventana | Cuándo (UTC) |")
    print("|---|---|---|---|")
    for linea in alarmas_en_ventana(inicio, min(fin, ahora)):
        print(linea)

    if fallan:
        return 1
    return 2 if faltan else 0


if __name__ == "__main__":
    sys.exit(main())
