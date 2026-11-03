# Migración 0014: acciones de `eco-migration` (interpretación v1, WP-6)

> Cómo aplicar `packages/database/src/migrations/0014_report_compositions.sql`
> en producción. **Estado: preparado, NO ejecutado.** Lo aplica el orquestador,
> nunca un subagente. Mismo formato y mismas reglas que
> [migration-0013-actions.md](migration-0013-actions.md); aquí solo lo que
> cambia.

## 1. Qué hay que saber antes de tocar nada

1. **Una sola sentencia**: `CREATE TABLE IF NOT EXISTS report_compositions`.
   No toca ninguna tabla existente salvo la FK a `agencies` (lock `SHARE ROW
   EXCLUSIVE` sobre una tabla de 5 filas, un instante). No toca `mentions`.
2. **Orden**: puede ir antes o después del merge del PR de WP-6.
   - El schema de Drizzle (`reportCompositions` en `schema/reports.ts`) es una
     tabla nueva: ninguna consulta existente de la web la lista, así que el
     merge no rompe nada aunque la tabla no exista todavía.
   - El lambda `eco-weekly-report` de WP-6 tolera la tabla ausente: no guarda,
     no lee y sigue enviando (compone en el momento o manda el legacy).
   - Lo que **sí** exige la tabla: pasar una agencia a `shadow` o `agentic`
     (sin ella no hay composición anticipada y cada envío compone en el
     momento). Aplicar 0014 **antes** de cambiar cualquier `composer_mode`.
3. **Requiere el parche de 0013** en el bundle vivo de `eco-migration`
   (`INTERP_V1_STEPS`, `runInterpV1Step`). Verificado el 2-nov-2026 23:43Z
   (bundle de 76,569 bytes zip, 7,670 líneas): está. Este parche añade **un
   paso** a ese objeto; el despacho existente
   (`if (Object.hasOwn(INTERP_V1_STEPS, action))`) lo enruta solo.
4. Las reglas de 0013 siguen valiendo: acciones desconocidas «completan» sin
   hacer nada (verificar siempre `ok`/`applied` en la respuesta y luego con
   `custom-query`); `lock_timeout = '5s'` con 3 reintentos; un `invoke` que
   vence en el CLI no detiene el lambda.

## 2. Sentencia y acción

| # | Acción | Sentencia | Lock |
|---|---|---|---|
| 1 | `interp-v1-report-compositions-table` | `CREATE TABLE IF NOT EXISTS report_compositions (agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE, report_type varchar(10) NOT NULL, period_end date NOT NULL, composer_version varchar(24) NOT NULL, composition jsonb NOT NULL, status varchar(16) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT report_compositions_pk PRIMARY KEY (agency_id, report_type, period_end))` | `SHARE ROW EXCLUSIVE` sobre `agencies` (FK), instantáneo |

Acepta `"dryRun": true` (devuelve el SQL, el estado y `alreadyDone` sin
ejecutar). Idempotente: si las 7 columnas ya existen responde
`alreadyDone: true` y no ejecuta.

Decisiones de diseño:

- **PK compuesta** `(agency_id, report_type, period_end)`: es la única búsqueda
  (el envío lee la composición de SU periodo) y deja una fila por periodo. El
  lambda hace `UPSERT`; una composición `degraded` no pisa una `complete`.
- **FK a `agencies`** como `report_send_log`; sin `CHECK` en `report_type` ni en
  `status` (igual que `composer_mode` en 0013: los valores los impone
  TypeScript).
- `created_at` se reescribe en cada `UPSERT` (momento de la última composición
  guardada del periodo).

## 3. Verificación con `custom-query` (solo SELECT)

Antes (debe dar 0 filas) y después (7 filas):

```sql
SELECT column_name, data_type, character_maximum_length AS len, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'report_compositions'
ORDER BY ordinal_position
```

Esperado: las 7 columnas `NOT NULL` (`is_nullable = NO`); `created_at` con
`now()`.

```sql
SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
WHERE t.relname = 'report_compositions' ORDER BY c.conname
```

Esperado: `report_compositions_pk` (`p`, `PRIMARY KEY (agency_id, report_type,
period_end)`) y la FK a `agencies` (`f`, `ON DELETE CASCADE`).

```sql
SELECT count(*) AS n FROM report_compositions
```

Esperado: 0 hasta que una agencia salga de `legacy`.

## 4. Procedimiento: añadir la acción al bundle vivo de `eco-migration`

Igual que 0013, sección 4 (descargar el bundle vigente justo antes de parchar,
`node --check`, re-zip, `update-function-code`). Solo cambia el bloque.

### 4.1 El bloque

