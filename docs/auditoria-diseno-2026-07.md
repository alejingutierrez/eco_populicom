# Auditoría de diseño y siembra del sistema de diseño — ECO

> **Fecha:** 2026-07-28 · **Base:** `origin/main` `8a996a8` · **Alcance:** dashboard SPA (10 rutas) + páginas Next.js/Ant Design · **Escritorio y móvil**

> **Método.** 80 capturas de pantalla reales del producto renderizado (Chrome headless, 10 rutas × 4 anchos: 1440 / 1280 / 768 / 390), con datos sembrados a través de fixtures que respetan los contratos reales de `/api/*` y usan los helpers de verdad de `@eco/shared/format`. Cada captura pasó por sondas automatizadas que miden contraste WCAG 2.1 sobre los colores *resueltos*, áreas táctiles, texto truncado, desbordes y errores de consola. Todo hallazgo cita `archivo:línea`.

---

## 0 · Cómo leer este documento

Este informe es el documento principal. El detalle vive en cinco apéndices:

| Apéndice | Qué contiene |
|---|---|
| [`…-catalogo.md`](auditoria-diseno-2026-07-catalogo.md) | Los 337 hallazgos de las 13 unidades, con ubicación, evidencia y arreglo |
| [`…-fundaciones.md`](auditoria-diseno-2026-07-fundaciones.md) | Color, tipografía (Besley/Krub) y espaciado/primitivas |
| [`…-graficas.md`](auditoria-diseno-2026-07-graficas.md) | Doctrina de codificación visual + rediseño de `charts.js` |
| [`…-menciones.md`](auditoria-diseno-2026-07-menciones.md) | Rediseño de Menciones + nube de palabras (backend y render) |
| [`…-narrativas.md`](auditoria-diseno-2026-07-narrativas.md) | Detección, señales de novedad y experiencia de Narrativas |


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

Sobre esos cuatro ejes se apoyan cuatro decisiones de producto que el cliente pidió y que este documento especifica: **la tipografía Besley + Krub**, **la nube de palabras en Menciones**, **el rediseño de las gráficas**, y **la detección de novedad en Narrativas** (que no está congelada como se creía, sino degradada ~40× y con 1–7 días de retraso — ver §5).

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
| Temas definidos vs alcanzables | **6 combinaciones** definidas, **2** alcanzables (dark y light; el botón del sol de `shell.js:549` llama `setMode` y `app.js:290` lo persiste) | `index.html` / `app.js:150` |
| Sitios donde `mando` **light** está roto | **6** (marcadores y tooltip de Leaflet con hex de dark, `SENT_HEX` de costa, `--warn` 3.86:1 y `--text-3` 3.21:1 sobre blanco) | `charts.js:810-826`, `shell.js:761-763`, `screens.js:2454`, `index.html:166,174` |
| Sistemas de diseño en el producto | **2** (SPA naranja oscuro · Ant turquesa claro) | `index.html` vs `src/theme/eco-theme.ts` |

---

## 4 · Bugs verificados en vivo

Todos reproducidos en una captura o en el navegador, no inferidos.

| # | Sev | Qué | Dónde | Evidencia |
|---|---|---|---|---|
| **F1** | ~~P0~~ **P1** | La etiqueta de último valor de `MultiLineChart` se recorta **30 de sus 46px**: se dibuja en `translate(innerW+4)` con `width=46` pero `padding.r = 20`. | `charts.js:187`, `413-418` | En Overview se leen «3», «5», «4» en vez de 43.0 / 54.0 / 36.0; en Scorecard sale una caja vacía. Ya lo señaló la auditoría responsive (WS-2.2, `padding.r ≥ 52`) y **no se arregló**. *Bajado a P1 en la refutación:* la tira-leyenda de `charts.js:259-275` imprime el valor verdadero del último punto 30px más arriba (`hoverIdx` cae al último índice sin hover), así que el lector tendría que leer la caja recortada e ignorar el «POSITIVO 36.0» de la misma card. Es ruido visual, no engaño. |
| **F2** | P0 | Normalización **por serie** sin eje Y: cada línea se escala a su propio min/max y las etiquetas de eje sólo se dibujan con `sharedScale` o `yDomain`. | `charts.js:205-232`, `293-302` | «Tendencia día a día» del Overview: 3 series de sentimiento que se cruzan sin escala común. |
| **F3** | P1 | La prop `smooth` no se puede desactivar: `useSmooth = smooth \|\| (!sharedScale && pts.length > 2)`. Catmull-Rom inventa valores entre días. | `charts.js:333` | — |
| **F4** | P0 | Sin contrato de nulos. `fmtVal()` hace `v.toFixed()` sin guarda; `/api/eco-data` emite `TIMELINE[].polarizationIndex: null`. | `charts.js:348-356`; `api/eco-data/route.ts:262` | `TypeError` que tumba la pantalla completa + 4 errores `<path> attribute d: Expected number, "M 2,NaN…"` reales en el `Sparkline` del Scorecard. |
| **F5** | P0 | El tema sólo existía tras montar React → un crash de render dejaba el error boundary **sin sistema de diseño** (blanco sobre blanco + stack trace). | `app.js:319` | **Corregido** (§2.4). Mecanismo probado: sin los atributos, `--canvas` resuelve a cadena vacía. |
| **F6** | P1 | La leyenda del heatmap usa `rgba(11,95,128,…)` (azul de `costa`) mientras las celdas usan naranja de `mando`. | `screens.js` `HourActivityCard` | Visible en Scorecard, esquina superior derecha de «Actividad por hora». |
| **F7** | P0 | Un `status` de narrativa fuera de las 6 claves conocidas se renderiza **en inglés crudo, sin punto de color, y no lo cuenta ningún chip de filtro**. | `screens.js:4600-4615` | Captura de `/narrative`: «Todas (8)» con chips que suman 5; tres narrativas visibles en la lista pero invisibles al filtrado, con «escalating» / «sustained» sin traducir. |
| **F8** | P1 | Se renderiza literalmente **`· nan%`**. | `/narrative`, «Narrativas relacionadas» | Visible en captura. |
| **F9** | P0 | **Dos fuentes rivales para «menciones», y el drill-down contradice la tarjeta que abriste.** El KPI «Volumen · período» y el badge del rail suman `daily_metric_snapshots`; el enlace «Ver todas» y el modal que abre la propia tarjeta usan `CURRENT_METRICS.totalMentions`, un recuento vivo sobre `mentions`. En Menciones se suma una tercera discrepancia: la card TOTAL cuenta sin filtro de pertinencia sobre la ventana cerrada, mientras la lista filtra pertinencia y usa otra ventana — **no pueden cuadrar nunca**. | `screens.js:452`, `573`, `336`, `942-975`; `shell.js:84-85`; `api/eco-data/route.ts:194-200`; `api/eco-mentions/route.ts:155-198` | **Medido en producción: 47 vs 54 (≈13%).** Mi captura mostraba cinco cifras distintas, pero parte de eso era aritmética del harness: el defecto real son **dos cálculos rivales**, no cinco. Sigue siendo lo que más cuesta credibilidad. |
| **F10** | P1 | Sentimiento pintado con la paleta de **`costa`** dentro del tema `mando`. | `screens.js:2454` (`SENT_HEX`) | 160 de los 184 fallos de contraste restantes. |
| **F11** | P1 | El chrome de cabecera consume ~190px antes del primer dato, incluida **una fila entera para un único botón de tema**. | `shell.js` Header | Visible en las 10 pantallas. |
| **F12** | P1 | Las 5 métricas del hero del Scorecard usan **5 lenguajes visuales distintos** (palabra+sparkline · palabra+gauge · número+sparkline · palabra+escala 1-10 · palabra+área). | `screens.js:133-475` | Visible en captura. |
| **F13** | P2 | Colisión de etiquetas del eje X: la heurística `innerW/50` las coloca en pares solapados. | `charts.js:432` | Scorecard: «28 jun 29 jun», «7 jul 8 jul», «14 jul 15 jul»… |
| **F14** | P2 | `SEED_USERS` — seis empleados de gobierno inventados con correos `@dtop.pr.gov` / `@daco.pr.gov` / `@salud.pr.gov` plausibles, en el bundle que se sirve. **Código muerto** (declarado, nunca referenciado), pero se despacha al navegador. | `screens.js:3531-3538` | Verificado: única referencia es la declaración. |
| **F15** | P2 | `RadialGauge` tiene `max = 3` por defecto; el resto del producto usa escalas 0–1, 1–10 y 0–100. | `charts.js:638` | — |
| **F16** | P1 | La cadena de párrafos del briefing se concatena sin espacio: «…del martes.El lado positivo…». | Scorecard | Visible en captura. |

### Los que aportó la auditoría por fan-out y que verifiqué a mano

Estos no estaban en mi lista y son, en conjunto, más graves que los 16 de arriba. Los cuatro primeros son **datos inventados presentados como medidos**, que es la categoría que hace perder un contrato.

| # | Sev | Qué | Dónde |
|---|---|---|---|
| **F17** | **P0** | **«Volumen por hora» es una onda seno.** Al hacer click en un día se abre un modal con un histograma de 24 barras generado con `Math.sin((h - 10) / 24 * Math.PI) * 0.5 + 0.5` escalado por `total/24 * 1.6`, rotulado «Volumen por hora» y presentado como dato medido. Replicado en **tres** pantallas; la copia de Tópicos añade `jitter` determinista para romper la simetría del seno y ahí el modal no tiene ningún otro contenido cuantitativo real que compense. La auditoría del 16 jul ya lo señaló y sigue en `origin/main`. | `screens.js:1574-1577` (Sentimiento), `2003-2007` (Tópicos), `268-286` (Scorecard) — **verificado a mano** |
| **F18** | **P0** | **«Actividad reciente» es un registro de auditoría inventado**, idéntico para todos los usuarios, con IPs falsas (`10.24.1.18`) y entradas como «Exportó reporte semanal» / «Editó regla de alerta #R-12». Se muestra en el drawer de cada usuario de un producto de gobierno. | `screens.js:3954-3960` — **verificado a mano** |
| **F19** | **P0** | **«78 municipios monitoreados» está hardcodeado** en el subtítulo de la card del mapa, sin relación con cuántos municipios tienen datos en el periodo. | `screens.js:2755` — **verificado a mano** |
| **F20** | **P0** | **La barra dice 7D y los datos son de 30 días.** El boot pide `/api/eco-data?period=1M` cuando `localStorage.eco.period` está vacío, mientras el estado que ilumina el chip arranca en `'7D'`. Y `window.ecoSignOut` hace `localStorage.clear()`, así que esto pasa **en cada inicio de sesión tras cerrar sesión**, no en un caso raro. | `index.html:1356` vs `app.js:242` y `shell.js:432-470` |
| **F21** | **P0** | Invitar un usuario sin tocar el selector de rol crea un **«Solo lectura»** aunque el formulario muestre «Analista». | `screens.js` `UserDrawer` |
| **F22** | **P0** | **«Usuario guardado»** se muestra también cuando la API rechazó el cambio (no se comprueba `res.ok`). Y un fallo de la API se pinta como «no hay usuarios · ajusta los filtros». | `screens.js` `UsersAdmin` |
| **F23** | **P0** | El **badge rojo del rail cuenta reglas activas, no alertas sin atender**, así que nunca baja: es un «4» permanente que enseña al usuario a ignorar el color de alarma. | `shell.js:84-85` |
| **F24** | **P0** | Los **círculos del mapa no son proporcionales**: radio lineal con piso de 8px, así que el área exagera los municipios pequeños. Y el tamaño del círculo **cambia de significado** al pulsar «Sentimiento» sin que nada lo declare. | `charts.js` `PRMap` |
| **F25** | **P0** | El **gauge de crisis reparte NORMAL/ELEVADO/ALERTA/CRISIS en cuartos iguales** cuando los umbrales reales son 0.25/0.40/0.60, y deja la palabra «ALERTA» impresa sobre la zona de CRISIS. | `screens.js` `OverviewHighlights` |
| **F26** | **P0** | La **leyenda de la tendencia colorea la dirección, no la valencia**: «NEGATIVO ▼8.5%» —una buena noticia— sale en rojo, y «▲0.0%» en verde. Además mide el delta contra el **día 1 de la ventana**, no contra el día anterior. | `charts.js:259-275` |
| **F27** | **P0** | **«910 menciones clasificadas» son etiquetas de emoción, no menciones.** El API cuenta `jsonb_array_elements` y el processor asigna hasta 3 por mención, y encima se recorta al top-8: el denominador está inflado y truncado a la vez. | `api/eco-data/route.ts:855-865`; `screens.js:1790`, `1819` |
| **F28** | **P0** | **Cinco comandos del ⌘K prometen filtrar Menciones y no filtran nada**: `mentionsFilter` no lo consume ningún componente. Y «Todas las menciones» de `/search` está acotado en silencio al periodo del header y descarta pertinencia «baja» y duplicados. | `shell.js` CommandPalette; `api/eco-mentions/route.ts` |
| **F29** | P1 | El tema `mando` **light** es alcanzable (botón del sol, persistido en `localStorage`) y está **roto en 6 sitios**: los marcadores y el tooltip de Leaflet llevan hex de dark, `SENT_HEX` usa la paleta de costa, y `--warn` (3.86:1) y `--text-3` (3.21:1) fallan AA sobre blanco. La causa estructural: Leaflet recibe los colores como strings en opciones JS, no como CSS, así que no puede resolver custom properties. | `charts.js:810-826`, `shell.js:761-763`, `screens.js:2454`, `index.html:166,174` |

**Las consecuencias semánticas de `--accent === --neg`** que no había visto: la escala de Brand Health pinta la banda **FUERTE** (la mejor) con el **mismo rojo que CRÍTICO** (la peor); el gauge de NSS pinta **MUY POS** igual que **MUY NEG**; en la gráfica multi-métrica las series «NSS» y «Crisis» son indistinguibles; y `BAND_TONE` manda FUERTE, MUY POS y ACELERADA al tono `accent`, que es el rojo. El delta de volumen es **verde-si-sube en el Scorecard y rojo-si-sube en Tópicos** — el mismo dato, colores opuestos, verificado por píxel.

---

## 5 · Narrativas: **no está congelada — está degradada 40× y llega tarde**

> **Corrección.** Las secciones anteriores de este informe (y la nota de proyecto
> que las alimentó) afirmaban que la detección de narrativas estaba congelada
> desde el ~6 de julio y que la crisis de Domenech no había generado ninguna.
> **Las dos cosas son falsas.** Dos de las unidades de esta auditoría consultaron
> la base de datos de producción y midieron lo siguiente el 3 de agosto:
>
> - Hay **1,291 narrativas**; la última se creó el **2026-08-03 a las 07:15**.
> - La crisis de Domenech **sí parió narrativa**: «Salida de Domenech e Itza
>   García», 62 menciones, `born_at` 2026-07-21, `created_at` 2026-07-23.
>
> Lo que colapsó no es la existencia, es el **ritmo** y la **frescura**:
> gobernadora pasó de ~457 narrativas por semana a ~10, y muchas nacen con
> `born_at` de 2025 y el mismo run que las crea las marca `dormant`.

### 5.1 · La causa dominante no es `eps`: es la ventana del pool

El DBSCAN de gobernadora recibe **siempre exactamente 12,000 candidatos**
ordenados por `created_at ASC` (`narrative-cluster/index.ts:356-357`). De esos:

| | |
|---|---:|
| publicaciones de **2025** | **9,801 (81.7%)** |
| publicaciones de los **últimos 7 días** | **68 (0.57%)** |

Las menciones de hoy **nunca entran al muestreo**. La prueba directa, medida
sobre el pool real:

| Muestreo | Core points |
|---|---:|
| Ventana de 72 h del pool actual, eps=0.19 / minPts=7 | **29** |
| La misma ventana a eps=0.30 | **47** |
| El pool oldest-first completo, 96 corridas de las últimas 48 h | **0 clusters** |

Es decir: **con un muestreo coherente el `eps` que ya corre en producción pare
narrativas**. Subirlo sin arreglar la ventana no habría resuelto nada.

Y `created_at` no es utilizable como eje temporal: es fecha de encolado, y un
backfill la pone «hoy» para menciones viejas — **53,225 candidatos de
gobernadora se crearon el 29–30 de julio con `published_at` de 2025**. La
re-encolada la resetea, así que no es monótona. El filtro tiene que ir sobre
`published_at`, con **el mismo predicado en la poda y en la admisión**.

### 5.2 · La contradicción `eps` ↔ dedup queda refutada

Sostenía que el dedup borraba justo los pares que darían densidad. Medido: los
duplicados son **0.9%–4.4%** de las menciones de 30 días y **no se borran** —
`processor/index.ts:266` los persiste con `is_duplicate = true`. Añadirlos como
puntos no mueve la densidad.

### 5.3 · No hay rodilla en la curva k-distancia

El barrido k-NN sobre la ventana de Domenech (685 puntos) da pendientes
p05→p10 = 0.86, p10→p25 = 0.90, p25→p50 = 0.456: la curva **se aplana sin
formar codo**. Sin brecha de densidad, **cualquier `eps` global es política, no
descubrimiento**. El p25 de la 6-NN es 0.300; el 0.19 que corre en producción
está en el **p12**. De ahí la recomendación de fijar `eps` por percentil de la
k-distancia **de la ventana** con clamp `[0.22, 0.34]`, en vez de una constante
mágica — y de pasar a **HDBSCAN** como respuesta de fondo (elimina el `eps`
global, tolera densidad variable entre agencias, y su árbol condensado da la
jerarquía padre/hijo que hace falta para `split`/`merge`). Su MST es O(n²), así
que sólo es viable **con la ventana ya puesta**: la ventana no es la alternativa
a HDBSCAN, es su prerrequisito.

### 5.4 · La asignación está muerta por otra razón

`assigned = 0` en **todas** las corridas. Dos causas medidas:

- La **máxima similitud** promedio de una mención contra cualquier centroide es
  **0.44–0.51**, y el umbral es **0.78**: vive en la cola de la distribución.
- **1,273 de 1,291 narrativas (98.6%)** están `dormant`, y la asignación las
  excluye (`index.ts:218`).

Incluir dormant recientes sube de **1 a 19** los matches de 642 menciones de
gobernadora en 7 días, y es la única forma de hacer `revived` alcanzable — hoy
tiene **0 filas**.

### 5.5 · Tres causas que no estaban en el diagnóstico

- **`born_at` es la mención más VIEJA del cluster** (`index.ts:418-421`, `480`,
  usa `first.published_at`). Con el pool oldest-first, las narrativas nacen con
  `ageDays` grande: **nacen ya `declining` o `dormant` y jamás pasan por
  `emerging`**.
- **La velocidad se mide con `m.published_at`, no con `nm.assigned_at`**
  (`index.ts:540`, `545`). Una narrativa detectada hoy sobre menciones de hace
  cinco días tiene `velocity24h = 0`: **el sistema no tiene noción de "acabo de
  verlo"**. Eso explica la píldora que dice «Pico» junto a «VEL. 24H 0.0».
- **`drift_score` se calcula sólo para `status != 'dormant'`**
  (`narrative-drift/index.ts:112`), se sobrescribe sin guardar historia, y
  aparece en **cero** archivos de `apps/web`. La única señal real de «cambió el
  tema» no llega nunca al usuario.

### 5.6 · Lo que cuesta hoy

**700 s de cómputo × 48 corridas al día (~$34/mes) para producir cero
clusters**, con riesgo de timeout en cuanto `aaa` y `sgpr` lleguen al cap de
12,000. Y no había forma de validar un cambio antes de aplicarlo: `dryRun` no
sirve para probar clustering porque los pasos 3–5 están detrás de
`if (!event.dryRun)` (`index.ts:299`, `311`, `316`). Así se llegó al cambio
manual del 30 de junio que nadie pudo verificar.

### 5.7 · El drift de configuración tampoco existía

Sostenía que producción corría `eps=0.19 / minPts=7` contra un git que decía
`0.22 / 10`. Falso: **`workers-stack.ts:425-426` ya dice `'0.19'` y `'7'`**. El
drift está en los **comentarios** y en los **defaults del código**
(`narrative-cluster/index.ts:55-56`, comentario en `workers-stack.ts:387-388`),
que siguen diciendo 0.22/10. Es deuda de documentación, no de infraestructura.

### 5.8 · Y la pantalla afirma lo que no puede sostener

Narrativas es **el único enclave del producto**: la única pantalla sin `.card`,
sin `ecoCols`, con breakpoint propio (980px) y con paleta importada de Ant
Design. Sobre esa base comete el error más caro: la píldora dice «Pico» junto a
«VEL. 24H 0.0», el resumen dice «Volumen estable» a 40px de «Sin datos
temporales todavía», y **tres de ocho narrativas —las dos más grandes del
cliente— se renderizan en inglés crudo, sin punto de color y sin que ningún chip
las cuente**.

Hay además dos implementaciones rivales y dos APIs rivales. La de Next.js está
**huérfana** (nadie la enlaza), es de tema claro dentro de un producto oscuro y
**no compila en runtime** (`<Link><a>` con Next 15).

## 6 · Catálogo por pantalla

Trece unidades auditadas (3 de fundación + 10 pantallas), **337 hallazgos**: **91 P0**, 190 P1, 56 P2.

Los 24 P0 de las cuatro primeras pantallas pasaron por una ronda de **refutación adversarial** que tumbó **3** —uno de ellos era aritmética de mi propio harness, no un defecto del producto— y corrigió la severidad o el enunciado de 21. Los 67 P0 restantes **no** pasaron esa ronda porque se agotó el cupo del workflow: van marcados *sin verificar*, y los que cito con `archivo:línea` en §4 los comprobé a mano.

