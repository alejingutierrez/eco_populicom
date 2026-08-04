# Menciones — rediseño, nube de palabras y funciones nuevas

Apéndice de [`auditoria-diseno-2026-07.md`](auditoria-diseno-2026-07.md). Tres especificaciones: el rediseño de la pantalla, el **backend** de la nube de palabras (extracción y puntuación de términos) y su **render** e interacción.

---

# Menciones — rediseño de la pantalla y funciones nuevas (§8 del informe)

## Resumen

Menciones no es una pantalla mal maquetada: es un explorador de consultas disfrazado de tabla de metadatos. La consulta del usuario está repartida en cinco superficies que no se hablan (header con período, dos buscadores, chips, popover, ⌘K), el resultado no lleva su propio resumen (los 5 KPI vienen de otro endpoint y no reaccionan a ningún filtro: screens.js:948-963 vs 818-847) y la fila entrega los campos que menos sirven mientras el API ya manda `summary` (100% poblado en DDEC), `image` (61.7%) y esconde `impact`/`potentialAudience` (83.6%/81.5%). Medí el caso que lo resume todo: el 21 de julio DDEC tuvo 26 menciones visibles, 22 negativas — y **15 de esas 26 filas son la MISMA nota de cable de AP** replicada en 14 medios (16 filas, 12 `text_hash` distintos porque el hash incluye el snippet y cada medio pone su propio lede; engagement 0 en todas, audiencia potencial 21.3M). El feed convirtió un hecho en quince, y el 68% de la negatividad de ese día es una sola nota. A escala: 27.8% de las menciones de DDEC en 30 días tienen un casi-gemelo a distancia coseno <0.10 y el 100% tiene embedding, o sea que la materia prima para arreglarlo ya está en la tabla. La decisión de fondo: convertir /mentions en una **consulta de primera clase** — un solo campo de búsqueda, filtros con una gramática, un resumen que se recalcula con el mismo WHERE que la lista, una fila que agrupa historias en vez de repetirlas, y la consulta guardable, exportable, permalinkeable y convertible en alerta. /search deja de existir como pantalla (es /mentions con `q`) y los tres modos de vista bajan a dos. Todo cabe en el contrato actual de `/api/eco-mentions` más un parámetro `facets=` y una columna `story_id`.

## 8.1 Diagnóstico

Los 24 hallazgos MEN-01…MEN-24 del catálogo describen los síntomas. Debajo hay seis fallas estructurales; las cito con línea y con medición nueva (consultas `custom-query` contra producción, DDEC, ventana 30 días, n=676, 2026-08-03).

**D1 · La consulta no existe como objeto.** Los criterios que producen la lista viven en cinco lugares sin dueño: período en `localStorage` vía `ecoGetPeriodParams()` (shell.js:64-76) a ~600px del resultado, `q` en `queryInput` con debounce 300ms (screens.js:805-811), sentimiento/fuente en chips y `<select>` (screens.js:892-900), tópico/región/orden escondidos en un popover (screens.js:905-938), y un sexto canal muerto: `mentionsFilter` llega como prop (app.js:391) y `MentionsScreen` no lo lee — los 5 comandos del ⌘K prometen filtrar y no filtran (F28). Consecuencia: la consulta no se puede citar, guardar, compartir, exportar ni convertir en alerta, y la URL nunca la refleja.

**D2 · El resultado no lleva su propio resumen.** Las 5 `QuickMetric` leen `D.CURRENT_METRICS` (screens.js:949-963) — payload global de `/api/eco-data` — mientras la lista refetchea `/api/eco-mentions` (screens.js:818-847). Filtrar «Negativo» cambia la lista y no mueve ninguna de las cinco cifras (MEN-02); y sin filtros ya se contradicen (MEN-01) porque `/api/eco-data` no excluye pertinencia baja y `/api/eco-mentions` sí (route.ts:190-198). **Medido: de 676 menciones DDEC, 259 son `nlp_pertinence='baja'` — el 38.3% del universo se descarta en silencio.** La banda de métricas no está rota: está conectada al universo equivocado.

**D3 · La fila muestra los campos que menos sirven.** El API ya serializa `summary`, `image`, `avatar`, `topicConfidence`, `subtopics`, `region`, `coords` (route.ts:499-533) y la vista Lista usa cinco: icono, título, autor·dominio, sentimiento, tópico, relativo. Población medida en DDEC: `nlp_summary` **676/676 (100%)**, `resolved_image_url` **417 (61.7%)**, `monthly_visitors>0` **624 (92.3%)**, `impact>0` **565 (83.6%)**, `potential_audience>0` **551 (81.5%)**, `embedding` **676 (100%)**, `author_avatar_url` 57 (8.4%), `language<>'es'` **77 (11.4%)**, `bw_city`/`bw_region` **0 (columnas muertas — no especificar filtros sobre ellas)**. Y `has_image=true` sólo en 66 filas contra 417 con imagen resuelta: **el flag está desincronizado, la miniatura debe condicionarse a `resolved_image_url IS NOT NULL`, nunca a `has_image`.**

**D4 · La sindicación se presenta como volumen.** El dedup exacto (`text_hash` = sha256 de `normalizeText(title+' '+snippet)`, processor/index.ts:171-181) no puede colapsar una nota de cable porque cada medio publica su propio lede. Caso medido, DDEC, 2026-07-21: la nota «Two of Puerto Rico's top government officials to step down as corrupti…» aparece en **16 filas, 12 `text_hash` distintos, 14 dominios, 11 snippets distintos; 15 de las 16 pasan los filtros del feed; todas negativas; `engagement_score = 0` en todas; `potential_audience` máx 21,267,076.** Ese día DDEC tuvo 26 menciones visibles y 22 negativas: **15/26 (58%) del feed y 15/22 (68%) de la negatividad del día son una sola nota.** Densidad general con pgvector sobre las 658 menciones DDEC con embedding: vecino más cercano <0.05 en 88 (13.4%), **<0.10 en 183 (27.8%)**, <0.15 en 266 (40.4%), <0.20 en 327 (49.7%). Más de una de cada cuatro filas tiene un casi-gemelo. Nota adicional: con engagement 0 en todo el cable, `sortBy=engagement` es **ciego a las noticias** — el único eje que las distingue (`potential_audience`) no se muestra ni se puede ordenar.

**D5 · Dos pantallas para una tarea.** `SearchScreen` (screens.js:1265-1507, ~240 líneas) comparte fetch (línea 1339 vs 838), facetas, tres vistas, paginación y estados con `MentionsScreen`, y divergen en doce detalles (dónde vive «Ordenar», conteos en los chips, copy de error, si la paginación sobrevive al error). Dos buscadores con el mismo `.input` a ~190px de distancia y ámbitos distintos (MEN-16): el del header te saca de la pantalla y descarta los filtros puestos.

**D6 · Controles muertos.** (a) **Densidad configurable no existe de punta a punta**: `TweaksPanel` se exporta (shell.js:1765) y **nunca se monta**; `const [density] = useState(...)` sin setter (app.js:187); `data-density` se estampa (app.js:325, :364) y **`index.html` tiene 0 reglas `[data-density]`**. (b) El fetch de «Virales» declara deps `[]` (screens.js:865) contra su propio comentario: no reacciona a período ni agencia, y es el único que no usa `ecoFetchAuthed` (línea 860) → un 401 se dibuja como «0». (c) «Limpiar filtros» (screens.js:933) sólo limpia topic/region/sortBy. (d) Lista y Tabla son la misma cosa (MEN-17).

---

## 8.2 Arquitectura de información nueva

**Modelo mental:** `/mentions` es un **explorador de consultas**. Una consulta = `{ventana, texto, filtros, orden, agrupación}`. Todo lo que la pantalla muestra debajo de la barra se deriva de esa consulta y de nada más.

| Zona | Contenido | Regla dura |
|---|---|---|
| **A · Cabecera de consulta** (sticky, 1 `.card`) | Campo único de búsqueda · chips de filtro activos removibles · botón «Filtros» (panel, no popover) · contador `aria-live` · acciones de consulta: Guardar vista / Exportar / Crear alerta / Copiar enlace | Todo criterio activo es visible como chip removible. Nada que filtre puede vivir cerrado. |
| **B · Resumen del resultado** (1 `.card`, 3 pestañas) | 4 cifras reactivas + pestañas `Tiempo · Palabras · Fuentes`. Debajo, una línea de contexto **no reactiva** rotulada «Período completo, sin filtros: engagement rate X · velocidad Y» | Ninguna cifra en la banda reactiva puede provenir de otro endpoint que la lista. Si no se puede recalcular con el mismo WHERE, va a la línea de contexto y se rotula. |
| **C · Resultados** | 2 modos (Compacta / Lectura) · agrupación de historias · teclado j/k/o/x · selección múltiple · paginación | Una sola implementación de fila (`MentionRow`) para los dos modos y los tres contenedores (pantalla, slice modal, drawer «parecidas»). |
| **D · Detalle** | `MentionDrawer` existente (shell.js:805) + «parecidas a esta» promovido a consulta | El drawer no introduce campos que la fila no pueda mostrar en hover o en modo Lectura. |

### Decisiones explícitas

**1. Fusión con /search: SÍ, /search deja de ser pantalla.** Es el estado «con `q` y sin filtros» de `/mentions`. Implementación mínima, sin tocar el router: `app.js:351` pasa a `search: MentionsScreen`; `SCREEN_META.search` se conserva sólo para el título del header; `ROUTES.search='/search'` (app.js:103) queda como alias que hidrata `q`. `MentionsScreen` ya recibe `searchQuery`, `setSearchQuery`, `mentionsFilter`, `setMentionsFilter`, `setActive` (app.js:389-396): sólo hay que consumirlos. La diferencia entre «buscar» y «explorar» pasa a ser **un bloque de estado vacío** (recientes + tópicos frecuentes, screens.js:1379-1415 se recicla), no una pantalla. Borra ~240 líneas y las doce divergencias. El buscador del header se convierte en **botón disparador** («Buscar en todo · ⌘K», sin `input`) que navega a `/mentions?q=` **preservando los filtros activos**.

**2. Modos de vista: 3 → 2.** `compact` (tabla única, cabecera sticky, columnas configurables, `.scroll-x`) y `reading` (cards con miniatura + resumen IA). Migración de `localStorage`: `list|table → compact`, `cards → reading`; persistencia **por breakpoint** (`eco.viewMode.desktop` / `eco.viewMode.mobile`, default `reading` en móvil — cierra MEN-05 y MEN-17). `VIEW_MODES` (screens.js:717-721) queda con dos entradas.

**3. Nube de palabras: pestaña 2 de la Zona B, no card al final.** Es un resumen del resultado, así que se alimenta del **mismo subconjunto filtrado** (`facets=terms`) y su clic **añade el término a `q`** (filtra en sitio), nunca navega. En móvil, la pestaña existe pero arranca en `Tiempo`. Contrato de datos que debe cumplir quien la especifique (otras dos unidades): `facets.terms = [{ term, n, neg }]`, top 60, sobre el mismo `whereClause`; **debe segmentar por `language`** o mezclará los 11.4% de contenido en inglés con el español. Ruta SQL recomendada: `to_tsvector('spanish', title||' '||snippet)` + `ts_stat` sobre una materialización de los ids ya filtrados (`ts_stat` recibe SQL como literal: no se le puede pasar el WHERE parametrizado — hay que materializar primero).

**4. La fila de métricas se queda, baja a 4 y se hace reactiva.** Sólo cantidades **aditivas sobre cualquier subconjunto**, todas de una consulta: `Total` (= `data.total`, misma fuente que la lista → cierra MEN-01), `Interacciones` (Σ likes+comments+shares), `Audiencia potencial` (Σ `potential_audience`, 81.5% poblado), `Virales` (COUNT engagement ≥ umbral, con denominador: «12 · 2.9% del total»). Salen de la banda: **Engagement rate** (razón, no aditiva: comparar la de un filtro con la del período engaña) y **Velocidad** (es el delta de Total, MEN-10). Ambas bajan a la línea de contexto rotulada «Período completo, sin filtros». Rejilla 4/2/2 (cierra MEN-22) y `Virales` deja de ser `tone="neg"` (MEN-11).

**5. La consulta es la URL.** `/mentions?q=…&sentiment=negativo&source=news&from=…&to=…&group=story&sort=audience`. `history.replaceState` en cada cambio (el patrón ya existe en screens.js:1314). Sin esto, ninguna de las funciones nuevas (vista guardada, export, alerta, comparar) tiene de dónde leer la consulta.

---

## 8.3 Funciones nuevas, priorizadas

| ID | Función | Problema del analista | Datos | Coste | Backend |
|---|---|---|---|---|---|
| MN-1 | Resumen reactivo (`facets=summary`) | «Filtré negativo y el alcance no cambió» | existen | S | sí |
| MN-2 | Histograma temporal con brushing (`facets=day`) | «¿cuándo pasó esto y cómo veo sólo el pico?» | existen | M | sí |
| MN-3 | Agrupar casi-idénticas (`group=story`) | 15 filas para una nota | `text_hash`, `embedding` (100%) | M | sí |
| MN-4 | Fecha absoluta + miniatura + resumen IA en la fila | no se puede citar ni escanear | `resolved_image_url` 61.7%, `nlp_summary` 100% | S | sí (2 campos) |
| MN-5 | Triage por teclado `j/k/o/x/f` | 41 páginas a golpe de ratón | — | S | no |
| MN-6 | Fusión /search → estado de /mentions | dos buscadores, dos pantallas | — | M (−240 líneas) | no |
| MN-7 | Permalink de consulta | nada es compartible | — | S | no |
| MN-8 | Exportar respetando filtros | el CSV exporta 20 filas y fecha relativa | existen | S | sí (ruta) |
| MN-9 | Vistas guardadas + vista→alerta | rearmar el mismo filtro cada mañana | tabla nueva | M | sí |
| MN-10 | «Parecidas a esta» como consulta | `similar_to` sólo vive en el drawer | `embedding` 100% | S | casi no |
| MN-11 | Destacadas por impacto/audiencia | engagement=0 en noticias → orden ciego | `impact`, `potential_audience` | S | sí (orden) |
| MN-12 | Selección múltiple + acciones en lote | 25 decisiones, 25 clics | — | M | parcial |
| MN-13 | Marcar leído / no leído | no hay memoria entre sesiones | tabla nueva | M | sí |
| MN-14 | Filtros faltantes (autor, dominio, idioma, sin clasificar, subtópico, municipio, emoción) | el API los soporta y la UI no los ofrece | existen | S | no (2 nuevos) |
| MN-15 | Declarar exclusiones + toggle | el feed oculta el 38.3% en silencio | existen | XS | no |
| MN-16 | Densidad (resucitar el control muerto) | filas de 56px en pantalla de 7,000px | — | XS | no |
| MN-17 | Comparar dos consultas lado a lado | «¿Facebook vs Noticias?» | existen | L | no |

### MN-1 · Resumen reactivo — P0, S, backend sí
Un solo agregado sobre el `whereClause` ya construido (route.ts:369), en el mismo request:
```sql
SELECT COUNT(*)::int AS total,
       COALESCE(SUM(likes+comments+shares),0)::bigint AS interactions,
       COALESCE(SUM(potential_audience),0)::bigint AS audience,
       COUNT(*) FILTER (WHERE engagement_score >= $viral)::int AS viral,
       COUNT(*) FILTER (WHERE nlp_sentiment IS NULL AND bw_sentiment IS NULL)::int AS unclassified,
       COUNT(DISTINCT domain)::int AS domains
  FROM mentions WHERE <whereClause>
```
Se devuelve como `facets.summary`. Mata el fetch separado de virales (screens.js:852-865) con sus tres defectos (deps `[]`, `fetch` crudo, 0 silencioso). El umbral viral deja de ser la constante 5000 (screens.js:705) y pasa a `percentile_disc(0.95)` del período, rotulado «top 5% por engagement» (cierra MEN-23).

### MN-2 · Histograma con brushing — P0, M, backend sí
Barra de 72px sobre la lista, una barra por día en TZ PR, apilada negativo/resto, sobre **los resultados filtrados**. Arrastrar selecciona un rango → escribe `from`/`to` (ya soportados, route.ts:31-43) y añade un chip «21–23 jul ×». Clic en barra = `day=YYYY-MM-DD` (ya soportado, route.ts:260-268).
```sql
SELECT (published_at AT TIME ZONE 'America/Puerto_Rico')::date AS d, COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE COALESCE(nlp_sentiment,bw_sentiment) IN ('negativo','negative'))::int AS neg
  FROM mentions WHERE <whereClause> GROUP BY 1 ORDER BY 1
```
Contrato de huecos (F4): el cliente hace `LEFT JOIN` contra `generate_series` de la ventana; **día con 0 menciones = 0 explícito; día sin ingesta = `null` y se dibuja como hueco**, no como cero. Sustituye el uso del heatmap sintético `Math.sin(...)` (F17) en esta pantalla. Sin librerías: son ~40 líneas de `<rect>` SVG con `onPointerDown/Move/Up`.

### MN-3 · Agrupar casi-idénticas — P0, M, backend sí (la función de mayor retorno)
UI: la historia colapsa en **una fila** con la mención de mayor `potential_audience` como cabeza y un badge `↻ 14 medios` en `--accent`; el badge expande in-situ una sub-lista indentada de `dominio · hora · enlace` (no abre modal). El contador de página cuenta **historias**, y debajo: «26 menciones · 12 historias». Los chips de sentimiento siguen contando menciones, con nota «(15 de las 22 negativas son 1 historia)» cuando una historia supera el 25% de un bucket.

Backend, dos etapas:
- **Interim (S)**: `group=story` sobre-obtiene `limit*4`, agrupa por `text_hash` y por coseno <0.10 dentro de la página, y recorta a `limit`. Los conteos son aproximados: hay que rotularlo «≈».
- **Definitivo (M)**: columna persistida.
```sql
ALTER TABLE mentions ADD COLUMN IF NOT EXISTS story_id uuid;
CREATE INDEX IF NOT EXISTS idx_mentions_story
  ON mentions(agency_id, story_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_embedding_ivf
  ON mentions USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);
```
Asignación en `eco-processor`, justo después de calcular el embedding: vecino más cercano de la misma agencia con `published_at` dentro de ±72h y distancia `<0.10` → hereda su `story_id`; si no hay, `story_id = id`. Umbral 0.10 elegido con la medición (27.8% agrupa; 0.15 sube a 40.4% y empieza a juntar temas distintos — el mismo riesgo que hundió las narrativas con eps 0.19/0.22). El índice ivfflat es obligatorio: sin él `<=>` es seq-scan y repetiría el O(n²) de `eco-narrative-cluster`. Backfill: acción nueva `backfill-story-ids` en `eco-migration` (patrón del CLAUDE.md: descargar bundle, editar, `node --check`, re-zip, `update-function-code`; verificar el efecto con `custom-query`, nunca confiar en «completed successfully»).
Nota de corrección para el dedup exacto: `SELECT id FROM mentions WHERE text_hash=$1 AND agency_id=$2 LIMIT 1` (processor:177) no lleva `ORDER BY published_at` ni `AND is_duplicate=false`, así que `duplicate_of_id` apunta a una fila arbitraria y se pueden formar cadenas. Para cualquier agrupación, **agrupar por `text_hash`** (índice `idx_mentions_text_hash` ya existe), no por `duplicate_of_id`.

