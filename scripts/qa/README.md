# Arnés de calidad de la interpretación de ECO (`scripts/qa/`)

Promueve el laboratorio de la investigación de octubre-noviembre 2026 a una herramienta del repo. Mide, sobre conjuntos de
oro congelados, si la clasificación (rúbrica v2) y los textos del correo diario cumplen las compuertas del spec
(`docs/tecnica/spec-interpretacion-eco-v1.md`, secciones 6.4 y 13.1 a 13.3). La guía completa (qué mide cada script, cómo
interpretar, límites) está en [`docs/tecnica/qa-interpretacion-v1.md`](../../docs/tecnica/qa-interpretacion-v1.md).

> **No es CI.** Llama a Bedrock (cuesta dinero) y, con `--with-db`, lee producción. Se corre a mano o de noche, nunca en un
> workflow de GitHub.

## Un comando

```bash
# ver qué haría y cuánto costaría, sin llamar a nada
bash scripts/qa/run-all.sh --dry-run

# perfil rápido (Sonnet, submuestras con semilla fija: 184 llamadas, ~1.05 M tokens de entrada, ~USD 4)
bash scripts/qa/run-all.sh

# solo un subconjunto pequeño
bash scripts/qa/run-all.sh --only ddec-classify --limit 20

# cero costo: re-evalúa las corridas y veredictos de referencia del 2-nov (valida el arnés, reproduce el spec 6.4 exacto)
bash scripts/qa/run-all.sh --cached

# conjuntos completos (208 + 867 + 397 menciones, 6 ventanas, libro de afirmaciones); Opus opcional con --opus
bash scripts/qa/run-all.sh --full [--opus] [--with-db]
```

Salida: la tabla del spec 6.4 (producción vs rúbrica v2 vs lo que dice el spec) y la tabla de umbrales 13.2 con `PASA`,
`FALLA` o `N/D`. El código de salida es 1 si alguna compuerta falla. Los detalles quedan en `scripts/qa/out/run-<fecha>/`
(ignorado por git): `tabla-6.4.md`, `gates.*.json`, `runs/` (etiquetas por mención), `verdicts/` (veredictos del juez de textos).

### Requisitos

- Python 3 (solo biblioteca estándar), AWS CLI v2 y credenciales de AWS con `bedrock:InvokeModel` (modelos
  `us.anthropic.claude-sonnet-4-6` y `us.anthropic.claude-opus-4-6-v1`; se pueden cambiar con `ECO_QA_SONNET_ID` /
  `ECO_QA_OPUS_ID`).
- El `.env` se busca en `REPO_ENV`, luego en `<repo>/.env` y, si estás en un worktree, en el `.env` del checkout principal.
  Nunca se imprime.
- Solo para `repro.ts`, `repro-check` y `--with-db`: `tsx` (`node_modules/.bin/tsx`, `TSX_BIN` o `npx`), y permiso para invocar
  el lambda `eco-migration` (solo `custom-query`, solo SELECT).

## Qué hay aquí

| Archivo | Qué hace | Costo |
|---|---|---|
| `run-all.sh` | Orquesta todo y arma la tabla de compuertas | según flags |
| `classify-lab.py` | Clasifica un conjunto de oro (`ddec208`, `ddec867`, `df397`, `df162`) con la rúbrica v2 y Bedrock | Bedrock |
| `eval-classification.py` | Compara con los jueces: tabla 6.4 y compuertas de sentimiento, hecho adverso y estabilidad | gratis |
| `compose-judge.py` | Juez independiente de los textos del correo en las 6 ventanas (afirmaciones, dramatismo, post viejo, lint). Con `--ledger` calibra al juez contra las 127 afirmaciones verificadas | Bedrock |
| `human-kappa.py` | κ de Cohen entre la hoja humana a ciegas (48 ítems) y el sistema | gratis |
| `parents.py` | Resolución del post padre de comentarios FB/IG por la regla de GUID (SELECT acotados) | DB (lectura) |
| `repro.ts` | «Máquina del tiempo» del correo: reconstruye entradas y prompts de cualquier día pasado con el código real de `@eco/shared` | DB (lectura); `--llm` Bedrock |
| `repro-check.py` | Comprueba que `repro.ts` aún reproduce una ventana del fixture | DB (lectura) |
| `lib/` | `qa_common.py` (Bedrock, tope de llamadas, muestreo), `qa_gates.py` (compuertas 13.2), `lab_prompts.py` (prompt y rúbrica v2), `q.py` (SELECT de solo lectura) | |
| `tools/build-fixtures.py` | Procedencia: cómo se generaron los fixtures pseudonimizados a partir del laboratorio | |
| `tools/make-text-sheet.py` | Genera la hoja ciega de 12 textos de correo | |
| `fixtures/` | Conjuntos de oro pseudonimizados (ver `fixtures/README.md`) | |

