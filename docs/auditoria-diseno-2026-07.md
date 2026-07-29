# Auditoría de diseño y siembra del sistema de diseño — ECO

> **Fecha:** 2026-07-28 · **Base:** `origin/main` `8a996a8` · **Alcance:** dashboard SPA (10 rutas) + páginas Next.js/Ant Design · **Escritorio y móvil**

> **Método.** 80 capturas de pantalla reales del producto renderizado (Chrome headless, 10 rutas × 4 anchos: 1440 / 1280 / 768 / 390), con datos sembrados a través de fixtures que respetan los contratos reales de `/api/*` y usan los helpers de verdad de `@eco/shared/format`. Cada captura pasó por sondas automatizadas que miden contraste WCAG 2.1 sobre los colores *resueltos*, áreas táctiles, texto truncado, desbordes y errores de consola. Todo hallazgo cita `archivo:línea`.

---

## 0 · Cómo leer este documento

Esta auditoría **no repite** las dos anteriores:

| Auditoría | Fecha | Tema | Estado |
|---|---|---|---|
| `docs/auditoria-ux-dashboard-2026-07.md` | 16 jul | UX / arquitectura (190 hallazgos) | plan P0/P1/P2 sin ejecutar |
| `docs/auditoria-responsive-2026-07.md` | 22 jul | Responsividad (168 hallazgos) | **✅ implementado y en prod** (PR #87) |
| **este documento** | **28 jul** | **Calidad visual + sistema de diseño** | **siembra iniciada** |

La responsividad está resuelta: las 40 capturas confirman **0 desbordes horizontales** en los cuatro anchos. Lo que queda no es que el layout se rompa — es que **el producto no tiene un sistema**: 16 tamaños de letra, 17 valores de espaciado, 103 colores escritos a mano, cinco maneras distintas de expresar una métrica, y gráficas que en algunos casos representan los datos de forma engañosa.

Severidades: **P0** engaña al lector, rompe una tarea o cuesta credibilidad ante el cliente · **P1** degrada el uso · **P2** pulido.

---

## 1 · Diagnóstico en una página

El dashboard se ve mejor de lo que está. Tiene buen gusto visual — la retícula de cards, el rail oscuro, la contención cromática — pero por debajo no hay sistema, y eso produce cuatro clases de problema:

**1. El sistema de tokens existe y casi nadie lo usa.** `index.html` define tres temas × dos modos con custom properties, pero `screens.js`, `charts.js` y `shell.js` escriben **103 colores hex a mano**, 16 tamaños de letra y 17 valores de `gap`. La misma paleta categórica de 8 colores está **copiada literalmente cuatro veces** (`screens.js:311`, `1998`, `2448`, `4143`). Y hay valores de *otros temas* filtrados dentro del tema activo: `SENT_HEX` (`screens.js:2454`) pinta el sentimiento con `#2E8B6A`/`#C2412F`, que son el verde y el rojo del tema **`costa`**, no del `mando` que corre en producción. La leyenda del heatmap (`screens.js` `HourActivityCard`) pinta sus swatches con `rgba(11,95,128,…)` — el azul de `costa` — mientras las celdas van en naranja: **la leyenda y el mapa no coinciden**.

**2. El color no distingue lo que tiene que distinguir.** En `mando` **`--accent` y `--neg` eran el mismo naranja `#FF6A3D`**. Un chip activo era indistinguible de un indicador negativo; «Velocidad: Acelerada» en Menciones se leía como una alarma; el botón primario y el peor número de la pantalla compartían color. En paralelo, `--text-3` (`#525B68`) daba **2.65:1** sobre `--canvas` — falla AA — y era el color de la mayor parte del texto de 9–11px. Sobre 40 capturas: **1,884 instancias de texto por debajo del mínimo de contraste**.

**3. Las gráficas no siempre dicen la verdad.** `MultiLineChart` (la primitiva más usada) escala **cada serie a su propio mínimo y máximo** y sólo dibuja eje Y en dos de sus tres modos. En la «Tendencia día a día» del Overview eso significa que las tres líneas de sentimiento se cruzan y el lector concluye cosas falsas. La etiqueta de último valor mide 46px y se dibuja a `innerW + 4` con `padding.r = 20`: **se recorta exactamente 30 de sus 46px** (`charts.js:187` + `413`). No hay contrato de nulos: `/api/eco-data` emite `TIMELINE[].polarizationIndex: null` y `fmtVal()` hace `v.toFixed()` sin guarda. Y los nueve SVG del producto tienen **cero `<title>`**: para un lector de pantalla, ninguna gráfica existe.

**4. Hay dos sistemas de diseño en un solo producto.** Las páginas Next.js corren Ant Design con `ecoTheme` (`apps/web/src/theme/eco-theme.ts`): color primario **`#0A7EA4` (turquesa)** contra el **`#FF6A3D` (naranja)** de la SPA, fondos **`#FFFFFF` fijos sin `darkAlgorithm`**, radios 8/14/6 contra los 3/4px de `mando`, `controlHeight: 36` (bajo el mínimo táctil de 44), y `fontFamily` de fuentes del sistema con el comentario «no external loading». Estas páginas se embeben en la SPA por iframe (`screens.js:2938`, `3060`): el panel de configuración aparece como una isla clara de otra marca dentro del dashboard oscuro.

Sobre esos cuatro ejes se apoyan cuatro decisiones de producto que el cliente pidió y que este documento especifica: **la tipografía Besley + Krub**, **la nube de palabras en Menciones**, **el rediseño de las gráficas**, y **la detección de novedad en Narrativas** (hoy congelada: cero narrativas nuevas desde el ~6 de julio).

---

## 2 · Lo que ya se sembró (medido, no propuesto)

Dos commits en la rama `design-system-audit`. No son el plan completo: son la base sobre la que se apoya el resto.

### 2.1 · `tokens.css` — fuente única de verdad

`apps/web/public/eco-prototype/tokens.css` extrae de `index.html` toda la capa de tokens y la convierte en el único sitio donde vive un valor de diseño: tipografía, escala de espaciado, radios, superficies de elevación, movimiento, color semántico y **paletas de datos tokenizadas** (categórica de 8, siete emociones, seis estados de narrativa + fallback, secuencial y divergente).

`apps/web/public/design-system/index.html` es el **especimen vivo**: lee ese mismo archivo y **calcula el contraste WCAG en el navegador** sobre los tokens resueltos, así la tabla no puede desincronizarse del CSS. Si algo se ve distinto en el producto que en el especimen, el producto tiene un valor hardcodeado y eso es deuda medible.

### 2.2 · Tipografía: Besley + Krub

Sustituye a las cinco familias que se cargaban (Instrument Sans, Instrument Serif, Newsreader, IBM Plex Sans, IBM Plex Mono — de las cuales `mando` sólo pintaba dos). Escala de 12 pasos con **piso de 12px**; antes el 60% del texto corría a 9–11px.

> **Trampa encontrada al aplicarlo:** `mando` tenía `body { font-family: var(--ff-display) }`. Como en `mando` `--ff-display` era IBM Plex Sans (igual que el cuerpo), no se notaba. Al poner Besley en `--ff-display`, **el dashboard entero se volvía serif**. `body` pasa a `--ff-sans`.

### 2.3 · Correcciones de color, con la aritmética

| Token | Antes | Después | Contraste sobre `--canvas` #0E1620 |
|---|---|---|---|
| `--text-2` | `#8A94A1` | `#A2ACBA` | 5.92:1 → **7.92:1** |
| `--text-3` | `#525B68` | `#7C8798` | **2.65:1 (falla AA)** → **5.00:1** |
| `--neg` | `#FF6A3D` | `#FF5470` | idéntico a `--accent` → **Δhue 24°, 5.85:1** |
| `--on-accent` / `--on-pos` / `--on-neg` / `--on-warn` / `--on-info` | (no existían) | primer plano oscuro | ver abajo |

El blanco sobre relleno saturado **falla siempre**: `#fff` sobre `--accent` da **2.85:1**, sobre `--pos` **1.92:1**, sobre `--warn` **1.63:1**. Con el primer plano oscuro los mismos rellenos dan 6.39 / 9.45 / 11.15. Se corrigieron los sitios que lo hacían: la etiqueta de valor de las gráficas (`charts.js:417`), el chip de métrica activa (`screens.js:497`), el texto de celda del heatmap (`screens.js:2568`), `.btn-primary` y `[data-theme="mando"] .chip.active` (`index.html`).

### 2.4 · El tema ya no depende de que React monte

`data-theme`/`data-mode` los ponía **un solo sitio**: un `useEffect` dentro de `App` (`app.js:319`). Comprobado en el navegador: al quitar esos atributos, `getComputedStyle(html).getPropertyValue('--canvas')` devuelve **cadena vacía** — ningún bloque de tema matchea y *todas* las custom properties quedan sin definir.

Consecuencia real, capturada: cuando el Scorecard crasheaba, el `useEffect` nunca corría y el `EcoErrorBoundary` se pintaba **blanco sobre blanco con un stack trace crudo** para un usuario de gobierno. Además había FOUC en cada carga, y el splash de arranque tenía que hardcodear `#8A94A1`/`#060A10` porque los tokens no existían todavía.

Ahora el tema va en el `<html>` desde el primer byte.

### 2.5 · Resultado medido

Sondas WCAG 2.1 sobre las **mismas 40 capturas**, antes y después:

| Pantalla | Antes | Después |
|---|---:|---:|
| Menciones | 107 | **0** |
| Scorecard | 83 | **0** |
| Overview | 47 | **0** |
| Sentimiento | 45 | **0** |
| Narrativas | 39 | **1** |
| Configuración | 32 | **5** |
| Geografía | 19 | **0** |
| Alertas | 15 | **0** |
| Búsqueda | 11 | **0** |
| Tópicos | 73 | **40** |
| **Total (× 4 anchos)** | **1,884** | **184** |

**−90%** con un cambio en la capa de tokens y cinco correcciones puntuales.

Los 184 que quedan son *exactamente* los hex escritos a mano, y por eso son la mejor prueba de por qué hay que retirarlos:

- **Tópicos (160 de los 184)** — el calendario de tópicos pinta las celdas con `SENT_HEX` (`screens.js:2454`), que es la paleta de **`costa`**, y encima escribe `--text`/`--text-2` de `mando`: 1.82:1 en el peor caso.
- **Configuración (20)** — el avatar `#4A7FB5` (`screens.js:3594`) con texto blanco: 4.20:1.
- **Narrativas (4)** — `NARRATIVE_STATUS_COLORS.peaking = '#FA8C16'` (`screens.js:4602`) con texto blanco: 2.38:1.

Los tres se cierran migrando a `--cat-*`, `--emo-*`, `--narr-*` y `--on-*`, que ya existen en `tokens.css`.

---

## 3 · Deuda del sistema, cuantificada

| Qué | Cuánto | Dónde |
|---|---|---|
| Colores hex escritos a mano | **103** | `screens.js`, `charts.js`, `shell.js` |
| La misma paleta categórica de 8, copiada | **4 veces** | `screens.js:311`, `1998`, `2448`, `4143` |
| Tamaños de letra distintos | **16** (8→40px; 60% del texto a 9–13px) | inline |
| Valores de `gap` distintos | **17** (0,1,2,3,4,5,6,8,10,11,12,14,16,18,20,22,24) | inline |
| Valores de `padding` distintos | **14** | inline |
| Radios distintos | **10**, contra 4 tokens casi sin uso | inline |
| Atributos ARIA en toda la SPA | **18** (7 `aria-label`, 6 `role`, 3 `aria-modal`, 1 `aria-hidden`, 1 `aria-current`) en ~7,000 líneas | — |
| `<title>` en los SVG de gráficas | **0** de 9 primitivas | `charts.js` |
| Áreas táctiles < 44px en móvil | **369** (suma de pantallas) | — |
| Temas definidos vs alcanzables | **6 combinaciones** definidas, **1** alcanzable | `index.html` / `app.js:150` |
| Sistemas de diseño en el producto | **2** (SPA naranja oscuro · Ant turquesa claro) | `index.html` vs `src/theme/eco-theme.ts` |

---

## 4 · Bugs verificados en vivo

Todos reproducidos en una captura o en el navegador, no inferidos.

| # | Sev | Qué | Dónde | Evidencia |
|---|---|---|---|---|
| **F1** | P0 | La etiqueta de último valor de `MultiLineChart` se recorta **30 de sus 46px**: se dibuja en `translate(innerW+4)` con `width=46` pero `padding.r = 20`. | `charts.js:187`, `413-418` | En Overview se leen «3», «5», «4» en vez de 43.0 / 54.0 / 36.0; en Scorecard sale una caja vacía. Ya lo señaló la auditoría responsive (WS-2.2, `padding.r ≥ 52`) y **no se arregló**. |
| **F2** | P0 | Normalización **por serie** sin eje Y: cada línea se escala a su propio min/max y las etiquetas de eje sólo se dibujan con `sharedScale` o `yDomain`. | `charts.js:205-232`, `293-302` | «Tendencia día a día» del Overview: 3 series de sentimiento que se cruzan sin escala común. |
| **F3** | P1 | La prop `smooth` no se puede desactivar: `useSmooth = smooth \|\| (!sharedScale && pts.length > 2)`. Catmull-Rom inventa valores entre días. | `charts.js:333` | — |
| **F4** | P0 | Sin contrato de nulos. `fmtVal()` hace `v.toFixed()` sin guarda; `/api/eco-data` emite `TIMELINE[].polarizationIndex: null`. | `charts.js:348-356`; `api/eco-data/route.ts:262` | `TypeError` que tumba la pantalla completa + 4 errores `<path> attribute d: Expected number, "M 2,NaN…"` reales en el `Sparkline` del Scorecard. |
| **F5** | P0 | El tema sólo existía tras montar React → un crash de render dejaba el error boundary **sin sistema de diseño** (blanco sobre blanco + stack trace). | `app.js:319` | **Corregido** (§2.4). Mecanismo probado: sin los atributos, `--canvas` resuelve a cadena vacía. |
| **F6** | P1 | La leyenda del heatmap usa `rgba(11,95,128,…)` (azul de `costa`) mientras las celdas usan naranja de `mando`. | `screens.js` `HourActivityCard` | Visible en Scorecard, esquina superior derecha de «Actividad por hora». |
| **F7** | P0 | Un `status` de narrativa fuera de las 6 claves conocidas se renderiza **en inglés crudo, sin punto de color, y no lo cuenta ningún chip de filtro**. | `screens.js:4600-4615` | Captura de `/narrative`: «Todas (8)» con chips que suman 5; tres narrativas visibles en la lista pero invisibles al filtrado, con «escalating» / «sustained» sin traducir. |
| **F8** | P1 | Se renderiza literalmente **`· nan%`**. | `/narrative`, «Narrativas relacionadas» | Visible en captura. |
| **F9** | P0 | **Cinco totales distintos de lo mismo en una pantalla**: briefing «1,024 menciones», card VOLUMEN «4.0K», badge de nav «4.0K», heatmap «999 menciones», enlace «Ver todas (1.3K)». Cada widget resuelve su total desde una fuente distinta sin reconciliación. | Scorecard | Visible en captura. Es el hallazgo que más cuesta credibilidad ante el cliente. |
| **F10** | P1 | Sentimiento pintado con la paleta de **`costa`** dentro del tema `mando`. | `screens.js:2454` (`SENT_HEX`) | 160 de los 184 fallos de contraste restantes. |
| **F11** | P1 | El chrome de cabecera consume ~190px antes del primer dato, incluida **una fila entera para un único botón de tema**. | `shell.js` Header | Visible en las 10 pantallas. |
| **F12** | P1 | Las 5 métricas del hero del Scorecard usan **5 lenguajes visuales distintos** (palabra+sparkline · palabra+gauge · número+sparkline · palabra+escala 1-10 · palabra+área). | `screens.js:133-475` | Visible en captura. |
| **F13** | P2 | Colisión de etiquetas del eje X: la heurística `innerW/50` las coloca en pares solapados. | `charts.js:432` | Scorecard: «28 jun 29 jun», «7 jul 8 jul», «14 jul 15 jul»… |
| **F14** | P2 | `SEED_USERS` — seis empleados de gobierno inventados con correos `@dtop.pr.gov` / `@daco.pr.gov` / `@salud.pr.gov` plausibles, en el bundle que se sirve. **Código muerto** (declarado, nunca referenciado), pero se despacha al navegador. | `screens.js:3531-3538` | Verificado: única referencia es la declaración. |
| **F15** | P2 | `RadialGauge` tiene `max = 3` por defecto; el resto del producto usa escalas 0–1, 1–10 y 0–100. | `charts.js:638` | — |
| **F16** | P1 | La cadena de párrafos del briefing se concatena sin espacio: «…del martes.El lado positivo…». | Scorecard | Visible en captura. |

---

## 5 · Narrativas: la detección está congelada

El cliente pidió «mejorar la detección de nuevos elementos dentro las narrativas». El punto de partida es que **no hay elementos nuevos que detectar**: cero narrativas nuevas desde el ~6 de julio de 2026. La crisis de Domenech no generó ninguna.

Ocho causas raíz, todas confirmadas leyendo `infra/lambda/narrative-cluster/index.ts` en `origin/main`:

1. **Contradicción entre `eps` y el dedup.** `NARRATIVE_DBSCAN_EPS` (0.22 en código, **0.19 en el env real de producción** por un cambio manual del 30 jun) exige similitud de casi-duplicado, pero el pool filtra `m.is_duplicate = false` (líneas 200 y 351) y el dedup por `text_hash` ya borró justo esos pares. Se le pide densidad a un corpus del que se quitó la densidad. Medido en jul con pgvector sobre las 229 menciones de la crisis: **0 core points a eps 0.19, 1 a 0.22, 14 a 0.30**.
2. **Pool envenenado con ventana oldest-first.** El pool se lee `ORDER BY nc.created_at ASC LIMIT 12000` (líneas 356-357). Con 56k candidatos acumulados, los frescos **nunca entran** a la ventana del DBSCAN.
3. **Bucle poda ↔ re-encolado.** La poda borra sólo si `nc.created_at < NOW()-7d` **Y** `m.published_at < NOW()-30d` (336-345), pero el query de no-asignadas **no tiene filtro de fecha** (194-206) y las re-encola con `created_at` fresco. El pool no converge nunca.
4. **La asignación excluye `dormant`** (`WHERE status != 'dormant'`, línea 218). Con ~98% de narrativas dormant, casi nada se puede asignar y todo cae al pool.
5. **`revived` es estructuralmente inalcanzable.** Requiere `prevStatus === 'dormant' && velocity24h > 0`, pero una dormant es invisible al matching, así que nunca recibe menciones y su velocidad nunca sube.
6. **`emerging` no es una señal de novedad**, es un proxy de tamaño y edad: `mentionCount < 50 && ageDays < 7` (`narratives-math.ts:250`).
7. **`drift_score` es la única señal real de «cambió el tema»** (coseno entre `centroid` y `centroid_at_naming`) y se calcula **semanalmente**, se usa **sólo para renombrar** sobre 0.25, y **nunca se le muestra al usuario**.
8. **Los edges no son genealogía.** `narrative_edges.edge_type` sólo tiene `co_occurrence`, `author_overlap` y similitud de centroide. No hay `split` / `merge` / `spawn`, así que la interfaz no puede contar que «Ventanilla digital de OGPe» se desprendió de «Demoras del permiso único».

Además hay **drift de configuración**: producción corre `eps=0.19 / minPts=7`, git dice `0.22 / 10` (`infra/lib/workers-stack.ts:389-390`).

La especificación del arreglo (barrido diagnóstico antes de tocar producción, arreglos estructurales con SQL, taxonomía de novedad, y máquina de estados nueva) está en §8.

---

## 6 · Catálogo por pantalla

<!-- SLOT:PANTALLAS -->

---

## 7 · Gráficas

<!-- SLOT:GRAFICAS -->

---

## 8 · Menciones: nube de palabras y funciones nuevas

<!-- SLOT:MENCIONES -->

---

## 9 · Narrativas: detección, novedad y experiencia

<!-- SLOT:NARRATIVAS -->

---

## 10 · Plan

<!-- SLOT:PLAN -->
