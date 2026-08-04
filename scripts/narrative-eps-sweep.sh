#!/usr/bin/env bash
#
# Barrido diagnóstico de eps/minPts para la detección de narrativas (WS-N3).
#
# CORRER ESTO ANTES DE TOCAR PRODUCCIÓN. Es de SOLO LECTURA: usa la acción
# `custom-query` del lambda `eco-migration`, que sólo acepta SELECT.
#
# Por qué existe: el `eps` de DBSCAN se cambió a mano el 30 de junio (0.22 → 0.19)
# sin forma de validarlo, porque `dryRun` no sirve para probar clustering — los
# pasos 3-5 del lambda están detrás de `if (!event.dryRun)`. Este script mide la
# distribución de distancias ANTES de decidir, en vez de adivinar.
#
# Lo que hay que buscar en la salida:
#   · La k-distancia p25 es el candidato natural para eps (es lo que hace
#     autoEps() en cada corrida).
#   · Si p05→p10→p25 crecen a ritmo parecido y luego se aplana, NO HAY RODILLA:
#     el corpus no tiene una brecha de densidad natural y cualquier eps global es
#     una decisión de política. Eso es exactamente lo que se midió en julio
#     (pendientes 0.86 / 0.90 / 0.456 sobre la ventana de la crisis Domenech).
#   · `core_points` a cada eps: con minPts=7, un eps que deje 0 core points no
#     puede parir ninguna narrativa, por definición.
#
# Uso:
#   scripts/narrative-eps-sweep.sh ddecpr 21
#   scripts/narrative-eps-sweep.sh gobernadora 3     # ventana corta, evento agudo

set -euo pipefail

AGENCY="${1:-ddecpr}"
WINDOW_DAYS="${2:-21}"
OUT="${TMPDIR:-/tmp}/eps-sweep-${AGENCY}-${WINDOW_DAYS}d.json"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "Falta el entorno de AWS. Cárgalo así (en UNA línea, sin imprimirlo):" >&2
  echo "  set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a" >&2
  exit 1
fi

run_query() {
  local label="$1" sql="$2"
  echo "── ${label}"
  aws lambda invoke \
    --function-name eco-migration \
    --payload "$(python3 - "$sql" <<'PY'
import json, sys
print(json.dumps({"action": "custom-query", "query": sys.argv[1]}))
PY
)" \
    --cli-binary-format raw-in-base64-out "$OUT" >/dev/null
  python3 - "$OUT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
body = d.get("body")
try:
    body = json.loads(body) if isinstance(body, str) else body
except Exception:
    pass
rows = (body or {}).get("rows", body)
if isinstance(rows, list):
    for r in rows:
        print("   ", json.dumps(r, ensure_ascii=False))
else:
    print("   ", json.dumps(body, ensure_ascii=False)[:600])
PY
  echo
}

echo "Barrido de eps · agencia=${AGENCY} · ventana=${WINDOW_DAYS} días"
echo "SOLO LECTURA (custom-query acepta únicamente SELECT)"
echo

# 1) ¿Cuántos candidatos hay en la ventana, y qué antigüedad tienen?
#    Este es el diagnóstico que reveló la causa dominante: el 81.7% del pool eran
#    publicaciones de 2025 y sólo el 0.57% de los últimos 7 días.
run_query "Composición del pool" "
SELECT COUNT(*) AS total_pool,
       COUNT(*) FILTER (WHERE m.published_at >= NOW() - INTERVAL '${WINDOW_DAYS} days') AS en_ventana,
       COUNT(*) FILTER (WHERE m.published_at >= NOW() - INTERVAL '7 days') AS ultimos_7d,
       COUNT(*) FILTER (WHERE m.published_at < NOW() - INTERVAL '180 days') AS mas_de_180d,
       ROUND(100.0 * COUNT(*) FILTER (WHERE m.published_at < NOW() - INTERVAL '180 days') / GREATEST(COUNT(*),1), 1) AS pct_viejo
  FROM narrative_candidates nc
  JOIN mentions m ON m.id = nc.mention_id
  JOIN agencies a ON a.id = nc.agency_id
 WHERE a.slug = '${AGENCY}'"

# 2) Distribución de la k-distancia (k = minPts - 1 = 6) DENTRO de la ventana.
#    pgvector calcula la distancia; el percentil sale de percentile_cont.
run_query "k-distancia (k=6) en la ventana — buscar si hay rodilla" "
WITH pool AS (
  SELECT nc.mention_id AS id, nc.embedding::vector AS v
    FROM narrative_candidates nc
    JOIN mentions m ON m.id = nc.mention_id
    JOIN agencies a ON a.id = nc.agency_id
   WHERE a.slug = '${AGENCY}'
     AND m.published_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
   LIMIT 1200
),
knn AS (
  SELECT p.id,
         (SELECT (q.v <=> p.v) FROM pool q WHERE q.id <> p.id
           ORDER BY q.v <=> p.v OFFSET 5 LIMIT 1) AS kdist
    FROM pool p
)
SELECT COUNT(*) AS puntos,
       ROUND(percentile_cont(0.05) WITHIN GROUP (ORDER BY kdist)::numeric, 4) AS p05,
       ROUND(percentile_cont(0.10) WITHIN GROUP (ORDER BY kdist)::numeric, 4) AS p10,
       ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY kdist)::numeric, 4) AS p25,
       ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY kdist)::numeric, 4) AS p50,
       ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY kdist)::numeric, 4) AS p75
  FROM knn WHERE kdist IS NOT NULL"

# 3) Core points a cada eps. Un eps con 0 core points no puede parir narrativas.
for EPS in 0.19 0.22 0.26 0.30 0.34 0.38; do
  run_query "Core points a eps=${EPS} (minPts=7)" "
WITH pool AS (
  SELECT nc.mention_id AS id, nc.embedding::vector AS v
    FROM narrative_candidates nc
    JOIN mentions m ON m.id = nc.mention_id
    JOIN agencies a ON a.id = nc.agency_id
   WHERE a.slug = '${AGENCY}'
     AND m.published_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
   LIMIT 1200
)
SELECT COUNT(*) AS core_points
  FROM (
    SELECT p.id, (SELECT COUNT(*) FROM pool q WHERE q.id <> p.id AND (q.v <=> p.v) <= ${EPS}) AS vecinos
      FROM pool p
  ) t
 WHERE vecinos >= 6"
done

echo "Criterios de aceptación antes de cambiar producción:"
echo "  · ≥3 clusters de ≥7 menciones en la ventana, y verificarlos a mano leyendo"
echo "    sus 5 menciones representativas: si no cuentan la misma historia, el eps"
echo "    está demasiado alto."
echo "  · El eps elegido debe caer entre p10 y p50 de la k-distancia."
echo "  · Y correr el lambda con {\"dryRun\":false,\"agencySlug\":\"${AGENCY}\"} en una"
echo "    ventana corta ANTES de dejarlo en el cron."