| Unidad | P0 | P1 | P2 | Total |
|---|---:|---:|---:|---:|
| Overview | 7 | 18 | 3 | 28 |
| Scorecard táctico | 8 | 13 | 3 | 24 |
| Pantalla Menciones | 5 | 16 | 3 | 24 |
| Pantalla Sentimiento | 6 | 15 | 7 | 28 |
| Pantalla Tópicos | 9 | 12 | 4 | 25 |
| Pantalla Narrativas | 7 | 20 | 3 | 30 |
| Geografía | 9 | 14 | 1 | 24 |
| Pantalla Alertas | 12 | 11 | 4 | 27 |
| Configuración / Usuarios y roles | 5 | 15 | 5 | 25 |
| Búsqueda global | 5 | 15 | 5 | 25 |
| Espaciado, radios, elevación, movimiento e inventa | 1 | 20 | 7 | 28 |
| Sistema tipográfico de ECO + plan de migración a B | 4 | 11 | 4 | 19 |
| Sistema de COLOR de ECO | 13 | 10 | 7 | 30 |
| **Total** | **91** | **190** | **56** | **337** |

> El catálogo completo de los 337 hallazgos está en [`auditoria-diseno-2026-07-catalogo.md`](auditoria-diseno-2026-07-catalogo.md).

### Overview

El Overview es la pantalla que el cliente abre primero y la que va a proyectar en una reunión, y hoy su problema de fondo no es estético: es que **codifica mal la verdad**. Tres de sus cinco bloques dicen algo distinto de lo que dicen sus propios números — la gráfica de tendencia normaliza cada línea a su propio min/max y dibuja "positivo" (el más pequeño) por encima de "negativo" y "neutral"; el gauge de crisis reparte las etiquetas NORMAL/ELEVADO/ALERTA/CRISIS en cuartos iguales aunque los umbrales reales son 0.25/0.40/0.60, así que la palabra "ALERTA" queda impresa sobre la zona de CRISIS y el marcador al 41% parece lejísimos de la alerta mientras el titular grande dice "Alerta"; y la tabla de tópicos cierra con un "TOTAL DEL PERIODO 1.3K" que no es la suma de las filas que tiene encima (1,195 = 91%). El segundo problema es que la pantalla tiene **cinco fuentes de verdad sin reconciliar** para cifras que el ojo compara sin querer: el hero (1,313), el badge del nav (1.3K, congelado en el load y de otro endpoint), el delta del termómetro (vs ventana previa), el delta de la leyenda del chart (vs el día 1 de la ventana, y con el color invertido) y la prosa de IA (+18%, neto −8.4 — una métrica que ya no existe en esta pantalla). El tercero es de jerarquía: 114px de chrome (con el botón de tema solo en su propia línea por un flex-wrap accidental) más 110px de tarjeta para tres nú…

> ⚠️ **Salvedad sobre este resumen.** La afirmación de que «TOTAL DEL PERIODO 1.3K no es la suma de las filas que tiene encima» **fue refutada** en la ronda adversarial (hallazgo `OV-06`): el descuadre era aritmética de las fixtures del harness, no del producto. El resto del resumen se sostiene. Ver los refutados al final del catálogo.