## Pasos de `run-all.sh`

| Paso | Qué corre | Perfil |
|---|---|---|
| `ddec-classify` | `ddec208` (muestra estratificada con juez Opus) → compuerta «DDEC acuerdo por tono» | rápido y completo |
| `ddec-week` | `ddec867` (semana completa 25-oct a 1-nov) → NSS pertinente y pertinencia baja | completo |
| `df-classify` | `df397` (censo DF, juez Sonnet) → acuerdo, precisión de negativos, hecho adverso, NSS | rápido y completo |
| `df-opus` | `df162` con Opus (juez Opus) | `--full --opus` |
| `stability` | repite `ddec208` sobre los mismos ids y compara etiquetas | rápido y completo |
| `texts` | `compose-judge.py` sobre 2 ventanas (rápido) o las 6 (completo), textos `team` y `base` | rápido y completo |
| `ledger` | calibración del juez contra el libro de afirmaciones | completo |
| `kappa` | κ de la hoja humana; `N/D` hasta que alguien la rellene | siempre |
| `parents`, `repro-check` | lecturas a producción | `--with-db` |

Un subconjunto (`--limit`, menos ventanas) marca su estado con `*`: es indicativo; el spec fija los umbrales sobre los conjuntos completos.

## Reproducibilidad y costo

- **Semillas fijas**: `--seed` (default 20261102) fija las submuestras; el mismo `--limit` y `--seed` eligen siempre los
  mismos ids. Los modelos corren con `temperature` 0.1 (clasificación, como en el laboratorio) y 0 (jueces); aun así el
  modelo no es determinista: la compuerta de estabilidad existe para medirlo. **La semilla fija la muestra, no las
  etiquetas**: dos corridas con la misma semilla clasifican los mismos ids pero pueden dar porcentajes distintos (p. ej. 55 % vs
  60 % de acuerdo de tono en n = 20); no compares corridas pequeñas entre sí.
- **Tope duro**: `--max-calls` (default 700 rápido, 6000 completo) reparte un presupuesto de llamadas entre los pasos; al
  agotarse, el paso aborta y las compuertas que dependían de él quedan `N/D`.
- **Costo** (cada llamada de clasificación ≈ 3.5 a 6 mil tokens de entrada; medido el 2-nov): el perfil rápido con Sonnet
  son 184 llamadas y ≈ 1.05 M tokens de entrada + 70 mil de salida (≈ USD 4 a la tarifa de lista de Sonnet, USD 3 / 15 por
  millón de tokens de entrada / salida; verifica la tarifa vigente). `--full` con Sonnet son ≈ 1,700 llamadas y ≈ 9.6 M tokens
  de entrada (≈ USD 35 a 40). `--opus` sube el costo varias veces. Cada paso imprime su uso real de tokens y `run-all.sh` lo suma al final.
- `--dry-run` calcula las llamadas y los tokens previstos sin llamar a nada.

## Cómo conectar el motor nuevo (WP-3 a WP-6)

`compose-judge.py --candidates dir:RUTA` evalúa los textos que produzca el motor de redacción: una carpeta con un
`<ventana>.json` por ventana (`{headline, paragraph, highlights[], insights{negative,neutral,positive}}`). Mismo juez, mismas
compuertas, comparables con `team` y `base`. Para el classifier real del processor, `classify-lab.py` es la referencia
congelada del prompt; cuando WP-1/WP-2 lo lleven a producción, la fuente de verdad pasa a ser el código del processor y hay
que re-sincronizar `lib/lab_prompts.py` (o apuntar el arnés al prompt exportado).

## Mantenimiento

- `repro.ts` copia literal las consultas `buildAggregates`, `loadSamples` y `loadTodaySamples` de
  `infra/lambda/weekly-report/index.ts` (2-nov-2026). Si el lambda las cambia, actualiza la copia y corre
  `python3 scripts/qa/repro-check.py`.
- `lib/lab_prompts.py` replica el prompt del processor de producción de esa fecha (plantilla del DF en
  `fixtures/df/prompt-template.txt`, tópicos del DDEC en `fixtures/ddec/topics.json`) con la rúbrica v2 del spec, anexo A.
- Para añadir un conjunto de oro: genera el JSON, pseudonimiza con `tools/build-fixtures.py` (misma sal y mismo mapa) y
  documéntalo en `fixtures/README.md`.
- Seguridad: nunca guardes salidas con credenciales; `out/` está en `.gitignore`. Los fixtures no llevan correos,
  teléfonos ni llaves (se verifica con el `grep` del documento técnico).
