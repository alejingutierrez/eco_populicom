# Migración 0013: acciones de `eco-migration` (interpretación v1, WP-1)

> Cómo aplicar `packages/database/src/migrations/0013_interpretacion_v1.sql` en
> producción. **Estado: preparado, NO ejecutado.** Lo aplica el orquestador
> (plan, sección 7, paso 1), nunca un subagente. Spec: secciones 5.1, 5.2 y
> 12.1 de `docs/tecnica/spec-interpretacion-eco-v1.md` (todavía sin commit en
> `main` cuando se escribió este documento).

## 1. Qué hay que saber antes de tocar nada

1. **La migración va ANTES de cualquier despliegue de código con el schema
   nuevo, y eso incluye mergear el PR de WP-1.** Drizzle lista todas las
   columnas del schema en cada `INSERT` y en cada `select()` sin columnas
   (`db.select().from(reportConfigs)` en `api/reports/config`, los `INSERT` en
   `report_send_log`). El merge a `main` dispara `deploy.yml` (ECR, ECS) y la
   web nueva fallaría contra una base sin las columnas. Orden: (a) aplicar las
   8 acciones, (b) verificar con `interp-v1-status`, (c) recién entonces mergear.
   Los lambdas no se despliegan solos: el orquestador los despliega después.
2. **`exec-write` no sirve**: solo acepta `UPDATE`/`INSERT`/`DELETE`. Hay que
   añadir acciones nuevas al bundle vivo (sección 4). `custom-query` sí sirve
   para verificar.
3. **Las acciones desconocidas «completan» sin hacer nada**
   (`Action '<x>' completed successfully`). Las acciones de este documento
   responden siempre un JSON con `ok` y `applied`. Si la respuesta no trae esos
   campos, la acción **no corrió** (bundle sin parchar o nombre mal escrito).
   Nunca aceptar «completed successfully» como prueba.
4. **Sin locks largos.** `mentions` pesa 2.3 GB en total (143 mil filas, 228 MB
   de heap); el `ALTER` solo toca el catálogo (milisegundos), pero necesita un
   lock `ACCESS EXCLUSIVE` y **mientras espera bloquea a todas las consultas
   posteriores** (ingesta incluida). Una lectura larga ya bloqueó un `ALTER`
   antes (~7 min). Por eso cada acción hace `SET lock_timeout = '5s'` y, si
   vence, reintenta 3 veces (3 s entre intentos) y responde `423` sin dejar
   nada a medias. Los dos índices usan `CREATE INDEX CONCURRENTLY` (la ingesta
   sigue escribiendo).
5. **Ventana.** La ingesta corre cada 5 minutos (reglas `rate(5 minutes)`) y el
   processor consume SQS continuamente: no hay hueco sin escrituras, y no hace
   falta uno gracias a `lock_timeout` y `CONCURRENTLY`. Lo que sí conviene
   evitar: 07:00 a 09:00 UTC (refresh de Brandwatch y los crones de
   reprocesamiento `cron(0 8)`, `cron(30 8)`, `cron(45 8)`) y cualquier sesión
   con consultas largas sobre `mentions` (ver 3.1).
6. **Concurrencia de quien despliega.** Otra sesión despliega `biq-*`/`Biq*`; no
   se toca. El bundle de `eco-migration` es compartido: descargar el vigente
   inmediatamente antes de parchar (sección 4) para no pisar un cambio ajeno.
7. Un `aws lambda invoke` que falla por timeout del CLI **no detiene el lambda**
   (memoria `feedback_cli_invoke_no_mata_al_lambda`): no repetir en bucle;
   correr `interp-v1-status` y mirar.

## 2. Sentencias y acciones

Una sentencia por acción. Todas son idempotentes (`IF NOT EXISTS`) y devuelven
`alreadyDone: true` sin ejecutar nada si el objeto ya existe. El SQL de cada
acción está literal en el bloque de la sección 4 (`INTERP_V1_STEPS`) y coincide
con `0013_interpretacion_v1.sql`.

