# Auditoría de consistencia de datos — agosto 2026

**Fecha:** 2026-08-10 · **Código auditado:** `origin/main @ 8a996a8` (lo desplegado en prod vía CI) · **Verificación:** base de datos de producción (solo lectura, vía `eco-migration custom-query`), 2026-08-10 ~14:42 AST.

**Disparador:** "estoy en el Overview y me dice que el tópico X tiene N menciones; abro la modal de análisis y el número es diferente, y cambia según las fechas seleccionadas."

---

## 0. Resumen ejecutivo

El bug reportado **se reproduce con datos de producción** y no es un caso aislado: es el síntoma de que el producto no tiene un contrato único de datos. Seis dimensiones que deberían tener UNA definición global tienen entre 2 y 10 implementaciones divergentes:

| Dimensión | Implementaciones encontradas | Efecto visible |
|---|---|---|
| **Ventana temporal** | 3 semánticas (cerrada-AST-terminando-ayer, rolling `now−N días` sin tope, sin ventana) + 3 estilos de cota superior + **7 copias divergentes de `PERIOD_DAYS`** + **~10 defaults distintos de período en el SPA** | El mismo "7D" son días distintos según el componente; la modal nunca ve la misma ventana que la card |
| **Universo de pertinencia** | `baja` excluida en 5 lugares, incluida en ~15 | Hasta **−42% de diferencia** (DDEC, semana actual) entre card y drill-down |
| **Conteo de tópicos** | primario top-confidence vs multi-clasificación, mezclados incluso dentro del mismo objeto JSON y de la misma pantalla | 4 números distintos para el mismo tópico en un flujo (25, +15, 9, 19) |
| **Mapeo de sentimiento** | 4+ convenciones (bilingüe-prefijo, español-exacto, `IN ('neutral')` exacto, solo-NLP-sin-fallback) + NULL tratado de 3 formas + porcentajes residuales `100−a−b` | Totales que no suman, narrativas que parecen sin clasificar, splits que absorben el error en un bucket |
| **Fuente de verdad** | `mentions` crudas vs `daily_metric_snapshots` vs tablas agregadas, mezcladas en la misma card; **dos endpoints distintos de insight para la misma métrica**; histogramas y proporciones **fabricados** presentados como datos | Serie ≠ número grande al lado; "Volumen por hora" es una senoide; el modal de municipio pinta pos/neu/neg con ratios inventados teniendo los reales disponibles |
| **Tenancy / agencia** | 4 comportamientos ante "sin agencia", 2 de ellos sirven datos de una agencia no concedida; endpoints que ignoran el switcher | Reglas de una agencia con historial de otra; preview de reportes cross-tenant |

### El caso reportado, reproducido (DDEC · período 7D · tópico "Gestión del Secretario" · 2026-08-10)

| Dónde | Número | Semántica real |
|---|---|---|
| Fila en Overview → Tópico principal | **25** (+15 "también lo tocan") | ventana cerrada 3–9 ago AST · primario · **incluye** pertinencia baja |
| Modal al clickear la fila (default) | **9** | ventana rolling `ahora−7d` · primario · **excluye** baja |
| Modal con "+ Incluir secundarias" | **19** | rolling · multi-clasificación · excluye baja |
| Aislando solo el efecto pertinencia (misma ventana) | 9 | 16 de las 25 son `baja` |
| Aislando solo el efecto ventana (misma pertinencia) | 25 | esta semana coinciden por azar; varía con la hora del día |

Ninguno de los cuatro números visibles reconcilia con otro. **Y cambia según las fechas** porque la ventana rolling se desliza con la hora mientras la cerrada salta a medianoche — exactamente lo reportado. La cadena técnica: la card viene de `/api/overview` (`buildSentimentReport`, ventana cerrada, con baja); el click pasa `_filter={topic}` **sin ventana** (`screens.js:4147-4153`); `MentionsSliceModal` reconstruye los parámetros desde `localStorage` (`shell.js:1185-1192`) y consulta `/api/eco-mentions` (rolling, sin baja) que **sobrescribe** el número de la card.

### Escala del problema (totales 7D por agencia, 2026-08-10)

| Agencia | Total Overview (cerrada, con baja) | Universo de la modal (rolling, sin baja) | Diferencia |
|---|---|---|---|
| ddecpr | 84 | 49 | **−42%** |
| sgpr | 131 | 92 | **−30%** |
| gobernadora | 1,196 | 1,036 | −13% |
| aaa | 666 | 623 | −6% |

Con período **1D** el choque es máximo: Overview = AYER completo (52 menciones, gobernadora) vs modal = últimas 24h rolling (88): ventanas distintas por construcción.

---

## 1. Método

1. Snapshot de `origin/main @ 8a996a8` (el checkout local de main está stale/sucio; prod se despliega del remoto).
2. Lectura exhaustiva de: los 17 endpoints `/api/*` que sirven números, las agregaciones compartidas (`packages/shared/src/aggregations/sentiment-report.ts`, `metrics.ts`, `dates.ts`), los templates de correo, y el SPA completo (`apps/web/public/eco-prototype/*.js` — app, shell, screens, charts, data, chat-drawer).
3. Verificación cuantitativa contra la DB de producción reproduciendo las queries exactas de cada componente (solo SELECT). Queries y resultados en el Anexo.

Convención de citas: `ruta/al/archivo.ts:línea` con líneas de `origin/main @ 8a996a8`.

---

## 2. Causas raíz sistémicas

### R1 — Dos semánticas de ventana para el mismo selector de período

El chip "7D" del FilterBar significa cosas distintas según quién lo lea:

- **Semántica A (cerrada):** 7 días calendario **completos** en TZ `America/Puerto_Rico`, terminando **AYER** (`closedWindowYmdInTZ`, `packages/shared/src/dates.ts:82-92`). La usan: `/api/overview`, `/api/eco-data`, `/api/eco-geo`, `/api/exec-overview`, `/api/eco-insights`, `/api/eco-metric-insight`, `/api/ai/metric-insight`, `/api/eco-topic-description`, y los correos. El header incluso lo anuncia: "Datos al cierre de ayer" (`shell.js:422`).
- **Semántica B (rolling):** `published_at >= new Date() − N·24h`, **sin cota superior** — incluye HOY parcial y arranca a la hora actual de hace N días (`eco-mentions/route.ts:155-159`; también `alerts/history/route.ts:48-49` y `narrative/route.ts:85-87`). La usan: **todas las modales de drill-down** (`MentionsSliceModal` → `/api/eco-mentions`), el feed de menciones, el buscador ⌘K y el drawer "similares".