- Escalas implícitas: ninguna gráfica del Overview declara su eje. La tendencia normaliza por serie, el gauge no marca sus umbrales y las barras de tópicos normalizan a 100% — en los tres casos el canal visual más fuerte (altura, posición, longitud) no codifica la magnitud que el lector cree estar leyendo.
- Una cifra, muchos dueños: hero, badge del nav, deltas del termómetro, deltas de la leyenda del chart y prosa de IA calculan lo mismo desde pipelines distintos (buildSentimentReport, loadMetricsForWindow, D.TIMELINE congelado, lambda de insights) y ninguno declara su base de comparación ni su fuente.
- El color se agotó: --accent === --neg y BAND_TONE colapsa ALERTA y CRISIS en el mismo tono, así que el naranja significa a la vez marca, sentimiento negativo, alerta y crisis; y --text-3 significa a la vez 'texto terciario' y 'sentimiento neutral'. Sin tokens semánticos separados no hay forma de escalar la señal.
- El sistema existe pero la pantalla no lo consume: hay una escala tipográfica y un piso de 12px en tokens.css (--fs-caption/--fs-overline) y un --text-3 corregido a 5.00:1, pero el Overview sigue con fontSize/color/gap literales en objetos inline, de ahí las 47 instancias bajo contraste y los tres tamaños distintos (9/10/11px) para el mis…
- Numeración editorial 01..05 aplicada sobre secciones condicionales y con dos ubicaciones (fuera de la card en 01/05, como título de card en 02/03/04): promete un orden de lectura que el layout no sostiene y deja huecos (01, 03, 04, 05) cuando falta un dato.
- Interactividad sin gramática: en una pantalla conviven <button> real (termómetro, crisis), <div onClick> no enfocable (filas de tópicos) y <svg onClick> (chart), todos señalizados apenas por una flecha de 11px a 2.65:1 o por un hover — no hay forma de saber qué es clickeable, y con teclado la mitad no existe.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| ✔︎ OV-01 | La gráfica de tendencia invierte el orden de los sentimientos: dibuja "positivo" arriba siendo el más bajo | `apps/web/public/eco-prototype/charts.js:220-227 (rama por defecto) y :335; in…` | Pasar `sharedScale` en OverviewTendencia (screens.js:4344) — es una serie de conteos con la misma unidad (menciones/día) y un 0 natural, así que la e… |
| ✔︎ OV-02 | Gridlines sin rótulos y un canal de 44px reservado para un eje Y que nunca se dibuja | `apps/web/public/eco-prototype/charts.js:293-302 (gridlines siempre, labels só…` | Acoplar gridlines y rótulos: si no hay escala rotulable, no dibujar gridlines (o dibujar sólo la línea base). Hacer `padding.l` condicional (44 cuand… |
| ✔︎ OV-03 | El gauge de crisis reparte NORMAL/ELEVADO/ALERTA/CRISIS en cuartos iguales y deja "ALERTA" impresa sobre la zona de CRISIS | `apps/web/public/eco-prototype/screens.js:4298-4300 (justifyContent: space-bet…` | Posicionar las etiquetas en el punto medio real de cada banda (12.5% / 32.5% / 50% / 80%) con `position:absolute; left:X%; transform:translateX(-50%)… |
| ✔︎ OV-04 | ALERTA y CRISIS son el mismo naranja, y la palabra "Alerta" está pintada con el color de la zona CRISIS | `apps/web/public/eco-prototype/screens.js:34 (#E0662E para ALERTA, var(--neg)…` | Cuatro peldaños con hue y luminancia crecientes y tokens propios: --band-normal (var(--pos)), --band-elevado (var(--warn)), --band-alerta (ámbar-nara… |
| ✔︎ OV-05 | La leyenda del chart mide el delta contra el día 1 de la ventana y le pone el color al revés: "NEGATIVO ▼8.5%" sale en rojo y "▲0… | `apps/web/public/eco-prototype/charts.js:263-264 (delta contra s.vals[0]) y :2…` | Un solo contrato de delta para toda la pantalla: reutilizar formatDelta/DeltaDisplay de @eco/shared/format (ya distingue 'estable' y 'sin base') y pa… |
| ✔︎ OV-07 | Las etiquetas de último valor quedan recortadas a un dígito: el chart cierra mostrando "3", "5", "4" como si fueran puntuaciones | `apps/web/public/eco-prototype/charts.js:415-417 (translate(innerW+4), rect wi…` | padding.r ≥ 56 (46 de caja + 4 de gap + 6 de respiro) o, mejor, mover la etiqueta a la IZQUIERDA del último punto (`translate(innerW - 50)`) con anch… |

### Scorecard táctico

El Scorecard es la pantalla donde el cliente toma decisiones y hoy es la menos fiable del producto: no porque falten datos, sino porque cada widget resuelve su propia verdad. En una sola vista conviven cinco cifras distintas de "menciones" (4.0K en el KPI, 1.3K en el enlace, 1,024 en el resumen IA, 999 en el heatmap, 4.0K en el badge del rail), una gráfica de 30 días bajo un selector que dice 7D, y tres escalas de banda cuyas etiquetas están colocadas por reparto tipográfico (`space-between`) y no en sus umbrales reales — de modo que un 41% que el sistema clasifica como ALERTA aparece visualmente bajo la palabra ELEVADO. El color, que debería ser el atajo cognitivo, es lo primero que engaña: polarización ALTA se pinta en verde, la banda FUERTE de Brand Health usa el mismo naranja que la banda CRÍTICO, y crecer +42% en volumen es verde mientras crecer +12% un tópico es rojo. La jerarquía está invertida: la palabra cualitativa mide 30px y el dato medible 13px, con cinco gramáticas visuales distintas en cinco tarjetas contiguas; el veredicto del NSS ("Neutral") se pinta con el color terciario del sistema y se lee como deshabilitado. En móvil el reflow "funciona" (cero desbordes de página) pero la jerarquía se pierde: el primer indicador aparece en la segunda pantalla, el titular de cada mención se comprime a 130px mientras engagement y hora quedan fuera del viewport, y el subtítu…

- Las tres escalas de banda (crisis, Brand Health, polarización) dibujan sus etiquetas con `justify-content: space-between` en vez de posicionarlas en su umbral real → el rótulo nombra una zona de color que no es la suya y el sesgo sistemático es subestimar la severidad.
- Cada widget resuelve su propia ventana, fuente y total sin reconciliación: cinco cifras de 'menciones', un chart de 30 días bajo un selector de 7D, subtítulos con el periodo escrito a mano ('30d') y un drill-down que contradice la tarjeta desde la que se abre.
- Una sola tabla banda→tono (BAND_TONE) sirve a 4 métricas con tokens que colisionan (ALTA, EXTREMA, FUERTE) y en el tema activo `--accent` era idéntico a `--neg`: el color deja de ser monótono con la severidad y en dos casos se invierte.
- El giro a 'palabra protagonista' se llevó toda la jerarquía y dejó el número medible como nota al pie (30px vs 13px), con una gramática visual distinta por tarjeta: sparkline, gauge de gradiente, barra segmentada, área y nada.
- No hay contrato de nulos: null se coacciona a 0 y se presenta como veredicto (crisis→NORMAL verde, polarización→'apática', heatmap→'Pico: Lun a las 0:00' sobre 168 ceros) o revienta el path (`M 2,NaN`, 4 errores de consola por render).
- El cromo de escritorio se hereda intacto en móvil: borde vertical del rail sin segunda columna, `.card-hd` que nunca pasa a columna, columnas de tabla fuera del viewport y microcopy que pide 'pasar el cursor' en una pantalla táctil.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| ✔︎ SC-01 | La barra dice 7D y los datos son de 30 días: el periodo por defecto está partido en dos | `apps/web/public/eco-prototype/index.html:1356 vs app.js:242 (y shell.js:66)` | Un único default en un solo sitio: exportar `ECO_DEFAULT_PERIOD = '7D'` desde shell.js y consumirlo en index.html:1356, app.js:242 y getPeriodParams(… |
| ✔︎ SC-02 | Cinco totales de 'menciones' en una pantalla, y el drill-down contradice la tarjeta que abriste | `apps/web/public/eco-prototype/screens.js:452, 573, 336, 668 y shell.js:84` | Definir 'menciones del período' como un único campo del API (`CURRENT_METRICS.totalMentions`, misma fuente y mismo dedup que usa el resumen IA) y con… |
| ✔︎ SC-03 | Las tres escalas de banda colocan sus etiquetas por reparto tipográfico, no en su umbral: el rótulo nombra la zona de color equiv… | `apps/web/public/eco-prototype/screens.js:447-449 (crisis), 470-472 (polarizac…` | Reemplazar los pies `space-between` por rótulos posicionados en el umbral: contenedor `position:relative` y cada etiqueta en `left: <umbral>%` con `t… |
| ✔︎ SC-04 | Polarización ALTA se pinta en verde y EXTREMA en amarillo: la escala de color no crece con la gravedad | `packages/shared/src/format/metrics-display.ts:93-95 (BAND_TONE)` | Dejar de mapear por token de texto y mapear por métrica + índice de banda: `TONE_BY_METRIC = { polarization: ['neutral','warn','neg','neg-strong'], c… |
| ✔︎ SC-05 | En Brand Health la banda FUERTE (la mejor) se pinta igual que CRÍTICO (la peor) | `apps/web/public/eco-prototype/screens.js:612-617 y packages/shared/src/format…` | Sacar `--accent` de la escala de bandas: rampa monótona `CRÍTICO → --neg`, `DÉBIL → --warn`, `SANO → --pos` y `FUERTE → --pos` reforzado (p.ej. `colo… |
| ✔︎ SC-06 | La gráfica principal no tiene eje Y, normaliza cada serie a su propio min/max y apoya la base en el mínimo — e invita a superpone… | `apps/web/public/eco-prototype/charts.js:220-227 (normalización), 293-302 (lab…` | Rotular siempre el eje: sacar la condición `sharedScale` de charts.js:296 y etiquetar con `fmtVal` de la serie primaria. Para volúmenes forzar `min =… |
| ✔︎ SC-08 | 'Tópicos emergentes · Ordenados por crecimiento' está ordenado por volumen, y el signo del crecimiento se colorea al revés que en… | `apps/web/public/eco-prototype/screens.js:516, 520 y 525` | Ordenar de verdad por delta (`[...D.TOPICS].sort((a,b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity))`, la misma expresión que ya usa el briefin… |

### Pantalla Menciones

Menciones es la pantalla donde la promesa del producto ("ver la conversación") choca con una tabla diseñada como rejilla de metadatos: el titular es la ÚNICA columna elástica (2fr) mientras sentimiento/tópico/hora tienen ancho fijo, así que cada píxel que se pierde lo paga el contenido — a 1440px ya se truncan 7 titulares y 5 tópicos, y a 390px el titular se reduce al 19% de su texto (178px visibles de 925px). La fila superior de 5 KPI vive en OTRO universo de datos: sale de /api/eco-data (que no excluye baja pertinencia) mientras la lista sale de /api/eco-mentions (que sí la excluye), de modo que la pantalla afirma dos totales incompatibles a 200px de distancia (TOTAL 1.3K vs "1,024 menciones") y además esos KPI no reaccionan a ningún filtro: puedes filtrar "Negativo" y las cinco cifras siguen siendo las del período completo. La honestidad temporal es el otro agujero: el API entrega la hora SOLO en relativo ("hace 6 h"), no existe fecha absoluta en ninguna superficie del producto, y la misma página muestra "hace 4 h" bajo un sello que dice "DATOS AL CIERRE DE AYER". Tipográficamente todo es metadato: 643 de 676 elementos de texto miden ≤12px y no hay ningún escalón entre 13px y 22px, así que el ojo aterriza primero en la palabra naranja "Acelerada" (30px) y en los pills de sentimiento en mayúsculas, no en los titulares. En móvil el reflow es correcto (0 desbordes horizontales…

- Dos universos de datos en una pantalla: /api/eco-data (todas las pertinencias, sin filtros de UI) alimenta los KPI y /api/eco-mentions (excluye 'baja') alimenta la lista; cualquier cifra de arriba contradice a la de abajo y ninguna reacciona a los filtros.
- Manda el metadato: el grid da anchos fijos a sentimiento/tópico/hora y deja el titular como única pista elástica, y además le da al metadato el color más fuerte (pills) y al contenido el peso más débil (12px/500).
- El tiempo absoluto no existe: relativeTime() en el API borra la fecha real antes de llegar al cliente, así que lista, cards, columna 'FECHA' y el drawer sólo pueden decir 'hace N h' — y eso contradice el sello 'datos al cierre de ayer'.
- Cero tokens consumidos: tokens.css ya define escala tipográfica con piso de 12px, --on-* y un --text-3 corregido a 5:1, pero MentionsScreen es 100% estilos inline con literales (10/11/12px, 110px, #hex de facto), así que la capa de sistema no llega a esta pantalla.
- Cargando/error/vacío no son estados reales: la lista nunca se apaga durante el fetch (muestra filas del filtro anterior), los KPI nunca fallan porque vienen de otra fuente, y un fetch roto se dibuja como un '0' indistinguible de una medición.
- Tres modos de vista pero ningún modo responsivo: la elección Lista/Cards/Tabla es del usuario y se persiste en localStorage, cuando el modo correcto depende del ancho — Cards es la única vista legible en teléfono y nunca se activa sola.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| ✔︎ MEN-01 | Dos totales incompatibles a 200px de distancia (TOTAL 1.3K vs "1,024 menciones") | `apps/web/pu…` | Una sola fuente para el total de la pantalla: alimentar la tarjeta TOTAL con `data.total` del mismo fetch que la lista, y mostrar debajo la exclusión… |
| ✔︎ MEN-02 | Los 5 KPI no responden a los filtros de la propia pantalla | `apps/web/pu…` | Recalcular los KPI desde la respuesta filtrada — /api/eco-mentions ya devuelve `total` y el desglose `sentiment {pos,neu,neg}`, y `minEngagement` per… |
| ✔︎ MEN-03 | Lo no clasificado se presenta como NEUTRAL (y el estilo para "sin clasificar" es inalcanzable) | `apps/web/sr…` | Propagar el tercer estado: pillFromSentiment debe devolver 'sin_clasificar' cuando nlp_sentiment y bw_sentiment son NULL; la lista lo pinta con .pill… |
| ✔︎ MEN-04 | La fecha absoluta de una mención no existe en ninguna parte del producto, y el relativo contradice el sello del header | `apps/web/sr…` | Devolver `publishedAt` ISO (y opcionalmente `publishedAtLabel` relativo) y formatear en cliente en TZ America/Puerto_Rico: en la lista el relativo co… |
| ✔︎ MEN-05 | En móvil el titular queda al 19% y la primera pantalla no contiene ni una mención | `apps/web/pu…` | En breakpoint mobile, no renderizar el grid tabular: fila apilada de dos líneas (titular con clamp de 2 líneas a 14px + línea de metadatos "fuente ·… |

### Pantalla Sentimiento

La pantalla está bien compuesta —cuatro tarjetas, un hero, buen reflow sin desbordes— y aun así es la menos confiable que he auditado, porque las tres afirmaciones más grandes que hace son mutuamente incompatibles: el hero dice "Neutral", el donut de al lado dice 44% negativo contra 21% positivo, y el párrafo interpretativo dice "dentro de rango positivo". Ese párrafo está escrito a mano en el JSX (screens.js:1641): no cambia con la agencia, el periodo ni los datos, y sigue narrando una crisis vial incluso cuando la pantalla está vacía. Debajo hay un patrón repetido: cada widget resuelve su propio denominador sin declararlo —910 "menciones clasificadas" que en realidad son etiquetas de emoción multi-label recortadas al top-8, barras normalizadas que dan el mismo peso visual a un canal de 66 menciones y a uno de 446, y un residuo de redondeo que siempre se descarga en el bucket "negativo"—. El color agrava todo: la emoción dominante (Ira) y tres más caen al mismo gris de fallback, que es también el gris del texto terciario y el de la serie Neutral. Lo notable es que el arreglo ya está escrito: tokens.css define --emo-ira, --emo-tristeza, --chart-grid, la escala --fs-* y las clases .t-*, y screens.js consume exactamente cero de ellos (0 ocurrencias de emo-, cat-, chart-grid, fs-, t-display). No es una pantalla que necesite rediseño; es una pantalla que necesita conectarse al sis…

- La capa de tokens ya existe y esta pantalla no consume ni uno: tokens.css define --emo-* (los 7 nombres exactos que se ven en pantalla), --cat-*, --chart-grid/axis/void, la escala --fs-* con piso declarado de 12px y las clases .t-*; grep sobre screens.js da 0 ocurrencias de cada familia. Tres commits de sistema de diseño (92e0d4a, d8ddb3…
- Cinco taxonomías de emociones en el mismo producto: el enum del processor (único que puede llegar a la DB), el colorMap del API, emotionColor() del front, los --emo-* de tokens.css y los datos que se ven en pantalla. La palabra 'frustración' es la ÚNICA que aparece en todas. Todo lo demás cae a gris.
- Denominadores invisibles: cuatro decisiones estadísticas que el lector no puede ver — etiquetas multi-label contadas como menciones, recorte al top-8, normalización a 100% sin n, y residuo de redondeo asignado siempre al negativo. Ninguna está anotada en la interfaz.
- El gris --text-3 hace triple trabajo: texto terciario, serie de datos 'Neutral' y color de fallback de emoción desconocida. El token --neu existe para desacoplarlo y no se usa. Cualquier ajuste de contraste del texto cambiará el significado de datos.
- El vocabulario de bandas no es monótono en color: el ramp del NSS va rojo → ámbar → gris → verde → NARANJA, porque 'MUY POS' mapea a 'accent'. Lo mejor que puede pasarle al sentimiento se pinta del color que en este producto significó negativo durante toda su historia.
- Móvil no es una degradación de layout sino de tipografía y target: el censo de fuentes es idéntico byte a byte entre 1440 y 390 (mismos 139 nodos, mismos tamaños), y píldoras, tabs y segmentos siguen midiendo 12–22px de alto en el teléfono.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| ✔︎ SEN-02 | El párrafo interpretativo del hero está escrito a mano en el JSX y contradice los datos de su propia tarjeta | `apps/web/pu…` | Borrar el literal. Dos opciones, en este orden: (a) reemplazarlo por el insight generado que ya existe —hay un endpoint /api/eco-metric-insight y ope… |
| ✔︎ SEN-03 | Al hacer click en un día se abre un histograma «Volumen por hora» generado con una onda seno sintética | `apps/web/pu…` | Quitar las tres generaciones sintéticas. Si /api/eco-mentions puede agregar por hora para el día seleccionado, pedirlo y renderizarlo; si no puede to… |
| ✔︎ SEN-04 | «910 menciones clasificadas» son etiquetas de emoción, no menciones: denominador multi-label y recortado al top-8 | `apps/web/sr…` | Separar las dos magnitudes en el API: devolver `emotionTagCount` (la suma actual) y `classifiedMentionCount` (`COUNT(DISTINCT m.id) WHERE jsonb_array… |
| · SEN-05 | La tarjeta «Sentimiento en el tiempo» grafica volumen absoluto apilado, así que no puede responder si el sentimiento empeoró | `apps/web/pu…` | Dos series, no una: (a) un área 100% normalizada (cada día suma al alto completo) que muestre la MEZCLA, con el volumen del día como barra tenue de f… |
| · SEN-06 | La emoción dominante «Ira» y tres más se pintan del mismo gris de fallback; los tokens --emo-* correctos ya existen y no se usan | `apps/web/pu…` | Reemplazar el cuerpo de emotionColor por un lookup a los tokens: `var(--emo-<slug>)` con normalización de acentos, y un `--emo-unknown` obligatorio (… |

### Pantalla Tópicos

Tópicos es la pantalla donde el cliente debería contestar en cinco segundos "¿de qué se está hablando y qué se está calentando?", y hoy contesta mal por tres razones que no son cosméticas. Primero, ninguno de los tres widgets codifica lo que su forma promete: el "Treemap" es una rejilla de filas de 76px donde el rango manda y el área no (171 y 53 menciones ocupan exactamente el mismo espacio, mientras 210 vs 171 se dibujan 4:1), el calendario coloca los días por índice de array y no por fecha (la cabecera LUN…DOM sólo es verdad si no falta ni un día), y las burbujas ubican los tópicos en posiciones pseudoaleatorias sin significado. Segundo, un único naranja #FF6A3D significa a la vez "vista activa", "sentimiento negativo" y "el volumen subió": el mejor dato de la pantalla (Desarrollo económico +12%) se pinta con el mismo color de alarma que el peor. Tercero, cada widget resuelve su propia ventana temporal y su propio total bajo un mismo chip "7D" — el treemap cuenta 7 días cerrados, el calendario 35 días, el detalle 30 días rolantes e incluye menciones secundarias que el pie de página promete excluir — de modo que dos cifras del mismo tópico en la misma pantalla difieren ~42% sin explicación. A eso se suma un defecto de maquetación que aparece en los cuatro viewports capturados: los tiles de altura fija no contienen su contenido, así que la barra de sentimiento y el delta de c…

- Un solo hex, tres semánticas: #FF6A3D es acento de marca (chip activo), sentimiento negativo (título del tópico + tercera banda de cada barra) y dirección del delta (↑ = naranja) dentro de 300px de pantalla, y ningún widget del treemap lleva leyenda. tokens.css ya separa --neg (#FF5470) pero no toca el tercer uso, que está hardcodeado a…
- Widgets que prometen una codificación y entregan otra: 'Treemap' sin área proporcional, calendario indexado por posición en vez de por fecha, burbujas con posición aleatoria y radio con piso, y una columna 'Distribución' que superpone volumen y mezcla de sentimiento en una sola marca. El nombre y la forma prometen precisión que el cálcul…
- Cajas de altura fija con contenido variable: gridAutoRows:'76px' en el treemap, aspectRatio 1/1 + minHeight:62 en el calendario y .card-hd sin flex-wrap producen desbordes que el ojo interpreta como pertenencia al vecino. No es un bug responsive (no hay scroll horizontal): es contenido que se pinta encima de otro contenido en 390, 768, 1…
- Cada widget resuelve su propia ventana temporal y su propio total: treemap = 7 días cerrados (top-confidence), calendario = mínimo 35 días, tabla del detalle = 30 días rolantes con primarias+secundarias. Todo bajo un único chip '7D' y un badge 'DATOS AL CIERRE DE AYER'. Es el patrón F9 (cinco totales en el Scorecard) repetido aquí.
- Datos inventados donde no hay datos: el histograma 'Volumen por hora' del modal de día se genera con Math.sin + jitter determinista, y splitSentiment reparte pos/neu/neg con una tabla de sesgos fija. En vez de decir 'no disponible por hora', la herramienta dibuja una curva plausible — con el mismo pico a las 22:00 todos los días.
- El texto que explica el método es el menos legible de la pantalla: la nota que define qué cuenta cada número (11px, 2.65:1, a 4.100px del primer dato), los nombres de día (9px, 2.65:1) y el volumen de cada celda del calendario (10px, hasta 1.36:1) están por debajo del mínimo WCAG, mientras los números grandes que nadie necesita comparar…

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| · TP-01 | El "Treemap" no codifica magnitud por área: el rango manda y el tamaño miente | `apps/web/pu…` | Dos caminos, en este orden de preferencia. (a) Convertirlo en un treemap real: squarified treemap sobre `count` (≈40 líneas, sin dependencias) con un… |
| · TP-02 | La barra de sentimiento y el delta se dibujan fuera de su tile y quedan pegados al tópico de abajo | `apps/web/pu…` | Eliminar `gridAutoRows:'76px'` y dejar que la fila crezca: `gridAutoRows:'minmax(84px, auto)'` para los tiles chicos y `gridAutoRows:'auto'` con `asp… |
| · TP-03 | Un mismo naranja #FF6A3D significa "vista activa", "sentimiento negativo" y "volumen al alza" a 300px de distancia | `apps/web/pu…` | tokens.css:196/201 ya separa --accent #FF6A3D de --neg #FF5470 (5,85:1, Δhue 24°): asegurar que el build servido tome esos valores. Falta el tercer u… |
| · TP-04 | El delta ↑ se pinta como negativo y ↓ como positivo, sin leyenda y contra la convención del resto del producto | `apps/web/pu…` | Elegir UNA convención y documentarla en tokens.css: recomiendo delta de VOLUMEN neutro en color (gris `--text-2`) con flecha direccional, reservando… |
| · TP-05 | El histograma "Volumen por hora" del modal de día está fabricado con Math.sin y no suma el volumen del día | `apps/web/pu…` | Quitar el histograma del modal hasta que exista el dato: `histogram: null` y en su lugar mostrar la distribución pos/neu/neg real del día (ya viene e… |
| · TP-06 | El calendario coloca los días por índice de array, no por fecha: la cabecera LUN…DOM sólo es verdad si no falta ningún día | `apps/web/pu…` | Construir la rejilla desde el calendario, no desde el array: generar todas las fechas entre `start` y `end`, indexar los datos por `fullDate` en un M… |
| · TP-07 | El calendario muestra 35 días mientras el chip global dice 7D, y se rotula "período seleccionado" | `apps/web/sr…` | Decidir el contrato y hacerlo visible. Opción A (preferida): que el calendario respete el período y muestre un empty state útil cuando el período es… |
| · TP-08 | En móvil y tablet las celdas del calendario se solapan: el texto de un día lo tapa el día siguiente y el color se mezcla | `apps/web/pu…` | No mantener 7 columnas por debajo de ~700px. Sustituir la rejilla mensual por una tira vertical de días (una fila por día: fecha + chip de tópico + v… |
| · TP-09 | El detalle del tópico muestra dos totales distintos del mismo tópico y el pie de página promete un toggle que no existe | `apps/web/pu…` | Pasar `topicMode:'primary'` en `fetchSliceMentions` cuando el llamador es TopicDetail, e implementar de verdad el toggle que la nota promete ("Sólo p… |

### Pantalla Narrativas

Narrativas es un enclave dentro del producto: es la única pantalla con 0 elementos `.card` (censo del probe), la única con 0 usos de `window.ecoCols` (las otras nueve suman 26), la única con un breakpoint propio (980px contra los 768/1024 del sistema) y la única que importa una paleta ajena — los seis colores de estado son copia literal de la paleta por defecto de Ant Design, con sus comentarios `cyan-6 / gold-6 / orange-6`. Sobre esa base, la pantalla comete el error más caro posible para un cliente de gobierno: afirma cosas que no puede sostener. El toolbar resalta "7D" mientras el fetch pide 730 días; la píldora dice PICO junto a "VEL. 24H 0.0"; el resumen declara "Volumen estable" a 40px de una gráfica que dice "Sin datos temporales todavía"; y las dos narrativas de mayor volumen del cliente (214 y 168 menciones, sobre "Apagones y confianza en LUMA" y "Demoras del permiso único") aparecen sin punto de color, con el estado en inglés crudo, sin ser contadas por ningún chip y hundidas en las posiciones 6 y 7 debajo de una narrativa dormida de 44 menciones — en móvil directamente no se ven. Todo eso sale de una sola grieta: el vocabulario de estados no tiene dueño (la API declara `status: string`, el cliente asume un enum cerrado de 6). El panel derecho, que es el 80% del ancho en escritorio, son siete cajas vacías con tres redacciones distintas de "Sin datos" y ~310px de zona…

- La pantalla quedó fuera de las tres migraciones del producto: no usa la primitiva `.card` (probe: cards=0, única pantalla), no usa `useBreakpoint`/`ecoCols` (0 de 26 usos), y no consume `tokens.css`. Tiene su propio card (`.narrative-panel`), su propio chip (`.btn-chip`), su propio input (`.narrative-search`), su propio breakpoint (980px…
- El vocabulario de estados no tiene dueño y por eso se rompe en cinco sitios a la vez. La API declara `status: string` sin enum (route.ts:25); el cliente asume seis valores cerrados (screens.js:4600); el mismo enum está triplicado (SPA, `NarrativeStatusBadge.tsx`, prompts del lambda de clustering). De esa única grieta salen: puntos sin co…
- Nulo, cero y "no calculado" son el mismo píxel. La API hace `Number(x ?? 0)` (route.ts:115-117) y el cliente hace `.toFixed()` sin guarda (screens.js:5063, 5226). El mismo patrón produce a la vez cifras falsamente rotundas ("ENGAGEMENT 0") y basura visible ("nan%"). No hay contrato de nulos entre API y UI.
- La pantalla afirma un periodo que no honra. El toolbar es "el único control de periodo de toda la app" (comentario en shell.js:452) y esta pantalla lo ignora por completo; su API sí soporta `period` pero con un vocabulario que no coincide (no existen `7D` ni `30D`). El sello "DATOS AL CIERRE DE AYER" tampoco aplica aquí.
- El estado vacío no está diseñado, está improvisado por panel. Siete cajas repiten "Sin datos" en tres redacciones, con tres dialectos de fetch-state (con loading, sin loading, o el panel desaparece), y todas conservan su altura completa. La ausencia de datos ocupa más pantalla que los datos.
- El naranja lo significa todo: identidad de marca (`--accent`), sentimiento negativo (`--neg`, idéntico), pico de narrativa (#FA8C16 de AntD), fila seleccionada (`--accent-fill`), anotación de pico y día seleccionado en la gráfica. En un tablero de gobierno la pantalla se lee como una alarma permanente y el lector no puede saber si un tra…

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| · N-01 | El selector de periodo del header no aplica a esta pantalla: el toolbar dice 7D y el fetch pide 730 días | `screens.js:4803 y 4821; app.js:389; apps/web/src/app/api/narrative/route.ts:9…` | Tres pasos, ninguno cosmético. (1) Aceptar `period` en `NarrativeScreen` y pasarlo al fetch usando el helper ya existente `window.ecoWindowParams()`… |
| · N-02 | Un estado fuera del enum se rompe en cinco lugares a la vez y vuelve inalcanzables 3 de las 8 narrativas | `screens.js:4600-4616 (enum), 4849-4853 (conteos), 4893-4907 (chips), 4919 y 4…` | Sacar el vocabulario del cliente y hacerlo contrato: (1) definir el enum en un módulo compartido consumido por la API y por la SPA, y que `/api/narra… |
| · N-03 | El cliente deshace el orden por importancia que la API ya calculó y entierra las dos narrativas más grandes | `screens.js:4856 y 4867-4872 (re-sort por RANK); screens.js:4830-4837 (selecci…` | Un solo criterio de orden, visible y elegible. Ordenar por defecto por volumen dentro de la ventana activa (que es lo que la API ya hace) y exponer u… |
| · N-04 | Cinco afirmaciones contradictorias sobre la misma narrativa en un solo viewport | `screens.js:5042 (píldora), 5047 (resumen), 5063 y 5067 (métricas), 5246 (stre…` | Contrato de nulos explícito en los dos lados. La API debe devolver `null` (no 0) cuando la métrica no está calculada, y la UI debe pintar `null` como… |
| · N-05 | «· nan%» visible al usuario, y la lista que dice estar ordenada por fuerza no lo está | `screens.js:5226 (render), 5222 (tooltip), 5015 (sort), 5005-5017 (memo `relat…` | Un formateador único con guarda para todo porcentaje/ratio de la pantalla: si `!Number.isFinite(v)` devolver `—` y suprimir el separador `·` (hoy el… |
| · N-06 | La pantalla importa la paleta por defecto de Ant Design y la mete en el tema mando: dos hues casi idénticos para significados opu… | `screens.js:4601-4608; comparar con apps/web/src/components/narratives/Narrati…` | Tokenizar los seis estados en `tokens.css` con hues que se separen por CLARIDAD además de por matiz, y escogerlos según semántica de dirección, no de… |
| · N-07 | La píldora de estado falla AA en los seis estados, y desaparece por completo en un séptimo | `index.html:839-847 (`color: white` hardcodeado); screens.js:5042 (background…` | Sustituir `color: white` por `color: var(--on-status, var(--on-warn))` y mover el color de relleno del estilo inline a un `data-status` con reglas CS… |

### Geografía

La pantalla se apoya entera en un mapa de símbolos proporcionales que no es proporcional, no está rotulado y cambia de significado cuando el usuario pulsa "Sentimiento" sin decirlo en ninguna parte: el radio es lineal con un piso de 8px (un municipio con 1 mención dibuja un área 24.6× mayor que la honesta) y en modo Sentimiento el tamaño pasa a codificar |NSS|, de modo que un pueblo con 3 menciones y NSS -10 se convierte en el círculo más grande de la isla y San Juan en un punto. Debajo del mapa hay dos tarjetas que contradicen al mapa y entre sí: "Sentimiento por región" promedia el NSS municipal SIN ponderar por volumen mientras imprime "4 municipios · 669 menciones" al lado, y el mismo indicador ya existe en /sentiment calculado por mención (SENTIMENT_BY_REGION en eco-data), así que las dos pantallas darán cifras distintas bajo el mismo título. El basemap CARTO dark_all remata el problema: medí las etiquetas de lugar en 2.04:1 como máximo (#444 sobre tierra #090909) y los marcadores tapan justo los topónimos que representan, con lo cual ningún círculo se puede atribuir a un municipio sin hover — y en táctil no hay hover. En móvil no es solo pérdida de jerarquía: con contenedor de 314px y minZoom 8 el fitBounds se clampa, la isla se recorta y el zoom-out queda deshabilitado (lo confirma el probe), así que Mayagüez —el #5 por volumen— es literalmente inalcanzable. Nota de enc…

- El mapa quedó fuera de todo contrato de codificación: tamaño, color, escala y umbrales se deciden en el call-site (accessor/colorFn inline en screens.js:2781-2782) y ninguna leyenda declara unidad ni máximo, así que cada modo puede redefinir el significado del mismo símbolo sin que nadie lo note.
- NSS circula por la app como número desnudo, sin token de escala ni umbrales compartidos: el mapa corta en ±2, la tarjeta de región corta en 0 y la divide por 10, y el modal lo imprime crudo como título. Tres verdades para el mismo dato en una sola pantalla.
- La pantalla recalcula a mano en el cliente agregaciones que el API ya entrega (SENTIMENT_BY_REGION, positivo/neutral/negativo por municipio) y las dos versiones no coinciden: es el mismo patrón que produjo los cinco totales del Scorecard (F9).
- Los estados no felices no existen en el contrato: catch vacío, respuesta !ok y arreglo vacío desembocan todos en la misma UI que el éxito, de modo que un filtro fallido se lee como un dato válido.
- La capa Leaflet está fuera del sistema de tokens (11 hex hardcodeados + un azul del tema costa), así que el rediseño de tokens de 92e0d4a ya la desincronizó y el modo claro nunca se probó dentro del mapa.
- La geometría del lienzo es fija (420px de alto, minZoom 8, maxZoom 10) dentro de un producto que ya es responsive: la misma constante produce recorte de datos en móvil y medio lienzo de océano vacío en escritorio.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| · GEO-01 | Los círculos del mapa no son proporcionales: radio lineal con piso de 8px | `apps/web/public/eco-prototype/charts.js:804` | r = rMax·√(v/vMax) con rMin ≈ 3px (no 8) y rMax ≈ 26px; si hace falta visibilidad mínima, usar un anillo de 1px de 4px de radio para v>0 en vez de in… |
| · GEO-02 | El tamaño del círculo cambia de significado al pulsar «Sentimiento» y nada lo declara | `apps/web/public/eco-prototype/screens.js:2781` | En modo Sentimiento mantener tamaño = volumen (comparable entre modos) y mover TODO el significado del sentimiento al color divergente. Exigir volume… |
| · GEO-03 | El mapa y la tarjeta de región dan veredictos opuestos sobre el mismo NSS | `apps/web/public/eco-prototype/screens.js:2782 y 2834-2840` | Definir UNA escala de NSS en tokens (dominio −10..+10, umbrales de neutralidad ±2, tres colores + gris de muestra insuficiente) y consumirla desde el… |
| · GEO-04 | El NSS de región es un promedio SIN ponderar, presentado junto al volumen que ignora | `apps/web/public/eco-prototype/screens.js:2813-2814` | Ponderar por volumen: `sum(m.nss*m.count)/sum(m.count)`, o mejor, calcular NSS de región desde los conteos crudos (Σpos−Σneg)/Σtotal usando m.positiv… |
| · GEO-05 | «Sentimiento por región» existe dos veces en el producto con dos cálculos distintos | `apps/web/public/eco-prototype/screens.js:2810-2815 vs apps/web/src/app/api/ec…` | Geography debe consumir SENTIMENT_BY_REGION (y hacer que /api/eco-geo lo devuelva ya filtrado por fuente/tópico/subtópico, como devuelve municipaliti… |
| · GEO-06 | El mapa no tiene ni un topónimo legible, y los marcadores tapan los que importan | `apps/web/public/eco-prototype/charts.js:752 (tileLayer dark_all)` | Cambiar a `dark_nolabels` + un segundo tileLayer `dark_only_labels` en un pane por encima de markerPane (`map.createPane('labels'); pane.style.zIndex… |
| · GEO-07 | Si la consulta filtrada falla, el mapa sigue mostrando los datos SIN filtrar y no avisa | `apps/web/public/eco-prototype/screens.js:2704-2708` | Guardar `error` en estado y, si la petición falla, vaciar el mapa y pintar un bloque «No se pudo aplicar el filtro · Reintentar» sobre el lienzo (o r… |
| · GEO-08 | «78 municipios monitoreados» está hardcodeado; el mapa solo dibuja 18 | `apps/web/public/eco-prototype/screens.js:2755 y app.js:159` | Derivar el texto: «{munis.length} de 78 municipios con menciones geolocalizadas · {geoCoveragePct}% del volumen del periodo». Añadir al payload de ec… |
| · GEO-09 | En móvil la isla se recorta y el zoom-out está deshabilitado: Mayagüez es inalcanzable | `apps/web/public/eco-prototype/charts.js:745 y 838` | Quitar `minZoom: 8` (o bajarlo a 7) y sustituir la altura fija por un contenedor con aspect-ratio ~16/9 en móvil; llamar a `fitBounds` con `padding`… |

### Pantalla Alertas

Alertas es la pantalla con más deuda de veracidad de todo el producto: es una consola de triage cuyo objeto central —la alerta disparada— es lo último que aparece en la página, no tiene acciones, y llega al lector después de pasar por tres capas que rellenan huecos con valores inventados en vez de admitirlos (la API de eco-data fija `priority:'media'`, `triggered:0`, `lastFired:'—'` para TODAS las reglas; la de historial convierte cualquier banda desconocida en 'media'; el SPA repite el mismo fallback; y un fallo de red se pinta como "Sin alertas disparadas en el período"). El resultado es que las dos pestañas de la misma pantalla se contradicen: "Reglas" jura que ninguna regla se ha disparado nunca y que todas son de prioridad media, mientras "Historial" muestra 11 activaciones con 5 ALTA. A eso se suman dos gráficas que no sostienen su escala (un ranking cuyo 3 se ve más largo que un 5 de la tarjeta vecina, y un "Activaciones por día" que no es un eje temporal y que en la captura sale como una caja vacía de 110px bajo el rótulo "11 eventos en el período"), un interruptor Activa/Inactiva que no persiste nada, un badge rojo permanente en el rail que cuenta reglas activas y no alertas sin atender, y dos formularios de configuración embebidos por iframe que son literalmente otro producto (tema AntD claro "Mar Caribe", primario turquesa, fuentes del sistema) y que además editan s…

- La pantalla nunca dice "no sé": cada capa (eco-data, /api/alerts/history, el componente) tiene un valor por defecto que sustituye el hueco — 'media', 0, '—', []. Un dato ausente y un dato real son indistinguibles para el lector.
- Dos fuentes para el mismo hecho sin reconciliación: reglas desde eco-data vs activaciones desde /api/alerts/history; 24h fijo vs período seleccionado; ventana rolante de la API vs la promesa "DATOS AL CIERRE DE AYER" del encabezado; agencia del shell vs agencia del iframe.
- Las "barras" son un lenguaje visual sin contrato de escala: mismo alto, mismo color, mismo aspecto, pero un riel de 660px normalizado al total junto a otro de 90px normalizado al máximo.
- La configuración no está portada al sistema de diseño, está embebida: dos iframes de 1100–1200px con tema AntD claro, primario turquesa y su propio selector de agencia. El iframe es además una frontera de estado que nadie sincroniza.
- La jerarquía sirve a la configuración, no al triage: 4 KPIs de conteo de reglas y 2 tarjetas derivadas ocupan todo lo visible; la alerta más grave del período está a ~1080px de scroll y no tiene una sola acción.
- No existe modelo de ciclo de vida de la alerta (atendida / descartada / escalada). Sin ese modelo el badge del rail, los KPIs y el historial no pueden significar nada operativo, y de hecho no lo significan.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| · AL-01 | La pestaña Reglas inventa prioridad, activaciones y último disparo en la API — y contradice a Historial en la misma pantalla | `apps/web/src/app/api/eco-data/route.ts:1036-1044 (consumido en apps/web/publi…` | Devolver los campos reales: `priority` desde `alert_rules` (o eliminar la columna si el concepto no existe en el modelo), y `triggered`/`lastFired` c… |
| · AL-02 | El interruptor Activa/Inactiva de cada regla no persiste nada | `apps/web/public/eco-prototype/screens.js:3085-3090 y 3151-3158` | O se cablea (PATCH /api/alerts/:id con estado optimista + rollback + toast de error) o se deshabilita visiblemente (switch en `disabled`, tooltip "so… |
| · AL-03 | El badge rojo "4" del rail cuenta reglas activas, no alertas sin atender, y nunca baja | `apps/web/public/eco-prototype/shell.js:86, 95 y 168-175` | El badge debe contar activaciones sin atender en la ventana relevante (requiere AL-22, un estado `acknowledged` en alert_history). Interinamente: bad… |
| · AL-04 | Un fallo de red se muestra como "Sin alertas disparadas en el período" | `apps/web/public/eco-prototype/screens.js:3340-3349 y 3097-3101` | Tres estados distintos y distinguibles: cargando (skeleton con la forma de las tarjetas), vacío verificado ("0 activaciones entre el 21 y el 27 de ju… |
| · AL-05 | La severidad se inventa: CRISIS y ALERTA colapsan en "alta", NORMAL se muestra como alerta "baja", y lo desconocido se marca "med… | `apps/web/src/app/api/alerts/history/route.ts:16-22 y 79; apps/web/public/eco-…` | Cuatro niveles con token propio (`crisis` / `alerta` / `elevado` / `normal`), mostrar la banda cruda en la fila y el `crisisScore` junto a ella; para… |
| · AL-06 | Dos tarjetas de barras idénticas con denominadores y rieles distintos: un 3 se ve más largo que un 5 | `apps/web/public/eco-prototype/screens.js:3378 (Mezcla de severidad) vs 3391-3…` | Un solo patrón `BarRow` con dos props explícitas: `denominator: 'total' \| 'max'` y una etiqueta que lo diga ("% del total" / "vs. la más activa"), mi… |
| · AL-07 | "Activaciones por día" no es un eje temporal, y en la captura es una caja vacía de 110px bajo el rótulo "11 eventos en el período" | `apps/web/public/eco-prototype/screens.js:3358 y 3403-3412` | Generar la serie de días completa del período (incluyendo ceros) con el mismo helper que usa el resto del producto; añadir eje Y con 2-3 marcas y el… |
| · AL-08 | El umbral de crisis se presenta de tres formas distintas en la misma pantalla (40% / 0.40 / "Umbral 0.40") y el editor no valida… | `apps/web/public/eco-prototype/screens.js:2906 vs 3211 y 3307-3310; nombre de…` | Una sola representación por métrica en todo el producto (recomendado: 0–100 con sufijo visible, convirtiendo en la frontera de la API). En el editor:… |
| · AL-09 | Las dos pestañas de configuración son otro producto: tema AntD claro "Mar Caribe" dentro del shell mando dark | `apps/web/src/theme/eco-theme.ts:5-37; iframes en apps/web/public/eco-prototyp…` | Dos caminos, en este orden de preferencia: (a) portar los dos formularios a componentes de la SPA (son ~10 campos cada uno) y borrar los iframes; (b)… |
| · AL-10 | El formulario embebido edita siempre la configuración de DDEC, aunque el shell esté en otra agencia — y los KPIs de arriba muestr… | `apps/web/src/app/settings/alerts/page.tsx:55 y 67 (idem reports/page.tsx:100…` | Pasar la agencia en el src (`/settings/alerts?embed=1&agency=${ag}`), leerla en la página y no re-forzar ddecpr cuando llega la lista; ocultar la Car… |
| · AL-11 | El editor descarta correos inválidos en silencio y confirma "Regla creada." | `apps/web/public/eco-prototype/screens.js:3235 y 3183` | Validar al perder foco: pintar los correos aceptados como chips y los rechazados en `--neg` con el motivo; bloquear el guardado si hay entradas no re… |
| · AL-12 | Después de crear una regla, la lista a la que te lleva no la contiene | `apps/web/public/eco-prototype/screens.js:3183 y 3146 (con `const D = window.E…` | Que la pestaña Reglas tenga su propio fetch a /api/alerts (como Historial) e invalidarlo tras el POST; o insertar optimistamente la regla devuelta po… |

### Configuración / Usuarios y roles

Esta es la pantalla con más autoridad del producto —decide quién ve qué de una agencia de gobierno— y es la que menos se toma en serio a sí misma. El diagnóstico de fondo no es cosmético: la pantalla **afirma cosas que el sistema no sabe** (un log de actividad con IPs inventadas idéntico para todo usuario, un estado "Invitado" que en realidad significa "nunca inició sesión", un contador de "1 invitación pendiente" que nadie rastrea) y **confirma acciones que no verificó** (ninguna mutación revisa `res.ok`, así que el toast "Usuario guardado" sale igual con 500 que con 201; y `GET /api/users` convierte un fallo de DB en `{users:[]}` con HTTP 200, que la tabla pinta como "Sin resultados · ajusta los filtros"). El defecto más caro es de una línea: el drawer de invitación arranca con `role:'analista'`, clave que no existe en `ROLES`, así que no se marca ningún radio y tanto el cliente como la API coercen a `viewer` — quien invita creyendo dar "Analista" crea un "Solo lectura". En lo visual, el presupuesto de jerarquía y de color está invertido: 201 px de documentación estática de roles se interponen entre el filtro y la tabla que filtra, el primer usuario aparece a 620 px de 900 en escritorio y a 1155 px en móvil, el único dato coloreado es `Estado` (el menos consecuente) mientras `Rol` —el campo que otorga poder— es monocromo, y las dos filas que requieren acción (Invitado, Suspe…

- Pintado 100% con objetos de estilo inline: la pantalla queda FUERA de todas las correcciones del sistema de diseño (tokens.css, `.input{min-height:40px}` + `:focus`, `.pill`, `.btn`). Cada arreglo global hay que rehacerlo a mano aquí, y nadie lo hace.
- No existen estados de red: `loading` y `error` se declaran en UsersAdmin y nunca se pintan, y la API enmascara fallos como éxito vacío. El resultado es que 'no pude leer' y 'no hay nada' son visualmente el mismo mensaje.
- Ninguna mutación verifica `res.ok`: el toast de éxito es incondicional. En la pantalla que reparte permisos, el usuario no puede distinguir guardado de fallo.
- La pantalla inventa o infiere estados que el modelo no tiene (`invitado` = nunca inició sesión; log de actividad hardcodeado) y ofrece controles para esos estados fantasma.
- Presupuesto invertido de espacio y color: documentación estática arriba y con más peso que el dato; color saturado en el campo administrativo (Estado) y monocromo en el campo que otorga poder (Rol).
- La rejilla de la tabla da ancho FIJO a enums cortos (110 px a 'Editor') y ancho elástico a cadenas ilimitadas (nombre+correo), de modo que el identificador se trunca desde 1280 px y el estado desaparece por completo en móvil.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| · SET-01 | El fallo de la API se pinta como "no hay usuarios · ajusta los filtros" | `apps/web/src/app/api/users/route.ts:74-77 + apps/web/public/eco-prototype/scr…` | Tres cambios acoplados: (1) en la ruta, devolver 500 con `{error}` en vez de `{users:[]}` — el enmascaramiento es el origen; (2) en UsersAdmin, pinta… |
| · SET-02 | Invitar sin tocar el rol crea un "Solo lectura" aunque el formulario diga Analista | `apps/web/public/eco-prototype/screens.js:3696 (default `role:'analista'`), 35…` | Cambiar el default a `role: 'analyst'` (clave válida) y, sobre todo, cerrar la clase de bug: (a) que el botón primario esté deshabilitado mientras `!… |
| · SET-03 | «Usuario guardado» se muestra también cuando la API rechazó el cambio | `apps/web/public/eco-prototype/screens.js:3624-3663 (saveUser), 3665-3681 (del…` | En ambas funciones: `const r = await fetch(...); if (!r.ok) { const j = await r.json().catch(()=>({})); throw new Error(j.error \|\| ('HTTP '+r.status)… |
| · SET-04 | «Actividad reciente» es un registro inventado, idéntico para todos los usuarios, con IPs falsas | `apps/web/public/eco-prototype/screens.js:3952-3970` | Quitar el bloque hoy mismo. Si hay que dejar el hueco, poner un estado honesto («El historial por usuario no está disponible todavía») o, mejor, sust… |
| · SET-05 | «Invitado» y «1 invitación pendiente» describen un estado que el sistema no rastrea; la invitación pudo no haberse enviado nunca | `apps/web/public/eco-prototype/screens.js:3592, 3693, 3617-3622, 3848-3854, 36…` | Modelar el estado en vez de inferirlo: columna `invited_at` / `invite_sent` (y registrar si `provisionCognitoUser` devolvió `null`) y derivar cuatro… |

### Búsqueda global

Rutas relativas a /Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit. /search es la pantalla más simple del producto y la que más engaña: promete «todas las menciones» tres veces (eyebrow, placeholder, título del estado vacío) mientras el fetch envía window.ecoGetPeriodParams() y el API descarta duplicados y toda la pertinencia «baja», de modo que un funcionario que busca un término y ve «No se encontraron menciones» concluye que el tema no existe cuando solo no existe en los últimos 7 días. Encima, la búsqueda no imprime nunca sus criterios: si el usuario entra por un chip de «Tópicos frecuentes», el encabezado dice solo «Resultados» y el tópico aplicado vive escondido en un «·1» dentro de un popover cerrado — una cifra screenshoteable sin su contexto. Como pantalla es Menciones con otra piel: comparten fetch, facetas, tres vistas, paginación y estados, pero divergen en doce detalles pequeños (dónde vive «Ordenar», si los chips llevan conteo, el copy de error, si la paginación se guarda contra error), que es exactamente la clase de divergencia que erosiona la confianza; mi recomendación es fusionarla como el estado «con query» de Menciones y dejar /search como alias. El cromo global la asfixia: en escritorio 138px de cabecera (con una fila entera para un solo botón de tema) y en móvil ~340px — el 40% de la pantalla — antes del único control que la pantalla nece…

- La búsqueda promete un universo («todas las menciones») que el backend acota por período, duplicados y pertinencia — y presenta cada resultado sin declarar sus criterios; la ventana temporal vive en el header, a 600px del número que condiciona.
- Tres buscadores con tres alcances, tres tamaños (12px header / 16px hero / 16px palette) y tres placeholders distintos; ninguno dice qué busca ni sincroniza su estado con los otros.
- Search es Menciones duplicada: los mismos componentes con doce divergencias menores, cada una un lugar donde el producto se contradice a sí mismo.
- El accent hace de marca, de «activo» y —en el build auditado— de «negativo»; la marca de coincidencia de búsqueda (<mark>) hereda ese mismo color, así que un acierto se lee como una alarma.
- El cromo global no cabe en una pantalla cuya única razón de ser es un campo de texto: cabecera de 138px en escritorio (una fila entera para el botón de tema) y ~340px en móvil.
- Ya existe una capa de tokens sembrada (tokens.css: escala de 12 pasos, --text-3 a 5.00:1, --neg separado de --accent) que esta pantalla no consume: sigue en px y colores inline.

| P0 | Qué | Dónde | Arreglo |
|---|---|---|---|
| · S-01 | «Todas las menciones» es falso: la búsqueda está acotada al período del header (7D por defecto) y no lo dice en ninguna parte | `apps/web/public/eco-prototype/screens.js:1330 (params con window.ecoGetPeriod…` | 1) Cambiar el copy a lo que realmente hace: eyebrow «Resultados en el período seleccionado», placeholder «Buscar menciones — palabras clave, autor, U… |
| · S-02 | El API descarta silenciosamente la pertinencia «baja» y los duplicados, bajo la promesa de «todas» | `apps/web/src/app/api/eco-mentions/route.ts:190-198 (excluye nlp_pertinence='b…` | Declarar la exclusión y hacerla reversible: en el pie de resultados, «N menciones · se excluyeron M de baja pertinencia y K duplicados» con un enlace… |
| · S-03 | Los resultados no muestran los criterios que los produjeron: un chip de tópico filtra la lista sin dejar rastro visible | `apps/web/public/eco-prototype/screens.js:1407 (chip → setFilters({topic})) ·…` | Barra de criterios activos siempre visible sobre los resultados: pills removibles (× ) para query, tópico, región, fuente, sentimiento y período, más… |
| · S-04 | Cinco comandos del ⌘K prometen filtrar Menciones y no filtran nada: mentionsFilter no lo consume ningún componente | `apps/web/public/eco-prototype/shell.js:604-608 · app.js:406 (setMentionsFilte…` | Aceptar el filtro en el destino: `MentionsScreen({ onMentionClick, mentionsFilter, setMentionsFilter })` que haga merge en su estado `filters` al mon… |
| · S-05 | La query se mutila en silencio: tokens de 1 carácter se descartan y no hay unaccent, pero el encabezado repite la frase completa… | `apps/web/src/app/api/eco-mentions/route.ts:227-236 (filter t.length>=2 + ILIK…` | 1) Backend: `CREATE EXTENSION unaccent` y comparar `unaccent(title) ILIKE unaccent($1)` (índice GIN trigram sobre la expresión); es la corrección de… |

---

## 7 · Gráficas

Dos especificaciones completas en [`auditoria-diseno-2026-07-graficas.md`](auditoria-diseno-2026-07-graficas.md): la **doctrina** de codificación visual y el **rediseño** de `charts.js`.

### Doctrina de codificación visual de datos de ECO

ECO no tiene una doctrina de gráficas: tiene nueve primitivas con nueve APIs distintas (unas reciben `accessor`, otras `keys`, otras `series`, otras `items`+`labelKey`), dos de ellas muertas (`RadialGauge`, `linePath`: cero sitios de llamada), tres implementaciones distintas de suavizado (`catmullRomPath` en charts.js:20, `smoothLinePath` en :52, `smoothPath` en screens.js:4644) y ningún contrato común de eje, nulos, leyenda, estado vacío ni accesibilidad. La consecuencia no es estética: de los 34 sitios de llamada que inventarié, **11 codifican mal la magnitud** — es decir, el canal visual más fuerte (posición, longitud, área) no representa la cifra que el lector cree estar leyendo. El caso más grave está en la primera pantalla que abre el cliente: `OverviewTendencia` (screens.js:4344) normaliza cada serie a su propio min/max, así que con los datos actuales de DDEC el 27 de julio dibuja *positivo* (38 menciones) un 40% más arriba que *negativo* (38 menciones) — el mismo número, cuarenta puntos de altura de diferencia — y una variación real de 3 menciones (35→38) ocupa el 40% del alto del gráfico. El conflicto con el gusto del usuario ("me gustaban las líneas suavizadas") es real pero es resoluble sin mentir: el suavizado es una decisión de *render* (legítima si la curva pasa por cada punto y los puntos están marcados, como ya ocurre), mientras la escala es una decisión de *verdad*; lo que hay que separar no es la curva del dato, es una serie de otra. Recomiendo small multiples con dominio Y compartido y eje rotulado (`SeriesPanels`, tres paneles de 64px, ~214px totales contra los 240px de hoy), que elimina el cruce, conserva las curvas suaves y los rellenos, y cabe mejor en 390px que el gráfico actual. Segundo hallazgo transversal: no existe distinción entre **hueco de datos y cero real** — `screens.js:463` hace `t.polarizationIndex ?? 0` y el sparkline de Polarización del Scorecard muestra dos caídas a pico hasta el suelo que el lector lee como "la polarización se desplomó" cuando el dato simplemente no existe (4 de 30 puntos son `null` en el payload); con el incidente de ingesta de julio (tres días sin ingestar para SGPR y Gobernadora) esto significa que una falla de pipeline se pinta como silencio ciudadano. Tercero: el color de dato y el color de veredicto comparten hex; en `/dashboard`, "Noticias" es verde (`--pos`) a 300px de barras donde verde significa "positivo", y "Foros" cae al fallback `var(--accent)` que es idéntico al de "X / Twitter": dos barras del mismo color para dos plataformas distintas. Cuarto: cero de los nueve SVG de `charts.js` tiene `<title>`, `role`, `aria-*` o foco por teclado — para un lector de pantalla ninguna gráfica de ECO existe, y para un usuario que no usa ratón el tooltip (única superficie con las cifras exactas del día) es inalcanzable. La especificación entrega: inventario con veredicto por sitio de llamada, el diseño completo de la solución a F2 con las tres alternativas evaluadas y el código de la primitiva nueva, la tabla de reglas duras pregunta→permitida→prohibida, la doctrina de eje y escala (incluido el contrato de huecos con el SQL real sobre `mentions.ingested_at`), la doctrina de color enganchada a los tokens `--cat-*`/`--seq-*`/`--crisis-*` que ya especificó la unidad de fundaciones, y el contrato mínimo de accesibilidad de gráficas. Sin librerías nuevas: la restricción de arquitectura (JSX plano, sin bundler) no es el obstáculo — el andamiaje que falta son ~250 líneas compartidas, menos que el adaptador que exigiría cualquier librería de charts con tokens CSS y tabla accesible.

**Decisiones**

- **Ninguna librería de gráficas nueva: el andamiaje (dominio, eje, nulos, leyenda, vacío, a11y) se escribe a mano en charts.js, ~250 líneas compartidas** — Los candidatos serios (Chart.js, ECharts, uPlot) renderizan a canvas, así que el contrato de accesibilidad de §6 (title/desc, tabla equivalente, foco por punto) habría que construirlo igual por fuera; y ninguno lee custom properties, así que cada color de serie exige un puente getComputedStyle que se re-ejecute al cambiar de modo. Lo que aportarían (escalas y generadores de path) son ~60 de las 25
- **F2 se resuelve con small multiples de dominio Y compartido (nueva primitiva SeriesPanels), no con escala compartida en un solo panel** — Con dominio compartido en un panel las tres curvas siguen superponiéndose: en la captura móvil actual la naranja y la verde ya son indistinguibles en el pico y la gris queda tapada por el relleno de la primera serie. Separadas en tres franjas de 64px el cruce es estructuralmente imposible, cada serie tiene su propia línea base, la comparación entre paneles sigue válida porque comparten escala impr
- **El suavizado Catmull-Rom se conserva; lo que se elimina es la normalización por serie** — Son dos decisiones distintas que el código mezcló. Suavizar es una decisión de render, defendible mientras la curva pase por cada punto (charts.js:20-36 lo hace, sin overshoot) y los puntos estén marcados (charts.js:349-361 los marca). Escalar cada serie a su propio min/max es una decisión de verdad, y con los datos vigentes dibuja positivo (38) cuarenta puntos de altura por encima de negativo (38
- **Doble eje Y prohibido sin excepciones; si el usuario mezcla unidades, el componente conmuta a small multiples** — El punto de cruce de dos series con ejes independientes se mueve a voluntad cambiando cualquiera de los dos dominios: la afirmación visual más fuerte del gráfico sería un artefacto del diseñador. Consecuencia inmediata en screens.js:508, donde los chips permiten activar 3 de 6 series de unidades incompatibles (conteo, 0-1, 0-100, %, -100..100): hoy eso es doble eje encubierto con seis ejes invisib
- **Los nulos nunca se coercen a cero: contrato number|null + campo coverage derivado de mentions.ingested_at** — Hay tres mecanismos que hoy borran la diferencia: `?? 0` en screens.js:463, `|| 0` en charts.js:213/218, y el pre-relleno de la ventana con ceros en sentiment-report.ts:181-185 (cuyo propio comentario dice que es 'para que el chart renderice bien sin gaps'). Con el incidente de ingesta de julio (SGPR y Gobernadora, tres días en crash-loop) el gráfico habría afirmado que el ciudadano dejó de hablar
- **Categórico y semántico son espacios de color disjuntos; --accent queda prohibido como fallback en áreas de datos** — Confirmado por píxel en /dashboard: 'Noticias' es var(--pos) verde a 300px de barras donde el verde significa 'positivo', 'Blogs' es var(--warn) ámbar (precaución) y 'Foros' cae al fallback var(--accent), que es el mismo naranja que 'X / Twitter' — dos plataformas, un color. Los tokens --cat-1..5 + --cat-other ya están especificados con ΔE medido en fundaciones §3.2.
- **Los rótulos de las escalas de banda se posicionan en su umbral con left:%, no con justify-content:space-between** — Medido en overview-mobile.png: el marcador de crisis cae en 41.1% del ancho de la barra y el rótulo ALERTA está centrado en 65.5%, cuando ALERTA empieza en 40%. El titular dice 'Alerta' y el gráfico parece decir 'apenas pasó Elevado'. El mismo defecto en BrandHealthMini (rótulos en 0/25/50/75/100 contra fronteras en 40/60/80) y en Polarización, que además usa 3 zonas en la card (screens.js:467) y 
- **Borrar RadialGauge y linePath en vez de arreglarlos; unificar los tres suavizados en catmullRomPath** — Verificado con grep -o: RadialGauge tiene 0 sitios de llamada (el max=3 de F15 es un defecto en código muerto) y linePath tiene 0. Y hay tres implementaciones de suavizado activas — catmullRomPath (charts.js:20), smoothLinePath (charts.js:52, único consumidor Sparkline) y smoothPath (screens.js:4644, misma matemática con tensión 1/6) — así que la misma serie se dibuja distinta en tres pantallas.

### Rediseño de `charts.js` — nueva API unificada de primitivas de gráfica de la SPA

`charts.js` (878 líneas, worktree `design-audit`) no es una librería: son nueve componentes escritos en momentos distintos, cada uno con su propio contrato de props, su propio dialecto de estado vacío, su propio formateador y cero accesibilidad. El problema de fondo no es cosmético: la primitiva más usada (`MultiLineChart`) escala cada serie a su propio min/max sin dibujar eje Y, así que en `/overview` tres líneas cuyos valores reales son 43 / 54 / 36 se cruzan y la de 54 se pinta por DEBAJO de la de 36 — el lector concluye lo contrario del dato. Encima, el suavizado Catmull-Rom con `tension=1` (el default, y el comentario del código tiene la polaridad invertida) dibuja valores que no existen: en una serie con un pico aislado tipo `[8,10,9,240,11,9,10]` la curva baja hasta −7.7 menciones. Y no hay contrato de nulos: `null` hace que `Math.min` lo coaccione a 0 y mueva el dominio entero en silencio; `undefined` produce `M 0,NaN` (path invisible, sin error); `fmtVal(key, null)` hace `null.toFixed(1)` → TypeError que tumba la pantalla; y el call site de Polarización parchea con `?? 0` (screens.js:463), convirtiendo "no medido" en "polarización 0% = apática". La solución no es parchear 12 líneas: es partir el archivo en un núcleo (`charts-core.js`: escalas, canon de nulos, registro de métricas servido por la API, ticks, tooltip, estados, a11y) y reescribir las nueve primitivas contra un contrato único de props. Los sitios de llamada son solo 11 (no ~40 — los conté: 10 en screens.js, 1 en shell.js), más 15 mini-gráficas ad-hoc dentro de screens.js/shell.js que deben absorberse como primitivas; con 11 llamadas y un solo bundle `dist/` no hay razón para un adaptador de compatibilidad permanente: se migran todas en un PR, y el shim de 30 líneas solo existe para que el PR sea bisectable. Todo se escribe a mano en SVG sin dependencias nuevas salvo el placer de la nube de palabras (150 líneas propias, justificado); Leaflet se queda como está.

**Decisiones**

- **Eliminar el modo de escala por-serie de LineChart y sustituirlo por `scale.mode` explícito ('shared' | 'fixed' | 'index'), redirigiendo 'per-series' a SmallMultiples** — La rama por defecto de charts.js:220-227 escala cada serie a su propio min/max y charts.js:293-302 sólo dibuja números en el eje Y cuando hay sharedScale o yDomain. En /overview eso hace que la línea de 54 se pinte por debajo de la de 36 (evidencia: scratchpad/z-chart-desktop.png). Ningún par de ejes puede representar dos escalas honestamente. El gusto del usuario era por la CURVA (screens.js:4339
- **Reemplazar Catmull-Rom (tension=1) por interpolación monótona Fritsch-Carlson** — Medido: con tension=1 (el default de charts.js:20, invocado sin argumento en :327 y :337) un segmento entre dos mínimos iguales overshoot 12.5% del salto, y la serie [8,10,9,240,11,9,10] — patrón típico de día de crisis — se dibuja bajando hasta −7.7 menciones. Los comentarios de charts.js:8 ('sin overshoot') y :12 ('1.0 = más recto; 0 = más curvo') son ambos falsos: t=0 da la cuerda recta. Fritsc
- **El registro de métricas (dominio, decimales, sufijo, bandas) lo emite /api/eco-data como METRIC_SPECS derivado de @eco/shared/format; charts.js pierde fmtVal** — fmtVal (charts.js:243-252) es un switch sobre seis claves de negocio dentro de una primitiva de dibujo, y su propio comentario (:238-241) lo declara 'ESPEJO … Mantener en sync'. Ya se desincronizó: fmtVal devuelve '6.2' para BHI mientras formatMetric devuelve '6.2 / 10'. Los umbrales están copiados en cuatro sitios con drift real (Polarización 30/60 en screens.js:467 vs el canon 30/50/75 en metric
- **Migrar los 11 sitios de llamada en un solo PR; el adaptador de compatibilidad es un andamio de 30 líneas que se borra antes del merge** — Conté 11 sitios de llamada JSX (10 en screens.js, 1 en shell.js), no ~40. El despliegue es un único bundle dist/ con cache-bust manual (index.html:1416): no existe rollout parcial, así que un shim no reduce riesgo. Y lo que sí haría es congelar la semántica defectuosa (escala por-serie por defecto, suavizado forzado, ?? 0), que es exactamente lo que se quiere retirar. El shim propuesto deliberadam
- **RadialGauge se borra; su lugar lo toma BulletChart, que además absorbe las cinco barras de banda ad-hoc** — RadialGauge tiene cero sitios de llamada, un max=3 que no corresponde a ninguna escala del producto (0-1, 1-10, 0-100, -100..100) y una prop colorStops que nunca se lee. Mientras tanto hay CINCO implementaciones ad-hoc de 'valor contra bandas' (screens.js:443-450, 466-473, 611-646, 4295-4300, shell.js:1676-1685) y las cinco desalinean las etiquetas: con space-between los rótulos caen en 0/33/67/10
- **La nube de palabras se envía junto con TermsChart (barras), y el placer de la nube se escribe a mano (~150 líneas) en vez de traer d3-cloud** — El usuario pidió explícitamente 'nubes de palabras, algo bien dinámico y bien hecho'. Pero una nube codifica magnitud en área de glifo, que se lee mal, y el corpus (español de PR, titulares + comentarios, con los nombres de agencia y 'Puerto Rico' como ruido garantizado) haría una nube de stopwords de dominio. TermsChart es la vista de análisis y la nube la de presentación. Sobre la librería: d3-c
- **Con 365 puntos NO se hace downsample; el arreglo de rendimiento es presupuesto de nodos + separación StaticLayer/HoverLayer memoizadas. LTTB sólo entra cuando n > 2·innerW** — Conté ~1.510 elementos SVG con n=365 y 3 series, de los cuales 1.095 son circles por día por serie y 365 son tick marks (charts.js:349-361 y 445-447); charts.js no tiene ni un useMemo, así que cada mousemove reconstruye los cuatro paths (~1.460 segmentos de bezier) y recrea los 1.510 elementos: ~90.000 comparaciones de elemento por segundo. A innerW=975 cada punto ocupa 2.7px, así que el path no e
- **El tooltip sale del SVG y pasa a un portal HTML con clamp contra el rect del card; toda la interacción migra de Mouse Events a Pointer Events con el patrón tap-to-reveal / tap-to-commit** — Hoy el tooltip está duplicado literalmente en charts.js:388-404 y :547-568 (mismo tooltipW=180, mismo tooltipH=22+n*18), con clamp sólo horizontal y sólo contra innerW, tooltipY=0 fijo (tapa las gridlines superiores) y sin pointerEvents='none' en MultiLineChart, lo que produce parpadeo. Al vivir dentro del SVG no puede desbordar el card, así que en cards de 1/3 de ancho se apila sobre los datos. Y

**28 workstreams de gráficas**

| id | fase | tam | Qué |
|---|---|---|---|
| `WS-G1` | P0 | M | Núcleo de escala + contrato de nulos en charts.js |
| `WS-G2` | P0 | L | SeriesPanels (small multiples) + reemplazo de OverviewTendencia |
| `WS-G3` | P0 | L | Eje obligatorio y cero obligatorio en MultiLineChart |
| `WS-G4` | P0 | M | Un solo contrato de delta en la tira-leyenda del chart |
| `WS-G5` | P0 | M | Sparkline responsive, sin fill en series con signo, con huecos |
| `WS-G6` | P1 | L | BandScale: una primitiva para crisis, BHI, polarización y NSS con rótulos en el umbral |
| `WS-G7` | P1 | L | Color de dato: --cat-* para categorías, --seq-* para magnitud, leyendas generadas del mismo colorFn |
| `WS-G8` | P1 | XL | Contrato de accesibilidad de gráficas (ChartFigure + ChartDataTable + teclado) |
| `WS-G9` | P1 | M | StackedAreaChart: contestar la pregunta correcta (mezcla vs volumen) |
| `WS-G10` | P1 | M | PRMap: área proporcional, leyenda de tamaño y puente de tokens |
| `WS-G11` | P1 | M | Retirar los tres histogramas sintéticos del drill-down |
| `WS-G12` | P1 | M | Área real en la vista de tópicos (o renombrar la vista) |
| `WS-G13` | P2 | S | Alertas: eje temporal completo en 'Activaciones por día' |
| `WS-G14` | P2 | M | Limpieza: un solo suavizado, un solo estado vacío, ids de SVG por instancia |
| `WS-G1` | P0 | L | charts-core.js: canon de nulos, escalas, ticks, LTTB, paths + registro en el pipeline |
| `WS-G2` | P0 | S | METRIC_SPECS en /api/eco-data + window.ECO_METRICS en el núcleo |
| `WS-G3` | P0 | M | ChartFrame + los 5 estados canónicos + tabla oculta a11y |
| `WS-G4` | P0 | M | ChartTooltip en portal HTML + Pointer Events + teclado + crosshair compartido |
| `WS-G5` | P0 | L | LineChart — fusiona MultiLineChart y AreaLineChart; arregla F1, F2, F3, F4, C-06, C-15, C-20 |
| `WS-G6` | P0 | S | Legend como primitiva + arreglo estructural de F6 |
| `WS-G7` | P1 | M | BulletChart + retiro de las 5 barras de banda ad-hoc |
| `WS-G8` | P1 | M | Sparkline, BarList, SplitBar, Donut sobre el contrato nuevo |
| `WS-G9` | P1 | M | AreaStackChart con modos zero/center/expand — absorbe StackedAreaChart y el streamgraph |
| `WS-G10` | P1 | M | MatrixHeatmap + CalendarHeatmap |
| `WS-G11` | P1 | S | GeoMap: tokens en el tooltip de Leaflet y contrato series+scale |
| `WS-G12` | P1 | L | Migrar los 11 sitios de llamada + borrar el andamio legacy |
| `WS-G13` | P1 | M | SmallMultiples + SlopeChart |
| `WS-G14` | P2 | L | TermsChart + WordCloud (nubes de palabras) — bloqueadas por /api/eco-terms |

---

## 8 · Menciones: nube de palabras y funciones nuevas

Tres especificaciones completas en [`auditoria-diseno-2026-07-menciones.md`](auditoria-diseno-2026-07-menciones.md): el rediseño de la pantalla, el backend de la nube de palabras y su render.

### Menciones

Menciones no es una pantalla mal maquetada: es un explorador de consultas disfrazado de tabla de metadatos. La consulta del usuario está repartida en cinco superficies que no se hablan (header con período, dos buscadores, chips, popover, ⌘K), el resultado no lleva su propio resumen (los 5 KPI vienen de otro endpoint y no reaccionan a ningún filtro: screens.js:948-963 vs 818-847) y la fila entrega los campos que menos sirven mientras el API ya manda `summary` (100% poblado en DDEC), `image` (61.7%) y esconde `impact`/`potentialAudience` (83.6%/81.5%). Medí el caso que lo resume todo: el 21 de julio DDEC tuvo 26 menciones visibles, 22 negativas — y **15 de esas 26 filas son la MISMA nota de cable de AP** replicada en 14 medios (16 filas, 12 `text_hash` distintos porque el hash incluye el snippet y cada medio pone su propio lede; engagement 0 en todas, audiencia potencial 21.3M). El feed convirtió un hecho en quince, y el 68% de la negatividad de ese día es una sola nota. A escala: 27.8% de las menciones de DDEC en 30 días tienen un casi-gemelo a distancia coseno <0.10 y el 100% tiene embedding, o sea que la materia prima para arreglarlo ya está en la tabla. La decisión de fondo: convertir /mentions en una **consulta de primera clase** — un solo campo de búsqueda, filtros con una gramática, un resumen que se recalcula con el mismo WHERE que la lista, una fila que agrupa historias en vez de repetirlas, y la consulta guardable, exportable, permalinkeable y convertible en alerta. /search deja de existir como pantalla (es /mentions con `q`) y los tres modos de vista bajan a dos. Todo cabe en el contrato actual de `/api/eco-mentions` más un parámetro `facets=` y una columna `story_id`.

**Decisiones**

- **/search se elimina como pantalla: es el estado «con q» de /mentions** — Comparten fetch (screens.js:1339 vs 838), facetas, tres vistas, paginación y estados; divergen en doce detalles cosméticos. MentionsScreen ya recibe searchQuery/setSearchQuery/mentionsFilter/setActive (app.js:389-396): sólo hay que consumirlos. Borra ~240 líneas (screens.js:1265-1507) y elimina el segundo buscador (MEN-16).
- **Los tres modos de vista bajan a dos: Compacta y Lectura, con persistencia por breakpoint** — Lista y Tabla comparten propósito y defectos (una línea, titular con nowrap+ellipsis, screens.js:1144 y 1219); Tabla sólo añade cuatro columnas y usa overflow:auto en vez de .scroll-x. Dos necesidades reales: escanear y leer. Guardar la preferencia por breakpoint (eco.viewMode.mobile default reading) evita entregar en móvil la vista que allí no funciona.
- **La banda de métricas se queda, baja a 4 cifras y sólo admite cantidades aditivas sobre el subconjunto** — Total, Interacciones, Audiencia potencial y Virales se calculan con un solo agregado sobre el mismo whereClause que la lista, así que reaccionan a los filtros y no pueden contradecir el total (cierra MEN-01 y MEN-02). Rejilla 4/2/2 limpia (MEN-22).
- **Engagement rate y Velocidad salen de la banda y bajan a una línea de contexto rotulada «Período completo, sin filtros»** — Velocidad es literalmente el delta de Total (eco-data/route.ts:366-369), o sea dos tarjetas para un hecho en dos idiomas (MEN-10), y su color sólo codifica la subida (MEN-09). Engagement rate no se puede recalcular por subconjunto con paridad de fórmula.
- **La nube de palabras va como pestaña del panel «Resumen del resultado» (Zona B), alimentada por el subconjunto filtrado, y su clic añade el término a q** — Es un resumen del resultado, no una pantalla: puesta al final de 7,000px de página nadie la ve, y calculada sobre el período completo contradiría la lista igual que hoy la contradicen los KPI. Como pestaña comparte el fetch y el WHERE.
- **Agrupar casi-idénticas con story_id persistido (coseno <0.10, ventana ±72h), con una etapa interim que agrupa por text_hash + coseno dentro de la página** — Medido en producción: el 21-jul DDEC tuvo 26 menciones visibles y 15 de ellas son la misma nota de AP en 14 medios (16 filas, 12 text_hash distintos porque el hash incluye el snippet). 27.8% de las menciones de DDEC tienen un casi-gemelo a <0.10 y el 100% tiene embedding. Sin persistir el grupo, la paginación no puede colapsar antes del LIMIT y los conteos son aproximados.
- **Agrupar por text_hash, nunca por duplicate_of_id** — processor/index.ts:177 selecciona el duplicado con LIMIT 1 sin ORDER BY y sin AND is_duplicate=false: el puntero apunta a una fila arbitraria y admite cadenas, así que agrupar por duplicate_of_id fragmenta el grupo. text_hash es determinista y ya está indexado (idx_mentions_text_hash).
- **La miniatura se condiciona a resolved_image_url, nunca a has_image** — Medido en DDEC 30 días: 417 filas tienen resolved_image_url y sólo 66 tienen has_image=true. El flag está desincronizado; usarlo dejaría fuera el 84% de las imágenes disponibles.

### Backend de la nube de palabras de Menciones

La nube de palabras no tiene ninguna base de datos donde apoyarse: no hay columna de términos, no hay índice de texto, y `unaccent`/`pg_trgm` NO están instaladas (solo `plpgsql` y `vector 0.8.0` en PG 16.13, db.t4g.medium, 2 vCPU burstable, `work_mem=4MB`). Medí en prod que extraer términos en caliente es inviable: el pipeline completo (tokenizar + stem + bigramas) tarda 34 s para 2,290 menciones y 12.9 s para 41,445; pero medí también que el 90% de ese costo es PARSEAR el texto, no agregar: con el tsvector ya calculado, el `unnest + GROUP BY` sobre 1.26 M lexemas cuesta menos de 1 s. Eso decide la arquitectura: un índice invertido por mención (`mention_terms.tsv`, 13 MB por año-agencia, cabe inline sin TOAST) mantenido incrementalmente en SQL, y la agregación viva en la request usando EXACTAMENTE el mismo `WHERE` que la lista. Ese último punto no es cosmético: es el único diseño que evita repetir F9 (dos fuentes rivales para el mismo número), así que especifico extraer `buildMentionScope()` de `eco-mentions/route.ts` a un módulo compartido que ambas rutas importan. La frecuencia cruda no sirve: medida en gobernadora 365d, los seis términos más frecuentes son los propios términos del query de Brandwatch (gonzález 36,649 · jenniffer 34,819 · gobernadora 33,803 · colón · puerto · rico) seguidos de basura de plataforma (https, com, www, photos, from, post). Con log-odds ratio y prior de Dirichlet informativo (a0=500) sobre los mismos datos, los 7 días contra los 90 anteriores devuelven en 2.06 s: sequía, emergencia, agua, embalse, Guardia Nacional, orden ejecutiva, Carraízo, severa, lluvia — la noticia real de la semana. Por eso "más distintivo" es el modo por defecto y "más frecuente" el conmutador secundario. El stemmer español de Postgres resuelve acentos y plurales gratis (educación→educ, Loíza→loiz, permisos/permiso→permis) pero colisiona (parte/partido→part, pública/publicación→public, autoridad→autor) e es inconsistente (anuncia→anunci vs anunció→anunc), lo que obliga a definir las stopwords como superficies expandidas por `ts_lexize` más una lista de tallos crudos, y a mantener la lista corta y quirúrgica en vez de agresiva.

**Decisiones**

- **Índice invertido precalculado por mención (mention_terms.tsv) + agregación viva en la request, sin tabla de caché de respuesta** — Medido en prod: el parseo del texto cuesta 4.23 s para 41,445 docs, pero el unnest + GROUP BY sobre los 1,260,629 lexemas resultantes cuesta ~0 s (3.89 s la query completa vs 4.23 s solo el parseo). Precalcular el tsvector convierte la query en <1 s y ocupa 13 MB por año-agencia (~40 MB total sobre 17.5 GB libres), inline sin TOAST (330 bytes/fila).
- **Modo por defecto = 'distinctive' con log-odds ratio y prior de Dirichlet informativo (a0=500), no frecuencia cruda** — Medido en gobernadora 365d, los seis términos más frecuentes son los propios términos del boolean de Brandwatch (gonzález 36,649 · jenniffer 34,819 · gobernadora 33,803 · colón 22,841 · puerto · rico) seguidos de https/com/www/photos/from/post. La misma agencia con log-odds 7D vs 90D previos devuelve en 2.06 s: sequía, emergencia, agua, embalse, Guardia Nacional, orden ejecutiva, Carraízo, severa, lluvia — la noticia
- **No instalar unaccent ni pg_trgm** — Verificado que el stemmer Snowball español de Postgres ya remueve los acentos agudos como último paso: educación→educ, Loíza→loiz, Sequía→sequ, González→gonzalez, y conserva la ñ (niños→niñ, mañana→mañan). Ninguna parte del diseño hace fuzzy match.
- **La métrica base es DF (document frequency), no TF** — Medido: en instagram_public y varias filas de facebook_public el snippet es literalmente idéntico al title, y los snippets de noticias empiezan con '...' repitiendo la frase del título. Con TF cada término de esas menciones cuenta doble. Con DF la duplicación intra-documento es inocua. La prominencia se recupera con los pesos A/B/C/D del tsvector (verificado que sobreviven a || y a unnest).
- **Stopwords declaradas como SUPERFICIES expandidas por ts_lexize en la query, más un array de tallos crudos; lista quirúrgica y no agresiva** — Verificado que el stemmer es inconsistente entre inflexiones (anuncia→anunci pero anunció→anunc; declaró→declar pero declara→decl), así que una lista escrita a mano en tallos deja agujeros — en la corrida de prueba se colaron 'decl' y 'anunc'. Y verificado que colisiona (parte/partido→part, pública/publicación→public, autoridad→autor), así que una lista agresiva mataría 'partido', término legítimo en un dashboard de 
- **Frases mediante diccionario minado en batch (PMI≥3.0 + adhesión≥0.30 + df≥max(5, 0.15%N)) inyectado en el tsvector con peso D; el colapso bigrama/unigrama se resuelve en TS con umbral 0.35 de vida propia** — La expansión de bigramas mide 3.0 ms/doc (34.2 s para 2,290 docs, 6.8 s solo el generate_subscripts de 139,694 pares): imposible en caliente, trivial en batch. Los umbrales, probados sobre 30D de gobernadora, conservan 'francisco domenech', 'itza garcía', 'órdenes ejecutivas', 'director ejecutivo', 'guardia nacional', 'rivera schatz' y descartan 'photos from', 'from jenniffer', 'post photos', 'noticioso puerto'. Como
- **Extraer buildMentionScope() de eco-mentions/route.ts a apps/web/src/lib/mention-scope.ts y que ambas rutas lo importen** — El endpoint de la nube debe aceptar los mismos 19 parámetros que la lista y resolverlos con el MISMO código, no con una copia. F9 está medido en prod (47 vs 54, ≈13%) y su causa es precisamente dos implementaciones del mismo universo. Además scope.total se calcula vivo en la misma request con el mismo whereClause, así que el único número compartido con la lista nunca puede divergir ni por caché.
- **Sentimiento por término = promedio sin ponderar de s∈{-1,0,+1}, con umbral df≥8 y sentCi≤0.50 para que el color sea confiable; por debajo el término se pinta con --text-2 pero NO se oculta** — Con df<8 un solo cambio de clasificación mueve el promedio ≥0.25, más que el ancho de cualquier banda de color útil. El tamaño del término (df o z) sigue siendo válido aunque su color no lo sea, así que ocultarlo perdería información real. Reutiliza literalmente effectiveSentimentSql (eco-mentions/route.ts:77) y pillFromSentiment (45-49) vía el módulo compartido, si no la nube clasificaría negativo lo que la lista mu

### Nube de palabras de Menciones

La nube tipo Wordle es la peor forma conocida de comparar magnitudes: el área no es perceptualmente lineal, la rotación y el empaque azaroso introducen dos variables visuales sin significado, y no admite orden ni comparación entre términos no adyacentes. El cliente la pidió, así que la entrego — pero "bien hecha" solo tiene una definición defendible: un componente `TermsCloud` de **dos vistas hermanas** (Nube y Ranking) que comparten datos, selección y estado, donde la nube gasta sus canales libres en lo que las nubes desperdician (sentimiento en color de texto, novedad en un punto, Δ en el tooltip) y el Ranking es a la vez la vista precisa y la alternativa accesible. Rechazo d3-cloud por CDN: usa `Math.random()` interno, así que el layout salta en cada render y el usuario pierde la orientación espacial — el defecto más caro de la forma. Recomiendo un layout **determinista sin RNG** escrito a mano (~120 líneas): empaque por filas centradas con orden serpentina (el mayor al centro), medición por `canvas.measureText`, cero rotación, y HTML posicionado en absoluto en vez de SVG — lo que da botones nativos, `aria-pressed`, área táctil de 44px vía `.touch-target` y evita añadir un décimo SVG sin `<title>`. Medí los colores: la escala `--div-*` de `tokens.css` NO sirve para texto (`--div-mid` #4A515B = 2.27:1 sobre `--canvas`; en claro `--div-pos-1` = 2.18:1), así que especifico cinco tokens `--wc-*` nuevos con contraste verificado donde la extremidad del sentimiento se codifica en **saturación, no en luminosidad**. También medí que atenuar los términos no seleccionados es inviable: incluso a 0.70 de opacidad `--wc-neg-2` cae a 3.39:1, así que la selección se expresa solo sumando (relleno + anillo inset), nunca restando. La interacción se ancla al contrato real de `/api/eco-mentions` (route.ts:226-236: tokens ≥2 chars, tope 8, AND): click hace toggle y filtra la lista de la misma pantalla vía un `filters.terms` nuevo — no abre `MentionsSliceModal`, porque la lista ya está 200px más abajo. Va entre la rejilla de `QuickMetric` (screens.js:964) y la card "Menciones" (screens.js:967), colapsable, y en móvil arranca en Ranking.

**Decisiones**

- **Componente de dos vistas hermanas (`cloud` + `rank`) con datos, selección y tooltip compartidos, en vez de nube pura** — La nube da reconocimiento de patrón en 300 ms pero no permite ordenar ni comparar magnitudes; el Ranking da la magnitud exacta y, gratis, resuelve la accesibilidad (§4.4) y el móvil (§3.7). El cliente recibe su nube y el producto no pierde la capacidad de responder la pregunta real.
- **Layout determinista de filas centradas con orden serpentina, escrito a mano (~120 líneas), sin RNG** — El determinismo es la propiedad más valiosa: la memoria espacial es lo único que una nube regala, y un layout que salta la destruye. El reparto greedy en orden de rango + filas centradas + `centerOut` dentro de cada fila da la silueta de nube sin azar, es O(n) y hace el FLIP trivial porque cada término tiene una celda con x/y estable.
- **HTML posicionado en absoluto (`<button role="option">`) en vez de SVG `<text>`** — Botones nativos (foco, aria-pressed, Enter/Space), `.touch-target` de tokens.css aplicable para los 44px táctiles, texto copiable, transiciones CSS sin transform sobre `<text>`, y no añade un décimo SVG sin `<title>` a un producto que ya tiene 9.
- **Click hace toggle de selección y filtra la lista de menciones de la misma pantalla; NO abre MentionsSliceModal** — MentionsSliceModal (shell.js:1156) existe para agregados sin lista al lado — heatmap, mapa, termómetro, virales. La nube vive dentro de MentionsScreen, a ~200px de una lista paginada con tres modos de vista; un modal con las mismas menciones sería peor. Alt+click sigue abriendo el modal con `_filter:{q:term}` para el caso 'verlo aparte'.
- **Cinco tokens `--wc-*` nuevos para el sentimiento del término, en vez de reutilizar `--div-*`** — Medido con WCAG 2.1: `--div-mid` #4A515B da 2.27:1 sobre `--canvas` en oscuro, y en claro `--div-neg-1` #E8859A da 2.54:1 y `--div-pos-1` #7CBE92 da 2.18:1. La escala divergente está diseñada para rellenos, no para texto. Los tokens nuevos codifican la extremidad en saturación (el paso neutro es acromático), no en luminosidad, y verifican ≥4.5:1 en los dos modos.
- **La selección se expresa sumando (relleno `--accent-fill` + anillo inset), nunca atenuando los no seleccionados** — Medido: `--wc-neg-2` #FF5470 compuesto sobre `--canvas` cae a 2.52:1 a opacidad 0.55 y sigue en 3.39:1 a 0.70 — por debajo de AA para todo lo que no llegue a 18.66px, que es la mayoría de la nube. El anillo inset además se distingue geométricamente del anillo de foco exterior de tokens.css:455.
- **Términos en Krub (`--ff-sans`), cifras en Besley (`--ff-numeric` / `.num`)** — Besley tiene contraste 1.675 y se rompe por halación a 14-18px sobre --canvas #0E1620, justo donde vive la mitad de la nube; su x-height es 0.520 em contra 0.550 de Krub, y mide +19-24% más ancho en mayúsculas (menos términos por fila, más descartes). Krub no tiene `tnum`, lo que es irrelevante para palabras y decisivo para números — de ahí el reparto.
- **No hay conmutador AND/OR para la multi-selección; se declara AND y se topa en 8 términos** — `/api/eco-mentions` route.ts:226-236 hace `split(/\s+/).filter(t=>t.length>=2).slice(0,8)` con AND entre tokens y no tiene `qMode`. Un conmutador OR sería el sexto comando fantasma después de los cinco de S-04. El tope de 8 se hace visible con `aria-disabled` y motivo, en vez de descartar el 9.º en silencio.

**34 workstreams** (detalle y archivos en el apéndice)

| id | fase | tam | Qué |
|---|---|---|---|
| `WS-W1` | P0 | M | Contrato API: facets, fecha ISO y campos ignorados |
| `WS-W2` | P0 | L | MentionRow único + anatomía nueva (Compacta/Lectura) |
| `WS-W3` | P0 | L | Zona A: cabecera de consulta, chips removibles, permalink, reset |
| `WS-W4` | P0 | M | Fusión de /search en /mentions |
| `WS-W5` | P0 | M | Banda reactiva de 4 cifras + línea de contexto |
| `WS-W6` | P0 | M | Histograma temporal con brushing |
| `WS-W7` | P0 | M | Agrupar historias — interim group=story |
| `WS-W8` | P0 | S | Triage por teclado y estados de carga |
| `WS-W9` | P1 | L | story_id persistido, backfill e índice vectorial |
| `WS-W10` | P1 | M | Exportar respetando filtros (CSV servidor) |
| `WS-W11` | P1 | L | Vistas guardadas, vista→alerta y estado de lectura |
| `WS-W12` | P1 | M | Semántica de primer nivel, impacto/audiencia y densidad |
| `WS-WC-1` | P0 | M | Extraer buildMentionScope() a módulo compartido (fix estructural de F9) |
| `WS-WC-2` | P0 | S | Schema + DDL de mention_terms, wordcloud_forms y wordcloud_phrases |
| `WS-WC-3` | P0 | S | Módulo de stopwords y normalización compartido |
| `WS-WC-4` | P0 | M | Builder incremental del índice invertido dentro de eco-metrics-calculator |
| `WS-WC-5` | P0 | S | Backfill del índice (115,425 menciones) |
| `WS-WC-6` | P1 | L | Minería del diccionario de frases + refresco de formas |
| `WS-WC-7` | P0 | L | Endpoint GET /api/eco-wordcloud |
| `WS-WC-8` | P0 | M | Puntuación y colapso en TS con unit tests sin DB |
| `WS-WC-9` | P0 | S | Test de paridad nube↔lista |
| `WS-WC-10` | P1 | S | Observabilidad: lag del índice y alarma |
| `WS-WC-11` | P2 | M | P2: emoji, trigramas y conmutador de ponderación |
| `WS-WC-1` | P0 | XS | tokens.css §6.5 — tokens `--wc-*` y escala de tamaño |
| `WS-WC-2` | P0 | M | cloud.js — layout determinista + medición |
| `WS-WC-3` | P0 | M | cloud.js — render de la nube, hover/focus y tooltip |
| `WS-WC-4` | P0 | S | cloud.js — vista Ranking (tabla real) y toggle |
| `WS-WC-5` | P0 | S | Integración en MentionsScreen: `filters.terms` y barra de criterios |
| `WS-WC-6` | P0 | S | Accesibilidad: roving tabindex, aria-live y contrato ARIA |
| `WS-WC-7` | P1 | S | Animación de entrada y FLIP con tokens exactos |
| `WS-WC-8` | P0 | XS | Registro sin bundler + cache-bust + especimen |
| `WS-WC-9` | P1 | S | Estados vacío / insuficiente / error / sin baseline |
| `WS-WC-10` | P1 | S | Comportamiento móvil (≤768px) y táctil |
| `WS-WC-11` | P2 | S | Verificación: script de contraste + pruebas de determinismo y desborde |

---

## 9 · Narrativas: detección, novedad y experiencia

Tres especificaciones completas en [`auditoria-diseno-2026-07-narrativas.md`](auditoria-diseno-2026-07-narrativas.md). Las dos primeras midieron contra la base de datos de producción; el diagnóstico corregido está en §5.

### Pipeline de detección de narrativas (eco-narrative-cluster)

La detección no está congelada: está degradada ~40× y detecta con 1–7 días de retraso. Medido hoy (3-ago) contra prod: 1,291 narrativas, la última creada el 2026-08-03 07:15; la crisis de Domenech SÍ parió narrativa ("Salida de Domenech e Itza García", 62 menciones, born 2026-07-21, created 2026-07-23). Lo que colapsó es el ritmo (gobernadora pasó de 457 narrativas/semana a ~10) y la frescura: muchas nacen con born_at de 2025 y el mismo run las marca dormant. La causa dominante no es eps: es la ventana del pool. El DBSCAN de gobernadora recibe siempre exactamente 12,000 candidatos ordenados por created_at ASC, de los cuales 9,801 (81.7%) son publicaciones de 2025 y sólo 68 (0.57%) de los últimos 7 días — las menciones de hoy nunca entran al muestreo. Prueba directa: sobre una ventana de 72h del pool actual, gobernadora tiene 29 core points a eps=0.19/minPts=7 (47 a 0.30); sobre el pool oldest-first, 0 clusters en las 96 corridas de las últimas 48h. El dedup no explica nada: los duplicados son 0.9–4.4% de las menciones de 30 días y no se borran, sólo se marcan. La fase de asignación está muerta por otra razón: assigned=0 en todas las corridas porque el umbral 0.78 vive muy por encima de la similitud real (máx-sim promedio 0.44–0.51) y porque 1,273 de 1,291 narrativas (98.6%) son dormant e invisibles. El precio de todo esto es 700 s de cómputo × 48 corridas/día (~$34/mes) para producir cero clusters, con riesgo de timeout en cuanto aaa y sgpr lleguen al cap. El arreglo P0 es ventana temporal por published_at (mismo predicado en poda y en pool), eps por percentil de la k-distancia en vez de constante mágica, y purga one-shot de 77,897 candidatos.

**Decisiones**

- **El arreglo de primer orden es particionar el pool por ventana temporal sobre published_at, no subir eps** — El DBSCAN de gobernadora recibe 12,000 candidatos de los cuales 9,801 (81.7%) son publicaciones de 2025 y sólo 68 (0.57%) de los últimos 7 días. Sobre una ventana de 72h del mismo pool hay 29 core points a eps=0.19/minPts=7 (47 a 0.30): con muestreo coherente el eps actual ya pare narrativas en la agencia de alto volumen. Además baja n de 12,000 a 200-900, lo que reduce el O(n²) ~180x y elimina el riesgo de timeout.
- **eps se fija por percentil de la k-distancia de la ventana (p25, clamp [0.22,0.34]), no como constante** — El barrido k-NN sobre la ventana Domenech (685 puntos) muestra que NO hay rodilla: pendientes p05→p10=0.86, p10→p25=0.90, p25→p50=0.456 (la curva se aplana). Sin brecha de densidad, cualquier eps global es política, no descubrimiento. p25 de la 6-NN = 0.300 (el 0.19 de prod está en el p12).
- **El filtro temporal va sobre published_at y el mismo predicado se usa en la poda y en la admisión** — created_at es fecha de encolado: un backfill la pone 'hoy' para menciones de 2025 (53,225 candidatos de gobernadora creados el 29-30 jul con published_at de 2025) y la re-encolada la resetea, así que no es monótona. Usando published_at en ambos lados el invariante 'está en el pool ⟺ published_at ≥ NOW()−W' hace la poda irreversible y mata el bucle poda↔reencolado.
- **Rechazar 'dejar entrar duplicados con peso' como fuente de densidad; usarlos sólo como amplificación** — Los duplicados son 0.9%-4.4% de las menciones de 30 días y no se borran (processor/index.ts:266 los persiste con is_duplicate=true). Añadirlos como puntos no mueve la densidad y donde sí abundan (comunicados sindicados) produce el detector de sindicación que ya tenemos: el único nacimiento diario observado es aaa 07:15 con 7-8 comunicados de sequía.
- **HDBSCAN es la respuesta de fondo (P2), pero la ventana es su prerrequisito, no su alternativa** — HDBSCAN elimina el eps global (que el barrido demuestra indefendible), tolera densidad variable entre agencias (aaa 64 vs gobernadora 900 puntos por ventana) y su árbol condensado da la jerarquía padre/hijo que falta para split/merge (causa 8). Su MST es O(n²), viable sólo con n≤~900, es decir con la ventana ya implantada. Implementarlo en packages/shared (~350-500 líneas) para mantenerlo unit-testable.
- **Reactivar la asignación bajando THRESHOLD 0.78→0.70 y añadiendo una segunda etapa de revival de dormant con umbral 0.82** — assigned=0 en todas las corridas. La máx-similitud promedio de una mención contra cualquier centroide es 0.44-0.51, así que 0.78 vive en la cola. Incluir dormant recientes sube de 1 a 19 los matches de 642 menciones de gobernadora (7 días) y es la única forma de hacer alcanzable 'revived' (0 filas jamás).
- **Añadir un modo clusterOnly al lambda y prohibir tocar el env sin barrido previo** — dryRun no sirve para validar clustering: los pasos 3-5 están tras if (!event.dryRun) (index.ts:299,311,316). Hoy no existe forma de probar eps/minPts sin escribir en prod, y así se llegó al cambio manual del 30 jun (eps 0.22→0.19) que nadie pudo validar.
- **La purga de 72,768 candidatos va DESPUÉS del deploy del filtro de ventana, y por agencia** — exec-write acepta una sola sentencia; cuatro llamadas acotan el blast radius y dan rowCount verificable por agencia (gobernadora 55,910 / ddecpr 11,367 / sgpr 2,860 / aaa 2,631). Si se purga antes del deploy, el query de no-asignadas sin filtro de fecha reencola todo a 5,000 por corrida en ~5,5 horas.

### Señales de NOVEDAD dentro de las narrativas (sub-temas, actores, migración, genealogía, estados y alertas)

Verifiqué las ocho causas raíz leyendo el código: siete se confirman literalmente; la octava (drift env 0.22/10 vs prod 0.19/7) NO existe — `workers-stack.ts:425-426` ya dice `NARRATIVE_MIN_MENTIONS_BIRTH: '7'` y `NARRATIVE_DBSCAN_EPS: '0.19'`; el drift es de comentarios y defaults del código (`narrative-cluster/index.ts:55-56`, comentario `workers-stack.ts:387-388`). Encontré además tres causas nuevas: (N1) `born_at` se fija con `first.published_at` (index.ts:418-421, 480), la mención MÁS VIEJA del cluster, y como el pool es oldest-first las narrativas nacen con `ageDays` grande — nacen ya `declining`/`dormant` y jamás pasan por `emerging`; (N2) toda la velocidad se mide con `m.published_at` (index.ts:540,545), no con `nm.assigned_at`, así que una narrativa detectada hoy sobre menciones de hace 5 días tiene velocity24h=0 — el sistema no tiene noción de "acabo de verlo"; (N3) `drift_score` existe pero se calcula solo para `status != 'dormant'` (narrative-drift/index.ts:112), se sobrescribe sin historia y aparece en CERO archivos de `apps/web` (grep vacío). El diagnóstico de fondo: el sistema tiene UNA dimensión ("status") que mezcla volumen, edad y recencia, y CERO representación de "qué hay dentro de la narrativa". La propuesta separa tres ejes ortogonales (actividad / tendencia / novedad como array de flags), introduce la tabla `narrative_facets` con un detector de sub-temas calibrado POR narrativa (umbral de outlier derivado del IQR de la propia narrativa, no global), añade genealogía real (`spawn`/`split`/`merge_candidate` con evidencia de menciones), y emite las alertas reusando `alert_rules`/`alert_history`/`renderSimpleAlertHtml` exactamente con el patrón de `metrics-calculator/index.ts:553-645` en vez de inventar otro mecanismo. Todo mantiene la columna `status` como vista derivada para no romper la SPA sin bundler.

**Decisiones**

- **El umbral de "outlier" para detectar sub-temas se calibra POR narrativa (q75 + 1.5·IQR de las distancias del pre-ventana, con piso absoluto 0.30), no con una constante global** — La dispersión intrínseca varía por naturaleza de la fuente: una narrativa de prensa tiene IQR≈0.04 y una de X ≈0.15. Un umbral global produce 100% ruido en la segunda y 0% detección en la primera. El piso 0.30 está anclado en la medición del brief (14 core points a eps 0.30 en la crisis Domenech, 0 a 0.19)
- **Sub-clustering con DBSCAN local (eps 0.28, minPts 4) sobre el conjunto de outliers, reusando dbscan() de @eco/shared** — Declara ruido explícitamente — el 70-80% de los outliers son menciones sueltas sin relación; no exige elegir k; reusa código ya testeado (narratives-math.ts:122-176); |O| son decenas, el O(n²) es irrelevante
- **La distancia se mide contra un centroide de referencia recalculado del pre-ventana (menciones anteriores a 72h), no contra narratives.centroid** — El centroide EWMA (alpha=0.05) ya absorbió parcialmente el sub-tema que queremos detectar, y centroid_at_naming puede tener meses de antigüedad. El pre-ventana es literalmente "el tema antes de que esto pasara"
- **La máquina de estados se parte en tres ejes ortogonales (activity / trend / novelty[]) y se conserva `status` como columna DERIVADA** — La SPA no tiene bundler y colorea por NARRATIVE_STATUS_COLORS (screens.js:4903) mientras /api/narrative filtra por status; derivar status permite añadir los ejes sin romper nada y migrar la UI después
- **`emerging` se elimina como estado y se sustituye por el flag new_born medido con una columna nueva `detected_at` (NOW() al insertar); `revived` deja de ser estado y pasa a `revived_at`** — emerging hoy es proxy de tamaño/edad (narratives-math.ts:250) y además inalcanzable porque born_at toma la mención más VIEJA del cluster (index.ts:418-421,480 — hallazgo N1). revived es estructuralmente inalcanzable porque la asignación excluye dormant (index.ts:218)
- **La velocidad se mide con GREATEST(m.published_at, nm.assigned_at) en vez de solo m.published_at** — Hallazgo N2: con backfill BW de 12h y cursores atrasados, una narrativa detectada ahora sobre menciones de hace 5 días tiene velocity24h = 0. El analista percibe como novedad lo que el sistema acaba de ver, no solo lo recién publicado
- **Genealogía en una tabla nueva narrative_lineage (dirigida, con evidencia y contador de confirmaciones), no en narrative_edges** — narrative_edges es undirected por diseño (PK (source,target,edge_type) + convención source<target, narrative-edges/index.ts:96) — no puede expresar padre→hijo ni sostener el ciclo candidato→confirmado→aplicado
- **Las alertas de narrativa se emiten desde el lambda de facets reusando alert_rules/alert_history/renderSimpleAlertHtml (patrón metrics-calculator:553-645), con cooldown por (regla, narrativa, evento) vía details->>'narrativeId', y digest diario para facet_new/narrative_born** — eco-alerts es SQS por mención y no sirve para eventos batch; el patrón de metrics-calculator ya resuelve cooldown, SES por destinatario y auditoría. El cooldown por regla silenciaría todas las narrativas tras la primera alerta

### Rediseño de la experiencia de Narrativas (SPA)

Narrativas es un enclave: es la única pantalla sin `.card`, sin `ecoCols`, con breakpoint propio (980px) y con paleta importada de Ant Design. Sobre esa base comete el error más caro para un cliente de gobierno: afirma cosas que no puede sostener — la píldora dice "Pico" junto a "VEL. 24H 0.0", el resumen dice "Volumen estable" a 40 px de "Sin datos temporales todavía", y tres de ocho narrativas (las dos más grandes del cliente) se renderizan en inglés crudo, sin punto de color y sin que ningún chip las cuente. Todo eso sale de una grieta: el vocabulario de estados no tiene dueño y los estados que se muestran están congelados desde el 6 de julio. Hay además dos implementaciones rivales de la misma pantalla y dos APIs rivales; la de Next.js está huérfana (nadie la enlaza), es de tema claro dentro de un producto oscuro y **no compila en runtime** (`<Link><a>` con Next 15). Decisión: la SPA sobrevive, la de Next.js se borra completa junto a `react-force-graph-2d` y al trío `/api/narratives/*`; se migran de ella tres cosas concretas (contrato de nulos `fmtNum`, copia del vacío, enum a módulo compartido). El rediseño reordena la pantalla alrededor de tres preguntas en secuencia — ¿qué hay nuevo? ¿qué está creciendo? ¿de qué va y de dónde viene? — con un riel de novedades de máximo 5 tarjetas y presupuesto de señal, una lista maestra agrupada y ordenada por aceleración, y un detalle con eje Y desde cero más cinta de hitos numerados. El streamgraph se retira (centro móvil, sin eje, con suavizado que inventa días); el force-graph se retira en las dos implementaciones (posición sin significado, layout dependiente del orden del array) y se reemplaza por un diagrama de arcos sobre eje de tiempo más un árbol de genealogía de 3 niveles en el detalle. Se fecha el estado ("En pico · al 6 jul") para que la pantalla no vuelva a mentir cuando la detección se congele.

**Decisiones**

- **Sobrevive la SPA (`screens.js:4597-5468`); se borran los 5 archivos Next.js de Narrativas, el trío `/api/narratives/*` y la dependencia `react-force-graph-2d`** — La página Next.js está huérfana (nadie la enlaza: `shell.js:93` y `app.js:93/109/357` solo conocen el SPA; los únicos iframes son settings/reports), es de tema claro dentro de un producto oscuro, y no renderiza: `page.tsx:170` usa `<Link href="/overview"><a>` con `next ^15.3.0`, patrón eliminado en Next 13. La SPA además tiene más features (streamgraph, drawer por día, lista maestra) y `/api/narrative/*` es superconj
- **Migrar exactamente 3 cosas desde Next.js: el contrato de nulos `fmtNum/fmtDate` (`NarrativeDetail.tsx:52-55`), la copia del empty state (`page.tsx:211`, corrigiendo 'cada hora'→'cada 30 minutos') y el enum de estados a `packages/shared/src/narratives-status.ts`** — `if (n == null) return '—'` es la única implementación correcta del contrato de nulos en toda la feature y es la cura de F8 y de los `Number(x || 0)` de `screens.js:5063/5067/5178`. El enum está triplicado (SPA, badge, prompts del lambda) y de esa grieta sale F7 completo
- **Fechar el estado: la API añade `statusAt` (= `narratives.updated_at`); la píldora renderiza 'En pico · al 12 ago' sobre 48 h y degrada a 'Sin actualizar' sobre 7 días** — Cura de raíz la contradicción 'PICO / VEL. 24H 0.0' sin esperar el arreglo de la detección. `computeLifecycleState` exige `velocity24h >= 5` para `peaking` (`narratives-math.ts:236`), así que la píldora actual es una etiqueta de hace 5 semanas presentada como presente
- **Retirar el streamgraph y reemplazarlo por columnas apiladas desde cero con eje Y, huecos explícitos en `--chart-void` y cinta de hitos numerados con lista textual** — El streamgraph no tiene eje Y y su línea base se mueve (`baseline = -total/2`, `screens.js:5262`); el suavizado Catmull-Rom (`4644-4660`) inventa volumen en días de silencio; y el SQL solo emite días con filas (`api/narrative/[id]/route.ts:66-79`) así que un hueco de 3 meses se interpola como cinta recta. La doctrina prohíbe normalizar sin eje
- **Retirar el force-graph en ambas implementaciones; reemplazar por diagrama de arcos sobre eje de tiempo (x = born_at, y = rango por menciones, una faceta por tipo de arista, tope 40 nodos declarado) y árbol de genealogía de 3 niveles en el detalle** — La semilla del layout es circular por índice de array (`screens.js:4697-4700`) y el array viene de `ORDER BY mention_count DESC` (`api/narrative/route.ts:104`): una mención nueva reordena el mapa entero. Además el conjunto de nodos se rellena con nodos sin conexiones (`4686-4692`) sin distinguirlos, y los edges no son genealogía (solo co_occurrence/author_overlap/semantic, `schema/narratives.ts:96-99`)
- **Presupuesto de señal: máximo 5 tarjetas en el riel, máximo 2 del mismo tipo, una sola marca de señal por fila de lista, colapso a una tarjeta si disparan >12 señales en 24 h, y máximo 3 matices saturados simultáneos con la selección expresada como borde+superficie (no como matiz)** — Hay 6 señales de novedad y 6 estados; sin presupuesto la pantalla se convierte en un árbol de navidad la primera vez que la detección funcione. Hoy el problema es el inverso pero el mismo: el naranja `#FF6A3D` significa marca, acento, pico, fila seleccionada, pico del gráfico y día seleccionado a la vez
- **Sustituir los 7 chips de estado por secciones agrupadas en la lista maestra, con orden por defecto = aceleración (Δ7d) y selector de orden visible** — `screens.js:4867-4872` re-ordena por `RANK[status] ?? 9`, deshaciendo el orden por volumen que la API ya calculó y enterrando las dos narrativas más grandes del cliente (214 y 168 menciones) en las posiciones 6 y 7. Los chips son 10.5px/21px de alto (`index.html:702-720`), envuelven en 4 filas a 390px y 4 de 7 suelen estar deshabilitados
- **Renombrar el vocabulario: Naciente / En curso / En pico / Enfriándose / Dormida / Reactivada, cada uno con tooltip cuantitativo, más 'Sin clasificar' con la clave cruda visible; `narrStatus()` como único acceso** — 'Pico/Activa/Emergente' se leen como categorías inconexas cuando en realidad son un eje de intensidad; 'Emergente' sugiere importancia mientras la regla real es tamaño+edad (`narratives-math.ts:250`). El fallback obligatorio elimina de un golpe los 4 síntomas de F7 (punto sin color, inglés crudo, conteo que no suma, estado no filtrable)

**35 workstreams** (detalle y archivos en el apéndice)

| id | fase | tam | Qué |
|---|---|---|---|
| `WS-N1` | P0 | S | Ventana temporal por published_at (admisión, poda, pool) |
| `WS-N2` | P0 | M | eps auto-calibrado + matriz de distancias precomputada |
| `WS-N3` | P0 | S | Modo diagnóstico clusterOnly + barrido SQL reproducible |
| `WS-N4` | P0 | XS | Purga one-shot del pool (72,768 filas) vía exec-write |
| `WS-N5` | P1 | M | Reactivar la asignación: THRESHOLD 0.70 + revival de dormant en 2 etapas |
| `WS-N6` | P1 | M | revived alcanzable y sticky + lifecycle en un solo statement |
| `WS-N7` | P1 | M | Observabilidad EMF + alarmas CloudWatch |
| `WS-N8` | P1 | S | Sanear drift de configuración y documentación |
| `WS-N9` | P2 | M | Índices vectoriales: HNSW en candidates y mentions, decidir sobre narratives.centroid |
| `WS-N10` | P2 | L | Experimento: embeddings sobre nlp_summary + topics |
| `WS-N11` | P2 | XL | HDBSCAN + jerarquía para genealogía de narrativas |
| `WS-N-0` | P0 | S | Instrumentación: detected_at, assigned_at en velocidad y 3 buckets |
| `WS-N-1` | P0 | M | computeNarrativeState: tres ejes + status derivado + tests |
| `WS-N-2` | P0 | S | Desbloquear revived: quitar el filtro de dormant con umbral doble 0.78/0.86 |
| `WS-N-3` | P0 | M | narratives-facets.ts: detectFacets() + quantile() puros con tests |
| `WS-N-4` | P0 | S | DDL narrative_facets / narrative_facet_mentions / narrative_lineage + ALTER narratives (self-heal idempotente) |
| `WS-N-5` | P1 | L | Lambda eco-narrative-facets: escaneo, naming Bedrock, persistencia |
| `WS-N-6` | P1 | M | Backtest y calibración del grid de umbrales (27 configuraciones, 60 días) |
| `WS-N-7` | P1 | M | Señales agregadas baratas: new_actors, platform_shift, geo_shift, tone_shift |
| `WS-N-8` | P1 | L | Genealogía: spawn/split desde facets promovibles + merge_candidate diario |
| `WS-N-9` | P2 | L | Alertas narrative_novelty reusando alert_rules/alert_history + digest en el correo Diario |
| `WS-N-10` | P2 | S | Drift diario con historia (prev_drift_score/prev_keywords) y flag reframed |
| `WS-N-11` | P2 | L | Exponer los ejes, facets y lineage en la API y la SPA (bloque 'Nuevo dentro de esta narrativa') |
| `WS-N-A` | P0 | M | Vocabulario de estados como contrato compartido |
| `WS-N-B` | P0 | S | Contrato de nulos y limpieza de formateo |
| `WS-N-C` | P0 | S | Píldora de estado fechada y cabecera de detalle reordenada |
| `WS-N-D` | P0 | L | Lista maestra: secciones, orden por aceleración, sparkline con escala compartida |
| `WS-N-E` | P0 | M | Serie temporal densa en la API (huecos y no clasificados) |
| `WS-N-F` | P1 | XL | NarrativeTrajectory: columnas apiladas desde cero + cinta de hitos |
| `WS-N-G` | P1 | L | Riel de novedades con presupuesto de señal |
| `WS-N-H` | P1 | XL | Retirar el force-graph y construir Línea de vida + Procedencia |
| `WS-N-I` | P1 | M | Colapso de vacíos y unificación de copia |
| `WS-N-J` | P1 | L | Móvil: detalle como ruta propia y drawer como hoja inferior |
| `WS-N-K` | P2 | S | Borrar la implementación Next.js y las rutas duplicadas |
| `WS-N-L` | P2 | M | Empty states de 0, 3 y 180 narrativas |

---

## 10 · Plan

El plan tiene una regla de orden por encima de todo lo demás: **primero se deja
de mentir, después se hace bonito.** Un cliente de gobierno perdona una tabla
apretada; no perdona descubrir que el histograma que le enseñaste a su
secretario es una función seno.

Cada workstream lleva id, fase, tamaño (XS–XL) y de qué depende. Los ids
`WS-D*` vienen de la doctrina de gráficas, `WS-C*` del rediseño de `charts.js`,
`WS-F*` de fundaciones, `WS-M*` de Menciones, `WS-N*` de Narrativas y `WS-A*`
de accesibilidad.

### Fase 0 — Dejar de mentir ✅ **IMPLEMENTADA** (commit `c16e181`)

> **Estado: los nueve workstreams están aplicados y verificados.** Medido con
> Chrome headless sobre las 10 rutas × {1440, 390}, con fixtures que traen a
> propósito los tres casos borde (`polarizationIndex` nulo, status de narrativa
> fuera del enum, `strength` de arista nula):
>
> | | Antes | Después |
> |---|---:|---:|
> | Paths SVG con `NaN` | 4 | **0** |
> | Errores de consola en el Scorecard | 4 | **0** |
> | Histogramas sintéticos rotulados como medidos | 3 | **0** |
> | Registros de auditoría inventados | 1 | **0** |
> | Fuentes rivales para «menciones» | 2 (47 vs 54 en prod) | **1** |
> | Chips de narrativa que no suman a «Todas» | 5 de 8 | **8 de 8** |
> | Texto bajo AA (escritorio) | 184 | **44** |
>
> Los 44 que quedan son exactamente los hex hardcodeados: 40 del calendario de
> Tópicos (pinta con la paleta del tema `costa`) y 4 avatares con `#4A7FB5`.
> Los cierra **`WS-F1`** de la Fase 1.
>
> Se añadió un décimo arreglo no planificado, del mismo tipo: `splitSentiment()`
> inventaba el desglose pos/neu/neg a partir de un total con ratios fijos. En
> Geografía se reemplazó por el desglose real que `/api/eco-geo` ya manda
> (`route.ts:172`); la función se eliminó.
>
> Nota de método: la sonda WCAG leía sólo `backgroundColor`, así que no veía los
> fondos en gradiente — daba falsos positivos con texto oscuro y, peor, falsos
> **negativos** con texto blanco sobre gradiente. Ya corregida; la medición
> `1,884 → 184` de §2.5 tenía ese punto ciego en ambos extremos, sin que cambie
> la dirección de la conclusión.


Nueve workstreams, todos S o M, todos independientes entre sí. Ninguno necesita
que el sistema de diseño esté terminado. Si sólo se hace esta fase, el producto
ya deja de tener los defectos que cuestan un contrato.

| id | Tam | Qué | Por qué primero |
|---|---|---|---|
| `WS-P0.1` | S | **Borrar los tres histogramas sintéticos.** `screens.js:1574-1577`, `2003-2007`, `268-286`: quitar el `Math.sin(...)` y el `jitter`, y no renderizar el bloque cuando no hay dato por hora real. Si se quiere conservar la función, alimentarla del `HOUR_HEATMAP` que ya viene en `/api/eco-data`, filtrado al día del click. | Es dato inventado presentado como medido, rotulado «Volumen por hora», en tres pantallas. La auditoría del 16 jul ya lo señaló y sigue vivo. |
| `WS-P0.2` | XS | **Borrar el log de auditoría falso.** `screens.js:3954-3960`: eliminar el bloque «Actividad reciente» con las IPs inventadas. Volver a poner sólo cuando exista una tabla real de auditoría. | Un producto de gobierno que muestra un rastro de auditoría ficticio con IPs plausibles es un problema de confianza, no de diseño. |
| `WS-P0.3` | XS | **Borrar `SEED_USERS`** (`screens.js:3531-3538`): seis empleados de gobierno inventados con correos `@dtop.pr.gov`/`@daco.pr.gov`/`@salud.pr.gov`. Es código muerto —la única referencia es la declaración— pero se despacha al navegador. | Peso muerto y riesgo de que alguien lo vuelva a conectar. |
| `WS-P0.4` | S | **Alinear el periodo del boot con el chip.** `index.html:1356` pide `period=1M` cuando `localStorage.eco.period` está vacío; `app.js:242` arranca el estado en `'7D'`. Unificar en una constante compartida y hacer que el boot lea el mismo default. | La barra dice 7D y los datos son de 30 días **en cada inicio de sesión tras cerrar sesión**, porque `ecoSignOut` hace `localStorage.clear()`. |
| `WS-P0.5` | M | **Un solo total de menciones.** Decidir la fuente canónica (recomendado: el recuento vivo sobre `mentions`, que es el que el drill-down puede reproducir) y hacer que el KPI, el badge del rail, el enlace «Ver todas» y el modal lean de ahí. Unificar además el filtro de pertinencia y la ventana entre `/api/eco-data` y `/api/eco-mentions`. | Medido en producción: 47 vs 54 (≈13%). El usuario hace click en una tarjeta y el drill-down la contradice. |
| `WS-P0.6` | S | **`padding.r ≥ 52` en `MultiLineChart`** (`charts.js:187`) para que la etiqueta de 46px quepa. | 30 de sus 46px se recortan. Arreglo de una línea que la auditoría responsive ya había pedido. |
| `WS-P0.7` | S | **Guarda de nulos en `fmtVal` y en la cadena de escala** (`charts.js:348-356`). Un `null` deja de tumbar la pantalla y pasa a dibujarse como **hueco**, no como cero. | `/api/eco-data` emite `polarizationIndex: null`; hoy eso es un `TypeError` que revienta el Scorecard y paths `M 2,NaN`. |
| `WS-P0.8` | S | **Robustez de estados de narrativa**: un `status` desconocido cae a `--narr-unknown` con etiqueta «Sin clasificar», y los chips de filtro cuentan **todo** lo que la lista muestra. Arreglar el `nan%` de «Narrativas relacionadas». | Hoy tres narrativas son visibles en la lista pero invisibles al filtro, y se muestran en inglés crudo. |
| `WS-P0.9` | XS | **Quitar el «78 municipios monitoreados» hardcodeado** (`screens.js:2755`) y derivarlo de los datos. | Es una cifra que el producto no puede respaldar. |

### Estado de implementación (al 4 de agosto)

| Fase / workstream | Estado |
|---|---|
| **Fase 0** — los 9 workstreams + `splitSentiment` | ✅ `c16e181` |
| `WS-F1` retirar los 132 literales de color | ✅ `3ce9f84` |
| `WS-F4` un solo contrato de dirección de delta | ✅ `3ce9f84` |
| `WS-F5` retirar `costa` y `gaceta`, tokens a `:root` | ✅ `3ce9f84` |
| `WS-F9` unificar Ant Design con los tokens | ✅ `7f03154` |
| `WS-F10` ritmo de la cabecera | ✅ `3920942` |
| `WS-A1` contrato de a11y de gráficas | ✅ `e20362a` |
| `WS-A2` objetivos táctiles | ✅ `7d2fc90` |
| `WS-A3` nombres accesibles | ✅ `e20362a` |
| `WS-A4` interacción sólo-hover | ✅ `7d2fc90` |
| `WS-A5` pantalla de error | ✅ `3920942` |
| `WS-C2` gráfica de tendencia honesta (`SeriesPanels`) | ✅ `3920942` |
| `F6` leyenda del heatmap con color de otro tema | ✅ `7d2fc90` |
| **Nube de palabras** (`/api/eco-terms` + `TermsCloud`) | ✅ `c86a55a` |
| `WS-N1` ventana temporal del pool | ✅ `cf23685` · sin desplegar |
| `WS-N2` eps auto-calibrado (`autoEps`) | ✅ `cf23685` · sin desplegar |
| `WS-N3` barrido diagnóstico (solo lectura) | ✅ `cf23685` |
| `WS-N5` reactivar la asignación | ✅ `cf23685` · sin desplegar |
| `WS-N6` máquina de estados + `revived` alcanzable | ✅ `cf23685` · sin desplegar |
| `WS-N8` sanear el drift de documentación | ✅ `cf23685` |
| `WS-N7` observabilidad | 🟡 log estructurado sí; alarmas CloudWatch no |
| `WS-N4` purga del pool (~72,768 filas) | ⬜ **requiere autorización** |
| `WS-F3` decidir el color de marca | ⬜ **decisión del cliente** |
| `WS-F2` reconciliar nombres de token con el apéndice | ⬜ |
| `WS-F6` arreglar `mando` light | 🟡 Leaflet y CSS sí; falta barrido completo |
| `WS-F7` migrar los `fontSize`/`gap` inline | ⬜ |
| `WS-F8` primitivas que faltan | ⬜ |
| Resto de gráficas · funciones de Menciones · UX de Narrativas | ⬜ |

**Medición final** (20 capturas: 10 rutas × {1440, 390}, sondas sobre los
colores resueltos en el DOM):

| | Al inicio | Ahora |
|---|---:|---:|
| Texto bajo el mínimo de contraste AA | 1,884 | **0** |
| Objetivos táctiles bajo 24×24 (AA, WCAG 2.2 SC 2.5.8) | 131 | **0** |
| Objetivos bajo 44×44 (AAA, WCAG 2.1 SC 2.5.5) | 365 | 249 |
| Paths SVG con `NaN` | 4 | **0** |
| Errores de consola | 4 | **0** |
| Desbordes horizontales | 0 | **0** |
| Atributos ARIA (en la página) | 18 (fuente) | **229** |
| SVG con nombre o marcados decorativos | 0 de 40 | **39 de 40** |
| Tablas equivalentes de gráficas | 0 | **2** |
| Histogramas sintéticos rotulados como medidos | 3 | **0** |
| Registros de auditoría inventados | 1 | **0** |
| Literales de color fuera del sistema | 132 | **2** (justificados) |
| Temas × modos declarados vs alcanzables | 6 vs 2 | **1 × 2** |
| Sistemas de diseño en el producto | 2 | **1** |
| Tests de la máquina de estados de narrativas | 0 | **12** |

> Los 249 que siguen bajo 44×44 son celdas de heatmap a 24px y filas de lista a
> 28px: densidad legítima que **cumple AA**. Subirlas a 44 es una decisión de
> producto (menos datos por pantalla), no una corrección pendiente.

> **Nota de método.** Dos mediciones que reporté antes estaban mal y quedan
> corregidas aquí: (1) los «369 objetivos bajo 44px» se contaban como fallo AA
> cuando 44×44 es **AAA**; (2) los «33 errores de TypeScript preexistentes» eran
> un artefacto del worktree — `@eco/*` resuelve al monorepo principal, que está
> sucio. Con los paths apuntando al worktree quedan **2**, ambos ajenos a este
> trabajo.

### Fase 1 — Terminar el sistema de diseño

El §2 ya sembró la capa de tokens y midió −90% en fallos de contraste. Lo que
queda es **retirar los 132 literales** que la esquivan, porque mientras existan
el sistema no es la fuente de verdad, es una sugerencia.

| id | Tam | Qué | Depende de |
|---|---|---|---|
| `WS-F1` | M | **Retirar los 103 hex del JS.** Sustituir por `--cat-1..8`, `--emo-*`, `--narr-*`, `--seq-*`, `--on-*`. Los cuatro puntos calientes: la paleta categórica de 8 **copiada 4 veces** (`screens.js:311`, `1998`, `2448`, `4143`) pasa a un solo array de tokens; `SENT_HEX` (`screens.js:2454`) deja de usar la paleta del tema **costa**; `emotionColor()` (`screens.js:1772-1785`) pasa a `--emo-*`; `NARRATIVE_STATUS_COLORS` (`screens.js:4602`) a `--narr-*`. **Cierra los 184 fallos de contraste que quedan** (160 de ellos son sólo el calendario de tópicos). | — |
| `WS-F2` | S | **Reconciliar los nombres de token** entre `tokens.css` (`--narr-*`, `--cat-1..8`) y `docs/…-fundaciones.md` (`--nar-*`, `--cat-1..5` + `--cat-other`). Elegir uno y actualizar el otro documento; hoy divergen y eso reintroduce el problema que el sistema viene a resolver. | — |
| `WS-F3` | M | **Decidir el conflicto `--accent`.** Dos soluciones válidas a la colisión `--accent === --neg`: (a) la que ya está sembrada — mover `--neg` a `#FF5470` y conservar el naranja como identidad; (b) la que propone la unidad de color — mover `--accent` al azul `#58A6FF` (ΔE 116, y realinea con el favicon cian que ya existe). **Es una decisión de marca, no técnica.** Sea cual sea, hay que arreglar además las consecuencias semánticas: la banda FUERTE de Brand Health se pinta con el mismo rojo que CRÍTICO, el gauge de NSS pinta MUY POS igual que MUY NEG, y `BAND_TONE` manda FUERTE/MUY POS/ACELERADA al tono `accent`. | decisión del cliente |
| `WS-F4` | S | **Un solo contrato de dirección de delta.** Hoy el delta de volumen es verde-si-sube en el Scorecard y rojo-si-sube en Tópicos — el mismo dato, colores opuestos. Y `SentimentBar` pinta *toda* subida de volumen como mala, también la de Turismo. Definir por métrica si «más es mejor», «más es peor» o «neutro», y que el color lo derive de ahí. | `WS-F1` |
| `WS-F5` | M | **Retirar `costa` y `gaceta`.** ≈118 líneas de CSS, 13 overrides `[data-theme=]`, 14 ramas `theme === 'gaceta'` en JS y 6 literales del selector de temas. Al quedar un solo tema, los tokens pasan a `:root` incondicional con `:root[data-mode="light"]` como único override. | `WS-F1` |
| `WS-F6` | M | **Arreglar `mando` light**, que **sí es alcanzable** (el botón del sol persiste en `localStorage`) y está roto en 6 sitios: los marcadores y el tooltip de Leaflet llevan hex de dark (`charts.js:810-826`, `shell.js:761-763`), `SENT_HEX` usa costa, y `--warn` (3.86:1) y `--text-3` (3.21:1) fallan AA sobre blanco. Causa estructural: **Leaflet recibe los colores como strings en opciones JS**, no como CSS, así que necesita un puente que lea los tokens con `getComputedStyle` y se re-ejecute al cambiar de modo. | `WS-F1` |
| `WS-F7` | M | **Migrar los `fontSize`/`gap`/`padding`/`borderRadius` inline** a las clases y tokens de `tokens.css`, con el mapa valor-viejo→token que ya está en fundaciones. Prioridad por pantalla, empezando por Menciones (107 casos) y Tópicos. Ojo con la regresión ya observada: Besley/Krub son más anchos y la columna de tópico empezó a truncar «Desarrollo económi…» donde antes cabía. | `WS-F1` |
| `WS-F8` | L | **Las primitivas que faltan** y que el código reinventa cada vez: `Overlay` (no existe, y hoy `Escape` colapsa capas), `DataTable`, `EmptyState` (24 bloques copiados a mano en 3 tamaños), `Tooltip`, `MetricValue`, `DeltaBadge`. Especificadas en fundaciones §5. | `WS-F7` |
| `WS-F9` | M | **Unificar el segundo sistema de diseño.** Las páginas Next.js corren Ant Design con `ecoTheme` (`src/theme/eco-theme.ts`): primario `#0A7EA4` turquesa contra el `#FF6A3D` de la SPA, fondos `#FFFFFF` fijos **sin `darkAlgorithm`**, radios 8/14/6 contra 3/4px, `controlHeight: 36` (bajo el mínimo táctil), y `fontFamily` de fuentes del sistema con el comentario «no external loading» — así que **no recibirá Besley/Krub**. Estas páginas se embeben por iframe en la SPA (`screens.js:2938`, `3060`) y aparecen como una isla clara de otra marca. Derivar `ecoTheme` de los tokens y cargar las fuentes en `layout.tsx` (hoy `globals.css` tiene **cero** declaraciones de `font-family`). | `WS-F1` |
| `WS-F10` | S | **Recuperar el ritmo vertical de la cabecera.** ~190px antes del primer dato, con **una fila entera para un único botón de tema**. Fusionar eyebrow + título + «datos al cierre de ayer» en una línea y meter el toggle en la barra de filtros. | — |

### Fase 2 — Los sistemas, lo que no puede esperar

Estos son los workstreams que las tres especificaciones de sistema marcaron P0. Se pueden empezar en paralelo a la Fase 1: sólo los de gráficas dependen del núcleo (`WS-C1`).

*48 workstreams*

| id | Unidad | Tam | Qué | Depende de |
|---|---|---|---|---|
| `WS-D1` | Gráficas · doctrina | M | Núcleo de escala + contrato de nulos en charts.js | — |
| `WS-D2` | Gráficas · doctrina | L | SeriesPanels (small multiples) + reemplazo de OverviewTendencia | WS-G1 |
| `WS-D3` | Gráficas · doctrina | L | Eje obligatorio y cero obligatorio en MultiLineChart | WS-G1 |
| `WS-D4` | Gráficas · doctrina | M | Un solo contrato de delta en la tira-leyenda del chart | — |
| `WS-D5` | Gráficas · doctrina | M | Sparkline responsive, sin fill en series con signo, con huecos | WS-G1 |
| `WS-C1` | Gráficas · charts.js | L | charts-core.js: canon de nulos, escalas, ticks, LTTB, paths + registro en el pipeline | — |
| `WS-C2` | Gráficas · charts.js | S | METRIC_SPECS en /api/eco-data + window.ECO_METRICS en el núcleo | WS-G1 |
| `WS-C3` | Gráficas · charts.js | M | ChartFrame + los 5 estados canónicos + tabla oculta a11y | WS-G1 |
| `WS-C4` | Gráficas · charts.js | M | ChartTooltip en portal HTML + Pointer Events + teclado + crosshair compartido | WS-G3 |
| `WS-C5` | Gráficas · charts.js | L | LineChart — fusiona MultiLineChart y AreaLineChart; arregla F1, F2, F3, F4, C-06, C-15, C-20 | WS-G4 |
| `WS-C6` | Gráficas · charts.js | S | Legend como primitiva + arreglo estructural de F6 | WS-G3 |
| `WS-M1` | Menciones · pantalla | M | Contrato API: facets, fecha ISO y campos ignorados | — |
| `WS-M2` | Menciones · pantalla | L | MentionRow único + anatomía nueva (Compacta/Lectura) | W1 |
| `WS-M3` | Menciones · pantalla | L | Zona A: cabecera de consulta, chips removibles, permalink, reset | W1 |
| `WS-M4` | Menciones · pantalla | M | Fusión de /search en /mentions | W3 |
| `WS-M5` | Menciones · pantalla | M | Banda reactiva de 4 cifras + línea de contexto | W1 |
| `WS-M6` | Menciones · pantalla | M | Histograma temporal con brushing | W1 |
| `WS-M7` | Menciones · pantalla | M | Agrupar historias — interim group=story | W2 |
| `WS-M8` | Menciones · pantalla | S | Triage por teclado y estados de carga | — |
| `WS-W1` | Nube · backend | M | Extraer buildMentionScope() a módulo compartido (fix estructural de F9) | — |
| `WS-W2` | Nube · backend | S | Schema + DDL de mention_terms, wordcloud_forms y wordcloud_phrases | — |
| `WS-W3` | Nube · backend | S | Módulo de stopwords y normalización compartido | — |
| `WS-W4` | Nube · backend | M | Builder incremental del índice invertido dentro de eco-metrics-calculator | WC-2, WC-3 |
| `WS-W5` | Nube · backend | S | Backfill del índice (115,425 menciones) | WC-4 |
| `WS-W7` | Nube · backend | L | Endpoint GET /api/eco-wordcloud | WC-1, WC-3, WC-4 |
| `WS-W8` | Nube · backend | M | Puntuación y colapso en TS con unit tests sin DB | WC-3 |
| `WS-W9` | Nube · backend | S | Test de paridad nube↔lista | WC-7 |
| `WS-R1` | Nube · render | XS | tokens.css §6.5 — tokens `--wc-*` y escala de tamaño | — |
| `WS-R2` | Nube · render | M | cloud.js — layout determinista + medición | — |
| `WS-R3` | Nube · render | M | cloud.js — render de la nube, hover/focus y tooltip | WC-1, WC-2 |
| `WS-R4` | Nube · render | S | cloud.js — vista Ranking (tabla real) y toggle | WC-2 |
| `WS-R5` | Nube · render | S | Integración en MentionsScreen: `filters.terms` y barra de criterios | WC-3, WC-4 |
| `WS-R6` | Nube · render | S | Accesibilidad: roving tabindex, aria-live y contrato ARIA | WC-3 |
| `WS-R8` | Nube · render | XS | Registro sin bundler + cache-bust + especimen | WC-2 |
| `WS-ND1` | Narrativas · detección | S | Ventana temporal por published_at (admisión, poda, pool) | — |
| `WS-ND2` | Narrativas · detección | M | eps auto-calibrado + matriz de distancias precomputada | N1 |
| `WS-ND3` | Narrativas · detección | S | Modo diagnóstico clusterOnly + barrido SQL reproducible | N2 |
| `WS-ND4` | Narrativas · detección | XS | Purga one-shot del pool (72,768 filas) vía exec-write | N1 |
| `WS-NV1` | Narrativas · novedad | S | Instrumentación: detected_at, assigned_at en velocidad y 3 buckets | — |
| `WS-NV2` | Narrativas · novedad | M | computeNarrativeState: tres ejes + status derivado + tests | N-0 |
| `WS-NV3` | Narrativas · novedad | S | Desbloquear revived: quitar el filtro de dormant con umbral doble 0.78/0.86 | N-1 |
| `WS-NV4` | Narrativas · novedad | M | narratives-facets.ts: detectFacets() + quantile() puros con tests | — |
| `WS-NV5` | Narrativas · novedad | S | DDL narrative_facets / narrative_facet_mentions / narrative_lineage + ALTER narratives (self-heal idempotente) | N-3 |
| `WS-NX1` | Narrativas · experiencia | M | Vocabulario de estados como contrato compartido | — |
| `WS-NX2` | Narrativas · experiencia | S | Contrato de nulos y limpieza de formateo | — |
| `WS-NX3` | Narrativas · experiencia | S | Píldora de estado fechada y cabecera de detalle reordenada | N-A, N-B |
| `WS-NX4` | Narrativas · experiencia | L | Lista maestra: secciones, orden por aceleración, sparkline con escala compartida | N-A |
| `WS-NX5` | Narrativas · experiencia | M | Serie temporal densa en la API (huecos y no clasificados) | — |

### Fase 3 — Accesibilidad

Objetivo **WCAG 2.1 AA**. El contraste ya está casi cerrado por la siembra de
tokens; lo que queda es lo estructural.

| id | Tam | Qué |
|---|---|---|
| `WS-A1` | L | **Contrato de accesibilidad de gráficas.** Hoy los 9 SVG de `charts.js` tienen **cero** `<title>`, `role` o `aria-*`, y **cero** foco por teclado: para un lector de pantalla ninguna gráfica de ECO existe, y para quien no usa ratón el tooltip —la única superficie con las cifras exactas— es inalcanzable. Ver `WS-G8` en el rediseño de charts. |
| `WS-A2` | M | **369 áreas táctiles bajo 44px en móvil.** Barrido con `.touch-target` (ya está en `tokens.css`) sobre chips, toggles, botones de icono, botones de paginación, celdas de heatmap y filas de `HBarList`. |
| `WS-A3` | M | **18 atributos ARIA en ~7,000 líneas.** Nombres accesibles en los controles de icono, `aria-current` en la navegación, `aria-live` en los toasts y en los estados de carga, `aria-expanded` en los popovers, y roles correctos en los drawers y modales. |
| `WS-A4` | S | **Interacción sólo-hover.** 18 sitios usan `onMouseEnter`/`:hover` como único camino a la información; en táctil son inalcanzables. Duplicar en `focus` y en tap. |
| `WS-A5` | S | **La pantalla de error.** El `EcoErrorBoundary` muestra un stack trace crudo. Ya hereda el tema (§2.4); ahora necesita un mensaje humano, el stack detrás de un `<details>`, y una acción de recuperación que no sea `location.href`. |

### Fase 4 — Los sistemas, el cuerpo del trabajo

La mayor parte del valor visible para el analista. Cada unidad es independiente de las otras.

*36 workstreams*

| id | Unidad | Tam | Qué | Depende de |
|---|---|---|---|---|
| `WS-D6` | Gráficas · doctrina | L | BandScale: una primitiva para crisis, BHI, polarización y NSS con rótulos en el umbral | — |
| `WS-D7` | Gráficas · doctrina | L | Color de dato: --cat-* para categorías, --seq-* para magnitud, leyendas generadas del mismo colorFn | — |
| `WS-D8` | Gráficas · doctrina | XL | Contrato de accesibilidad de gráficas (ChartFigure + ChartDataTable + teclado) | WS-G1 |
| `WS-D9` | Gráficas · doctrina | M | StackedAreaChart: contestar la pregunta correcta (mezcla vs volumen) | WS-G1 |
| `WS-D10` | Gráficas · doctrina | M | PRMap: área proporcional, leyenda de tamaño y puente de tokens | — |
| `WS-D11` | Gráficas · doctrina | M | Retirar los tres histogramas sintéticos del drill-down | — |
| `WS-D12` | Gráficas · doctrina | M | Área real en la vista de tópicos (o renombrar la vista) | — |
| `WS-C7` | Gráficas · charts.js | M | BulletChart + retiro de las 5 barras de banda ad-hoc | WS-G2 |
| `WS-C8` | Gráficas · charts.js | M | Sparkline, BarList, SplitBar, Donut sobre el contrato nuevo | WS-G3 |
| `WS-C9` | Gráficas · charts.js | M | AreaStackChart con modos zero/center/expand — absorbe StackedAreaChart y el streamgraph | WS-G5 |
| `WS-C10` | Gráficas · charts.js | M | MatrixHeatmap + CalendarHeatmap | WS-G6 |
| `WS-C11` | Gráficas · charts.js | S | GeoMap: tokens en el tooltip de Leaflet y contrato series+scale | WS-G4 |
| `WS-C12` | Gráficas · charts.js | L | Migrar los 11 sitios de llamada + borrar el andamio legacy | WS-G5, WS-G7, WS-G8, WS-G9, WS-G10, WS-G11 |
| `WS-C13` | Gráficas · charts.js | M | SmallMultiples + SlopeChart | WS-G12 |
| `WS-M9` | Menciones · pantalla | L | story_id persistido, backfill e índice vectorial | W7 |
| `WS-M10` | Menciones · pantalla | M | Exportar respetando filtros (CSV servidor) | W1 |
| `WS-M11` | Menciones · pantalla | L | Vistas guardadas, vista→alerta y estado de lectura | W3 |
| `WS-M12` | Menciones · pantalla | M | Semántica de primer nivel, impacto/audiencia y densidad | W2 |
| `WS-W6` | Nube · backend | L | Minería del diccionario de frases + refresco de formas | WC-4 |
| `WS-W10` | Nube · backend | S | Observabilidad: lag del índice y alarma | WC-4, WC-7 |
| `WS-R7` | Nube · render | S | Animación de entrada y FLIP con tokens exactos | WC-3 |
| `WS-R9` | Nube · render | S | Estados vacío / insuficiente / error / sin baseline | WC-4 |
| `WS-R10` | Nube · render | S | Comportamiento móvil (≤768px) y táctil | WC-4 |
| `WS-ND5` | Narrativas · detección | M | Reactivar la asignación: THRESHOLD 0.70 + revival de dormant en 2 etapas | N1 |
| `WS-ND6` | Narrativas · detección | M | revived alcanzable y sticky + lifecycle en un solo statement | N5 |
| `WS-ND7` | Narrativas · detección | M | Observabilidad EMF + alarmas CloudWatch | N2 |
| `WS-ND8` | Narrativas · detección | S | Sanear drift de configuración y documentación | — |
| `WS-NV6` | Narrativas · novedad | L | Lambda eco-narrative-facets: escaneo, naming Bedrock, persistencia | N-4 |
| `WS-NV7` | Narrativas · novedad | M | Backtest y calibración del grid de umbrales (27 configuraciones, 60 días) | N-5 |
| `WS-NV8` | Narrativas · novedad | M | Señales agregadas baratas: new_actors, platform_shift, geo_shift, tone_shift | N-1 |
| `WS-NV9` | Narrativas · novedad | L | Genealogía: spawn/split desde facets promovibles + merge_candidate diario | N-5 |
| `WS-NX6` | Narrativas · experiencia | XL | NarrativeTrajectory: columnas apiladas desde cero + cinta de hitos | N-E |
| `WS-NX7` | Narrativas · experiencia | L | Riel de novedades con presupuesto de señal | N-A, N-D |
| `WS-NX8` | Narrativas · experiencia | XL | Retirar el force-graph y construir Línea de vida + Procedencia | N-A |
| `WS-NX9` | Narrativas · experiencia | M | Colapso de vacíos y unificación de copia | — |
| `WS-NX10` | Narrativas · experiencia | L | Móvil: detalle como ruta propia y drawer como hoja inferior | N-D |

### Fase 5 — Pulido y lo que queda bloqueado

Incluye lo que depende de que otra cosa exista primero — por ejemplo la nube de palabras del lado de `charts.js` está bloqueada por el endpoint `/api/eco-terms`.

*13 workstreams*

| id | Unidad | Tam | Qué | Depende de |
|---|---|---|---|---|
| `WS-D13` | Gráficas · doctrina | S | Alertas: eje temporal completo en 'Activaciones por día' | — |
| `WS-D14` | Gráficas · doctrina | M | Limpieza: un solo suavizado, un solo estado vacío, ids de SVG por instancia | WS-G1 |
| `WS-C14` | Gráficas · charts.js | L | TermsChart + WordCloud (nubes de palabras) — bloqueadas por /api/eco-terms | WS-G12 |
| `WS-W11` | Nube · backend | M | P2: emoji, trigramas y conmutador de ponderación | WC-6, WC-7 |
| `WS-R11` | Nube · render | S | Verificación: script de contraste + pruebas de determinismo y desborde | WC-1, WC-2 |
| `WS-ND9` | Narrativas · detección | M | Índices vectoriales: HNSW en candidates y mentions, decidir sobre narratives.centroid | N4 |
| `WS-ND10` | Narrativas · detección | L | Experimento: embeddings sobre nlp_summary + topics | N2 |
| `WS-ND11` | Narrativas · detección | XL | HDBSCAN + jerarquía para genealogía de narrativas | N2 |
| `WS-NV10` | Narrativas · novedad | L | Alertas narrative_novelty reusando alert_rules/alert_history + digest en el correo Diario | N-6 |
| `WS-NV11` | Narrativas · novedad | S | Drift diario con historia (prev_drift_score/prev_keywords) y flag reframed | N-1 |
| `WS-NV12` | Narrativas · novedad | L | Exponer los ejes, facets y lineage en la API y la SPA (bloque 'Nuevo dentro de esta narrativa') | N-9 |
| `WS-NX11` | Narrativas · experiencia | S | Borrar la implementación Next.js y las rutas duplicadas | N-A, N-B, N-L |
| `WS-NX12` | Narrativas · experiencia | M | Empty states de 0, 3 y 180 narrativas | N-D |

### Secuencia recomendada

```
Semana 1   Fase 0 completa (9 WS, todos S/M, independientes)
           └─ el producto deja de mostrar datos inventados
Semana 1-2 WS-ND1..ND4 (ventana del pool + purga + eps por percentil)
           └─ narrativas vuelve a detectar en horas, no en días
           WS-F1 + WS-F2 (retirar los 103 hex, reconciliar tokens)
           └─ cierra los 184 fallos de contraste restantes
Semana 2-3 WS-C1 (núcleo de charts: nulos, escalas, ticks)
           └─ desbloquea todo lo demás de gráficas
           WS-W1..W3 (mention_terms + /api/eco-terms)
           └─ desbloquea la nube de palabras
Semana 3-5 Fase 2 en paralelo: gráficas P0 · Menciones P0 · Narrativas P0
Semana 5+  Fase 1 restante (sistema) + Fase 4 (sistemas P1) + Fase 3 (a11y)
Después    Fase 5
```

**El orden importa en tres puntos y sólo en tres:**

1. **La purga de candidatos va DESPUÉS del deploy del filtro de ventana.**
   `exec-write` acepta una sola sentencia, así que son cuatro llamadas (una por
   agencia: gobernadora 55,910 · ddecpr 11,367 · sgpr 2,860 · aaa 2,631) con
   `rowCount` verificable. Si se purga antes, el query de no-asignadas sin
   filtro de fecha lo reencola todo a 5,000 por corrida en ~5.5 horas.
2. **`WS-C1` antes que cualquier otro workstream de gráficas.** Es el núcleo que
   define el contrato de nulos y escalas; sin él, cada arreglo de gráfica
   reinventa el suyo.
3. **`WS-W1` (la tabla `mention_terms`) antes que la nube.** Medido: extraer
   términos en caliente tarda 34 s para 2,290 menciones porque el 90% del coste
   es parsear el texto. Con el `tsvector` ya calculado, la agregación sobre
   1.26 M lexemas baja de 1 s.

### Cómo verificar que funcionó

El harness de esta auditoría es reproducible y es la forma de no discutir de
opiniones:

- **Contraste y áreas táctiles**: las sondas WCAG sobre las 40 capturas
  (10 rutas × 1440/1280/768/390). Criterio: **0** instancias bajo AA (hoy 184) y
  **0** áreas táctiles bajo 44px en móvil (hoy 369).
- **Honestidad de gráficas**: de los 34 sitios de llamada inventariados, los 11
  que hoy codifican mal la magnitud tienen que pasar a **0**.
- **Un solo número**: el total de menciones del KPI, del badge, del enlace y del
  modal tiene que coincidir al dígito. Hoy difiere 13% en producción (47 vs 54).
- **Narrativas**: `created_at` de la narrativa más nueva a menos de **24 h** de
  `MAX(published_at)` de su cluster (hoy el retraso es de 1 a 7 días), y
  `assigned > 0` en las corridas (hoy es 0 en todas).
- **Nube de palabras**: los 10 términos del top no pueden ser los términos del
  propio boolean de Brandwatch. Hoy, para gobernadora a 365 días, los seis
  primeros por frecuencia cruda son exactamente eso (`gonzález` 36,649 ·
  `jenniffer` 34,819 · `gobernadora` 33,803 · `colón` · `puerto` · `rico`) más
  basura de plataforma (`https`, `com`, `www`, `photos`). Con log-odds y prior
  de Dirichlet la misma consulta devuelve en 2.06 s *sequía, emergencia, agua,
  embalse, Guardia Nacional, orden ejecutiva, Carraízo* — la noticia real de la
  semana.

### Lo que decide el cliente, no el equipo

Tres decisiones están fuera del alcance técnico y las dejo abiertas a propósito:

1. **El color de marca.** La colisión `--accent === --neg` tiene dos soluciones
   válidas: la sembrada (mover `--neg` a `#FF5470` y conservar el naranja como
   identidad) o la que propone la unidad de color (mover `--accent` al azul
   `#58A6FF`, ΔE 116, realineando con el favicon cian que ya existe).
2. **Retirar `costa` y `gaceta`.** Se ganan ≈118 líneas de CSS, 13 overrides y
   14 ramas de JS, y los tokens pasan a `:root` incondicional. Se pierde la demo
   de tres temas, que puede tener valor comercial.
3. **La curva de la tendencia.** La doctrina recomienda *small multiples* con eje
   compartido en lugar de las tres líneas superpuestas. Conserva el suavizado
   que pediste, pero cambia la forma de la card más visible del producto.