| # | Acción | Sentencia | Lock |
|---|---|---|---|
| 1 | `interp-v1-mentions-columns` | `ALTER TABLE mentions ADD COLUMN IF NOT EXISTS` ×6 (`mention_kind varchar(24)`, `parent_mention_id uuid`, `parent_published_at timestamptz`, `nlp_adverse_fact boolean`, `nlp_prompt_version varchar(24)`, `nlp_model varchar(64)`) | `ACCESS EXCLUSIVE`, ms |
| 2 | `interp-v1-mentions-idx-kind` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_kind ON mentions (agency_id, mention_kind, published_at)` | `SHARE UPDATE EXCLUSIVE` |
| 3 | `interp-v1-mentions-idx-parent` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_parent ON mentions (parent_mention_id)` | `SHARE UPDATE EXCLUSIVE` |
| 4 | `interp-v1-shadow-table` | `CREATE TABLE IF NOT EXISTS mention_nlp_shadow (…, PK (mention_id, prompt_version))` | ninguno sobre tablas existentes |
| 5 | `interp-v1-report-send-log-columns` | `ALTER TABLE report_send_log ADD COLUMN IF NOT EXISTS` `subject text`, `headline text`, `composition jsonb`, `composer_version varchar(24)` | `ACCESS EXCLUSIVE`, ms (484 filas) |
| 6 | `interp-v1-report-configs-composer-mode` | `ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS composer_mode varchar(10) NOT NULL DEFAULT 'legacy'` | `ACCESS EXCLUSIVE`, ms (4 filas; DEFAULT constante, sin reescritura en PG 16) |
| 7 | `interp-v1-overview-insights-columns` | `ALTER TABLE overview_period_insights ADD COLUMN IF NOT EXISTS` `composition jsonb`, `composer_version varchar(24)` | `ACCESS EXCLUSIVE`, ms (~300 filas) |
| 8 | `interp-v1-metric-cache-columns` | `ALTER TABLE metric_insights_cache ADD COLUMN IF NOT EXISTS` `composition jsonb`, `composer_version varchar(24)` | `ACCESS EXCLUSIVE`, ms (~40 filas) |

Acciones auxiliares (solo lectura, salvo la última):

| Acción | Para qué |
|---|---|
| `interp-v1-status` | Compara las 23 columnas, los 2 índices y la PK contra lo esperado; responde `ok: true/false`. Sirve también de prueba de que el bundle parchado está vivo. |
| `interp-v1-drop-invalid-index` | Recuperación: `DROP INDEX CONCURRENTLY` de `idx_mentions_kind` o `idx_mentions_parent` **solo si** quedó `INVALID` (un `CONCURRENTLY` interrumpido). Rechaza cualquier otro nombre y cualquier índice válido. |

Cada acción acepta `"dryRun": true`: devuelve el SQL, el estado actual y
`alreadyDone`, sin ejecutar nada.

Decisiones de diseño relevantes:

- `mention_nlp_shadow` **sin FK** a `mentions` (igual que `parent_mention_id`,
  spec 12.1): una FK exige `SHARE ROW EXCLUSIVE` sobre `mentions` y un chequeo
  por inserción. Las huérfanas se limpian por SQL.
- La PK `(mention_id, prompt_version)` es también el índice de búsqueda.
- `composer_mode` sin `CHECK`: los valores válidos (`legacy` | `shadow` |
  `agentic`) los impone el tipo TypeScript (`ComposerMode`). Para cambiarlo por
  SQL hay que editar con `updated_by` NOT NULL, o el self-heal horario de
  `eco-weekly-report` revierte la fila.
- Los índices son los del spec (planos). `idx_mentions_parent` queda casi todo
  en NULL hasta el backfill; un índice parcial (`WHERE parent_mention_id IS NOT
  NULL`) sería más chico. No se hizo para no desviarse del spec; si se prefiere,
  es un cambio de una línea en la sentencia 3 y en `schema/mentions.ts`.

## 3. Verificación con `custom-query` (solo SELECT)

Se corre antes, entre acciones y después. Todas son baratas (catálogo).

