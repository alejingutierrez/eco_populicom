#!/usr/bin/env bash
# Arnés de calidad de la interpretación de ECO (spec 6.4, 13.1 a 13.3): un comando, todas las compuertas.
#
#   bash scripts/qa/run-all.sh [opciones]
#
# Por defecto corre el perfil RÁPIDO con Sonnet (184 llamadas, ≈ 1.05 M tokens de entrada, unos USD 4): submuestras con semilla fija de los conjuntos de oro
# y 2 de las 6 ventanas de correo. Imprime la tabla del spec 6.4 y la tabla de umbrales 13.2 (PASA/FALLA/N/D).
#
#   --dry-run          lista los pasos y lo que costarían; NO llama a Bedrock ni a la base de datos
#   --cached           evalúa las corridas y veredictos de referencia del 2-nov (fixtures/refs): cero costo, cero llamadas
#   --full             conjuntos completos (208, 867, 397 menciones; 6 ventanas; libro de afirmaciones). ≈ 1,700 llamadas, ≈ 9.6 M tokens de entrada (USD 35-40 con Sonnet)
#   --limit N          tope de menciones por conjunto de clasificación (rápido: 60; --full: todo)
#   --only a,b         solo esos pasos:  ddec-classify ddec-week df-classify df-opus stability texts ledger kappa parents repro-check
#   --skip a,b         quita pasos de la lista por defecto
#   --opus             usa Opus (clasificación, df-opus y juez de textos) en vez de Sonnet. Más lento y ~5 veces más caro
#   --judge M          modelo del juez de textos y del libro de afirmaciones (sonnet|opus); las compuertas de textos se calibraron con Opus
#   --with-db          añade parents y repro-check (SELECT acotados a producción vía eco-migration; solo lectura)
#   --human-labels F   hoja .md o CSV rellenada por la persona (si no, la compuerta κ queda N/D)
#   --seed N           semilla de los muestreos (default 20261102)
#   --max-calls N      tope duro de llamadas a Bedrock entre todos los pasos (default 700 rápido / 6000 --full)
#   --workers N        paralelismo de las llamadas (default 5)
#   --out DIR          directorio de salida (default scripts/qa/out/run-<fecha>)
#   -h, --help
#
# Credenciales: REPO_ENV=/ruta/al/.env (o <repo>/.env, o el .env del checkout principal si estás en un worktree). No se imprimen.
# Código de salida: 1 si alguna compuerta FALLA; 0 si todas PASAN o están N/D (y siempre 0 con --dry-run).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${ECO_QA_PYTHON:-python3}"
DRY=0; CACHED=0; FULL=0; OPUS=0; WITHDB=0; LIMIT=""; ONLY=""; SKIP=""; HUMAN=""; JUDGE=""; SEED=20261102; MAXCALLS=""; WORKERS=5; OUT=""

usage() { sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1;; --cached) CACHED=1;; --full) FULL=1;; --opus) OPUS=1;; --with-db) WITHDB=1;;
    --limit) LIMIT="$2"; shift;; --only) ONLY="$2"; shift;; --skip) SKIP="$2"; shift;;
    --human-labels) HUMAN="$2"; shift;; --seed) SEED="$2"; shift;; --max-calls) MAXCALLS="$2"; shift;;
    --judge) JUDGE="$2"; shift;;
    --workers) WORKERS="$2"; shift;; --out) OUT="$2"; shift;;
    -h|--help) usage; exit 0;;
    *) echo "opción desconocida: $1 (usa --help)" >&2; exit 2;;
  esac
  shift
done

MODEL=sonnet; [ "$OPUS" = 1 ] && MODEL=opus
: "${JUDGE:=$MODEL}"
if [ "$FULL" = 1 ]; then : "${LIMIT:=}"; : "${MAXCALLS:=6000}"; else : "${LIMIT:=60}"; : "${MAXCALLS:=700}"; fi
[ -z "$OUT" ] && OUT="$HERE/out/run-$(date +%Y%m%d-%H%M%S)"
RUNS="$OUT/runs"; mkdir -p "$RUNS"
LIMARG=""; [ -n "$LIMIT" ] && LIMARG="--limit $LIMIT"

# ---------------------------------------------------------------- pasos
if [ -n "$ONLY" ]; then STEPS="$(echo "$ONLY" | tr ',' ' ')"
else
  STEPS="ddec-classify df-classify stability texts kappa"
  [ "$FULL" = 1 ] && STEPS="ddec-classify ddec-week df-classify stability texts ledger kappa"
  [ "$FULL" = 1 ] && [ "$OPUS" = 1 ] && STEPS="ddec-classify ddec-week df-classify df-opus stability texts ledger kappa"
  [ "$WITHDB" = 1 ] && STEPS="$STEPS parents repro-check"
