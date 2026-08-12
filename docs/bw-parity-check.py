#!/usr/bin/env python3
"""
QA paridad DB ↔ BrandWatch para DDECPR.

Compara conteos de menciones por día entre lo que tiene nuestra DB y lo que
BrandWatch reporta a través de su API. La idea es detectar:

- Pérdida silenciosa: BW tiene N pero nosotros M < N → ETL dropea.
- Pérdida por fechas: total cuadra pero los días no se alinean → bug TZ.
- Inflación: nosotros M > N → duplicados o ingest con fecha equivocada.

Ejecutar desde el monorepo con AWS creds + BW token cargados:

    set -a && source .env && set +a
    BW_TOKEN=$(aws secretsmanager get-secret-value \
        --secret-id eco/brandwatch-token --query SecretString --output text)
    BW_TOKEN=$BW_TOKEN python3 docs/bw-parity-check.py
"""
import json
import os
import subprocess
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BW_TOKEN = os.environ["BW_TOKEN"]
PROJECT_ID = 1998405210  # DDECPR
QUERY_IDS = [2003921640, 2003930254, 2003930261, 2003930255]
AGENCY_SLUG = "ddecpr"

# Días representativos del backtest. Dejamos 4 para que la corrida quepa
# en una sola ventana de cuota BW (30 req / 10 min). 4 días × 4 queries = 16.
SAMPLE_DAYS = [
    "2026-04-14",  # crisis Proyecto 1183
    "2026-01-13",  # día súper positivo (caso opuesto)
    "2026-03-22",  # random mid-period
    "2026-05-06",  # último del backtest
]


def bw_count(query_id: int, start: str, end: str) -> int:
    """BW /count endpoint. start/end son fecha+hora UTC ISO 8601.
    Backoff agresivo para esperar a través de ventanas de cuota (10 min)."""
    params = urlencode({"queryId": str(query_id), "startDate": start, "endDate": end})
    url = f"https://api.brandwatch.com/projects/{PROJECT_ID}/data/mentions/count?{params}"
    delays = [5, 15, 30, 60, 120, 240, 240, 240]  # acumulado ~15min
    for attempt, delay in enumerate(delays + [0]):
        req = Request(url, headers={"Authorization": f"Bearer {BW_TOKEN}"})
        try:
            with urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
                return int(data.get("mentionsCount", 0))
        except Exception as e:
            is_429 = "429" in str(e)
            if attempt >= len(delays):
                raise
            wait = delay if is_429 else 5
            print(f"    retry {attempt+1}/{len(delays)} ({'rate' if is_429 else 'err'}) in {wait}s — {str(e)[:60]}")
            time.sleep(wait)
    return 0


def bw_count_day(date: str) -> int:
    """Suma de conteos para un día AST (Puerto Rico). El día AST 2026-04-14
    abarca 2026-04-14T04:00:00Z hasta 2026-04-15T04:00:00Z."""
    start = f"{date}T04:00:00"
    # day+1 a las 04:00 UTC = fin del día AST
    y, m, d = date.split("-")
    next_day = (int(d) + 1)
    # Naive +1 day; for simplicity, BW accepts month-overflow so we wrap
    if next_day > 31:
        # punt: just send the next month start. None of our sample days are 31st.
        next_day = 1
        m = str(int(m) + 1).zfill(2)
    end = f"{y}-{m}-{str(next_day).zfill(2)}T04:00:00"
    total = 0
    for qid in QUERY_IDS:
        total += bw_count(qid, start, end)
        time.sleep(0.5)  # cuota 30/10min, aspiramos a no acercar el límite
    return total


def db_count_day(date: str) -> dict:
    """Conteos de la DB usando la lambda eco-migration custom-query.
    Devuelve total + breakdown por sentimiento."""
    sql = (
        "SELECT COUNT(*)::int AS total, "
        "COUNT(*) FILTER (WHERE nlp_sentiment = 'positivo')::int AS pos, "
        "COUNT(*) FILTER (WHERE nlp_sentiment = 'neutral')::int AS neu, "
        "COUNT(*) FILTER (WHERE nlp_sentiment = 'negativo')::int AS neg "
        "FROM mentions m JOIN agencies a ON a.id = m.agency_id "
        f"WHERE a.slug = '{AGENCY_SLUG}' "
        f"AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = '{date}'::date"
    )
    payload = json.dumps({"action": "custom-query", "query": sql})
    out = subprocess.check_output([
        "aws", "lambda", "invoke",
        "--function-name", "eco-migration",
        "--payload", payload,
        "--cli-binary-format", "raw-in-base64-out",
        "/tmp/db-parity.json",
    ], stderr=subprocess.DEVNULL)
    body = json.loads(json.load(open("/tmp/db-parity.json"))["body"])
    row = body["rows"][0]
    return {"total": row["total"], "pos": row["pos"], "neu": row["neu"], "neg": row["neg"]}


def main():
    print(f"\nQA paridad DDECPR · DB ↔ BrandWatch · {len(SAMPLE_DAYS)} días sample\n")
    print(f"  {'fecha':<12} {'BW':>8} {'DB':>8} {'Δ':>8} {'Δ%':>7}   pos/neu/neg")
    print("  " + "-" * 70)
    rows = []
    for day in SAMPLE_DAYS:
        try:
            bw = bw_count_day(day)
        except Exception as e:
            print(f"  {day}  ERROR BW: {e}")
            continue
        db = db_count_day(day)
        diff = db["total"] - bw
        pct = (diff / bw * 100) if bw > 0 else 0
        rows.append({"day": day, "bw": bw, "db": db["total"], "diff": diff, "pct": pct,
                     "pos": db["pos"], "neu": db["neu"], "neg": db["neg"]})
        print(f"  {day:<12} {bw:>8} {db['total']:>8} {diff:>+8} {pct:>+6.1f}%   {db['pos']:>3}/{db['neu']:>3}/{db['neg']:>3}")
    # Resumen
    if rows:
        bw_total = sum(r["bw"] for r in rows)
        db_total = sum(r["db"] for r in rows)
        print("  " + "-" * 70)
        diff_t = db_total - bw_total
        pct_t = (diff_t / bw_total * 100) if bw_total > 0 else 0
        print(f"  {'TOTAL':<12} {bw_total:>8} {db_total:>8} {diff_t:>+8} {pct_t:>+6.1f}%")
        print()
        veredict = "✓ PARIDAD" if abs(pct_t) <= 2 else ("⚠ DESVIO ALTO" if abs(pct_t) <= 10 else "✗ ROTURA SISTEMÁTICA")
        print(f"  Veredict (umbral ±2%): {veredict}")
        # Guarda JSON para la presentación
        out = "/tmp/bw-parity-result.json"
        json.dump(rows, open(out, "w"), indent=2)
        print(f"  Datos guardados en {out}")


if __name__ == "__main__":
    main()