### 3.1 Antes: que no haya una lectura larga sobre `mentions`

```sql
SELECT pid, state, now() - query_start AS running, wait_event_type, left(query, 100) AS q
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
  AND state <> 'idle' AND query_start < now() - interval '30 seconds'
ORDER BY query_start LIMIT 20
```

Si aparece algo que toca `mentions` y dura minutos, esperar o avisar a su dueño;
no matarlo desde aquí.

### 3.2 Columnas (esperadas: 23 filas tras aplicar todo)

```sql
SELECT table_name, column_name, data_type, character_maximum_length AS len, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND (
     (table_name = 'mentions' AND column_name IN ('mention_kind','parent_mention_id','parent_published_at','nlp_adverse_fact','nlp_prompt_version','nlp_model'))
  OR (table_name = 'mention_nlp_shadow')
  OR (table_name = 'report_send_log' AND column_name IN ('subject','headline','composition','composer_version'))
  OR (table_name = 'report_configs' AND column_name = 'composer_mode')
  OR (table_name = 'overview_period_insights' AND column_name IN ('composition','composer_version'))
  OR (table_name = 'metric_insights_cache' AND column_name IN ('composition','composer_version')))
ORDER BY table_name, column_name
```

Resultado esperado: todas `is_nullable = YES` y `column_default` nulo, salvo
`report_configs.composer_mode` (`NO`, `'legacy'::character varying`) y, en
`mention_nlp_shadow`, `mention_id`/`prompt_version`/`model`/`created_at`
(`NO`; `created_at` con `now()`).

### 3.3 Índices y validez (un `CONCURRENTLY` fallido deja `indisvalid = false`)

```sql
SELECT c.relname AS name, i.indisvalid AS valid, i.indisunique AS uniq, pg_get_indexdef(i.indexrelid) AS def
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('idx_mentions_kind', 'idx_mentions_parent', 'mention_nlp_shadow_pk')
ORDER BY c.relname
```

Esperado: 3 filas, `valid = true`; `mention_nlp_shadow_pk` única sobre
`(mention_id, prompt_version)`.

### 3.4 Sin cambio de datos

```sql
SELECT composer_mode, count(*) AS n FROM report_configs GROUP BY 1
```