fi
for s in $(echo "$SKIP" | tr ',' ' '); do STEPS="$(echo " $STEPS " | sed "s/ $s / /g")"; done
[ "$CACHED" = 1 ] && STEPS="eval texts kappa"
if [ "$CACHED" = 1 ] && [ -n "$ONLY" ]; then
  # --cached promete cero llamadas: solo se admiten los pasos que leen referencias (eval, texts, kappa)
  STEPS=""
  for s in $(echo "$ONLY" | tr ',' ' '); do
    case "$s" in
      eval|texts|kappa) STEPS="$STEPS $s";;
      *) echo "aviso: el paso '$s' llama a Bedrock o a la base y no corre con --cached (solo eval, texts, kappa)" >&2;;
    esac
  done
fi

if [ "$FULL" = 1 ]; then WINDOWS=""; else WINDOWS="--windows ddecpr_20261101,df_20261030"; fi
KAPPA_ARGS=""
if [ -n "$HUMAN" ]; then
  case "$HUMAN" in *.csv) KAPPA_ARGS="--csv $HUMAN";; *) KAPPA_ARGS="--sheet $HUMAN";; esac
else
  KAPPA_ARGS="--sheet $HERE/fixtures/human-review/hoja_revision_ciega.md"
fi
[ -f "$RUNS/ddec208.json" ] || true

echo "=== Arnés de calidad ECO · $(date '+%Y-%m-%d %H:%M:%S') ==="
echo "perfil: $([ "$FULL" = 1 ] && echo completo || echo rápido) · modelo: $MODEL · juez de textos: $JUDGE · límite por conjunto: ${LIMIT:-todo} · semilla: $SEED · tope de llamadas: $MAXCALLS"
[ "$CACHED" = 1 ] && echo "modo --cached: se evalúan las referencias del 2-nov; no se llama a Bedrock."
[ "$DRY" = 1 ] && echo "modo --dry-run: no se llama a Bedrock ni a la base de datos."
echo "salida: $OUT"
echo "pasos: $STEPS"
echo

FAILED=""
calls_used() {  # llamadas ya gastadas por los pasos anteriores (suma de usage.*.json)
  "$PY" - "$OUT" <<'PYEOF'
import glob, json, sys
n = 0
for p in glob.glob(sys.argv[1] + '/usage.*.json'):
    try: n += sum(json.load(open(p))['calls'].values())
    except Exception: pass
print(n)
PYEOF
}
run() {  # run <paso> <comando...>: registra fallos sin abortar y reparte el tope de llamadas
  local name="$1"; shift
  local left=$(( MAXCALLS - $(calls_used) ))
  if [ $left -lt 1 ] && [ "$DRY" != 1 ]; then  # tope duro: sin presupuesto, el paso no corre (ninguna llamada de más)
    echo "--- [$name] omitido: se agotó el tope de $MAXCALLS llamadas (--max-calls)"; echo
    FAILED="$FAILED $name(sin-presupuesto)"; return
  fi
  echo "--- [$name] $*" | sed "s#$HERE/#scripts/qa/#g"
  ECO_QA_MAX_CALLS="$left" ECO_QA_USAGE_OUT="$OUT/usage.$name.json" "$@"
  local rc=$?
  [ $rc -ne 0 ] && { echo "!!! paso $name terminó con código $rc"; FAILED="$FAILED $name"; }
  echo
}
CL="$PY $HERE/classify-lab.py"
DRYARG=""; [ "$DRY" = 1 ] && DRYARG="--dry-run"

