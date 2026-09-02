#!/usr/bin/env bash
# Driver del backfill de mentions.full_text.
#
# Invoca eco-article-fetch en tandas hasta que no queden pendientes. El lambda
# tiene concurrencia reservada 1, así que las invocaciones se serializan solas;
# este loop solo decide cuándo parar y deja rastro del progreso.
#
# gapMs 1800: con 1200 la tanda de 500 generó 41 HTTP 429 (8%). Los 429 son
# reintentables (mode=retry los recoge), pero es mejor no provocarlos.
set -uo pipefail

LIMIT=${LIMIT:-3000}
CONC=${CONC:-20}
GAP=${GAP:-1800}
LOG=${LOG:-/tmp/backfill-fulltext.log}
MODE=${MODE:-pending}

echo "=== backfill full_text · $(date '+%H:%M:%S') · limit=$LIMIT conc=$CONC gap=${GAP}ms mode=$MODE" | tee -a "$LOG"

ronda=0
total_ok=0
while :; do
  ronda=$((ronda + 1))
  out=$(mktemp)
  # --cli-read-timeout 0 es OBLIGATORIO: el AWS CLI corta la lectura a los 60 s
  # por defecto y una tanda de 3,000 URLs tarda ~6 min. Sin esto el CLI
  # abandona, el driver lo lee como error y reintenta mientras la invocación
  # anterior SIGUE corriendo en el servidor — con concurrencia reservada 1 el
  # reintento se estrangula y el log miente sobre el progreso.
  aws lambda invoke --function-name eco-article-fetch \
    --payload "{\"mode\":\"$MODE\",\"limit\":$LIMIT,\"concurrency\":$CONC,\"gapMs\":$GAP}" \
    --cli-binary-format raw-in-base64-out \
    --cli-read-timeout 0 --cli-connect-timeout 60 \
    "$out" 2>/tmp/backfill-invoke.err >/dev/null

  read -r sel ok secs corte <<<"$(python3 - "$out" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("ERR 0 0 json-invalido"); raise SystemExit
if 'errorMessage' in d:
    print(f"ERR 0 0 {d['errorMessage'][:60].replace(' ','_')}")
else:
    print(d.get('seleccionadas', 0), d.get('guardadas', 0),
          d.get('segundos', 0), d.get('cortadoPorTiempo', False))
PY
)"
  rm -f "$out"

  if [ "$sel" = "ERR" ]; then
    echo "ronda $ronda: ERROR del lambda ($corte) — reintentando en 30s" | tee -a "$LOG"
    sleep 30
    continue
  fi

  total_ok=$((total_ok + ok))
  echo "ronda $(printf '%2d' "$ronda"): sel=$sel ok=$ok  ${secs}s  corte=$corte  acumulado=$total_ok  $(date '+%H:%M:%S')" | tee -a "$LOG"

  # Sin filas seleccionadas = no queda nada pendiente.
  [ "$sel" -eq 0 ] && break
  # Guarda de seguridad contra un loop infinito si algo deja de avanzar.
  [ "$ronda" -ge 60 ] && { echo "PARADA: 60 rondas, revisar" | tee -a "$LOG"; break; }
done

echo "=== fin · $(date '+%H:%M:%S') · guardadas en total: $total_ok" | tee -a "$LOG"