Consecuencia estructural: **cada click desde un agregado (A) abre una modal (B)**. La discrepancia es ~cero solo en rango custom, porque ahí ambos endpoints convergen a días AST — consistente con "cambia de acuerdo a las fechas seleccionadas".

Agravantes:

- **7 copias divergentes de `PERIOD_DAYS`**: `eco-geo/route.ts:14-18` y `alerts/history/route.ts:9-13` (con `2M`); `ai/metric-insight/route.ts:51-57`; `eco-topic-description/route.ts:44-47`; `exec-overview/route.ts:37-48`; **`eco-insights/route.ts:28-31` y `eco-metric-insight/route.ts:23-26` sin `Max`** → con el chip `Max`, los insights devuelven 400; **`narrative/route.ts:9-17` sin `7D`/`30D`** → esos chips caen silenciosamente a 730 días.
- **~10 defaults de período distintos en el SPA**: `app.js:242` → `'7D'`; `index.html:1417`, `getPeriodParams()` (`shell.js:65`), `fetchSliceMentions` (`screens.js:2640`), Geografía (`:2692`), AlertsHistory (`:3339`) → `'1M'`; Overview/exec/MetricInsightModal → `'7D'`. Además el CommandPalette setea `'1M'` (`shell.js:595`) que **no existe** en los chips del header (`shell.js:377`) → queda un período activo invisible.
- **3 estilos de cota superior** para la misma fecha final: `lte(published_at, 'T23:59:59.999-04:00')` (timestamp-ms, pierde los microsegundos finales del día), `(published_at AT TIME ZONE 'America/Puerto_Rico')::date <= $` (día completo), y `published_at <= endYmd+1 T04:00Z` (**incluye la medianoche del día siguiente**, `eco-topic-description/route.ts:172-174,274`).
- `period=custom` sin `from`/`to` → **30 días silenciosos** en `eco-data/route.ts:158`, `eco-geo/route.ts:88`, `alerts/history/route.ts:47`, `eco-mentions/route.ts:140`; pero **400** en `eco-insights`, `eco-metric-insight`, `exec-overview`, `ai/metric-insight`.
- `/api/ai/metric-insight` **no soporta `from`/`to`** (`ai/metric-insight/route.ts:143-152`) → en rango custom los KPI del Scorecard muestran "HTTP 400" en el modal de insight.
- Nadie recorta rangos custom a "ayer": `to=hoy` mezcla un día parcial con días cerrados.
- El filtro `day` de eco-mentions se **intersecta** con la cota rolling del período en vez de reemplazarla (`eco-mentions/route.ts:170-174,260-268`) → clickear el primer día de la ventana devuelve el día recortado a partir de la hora actual.

### R2 — El universo "pertinente" no está definido