### MN-4 · Fecha absoluta, miniatura y resumen IA en la fila — P0, S
`publishedAt` deja de ser string relativo (route.ts:519): se devuelven `publishedAtIso` (ISO) y `publishedAtLabel` (relativo, recalculado en cliente). La vista Compacta muestra absoluto «21 jul, 3:14 PM» con relativo como segunda línea; el CSV exporta ISO (hoy escribe «hace 6 h» bajo la cabecera «Fecha», shell.js:1429-1432). Miniatura 56×40 condicionada a `image` con placeholder reservado siempre (evita el desalineado de MEN-13). `summary` (100% poblado) aparece como segunda línea en modo Lectura y en hover en Compacta.

### MN-5 · Triage por teclado — P0, S
`j`/`k` mueven el foco, `o`/`Enter` abren el drawer, `x` marca/desmarca selección, `f` enfoca el buscador, `Esc` cierra. La fila pasa a `role="button" tabIndex={0}` con `:focus-visible` (el outline con `--accent` existe en index.html:191-195). Cierra MEN-24 y hace usable el flujo «revisar las 26 de hoy» sin ratón.

### MN-8 · Exportar respetando filtros — P1, S, backend sí
Hoy sólo el slice modal exporta, y sólo las ≤20 filas cargadas. Ruta nueva `GET /api/eco-mentions/export` que reusa el mismo constructor de `whereClause`, `limit` 5,000, respuesta `text/csv` en streaming, columnas: `published_at_iso, published_at_pr, title, snippet, summary, author, domain, source, page_type, sentiment, pertinence, topic, subtopics, municipality, region, language, likes, comments, shares, engagement_score, impact, potential_audience, monthly_visitors, story_id, url`. BOM UTF-8 (ya lo hace shell.js:1434) y nombre `eco-<agencia>-<from>_<to>.csv`. Encabezado del archivo: una primera línea de comentario con la consulta canónica, para que el CSV sea auditable.

### MN-9 · Vistas guardadas + vista→alerta — P1, M, backend sí
El botón «Crear alerta» del slice modal (shell.js:1445-1477) ya prueba que `POST /api/alerts` acepta un filtro (`config.type` debe estar en `KNOWN_CONFIG_TYPES`, alerts/route.ts:10). Falta persistir la consulta:
```sql
CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_sub varchar(255) NOT NULL,
  name varchar(120) NOT NULL,
  params jsonb NOT NULL,
  is_shared boolean NOT NULL DEFAULT false,
  alert_rule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_sub, updated_at DESC);
```
`user_sub` = Cognito sub, mismo patrón que `chat_conversations` (chat.ts:18) para no depender del aprovisionamiento JIT de `users`. DDL por self-heal idempotente (patrón `ensureReportsSchema`). UI: menú «Vistas» en la Zona A con las guardadas del usuario + «Guardar esta consulta» + «Convertir en alerta» (reusa el POST existente, guarda `alert_rule_id` para poder mostrar «esta vista ya alerta»).

### MN-10 · «Parecidas a esta» como consulta de primer nivel — P1, S
`similar_to` ya existe con fallback a tópico (route.ts:550-756) y el 100% de las menciones tiene embedding. Promoverlo: acción en la fila (hover) y chip «Parecidas a: “DDEC anuncia…” ×» en la Zona A. Falta en el backend: `total`, `offset`, y **devolver la distancia** para poder cortar (`similarMax=0.25` por defecto) y para rotular «similitud 0.94». Hoy la rama devuelve `total: out.length` (route.ts:750) y `sentiment: {0,0,0}` — con `facets=summary` eso se corrige gratis.

### MN-11 · Destacadas por impacto y audiencia — P1, S
`sortBy` gana `impact` y `audience`; la fila expone `potentialAudience` como columna numérica (`--ff-numeric`) — es el único eje que separa un cable de 21.3M de audiencia de un tweet con 3 likes, y hoy no existe en la UI. Y como `engagement_score=0` en las 16 filas del cable medido, ordenar por engagement **entierra la noticia más grande del día**: por eso `audience` debe ser el orden por defecto cuando `source=news`. Además una tira «Destacadas» opcional en la Zona B: top 3 por `impact` del subconjunto, con su historia agrupada.

### MN-12/MN-13 · Selección múltiple y leído — P1, M
Checkbox por fila (aparece en hover, siempre visible con selección activa) + barra de acciones flotante: «Exportar selección», «Marcar leídas», «Crear alerta con estas», «Copiar citas» (título + medio + fecha absoluta + URL, formato memo). Estado de lectura:
```sql
CREATE TABLE IF NOT EXISTS mention_reads (
  mention_id uuid NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  user_sub varchar(255) NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mention_id, user_sub)
);
```
`readState=unread|read` como filtro y opacidad 0.7 + barra de sentimiento hueca para las leídas. Cierra el hueco real: un jefe de prensa que revisa dos veces al día no tiene forma de saber dónde se quedó.

### MN-14/MN-15 · Filtros que el API ya soporta, y las exclusiones declaradas — P1, S/XS
Ver tabla §8.5. Añadir dos filtros nuevos al API (`author`, `domain` — `domain` ya está indexado) y exponer los ocho que existen y la UI no ofrece. Y en el pie de la lista, siempre: **«417 menciones · se excluyeron 259 de baja pertinencia y 18 duplicadas»** con toggles que envían `includeLow=1` y `includeDuplicates=1`. Es la línea que convierte el 38.3% oculto en una decisión del usuario.

### MN-16 · Densidad — P2, XS
El control ya está escrito y desconectado (D6a). Montar `TweaksPanel`, dar setter a `density` (app.js:187) y añadir a `index.html` las tres reglas que faltan: `[data-density="compact"] .mention-row{--row-pad:6px}` / `normal{10px}` / `comfortable{16px}`. Con 25 filas y una página de ~7,000px, pasar de 10 a 6px de padding recorta ~800px.

### MN-17 · Comparar dos consultas — P2, L
Dos columnas, cada una con su chip-set y su banda de 4 cifras, un solo histograma con dos series. Vale la pena sólo después de MN-7 (permalink) y MN-9 (vistas): comparar = abrir dos vistas guardadas. No antes.

---

## 8.4 Anatomía de la fila

### 1440px · modo Compacta (fila 56px, densidad normal)
Grid: `20px 44px minmax(0,3fr) minmax(128px,1fr) 132px 96px 32px`, `gap: var(--sp-3)`, `align-items:center`, sin `minWidth` fijo (hoy `620px`, screens.js:1126).
```
┌──┬────┬─────────────────────────────────────────┬──────────────┬──────────┬────────┬──┐
│▎ │[▣] │ DDEC anuncia inversión de $3.2 millones │ Desarrollo   │ 21 jul   │  21.3M │ ›│
│  │56×4│ en el corredor tecnológico de Mayagüez  │ económico    │ 3:14 PM  │        │  │
│  │ 0  │ María Rivera · elnuevodia.com  ↻14 medios│ ▸ Incentivos│ hace 12 d│audiencia│ │
└──┴────┴─────────────────────────────────────────┴──────────────┴──────────┴────────┴──┘
 ▎ = barra 3px de sentimiento (--neg/--pos/--neu/--text-3 si sin clasificar)
```
En hover, las columnas `audiencia` y `›` se reemplazan por tres botones de 28px: `↗ abrir original` · `⌁ parecidas` · `✓ leída`; y el titular gana `title` con el texto completo. El titular usa **`-webkit-line-clamp:2`, no `ellipsis` de una línea**: dos líneas a 14px caben en 56px y eliminan de golpe 7 de los truncados de 1440px.

### 390px · modo Lectura (default en móvil; sin grid, sin scroll-x)
```
┌───────────────────────────────────────┐
│▎ [ imagen 100% × 132px, si existe ]   │
│▎ ⬤ elnuevodia.com · 21 jul · hace 12 d│
│▎ DDEC anuncia inversión de $3.2        │
│▎ millones en el corredor tecnológico   │  ← 15px/600, clamp 3 líneas
│▎ La agencia detalló la asignación de   │
│▎ fondos federales para tres parques…   │  ← summary, 13px, clamp 2 líneas
│▎ [negativo] [Desarrollo económico]     │
│▎ 21.3M audiencia · ↻ 14 medios         │
└───────────────────────────────────────┘
```
Cero scroll horizontal, cero columnas. El tópico es un chip que envuelve (no se trunca nunca). Tap en la tarjeta abre el drawer; tap en el chip filtra.

### Tabla de campos
| Campo | Origen | Token tipográfico | Color | Clic | 1440 | 390 |
|---|---|---|---|---|---|---|
| Barra sentimiento | `sentiment` | — | `--pos`/`--neg`/`--neu`/`--text-3` | filtra sentimiento | 3px | 3px |
| Miniatura | `image` (61.7%) | — | placeholder `--canvas-2` + inicial del dominio | abre drawer | 56×40 | 100%×132 |
| Titular | `title` | `--fs-body` 14px/500 | `--text` | abre drawer | clamp 2 | `--fs-body-lg` 15px/600, clamp 3 |
| Resumen IA | `summary` (100%) | `--fs-body-sm` 13px | `--text-2` | — | hover/drawer | clamp 2 |
| Autor · dominio | `author`,`domain` | `--fs-caption` 12px | `--text-2` (nunca `--text-3`) | dominio → `domain=` | 1 línea | 1 línea |
| Fuente | `source` | icono 14px + `<title>` | `--text-2` | filtra fuente | icono | icono |
| Tópico | `topicName` | `--fs-caption` 12px | chip `--text-2` | filtra tópico | `minmax(128px,1fr)` clamp 2 | chip |
| Subtópico | `subtopics[0]` | `--fs-overline` 11px | `--text-3` | filtra subtópico | 2ª línea | oculto |
| Fecha absoluta | `publishedAtIso` | `--fs-caption` + `--ff-numeric` | `--text-2` | — | «21 jul / 3:14 PM» | «21 jul» |
| Relativo | `publishedAtLabel` | `--fs-overline` 11px | `--text-3` | — | 3ª línea | tooltip |
| Audiencia | `potentialAudience` (81.5%) | `--fs-num-sm` 15px + `--ff-numeric` | `--text` | ordena | columna 96px | línea meta |
| Historia | `storyCount` | `--fs-overline` 11px | `--accent` | expande grupo | badge `↻N medios` | badge |
| Pill de sentimiento | — | — | — | — | **eliminado** (lo dice la barra) | conservado en Lectura |

**Sobre Besley/Krub y el truncado de tópicos:** con las nuevas familias «Desarrollo económi…» ya no cabe donde cabía. La solución no es más ancho fijo sino **cambiar el modo de fallo**: pista elástica `minmax(128px, 1fr)` (los 110px de hoy pasan a 128 = ×1.16, el margen que exige la nueva anchura de glifo) **más `-webkit-line-clamp:2`**, de modo que cuando el ancho aprieta el texto baja de línea en vez de perderse. Regla de sistema: **ninguna etiqueta taxonómica se trunca con ellipsis; se envuelve a dos líneas o se convierte en chip.** El ellipsis queda reservado para contenido libre (titular, snippet), donde perder el final es tolerable.

---

## 8.5 Paridad de filtros

| Filtro | UI hoy | API hoy | Debería |
|---|---|---|---|
| agencia | switcher global | `agency` | igual |
| período | header (`ecoGetPeriodParams`) | `period`, `from`/`to` | **chip en la Zona A**, no sólo en el header |
| texto | input + debounce 300ms | `q` (AND multi-token, título/snippet/url/domain) | único campo; declarar los campos que busca |
| sentimiento | 4 chips | `sentiment` (COALESCE nlp/bw) | 5º chip «Sin clasificar» (0/676 en DDEC — P2) |
| fuente | `<select>` 160px | `source`, `pageType` | chip-menú multi-selección; exponer `pageType` en «Avanzado» |
| tópico | popover | `topic` + `topicMode` | chip-menú + **toggle `topicMode`** (hoy sólo el slice modal lo usa) |
| subtópico | **no** | `subtopic` | chip-menú dependiente del tópico |
| región | popover | `region` | chip-menú |
| municipio | **no** | `municipality` | chip-menú (78 municipios, con buscador) |
| emoción | **no** | `emotion` | chip-menú (existe en Sentimiento y aquí no) |
| día / dow / hora | **no** | `day`, `dow`, `hour` | los escribe el brushing de MN-2 |
| pertinencia | **no** (excluye baja en silencio) | `pertinence`, `includeLow` | **toggle visible + conteo excluido** (MN-15) |
| duplicados | **no** (excluye siempre) | — (hardcoded `is_duplicate=false`, route.ts:172) | `includeDuplicates=1` + conteo |
| engagement mín | sólo el fetch de virales | `minEngagement` | control en «Avanzado» + umbral por percentil |
| autor | **no** | **no** | `author` (ILIKE) — nuevo |
| dominio | **no** | **no** | `domain` (`=`, indexado) — nuevo |
| idioma | **no** | **no** | `language` — nuevo (11.4% no-español) |
| con imagen | **no** | **no** | `hasImage=1` → `resolved_image_url IS NOT NULL` (**no** `has_image`: 417 vs 66) |
| leído | **no** | **no** | `readState` (MN-13) |
| parecidas a | sólo drawer | `similar_to` | consulta de primer nivel (MN-10) |
| orden | 3 chips | `recent`,`engagement`,`relevance` | + `impact`, `audience`; default `audience` con `source=news` |
| agrupar | **no** | **no** | `group=story` (MN-3) |
| geo BW | — | — | **no especificar**: `bw_city`/`bw_region` = 0 filas |

### Controles muertos a retirar o conectar
| Control | Ubicación | Veredicto |
|---|---|---|
| `mentionsFilter` prop | app.js:391, ignorado por `MentionsScreen` | **conectar** (hace vivos los 5 comandos del ⌘K, F28) |
| Panel de densidad | `TweaksPanel` shell.js:1054 nunca montado; `density` sin setter app.js:187; 0 reglas `[data-density]` | **conectar** (MN-16) |
| Fetch de virales | screens.js:852-865 (deps `[]`, `fetch` crudo, `catch → 0`) | **borrar**, lo absorbe `facets=summary` |
| «Limpiar filtros» del popover | screens.js:933 (sólo topic/region/sortBy) | **reemplazar** por `resetQuery()` en la Zona A |
| `sortBy` en el contador «Más filtros ·N» | screens.js:871 | **excluir** (el orden no es un filtro) |
| Modo `table` vs `list` | screens.js:717-721 | **fusionar** en `compact` |
| `SearchScreen` | screens.js:1265-1507 | **borrar** (MN-6) |
| Pill de sentimiento en Compacta | screens.js:1148 | **sustituir** por la barra de 3px |

---

## 8.6 Orden de ejecución

**P0 (un PR, el rediseño):** contrato `facets=` + `publishedAtIso` + campos nuevos en la respuesta → `MentionRow` único → Zona A con chips y permalink → banda reactiva de 4 → histograma con brushing → `group=story` interim → teclado → fusión de /search → retirada de controles muertos.
**P1:** `story_id` persistido + backfill + índice ivfflat → export servidor → vistas guardadas y alerta → leído/selección → impacto/audiencia → filtros faltantes.
**P2:** densidad, hilo por autor/dominio, comparar dos consultas.

Nada de esto necesita una librería nueva: el histograma son `<rect>` SVG, el brushing son tres handlers de puntero, la agrupación es SQL, y la nube de palabras la especifican las otras dos unidades sobre el contrato `facets=terms` de §8.2.

## Decisiones

**/search se elimina como pantalla: es el estado «con q» de /mentions**

- *Por qué:* Comparten fetch (screens.js:1339 vs 838), facetas, tres vistas, paginación y estados; divergen en doce detalles cosméticos. MentionsScreen ya recibe searchQuery/setSearchQuery/mentionsFilter/setActive (app.js:389-396): sólo hay que consumirlos. Borra ~240 líneas (screens.js:1265-1507) y elimina el segundo buscador (MEN-16).
- *Alternativas descartadas:* Mantener las dos pantallas y sincronizar su estado — duplica el coste de cada mejora futura de la fila y de los filtros, que es exactamente lo que produjo las doce divergencias. Fusionar al revés (Menciones dentro de Search) — pierde el nombre que el cliente usa.

**Los tres modos de vista bajan a dos: Compacta y Lectura, con persistencia por breakpoint**

- *Por qué:* Lista y Tabla comparten propósito y defectos (una línea, titular con nowrap+ellipsis, screens.js:1144 y 1219); Tabla sólo añade cuatro columnas y usa overflow:auto en vez de .scroll-x. Dos necesidades reales: escanear y leer. Guardar la preferencia por breakpoint (eco.viewMode.mobile default reading) evita entregar en móvil la vista que allí no funciona.
- *Alternativas descartadas:* Conservar los tres con criterios documentados — no hay tercera necesidad; el coste es multiplicar por tres cada corrección de la fila.

**La banda de métricas se queda, baja a 4 cifras y sólo admite cantidades aditivas sobre el subconjunto**

- *Por qué:* Total, Interacciones, Audiencia potencial y Virales se calculan con un solo agregado sobre el mismo whereClause que la lista, así que reaccionan a los filtros y no pueden contradecir el total (cierra MEN-01 y MEN-02). Rejilla 4/2/2 limpia (MEN-22).
- *Alternativas descartadas:* Dejar las 5 y rotularlas «período completo» — condena la pantalla a mostrar cifras que el usuario leerá como filtradas. Quitar la banda entera — pierde el resumen que hace útil un explorador. Mantener Engagement rate en la banda — es una razón, no es aditiva, y comparar la del filtro con la del período engaña.

**Engagement rate y Velocidad salen de la banda y bajan a una línea de contexto rotulada «Período completo, sin filtros»**

- *Por qué:* Velocidad es literalmente el delta de Total (eco-data/route.ts:366-369), o sea dos tarjetas para un hecho en dos idiomas (MEN-10), y su color sólo codifica la subida (MEN-09). Engagement rate no se puede recalcular por subconjunto con paridad de fórmula.
- *Alternativas descartadas:* Fusionar Velocidad dentro de Total como delta — válido y compatible, pero exige que el delta se recalcule por filtro; hasta que exista ese agregado, rotularlo como contexto es lo honesto.

**La nube de palabras va como pestaña del panel «Resumen del resultado» (Zona B), alimentada por el subconjunto filtrado, y su clic añade el término a q**

- *Por qué:* Es un resumen del resultado, no una pantalla: puesta al final de 7,000px de página nadie la ve, y calculada sobre el período completo contradiría la lista igual que hoy la contradicen los KPI. Como pestaña comparte el fetch y el WHERE.
- *Alternativas descartadas:* Card independiente al final (se desconecta de los filtros y alarga la página); nube calculada en cliente sobre las 25 filas cargadas (no es representativa del total: 25 de 417).