for step in $STEPS; do
  case "$step" in
    ddec-classify) run ddec-classify $CL --set ddec208 --out "$RUNS/ddec208.json" --model $MODEL $LIMARG --seed $SEED --workers $WORKERS $DRYARG;;
    ddec-week)     run ddec-week     $CL --set ddec867 --out "$RUNS/ddec867.json" --model $MODEL $LIMARG --seed $SEED --workers $WORKERS $DRYARG;;
    df-classify)   run df-classify   $CL --set df397   --out "$RUNS/df397.json"   --model $MODEL $LIMARG --seed $SEED --workers $WORKERS $DRYARG;;
    df-opus)       run df-opus       $CL --set df162   --out "$RUNS/df162.json"   --model opus $LIMARG --seed $SEED --workers $WORKERS $DRYARG;;
    stability)
      # segunda corrida con los MISMOS ids de la primera, para medir estabilidad entre corridas
      if [ "$DRY" = 1 ]; then
        echo "--- [stability] repite ddec208 sobre los ids de la primera corrida y compara etiquetas (misma cantidad de llamadas que ddec-classify)"; echo
      elif [ ! -f "$RUNS/ddec208.json" ]; then
        echo "--- [stability] omitido: falta $RUNS/ddec208.json (corre antes ddec-classify)"; echo
      else
        "$PY" -c "import json,sys; json.dump([d['id'] for d in json.load(open(sys.argv[1])) if 'error' not in d], open(sys.argv[2],'w'))" "$RUNS/ddec208.json" "$RUNS/ddec208.ids.json"
        run stability $CL --set ddec208 --ids "$RUNS/ddec208.ids.json" --out "$RUNS/ddec208.b.json" --model $MODEL --workers $WORKERS
      fi;;
    eval) run eval "$PY" "$HERE/eval-classification.py" --cached --gates-out "$OUT/gates.classify.json" --md-out "$OUT/tabla-6.4.md";;
    texts)
      if [ "$CACHED" = 1 ]; then run texts "$PY" "$HERE/compose-judge.py" --cached --out "$OUT"
      else run texts "$PY" "$HERE/compose-judge.py" --candidates team,base --gate-on team $WINDOWS --model $JUDGE --out "$OUT" --workers 3 $DRYARG; fi;;
    ledger)  run ledger "$PY" "$HERE/compose-judge.py" --ledger --model $JUDGE $DRYARG;;
    kappa)
      if [ "$DRY" = 1 ]; then echo "--- [kappa] calcula κ entre la hoja humana (fixtures/human-review o --human-labels) y el sistema; sin costo"; echo
      else run kappa "$PY" "$HERE/human-kappa.py" $KAPPA_ARGS --gates-out "$OUT/gates.kappa.json"; fi;;
    parents)
      if [ "$DRY" = 1 ]; then echo "--- [parents] SELECT acotados a producción (comentarios 7 días + posts 120 días) para medir resolución de padres; requiere --with-db y credenciales"; echo
      else run parents "$PY" "$HERE/parents.py" --gates-out "$OUT/gates.parents.json"; fi;;
    repro-check)
      if [ "$DRY" = 1 ]; then echo "--- [repro-check] corre repro.ts (solo lectura) para una ventana y compara con el fixture; requiere --with-db y tsx"; echo
      else run repro-check "$PY" "$HERE/repro-check.py"; fi;;
    *) echo "paso desconocido: $step" >&2; FAILED="$FAILED $step";;
  esac
  # tras el último paso de clasificación se evalúa (una sola vez, después de stability si está en la lista)
done

if [ "$DRY" = 0 ] && [ "$CACHED" = 0 ]; then
  case " $STEPS " in
    *" ddec-classify "*|*" ddec-week "*|*" df-classify "*|*" df-opus "*|*" stability "*)
      run eval "$PY" "$HERE/eval-classification.py" --runs "$RUNS" --gates-out "$OUT/gates.classify.json" --md-out "$OUT/tabla-6.4.md";;
  esac
fi

echo "=================================================================="
if [ "$DRY" = 1 ]; then
  echo "Dry-run terminado: ningún paso llamó a Bedrock ni a la base."
  exit 0
fi
"$PY" - "$OUT" <<'PYEOF'
import glob, json, sys
calls, toks = {}, {}
for p in glob.glob(sys.argv[1] + '/usage.*.json'):
    u = json.load(open(p))
    for m, n in u['calls'].items(): calls[m] = calls.get(m, 0) + n
    for m, (i, o) in u['tokens'].items():
        t = toks.setdefault(m, [0, 0]); t[0] += i; t[1] += o
if calls:
    print('Costo de la corrida (Bedrock): ' + ' | '.join(f"{m.split('.')[-1]}: {n} llamadas, {toks[m][0]:,} tokens de entrada, {toks[m][1]:,} de salida" for m, n in sorted(calls.items())))
else:
    print('Costo de la corrida (Bedrock): 0 llamadas.')
PYEOF
echo
"$PY" "$HERE/lib/qa_gates.py" summary --out "$OUT"
RC=$?
[ -n "$FAILED" ] && { echo "Pasos con error:$FAILED"; RC=1; }
echo "Detalle en $OUT (tabla-6.4.md, gates.*.json, runs/, verdicts/)"
exit $RC