Esperado: todas las filas en `legacy` (4 filas a 2-nov-2026).

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('mentions','mention_nlp_shadow','report_send_log')
```

`mentions` no cambia de tamaño por la migración (≈143 mil filas), y
`mention_nlp_shadow` está en 0. No se cuenta `mention_kind IS NOT NULL` sobre
`mentions` para no escanear la tabla: las columnas se crean sin valor y nada
las puebla hasta WP-2 (`nlp_prompt_version` identifica después qué filas tienen
la rúbrica v2).

## 4. Procedimiento: añadir las acciones al bundle vivo de `eco-migration`

Es el de CLAUDE.md («Drift bundle-vs-git»): **no** se redespliega
`infra/lambda/migration/index.ts` (le faltan `exec-write`, `create-advisor-schema`,
`welcome-email-columns`, etc.). Se parcha el JS descargado: el bundle de esbuild
viene formateado, no minificado. **No ejecutado en este PR.**

Lo único que se probó sin tocar producción: los bloques de abajo se insertaron
en una *copia local* del bundle vigente (LastModified 2026-11-02T16:40:53Z,
74,069 bytes zip, 7,485 líneas), `node --check` pasó, y las funciones se
ejercitaron contra un Postgres en memoria (PGlite): dryRun, aplicación, segunda
pasada idempotente (`alreadyDone`), reintento ante un `55P03` simulado y los
rechazos de `interp-v1-drop-invalid-index`. Nada se subió a AWS.

### 4.1 Descargar el bundle vigente (siempre, justo antes de parchar)

```bash
REPO=/Users/alegut/MyApps/eco_populicom
set -a; source $REPO/.env; set +a      # misma línea; no imprimir variables
WORK=$(mktemp -d)                       # directorio nuevo y vacío
cd "$WORK"
URL=$(aws lambda get-function --function-name eco-migration --query 'Code.Location' --output text)
curl -s -o live.zip "$URL" && mkdir live && unzip -q live.zip -d live
ls -la live                              # esperado: solo index.js
cp live/index.js live/index.js.orig
```

Antes de seguir, **mira si cambió desde 2-nov** (drift): `aws lambda
get-function-configuration --function-name eco-migration --query
'[LastModified,CodeSha256]'`. Si otro lo modificó, no hay problema: se parcha
sobre lo descargado ahora, nunca sobre una copia vieja.

### 4.2 Los dos bloques

Guarda el bloque A como `helper.js` y el B como `dispatch.js` (en `$WORK`).

**Bloque A: helper** (va justo antes de `var handler = async (event) => {`; define
los 8 pasos de la sección 2 con su SQL literal, el verificador y las acciones
auxiliares).

```js
// ---- interpretación v1 / migración 0013 (docs/tecnica/migration-0013-actions.md) ----
// Una acción por sentencia DDL. Cada una: dryRun opcional, lock_timeout corto,
// reintento si vence el lock, y verificación contra el catálogo. La respuesta
// SIEMPRE trae `ok` y `applied`: si no los ves, la acción no corrió (el handler
// responde "completed successfully" a cualquier acción desconocida).
const INTERP_V1_COLS = (table, names) => ({
  verify: `SELECT column_name, data_type, character_maximum_length AS len, is_nullable, column_default
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '${table}'
              AND column_name IN (${names.map((n) => `'${n}'`).join(", ")})
            ORDER BY column_name`,
  expect: names.length,
});
const INTERP_V1_IDX = (name) => ({
  verify: `SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS def
             FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.relname = '${name}'`,
  expect: 1,
  index: name,
});
const INTERP_V1_STEPS = {
  // 1. mentions: 6 columnas nulas (una sentencia = un solo lock, de milisegundos)
  "interp-v1-mentions-columns": {
    sql: `ALTER TABLE mentions
            ADD COLUMN IF NOT EXISTS mention_kind        varchar(24),
            ADD COLUMN IF NOT EXISTS parent_mention_id   uuid,
            ADD COLUMN IF NOT EXISTS parent_published_at timestamptz,
            ADD COLUMN IF NOT EXISTS nlp_adverse_fact    boolean,
            ADD COLUMN IF NOT EXISTS nlp_prompt_version  varchar(24),
            ADD COLUMN IF NOT EXISTS nlp_model           varchar(64)`,
    timeout: "30s",
    ...INTERP_V1_COLS("mentions", ["mention_kind", "parent_mention_id", "parent_published_at", "nlp_adverse_fact", "nlp_prompt_version", "nlp_model"]),
  },
  // 2-3. mentions: índices CONCURRENTLY (una sola sentencia por envío, fuera de transacción)
  "interp-v1-mentions-idx-kind": {
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_kind ON mentions (agency_id, mention_kind, published_at)`,
    timeout: "15min",
    ...INTERP_V1_IDX("idx_mentions_kind"),
  },
  "interp-v1-mentions-idx-parent": {
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_parent ON mentions (parent_mention_id)`,
    timeout: "15min",
    ...INTERP_V1_IDX("idx_mentions_parent"),
  },
  // 4. tabla de sombra (sin FK a mentions a propósito)
  "interp-v1-shadow-table": {
    sql: `CREATE TABLE IF NOT EXISTS mention_nlp_shadow (
            mention_id     uuid         NOT NULL,
            prompt_version varchar(24)  NOT NULL,
            model          varchar(64)  NOT NULL,
            sentiment      varchar(20),
            pertinence     varchar(10),
            adverse_fact   boolean,
            topics         jsonb,
            created_at     timestamptz  NOT NULL DEFAULT now(),
            CONSTRAINT mention_nlp_shadow_pk PRIMARY KEY (mention_id, prompt_version)
          )`,
    timeout: "30s",
    ...INTERP_V1_COLS("mention_nlp_shadow", ["mention_id", "prompt_version", "model", "sentiment", "pertinence", "adverse_fact", "topics", "created_at"]),
  },
  // 5. archivo de cada envío
  "interp-v1-report-send-log-columns": {
    sql: `ALTER TABLE report_send_log
            ADD COLUMN IF NOT EXISTS subject          text,
            ADD COLUMN IF NOT EXISTS headline         text,
            ADD COLUMN IF NOT EXISTS composition      jsonb,
            ADD COLUMN IF NOT EXISTS composer_version varchar(24)`,
    timeout: "30s",
    ...INTERP_V1_COLS("report_send_log", ["subject", "headline", "composition", "composer_version"]),
  },
  // 6. bandera del motor por agencia (DEFAULT constante: sin reescritura en PG 16)
  "interp-v1-report-configs-composer-mode": {
    sql: `ALTER TABLE report_configs ADD COLUMN IF NOT EXISTS composer_mode varchar(10) NOT NULL DEFAULT 'legacy'`,
    timeout: "30s",
    ...INTERP_V1_COLS("report_configs", ["composer_mode"]),
  },
  // 7-8. traza de composición de la web
  "interp-v1-overview-insights-columns": {
    sql: `ALTER TABLE overview_period_insights
            ADD COLUMN IF NOT EXISTS composition      jsonb,
            ADD COLUMN IF NOT EXISTS composer_version varchar(24)`,
    timeout: "30s",
    ...INTERP_V1_COLS("overview_period_insights", ["composition", "composer_version"]),
  },
  "interp-v1-metric-cache-columns": {
    sql: `ALTER TABLE metric_insights_cache
            ADD COLUMN IF NOT EXISTS composition      jsonb,
            ADD COLUMN IF NOT EXISTS composer_version varchar(24)`,
    timeout: "30s",
    ...INTERP_V1_COLS("metric_insights_cache", ["composition", "composer_version"]),
  },
};
const INTERP_V1_RESPOND = (statusCode, payload) => ({ statusCode, body: JSON.stringify(payload, null, 2) });
const INTERP_V1_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
async function interpV1StepDone(client, step) {
  const rows = (await client.query(step.verify)).rows;
  const done = rows.length === step.expect && (!step.index || rows.every((r) => r.valid === true));
  return { rows, done };
}
async function runInterpV1Step(client, name, dryRun) {
  const step = INTERP_V1_STEPS[name];
  const before = await interpV1StepDone(client, step);
  const out = { action: name, dryRun: !!dryRun, sql: step.sql.replace(/\s+/g, " "), before: before.rows, alreadyDone: before.done };
  if (step.index && before.rows.some((r) => r.valid === false)) {
    return INTERP_V1_RESPOND(409, { ...out, ok: false, applied: false, error: `el índice ${step.index} existe INVALID (un CONCURRENTLY previo falló); corre interp-v1-drop-invalid-index con {"index":"${step.index}"} y repite` });
  }
  if (dryRun) return INTERP_V1_RESPOND(200, { ...out, ok: true, applied: false });
  if (before.done) return INTERP_V1_RESPOND(200, { ...out, ok: true, applied: false });
  // lock_timeout corto: un ALTER en cola bloquea a todas las consultas posteriores sobre la tabla.
  await client.query(`SET lock_timeout = '5s'`);
  await client.query(`SET statement_timeout = '${step.timeout}'`);
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.query(step.sql);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err && err.code === "55P03" && attempt < 3) { await INTERP_V1_SLEEP(3000); continue; } // lock_not_available
      break;
    }
  }
  const after = await interpV1StepDone(client, step);
  if (lastErr) {
    const retriable = lastErr.code === "55P03";
    return INTERP_V1_RESPOND(retriable ? 423 : 500, { ...out, ok: false, applied: false, after: after.rows, error: String(lastErr.message ?? lastErr), code: lastErr.code, hint: retriable ? "vencio lock_timeout: hay una lectura/escritura larga sobre la tabla; reintenta fuera de la ventana de ingesta" : undefined });
  }
  return INTERP_V1_RESPOND(after.done ? 200 : 500, { ...out, ok: after.done, applied: !before.done && after.done, after: after.rows });
}
const INTERP_V1_INDEXES = ["idx_mentions_kind", "idx_mentions_parent"];
async function interpV1DropInvalidIndex(client, index, dryRun) {
  if (!INTERP_V1_INDEXES.includes(index)) {
    return INTERP_V1_RESPOND(400, { ok: false, applied: false, error: `index debe ser uno de ${INTERP_V1_INDEXES.join(", ")}` });
  }
  const st = (await client.query(`SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '${index}'`)).rows;
  if (st.length === 0) return INTERP_V1_RESPOND(200, { action: "interp-v1-drop-invalid-index", index, ok: true, applied: false, note: "el índice no existe" });
  if (st[0].valid) return INTERP_V1_RESPOND(409, { action: "interp-v1-drop-invalid-index", index, ok: false, applied: false, error: "el índice es VALID; no se borra" });
  if (dryRun) return INTERP_V1_RESPOND(200, { action: "interp-v1-drop-invalid-index", index, dryRun: true, ok: true, applied: false });
  await client.query(`SET lock_timeout = '5s'`);
  await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${index}`);
  return INTERP_V1_RESPOND(200, { action: "interp-v1-drop-invalid-index", index, ok: true, applied: true });
}
async function interpV1Status(client) {
  const allCols = {
    mentions: ["mention_kind", "parent_mention_id", "parent_published_at", "nlp_adverse_fact", "nlp_prompt_version", "nlp_model"],
    mention_nlp_shadow: ["mention_id", "prompt_version", "model", "sentiment", "pertinence", "adverse_fact", "topics", "created_at"],
    report_send_log: ["subject", "headline", "composition", "composer_version"],
    report_configs: ["composer_mode"],
    overview_period_insights: ["composition", "composer_version"],
    metric_insights_cache: ["composition", "composer_version"],
  };
  const out = { action: "interp-v1-status", tables: {} };
  let allOk = true;
  for (const [table, names] of Object.entries(allCols)) {
    const rows = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])`,
      [table, names],
    )).rows.map((r) => r.column_name);
    const missing = names.filter((n) => !rows.includes(n));
    if (missing.length) allOk = false;
    out.tables[table] = { present: rows.length, expected: names.length, missing };
  }
  out.indexes = (await client.query(
    `SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN ('idx_mentions_kind', 'idx_mentions_parent', 'mention_nlp_shadow_pk') ORDER BY c.relname`,
  )).rows;
  if (out.indexes.length !== 3 || out.indexes.some((r) => !r.valid)) allOk = false;
  out.ok = allOk;
  return INTERP_V1_RESPOND(200, out);
}
// ---- fin interpretación v1 ----
```

**Bloque B: despacho** (va dentro del `try` del handler, justo antes de
`if (action === "exec-write" && event.query) {`; 4 espacios de sangría).

```js
    if (action === "interp-v1-status") {
      return await interpV1Status(client);
    }
    if (action === "interp-v1-drop-invalid-index") {
      return await interpV1DropInvalidIndex(client, event.index, event.dryRun === true);
    }
    if (Object.hasOwn(INTERP_V1_STEPS, action)) {
      return await runInterpV1Step(client, action, event.dryRun === true);
    }
```

### 4.3 Insertar, validar, empaquetar, subir

```bash
cd "$WORK"
# Comprobar que los anclajes existen UNA vez y que no hay parche previo
grep -c '^var handler = async (event) => {$' live/index.js                      # esperado: 1
grep -c '^    if (action === "exec-write" && event.query) {$' live/index.js    # esperado: 1
grep -c 'INTERP_V1\|interpV1' live/index.js                                    # esperado: 0 (si no, ya está parchado)

python3 - <<'PY'
s = open('live/index.js').read()
h = open('helper.js').read()
d = open('dispatch.js').read()
a1 = 'var handler = async (event) => {\n'
a2 = '    if (action === "exec-write" && event.query) {\n'
assert s.count(a1) == 1 and s.count(a2) == 1, 'anclaje ausente o repetido'
s = s.replace(a1, h + '\n' + a1).replace(a2, d + a2)
open('live/index.js', 'w').write(s)
PY

node --check live/index.js && echo OK     # si falla, NO subir
diff live/index.js.orig live/index.js | grep -c '^<'   # esperado: 0 (solo se agregaron líneas)

cd live && zip -q ../patched.zip index.js && cd ..
aws lambda update-function-code --function-name eco-migration --zip-file fileb://patched.zip --query '[LastModified,CodeSize]'
aws lambda wait function-updated --function-name eco-migration
```

Re-descargar y comprobar que lo vivo contiene el parche (misma receta de 4.1 a
otro directorio y `grep -c 'interpV1Status'` ≥ 1). Guardar `live.zip` original
en un lugar seguro: es el rollback del bundle.

## 5. Aplicar (en orden), con dryRun primero

```bash
REPO=/Users/alegut/MyApps/eco_populicom
set -a; source $REPO/.env; set +a
OUT=$(mktemp)
call() {   # call <acción> [dryRun:true|false] [json extra sin llaves, p. ej. "index":"idx_mentions_kind"]
  local extra="${3:+,$3}"
  aws lambda invoke --function-name eco-migration \
    --payload "{\"action\":\"$1\",\"dryRun\":${2:-true}${extra}}" \
    --cli-binary-format raw-in-base64-out --cli-read-timeout 900 "$OUT" >/dev/null \
  && python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("statusCode")); print(d.get("body") or d)' "$OUT"
}