Va **justo después** de la línea `// ---- fin interpretación v1 ----` (antes
de `var handler = async (event) => {`). Reutiliza `INTERP_V1_COLS` y el
despacho de 0013.

```js
// ---- interpretación v1 / migración 0014 (docs/tecnica/migration-0014-actions.md) ----
INTERP_V1_STEPS["interp-v1-report-compositions-table"] = {
  sql: `CREATE TABLE IF NOT EXISTS report_compositions (
          agency_id        uuid         NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
          report_type      varchar(10)  NOT NULL,
          period_end       date         NOT NULL,
          composer_version varchar(24)  NOT NULL,
          composition      jsonb        NOT NULL,
          status           varchar(16)  NOT NULL,
          created_at       timestamptz  NOT NULL DEFAULT now(),
          CONSTRAINT report_compositions_pk PRIMARY KEY (agency_id, report_type, period_end)
        )`,
  timeout: "30s",
  ...INTERP_V1_COLS("report_compositions", ["agency_id", "report_type", "period_end", "composer_version", "composition", "status", "created_at"]),
};
// ---- fin migración 0014 ----
```

### 4.2 Insertar, validar, empaquetar, subir

```bash
REPO=/Users/alegut/MyApps/eco_populicom
set -a; source $REPO/.env; set +a      # misma línea; no imprimir variables
WORK=$(mktemp -d) && cd "$WORK"
URL=$(aws lambda get-function --function-name eco-migration --query 'Code.Location' --output text)
curl -s -o live.zip "$URL" && mkdir live && unzip -q live.zip -d live
cp live/index.js live/index.js.orig
cp live.zip live.zip.rollback

grep -c '^// ---- fin interpretación v1 ----$' live/index.js     # esperado: 1 (parche 0013 presente)
grep -c 'interp-v1-report-compositions-table' live/index.js      # esperado: 0 (si no, ya está parchado)

# block.js = el bloque de 4.1
python3 - <<'PY'
s = open('live/index.js').read()
b = open('block.js').read()
anchor = '// ---- fin interpretación v1 ----\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + b + '\n', 1)
open('live/index.js', 'w').write(s)
PY
node --check live/index.js && echo SINTAXIS_OK
diff <(sed 's/^/  /' live/index.js.orig) <(sed 's/^/  /' live/index.js) | head -40   # solo el bloque nuevo

(cd live && zip -q -r ../patched.zip .)
aws lambda update-function-code --function-name eco-migration --zip-file fileb://patched.zip \
  --query '[LastModified,CodeSize]' --output text
aws lambda wait function-updated --function-name eco-migration
```

### 4.3 Aplicar

```bash
# 1) dryRun: debe responder ok=true, applied=false, alreadyDone=false
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"interp-v1-report-compositions-table","dryRun":true}' \
  --cli-binary-format raw-in-base64-out /tmp/m14.json && cat /tmp/m14.json

# 2) aplicar: ok=true, applied=true y `after` con 7 columnas
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"interp-v1-report-compositions-table"}' \
  --cli-binary-format raw-in-base64-out /tmp/m14.json && cat /tmp/m14.json

# 3) segunda pasada (idempotencia): ok=true, applied=false, alreadyDone=true
```

Luego las tres consultas de la sección 3.

Rollback del bundle: `update-function-code` con `live.zip.rollback`. Rollback
de la tabla: no hace falta (nadie la usa con todas las agencias en `legacy`).

## 5. Después: encender el motor para una agencia

No es parte de la migración; va aquí porque es el paso siguiente y tiene una
trampa. `composer_mode` se cambia por SQL con `updated_by` NOT NULL (acción
`exec-write` de `eco-migration`, una sentencia):

```sql
UPDATE report_configs rc SET composer_mode = 'shadow', updated_at = NOW()
  FROM agencies a
 WHERE rc.agency_id = a.id AND a.slug = 'ddecpr' AND rc.updated_by IS NOT NULL
```

- El self-heal horario de `eco-weekly-report` (`ensureReportsSchema`) **no**
  toca `composer_mode` (ninguno de sus `UPDATE`/`ON CONFLICT` lo incluye;
  revisado en WP-6). El `UPSERT` del seed solo reescribe `is_active`,
  `send_hour_local`, `timezone` y `recipients`, y solo en filas con
  `updated_by IS NULL`. Las 5 filas de producción tienen `updated_by` NOT NULL
  (2-nov-2026), por eso la condición del `WHERE`.
- Verificar con `SELECT a.slug, rc.composer_mode FROM report_configs rc JOIN
  agencies a ON a.id = rc.agency_id`.
- Rollback: el mismo `UPDATE` con `'legacy'`.