**Agrupar casi-idénticas con story_id persistido (coseno <0.10, ventana ±72h), con una etapa interim que agrupa por text_hash + coseno dentro de la página**

- *Por qué:* Medido en producción: el 21-jul DDEC tuvo 26 menciones visibles y 15 de ellas son la misma nota de AP en 14 medios (16 filas, 12 text_hash distintos porque el hash incluye el snippet). 27.8% de las menciones de DDEC tienen un casi-gemelo a <0.10 y el 100% tiene embedding. Sin persistir el grupo, la paginación no puede colapsar antes del LIMIT y los conteos son aproximados.
- *Alternativas descartadas:* Agrupar sólo por text_hash — colapsa 4 de 16 filas del caso medido. Umbral 0.15 o 0.20 — agrupa 40%/50% y empieza a juntar temas distintos (el mismo error que dejó las narrativas congeladas con eps 0.19/0.22). Agrupar en cliente — sin embeddings en el payload es imposible.

**Agrupar por text_hash, nunca por duplicate_of_id**

- *Por qué:* processor/index.ts:177 selecciona el duplicado con LIMIT 1 sin ORDER BY y sin AND is_duplicate=false: el puntero apunta a una fila arbitraria y admite cadenas, así que agrupar por duplicate_of_id fragmenta el grupo. text_hash es determinista y ya está indexado (idx_mentions_text_hash).
- *Alternativas descartadas:* Arreglar primero duplicate_of_id en el processor — requiere redeploy del lambda con el riesgo de drift bundle-vs-git documentado en CLAUDE.md; agrupar por hash no necesita tocar la ingesta.

**La miniatura se condiciona a resolved_image_url, nunca a has_image**