call interp-v1-status false        # antes: ok:false con todo en missing; prueba de que el bundle parchado está vivo
# Recomendado: lock_timeout y ventana (sección 1, puntos 4 y 5); correr 3.1 antes.
for a in interp-v1-mentions-columns interp-v1-mentions-idx-kind interp-v1-mentions-idx-parent \
         interp-v1-shadow-table interp-v1-report-send-log-columns \
         interp-v1-report-configs-composer-mode interp-v1-overview-insights-columns \
         interp-v1-metric-cache-columns; do
  echo "== $a (dryRun)"; call $a true
done
# Revisar los dryRun; luego, UNO POR UNO (leer la respuesta antes de seguir):
call interp-v1-mentions-columns false
call interp-v1-mentions-idx-kind false
call interp-v1-mentions-idx-parent false
call interp-v1-shadow-table false
call interp-v1-report-send-log-columns false
call interp-v1-report-configs-composer-mode false
call interp-v1-overview-insights-columns false
call interp-v1-metric-cache-columns false
call interp-v1-status false        # esperado: "ok": true
```

Lectura de las respuestas:

| `statusCode` / campos | Significado | Qué hacer |
|---|---|---|
| 200, `ok: true`, `applied: true` | Aplicada | Seguir |
| 200, `ok: true`, `applied: false`, `alreadyDone: true` | Ya existía | Seguir |
| 423, `code: "55P03"` | Venció `lock_timeout` tras 3 intentos; nada quedó a medias | Mirar 3.1, reintentar fuera de la ventana |
| 409, «existe INVALID» | Un `CONCURRENTLY` anterior falló | `call interp-v1-drop-invalid-index false '"index":"idx_mentions_kind"'` y repetir la acción del índice |
| 500, `ok: false` | Error de SQL o verificación fallida | Leer `error`; no seguir; no hay cambios de datos que revertir |
| Sin `ok`/`applied` | La acción **no corrió** | Bundle sin parchar o nombre mal escrito |

Después de la sección 5: correr las consultas 3.2, 3.3 y 3.4, **y solo entonces**
mergear el PR de WP-1 (sección 1, punto 1).

## 6. Rollback

Fix-forward (plan, sección 7, paso 6): las columnas son nulas (o `legacy`) y el
código anterior no las lee, así que no hace falta revertirlas. Lo único que
requiere acción es un índice `INVALID` (`interp-v1-drop-invalid-index`). Si se
quisiera retirar el parche del bundle, subir de nuevo el `live.zip` original
guardado en 4.3 (`update-function-code`).