`nlp_pertinence='baja'` se excluye en: `eco-mentions` (default, `route.ts:196-198`), `eco-geo/route.ts:99` *(nota: el propio eco-geo excluye baja, pero ver R7-pares #8: `D.MUNICIPALITIES` del boot y eco-geo divergen en otros filtros)*, y dentro de `eco-data` **solo** en MUNICIPALITIES/REGION (`route.ts:798`) y el feed MENTIONS/PULSE (`route.ts:919`).

Se **incluye** en: `buildSentimentReport` (todos los totales/tópicos del Overview y de los **correos diario y semanal**), `loadAggregatesForWindow` (KPIs del Scorecard, `metrics.ts:346-350`), el resto de `eco-data` (fuentes, emociones, heatmap, TOPICS, subtópicos, calendario), `eco-topic-description`, `ai/metric-insight`.

En la semana medida, `baja` es el **44% de DDEC** y el **43% de SGPR**: cualquier par card→modal difiere por decenas de puntos. La fórmula de crisis es internamente incoherente: excluye `baja` del denominador de `negShare` pero la incluye en el `totalMentions` que alimenta `crisisConfidence` (`metrics.ts:267-275`).

### R3 — Primario vs multi-clasificación, sin etiqueta

Conteo **primario** (cada mención cuenta una vez, bajo su tópico de mayor confianza, tie-break `confidence DESC NULLS LAST, topic_id ASC`): tabla de tópicos de Overview/correos (`sentiment-report.ts:240-245`), `eco-data` TOPICS.count y SENTIMENT_BY_TOPIC (`route.ts:439,518`), modal en modo default (`eco-mentions/route.ts:302-325`).

Conteo **multi/any-touch**: `eco-geo` (`route.ts:113`), `eco-topic-description` (`:273`), `ai/metric-insight` (`:247-255`), `eco-data` TOPICS.**evolution/delta** (`:677`), SUBTOPICS (`:609-612`), TOPIC_CALENDAR (`:744-745`), y el filtro `topic` de eco-mentions **cuando nadie manda `topicMode`** (default `'all'`, `route.ts:302`) — que es el caso de la tabla de menciones del TopicDetail, del feed /mentions y de /search.

Problemas concretos:

- `TOPICS[i].count` (primario) convive con `TOPICS[i].evolution/delta` (multi) **en el mismo objeto**: la flecha de tendencia describe otra métrica que el número al lado (`eco-data/route.ts:574` vs `:709-718`).
- **TopicDetail se contradice solo**: el hero muestra `topic.count` (primario) y la tabla de abajo `fetchSliceMentions` sin `topicMode` (multi) → total mayor, misma pantalla (`screens.js:2309` vs `:2637-2651`).
- `ai/metric-insight` divide conteos any-touch entre el total de todas las menciones → shares que pueden exceder 100% (`route.ts:240,262`); agrupa por **nombre** (no id).
- El "principal" del feed se elige en JS con `conf > existing.confidence` **sin tie-break** (`eco-data/route.ts:960-968`): en empate, el panel de detalle puede mostrar un tópico distinto al bucket donde se contó la mención.
- La suma de subtópicos puede exceder el total del tópico padre (multi sin dedup vs primario).

### R4 — Cuatro mapeos de sentimiento

Sobre las mismas dos columnas (`nlp_sentiment` español, `bw_sentiment` inglés):

1. `COALESCE(nlp,bw)` + prefijo `neg/pos/neu`, **NULL descartado** — totales de Overview/correos (`sentiment-report.ts:103-110,144`).
2. `COALESCE(nlp,bw)` + **igualdad exacta en español** — filas de tópico del mismo reporte (`sentiment-report.ts:234-236`) y `eco-data` TOPICS (`:510-512`).
3. `COALESCE(nlp,bw)` + `pillFromSentiment` bilingüe, **NULL → neutral** — `eco-mentions`, `eco-geo`, mayoría de `eco-data`.
4. **`nlp_sentiment` solo, sin fallback** — narrativas (`narrative/[id]/route.ts:69-71`, `narrative/[id]/day/route.ts:57`), con 4º bucket `sin_clasificar` propio.

Más: `metrics.ts:335` cuenta neutral con `IN ('neutral')` exacto. Y el **patrón residual** (`posPct = 100 − negPct − neuPct` o equivalente) en: barra de tópicos del SPA (`screens.js:4360-4372`), correo diario (`render-daily-report.ts:446-448`), `neutralPct` de eco-data (`:567`), `neg = max(0, 100−pos−neu)` en "Sentimiento por X" (`screens.js:1729`) — lo no reconocido se pinta en el bucket residual.

**Estado actual de los datos** (verificado en DB): `nlp_sentiment` está poblado al 100% y siempre en español, así que las convenciones 1–3 hoy coinciden *de facto* y los residuales no distorsionan. Es **fragilidad latente** — el día que el processor se atrase (NULL → fallback a `bw` inglés) o emita otro valor, splits y totales divergen silenciosamente en dashboard **y correos**. La convención 4 (narrativas) sí es divergencia activa.

### R5 — Fuentes duales, dos endpoints de insight y números fabricados

- `TIMELINE` del Dashboard sale de `daily_metric_snapshots`; el KPI "Volumen · período" al lado es `sum(TIMELINE)` client-side; `CURRENT_METRICS.totalMentions` sale de `mentions` crudas; y el modal del KPI recibe primero `m.totalMentions` y luego lo reemplaza con el valor de `/api/ai/metric-insight` → **tres números para el mismo KPI en un flujo** (`screens.js:452,336` + `shell.js:1501-1535`). Hoy snapshots y crudas cuadran (1,196 = 1,196 verificado), sin guardia que lo garantice.
- **Dos endpoints de insight para la misma métrica**: el Scorecard usa `/api/ai/metric-insight` (`shell.js:1527`; solo presets, 400 en custom, caché de sesión `eco.metricInsight.v3.<agency>.<metric>.<period>` **sin from/to** → insight stale al cambiar el rango custom) y el Overview/Sentiment usan `/api/eco-metric-insight` vía `openMetricInsightShared` (`screens.js:149-200`; sí acepta from/to desde Overview, pero **sin `Max`** → 400). Mismo concepto, dos contratos, dos fallos distintos.
- `nss7d/nss30d/brandHealthIndex/volumeAnomalyZscore` usan los **30 snapshots ANTERIORES al inicio de la ventana** (`metrics.ts:391-397`): con período 1A, el "NSS 7d" describe la semana previa a hace un año.
- `ai/metric-insight`: headline desde crudas, serie y baseline P25/P75 desde snapshots, baseline anclada al **inicio** de la ventana aunque el comentario dice fin (`route.ts:207,226`), LRU sin ventana en la clave (`:63-65,159`).
- **Números fabricados renderizados como datos** (lista completa en §4.4c): histograma "Volumen por hora" = senoide (+jitter en Tópicos) en 3 pantallas (`screens.js:272-275, 1574-1577, 2003-2007`), **nunca** reemplazado por datos reales (`shell.js:1204`); `splitSentiment()` reparte pos/neu/neg con **ratios hardcodeados** (`screens.js:2653-2664`) y se pinta en el modal de municipio (`:2713`) **teniendo eco-geo los valores reales**; texto "analítico" fijo en SentimentScreen ("deterioro acelerado por discurso sobre infraestructura vial…", `screens.js:1640-1642`); "78 municipios monitoreados" (`:2755`), "Por volumen · 30d" (`:540`), "Activaciones 30d" (`:3144`), "agencia DDEC" (`:3038`) hardcodeados.
- `INGESTION_STATUS` ("hace 3 min") es all-time y sin filtro de duplicados, junto a un PULSE que por ventana cerrada **nunca** muestra nada de hoy (`eco-data/route.ts:1017-1026,1074-1082`).
- **ChatDrawer**: el contexto que se envía al chat es el snapshot de `window.ECO_DATA` (boot de eco-data), no lo que la vista activa muestra (`chat-drawer.js:42-66`) → en Overview/Narrativas/Exec el asistente razona sobre números distintos a los visibles.

### R6 — Resolución de agencia y autorización inconsistentes

- **Fallback silencioso a "primera agencia activa"**: `eco-mentions/route.ts:146-150`, `eco-data/route.ts:165-172` (sirve datos con `AGENCIES_FULL` vacío), y toda la familia narrative. Otros endpoints devuelven 404/403/vacío — cuatro comportamientos, dos sirven datos no concedidos.
- `/api/alerts` (GET) ignora `?agency=` (resuelve solo de sesión) mientras `/api/alerts/history` honra el switcher (`alerts/route.ts:32-44` vs `alerts/history/route.ts:34`): reglas de una agencia con historial de otra.
- `/api/reports/preview` acepta `agencySlug` crudo con gate solo por rol (`reports/preview/route.ts:19-23`): un admin de X puede renderizar el reporte (con menciones) de Y.
- `narrative/[id]` consulta edges y narrativas vecinas **sin filtro de agencia** (`narrative/[id]/route.ts:114-124`).
- El `MetricInsightModal` del Scorecard prioriza `USER_AGENCY_SLUG` (JWT) sobre la agencia seleccionada (`screens.js:562`): un usuario staff que cambia de agencia ve el insight de su agencia original.

### R7 — El SPA no propaga el contrato de la card a la modal

`MentionsSliceModal` **nunca** recibe la ventana del dato de origen: siempre reconstruye `period/from/to` desde `localStorage` (`shell.js:1185-1192`) y **sobrescribe** los números de la card con lo que devuelva eco-mentions (`shell.js:1201-1204` — excepto `histogram`, que se queda con el sintético). El slug del tópico se resuelve con un **join por nombre** entre payloads de dos endpoints distintos (`screens.js:4141`) — si no matchea, el click es un no-op silencioso. `fetchSliceMentions` (TopicDetail) ni siquiera usa `getPeriodParams()`: con rango custom manda `period=custom` sin `from/to` → 30 días rolling silenciosos (`screens.js:2637-2651`). Y la pantalla de Narrativas ignora por completo el selector de período (consulta 730 días) mientras el header muestra los chips activos (`screens.js:4821` + `narrative/route.ts:57-58`).

---

## 3. Hallazgos priorizados

**P0 — el usuario lo ve hoy en flujos principales:**

| # | Hallazgo | Evidencia |
|---|---|---|
| P0-1 | Card (ventana cerrada) → modal (rolling): **todos** los drill-downs difieren; con 1D son ventanas casi disjuntas (52 vs 88, gobernadora) | R1; `eco-mentions/route.ts:155-159`; `shell.js:1185-1197` |
| P0-2 | Card (con `baja`) → modal (sin `baja`): −42% DDEC, −30% SGPR esta semana | R2; DB 2026-08-10 |
| P0-3 | Click en un día del chart: `day` se intersecta con la cota rolling → el primer día de la ventana llega recortado (chart 164 vs modal 92, gobernadora) | `eco-mentions/route.ts:170-174,260-268` |
| P0-4 | Overview tópico: 25 (+15) vs modal 9 vs toggle 19 — cuatro números irreconciliables en un flujo | R1+R2+R3; DB |
| P0-5 | TopicDetail: hero `count` primario vs tabla de menciones multi (`topicMode` ausente) **en la misma pantalla**; y con custom la tabla cae a 30d rolling silenciosos | `screens.js:2309,2637-2651`; `eco-mentions/route.ts:140,302` |
| P0-6 | Scorecard "Volumen · período": card=`sum(TIMELINE)`, placeholder del modal=`m.totalMentions`, valor final=`ai/metric-insight` — tres números para un KPI | `screens.js:452,336`; `shell.js:1501-1535` |
| P0-7 | Dos endpoints de insight para la misma métrica: Scorecard→`ai/metric-insight` (400 en custom; caché stale sin from/to), Overview/Sentiment→`eco-metric-insight` (400 con `Max`) | `shell.js:1519-1527`; `screens.js:149-200,1529`; R5 |
| P0-8 | `TOPICS.count` primario + `evolution/delta` multi en el mismo objeto: la tendencia no describe el número | `eco-data/route.ts:574,677,709-718` |
| P0-9 | Mapa municipal: doble conteo multi-municipio (+47%: 512 vs 349) y universo propio (sin baja) que no cuadra con el KPI vecino (1,196); further: burbuja cambia de número tras el primer fetch (boot eco-data vs eco-geo) | `eco-data/route.ts:782-837`; `screens.js:2736`; DB |
| P0-10 | MentionsScreen: QuickMetric "Total" (eco-data, cerrada+baja) y contador de la lista (eco-mentions, rolling−baja) **visibles a la vez, siempre distintos** | `screens.js:949,942` |
| P0-11 | Números fabricados como datos: histograma horario senoide(+jitter) ×3 pantallas (nunca reemplazado), `splitSentiment` con ratios fijos pintado en el modal de municipio (teniendo los reales), texto analítico hardcodeado en SentimentScreen | `screens.js:272-275,1574-1577,2003-2007,2653-2664,2713,1640-1642`; `shell.js:1204` |
| P0-12 | Chips `Max` → 400 en insights; `7D`/`30D` → 730 días silenciosos en narrativas; Narrativas ignora el período por completo | `eco-insights/route.ts:28-31`; `narrative/route.ts:9-17,57-58`; `screens.js:4821` |
| P0-13 | Feed del Dashboard excluye Twitter/X pero TOP_SOURCES lo muestra (fuente #1 posible con cero filas debajo) | `eco-data/route.ts:918` vs `:392-406` |
| P0-14 | Overview: click en tópico resuelve slug por **nombre** contra `D.TOPICS` (otro endpoint) — si no matchea, no-op silencioso; filas "Otros"/"Sin clasificar" no clickables sin explicación | `screens.js:4137-4154` |
| P0-15 | `narrative/[id]/day`: `totalMentions = rows.length` con `LIMIT 200` → total truncado que contradice el timeline | `narrative/[id]/day/route.ts:67,88` |
| P0-16 | Overview envía **dos totales distintos en un payload** (`totals.total` clasificadas-only vs `currentMetrics.totalMentions` COUNT(*)) y la UI usa uno u otro según el widget | `overview/route.ts:179-198`; `sentiment-report.ts:349-352` |

**P1 — visible en escenarios concretos / integridad de tenancy:**

| # | Hallazgo | Evidencia |
|---|---|---|
| P1-1 | Fallback a "primera agencia activa" sirve datos no concedidos (`eco-data`, `eco-mentions`, narrativas) | R6 |
| P1-2 | `/api/reports/preview` cross-tenant (gate por rol sin scope) | `reports/preview/route.ts:19-23` |
| P1-3 | Alertas: reglas (sesión) vs historial (switcher) pueden ser de agencias distintas; KPI "Activaciones · 24h" con `period=1D` hardcodeado y capado a 200 | `alerts/route.ts:32-44`; `screens.js:3097-3101` |
| P1-4 | `alerts/history` rolling intra-día vs feed de crisis de exec (cerrado, sin tope con custom) | `alerts/history/route.ts:48-49`; `exec-overview/route.ts:357` |
| P1-5 | `nss7d/nss30d/BHI/z-score` describen los 30 días **previos al inicio** de la ventana (no monótono al cambiar período) | `metrics.ts:391-397` |
| P1-6 | `eco-topic-description`: único endpoint **sin `is_duplicate=false`** + DDL en cada GET + sample con `LIMIT 1` sin `ORDER BY` | `eco-topic-description/route.ts:273-341,132,361-380,335-336` |
| P1-7 | Narrativas: sentimiento solo-NLP sin fallback; sparkline sin filtro de duplicados y con `CURRENT_DATE` (TZ del servidor); `mention_count` agregado irreconciliable con el sparkline | `narrative/[id]/route.ts:69-71`; `narrative/route.ts:126-137` |
| P1-8 | `ai/metric-insight`: mezcla crudas+snapshots en una card, baseline P25/P75 anclada al inicio, shares any-touch >100%, agrupa por nombre | `ai/metric-insight/route.ts:159,207-226,240-262` |
| P1-9 | MetricInsight del Scorecard usa la agencia del JWT, no la seleccionada | `screens.js:562` |
| P1-10 | Briefing IA insensible al período con cache fresca (<12h) pero sensible en fallback; eyebrow "hoy" sobre datos que terminan ayer; CTA "Ver menciones" puede abrir un tópico sin relación (`D.TOPICS[0]` como fallback del match por nombre) | `eco-data/route.ts:1096-1213`; `screens.js:324-330` |
| P1-11 | `similar_to` ignora la ventana pero el empty-state dice "Sin menciones similares **en el período**" | `eco-mentions/route.ts:165-168`; `shell.js:1011` |
| P1-12 | NSS regional = **media no ponderada** de NSS municipales (municipio de 2 menciones pesa como uno de 4,000) | `screens.js:2810-2844` |
| P1-13 | EmotionsCard: suma multi-emoción rotulada "menciones clasificadas" (sobre-cuenta) | `screens.js:1788-1894`; `eco-data/route.ts:852-879` |
| P1-14 | TopicCalendar: ventana propia `max(35,…)` días rotulada "período seleccionado"; celda any-topic+baja vs modal primary−baja (triple divergencia) | `eco-data/route.ts:730-731`; `screens.js:2461,2505` |
| P1-15 | ChatDrawer razona sobre el snapshot de eco-data, no sobre la vista activa | `chat-drawer.js:42-66` |
| P1-16 | TIMELINE (snapshots) vs KPI (crudas) sin guardia de reconciliación; período 1D sin snapshot → chart null con KPIs poblados | `eco-data/route.ts:243-268,1264` |
| P1-17 | `INGESTION_STATUS` all-time+duplicados junto a un PULSE que nunca muestra hoy | `eco-data/route.ts:1017-1026,1074-1082` |
| P1-18 | "Sentimiento por fuente" → modal: fallback `label.toLowerCase()` puede producir un `source` que el backend no reconoce → modal vacío sin error | `screens.js:1595-1598` |

**P2 — latentes / deuda de contrato:**

| # | Hallazgo | Evidencia |
|---|---|---|
| P2-1 | Splits español-exacto + residuales `100−a−b` (SPA, correo diario, eco-data): benigno HOY (NLP 100% en español, verificado), divergen si NLP se atrasa — lo no reconocido se pinta en el bucket residual (verde en la barra de tópicos) | `sentiment-report.ts:234-236`; `render-daily-report.ts:446-448`; `screens.js:4364,1729` |
| P2-2 | `metrics.ts` neutral exacto `IN ('neutral')`; NULL cuenta en total y en ningún bucket | `metrics.ts:334-336` |
| P2-3 | Cota superior familia-ms pierde microsegundos del final del día vs familia-fecha (PG µs vs JS ms) | `eco-data/route.ts:200` vs `metrics.ts:350` |
| P2-4 | Offset `-04:00` hardcodeado vs `AT TIME ZONE` (divergen si PR adoptara DST); riesgo off-by-one en `fullDate.toISOString().slice(0,10)` según cómo el driver devuelva `date` | `eco-data/route.ts:199-200,254`; `screens.js:276` |
| P2-5 | Defaults de período divergentes (~10 sitios) + token `'1M'` fuera de los chips del header | R1; `shell.js:377,595` |
| P2-6 | `TOPICS` LIMIT 12 sin tie-break: el corte y `TOPICS[0]` (alimenta el BRIEFING) pueden alternar entre requests | `eco-data/route.ts:543-544` |
| P2-7 | NSS en tres escalas bajo el mismo nombre (−100..100 global, −10..10 municipal, ×100 exec); BHI convertido `1+bhi*9` en 3 sitios del cliente | `metrics.ts:159`; `eco-geo/route.ts:168`; `exec-overview/route.ts:389`; `screens.js:342-344`; `charts.js:248`; `shell.js:1583` |
| P2-8 | `ALERTS` de eco-data con `priority/triggered/lastFired` hardcodeados; toggle "Activa" solo estado local | `eco-data/route.ts:1040-1042`; `screens.js:3152` |
| P2-9 | `bandToSeverity` y `crisisBand` duplicados (backend×2, SPA×1) | `exec-overview/route.ts:142-148`; `alerts/history/route.ts:16-22`; `screens.js:35-41` |
| P2-10 | Pisos visuales que mienten: 2% en emociones, 6% en barras de riesgo del Radar; `null` → 0 en sparkline de polarización; delta del chart "vs primer día" sin rotular | `screens.js:1860,5865,463`; `charts.js:264` |
| P2-11 | Rate limits 20–120/min sin criterio; sin limitador en `eco-geo`/alerts/diagnostics; `minStrength=NaN` → grafo vacío sin 400; `viralCount`/`fireStats` con deps `[]` (dependen del full-reload) | matriz §4; `screens.js:865,3101` |
| P2-12 | ⌘K chips: `(count/1000).toFixed(1)+'K'` incondicional → "0.1K menciones"; modal renderiza `0` literal cuando pos/neu/neg = 0 | `shell.js:613,1239` |
| P2-13 | Código muerto que confunde: `openKpiInsight`, `buildSliceMentions`, `SEED_USERS`, `splitSentiment` en Tópicos, `astDateKey`, imports sin uso, `parseCustomRange` de eco-data con contrato documentado que el handler ignora | `screens.js:237-257,2631-2633,3531-3538,2002`; `eco-data/route.ts:53-115` |
| P2-14 | Salud de clasificación (observación de datos, no bug de código): AAA sin `positivo` desde 2026-05-19; SGPR 12 positivos históricos — revisar clasificador/prompt | DB 2026-08-10 |

---

## 4. Matrices de referencia

### 4.1 Los dos endpoints del bug reportado

| Dimensión | `/api/overview` (+correos) | `/api/eco-mentions` (modal/feed/búsqueda) |
|---|---|---|
| Ventana preset | cerrada AST, termina AYER (`closedWindowYmdInTZ`) | rolling `now − N·24h`, **sin cota superior** |
| Ventana custom | días AST `[from, to]` inclusivos | días AST `[from, to+1)` — equivalente ✓ |
| `is_duplicate` | excluido ✓ | excluido ✓ |
| Pertinencia `baja` | **incluida** | **excluida** (default) |
| Tópico | primario top-confidence | primario **solo si** el caller manda `topicMode=primary` (la modal sí; TopicDetail/feed/search no) |
| Sentimiento | prefijo, NULL descartado (totales); español-exacto (filas de tópico) | bilingüe, NULL → neutral |
| Filtro `day` | n/a | intersectado con la cota rolling (recorta el primer día) |

### 4.2 Matriz interna de `/api/eco-data` (por dataset)

| Dataset | Ventana | Pertinencia | Tópicos | Sentimiento | Fuente |
|---|---|---|---|---|---|
| TIMELINE | cerrada (fecha) | n/a (pre-agregado) | — | columnas del snapshot | **snapshots** |
| CURRENT_METRICS | cerrada (fecha) + **30 snapshots pre-ventana** | incluye baja (totales) | — | exacto bilingüe, NULL fuera de buckets | híbrida |
| SENTIMENT_BREAKDOWN | cerrada (ts-ms) | incluye | — | bilingüe, NULL→neutral | crudas |
| TOP_SOURCES / SENTIMENT_BY_SOURCE | cerrada (ts-ms) | incluye | — | bilingüe NULL→neutral | crudas |
| SENTIMENT_BY_TOPIC | cerrada (ts-ms) | incluye | **primario** | bilingüe NULL→neutral | crudas |
| TOPICS.count / sentiment | cerrada (ts-ms) | incluye | **primario** (LIMIT 12 sin tie-break) | **español exacto + residual** | crudas |
| TOPICS.evolution/delta | **`max(35, 2·days)` días — fuera del rango del usuario**; delta sobre "últimos N elementos con datos", no días calendario | incluye | **multi** | — | crudas |
| SUBTOPICS | cerrada (ts-ms) | incluye | **multi sin dedup** | bilingüe NULL→neutral | crudas |
| TOPIC_CALENDAR | `max(35, min(days,365))` días | incluye | multi → top-1/día | bilingüe + neutral residual | crudas |
| MUNICIPALITIES / REGION | cerrada (ts-ms) | **excluye** | — | bilingüe NULL→neutral | crudas (multi-municipio: dobla conteo; NSS −10..10) |
| EMOTIONS | cerrada (ts-ms) | incluye | — | — | crudas (multi-emoción) |
| MENTIONS/PULSE (feed) | cerrada (ts-ms) | **excluye** | primario **JS sin tie-break** | bilingüe NULL→neutral | crudas (**excluye twitter**, LIMIT 50) |
| HOUR_HEATMAP | cerrada (ts-ms) | incluye | — | — | crudas |
| INGESTION_STATUS | **all-time** | incluye + **duplicados** | — | — | crudas |
| BRIEFING (IA) | **sin ventana** (última fila, TTL 12h) | n/a | — | — | tabla `agency_briefings` |
| BRIEFING (fallback) | mezcla TOPICS[0] + winCur | mezcla | mezcla primario/multi | mezcla | híbrida |

### 4.3 Resto de endpoints (resumen)

| Endpoint | Ventana | dup | baja | Tópicos | Notas |
|---|---|---|---|---|---|
| `eco-geo` | cerrada (ts-ms) | ✓ | excluye | **multi (EXISTS)** | NSS −10..10; sin LIMIT ni rate-limit |
| `eco-insights` / `eco-metric-insight` | cerrada (clave de cache) | (lambda) | (lambda) | — | solo tablas cache; **sin `Max`** → 400; semántica del texto no auditable desde la web app (la produce `eco-ai-tasks`) |
| `ai/metric-insight` | cerrada, **solo presets** | ✓ | incluye | **multi por nombre**, share>100% | crudas+snapshots mezcladas; LRU sin ventana; P25/P75 anclado al inicio |
| `eco-topic-description` | cerrada (cota `endYmd+1 00:00` incluida) | **✗ NO** | incluye | multi | DDL en GET; sample no determinista |
| `exec-overview` | cerrada | ✓ | incluye | primario (reusa sentiment-report) | crisis feed sin cota sup. con custom; ignora `?agency=` por diseño; `topicSlug` emitido es el nombre |
| `alerts` | sin ventana | n/a | n/a | — | GET ignora `?agency=` y no exige capacidad |
| `alerts/history` | **rolling intra-día** | n/a | n/a | — | custom solo si `period=custom`; errores → `{history:[]}` |
| `narrative` (lista) | rolling sobre `last_mention_at`; sparkline `CURRENT_DATE−29` (TZ servidor) | sparkline ✗ | ✗ | — | tabla agregada + crudas irreconciliables; mapa de períodos incompleto |
| `narrative/[id]` | **toda la vida** | ✓ | ✗ | — | sentimiento solo-NLP; edges sin filtro de agencia |
| `narrative/[id]/day` | día AST único | ✓ | ✗ | — | total = rows.length (LIMIT 200) |
| `reports/preview` | (lambda: 7d cerrados) | (lambda) | (lambda) | — | **cross-tenant por rol** |
| `admin/diagnostics` | sin ventana (por diseño) | incluye a propósito | incluye | multi | OK para diagnóstico; no comparable con el dashboard; distribuciones nlp/bw sin COALESCE y sin `'neutro'` en el mapa de acuerdo |

### 4.4 SPA — flujos card → modal y números client-side

**(a) Mecánica común.** `MentionsSliceModal` reconstruye SIEMPRE los parámetros desde `localStorage` (`agency` + `getPeriodParams()` + `_filter` + `topicMode` solo si hay tópico) y sobrescribe `volume/sentiment/mentions` de la card con la respuesta de eco-mentions; `histogram` nunca se reemplaza (`shell.js:1185-1204`). Ninguna card pasa su ventana real al modal.

**(b) Pares card → drill-down con fuente/ventana distinta** (los 18 identificados, orden por severidad):

| # | Origen (file:line) | Semántica origen | Semántica modal | Divergencia |
|---|---|---|---|---|
| 1 | Termómetro Overview (`screens.js:4229`) | overview: cerrada, con baja, NULL descartado | eco-mentions: rolling, sin baja, NULL→neutral | ventana+pertinencia+NULL (triple en "Neutral") |
| 2 | OverviewTopicos fila (`:4418`) | topicsTable primario | primary ✓ pero rolling−baja; slug por join de nombre | ventana+pertinencia (+no-op silencioso) |
| 3 | TopicCalendar celda (`:2573`) | any-topic, ≥35 días, con baja | primary, rolling, sin baja | triple + ventana fuera del período |
| 4 | TopicDetail hero vs tabla (`:2309` vs `:2637`) | primario cerrado | multi (sin topicMode), rolling; custom→30d | base de conteo + ventana en la MISMA pantalla |
| 5 | Scorecard Volumen (`:452,336`) | sum(TIMELINE snapshots) | m.totalMentions → valor de ai/metric-insight | tres números para un KPI |
| 6 | Scorecard Fuentes top (`:543`) | cerrada, con baja | rolling, sin baja | ventana+pertinencia |
| 7 | HourActivityCard celda (`charts.js:699`) | heatmap con baja | rolling sin baja | ventana+pertinencia |
| 8 | Mapa/eco-geo con filtro de tópico (`charts.js:826`) | any-topic, con baja (eco-geo no excluye en drill) vs `D.MUNICIPALITIES` sin baja | primary, sin baja | base+pertinencia; y la burbuja cambia tras el primer fetch (stale/fresh) |
| 9 | NSS regional (`:2832`) | media no ponderada de NSS municipales | modal sin NSS para contrastar | número no reproducible |
| 10 | Donut de sentimiento (`:1667`) | % sobre su propia suma | % implícito sobre total eco-mentions | denominadores distintos |
| 11 | Sentimiento por subtópico (`:1734`) | dedup top-confidence | EXISTS sin dedup | base de conteo |
| 12 | Sentimiento por fuente → modal (`:1595-1598`) | labels mapeados con fallback `toLowerCase()` | sourceCondition estricto | modal vacío sin error si el label cambia |
| 13 | MentionsScreen Total vs contador (`:949,942`) | eco-data cerrada+baja | eco-mentions rolling−baja | dos totales simultáneos |
| 14 | Briefing CTA "Ver menciones" (`:324-330`) | texto IA | tópico por match de nombre con fallback `D.TOPICS[0]` | drill-down potencialmente sin relación |
| 15 | KPI crisis Scorecard (`:437`) | eco-data cerrada | ai/metric-insight (400 en custom, caché stale) | otro endpoint, roto en custom |
| 16 | Crisis card Overview (`:4265`) | overview currentMetrics | eco-metric-insight con from/to ✓ | correcto en ventana, pero endpoint distinto al del Scorecard para la MISMA métrica |
| 17 | Overview hero vs highlights (payload único) | totals.total (clasificadas) | currentMetrics.totalMentions (COUNT(*)) | dos totales en una respuesta |
| 18 | MentionDrawer "Relacionadas" (`shell.js:827,1011`) | label "en el período" | similar_to ignora ventana | histórico completo rotulado como período |

**(c) Números sintéticos / presentados como reales** (los 24 del barrido, resumidos):

- Histograma "Volumen por hora" senoidal en Scorecard (`screens.js:272-275`), Sentiment (`:1574-1577`) y Tópicos con jitter (`:2003-2007`) — renderizado con tooltips por barra como si fuera un conteo; nunca sustituido por datos reales.
- `splitSentiment()` con ratios fijos (55/25/20, 22/28/50, 38/40/22) (`:2653-2664`), pintado en el modal de municipio (`:2713`) **ignorando** los valores reales que eco-geo ya devuelve; one-hot sintético en el termómetro (`:4073-4077`).
- Texto analítico hardcodeado en SentimentScreen (`:1640-1642`); "78 municipios monitoreados" (`:2755`, `app.js:159`); "Por volumen · 30d" (`:540`); "Activaciones 30d" (`:3144`); "agencia DDEC" (`:3038`).
- Pisos y coerciones visuales: 2% mínimo en emociones (`:1860`), 6% mínimo en Radar (`:5865`), `null`→0 en sparkline de polarización (`:463`), heatmap vacío reporta "Pico: Lun a las 0:00" (`:654-682`), residuales `100−a−b` (`:1729,4364`), delta del chart vs primer día sin rotular (`charts.js:264`).
- Layout de TopicBubbles con posiciones por jitter determinista — solo el radio codifica datos (`:2121-2145`).
- ⌘K: `(count/1000).toFixed(1)K` → "0.1K menciones" (`shell.js:613`); `0` literal renderizado (`shell.js:1239`).
- Código muerto que aparenta datos: `SEED_USERS` (`:3531`), `buildSliceMentions` (`:2631`), `openKpiInsight` (`:237`).

---

## 5. Plan de corrección propuesto

### Fase 1 — Contrato de ventana + universo (arregla el bug reportado)

1. **`@eco/shared` gana dos módulos canónicos:**
   - `resolveWindow({period, from, to, now})` → `{startYmd, endYmd, prevStartYmd, prevEndYmd}` con semántica cerrada-AST y **un único** `PERIOD_DAYS` exportado (incluye `Max` y valida custom). Todos los endpoints (incl. `eco-mentions`, `alerts/history`, `narrative`) lo consumen; los feeds que necesiten "hoy" lo piden explícito (`includeToday=1`), nunca por accidente.
   - `mentionUniverse()` → fragmento WHERE compartido (`is_duplicate=false` + política única de pertinencia + agencia) para que "menciones del período" sea UNA sola definición en todo el producto.
2. **`eco-mentions`:** ventana cerrada por default; `day` **reemplaza** la cota del período; custom inválido → 400 (no 30d silenciosos).
3. **Contrato card→modal:** todo slice lleva su ventana explícita (`_filter.from/to` copiados de `periodStart/periodEnd` del dato origen — `/api/overview` ya los expone; `eco-data` debe exponerlos) y su base de conteo (`topicMode`); `MentionsSliceModal` muestra en el header la ventana y el universo ("3–9 ago · solo principales · sin pertinencia baja") para que el número sea auditable a simple vista. `fetchSliceMentions` pasa a usar `getPeriodParams()` + `topicMode='primary'`.
4. **Un solo endpoint de insight por métrica**: consolidar `eco-metric-insight` y `ai/metric-insight` (o rutear uno al otro), con soporte de `from/to` + `Max`, y claves de caché que incluyan la ventana resuelta.
5. Unificar defaults de período (`'7D'` en una constante compartida SPA/server) y alinear los tokens del CommandPalette con los chips del header.

### Fase 2 — Convenciones de cálculo

6. **Sentimiento:** un solo helper SQL (`effectiveSentimentSql` + buckets bilingües + política NULL única) usado por sentiment-report, metrics, eco-data (4 variantes), narrativas (añadir fallback bw) y topd. Eliminar los residuales `100−a−b` (SPA, correo, eco-data): renderizar el 4º segmento "sin clasificar" si existe.
7. **Tópicos:** fragmento SQL compartido del primario (tie-break canónico); `TOPICS.evolution/delta` a primario (y delta sobre días calendario, no "elementos con datos"); picker JS del feed con el mismo tie-break; `ai/metric-insight` agrupa por id con denominador coherente; los componentes any-touch (geo, topd, calendario) declaran `countingMode` en el payload y el UI lo rotula.
8. **Snapshots:** baseline P25/P75 anclada al fin de ventana; guardia de reconciliación TIMELINE vs crudas (log/alerta si divergen >1%); decidir si "Volumen · período" del Scorecard usa la misma fuente que `CURRENT_METRICS`.
9. **Basura sintética fuera:** eliminar los 3 histogramas senoidales (o reemplazarlos por la distribución horaria real — el heatmap ya la tiene), `splitSentiment` → usar los valores reales de eco-geo, borrar el texto hardcodeado de SentimentScreen y los labels fijos ("30d", "DDEC", "78 municipios"), NSS regional ponderado por volumen.
10. `eco-topic-description`: `is_duplicate=false`, DDL a migración, `ORDER BY confidence DESC` en el sample. `narrative/[id]/day`: `COUNT(*)` real. Narrativas: honrar el período o rotular explícitamente "histórico completo".

### Fase 3 — Guardrails permanentes

11. **Test de contrato** (script QA reutilizable): para una agencia+ventana fijas, consulta todos los endpoints y verifica identidades (`Σ topicsTable = totals.total`; `modal(topic,primary) = fila`; `Σ TIMELINE = KPI volumen`; `modal(day) = datapoint`; `hero de TopicDetail = total de su tabla`; etc.). Correr en CI con fixtures y nightly contra prod (solo lectura). Las queries del Anexo son la semilla.
12. **Tenancy:** eliminar fallbacks a "primera agencia activa" (respuesta vacía o 404 uniforme); scope de tenant en `reports/preview`; `alerts` GET honra `resolveAgencyId`; filtro de agencia en edges de `narrative/[id]`; MetricInsightModal usa la agencia seleccionada.
13. Normalizar rate limits, caps y validación (`minStrength`, custom sin from/to → 400 uniforme); eliminar código muerto (P2-13); ChatDrawer recibe el contexto de la vista activa.

### Orden sugerido de PRs

1. **PR-A (P0 core):** `resolveWindow` + `mentionUniverse` + eco-mentions cerrado + `day` override + contrato card→modal con ventana visible en el header del modal. *Cierra el bug reportado.*
2. **PR-B:** consolidación de insight endpoints + defaults de período + fixes de fetchSliceMentions/TopicDetail/MentionsScreen.
3. **PR-C:** sentimiento/tópicos unificados + residuales fuera + correos (⚠️ cambia números de correos → avisar al cliente).
4. **PR-D:** sintéticos fuera + labels + NSS regional + narrativas.
5. **PR-E:** tenancy/authz (puede ir en paralelo, es independiente).
6. **PR-F:** test de contrato en CI + nightly.

---

## 6. Decisiones de producto requeridas (bloquean la Fase 1)

1. **¿"7D" incluye HOY?** Recomendación: **no** — todo agregado y todo drill-down desde un agregado usa días cerrados terminando ayer (paridad con correos, números estables durante el día, ya anunciado en el header "Datos al cierre de ayer"). El feed de menciones y el buscador ⌘K son la excepción explícita ("en vivo"), etiquetada en el UI.
2. **¿El universo estándar excluye pertinencia `baja`?** Recomendación: **sí, en todo** (dashboard + modales + correos) — "menciones pertinentes" como métrica de producto, con toggle global "incluir baja pertinencia" para auditoría. ⚠️ Cambia los números de los correos que el cliente ya recibe (−6% a −44% según agencia/semana): comunicarlo como mejora de calidad con nota en el primer correo tras el deploy.
3. **¿Drill-down default primario o multi?** El default de la modal (primario + toggle) es correcto; falta aplicar la MISMA base al resto (TopicDetail, geo, topd, ai-mi, evolution, calendario) o etiquetarla visiblemente donde sea any-touch.
4. **Escala canónica del NSS** (−100..100 sugerida) y del BHI (una sola conversión, server-side); conversión solo en render.

---

## Anexo — Verificación en DB (2026-08-10 ~14:42 AST)

Método: `aws lambda invoke --function-name eco-migration --payload '{"action":"custom-query","query":"SELECT …"}'` (solo lectura). Las queries replican letra a letra los WHERE de cada componente.

**A. Caso reportado (DDEC, 7D = 2026-08-03…09, tópico "Gestión del Secretario"):**

| Medida | Valor |
|---|---|
| Fila Overview (cerrada, primario, con baja) | 25 |
| Modal default (rolling, primario, sin baja) | 9 |
| Misma ventana sin baja (efecto pertinencia aislado) | 9 |
| Rolling con baja (efecto ventana aislado) | 25 |
| Modal "incluir secundarias" (rolling, multi, sin baja) | 19 |
| Multi cerrada con baja (base del "+15 tocan": 40−25) | 40 |
| Total agencia ventana: KPI Volumen y hero | 84 y 84 (hoy cuadran) |
| Pertinencia `baja` en ventana | 37 (44%) |

**B. Totales 7D por agencia** (cerrada+baja vs rolling−baja): ddecpr 84/49, sgpr 131/92, gobernadora 1,196/1,036, aaa 666/623.

**C. Período 1D y day-slice (gobernadora):** Overview 1D (ayer completo) = 52 vs modal rolling 24h = 88; primer día de la ventana 7D: chart = 164 vs modal = 92 (recorte por la cota rolling a las ~14:42).

**D. eco-data internos (gobernadora, 7D):** KPI volumen 1,196 = Σ TIMELINE 1,196 (7/7 snapshots, hoy sin drift); mapa municipal Σ barras 512 vs 349 menciones únicas geo-etiquetadas (+47% doble conteo); universo del feed (sin baja, sin twitter) 1,023.

**E. Datos de sentimiento:** `nlp_sentiment` 100% poblado, 100% español (tres valores), sin NULL — sobre todo el histórico activo. AAA sin `positivo` desde 2026-05-19; SGPR 12 positivos históricos.
