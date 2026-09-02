#!/usr/bin/env bash
# Vigilancia del backfill de full_text. Cada línea de stdout es un evento.
#
# Emite:
#   - una línea de progreso cada ~10 min,
#   - ESTANCADO si el contador no se mueve en 3 sondeos seguidos (~6 min),
#     que es cómo se ven tanto un driver muerto como un lambda en fallo,
#   - COMPLETO y sale cuando no quedan pendientes.
#
# El silencio no es éxito: sin el detector de estancamiento, un crash del
# driver se vería igual que "sigue trabajando".
set -uo pipefail

TOTAL=52363
POLL=${POLL:-120}
ANUNCIA_CADA=${ANUNCIA_CADA:-5}   # sondeos entre líneas de progreso

leer() {
  # rm -f ANTES: un invoke fallido deja el archivo anterior y se leería un
  # número viejo como si fuera fresco.
  rm -f /tmp/watch-bf.json
  aws lambda invoke --function-name eco-migration \
    --payload '{"action":"custom-query","query":"SELECT * FROM (SELECT count(full_text_fetched_at)::int AS hechas, count(full_text)::int AS ok FROM mentions WHERE page_type = '"'"'news'"'"' AND is_duplicate = false AND url IS NOT NULL AND url <> '"'"''"'"') z"}' \
    --cli-binary-format raw-in-base64-out --cli-read-timeout 0 /tmp/watch-bf.json >/dev/null 2>&1 || return 1
  python3 -c "
import json
r = json.loads(json.load(open('/tmp/watch-bf.json'))['body'])['rows'][0]
print(r['hechas'], r['ok'])" 2>/dev/null || return 1
}

prev=-1
quietas=0
i=0
fallos_lectura=0

while :; do
  i=$((i + 1))
  if ! read -r hechas ok <<<"$(leer)"; then
    fallos_lectura=$((fallos_lectura + 1))
    # Un fallo aislado de la API no es noticia; tres seguidos sí.
    [ "$fallos_lectura" -ge 3 ] && { echo "LECTURA FALLIDA 3 veces seguidas — no puedo medir el backfill"; fallos_lectura=0; }
    sleep "$POLL"; continue
  fi
  fallos_lectura=0
  pend=$((TOTAL - hechas))
  pct=$((100 * hechas / TOTAL))

  if [ "$pend" -le 0 ]; then
    echo "COMPLETO: $hechas/$TOTAL intentadas · $ok con texto ($((100 * ok / hechas))%)"
    exit 0
  fi

  if [ "$hechas" -eq "$prev" ]; then
    quietas=$((quietas + 1))
    if [ "$quietas" -ge 3 ]; then
      echo "ESTANCADO: $hechas/$TOTAL ($pct%) sin moverse en $((quietas * POLL / 60)) min — revisar driver y lambda"
      quietas=0
    fi
  else
    quietas=0
    # ETA con el ritmo del último tramo medido.
    if [ "$prev" -gt 0 ]; then
      delta=$((hechas - prev))
      rate=$(python3 -c "print(f'{$delta/$POLL:.1f}')")
      eta=$(python3 -c "print(int($pend/max($delta/$POLL,0.01)/60))")
      [ $((i % ANUNCIA_CADA)) -eq 0 ] && echo "backfill $pct% · $hechas/$TOTAL intentadas · $ok con texto · ${rate} URL/s · quedan ~${eta} min"
    fi
  fi
  prev=$hechas
  sleep "$POLL"
done