- *Por qué:* Medido en DDEC 30 días: 417 filas tienen resolved_image_url y sólo 66 tienen has_image=true. El flag está desincronizado; usarlo dejaría fuera el 84% de las imágenes disponibles.

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-W1` | P0 | M | Contrato API: facets, fecha ISO y campos ignorados | `apps/web/src/app/api/eco-mentions/route.ts (369-543, 499-533, 94-103)` | — |
| `WS-W2` | P0 | L | MentionRow único + anatomía nueva (Compacta/Lectura) | `apps/web/public/eco-prototype/screens.js (1123-1243), index.html (pill-*, row-hover)` | W1 |
| `WS-W3` | P0 | L | Zona A: cabecera de consulta, chips removibles, permalink, reset | `apps/web/public/eco-prototype/screens.js (785-944), app.js (100-110, 246, 389-396)` | W1 |
| `WS-W4` | P0 | M | Fusión de /search en /mentions | `apps/web/public/eco-prototype/screens.js (1265-1507 borrar), app.js (103, 156, 351), shell.js (343-365)` | W3 |
| `WS-W5` | P0 | M | Banda reactiva de 4 cifras + línea de contexto | `apps/web/public/eco-prototype/screens.js (946-964, 1008-1034, 852-865 borrar)` | W1 |
| `WS-W6` | P0 | M | Histograma temporal con brushing | `apps/web/public/eco-prototype/screens.js (Zona B nueva), charts.js (primitiva nueva ~40 líneas SVG)` | W1 |
| `WS-W7` | P0 | M | Agrupar historias — interim group=story | `apps/web/src/app/api/eco-mentions/route.ts, screens.js (MentionRow badge)` | W2 |
| `WS-W8` | P0 | S | Triage por teclado y estados de carga | `apps/web/public/eco-prototype/screens.js (966-1000, Pagination 1036-1102)` | — |
| `WS-W9` | P1 | L | story_id persistido, backfill e índice vectorial | `infra/lambda/processor/index.ts (171-181), packages/database/src/schema/mentions.ts, acción backfill-story-ids` | W7 |
| `WS-W10` | P1 | M | Exportar respetando filtros (CSV servidor) | `apps/web/src/app/api/eco-mentions/export/route.ts (nuevo), shell.js (1422-1444)` | W1 |
| `WS-W11` | P1 | L | Vistas guardadas, vista→alerta y estado de lectura | `packages/database/src/schema/ (saved_views, mention_reads), apps/web/src/app/api/saved-views/route.ts (nuevo),` | W3 |
| `WS-W12` | P1 | M | Semántica de primer nivel, impacto/audiencia y densidad | `screens.js (SORT_OPTIONS 725-729), shell.js (818-834, TweaksPanel 1054), app.js (187, 325), index.html (reglas` | W2 |

## Riesgos

- El umbral coseno 0.10 es el punto medido en DDEC (n=658). Antes de persistir story_id hay que repetir la medición en gobernadora (2,887 menciones/30d), que es 4× más grande y donde una nota de cable puede arrastrar decenas de filas: un umbral demasiado laxo fundiría temas distintos y repetiría el fracaso de las narrativas.
- Sin CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) el operador <=> hace seq-scan; asignar story_id en el processor por mención se vuelve O(n) sobre toda la ventana y puede reventar el timeout, igual que el DBSCAN O(n²) de eco-narrative-cluster (cap NARRATIVE_CANDIDATE_POOL_LIMIT=12000).
- Agrupar historias cambia los conteos que el usuario ve (26 menciones → 12 historias) mientras los correos, el Scorecard y los snapshots siguen contando menciones. Si no se rotula «menciones» vs «historias» en las dos superficies, se añade una sexta cifra rival al problema F9 en vez de resolverlo.
- Declarar la exclusión de pertinencia baja hará visible que el feed oculta el 38.3% del universo (259 de 676 en DDEC). Es lo correcto, pero hay que preparar la conversación con el cliente: va a preguntar por qué, y la respuesta depende de la calidad del clasificador, no del front.
- MN-2 (histograma con brushing) escribe from/to en el estado global de período (localStorage eco.from/eco.to). Si el brush no revierte al salir de la pantalla, el usuario aterriza en Overview con una ventana de 2 días que no eligió.
- Backfill de story_id sobre el histórico exige una acción nueva en eco-migration: el bundle live tiene drift respecto a git y las acciones desconocidas responden «completed successfully» sin hacer nada. Hay que verificar el efecto con custom-query, no con el código de retorno.
- La fusión de /search borra una entrada del router: cualquier enlace externo, correo o captura que apunte a /search?q= debe seguir funcionando vía alias. Si se elimina ROUTES.search (app.js:103) sin alias, se rompen los CTA ya enviados.
- El export servidor con limit 5,000 sobre /api/eco-mentions pasa por el rate-limit de 120 req/min por cliente (route.ts:131) y por el mismo pool de RDS que el dashboard; sin streaming y sin un límite duro puede degradar la SPA para todos los usuarios de la agencia.


---

# Backend de la nube de palabras de Menciones — extracción y puntuación de términos

## Resumen

La nube de palabras no tiene ninguna base de datos donde apoyarse: no hay columna de términos, no hay índice de texto, y `unaccent`/`pg_trgm` NO están instaladas (solo `plpgsql` y `vector 0.8.0` en PG 16.13, db.t4g.medium, 2 vCPU burstable, `work_mem=4MB`). Medí en prod que extraer términos en caliente es inviable: el pipeline completo (tokenizar + stem + bigramas) tarda 34 s para 2,290 menciones y 12.9 s para 41,445; pero medí también que el 90% de ese costo es PARSEAR el texto, no agregar: con el tsvector ya calculado, el `unnest + GROUP BY` sobre 1.26 M lexemas cuesta menos de 1 s. Eso decide la arquitectura: un índice invertido por mención (`mention_terms.tsv`, 13 MB por año-agencia, cabe inline sin TOAST) mantenido incrementalmente en SQL, y la agregación viva en la request usando EXACTAMENTE el mismo `WHERE` que la lista. Ese último punto no es cosmético: es el único diseño que evita repetir F9 (dos fuentes rivales para el mismo número), así que especifico extraer `buildMentionScope()` de `eco-mentions/route.ts` a un módulo compartido que ambas rutas importan. La frecuencia cruda no sirve: medida en gobernadora 365d, los seis términos más frecuentes son los propios términos del query de Brandwatch (gonzález 36,649 · jenniffer 34,819 · gobernadora 33,803 · colón · puerto · rico) seguidos de basura de plataforma (https, com, www, photos, from, post). Con log-odds ratio y prior de Dirichlet informativo (a0=500) sobre los mismos datos, los 7 días contra los 90 anteriores devuelven en 2.06 s: sequía, emergencia, agua, embalse, Guardia Nacional, orden ejecutiva, Carraízo, severa, lluvia — la noticia real de la semana. Por eso "más distintivo" es el modo por defecto y "más frecuente" el conmutador secundario. El stemmer español de Postgres resuelve acentos y plurales gratis (educación→educ, Loíza→loiz, permisos/permiso→permis) pero colisiona (parte/partido→part, pública/publicación→public, autoridad→autor) e es inconsistente (anuncia→anunci vs anunció→anunc), lo que obliga a definir las stopwords como superficies expandidas por `ts_lexize` más una lista de tallos crudos, y a mantener la lista corta y quirúrgica en vez de agresiva.

## 0. Hechos medidos en prod (3 ago 2026) — no re-descubrir

| Hecho | Valor | Cómo se midió |
|---|---|---|
| Extensiones instaladas | **solo `plpgsql`, `vector 0.8.0`** | `SELECT extname FROM pg_extension` |
| `unaccent`, `pg_trgm` | **NO instaladas** (sí disponibles en RDS) | idem |
| Motor | PostgreSQL **16.13**, `db.t4g.medium` (2 vCPU burst, 4 GB) | `describe-db-instances` |
| `work_mem` / `shared_buffers` | **4 MB** / 910 MB | `pg_settings` |
| Tamaño DB / tabla `mentions` | 2,420 MB / 1,833 MB (heap 177 MB) de 20 GB | `pg_database_size` |
| Config FTS `spanish` | existe (Snowball + stopwords) | `pg_ts_config` |
| Menciones totales | 115,425 (8,997 duplicados, 11,529 pertinencia `baja`) | `COUNT(*)` |
| `nlp_summary` cobertura | **100.00%** (115,425/115,425), ~250 chars | `COUNT(nlp_summary)` |
| Menciones por ventana (sin dup, sin `baja`) | gobernadora 7D 564 / 30D 2,290 / 90D 8,165 / 1A 41,446 · ddecpr 30D 416 · aaa 30D 950 · sgpr 30D 904 | agregado por agencia |
| `title` vacío | 0% en todos los `page_type` salvo `reddit` (n=2). **LinkedIn tiene `title` de 4 chars de media** (placeholder) y snippet 191; `twitter` snippet=4; `tiktok` snippet=2 | `AVG(LENGTH(...))` por page_type |
| Costo parsear + `strip(to_tsvector)` 41,445 docs | **4.23 s**, 1,260,629 lexemas, **13 MB** de tsvector | CTE + `SUM(pg_column_size)` |
| Costo parsear + `unnest` + `GROUP BY` + top-10, 41,445 docs | **3.89 s** → la agregación es **~0 s**; el parseo es todo el costo | comparación de las dos anteriores |
| Pipeline `ts_lexize` unigramas 41,445 docs | 12.9 s (0.31 ms/doc) | query s6 |
| Pipeline bigramas (`generate_subscripts`) 2,290 docs / 141,984 tokens | **34.2 s** (3.0 ms/doc); solo la expansión de 139,694 pares = 6.8 s | queries s7/s10 |
| Vocabulario gobernadora 365d | 53,859 lexemas distintos; 11,418 con df≥5; 5,355 con df≥20 | query s16 |
| Log-odds Dirichlet 7D vs 90D previos | **2.06 s** con parseo inline de ambas ventanas | query s14 |

**Conclusión de arquitectura, con números:** precalcular el `tsvector` por mención convierte una query de 4 s en una de <1 s, ocupa 13 MB por año-agencia (~40 MB en total, sobre 17.5 GB libres) y cabe **inline** (330 bytes/fila de media, bajo el umbral de TOAST de 2 KB).

---

## 1. Fuente del texto y pesos

**Fuente: `title` + `snippet`. `nlp_summary` solo como fallback.**

Razones medidas: `nlp_summary` existe en el 100% de las filas y está limpio de URLs, pero lo escribe el prompt del processor con plantilla fija — muestras reales: *"Reportaje informativo sobre…"*, *"Publicación de Foro Noticioso compartiendo fotos de un post de…"*, *"Medio informativo (Metro PR) reporta declaraciones de…"*, *"sin valoración editorial"*. Usarlo como fuente primaria inunda la nube con `reportaje/informativo/publicación/medio/compartiendo/post/fotos`, que es exactamente el ruido que la nube debe evitar.

Regla de fallback (cubre el caso degenerado real: `title="Photos from Jenniffer González Colón's post"`, `snippet="https://www.facebook.com/share/p/…"`):

```
si  count(lexemas útiles de title+snippet) < 4  →  añadir nlp_summary con peso C
```

**Pesos:** se usan los cuatro pesos nativos del `tsvector` (verificado que sobreviven a `||` y a `unnest`):

| Peso | Contenido | Uso |
|---|---|---|
| `A` | unigramas de `title` | `df_title`; boost de prominencia en modo `frequent` |
| `B` | unigramas de `snippet` | base |
| `C` | unigramas del fallback `nlp_summary` + hashtags | trazabilidad |
| `D` | claves de frase (bigramas del diccionario) | separa `kind='phrase'` sin columna extra |

**La métrica base es DF (document frequency), no TF.** Motivo medido: en `instagram_public` y varias filas de `facebook_public`, `snippet` es literalmente igual a `title` (muestras 1 y 3 del sondeo), y `snippet` de noticias empieza con `"..."` truncando la misma frase del título. Con TF cada término de esas menciones contaría doble; con DF la duplicación intra-documento es inocua. La ponderación por prominencia se aplica sobre el DF, no sobre el TF:

```
w_frequent(t) = df(t) * (1 + 0.35 * df_title(t)/df(t))     // máx +35% si sale siempre en el título
```

Nada de ponderar por `engagementScore` ni `reachEstimate`: un solo post viral recolorea y redimensiona un término entero. Se expone `df` crudo y el front puede ofrecer el conmutador si el cliente lo pide.

---

## 2. Normalización

Pipeline exacto, todo en SQL (una sola implementación para backfill e incremental):

| Paso | Implementación | Nota |
|---|---|---|
| 1. Concatenar | `concat_ws(' . ', title, snippet)` | el `.` impide que un bigrama cruce la frontera título→snippet |
| 2. Quitar URLs, emails, handles | `regexp_replace(txt, '(https?://[^[:space:]]+\|www\.[^[:space:]]+\|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)', ' ', 'g')` | sin esto entran `https`(df 7,890), `com`(7,810), `www`(5,863), `mibextid`, `fbclid` |
| 3. Tokenizar preservando caja | `regexp_split_to_table(txt, '[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9#]+')` | clase explícita (no `[[:alpha:]]`, que depende de locale). El `#` queda dentro de la clase para conservar hashtags |
| 4. Descartar | `length BETWEEN 3 AND 30`, `!~ '^[0-9]'` | el `LIMIT 3` elimina el lexema `'s'` (df 5,430 en gobernadora, viene de `González's`) |
| 5. Clave = minúsculas + stem | `lower()` → `(ts_lexize('spanish_stem', tok))[1]` | `lower()` verificado con acentos: `'ECONÓMICA ÑOÑO'→'económica ñoño'` |
| 6. Stopwords del idioma | el propio `spanish_stem` devuelve `'{}'` para stopwords → `[1] IS NULL` → se descarta | verificado: `ts_lexize('spanish_stem','la') = []` |
| 7. Superficie para mostrar | se guarda el token original con su caja en `wordcloud_forms` | ver §7bis |

**Acentos: NO se necesita `unaccent`.** El stemmer Snowball español ya remueve los acentos agudos en su último paso — verificado: `educación→educ`, `Loíza→loiz`, `Sequía→sequ`, `González→gonzalez`, `Colón→colon`, y **conserva la ñ** (`niños→niñ`, `mañana→mañan`). Instalar `unaccent` sería una extensión más sin ganancia. (`pg_trgm` tampoco hace falta: no hay fuzzy match en este diseño.)

**Entidades con mayúscula:** no se detectan como entidades (no hay NER disponible en SQL). Se resuelven por la vía de las frases (§4): `Guardia Nacional`, `Rivera Schatz`, `Itza García` aparecen todas como bigramas con alta adhesión en la corrida de prueba. La caja se preserva solo para el *display*, nunca para la clave.

**Emoji:** el paso 3 los elimina. Verificado que `to_tsvector` también los descarta. Los emoji sí llevan señal en Instagram/Facebook (`🟢`, `💧`, `🏛️` en las muestras) — se especifica como P2 opcional: segundo pase con `regexp_matches(txt, '[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]', 'g')` y `kind='emoji'`, en un contador aparte que el front puede mostrar como fila, nunca mezclado en la nube tipográfica.

**Handles (`@usuario`):** se eliminan en el paso 2. Un handle no es un tema, y sin el `@` el stemmer los destroza (verificado: `@jenniffer → 'jenniff'`, indistinguible del nombre). Los autores ya tienen su propio panel.

---

## 3. Stopwords de dominio (lista concreta)

Dos hallazgos gobiernan el diseño:

1. **El stemmer colisiona:** `parte`/`partido`→`part`, `pública`/`publicación`/`público`→`public`, `autoridad`→`autor`, `gobernadora`/`gobernación`/`gobernar`→`gobern`. Poner `part` en la lista mataría *partido* (término legítimo en un dashboard de gobierno). Por eso la lista es **quirúrgica, no agresiva**: identidad de agencia + basura de plataforma + calendario + verbos de titular. El resto lo suprime la puntuación distintiva (§5), que es inmune a lo uniformemente frecuente.
2. **El stemmer es inconsistente entre inflexiones:** `anuncia→anunci` pero `anunció→anunc`; `declaró→declar` pero `declara→decl`. Una lista escrita a mano en tallos deja agujeros (en la corrida de prueba se colaron `decl` y `anunc`). Por eso la lista se declara en **superficies** y se expande con `ts_lexize` en la propia query, más un array de **tallos crudos** para los artefactos conocidos.

Archivo nuevo: `apps/web/src/lib/wordcloud/stopwords.ts` (o `packages/shared/src/wordcloud/stopwords.ts` si el lambda de minería también lo necesita — sí lo necesita, va en `shared`).

```ts
/** Superficies; se expanden a tallos con ts_lexize('spanish_stem', …) en la query. */
export const STOP_SURFACES_GLOBAL: string[] = [
  // — plataforma / boilerplate de scraping (medido: photos 4,430 · from 4,234 · post 3,936 · facebook 3,886)
  'photos','photo','from','post','posts','share','shared','sharing','link','links','via','rt','retweet',
  'video','videos','watch','follow','following','comment','comments','like','likes','story','stories',
  'reel','reels','live','thread','tweet','status','http','https','www','com','net','org','html','php',
  'mibextid','fbclid','utm','amp','jpg','png','mp4','gif','click','ver','leer','mas','more','read',
  // — inglés residual de los títulos de Facebook/Instagram
  'the','and','for','with','this','that','you','your','are','was','has','have','not','but','all','out',
  'new','about','after','before','how','what','when','who','why','його',
  // — verbos vacíos de titular (todas las inflexiones que el stemmer trata distinto)
  'anuncia','anunció','anuncian','anunciar','anuncio','anuncios','asegura','aseguró','aseguran','asegurar',
  'informa','informó','informan','informar','información','señala','señaló','señalan','señalar',
  'indica','indicó','indican','indicar','expresa','expresó','expresar','dice','dijo','dicen','decir',
  'afirma','afirmó','afirmar','destaca','destacó','destacar','explica','explicó','explicar',
  'sostuvo','sostiene','reitera','reiteró','confirma','confirmó','confirmar','declara','declaró',
  'declaración','declaraciones','manifiesta','manifestó','apunta','apuntó','añade','añadió','comenta','comentó',
  'advierte','advirtió','pide','pidió','solicita','solicitó','reacciona','reaccionó','responde','respondió',
  'cuenta','contó','presenta','presentó','realiza','realizó','ofrece','ofreció',
  // — calendario
  'enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','setiembre','octubre',
  'noviembre','diciembre','lunes','martes','miércoles','jueves','viernes','sábado','domingo',
  'hoy','ayer','mañana','anoche','semana','semanas','mes','meses','año','años','día','días','hora','horas',
  'minuto','minutos','pasado','pasada','próximo','próxima','actual','reciente','recientemente',
  // — muletillas y cuantificadores que la lista spanish de PG no cubre
  'nuevo','nueva','nuevos','nuevas','junto','juntos','ahora','luego','vez','veces','tras','según','además',
  'también','mientras','aunque','durante','sobre','entre','desde','hasta','cada','todo','toda','todos','todas',
  'mucho','muchos','poco','pocos','gran','grande','grandes','mejor','peor','mayor','menor','tal','así',
  'aquí','allí','solo','sólo','único','únicos','primer','primera','segundo','tercero','último','última',
  'mil','miles','millón','millones','ciento','porciento','total','totales','cerca','alrededor','aproximadamente',
  // — topónimos genéricos (no informativos en un dashboard de PR)
  'puerto','rico','boricua','isla','país','pueblo','ciudad','municipio','municipios','local','locales',
  'región','regiones','zona','zonas','área','áreas','sector','norte','sur','este','oeste','centro',
];

/** Tallos crudos: artefactos del Snowball que ninguna superficie razonable produce. */
export const STOP_STEMS_EXTRA: string[] = [
  'anunc','decl','asegur','inform','señal','indic','expres','afirm','destac','explic','sostuv','reiter',
  'confirm','manifest','apunt','añad','coment','advirt','advert','solicit','reaccion','respond','present',
  'realiz','ofrec','ver','leer','mas','men','part',   // 'part' SOLO si el cliente pide quitar "parte";
  // ⚠ 'part' colisiona con "partido". Va comentado por defecto — ver Riesgo R3.
];

/** Identidad de agencia: son los términos del boolean de Brandwatch, están en ~100% de las filas.
 *  Medido en gobernadora 365d: gonzalez 36,649 · jenniff 34,819 · gobern 33,803 · colon 22,841. */
export const STOP_SURFACES_BY_AGENCY: Record<string, string[]> = {
  gobernadora: ['jenniffer','jennifer','jeniffer','gonzález','gonzalez','colón','colon','jgo',
    'gobernadora','gobernador','gobernación','fortaleza','lafortaleza','cumpliendocontigo',
    'jenniffergonzalez','jenniffergonzález','primera','ejecutiva','mandataria'],
  ddecpr: ['ddec','ddecpr','departamento','desarrollo','económico','económica','comercio',
    'secretaría','secretario','secretaria','dedc','invest','puertoricodoesitbetter'],
  aaa: ['aaa','acueductos','alcantarillados','acueducto','alcantarillado','autoridad',
    'aaapr','abonado','abonados'],   // ⚠ 'autoridad'→'autor'; ver Riesgo R3
  sgpr: ['sgpr','gobernación','secretaría','secretario','domenech','francisco','fortaleza',
    'subsecretaría','subsecretario'],
};
```

Expansión dentro de la query (verificada; 63 superficies costaron ~0 ms):

```sql
stop AS (
  SELECT DISTINCT s FROM (
    SELECT (ts_lexize('spanish_stem', w))[1] AS s FROM unnest($stopSurfaces::text[]) w
    UNION ALL SELECT w FROM unnest($stopStems::text[]) w
  ) u WHERE s IS NOT NULL
)
```

**Las stopwords se aplican en tiempo de query, no de indexado.** Cambiar la lista es un deploy de código, no un rebuild de 115k filas. Se expone `?noStop=1` (solo para depuración interna) para auditar qué se está tapando.

---

## 4. Unigramas vs frases

**Diccionario de frases minado en batch, no en la request.** La expansión de bigramas mide 3.0 ms/doc (34 s para 2,290 docs) — imposible en caliente, trivial en batch (115k docs ≈ 6 min).

### Minería (job periódico, por agencia)

```sql
-- 1) candidatos: pares adyacentes donde NINGUNA parte es stopword del idioma
bi AS (
  SELECT DISTINCT id, lower(a[i]) w1, lower(a[i+1]) w2
    FROM arr, generate_subscripts(a,1) i
   WHERE i < array_length(a,1)
     AND length(a[i]) >= 3 AND length(a[i+1]) >= 3
     AND a[i] !~ '^[0-9]' AND a[i+1] !~ '^[0-9]'
),
-- 2) clave = stem1 || '_' || stem2  (evita 'permiso único' ≠ 'permisos únicos': ambos → 'permis_unic')
```

Umbrales (todos justificados con los números medidos):

| Filtro | Valor | Por qué |
|---|---|---|
| `df_phrase` | `>= GREATEST(5, 0.0015 * N_docs)` | 0.15% de la ventana; con 8,165 docs (90D gobernadora) son 12 |
| **PMI** | `log2( (df_ab/N) / ((df_a/N)*(df_b/N)) ) >= 3.0` | descarta pares por casualidad; con 3.0 la frase es ≥8× más probable que el azar |
| **Adhesión** (`stickiness`) | `df_ab / LEAST(df_a, df_b) >= 0.30` | mata combinaciones sueltas (`rico jenniffer` df 204, `colón junto` df 74, `noticioso puerto` df 62 — todas apariciones colaterales) y conserva `orden ejecutiva`, `guardia nacional`, `director ejecutivo`, `permiso único` |
| Tope | 4,000 frases/agencia por `df` | vocabulario medido: 53,859 unigramas/año; el diccionario de frases se mantiene un orden de magnitud por debajo |
| Trigramas | P2: unir `A_B` + `B_C` si ambos están en el diccionario y `df(A_B_C) >= 5`; tope 500 | cubre `orden ejecutiva 2026`, `plan de emergencia por sequía` |

Confirmado en la corrida real (30D gobernadora): con esos umbrales sobreviven `francisco domenech` (251), `itza garcía` (194), `san juan` (136), `órdenes ejecutivas` (89), `director ejecutivo` (76), `guardia nacional` (74), `rivera schatz` (66), `nuevas leyes` (57); y se caen `photos from` (362), `from jenniffer` (205), `post photos` (102), `foro noticioso`→`noticioso puerto` (62).

### Cómo se evita mostrar el bigrama Y sus unigramas

Se resuelve **después** de puntuar, en TS, recorriendo la lista ordenada por score. Como el `tsvector` de un documento contiene tanto los unigramas como las claves de frase, se cumple siempre `df(u) >= df(frase que contiene u)`, así que la resta es sana:

```ts
/** Suprime unigramas absorbidos por una frase mejor puntuada. Devuelve la lista final. */
function collapseSubsumed(terms: Term[]): Term[] {
  const bestPhraseDf = new Map<string, number>();   // stem de componente → df de la mejor frase
  const coveredBy   = new Map<string, string[]>();
  for (const t of terms) {
    if (t.kind !== 'phrase') continue;
    for (const part of t.key.split('_')) {
      if ((bestPhraseDf.get(part) ?? 0) < t.df) bestPhraseDf.set(part, t.df);
      (coveredBy.get(part) ?? coveredBy.set(part, []).get(part)!).push(t.key);
    }
  }
  return terms.filter((t) => {
    if (t.kind !== 'word') return true;
    const covered = bestPhraseDf.get(t.key);
    if (covered == null) return true;
    const solo = t.df - covered;              // apariciones del unigrama FUERA de la mejor frase
    if (solo < 0.35 * t.df) return false;     // <35% de vida propia → lo absorbe la frase
    t.df = solo;                              // vive suelto: se re-expone solo con su parte residual
    t.covers = coveredBy.get(t.key) ?? [];
    return true;
  });
}
```

Umbral **0.35**: con `guardia`(74)/`guardia nacional`(74) → `solo=0` → se colapsa. Con `orden`(95)/`orden ejecutiva`(89) → `solo=6` → se colapsa. Con `agua`(120)/`agua potable`(20) → `solo=100` → sobrevive como unigrama con df 100 y `covers:["agu_potabl"]`, que es lo correcto: se habla de agua mucho más allá de esa frase. Es una **aproximación** (usa la mejor frase, no la unión de todas) y así se documenta en el campo `approx: true` del `debug`.

---

## 5. Puntuación

Dos modos, conmutador en el endpoint. **`distinctive` es el default.**

### `mode=frequent`
```
score(t) = df(t) * (1 + 0.35 * df_title(t)/df(t))
```
Se conserva porque el cliente lo va a pedir ("¿de qué se habla más?"), pero con las stopwords de §3 encima. Sin ellas, medido, los seis primeros son los términos del propio query de Brandwatch.

### `mode=distinctive` — log-odds ratio con prior de Dirichlet informativo
Monroe, Colaresi & Quinn (2008), el estándar para "qué distingue a este periodo". Ya validado contra prod (2.06 s, salida abajo). Con `y_t` = DF en el scope, `y_r` = DF en la referencia, `n_t`/`n_r` = suma de DF sobre **todos** los términos no-stopword de cada corpus, `a0 = 500`:

```
α_w  = a0 · (y_t + y_r) / (n_t + n_r)                       -- prior informativo por término
δ_w  = ln( (y_t + α_w) / (n_t + a0 − y_t − α_w) )
     − ln( (y_r + α_w) / (n_r + a0 − y_r − α_w) )
σ²_w = 1/(y_t + α_w) + 1/(y_r + α_w)
z_w  = δ_w / sqrt(σ²_w)                                     -- score, y también su propio test
```

`a0 = 500` (regularización moderada: con ventanas de 500–40,000 docs impide que un término de df=4 encabece la lista solo por ser rarísimo antes). `minDf` por defecto `GREATEST(4, ceil(0.004 · N_scope))`.

**Corpus de referencia** — `refMode`, decidido automáticamente y devuelto en la respuesta:

| Situación | `refMode` | Referencia |
|---|---|---|
| Sin filtro de contenido (solo periodo/agencia) | `prev` | mismos filtros, ventana inmediatamente anterior de `3× la longitud`, acotada a `[30,180]` días |
| Hay `q`, `topic`, `municipality`, `region`, `emotion`, `sentiment` o `source` | `siblings` | **mismo periodo**, mismos filtros **menos el que estrecha** |

`siblings` es la respuesta correcta a "¿de qué se habla cuando se habla de X?": contrastar el subconjunto contra el resto del mismo periodo, no contra el pasado. Es también la que hace útil la nube dentro del filtro de sentimiento negativo ("qué palabras son propias de lo negativo").

**Salida real medida** (gobernadora, 7D vs 90D previos, `a0=500`, stopwords de §3 aplicadas parcialmente):

| término | y_t | y_r | z |
|---|---|---|---|
| sequ (sequía) | 138 | 90 | 23.30 |
| emergent (emergencia) | 134 | 332 | 17.84 |
| agu (agua) | 120 | 379 | 15.12 |
| embals (embalse) | 55 | 31 | 14.67 |
| guardi (guardia) | 55 | 57 | 14.21 |
| orden | 95 | 268 | 14.19 |
| carraiz (Carraízo) | 33 | 21 | 11.36 |
| sever (severa) | 27 | 19 | 10.25 |
| lluvi (lluvia) | 20 | 18 | 8.69 |

Es la noticia real de esa semana. La misma ventana en modo `frequent` devuelve `gonzález, jenniffer, gobernadora, colón, puerto, rico, https, com`.

---

## 6. Novedad

Tres señales, todas gratis o casi:

| Campo | Definición | Coste |
|---|---|---|
| `isNew` | `prevDf = 0` **y** `df >= GREATEST(3, 0.005·N_scope)` | ya está en el join de la referencia |
| `neverBefore` | `wordcloud_forms.first_seen_date >= scope.from` (o `wordcloud_phrases.first_seen_date`) — el término no existe en **ninguna** mención anterior de esa agencia | 0: columna mantenida por el builder |
| `isSpike` | `prevDf > 0` y `df / (prevDf · N_scope/N_ref) >= 3.0` | aritmética |
| `lift` | `(df/N_scope) / ((prevDf+0.5)/N_ref)` | aritmética; para el tooltip |

`neverBefore` es la señal que el cliente pidió y la única exacta contra todo el histórico. Requiere `first_seen_date`/`last_seen_date` en `wordcloud_forms` y `wordcloud_phrases` (`LEAST`/`GREATEST` en el `ON CONFLICT` del builder) — nada de un tercer pase sobre 115k filas.

Se devuelven siempre `prevDf` y `prevShare` para que el front pueda rotular "0 → 14" en vez de un badge opaco.

---

## 7. Sentimiento por término

```
s_i ∈ {+1, 0, −1}   de COALESCE(nlp_sentiment, bw_sentiment), bilingüe
                    ('positivo'|'positive' → +1; 'negativo'|'negative' → −1; todo lo demás y NULL → 0)
sent(t) = Σ s_i / df(t)                        ∈ [−1, +1]     -- promedio SIN ponderar
```

**Sin ponderar por engagement, deliberadamente**: con `engagementScore` un solo post viral recolorea el término y el color deja de significar "cómo se habla de esto" para significar "cómo se habló en un post". Se devuelven `pos`/`neu`/`neg` crudos para que el front pueda ofrecer el desglose.

Reutiliza literalmente el `effectiveSentimentSql` de `eco-mentions/route.ts:77` y el mapeo de `pillFromSentiment` (líneas 45-49), vía el módulo compartido de §8 — si no, F9 otra vez (un término "negativo" en la nube que la lista clasifica neutral).

**Umbral de confianza:**
```
sentCi        = 1.96 · sqrt( Σ(s_i − sent)² / (df·(df−1)) )     -- EE del promedio, df ≥ 2
sentReliable  = df >= 8  AND  sentCi <= 0.50
```
`df >= 8`: por debajo, un solo cambio de clasificación mueve el promedio ≥0.25, más que el ancho de cualquier banda de color útil.

**Qué se pinta por debajo del umbral:** el backend devuelve `sentReliable: false` y `sent` igualmente (para el tooltip). El contrato con el agente de render es explícito: **`sentReliable:false` ⇒ el término se pinta con `--text-2`, jamás con `--pos`/`--neg`**, y el tooltip dice "muestra insuficiente para color (n=5)". Nunca se oculta el término por eso: su tamaño (df/z) sigue siendo válido.

### 7bis. Forma de superficie (display)

Ningún término se muestra como tallo. `permis`, `unic`, `ventanill`, `econom` son inaceptables en pantalla de cliente.

`wordcloud_forms.display` = superficie **argmax** por (agencia, tallo) sobre los últimos 90 días, con una corrección de caja:

```
si  n(variante en minúsculas) >= 0.25 · n(argmax)  →  usar la minúscula
```
(los títulos de noticias vienen en Title Case y harían ganar `Sequía` sobre `sequía`; los nombres propios como `Jenniffer` no tienen variante minúscula frecuente y sobreviven correctamente).

Si un término no tiene fila en `wordcloud_forms` (ventana de <5 min entre ingesta e indexado), **se omite de la respuesta**. Mostrar el tallo es peor que perder un término durante cinco minutos.

---

## 8. Dónde vive el cómputo — recomendación única

**Índice invertido por mención + agregación viva en la request.** No caché de respuesta.

Descartado: (a) todo en la request → 4 s a 34 s medidos, inviable; (b) materializar la nube por combinación de filtros → el producto cartesiano de `sentiment × source × topic × region × emotion × q × periodo` no es enumerable; (c) tabla de caché al estilo `metric_insights_cache` → añade una segunda fuente de verdad para números que la lista también muestra, o sea F9 otra vez.

### DDL

```sql
-- 1) Índice invertido. 330 bytes/fila medidos → inline, sin TOAST. ~40 MB para las 115k filas.
CREATE TABLE mention_terms (
  mention_id uuid PRIMARY KEY REFERENCES mentions(id) ON DELETE CASCADE,
  tsv        tsvector NOT NULL,          -- unigramas (A=title, B=snippet, C=summary/hashtag)
  phr        tsvector,                   -- claves de frase (peso D); NULL hasta que corra la minería
  recipe     smallint NOT NULL DEFAULT 1,-- versión de la receta de extracción
  built_at   timestamptz NOT NULL DEFAULT now(),
  phr_at     timestamptz
);
CREATE INDEX idx_mention_terms_recipe ON mention_terms (recipe);

-- 2) Formas de superficie + primera aparición (§6, §7bis)
CREATE TABLE wordcloud_forms (
  agency_id       uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  stem            varchar(60) NOT NULL,
  display         varchar(80) NOT NULL,
  df              integer NOT NULL DEFAULT 0,
  first_seen_date date NOT NULL,
  last_seen_date  date NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, stem)
);

-- 3) Diccionario de frases (§4)
CREATE TABLE wordcloud_phrases (
  agency_id       uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  key             varchar(80) NOT NULL,     -- 'orden_ejecut'
  display         varchar(120) NOT NULL,    -- 'orden ejecutiva'
  n_words         smallint NOT NULL DEFAULT 2,
  df              integer NOT NULL,
  pmi             real NOT NULL,
  stickiness      real NOT NULL,
  first_seen_date date NOT NULL,
  last_seen_date  date NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, key)
);
CREATE INDEX idx_wordcloud_phrases_df ON wordcloud_phrases (agency_id, df DESC);
```
Schema Drizzle nuevo: `packages/database/src/schema/wordcloud.ts`, exportado desde `packages/database/src/schema/index.ts` (hoy 17 líneas; añadir `export * from './wordcloud';`).

### Mantenimiento

| Job | Dónde | Cadencia | Coste medido |
|---|---|---|---|
| `indexWordcloudTerms(limit)` — escribe `tsv` y hace upsert de `wordcloud_forms` para menciones con `mention_terms` ausente o `recipe < CURRENT` | paso nuevo en **`eco-metrics-calculator`** (ya corre `rate(5 minutes)`; subir timeout 120→300 s) | 5 min | 0.31 ms/doc → ~300 docs nuevos = **0.1 s** |
| `wordcloud-phrases` — mina el diccionario (ventana 90 d) + refresca `display` + reescribe `phr` de los últimos 7 d | acción nueva en **`eco-ai-tasks`** (512 MB, 300 s), regla `cron(20 5 * * ? *)` | diaria | 3.0 ms/doc → 8,165 docs (90D gobernadora) ≈ **25 s**, ~1 min las 4 agencias |
| `wordcloud-phrases?windowDays=14` — delta: upsert del diccionario + `phr` de los últimos 3 d | misma acción, `cron(0 */3 * * ? *)` | 3 h | ~5 s |
| Backfill inicial | `eco-migration` acción `backfill-wordcloud-terms` (trozos por día, `LIMIT 3000`) | una vez | 115,425 × 3.3 ms ≈ **6.3 min** de CPU de DB, en trozos |

`recipe` es el mecanismo de migración: subir la constante fuerza el re-indexado incremental sin `TRUNCATE` ni bloqueo. Se descarta la alternativa de una columna generada `GENERATED ALWAYS AS (to_tsvector(...)) STORED` sobre `mentions`: exigiría reescribir una tabla de 1,833 MB con `ACCESS EXCLUSIVE` sobre la tabla más caliente del sistema, y no puede contener frases dependientes de un diccionario.

### Query real del endpoint

```sql
SET LOCAL work_mem = '64MB';        -- medido: default 4 MB → el GROUP BY de 1.26M lexemas derrama a disco
SET LOCAL statement_timeout = '8s';

WITH stop AS (
  SELECT DISTINCT s FROM (
    SELECT (ts_lexize('spanish_stem', w))[1] AS s FROM unnest($stopSurfaces::text[]) w
    UNION ALL SELECT w FROM unnest($stopStems::text[]) w
  ) u WHERE s IS NOT NULL
),
scope AS (            -- ⬇ WHERE generado por buildMentionScope(): IDÉNTICO al de /api/eco-mentions
  SELECT m.id, mt.tsv, mt.phr,
         CASE WHEN COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive')  THEN  1
              WHEN COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative') THEN -1
              ELSE 0 END AS spol
    FROM mentions m
    JOIN mention_terms mt ON mt.mention_id = m.id
   WHERE /*<<SCOPE_CONDITIONS>>*/
),
ref AS (              -- mismas condiciones, ventana/filtro de referencia según refMode
  SELECT m.id, mt.tsv, mt.phr FROM mentions m
    JOIN mention_terms mt ON mt.mention_id = m.id
   WHERE /*<<REF_CONDITIONS>>*/
),
sx AS (
  SELECT key, kind, has_a, spol, id FROM (
    SELECT s.id, s.spol, t.lexeme AS key,
           CASE WHEN left(t.lexeme,1) = '#' THEN 'hashtag' ELSE 'word' END AS kind,
           ('A' = ANY(t.weights)) AS has_a
      FROM scope s, LATERAL unnest(s.tsv) t
     WHERE length(t.lexeme) >= 3 AND t.lexeme !~ '^[0-9]'
       AND t.lexeme NOT IN (SELECT s FROM stop)
    UNION ALL
    SELECT s.id, s.spol, p.lexeme, 'phrase', true
      FROM scope s, LATERAL unnest(s.phr) p
     WHERE s.phr IS NOT NULL
  ) u
),
agg_s AS (
  SELECT key, kind, COUNT(*) AS df,
         COUNT(*) FILTER (WHERE has_a)     AS df_title,
         COUNT(*) FILTER (WHERE spol =  1) AS pos,
         COUNT(*) FILTER (WHERE spol =  0) AS neu,
         COUNT(*) FILTER (WHERE spol = -1) AS neg,
         SUM(spol)::numeric                AS spol_sum,
         SUM(spol*spol)::numeric           AS spol_sq
    FROM sx GROUP BY key, kind
),
n_t AS (SELECT SUM(df)::numeric v FROM agg_s),
cand AS (SELECT * FROM agg_s WHERE df >= $minDf),
rx AS (
  SELECT t.lexeme AS key FROM ref r, LATERAL unnest(r.tsv) t
   WHERE length(t.lexeme) >= 3 AND t.lexeme !~ '^[0-9]'
     AND t.lexeme NOT IN (SELECT s FROM stop)
  UNION ALL
  SELECT p.lexeme FROM ref r, LATERAL unnest(r.phr) p WHERE r.phr IS NOT NULL
),
agg_r AS (SELECT key, COUNT(*)::numeric AS df FROM rx GROUP BY key),
n_r AS (SELECT SUM(df) v FROM agg_r)
SELECT c.key, c.kind, c.df, c.df_title, c.pos, c.neu, c.neg,
       COALESCE(r.df, 0)                       AS prev_df,
       COALESCE(f.display, ph.display)         AS display,
       COALESCE(f.first_seen_date, ph.first_seen_date) AS first_seen,
       (c.spol_sum / c.df)::float8             AS sent,
       n_t.v AS n_t, n_r.v AS n_r, c.spol_sq
  FROM cand c
  LEFT JOIN agg_r r            ON r.key  = c.key
  LEFT JOIN wordcloud_forms f  ON c.kind <> 'phrase' AND f.agency_id  = $agencyId AND f.stem = c.key
  LEFT JOIN wordcloud_phrases ph ON c.kind = 'phrase' AND ph.agency_id = $agencyId AND ph.key = c.key
  CROSS JOIN n_t CROSS JOIN n_r
 WHERE COALESCE(f.display, ph.display) IS NOT NULL
 ORDER BY c.df DESC
 LIMIT 600;                    -- candidatos; el z, el colapso y el corte a `limit` se hacen en TS
```

`z`, `isNew`, `isSpike`, `sentCi` y `collapseSubsumed()` se calculan en TS sobre ≤600 filas: aritmética pura, <1 ms, y así la fórmula queda testeable con unit tests sin DB.

**Presupuesto de latencia** (extrapolado de las mediciones, restando el parseo que ahora está precalculado): 7D 60–120 ms · 30D 120–250 ms · 90D 0.4–0.8 s · 1A 1.0–1.8 s · Max (87k docs) ~2.5 s. Si `statement_timeout` dispara, la ruta responde 200 con `degraded:true`, `mode:'frequent'` y un solo pase.

---

## 9. El endpoint

`GET /api/eco-wordcloud` — `apps/web/src/app/api/eco-wordcloud/route.ts`, `export const dynamic = 'force-dynamic'`, rate limit `consume('eco-wordcloud:'+clientKey(req), {limit: 60, windowMs: 60_000})`.

### Paridad de filtros (el punto crítico — F9)

**Acepta exactamente los mismos parámetros que `/api/eco-mentions`** y los interpreta con **el mismo código, no con una copia**:

`agency`, `period`, `from`, `to`, `sentiment`, `source`, `pageType`, `topic`, `topicMode`, `subtopic`, `municipality`, `region`, `emotion`, `dow`, `hour`, `day`, `pertinence`, `includeLow`, `minEngagement`, `q`.

Refactor obligatorio y de coste bajo: mover de `apps/web/src/app/api/eco-mentions/route.ts` a **`apps/web/src/lib/mention-scope.ts`** las piezas que hoy viven ahí y son la definición del universo:

```ts
// apps/web/src/lib/mention-scope.ts  (extraído tal cual de eco-mentions/route.ts)
export const PERIOD_DAYS: Record<string, number>;            // hoy líneas 20-23
export function parseCustomRange(from, to): …                // hoy 31-43
export function pillFromSentiment(s): …                      // hoy 45-49
export function sourceCondition(source): SQL | null;         // hoy 61-70
export const effectiveSentimentSql: SQL<string | null>;      // hoy 77
export function sentimentCondition(sentiment): SQL | null;   // hoy 80-92
export async function buildMentionScope(
  searchParams: URLSearchParams, agencyId: string,
): Promise<{ conditions: SQL[]; sinceUtc: Date; untilExclusiveUtc: Date | null;
             qTokens: string[]; narrowingFilters: string[]; empty: boolean }>;
```
`eco-mentions/route.ts` pasa a consumirlo (líneas 170-369 se reducen a una llamada). Sin esto, la nube y la lista divergirán a la primera vez que alguien toque un filtro en un solo archivo — que es literalmente la historia de F9 (medido 47 vs 54, ≈13%).

Params propios de la nube:

| Param | Default | Rango |
|---|---|---|
| `mode` | `distinctive` | `distinctive` \| `frequent` |
| `limit` | `80` | 10–150 |
| `kinds` | `word,phrase,hashtag` | subconjunto |
| `minDf` | auto `GREATEST(4, ceil(0.004·N))` | 1–1000 |
| `refDays` | auto `clamp(3·windowDays, 30, 180)` | 7–365 |
| `refMode` | auto (§5) | `prev` \| `siblings` |
| `noStop`, `debug` | `0` | solo depuración |

### Respuesta

```json
{
  "scope": {
    "agency": "gobernadora", "from": "2026-07-27", "to": "2026-08-03",
    "total": 564,
    "refMode": "prev", "refFrom": "2026-04-28", "refTo": "2026-07-26", "refTotal": 8165,
    "filters": { "sentiment": null, "source": null, "topic": null, "q": null }
  },
  "mode": "distinctive",
  "minDf": 4,
  "terms": [
    {
      "key": "sequ", "kind": "word", "label": "sequía",
      "df": 138, "share": 0.2447, "dfTitle": 96,
      "prevDf": 90, "prevShare": 0.0110,
      "z": 23.30, "score": 23.30, "lift": 22.2,
      "isNew": false, "isSpike": true, "neverBefore": false, "firstSeen": "2025-06-14",
      "sent": -0.558, "pos": 9, "neu": 43, "neg": 86,
      "sentReliable": true, "sentCi": 0.11,
      "weight": "A", "covers": ["sequ_sever"]
    }
  ],
  "truncated": false,
  "degraded": false,
  "warnings": [],
  "lag": { "termsThrough": "2026-08-03T18:15:00.000Z", "phrasesThrough": "2026-08-03T05:20:00.000Z" },
  "generatedAt": "2026-08-03T18:22:11.000Z"
}
```

Reglas del contrato:
- **`scope.total` se calcula VIVO** en la misma request con el mismo `whereClause` (el mismo `COUNT(*)` de `eco-mentions/route.ts:372-375`). Es el único número compartido con la lista y por diseño nunca se cachea. El front puede rotular "N menciones" sabiendo que es el mismo N del feed.
- `label` nunca es un tallo. Si falta la forma, el término no sale (§7bis).
- `score` es el valor del modo activo; el front no necesita saber la fórmula.
- **Nulos explícitos, nunca `?? 0`** (F4): `sent` es `null` si `df < 2`; `prevDf` es `0` real (no hueco) porque la referencia siempre se computa; `z` es `null` en `mode=frequent`. El campo `sentReliable` existe precisamente para que el front no tenga que inventar un umbral.
- `warnings` incluye `"index_lag"` si `(docs del scope sin fila en mention_terms) / total > 0.02`, con el conteo — así una nube incompleta se declara en vez de mentir. Se calcula con un `COUNT(*)` extra sobre `LEFT JOIN mention_terms … IS NULL`.

### Cache headers

| Situación | Header |
|---|---|
| La ventana incluye hoy (AST) | `Cache-Control: private, max-age=60, stale-while-revalidate=300` |
| Ventana cerrada (`to < ayer AST`) | `Cache-Control: private, max-age=86400` |
| `degraded` o `warnings` no vacío | `Cache-Control: no-store` |

Mismo criterio de "histórico inmutable / rolling refresca" que `overview_period_insights` y `metric_insights_cache`, pero sin tabla de caché: aquí el caché es HTTP, y el número compartido con la lista se recalcula siempre.

---

## 10. Verificación antes de dar por buena la corrida

```sql
-- Paridad exacta nube↔lista: mismo N con los mismos params
--   /api/eco-mentions?period=7D&sentiment=negativo&limit=1  → total
--   /api/eco-wordcloud?period=7D&sentiment=negativo         → scope.total
-- Deben ser IDÉNTICOS. Test de integración obligatorio sobre 6 combinaciones de filtros.

-- Cobertura del índice (debe ser ~100% tras el backfill)
SELECT COUNT(*) AS sin_indexar
  FROM mentions m LEFT JOIN mention_terms mt ON mt.mention_id = m.id
 WHERE mt.mention_id IS NULL AND m.is_duplicate = false;

-- Ninguna clave sin forma de superficie (si >0, la nube pierde términos)
SELECT COUNT(*) FROM (
  SELECT DISTINCT t.lexeme k FROM mention_terms mt, LATERAL unnest(mt.tsv) t LIMIT 20000) u
 WHERE NOT EXISTS (SELECT 1 FROM wordcloud_forms f WHERE f.stem = u.k);
```
Nota de operación: `eco-metrics-calculator` y `eco-migration` tienen **drift bundle-vs-git** documentado en `CLAUDE.md`. Descargar y diffear el bundle vigente antes de redeployar cualquiera de los dos.

## Decisiones

**Índice invertido precalculado por mención (mention_terms.tsv) + agregación viva en la request, sin tabla de caché de respuesta**

- *Por qué:* Medido en prod: el parseo del texto cuesta 4.23 s para 41,445 docs, pero el unnest + GROUP BY sobre los 1,260,629 lexemas resultantes cuesta ~0 s (3.89 s la query completa vs 4.23 s solo el parseo). Precalcular el tsvector convierte la query en <1 s y ocupa 13 MB por año-agencia (~40 MB total sobre 17.5 GB libres), inline sin TOAST (330 bytes/fila).
- *Alternativas descartadas:* (a) Todo en la request: 34 s medidos para 2,290 docs con bigramas, 12.9 s para 41k con unigramas. (b) Materializar la nube por combinación de filtros: el cartesiano sentiment×source×topic×region×emotion×q×periodo no es enumerable. (c) Tabla de caché al estilo metric_insights_cache: crearía una segunda fuente de verdad para scope.total, que es exactamente F9. (d) Columna generada STORED sobre mentions: reescribiría 1,833 MB con ACCESS EXCLUSIVE sobre la tabla más caliente y no puede contener frases dependientes de diccionario.

**Modo por defecto = 'distinctive' con log-odds ratio y prior de Dirichlet informativo (a0=500), no frecuencia cruda**

- *Por qué:* Medido en gobernadora 365d, los seis términos más frecuentes son los propios términos del boolean de Brandwatch (gonzález 36,649 · jenniffer 34,819 · gobernadora 33,803 · colón 22,841 · puerto · rico) seguidos de https/com/www/photos/from/post. La misma agencia con log-odds 7D vs 90D previos devuelve en 2.06 s: sequía, emergencia, agua, embalse, Guardia Nacional, orden ejecutiva, Carraízo, severa, lluvia — la noticia real de la semana.
- *Alternativas descartadas:* TF-IDF: el IDF contra el corpus de la propia agencia castiga los términos de identidad pero no distingue periodo de periodo, que es la pregunta del cliente. Frecuencia cruda: descartada por la medición. Se mantiene 'frequent' como conmutador porque el cliente lo va a pedir.

**No instalar unaccent ni pg_trgm**

- *Por qué:* Verificado que el stemmer Snowball español de Postgres ya remueve los acentos agudos como último paso: educación→educ, Loíza→loiz, Sequía→sequ, González→gonzalez, y conserva la ñ (niños→niñ, mañana→mañan). Ninguna parte del diseño hace fuzzy match.
- *Alternativas descartadas:* Instalar unaccent: extensión más en un stack con solo plpgsql+vector, sin ganancia funcional medible.

**La métrica base es DF (document frequency), no TF**

- *Por qué:* Medido: en instagram_public y varias filas de facebook_public el snippet es literalmente idéntico al title, y los snippets de noticias empiezan con '...' repitiendo la frase del título. Con TF cada término de esas menciones cuenta doble. Con DF la duplicación intra-documento es inocua. La prominencia se recupera con los pesos A/B/C/D del tsvector (verificado que sobreviven a || y a unnest).
- *Alternativas descartadas:* TF o TF ponderado por engagementScore: un solo post viral redimensiona y recolorea un término entero, convirtiendo la nube en un reflejo de un post en vez del discurso.

**Stopwords declaradas como SUPERFICIES expandidas por ts_lexize en la query, más un array de tallos crudos; lista quirúrgica y no agresiva**

- *Por qué:* Verificado que el stemmer es inconsistente entre inflexiones (anuncia→anunci pero anunció→anunc; declaró→declar pero declara→decl), así que una lista escrita a mano en tallos deja agujeros — en la corrida de prueba se colaron 'decl' y 'anunc'. Y verificado que colisiona (parte/partido→part, pública/publicación→public, autoridad→autor), así que una lista agresiva mataría 'partido', término legítimo en un dashboard de gobierno. El filtro se aplica en tiempo de query, no de indexado: cambiar la lista es un deploy, no un rebuild de 115k filas.
- *Alternativas descartadas:* Lista de tallos hardcodeada (agujeros por inconsistencia del stemmer). Codegen de tallos por script (round-trip a DB en build; innecesario, expandir 200 superficies en la query cuesta ~0 ms). Tabla en DB editable por el cliente (F9 en potencia: la nube dependería de estado no versionado).

**Frases mediante diccionario minado en batch (PMI≥3.0 + adhesión≥0.30 + df≥max(5, 0.15%N)) inyectado en el tsvector con peso D; el colapso bigrama/unigrama se resuelve en TS con umbral 0.35 de vida propia**

- *Por qué:* La expansión de bigramas mide 3.0 ms/doc (34.2 s para 2,290 docs, 6.8 s solo el generate_subscripts de 139,694 pares): imposible en caliente, trivial en batch. Los umbrales, probados sobre 30D de gobernadora, conservan 'francisco domenech', 'itza garcía', 'órdenes ejecutivas', 'director ejecutivo', 'guardia nacional', 'rivera schatz' y descartan 'photos from', 'from jenniffer', 'post photos', 'noticioso puerto'. Como el tsvector del documento contiene unigramas y frases a la vez, df(unigrama) ≥ df(frase) siempre, y la resta df−df_frase es una medida sana de vida propia.
- *Alternativas descartadas:* ts_stat(): recibe la query como texto, no acepta parámetros → obligaría a interpolar el WHERE con los filtros del usuario (inyección SQL). Bigramas sin filtro de colocación: infla mention_terms y llena la nube de pares colaterales. Umbral de subsunción por unión exacta de todas las frases: requiere posiciones y un segundo pase; la aproximación por mejor-frase se declara en debug.approx.

**Extraer buildMentionScope() de eco-mentions/route.ts a apps/web/src/lib/mention-scope.ts y que ambas rutas lo importen**

- *Por qué:* El endpoint de la nube debe aceptar los mismos 19 parámetros que la lista y resolverlos con el MISMO código, no con una copia. F9 está medido en prod (47 vs 54, ≈13%) y su causa es precisamente dos implementaciones del mismo universo. Además scope.total se calcula vivo en la misma request con el mismo whereClause, así que el único número compartido con la lista nunca puede divergir ni por caché.
- *Alternativas descartadas:* Reimplementar los filtros en la ruta nueva: divergirá la primera vez que alguien toque un filtro en un solo archivo. Cachear también scope.total: reintroduce la segunda fuente de verdad.

**Sentimiento por término = promedio sin ponderar de s∈{-1,0,+1}, con umbral df≥8 y sentCi≤0.50 para que el color sea confiable; por debajo el término se pinta con --text-2 pero NO se oculta**

- *Por qué:* Con df<8 un solo cambio de clasificación mueve el promedio ≥0.25, más que el ancho de cualquier banda de color útil. El tamaño del término (df o z) sigue siendo válido aunque su color no lo sea, así que ocultarlo perdería información real. Reutiliza literalmente effectiveSentimentSql (eco-mentions/route.ts:77) y pillFromSentiment (45-49) vía el módulo compartido, si no la nube clasificaría negativo lo que la lista muestra neutral.
- *Alternativas descartadas:* Ponderar por engagement (un post viral recolorea el término). Ocultar términos con muestra chica (pierde señal de volumen). Umbral df≥3 (banda de error mayor que la escala de color).

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-WC-1` | P0 | M | Extraer buildMentionScope() a módulo compartido (fix estructural de F9) | `apps/web/src/lib/mention-scope.ts (nuevo) · apps/web/src/app/api/eco-mentions/route.ts (líneas 20-23, 31-92, 1` | — |
| `WS-WC-2` | P0 | S | Schema + DDL de mention_terms, wordcloud_forms y wordcloud_phrases | `packages/database/src/schema/wordcloud.ts (nuevo) · packages/database/src/schema/index.ts (añadir export) · pa` | — |
| `WS-WC-3` | P0 | S | Módulo de stopwords y normalización compartido | `packages/shared/src/wordcloud/stopwords.ts (nuevo) · packages/shared/src/wordcloud/normalize.ts (nuevo) · pack` | — |
| `WS-WC-4` | P0 | M | Builder incremental del índice invertido dentro de eco-metrics-calculator | `infra/lambda/metrics-calculator/index.ts · infra/lambda/metrics-calculator/wordcloud-index.ts (nuevo) · infra/` | WC-2, WC-3 |
| `WS-WC-5` | P0 | S | Backfill del índice (115,425 menciones) | `infra/lambda/migration/… acción `backfill-wordcloud-terms`` | WC-4 |
| `WS-WC-6` | P1 | L | Minería del diccionario de frases + refresco de formas | `infra/lambda/ai-tasks/index.ts (acción `wordcloud-phrases`) · infra/lambda/ai-tasks/wordcloud-phrases.ts (nuev` | WC-4 |
| `WS-WC-7` | P0 | L | Endpoint GET /api/eco-wordcloud | `apps/web/src/app/api/eco-wordcloud/route.ts (nuevo)` | WC-1, WC-3, WC-4 |
| `WS-WC-8` | P0 | M | Puntuación y colapso en TS con unit tests sin DB | `packages/shared/src/wordcloud/score.ts (nuevo) · packages/shared/src/wordcloud/score.test.ts` | WC-3 |
| `WS-WC-9` | P0 | S | Test de paridad nube↔lista | `apps/web/src/app/api/__tests__/wordcloud-parity.test.ts (nuevo)` | WC-7 |
| `WS-WC-10` | P1 | S | Observabilidad: lag del índice y alarma | `infra/lib/monitoring-stack.ts · apps/web/src/app/api/eco-wordcloud/route.ts (warnings)` | WC-4, WC-7 |
| `WS-WC-11` | P2 | M | P2: emoji, trigramas y conmutador de ponderación | `packages/shared/src/wordcloud/normalize.ts · infra/lambda/ai-tasks/wordcloud-phrases.ts · apps/web/src/app/api` | WC-6, WC-7 |

## Riesgos

- El display form es el punto de fallo cara al cliente: si wordcloud_forms no tiene la fila, el término se omite (nunca se muestra 'permis' ni 'ventanill'). Con el builder incremental cada 5 min la ventana es corta, pero un fallo silencioso de ese job vacía la nube en vez de degradarla visiblemente. Mitigación: el campo warnings incluye 'index_lag' cuando >2% del scope no está indexado, y hace falta una alarma CloudWatch sobre el conteo de menciones sin fila en mention_terms.
- R3 — colisiones del stemmer con daño colateral: 'autoridad'→'autor' (stopwordear AAA mata 'autor'), 'parte'/'partido'→'part' (mata 'partido', término político legítimo), 'pública'/'publicación'→'public'. Por eso 'part' va comentado y para AAA hay que stopwordear la FRASE 'autoridad acueductos' en vez del unigrama. Cada entrada nueva de la lista necesita verificarse con ts_lexize antes de añadirse.
- Las frases llegan con hasta 3 h de retraso (job delta cada 3 h; refresco completo diario a las 05:20 UTC): una frase de última hora ('sequía severa') aparece como dos unigramas hasta que corra la minería. Es honesto pero hay que exponerlo en lag.phrasesThrough y el front debe poder decirlo.
- db.t4g.medium es burstable con 2 vCPU y work_mem de 4 MB. El backfill (≈6.3 min de CPU) y la minería nocturna (≈1 min) consumen créditos de CPU que hoy usan eco-ingestion (cada 5 min), eco-narrative-cluster (2×/hora, 900 s) y eco-metrics-calculator. Hay que correr el backfill en trozos por día y vigilar CPUCreditBalance; si el crédito se agota, las latencias del dashboard entero suben.
- Ventana 'Max' (730 d, 87k menciones) con mode=distinctive hace dos pases completos: estimado ~2.5 s, por encima de un presupuesto cómodo. El statement_timeout de 8 s protege de lo peor, pero conviene que el front no ofrezca la nube por defecto en Max, o que el endpoint degrade a mode=frequent con un solo pase (campo degraded:true).
- nlp_summary tiene cobertura 100% y es tentador como fuente principal, pero su plantilla ('Reportaje informativo sobre…', 'Publicación de… compartiendo fotos de un post de…', 'sin valoración editorial') inundaría la nube. Si alguien cambia el prompt del processor, el vocabulario de fallback cambia con él y hay que revisar las stopwords de plataforma.
- La subsunción bigrama/unigrama usa la MEJOR frase, no la unión de todas las que contienen el término: un unigrama presente en tres frases distintas puede sobrevivir con un df residual inflado. Es una aproximación declarada (debug.approx) y solo se puede corregir guardando posiciones y haciendo un segundo pase.
- Si se cambia la receta de extracción hay que subir mention_terms.recipe y esperar el re-indexado incremental completo (≈6 min de CPU repartidos): durante ese periodo conviven filas con recetas distintas y la nube mezcla normalizaciones. El builder debe procesar recipe<CURRENT con prioridad sobre las filas nuevas, o la mezcla puede durar días.


---

# Nube de palabras de Menciones — render, interacción, layout y diseño visual (SPA `eco-prototype`)

## Resumen

La nube tipo Wordle es la peor forma conocida de comparar magnitudes: el área no es perceptualmente lineal, la rotación y el empaque azaroso introducen dos variables visuales sin significado, y no admite orden ni comparación entre términos no adyacentes. El cliente la pidió, así que la entrego — pero "bien hecha" solo tiene una definición defendible: un componente `TermsCloud` de **dos vistas hermanas** (Nube y Ranking) que comparten datos, selección y estado, donde la nube gasta sus canales libres en lo que las nubes desperdician (sentimiento en color de texto, novedad en un punto, Δ en el tooltip) y el Ranking es a la vez la vista precisa y la alternativa accesible. Rechazo d3-cloud por CDN: usa `Math.random()` interno, así que el layout salta en cada render y el usuario pierde la orientación espacial — el defecto más caro de la forma. Recomiendo un layout **determinista sin RNG** escrito a mano (~120 líneas): empaque por filas centradas con orden serpentina (el mayor al centro), medición por `canvas.measureText`, cero rotación, y HTML posicionado en absoluto en vez de SVG — lo que da botones nativos, `aria-pressed`, área táctil de 44px vía `.touch-target` y evita añadir un décimo SVG sin `<title>`. Medí los colores: la escala `--div-*` de `tokens.css` NO sirve para texto (`--div-mid` #4A515B = 2.27:1 sobre `--canvas`; en claro `--div-pos-1` = 2.18:1), así que especifico cinco tokens `--wc-*` nuevos con contraste verificado donde la extremidad del sentimiento se codifica en **saturación, no en luminosidad**. También medí que atenuar los términos no seleccionados es inviable: incluso a 0.70 de opacidad `--wc-neg-2` cae a 3.39:1, así que la selección se expresa solo sumando (relleno + anillo inset), nunca restando. La interacción se ancla al contrato real de `/api/eco-mentions` (route.ts:226-236: tokens ≥2 chars, tope 8, AND): click hace toggle y filtra la lista de la misma pantalla vía un `filters.terms` nuevo — no abre `MentionsSliceModal`, porque la lista ya está 200px más abajo. Va entre la rejilla de `QuickMetric` (screens.js:964) y la card "Menciones" (screens.js:967), colapsable, y en móvil arranca en Ranking.

## 0 · Contrato del backend (ASUMIDO — lo entrega otro agente)

Este documento **no** especifica el endpoint. Asumo que existe `GET /api/eco-terms` que acepta los mismos parámetros de ventana que el resto (`window.ecoGetPeriodParams()` + `agency`) más `metric`, `unit`, `limit`, y devuelve:

```ts
type TermsResponse = {
  terms: Array<{
    term: string;            // ya normalizado y sin stopwords
    count: number;           // ocurrencias en la ventana
    docCount: number;        // menciones distintas que lo contienen
    score: number;           // puntuación de distintividad (log-odds / TF-IDF)
    sentiment: { pos: number; neu: number; neg: number };
    netSentiment: number;    // (pos - neg) / (pos + neu + neg), −1..1
    prevCount: number | null;// mismo término, ventana previa; null = sin baseline
    deltaPct: number | null; // null ≠ 0 (contrato de nulos, F4)
    isNew: boolean;          // ausente de la ventana previa
  }>;
  total: number;             // menciones consideradas
  metric: 'frequent' | 'distinctive';
  unit: 'unigram' | 'phrase';
  windowFrom: string; windowTo: string;   // ISO, para el pie de la card
  excluded: { lowPertinence: number; duplicates: number };
};
```

Requisitos que el front impone al backend y que hay que confirmar con el otro agente:

| # | Requisito | Por qué |
|---|---|---|
| B1 | `deltaPct: null` cuando no hay baseline, **nunca 0** | F4: hoy no se distingue hueco de cero real |
| B2 | `terms` llega **ya ordenado desc** por la métrica pedida | El layout determinista depende del orden; ordenar en el cliente duplica la verdad |
| B3 | `term` nunca vacío ni de 1 carácter | `/api/eco-mentions` route.ts:228 descarta tokens `length < 2` en silencio: un término de 1 char sería inclicable |
| B4 | `netSentiment` calculado sobre el mismo universo que la lista (excluye `is_duplicate` y pertinencia baja) | F9: dos fuentes rivales medidas en 47 vs 54 en prod |
| B5 | Tope `limit ≤ 60` | Sobre 60 el layout descarta más de lo que muestra |

---

## 1 · Crítica de la forma y decisión

### 1.1 Qué está mal con una nube (sin adornos)

| Defecto | Mecanismo | Consecuencia en ECO |
|---|---|---|
| El área no es lineal | El lector juzga **altura de x**, no área; y la percepción de área tiene exponente ~0.7 | Un término con 3× el conteo se ve ~1.7× más alto. Nadie puede leer "3×" |
| El ancho contamina el tamaño | Una palabra larga ocupa más superficie con el mismo conteo | "reconstrucción" (60) parece dominar a "agua" (180) |
| El empaque azaroso codifica falso | La posición central se lee como importancia, pero es artefacto del algoritmo | El director interpreta jerarquía donde no hay ninguna |
| La rotación destruye la lectura | Texto a 90° cuesta ~2× en tiempo de lectura | Media nube ilegible sin girar la cabeza |
| No hay orden | Ninguna operación de "el 3.º más frecuente" | La pregunta real del usuario no tiene respuesta |
| No se puede comparar a distancia | Dos términos en esquinas opuestas no son comparables | Sin ranking, la nube es solo decoración |
| Inestabilidad | Layouts con RNG cambian en cada render | Se pierde la memoria espacial, que es lo único que una nube da gratis |

### 1.2 Las tres opciones y la recomendación

| Opción | Veredicto |
|---|---|
| **Nube pura** (tamaño = conteo, y nada más) | **No.** Gasta el único componente nuevo de la pantalla en cero información accionable. Los canales color/posición/decoración quedan vacíos |
| **Nube enriquecida** (color = sentimiento, punto = novedad, Δ en tooltip) | Necesaria pero insuficiente: sigue sin poder ordenar ni comparar magnitudes |
| **Componente de dos vistas** con datos y selección compartidos | ✅ **RECOMENDADA** |

**Recomendación: `TermsCloud` con dos vistas hermanas — `cloud` (nube enriquecida) y `rank` (barras ordenadas) — que comparten `terms`, `selected`, `metric`, `unit` y el mismo tooltip.** El toggle es un `.chip` idéntico al `ViewToggle` de Menciones (screens.js:745-758), así que el usuario ya conoce el gesto.

Justificación en una línea: **la nube es la puerta de entrada (reconocimiento de patrón en 300 ms) y el Ranking es la respuesta (magnitud exacta, orden, comparación).** Cada una hace lo que la otra no puede; una nube sola es una gráfica sin eje, un ranking solo es lo que el cliente rechazó. Y el Ranking, gratis, resuelve la accesibilidad (§4.4) y el móvil (§3.7).

Lo que la nube codifica y por qué:

| Canal | Codifica | Nota |
|---|---|---|
| Tamaño de letra | `count` (o `score`) por `sqrt` normalizado | Con la advertencia explícita en el pie: "el tamaño es aproximado; usa Ranking para comparar" |
| Color del texto | `netSentiment`, 5 pasos divergentes | §4.2. Tokens nuevos `--wc-*` |
| Punto superior derecho | `isNew` | §4.3 |
| Relleno + anillo inset | selección | Nunca color: el color ya es sentimiento |
| Posición | **nada** | Se declara: "la posición no significa nada" en el `<desc>` y en el pie |
| Rotación | **nada — no hay rotación** | |

---

## 2 · Algoritmo de layout

### 2.1 Evaluación

| Opción | Veredicto |
|---|---|
| (a) Espiral tipo Wordle a mano, colisión por bounding box o sprite | No. ~200 líneas, O(n·spiral), y **el empaque espiral necesita un orden de inserción aleatorio para no producir una diagonal**; con orden fijo produce artefactos. Además la animación de transición es imposible: mover un término reordena todo |
| (b) d3-cloud por CDN con `integrity` | **No.** Tres razones duras: (1) usa `Math.random()` internamente para el punto de partida en la espiral → **el layout cambia en cada render**, que es el peor defecto de la forma; (2) es asíncrono (`cloud().on('end')` con `setInterval`), lo que obliga a un estado extra y rompe el ciclo de render de React 18; (3) mide con un `<canvas>` de sprites de 2048×2048 en cada corrida. El precedente Leaflet (`index.html:14-15`) es válido para un mapa de tiles, no para 25 palabras |
| (c) **Layout determinista de filas centradas ("serpentina")** | ✅ **RECOMENDADO.** ~120 líneas, sin dependencias, sin RNG, O(n), FLIP trivial porque cada término tiene una celda con `x`/`y` estable |

**Precedente que NO hay que repetir:** `TopicBubbles` (screens.js:2115-2145) llama "determinista" a `Math.sin(i * 9973) * 10000` — pero depende del **índice del array**, así que si el backend reordena un tópico, todas las burbujas saltan. Determinismo real = la posición depende del **contenido**, no de la posición en el array.

### 2.2 Escala de tamaño

```js
// fsMin/fsMax vienen de tokens (§4.1). sqrt del valor NORMALIZADO:
// un término con el máximo va a fsMax, uno con el mínimo a fsMin, y el
// crecimiento es cóncavo — corrige parcialmente la sobre-lectura del área.
function sizeScale(vals, fsMin, fsMax) {
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  if (vMax === vMin) return () => Math.round((fsMin + fsMax) / 2);
  return (v) => {
    const n = (Math.max(vMin, Math.min(vMax, v)) - vMin) / (vMax - vMin); // 0..1
    return Math.round(fsMin + (fsMax - fsMin) * Math.sqrt(n));
  };
}
```

Rechazado: escala por **rango** (posición 1..N → tamaño). Es más bonita y miente: aplana una distribución de cola larga y hace que el #1 con 400 menciones y el #2 con 12 parezcan vecinos.

### 2.3 Medición (un solo canvas, con caché)

```js
const _mctx = document.createElement('canvas').getContext('2d');
const _mcache = new Map();               // 'peso|px|término' → ancho
function measureTerm(term, px, weight) {
  const k = weight + '|' + px + '|' + term;
  let w = _mcache.get(k);
  if (w == null) {
    _mctx.font = weight + ' ' + px + 'px Krub, -apple-system, sans-serif';
    w = _mctx.measureText(term).width;
    _mcache.set(k, w);
  }
  return w;
}
```
Krub se carga por `<link>` en `index.html:10`; medir antes de que la fuente esté lista da anchos de la fallback. Guarda: `document.fonts.ready.then(() => { _mcache.clear(); forceRelayout(); })` una sola vez al montar.

### 2.4 Pseudocódigo del layout

```js
// terms: YA ordenados desc por metric (B2). Sin RNG en ninguna línea.
function layoutTerms(terms, opts) {
  const { width, fsMin, fsMax, metric, colGap = 10, rowGap = 6, maxRows = 7 } = opts;
  const size = sizeScale(terms.map(t => t[metric]), fsMin, fsMax);

  // 1) cajas. padX 6 a cada lado (relleno del chip), altura = 1.18em + 8
  const boxes = [];
  for (const t of terms) {
    let fs = size(t[metric]);
    let w = measureTerm(t.term, fs, 500) + 12;
    // término más ancho que el contenedor: reducir hasta fsMin, luego elidir
    while (w > width && fs > fsMin) { fs -= 1; w = measureTerm(t.term, fs, 500) + 12; }
    let label = t.term;
    if (w > width) { label = t.term.slice(0, 26) + '…'; w = measureTerm(label, fs, 500) + 12; }
    if (w > width) continue;                       // imposible: se descarta (cuenta en dropped)
    boxes.push({ t, label, fs, w, h: Math.round(fs * 1.18) + 8 });
  }

  // 2) reparto greedy en filas EN ORDEN DE RANGO: fila 0 = rangos 1..k
  const rows = []; let row = { items: [], w: 0, h: 0 };
  for (const b of boxes) {
    const add = row.items.length ? colGap + b.w : b.w;
    if (row.items.length && row.w + add > width) {
      rows.push(row);
      if (rows.length >= maxRows) { row = null; break; }
      row = { items: [], w: 0, h: 0 };
    }
    row.w += row.items.length ? colGap + b.w : b.w;
    row.items.push(b);
    row.h = Math.max(row.h, b.h);
  }
  if (row && row.items.length) rows.push(row);

  // 3) orden VERTICAL serpentina: fila 0 al centro, 1 arriba, 2 abajo, 3 arriba…
  const above = [], below = [];
  rows.forEach((_, i) => { if (i) (i % 2 ? above : below).push(i); });
  above.reverse();
  const vOrder = [...above, 0, ...below];

  // 4) posiciones absolutas; dentro de la fila el mayor va al CENTRO
  const placed = []; let y = 0;
  for (const ri of vOrder) {
    const r = rows[ri];
    let x = Math.round((width - r.w) / 2);         // fila centrada
    for (const b of centerOut(r.items)) {
      placed.push({ ...b, x, y: y + Math.round((r.h - b.h) / 2) });
      x += b.w + colGap;
    }
    y += r.h + rowGap;
  }
  return { placed, height: Math.max(0, y - rowGap), dropped: terms.length - placed.length };
}

// [a,b,c,d,e] (desc) → orden de pintado izq→der con `a` al centro: d b a c e
function centerOut(items) {
  const L = [], R = [];
  for (let i = 1; i < items.length; i++) (i % 2 ? R : L).push(items[i]);
  return [...L.reverse(), items[0], ...R];
}
```

### 2.5 Determinismo y memo

Cero llamadas a `Math.random()`. Las únicas entradas son `(lista ordenada, ancho, fsMin, fsMax, metric)`. Memo:

```js
const key = width + '|' + fsMin + '|' + fsMax + '|' + metric + '|' + unit + '|' +
            terms.map(t => t.term + ':' + t[metric]).join(',');
const layout = React.useMemo(() => layoutTerms(terms, opts), [key]);
```
Consecuencia deseada: cambiar de vista, seleccionar, pasar el ratón o abrir/cerrar el drawer **no mueve una sola palabra**. Solo un cambio real de datos o de ancho re-hace el layout. El ancho viene de `useChartWidth` (charts.js:75-94) — hay que **cuantizarlo a múltiplos de 8px** (`Math.floor(w / 8) * 8`) para que un scrollbar de 1px no re-empaquete toda la nube.

### 2.6 Cuando un término no cabe

| Caso | Comportamiento |
|---|---|
| Más términos que filas (`maxRows`) | Se descartan los de rango más bajo. Chip al pie: **"+{dropped} términos"** que cambia a la vista Ranking (no un "ver más" que expanda la nube: eso rompería la altura estable de la card) |
| Un término más ancho que el contenedor | Baja de `fs` hasta `fsMin`; si sigue sin caber, se elide a 26 chars + `…`, con el término íntegro en `aria-label` y en el tooltip |
| `terms.length < 8` | La nube no se dibuja: se renderiza el Ranking con un aviso (§3.6) |

---

## 3 · Interacción — "bien dinámico"

### 3.1 Firma del componente

```jsx
// nuevo archivo: apps/web/public/eco-prototype/cloud.js
// export: window.ECO_CLOUD = { TermsCloud }
function TermsCloud({
  terms,              // TermsResponse['terms'] — ya ordenados
  total,              // TermsResponse.total, para el % del tooltip
  loading, error,
  metric, setMetric,  // 'frequent' | 'distinctive'
  unit, setUnit,      // 'unigram' | 'phrase'
  selected,           // string[] — controlado por MentionsScreen
  onToggleTerm,       // (term: string) => void
  onOpenAside,        // (term: string) => void   → MentionsSliceModal
  windowLabel,        // 'jul 21 – jul 27' para el pie
})
```

### 3.2 Hover y focus → un mismo tooltip

`onMouseEnter` y `onFocus` abren el mismo panel; `onMouseLeave`/`onBlur` lo cierran. Que el foco de teclado lo abra no es un extra: es la única forma de que un usuario de teclado obtenga el Δ.

Posición: `position: fixed`, anclado al `getBoundingClientRect()` del término, `top - 8` con volteo a `bottom + 8` si `top < 120`; clamp horizontal a `[8, innerWidth - w - 8]`. Fondo `--surface-overlay`, borde `--hairline-strong`, radio `--r-lg`, sombra `--shadow`, `pointer-events: none`, `z-index: 90` (por debajo de `MentionsSliceModal`, que usa 2001 en shell.js:1215).

Contenido (5 filas, ancho fijo 240px):

| Fila | Contenido | Estilo |
|---|---|---|
| 1 | el término íntegro | `.t-title-md`, color = su color de sentimiento |
| 2 | `{count} menciones · {pct}% del total` | `.t-caption`, cifra en `.num` |
| 3 | barra de 3 segmentos pos/neu/neg + los 3 conteos | idéntica al patrón de screens.js:2102-2106 |
| 4 | `Δ vs periodo previo: ↑ 34%` · o `Sin dato previo` si `deltaPct == null` | flecha + `--pos`/`--neg`; **nunca "0%" cuando es null** (F4) |
| 5 | `Nuevo en este periodo` si `isNew`; `Aparece en {docCount} menciones` si no | `.t-caption` + punto `--wc-new` |

### 3.3 Click → toggle de selección que filtra la lista de la misma pantalla

**Decisión: click hace toggle y filtra la lista de menciones que está debajo. NO abre `MentionsSliceModal`.**

Justificación de consistencia: `MentionsSliceModal` (shell.js:1156) existe para agregados que **no tienen la lista al lado** — heatmap (screens.js:691), mapa (charts.js:731), termómetro (screens.js:4208), virales (screens.js:874-881). La nube vive **dentro** de `MentionsScreen`, a ~200px de una lista paginada de 25 con tres modos de vista. Abrir un modal con 20 menciones encima de una lista de las mismas menciones es un patrón peor. Para el caso "quiero verlo aparte", **Alt+click** (o el ítem "Ver aparte" del menú contextual) llama `onOpenAside(term)` → `setSlice({ eyebrow:'Término', title: term, accent:'var(--accent)', _filter:{ q: term } })`, que es exactamente la forma que `MentionsSliceModal` ya consume (shell.js:1179-1197).

### 3.4 Multi-selección — atada al contrato real

`/api/eco-mentions` route.ts:226-236: `q.trim().split(/\s+/).filter(t => t.length >= 2).slice(0, 8)` y **AND** entre tokens sobre `title|snippet|url|original_url|domain`. Consecuencias, todas verificadas en el fuente:

1. **Tope duro de 8 tokens.** El 9.º se descartaría en silencio. La nube debe frenar en `MAX_SELECTED = 8 - (tokens de la caja de búsqueda)` y, al alcanzarlo, dejar los no seleccionados con `aria-disabled="true"` y un tooltip "Máximo 8 términos combinados".
2. **Solo existe AND.** No hay `qMode=any`. **No pongas un conmutador AND/OR que no funcione** — sería el sexto comando fantasma después de los cinco de S-04. Si el cliente lo quiere, es un cambio de backend (`qMode`), no de front.
3. **Una frase seleccionada se convierte en AND de sus palabras.** "ayuda federal" busca `ayuda` AND `federal`, no la frase adyacente. Con `unit='phrase'` hay que **declararlo en la barra de criterios**: `frase: "ayuda federal" (aproximada)`, o pedir soporte de comillas al backend.

Integración con el estado existente — **hay una trampa**: el debounce de screens.js:805-811 sobrescribe `filters.q` 300 ms después de cada tecla, así que escribir la selección en `filters.q` la borraría. Solución:

```js
// screens.js:789 — añadir `terms: []` al estado inicial
const [filters, setFilters] = useState({
  q: '', terms: [], sentiment:'all', source:'all', topic:'', region:'', sortBy:'recent',
});
// screens.js:831 — componer q en el fetch, sin tocar queryInput
const qAll = [filters.q, ...filters.terms].filter(Boolean).join(' ');
if (qAll) params.set('q', qAll);
// screens.js:815 — reset de página también con terms
React.useEffect(() => { setPage(1); }, [filters.sentiment, filters.source, filters.topic,
                                        filters.region, filters.sortBy, filters.terms.join('|')]);
// screens.js:872 — el resaltado hereda los términos gratis
const searchTerms = qAll ? qAll.trim().split(/\s+/).filter(t => t.length >= 2) : [];
```
Con esto `HL` (screens.js:1109) resalta los términos seleccionados dentro de los títulos sin una línea extra. El efecto de fetch ya depende de `[filters, page, reloadKey]` (screens.js:847), así que la lista se recarga sola.

Barra de criterios: cada término seleccionado aparece como pill removible (×) sobre los resultados, junto a un botón "Limpiar términos". Esto es el mismo hueco que S-03 pide para tópico/región/período — el mismo componente sirve para los tres.

### 3.5 Animación — valores exactos de `tokens.css`

| Evento | Propiedad | Duración | Easing |
|---|---|---|---|
| Entrada del término (montaje) | `opacity 0→1`, `translateY(4px)→0` | `--dur-slow` (340ms) | `--ease-out` |
| Stagger de entrada | `animation-delay = min(i * 12ms, 180ms)` en orden de **rango**, no espacial | — | — |
| Cambio de posición (FLIP) | `transform: translate()` | `--dur` (220ms) | `--ease-in-out` |
| Cambio de tamaño | `font-size` | `--dur-slow` (340ms) | `--ease-out` |
| Hover / foco | `background-color` | `--dur-fast` (140ms) | `--ease` |
| Selección | `background-color`, `box-shadow` | `--dur-fast` (140ms) | `--ease` |

FLIP: **no escalar el nodo entero** (el texto se ve borroso a mitad de la transición). Se anima `transform: translate()` para la posición y `font-size` aparte:

```jsx
const nodes = React.useRef(new Map());   // term → HTMLElement
const prev  = React.useRef(new Map());   // term → {x, y}
React.useLayoutEffect(() => {
  for (const b of layout.placed) {
    const el = nodes.current.get(b.t.term); if (!el) continue;
    const p = prev.current.get(b.t.term);
    if (p && (p.x !== b.x || p.y !== b.y)) {
      el.style.transition = 'none';
      el.style.transform = `translate(${p.x - b.x}px, ${p.y - b.y}px)`;
      void el.offsetWidth;                                     // reflow forzado
      el.style.transition = 'transform var(--dur) var(--ease-in-out), font-size var(--dur-slow) var(--ease-out)';
      el.style.transform = 'translate(0, 0)';
    }
    prev.current.set(b.t.term, { x: b.x, y: b.y });
  }
}, [layout]);
```
`prefers-reduced-motion`: `tokens.css:145-152` ya pone las cuatro duraciones a `0ms`, así que la transición se anula sola. Falta lo que los tokens no cubren: envolver el stagger y el `translateY` de entrada en una comprobación de `window.matchMedia('(prefers-reduced-motion: reduce)').matches` y, si aplica, `animation: none; animation-delay: 0s`.

**Salida sin animación (recorte deliberado):** animar la desaparición exige mantener nodos fantasma en el árbol y un segundo estado. No vale el costo; los términos que salen desaparecen en el mismo frame. Decláralo, no lo disimules.

### 3.6 Conmutadores y estados

Dos controles independientes en la cabecera de la card, con el estilo de `SortChips` (screens.js:763-783):

| Control | Opciones | Sub-etiqueta explicativa (obligatoria) |
|---|---|---|
| Métrica | `Frecuente` · `Distintivo` | "Frecuente: lo más repetido. Distintivo: lo que sobresale contra el periodo previo." |
| Unidad | `Palabra` · `Frase` | "Frase: pares de palabras que aparecen juntas." |
| Vista | `Nube` · `Ranking` (iconos `Grid`/`List` de `Icons`) | — |

Ambos persisten en `localStorage`: `eco.cloudMetric`, `eco.cloudUnit`, `eco.cloudView`, `eco.cloudOpen`.

Estados:

| Estado | Condición | Render |
|---|---|---|
| Cargando | `loading` | Esqueleto: 18 rectángulos con la clase `skeleton` ya existente (index.html:~426), en el mismo layout de filas centradas y con anchos de la última nube conocida — no salta al llegar el dato |
| Vacío | `terms.length === 0` | "Sin términos suficientes en este periodo." + botón "Ampliar a 30 días" que llama `window.ecoSetPeriod('1M')` |
| Insuficiente | `1 ≤ terms.length < 8` | Fuerza vista Ranking con el aviso: "Solo {n} términos en la ventana: la nube no es legible con tan pocos." La nube queda deshabilitada, no oculta |
| Error | `error` | Mismo patrón que screens.js:981-986: mensaje `--neg` + chip "Reintentar" |
| Ventana sin baseline | todos los `deltaPct == null` | El pie dice "Sin periodo previo comparable" y no se pinta ningún Δ |

Pie de la card, siempre (paga la deuda de honestidad de S-01/S-02):
`{n} términos · {windowLabel} · el tamaño es aproximado — usa Ranking para comparar · se excluyeron {excluded.lowPertinence} de baja pertinencia y {excluded.duplicates} duplicados`

### 3.7 390px

| Dimensión | ≤768px (`window.ecoBp() === 'mobile'`) | >1024px |
|---|---|---|
| Vista por defecto | **`rank`** | `cloud` |
| Card colapsada al entrar | Sí (`eco.cloudOpen` default `false`) | No |
| `maxTerms` | 24 | 40 |
| `maxRows` | 5 | 7 |
| `fsMin`/`fsMax` | 13px / 32px | 14px / clamp(34,4.4vw,52) |
| Área táctil | `.touch-target` (tokens.css:437-447) en cada término | no necesario |
| Tooltip | **no hay hover en táctil**: el primer toque selecciona y muestra el detalle en una tira fija bajo la nube; no un popover | popover |

Razón de arrancar en Ranking a 390px: con `fsMin` 13px y ~340px de ancho útil caben 3-4 términos por fila, así que la nube degenera en una lista mal alineada — y encima el término de 13px es un blanco táctil de 13×15px, muy por debajo de 44px (369 casos ya contados en la auditoría). El toggle sigue ahí: si el usuario elige Nube en móvil, se respeta y se recuerda.

---

## 4 · Diseño visual

### 4.1 Familia y escala

**Los términos van en Krub (`--ff-sans`). Los conteos en Besley (`--ff-numeric` / clase `.num`).** Razones, con la evidencia de `docs/auditoria-diseno-2026-07-fundaciones.md`:

1. Besley es un serif de **contraste 1.675** (fundaciones, tabla §3): a 14-18px sobre `--canvas` #0E1620 los trazos finos se rompen por halación en oscuro. La nube tiene la mitad de sus términos en el rango 14-22px.
2. Krub tiene x-height **0.550 em** contra 0.520 de Besley (misma tabla): a igual `font-size`, Krub rinde ~6% más altura de x, y en una nube el `font-size` **es** la escala de datos — no se puede compensar subiéndolo.
3. Besley mide **+19% a +24% más ancho en mayúsculas** (fundaciones §3): menos términos por fila, más `dropped`.
4. Los términos son contenido de la UI, no titulares. La regla del sistema (fundaciones, tabla de roles: `body`/`label` → Krub) los pone en Krub.
5. Contrapartida asumida: Krub **no tiene `tnum`** (fundaciones §3, features `frac, kern, liga, locl`) — irrelevante para palabras, decisivo para cifras. De ahí que **todo número** del tooltip y de la vista Ranking use `.num` (tokens.css:419-424, `--ff-numeric` = Besley + `tnum`).

Pesos: `500` normal, `700` seleccionado. Nada de `300` (a 14px en oscuro desaparece).

### 4.2 Color = sentimiento, con tokens nuevos

La escala `--div-*` de `tokens.css:338-343` está diseñada para **rellenos**, no para texto. Medido con WCAG 2.1 sobre `--canvas`:

| Token | Ratio en `mando` oscuro | Ratio en `mando` claro (sobre #FFFFFF) | Veredicto como texto |
|---|---|---|---|
| `--div-mid` #4A515B | **2.27:1** | 8.02:1 | falla en oscuro |
| `--div-neg-1` #FF9BAC / #E8859A | 9.13:1 | **2.54:1** | falla en claro |
| `--div-pos-1` #8FE5B0 / #7CBE92 | 12.13:1 | **2.18:1** | falla en claro |

Por eso **añadir a `tokens.css` un bloque nuevo (§6.5)** con 5 pasos verificados en los dos modos, donde la **extremidad se codifica en saturación y el paso neutro es acromático** (en oscuro, más luminoso ≠ más extremo: `--wc-neg-1` es más claro que `--wc-neg-2` a propósito, y lo que separa "muy negativo" de "algo negativo" es el croma):

```css
[data-theme="mando"][data-mode="dark"] {
  /* nube de términos — SENTIMIENTO SOBRE TEXTO. No reutilizar --div-*:
     --div-mid da 2.27:1 sobre --canvas y falla AA como texto. */
  --wc-neg-2: #FF5470;   /*  5.85:1  netSentiment <= -0.50 */
  --wc-neg-1: #FF9BAC;   /*  9.13:1  -0.50 < netSentiment <= -0.15 */
  --wc-neu:   #A2ACBA;   /*  7.92:1  |netSentiment| < 0.15  (= --text-2) */
  --wc-pos-1: #8FE5B0;   /* 12.13:1  0.15 <= netSentiment < 0.50 */
  --wc-pos-2: #3FD47A;   /*  9.45:1  netSentiment >= 0.50 */
  --wc-new: var(--warn);
  --wc-sel-fill: var(--accent-fill);
  --wc-sel-ring: var(--accent);
  --wc-hover-bg: var(--surface-raised);
  --wc-fs-min: 14px;
  --wc-fs-max: clamp(34px, 4.4vw, 52px);
}
[data-theme="mando"][data-mode="light"] {
  --wc-neg-2: #C2183F;   /* 6.01:1 */
  --wc-neg-1: #A05A6A;   /* 5.04:1 */
  --wc-neu:   #4A515B;   /* 8.02:1 (= --text-2) */
  --wc-pos-1: #4F7A5E;   /* 4.91:1 */
  --wc-pos-2: #14722F;   /* 6.04:1 */
}
@media (max-width: 768px) { :root { --wc-fs-min: 13px; --wc-fs-max: 32px; } }
```

Sin `netSentiment` (`pos+neu+neg === 0`): `--text-2`, y el tooltip dice "sin clasificar".

Recordatorio: el modo claro **es alcanzable** (`shell.js:549` → `setMode`, `app.js:290` persiste), así que los dos bloques son obligatorios.

**Leyenda obligatoria** en la cabecera, cinco puntos de 8px con los cinco tokens y las etiquetas `muy negativo · negativo · neutral · positivo · muy positivo`. Sin leyenda, el color es adorno.

### 4.3 Selección, hover, foco y novedad — cuatro tratamientos disjuntos

| Estado | Tratamiento | Por qué así |
|---|---|---|
| Reposo | color = sentimiento, sin fondo | |
| Hover | `background: var(--wc-hover-bg)`, `border-radius: var(--r-sm)` | No cambia el color (es el dato) ni el tamaño (movería a los vecinos) |
| **Foco** | `outline: 2px solid var(--accent)` con `outline-offset: 2px` — heredado de `tokens.css:455-459` | Anillo **exterior**, geometría distinta de la selección |
| **Seleccionado** | `background: var(--wc-sel-fill)` + `box-shadow: inset 0 0 0 1.5px var(--wc-sel-ring)` + `font-weight: 700` | Anillo **inset**: se distingue del foco incluso estando ambos activos |
| **Nuevo** (`isNew`) | punto de 5px `--wc-new` en la esquina superior derecha del bounding box, `border: 1px solid var(--canvas)` para separarlo del vecino | No color de texto (choca con sentimiento), no halo (choca con selección), no badge de texto (no cabe a 14px). En la vista Ranking: pill `.pill-warn` "NUEVO" |

**No atenuar los no seleccionados.** Lo medí: componiendo `--wc-neg-2` #FF5470 sobre `--canvas` a opacidad 0.55 el contraste cae a **2.52:1**; a 0.70 sigue en **3.39:1** — por debajo de 4.5 para todo lo que no llegue a 18.66px, que es la mayoría de la nube. La selección se expresa **sumando** (relleno + anillo), nunca restando.

### 4.4 Accesibilidad

**Decisión de fondo: HTML posicionado en absoluto, no SVG.** Un `<div>` relativo con `<button>` en `position:absolute; left/top`. Gana en cinco frentes: botones nativos (foco, `aria-pressed`, Enter/Space gratis), `.touch-target` aplicable, texto seleccionable y copiable, transiciones CSS sin `transform` sobre `<text>`, y **no añade un décimo SVG sin `<title>`** al producto.

Estructura y contrato ARIA:

```jsx
<figure aria-labelledby="wc-cap" style={{ margin: 0 }}>
  <div id="wc-cap" className="sr-only">
    Nube de {n} términos de las menciones del {windowLabel}. El tamaño del texto
    representa la frecuencia y el color el sentimiento neto. La posición no
    significa nada. Hay una tabla ordenada equivalente en la vista Ranking.
  </div>
  <div role="listbox" aria-multiselectable="true" aria-labelledby="wc-cap"
       tabIndex={0} onKeyDown={onKeys} style={{ position:'relative', height }}>
    {placed.map((b, i) => (
      <button key={b.t.term} role="option"
        aria-selected={selected.includes(b.t.term)}
        aria-disabled={atCap && !selected.includes(b.t.term) ? 'true' : undefined}
        tabIndex={i === cursor ? 0 : -1}
        aria-label={`${b.t.term}, ${b.t.count} menciones, ${sentLabel(b.t.netSentiment)}` +
                    (b.t.isNew ? ', nuevo en este periodo' : '') +
                    (b.t.deltaPct == null ? ', sin dato previo' : `, ${b.t.deltaPct > 0 ? 'sube' : 'baja'} ${Math.abs(b.t.deltaPct)} por ciento`)}
        className="touch-target"
        style={{ position:'absolute', left:b.x, top:b.y, fontSize:b.fs, /* … */ }}>
        {b.label}
      </button>
    ))}
  </div>
  <div aria-live="polite" className="sr-only">{liveMsg}</div>
</figure>
```

| Aspecto | Contrato |
|---|---|
| Tab stops | **Uno solo** para toda la nube (roving `tabindex`). 40 tab stops sería una trampa de teclado de facto |
| Flechas | ←/→ mueven por **orden de rango** (no espacial: el orden espacial no significa nada); ↑/↓ saltan ±5; Home/End al primero/último |
| Activar | Enter / Space → toggle. `Alt+Enter` → "ver aparte" |
| Escape | limpia la selección completa |
| `aria-live` | Al togglear: "agua seleccionado, 3 términos activos, 128 menciones en la lista". Al cambiar métrica: "Métrica distintiva, 24 términos" |
| Tabla equivalente | **La vista Ranking ES la tabla**, y por eso no es un extra escondido: `<table>` real con `<caption class="sr-only">`, `<th scope="col">` en Término/Menciones/% del total/Sentimiento/Δ/Nuevo, cifras en `.num`, filas `<button>`-izadas igual que `TopicList` (screens.js:2189-2196). El `<div id="wc-cap">` la nombra explícitamente para que un lector de pantalla sepa que existe |
| Sin dependencia del color | El sentimiento aparece también como palabra en el `aria-label` y como pill en el Ranking |
| Zoom 200% | El layout se re-hace desde `useChartWidth`; con `--wc-fs-max` en `clamp()` y filas centradas no hay desborde horizontal (invariante de PR #87) |

---

## 5 · Dónde encaja y qué desplaza

`MentionsScreen` (screens.js:785-1006), **entre la rejilla de `QuickMetric` que cierra en la línea 964 y el comentario `{/* Mentions table */}` de la línea 966**:

```
card: barra de filtros            (screens.js:887-944)   ← sin cambios
grid: 5 × QuickMetric             (screens.js:948-964)   ← sin cambios
── card: TERMS CLOUD ────────────────────────── NUEVA ──
   cabecera: "Términos" + leyenda + chips Métrica/Unidad/Vista + ⌃ colapsar
   cuerpo:   nube  ó  ranking
   pie:      n términos · ventana · advertencia de tamaño · exclusiones
── barra de criterios activos ──────────────── NUEVA (compartida con S-03)
card: Menciones (lista/cards/tabla + paginación)  (screens.js:967-1000)
```

**Qué desplaza: nada de forma permanente.** La card es colapsable (`eco.cloudOpen`), y colapsada mide 52px. Alturas: nube desktop `maxRows 7` ≈ 300px máx.; ranking `min(10 filas, 360px)` con scroll interno.

Alternativa rechazada: **sustituir la rejilla de `QuickMetric`.** Tentador (esas 5 cards leen `D.CURRENT_METRICS` del boot, y su "Total" es una de las dos fuentes rivales de F9), pero eso es una decisión de otra unidad; borrarlas aquí acoplaría dos cambios sin relación.

Segundo emplazamiento, gratis: el mismo `TermsCloud` con `terms` filtrados por tópico entra en `MentionsSliceModal` (shell.js:1156) bajo el histograma. **No en esta entrega** — primero que se estabilice en Menciones.

### 5.1 Registro del archivo nuevo (sin bundler)

| Archivo | Cambio |
|---|---|
| `apps/web/public/eco-prototype/cloud.js` | nuevo. Al final: `window.ECO_CLOUD = { TermsCloud };` |
| `apps/web/scripts/compile-prototype.js:18` | `FILES` → insertar `'cloud.js'` **antes** de `'screens.js'` |
| `apps/web/public/eco-prototype/index.html:1412` | `files` → insertar `'cloud.js'` antes de `'screens.js'` (el orden global importa) |
| `apps/web/public/eco-prototype/index.html:1416` | subir el cache-bust `?v=prodc22` → `?v=prodc23` (manual, siempre) |
| `apps/web/public/eco-prototype/screens.js:3` | `const { TermsCloud } = window.ECO_CLOUD;` |
| `apps/web/public/eco-prototype/tokens.css` | nuevo §6.5 con los tokens `--wc-*` de §4.2 |
| `apps/web/public/design-system/index.html` | especimen: la nube con 24 términos fijos, en los dos modos, más la leyenda y el Ranking |

**Cero dependencias nuevas.** No hay CDN, no hay `integrity` que calcular, no hay npm. `canvas.measureText` es API de plataforma.

---

## 6 · Criterios de aceptación (verificables)

1. Con los mismos datos y el mismo ancho, dos renders producen **`x`/`y` idénticos** para todo término (test: `JSON.stringify(layoutTerms(a,o)) === JSON.stringify(layoutTerms(a,o))`).
2. Cambiar de vista, seleccionar 3 términos, abrir el chat drawer y volver **no mueve ninguna palabra** (el memo de §2.5 no se invalida).
3. `grep -c "Math.random" cloud.js` → `0`.
4. Los 10 tokens `--wc-*` cumplen ≥4.5:1 en `mando` oscuro **y** claro (script de contraste en CI).
5. Ningún término seleccionado ni no seleccionado se renderiza con `opacity < 1`.
6. Un solo tab stop hasta la nube; dentro, las flechas recorren los términos en orden de rango.
7. `terms.length` 40 → 0 desbordes horizontales a 390/768/1024/1440px (invariante de PR #87).
8. Seleccionar 9 términos es imposible; el 9.º está `aria-disabled` con motivo visible.
9. `deltaPct == null` nunca imprime "0%".
10. Con `prefers-reduced-motion: reduce`: cero `animation-delay` y cero `translateY` de entrada.
11. Cada término tiene `aria-label` con término, conteo, sentimiento en palabras y Δ; el `role="listbox"` está nombrado por el `<figure>`.
12. Ningún `<svg>` nuevo en el producto → el contador de "SVG sin `<title>`" sigue en 9, no en 10.


## Decisiones

**Componente de dos vistas hermanas (`cloud` + `rank`) con datos, selección y tooltip compartidos, en vez de nube pura**

- *Por qué:* La nube da reconocimiento de patrón en 300 ms pero no permite ordenar ni comparar magnitudes; el Ranking da la magnitud exacta y, gratis, resuelve la accesibilidad (§4.4) y el móvil (§3.7). El cliente recibe su nube y el producto no pierde la capacidad de responder la pregunta real.
- *Alternativas descartadas:* Nube pura (gasta el único componente nuevo de la pantalla en cero información accionable); solo barras ordenadas (es lo que el cliente rechazó).

**Layout determinista de filas centradas con orden serpentina, escrito a mano (~120 líneas), sin RNG**

- *Por qué:* El determinismo es la propiedad más valiosa: la memoria espacial es lo único que una nube regala, y un layout que salta la destruye. El reparto greedy en orden de rango + filas centradas + `centerOut` dentro de cada fila da la silueta de nube sin azar, es O(n) y hace el FLIP trivial porque cada término tiene una celda con x/y estable.
- *Alternativas descartadas:* d3-cloud por CDN: usa Math.random() interno (layout inestable), es asíncrono (rompe el ciclo de render de React 18) y mide con un canvas de sprites de 2048×2048. Espiral tipo Wordle a mano: necesita orden de inserción aleatorio para no producir una diagonal, y la animación de transición es imposible.

**HTML posicionado en absoluto (`<button role="option">`) en vez de SVG `<text>`**

- *Por qué:* Botones nativos (foco, aria-pressed, Enter/Space), `.touch-target` de tokens.css aplicable para los 44px táctiles, texto copiable, transiciones CSS sin transform sobre `<text>`, y no añade un décimo SVG sin `<title>` a un producto que ya tiene 9.
- *Alternativas descartadas:* SVG con `<g role="button">` + `<title>` por término: peor foco, sin área táctil ampliable, y el `<title>` de SVG se comporta de forma inconsistente entre lectores.

**Click hace toggle de selección y filtra la lista de menciones de la misma pantalla; NO abre MentionsSliceModal**

- *Por qué:* MentionsSliceModal (shell.js:1156) existe para agregados sin lista al lado — heatmap, mapa, termómetro, virales. La nube vive dentro de MentionsScreen, a ~200px de una lista paginada con tres modos de vista; un modal con las mismas menciones sería peor. Alt+click sigue abriendo el modal con `_filter:{q:term}` para el caso 'verlo aparte'.
- *Alternativas descartadas:* Abrir siempre el modal (duplica la lista que está debajo); solo filtrar sin escape al modal (pierde el caso de análisis aislado).

**Cinco tokens `--wc-*` nuevos para el sentimiento del término, en vez de reutilizar `--div-*`**

- *Por qué:* Medido con WCAG 2.1: `--div-mid` #4A515B da 2.27:1 sobre `--canvas` en oscuro, y en claro `--div-neg-1` #E8859A da 2.54:1 y `--div-pos-1` #7CBE92 da 2.18:1. La escala divergente está diseñada para rellenos, no para texto. Los tokens nuevos codifican la extremidad en saturación (el paso neutro es acromático), no en luminosidad, y verifican ≥4.5:1 en los dos modos.
- *Alternativas descartadas:* Reutilizar `--div-*` tal cual (falla AA en tres de cinco pasos, según modo); usar `--pos`/`--neg`/`--text-3` en 3 pasos (pierde la gradación que hace útil el color).

**La selección se expresa sumando (relleno `--accent-fill` + anillo inset), nunca atenuando los no seleccionados**

- *Por qué:* Medido: `--wc-neg-2` #FF5470 compuesto sobre `--canvas` cae a 2.52:1 a opacidad 0.55 y sigue en 3.39:1 a 0.70 — por debajo de AA para todo lo que no llegue a 18.66px, que es la mayoría de la nube. El anillo inset además se distingue geométricamente del anillo de foco exterior de tokens.css:455.
- *Alternativas descartadas:* Atenuar los no seleccionados a 0.35 o 0.55 (patrón habitual, aquí inviable por contraste); cambiar el color del término al seleccionarlo (el color ya es el dato).

**Términos en Krub (`--ff-sans`), cifras en Besley (`--ff-numeric` / `.num`)**

- *Por qué:* Besley tiene contraste 1.675 y se rompe por halación a 14-18px sobre --canvas #0E1620, justo donde vive la mitad de la nube; su x-height es 0.520 em contra 0.550 de Krub, y mide +19-24% más ancho en mayúsculas (menos términos por fila, más descartes). Krub no tiene `tnum`, lo que es irrelevante para palabras y decisivo para números — de ahí el reparto.
- *Alternativas descartadas:* Todo en Besley (más 'editorial' pero ilegible en los tamaños chicos y menos denso); Besley solo para los términos grandes (dos familias en la misma escala continua haría que el salto de tamaño se lea como salto de categoría).

**No hay conmutador AND/OR para la multi-selección; se declara AND y se topa en 8 términos**

- *Por qué:* `/api/eco-mentions` route.ts:226-236 hace `split(/\s+/).filter(t=>t.length>=2).slice(0,8)` con AND entre tokens y no tiene `qMode`. Un conmutador OR sería el sexto comando fantasma después de los cinco de S-04. El tope de 8 se hace visible con `aria-disabled` y motivo, en vez de descartar el 9.º en silencio.
- *Alternativas descartadas:* Implementar OR en el cliente uniendo resultados (rompe la paginación y el total); poner el conmutador y que no haga nada.

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-WC-1` | P0 | XS | tokens.css §6.5 — tokens `--wc-*` y escala de tamaño | `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/apps/web/public/eco-prototype/tokens.css` | — |
| `WS-WC-2` | P0 | M | cloud.js — layout determinista + medición | `apps/web/public/eco-prototype/cloud.js (nuevo)` | — |
| `WS-WC-3` | P0 | M | cloud.js — render de la nube, hover/focus y tooltip | `apps/web/public/eco-prototype/cloud.js` | WC-1, WC-2 |
| `WS-WC-4` | P0 | S | cloud.js — vista Ranking (tabla real) y toggle | `apps/web/public/eco-prototype/cloud.js` | WC-2 |
| `WS-WC-5` | P0 | S | Integración en MentionsScreen: `filters.terms` y barra de criterios | `apps/web/public/eco-prototype/screens.js (789-791, 815, 831, 872, entre 964 y 966)` | WC-3, WC-4 |
| `WS-WC-6` | P0 | S | Accesibilidad: roving tabindex, aria-live y contrato ARIA | `apps/web/public/eco-prototype/cloud.js` | WC-3 |
| `WS-WC-7` | P1 | S | Animación de entrada y FLIP con tokens exactos | `apps/web/public/eco-prototype/cloud.js` | WC-3 |
| `WS-WC-8` | P0 | XS | Registro sin bundler + cache-bust + especimen | `apps/web/scripts/compile-prototype.js:18 · apps/web/public/eco-prototype/index.html:1412,1416 · apps/web/publi` | WC-2 |
| `WS-WC-9` | P1 | S | Estados vacío / insuficiente / error / sin baseline | `apps/web/public/eco-prototype/cloud.js` | WC-4 |
| `WS-WC-10` | P1 | S | Comportamiento móvil (≤768px) y táctil | `apps/web/public/eco-prototype/cloud.js` | WC-4 |
| `WS-WC-11` | P2 | S | Verificación: script de contraste + pruebas de determinismo y desborde | `scripts/ (nuevo verificador) · apps/web/public/eco-prototype/cloud.js` | WC-1, WC-2 |

## Riesgos

- Dependencia del backend sin cerrar: si `/api/eco-terms` no cumple B1 (deltaPct null ≠ 0) ni B4 (mismo universo que la lista: sin duplicados y sin pertinencia baja), la nube reproduce F4 y F9 y contradice a la lista que tiene 200px debajo — el usuario verá un término con 40 en la nube y 33 en la lista.
- Una frase seleccionada (`unit='phrase'`) se convierte en AND de sus palabras en `/api/eco-mentions` (route.ts:227-236): "ayuda federal" trae menciones con las dos palabras separadas. Sin soporte de comillas o `phrase=` en el backend, el filtro sobre-cuenta y hay que rotularlo como "aproximada" en la barra de criterios.
- `canvas.measureText` con Krub aún no cargada devuelve anchos de la fallback y el primer layout queda mal empaquetado. La invalidación en `document.fonts.ready` produce un re-layout visible al arrancar; mitigable con el esqueleto, no eliminable.
- `--wc-fs-max` usa `clamp(34px, 4.4vw, 52px)`: `measureTerm` necesita el valor RESUELTO en px, no la expresión. Hay que leerlo con `getComputedStyle` sobre un nodo sonda, o el layout medirá con un tamaño distinto del que se pinta.
- La estabilidad espacial se rompe cuando el usuario cambia de período o agencia: los datos cambian y el layout se re-hace legítimamente. El FLIP de 220ms lo suaviza, pero un cambio grande de la lista de términos se sigue leyendo como "todo se movió".
- `window.ECO_CLOUD` es el noveno global del prototipo y el orden de `<script>` es load-bearing: si 'cloud.js' queda después de 'screens.js' en compile-prototype.js:18 o en index.html:1412, la destructuración de screens.js:3 tira `Cannot destructure property` y la app no arranca.
- Los términos son texto libre del contenido ingerido y se renderizan por `textContent` de React (sin riesgo de inyección), pero un término puede ser una palabra ofensiva o un nombre propio de un ciudadano privado, pintado a 52px en un dashboard de gobierno. Hace falta una lista de bloqueo en el backend antes de mostrar esto a un cliente.
- El pie de la card declara las exclusiones (`excluded.lowPertinence`, `excluded.duplicates`) y depende de que el backend las reporte; si llegan siempre en 0 porque no se instrumentaron, el copy pasa de honesto a falso — peor que no ponerlo.


---

