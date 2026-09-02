#!/usr/bin/env bash
# Vigilancia del backfill de full_text. Cada línea de stdout es un evento.
#
# Emite: progreso cada ~10 min · ESTANCADO si el contador no se mueve en 3
# sondeos · COMPLETO (y sale) cuando no quedan pendientes · LECTURA FALLIDA si
# no puede medir. El silencio no es éxito: sin el detector de estancamiento y
# el de lectura, un driver muerto se ve igual que "sigue trabajando".
#
# La primera versión de este script se rompió en silencio: el payload inline
# con comillas anidadas devolvía vacío, `read` desde un `$(...)` no propaga el
# fallo del subshell, y las comparaciones cascaban con "integer expression
# expected" sin que nadie mirara stderr. De ahí el archivo de payload y la
# validación numérica explícita.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD="$DIR/watch-backfill.payload.json"
TOTAL=${TOTAL:-52363}
POLL=${POLL:-120}
ANUNCIA_CADA=${ANUNCIA_CADA:-5}

leer() {
  # rm -f ANTES: un invoke fallido deja el archivo de la corrida anterior y se
  # leería un número viejo como si fuera fresco.
  rm -f /tmp/watch-bf.json
  aws lambda invoke --function-name eco-migration \
    --payload "file://$PAYLOAD" --cli-binary-format raw-in-base64-out \
    --cli-read-timeout 0 \
    /tmp/watch-bf.json >/dev/null 2>&1 || return 1
  python3 -c "
import json,sys
d = json.load(open('/tmp/watch-bf.json'))
if 'errorMessage' in d: sys.exit(1)
r = json.loads(d['body'])['rows'][0]
print(r['hechas'], r['ok'])" 2>/dev/null
}

es_num() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

ultimo=-1     # conteo del sondeo anterior — detecta estancamiento
ancla=-1      # conteo del último anuncio — calcula el ritmo
quietas=0; i=0; fallos=0
echo "vigilando el backfill · $TOTAL candidatas · sondeo cada ${POLL}s"

while :; do
  i=$((i + 1))
  salida="$(leer)"
  hechas="${salida%% *}"; ok="${salida##* }"

  if ! es_num "$hechas" || ! es_num "$ok"; then
    fallos=$((fallos + 1))
    [ "$fallos" -ge 3 ] && { echo "LECTURA FALLIDA 3 veces seguidas — no puedo medir el backfill"; fallos=0; }
    sleep "$POLL"; continue
  fi
  fallos=0

  pend=$((TOTAL - hechas))
  pct=$((100 * hechas / TOTAL))

  if [ "$pend" -le 0 ]; then
    echo "COMPLETO · $hechas/$TOTAL intentadas · $ok con texto ($((100 * ok / hechas))%)"
    exit 0
  fi

  # Estancamiento: se evalúa en cada sondeo, independiente de los anuncios.
  if [ "$hechas" -eq "$ultimo" ]; then
    quietas=$((quietas + 1))
    if [ "$quietas" -ge 3 ]; then
      echo "ESTANCADO · $hechas/$TOTAL ($pct%) sin moverse en $((quietas * POLL / 60)) min — revisar driver y lambda"
      quietas=0
    fi
  else
    quietas=0
  fi
  ultimo=$hechas

  # Anuncio de progreso con el ritmo del tramo desde el anuncio anterior.
  if [ $((i % ANUNCIA_CADA)) -eq 0 ]; then
    if [ "$ancla" -ge 0 ]; then
      read -r rate eta <<<"$(python3 -c "
r = ($hechas - $ancla) / ($POLL * $ANUNCIA_CADA)
print(f'{r:.1f}', int($pend / max(r, 0.01) / 60))" 2>/dev/null || echo "? ?")"
      echo "backfill $pct% · $hechas/$TOTAL intentadas · $ok con texto · ${rate} URL/s · quedan ~${eta} min"
    else
      echo "backfill $pct% · $hechas/$TOTAL intentadas · $ok con texto"
    fi
    ancla=$hechas
  fi

  sleep "$POLL"
done
