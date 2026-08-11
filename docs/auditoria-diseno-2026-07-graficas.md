# Gráficas — doctrina y rediseño de `charts.js`

Apéndice de [`auditoria-diseno-2026-07.md`](auditoria-diseno-2026-07.md). Dos especificaciones: la **doctrina** (qué gráfica para qué pregunta y qué está permitido) y el **rediseño** de las nueve primitivas con una API unificada.

---

# Doctrina de codificación visual de datos de ECO (gráficas: qué gráfica para qué pregunta, y qué está permitido)

## Resumen

ECO no tiene una doctrina de gráficas: tiene nueve primitivas con nueve APIs distintas (unas reciben `accessor`, otras `keys`, otras `series`, otras `items`+`labelKey`), dos de ellas muertas (`RadialGauge`, `linePath`: cero sitios de llamada), tres implementaciones distintas de suavizado (`catmullRomPath` en charts.js:20, `smoothLinePath` en :52, `smoothPath` en screens.js:4644) y ningún contrato común de eje, nulos, leyenda, estado vacío ni accesibilidad. La consecuencia no es estética: de los 34 sitios de llamada que inventarié, **11 codifican mal la magnitud** — es decir, el canal visual más fuerte (posición, longitud, área) no representa la cifra que el lector cree estar leyendo. El caso más grave está en la primera pantalla que abre el cliente: `OverviewTendencia` (screens.js:4344) normaliza cada serie a su propio min/max, así que con los datos actuales de DDEC el 27 de julio dibuja *positivo* (38 menciones) un 40% más arriba que *negativo* (38 menciones) — el mismo número, cuarenta puntos de altura de diferencia — y una variación real de 3 menciones (35→38) ocupa el 40% del alto del gráfico. El conflicto con el gusto del usuario ("me gustaban las líneas suavizadas") es real pero es resoluble sin mentir: el suavizado es una decisión de *render* (legítima si la curva pasa por cada punto y los puntos están marcados, como ya ocurre), mientras la escala es una decisión de *verdad*; lo que hay que separar no es la curva del dato, es una serie de otra. Recomiendo small multiples con dominio Y compartido y eje rotulado (`SeriesPanels`, tres paneles de 64px, ~214px totales contra los 240px de hoy), que elimina el cruce, conserva las curvas suaves y los rellenos, y cabe mejor en 390px que el gráfico actual. Segundo hallazgo transversal: no existe distinción entre **hueco de datos y cero real** — `screens.js:463` hace `t.polarizationIndex ?? 0` y el sparkline de Polarización del Scorecard muestra dos caídas a pico hasta el suelo que el lector lee como "la polarización se desplomó" cuando el dato simplemente no existe (4 de 30 puntos son `null` en el payload); con el incidente de ingesta de julio (tres días sin ingestar para SGPR y Gobernadora) esto significa que una falla de pipeline se pinta como silencio ciudadano. Tercero: el color de dato y el color de veredicto comparten hex; en `/dashboard`, "Noticias" es verde (`--pos`) a 300px de barras donde verde significa "positivo", y "Foros" cae al fallback `var(--accent)` que es idéntico al de "X / Twitter": dos barras del mismo color para dos plataformas distintas. Cuarto: cero de los nueve SVG de `charts.js` tiene `<title>`, `role`, `aria-*` o foco por teclado — para un lector de pantalla ninguna gráfica de ECO existe, y para un usuario que no usa ratón el tooltip (única superficie con las cifras exactas del día) es inalcanzable. La especificación entrega: inventario con veredicto por sitio de llamada, el diseño completo de la solución a F2 con las tres alternativas evaluadas y el código de la primitiva nueva, la tabla de reglas duras pregunta→permitida→prohibida, la doctrina de eje y escala (incluido el contrato de huecos con el SQL real sobre `mentions.ingested_at`), la doctrina de color enganchada a los tokens `--cat-*`/`--seq-*`/`--crisis-*` que ya especificó la unidad de fundaciones, y el contrato mínimo de accesibilidad de gráficas. Sin librerías nuevas: la restricción de arquitectura (JSX plano, sin bundler) no es el obstáculo — el andamiaje que falta son ~250 líneas compartidas, menos que el adaptador que exigiría cualquier librería de charts con tokens CSS y tabla accesible.

> **Alcance de esta unidad.** Las reglas que deciden **qué gráfica se usa para qué pregunta** y **qué está permitido**. No repito los hallazgos de `docs/auditoria-diseno-2026-07*.md` (los referencio por id: OV-xx, SC-xx, GEO-xx, AL-xx, F1–F15); construyo encima. Rutas absolutas: worktree `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit`, SPA en `<WT>/apps/web/public/eco-prototype/`.
>
> **Estado del worktree cuando escribí esto:** HEAD = `a69ea2e`, `charts.js` sin cambios contra HEAD. `tokens.css` YA existe y YA define `--cat-*`, `--emo-*`, `--narr-*`, `--seq-*`, `--div-*`, `--chart-grid`, `--chart-axis`, `--chart-crosshair`, `--chart-void`. `charts.js` consume **cero** de ellos. Donde los nombres de `tokens.css` (`--narr-*`, `--cat-1..8`) y los de `docs/auditoria-diseno-2026-07-fundaciones.md` (`--nar-*`, `--cat-1..5` + `--cat-other`) difieren, esta doctrina se alinea con **fundaciones**, que es el documento posterior y el que trae las mediciones de contraste y ΔE. Hay que reconciliar los dos: ver Riesgos.

---

# 0 · Restricción de arquitectura: veredicto sobre librerías

La SPA es JSX plano transpilado por `apps/web/scripts/compile-prototype.js` y cargado con `<script>` desde `index.html:1300-1301` (React 18.3.1 UMD). Precedente de CDN con `integrity` ya existe: Leaflet (`index.html:14-15`).

**Veredicto: ninguna librería nueva.** Evaluación honesta de las tres opciones que el brief permite:

| Opción | Candidato real | Por qué NO |
|---|---|---|
| (b) CDN con integrity | **Chart.js 4** (~200KB), **ECharts** (~1MB) | Renderizan a `<canvas>`: no hay nodos DOM que etiquetar, así que el contrato de accesibilidad de §6 (title/desc/tabla/foco por punto) habría que construirlo **igual, por fuera**. Y no leen custom properties: cada color de serie exige un puente `getComputedStyle` que se re-ejecuta en cada cambio de modo. Chart.js además no sabe distinguir hueco de cero sin `spanGaps:false` + `null` explícito, que es exactamente el contrato que hay que escribir de todos modos. |
| (b) CDN, sin dependencias | **uPlot** (~47KB, 0 deps) | Es lo mejor técnicamente (rápido, ejes correctos, `null` = hueco nativo) pero también es canvas → misma pérdida de a11y, y su modelo de datos (arrays paralelos `[x[], y1[], y2[]]`) obliga a un adaptador para los cuatro shapes distintos que hoy circulan (`series`, `keys`, `items`, `accessor`). |
| (a) archivo propio embebible | **d3-scale + d3-shape** sueltos (~12KB) | Tentador: sólo escalas y generadores de path, salida SVG, encaja con la arquitectura. Pero son ESM; en UMD hay que servir los bundles `d3-scale.min.js` de un CDN y quedan como dos globals más. Lo que aportan (`scaleLinear`, `line().curve()`) son **60 líneas** de las 250 que hace falta escribir. |
| (c) a mano | — | **Elegido.** El déficit de ECO no es matemática de escalas: es que no hay *un* contrato. Lo que falta son ~250 líneas de andamiaje compartido (dominio, eje, nulos, leyenda, vacío, a11y) que cualquiera de las opciones anteriores obligaría a escribir **además** del adaptador. |

Corolario: `catmullRomPath` (charts.js:20) se queda — es correcto, pasa por cada punto y ya está escrito. Lo que se borra es la duplicación: `smoothLinePath` (charts.js:52, un único consumidor: `Sparkline`) y `smoothPath` (screens.js:4644, misma matemática Catmull-Rom con tensión 1/6) pasan a llamar a `catmullRomPath`. Y se borran los dos muertos: `linePath` (charts.js:38, **0 sitios de llamada**) y `RadialGauge` (charts.js:638, **0 sitios de llamada** — el `max = 3` de F15 es un defecto en código muerto: no se arregla, se elimina).

---

# 1 · Inventario crítico por sitio de llamada

Verificado con `grep -o "<Componente"` sobre `screens.js`+`shell.js`+`app.js`+`chat-drawer.js`: `Sparkline` 1, `AreaLineChart` 1, `MultiLineChart` 3, `StackedAreaChart` 1, `Donut` 1, `HBarList` 2, `RadialGauge` **0**, `Heatmap` 1, `PRMap` 1. Los otros 24 sitios son gráficas **hechas a mano en `screens.js`/`shell.js`** que no usan ninguna primitiva — parte del problema.

Leyenda de veredicto: **✔** correcta · **⚠** subóptima (responde la pregunta pero mal) · **✘** deshonesta (el canal visual contradice el dato).

## 1.1 Scorecard (`/dashboard`)

| # | Sitio | Pregunta del usuario | Gráfica usada | Veredicto | Defecto de codificación exacto |
|---|---|---|---|---|---|
| 1 | `screens.js:430` → `126` | ¿Cómo viene el NSS? | `Sparkline` (área rellena) de `D.TIMELINE.map(t=>t.nss)` | **✘** | NSS es una magnitud **con signo** (−100..100) y `smoothLinePath` (charts.js:52-59) fija `min = Math.min(vals)`, así que el relleno arranca en el mínimo de la ventana, no en 0. En `dashboard-desktop-fold.png` el área de NSS se lee como "cantidad de sentimiento" y el acantilado de la derecha es el mínimo de la ventana, no un cruce a negativo. `fill` debe ser `false` para toda serie con signo. |
| 2 | `screens.js:452` | ¿Cuánto volumen hubo? | `Sparkline` de `totalMentions` | **⚠** | Base = min de la ventana (no 0) y sin dominio impreso. Para un conteo el cero es obligatorio (§4.1). |
| 3 | `screens.js:463` | ¿Cómo viene la polarización? | `Sparkline` de `t.polarizationIndex ?? 0` | **✘ P0** | **El `?? 0` convierte huecos en ceros.** El payload de `/api/eco-data` trae `polarizationIndex: null` (4 de 30 puntos en el fixture vigente `fixtures/eco-data.json`). En `crop-mob-chart.png` se ven dos caídas verticales al suelo dentro de la serie morada: el lector lee "la polarización se desplomó ese día". No hay dato. |
| 1-3 | `screens.js:126` + `charts.js:97` | — | `Sparkline width={200}` **fijo, sin `viewBox`** | **✘ P0 (nuevo)** | El root de `KpiCard` tiene `overflow:'hidden'` (screens.js:81). Medido por píxel en `crop-mob-chart.png` (390px, DPR 2): borde izq. de la card en x=24, borde der. en x=376-377 → card 176 CSS px; con `padding:18` el content box mide **140 CSS px**. El SVG pide 200 → **se recortan 60px = 30% de la serie**, o sea los últimos ~9 de 30 días, **los más recientes**, sin ninguna señal. El PR #87 dio `useChartWidth` a los charts grandes y **no** a `Sparkline`. |
| 4 | `screens.js:459` → `611` `BrandHealthMini` | ¿En qué banda está la salud? | 4 segmentos + 5 rótulos | **✘** | Dos defectos apilados: (a) el último segmento es `var(--accent)` ≡ `var(--neg)` — la banda FUERTE se pinta del mismo rojo que CRÍTICO (ver fundaciones §2.1-A); (b) los rótulos `1 / 4.6 / 6.4 / 8.2 / 10` van en un flex `space-between` (screens.js:641), así que caen en 0/25/50/75/100% mientras las fronteras reales de los segmentos (`flex: to-from`) están en 40/60/80%. **"4.6" está impreso 15 puntos a la izquierda de donde empieza esa banda.** |
| 5 | `screens.js:444` | ¿Estoy en crisis? | barra de gradiente `CRISIS_GRADIENT` + marcador + 4 rótulos | **✘ P0** | Mismo error de rótulos, medido: los cortes reales son 25/40/60 (`screens.js:34`) y los rótulos van `space-between` → 0/33/66/100%. En `overview-mobile.png` medí el marcador en **41.1%** del ancho de la barra y el rótulo "ALERTA" centrado en **65.5%**: el titular dice *Alerta* y el marcador parece apenas pasar *Elevado*. El rótulo está 24 puntos porcentuales fuera de su umbral. |
| 6 | `screens.js:467` | ¿Cuánta polarización? | barra de gradiente + 4 rótulos | **✘** | Igual, **y además la escala no coincide con su propio modal**: la card usa 3 zonas (0-30 `--text-3`, 30-60 `--warn`, 60-100 `#8B5CF6`) y `shell.js:1589` usa 4 (0-30, 30-50, 50-75, 75-100). La misma métrica tiene dos definiciones de dónde empieza "ALTA" a un clic de distancia. |
| 7 | `screens.js:508` | ¿Cómo evolucionaron hasta 3 métricas? | `MultiLineChart` sin `sharedScale` ni `yDomain` | **✘ P0** | Ver F2/§2. Con 1 serie activa (default `['totalMentions']`) el área se rellena desde el mínimo: en `/tmp/dash-sources.png` la meseta del gráfico es el mínimo de la ventana, no cero, y el relleno (canal de **área** = magnitud) descansa sobre una base recortada. Cero rótulos de eje Y en 5 gridlines. Etiquetas X colisionadas en pares ("28 jun 29 jun", "26 jul 27 jul"). Tag de último valor recortado (F1, visible en `zz-tag.png` como caja gris vacía). Ver también SC-06. |
| 8 | `screens.js:542` | ¿De dónde sale la conversación? | `HBarList` | **⚠** color **✘** | Barras horizontales ordenadas es la gráfica **correcta** para "cuál es mayor". Los defectos son de color (§5.1) y de referencia: `_max = max(items)` (charts.js:608) → la primera barra siempre llena el 100% del track y no hay eje ni porcentaje, así que "Noticias 452" puede ser el 34% o el 90% del total y el gráfico no lo dice. |
| 9 | `screens.js:684` → `649` `HourActivityCard` | ¿A qué hora se habla? | `Heatmap` 24×7 | **⚠ + ✘ leyenda** | Heatmap es correcto para hora×día. Defectos: (a) `colorFn` arranca en `rgba(255,106,61,0.08)` (screens.js:688) → **una franja con 0 menciones se pinta**; en `zz-mob-heat3.png` el bloque de 0-5h se lee como color, no como vacío; (b) leyenda con `rgba(11,95,128,…)` = azul de `costa` (F6, screens.js:674) contra celdas naranja; (c) celdas de 14px que en móvil se comprimen a ~11 CSS px (`flex-shrink` por defecto sobre un `width` fijo) → objetivo táctil 11×11 contra el mínimo de 44. |
| 31 | `shell.js:1328-1357` (abierto desde 7, 9, 10, 11, 14, 18) | ¿Cómo se distribuyó dentro del día? | histograma de barras a mano | **✘ P0 — el peor del producto** | Los valores **no son datos**: `screens.js:272-275`, `1574-1577` y `2003-2007` los generan con `Math.sin((h-10)/24*Math.PI)*0.5+0.5` (la tercera réplica añade `jitter` determinista para romper la simetría). Es una curva senoidal presentada como distribución horaria, en el modal al que llevan **todos** los clics de todas las gráficas. Además los `xLabels` se muestrean en 5 índices fijos con `justify-content: space-between` (shell.js:1350-1355): las etiquetas caen en 0/25/50/75/100% del contenedor mientras las barras que nombran están en (i+0.5)/N → media barra de desfase en los extremos. |
| 32 | `shell.js:1714` (`MetricInsightModal`) | ¿Dónde está esta métrica en su escala real? | `MultiLineChart` con `yDomain` absoluto | **✔ el único uso ejemplar** | Es el **único** sitio que declara dominio (`[0,1]` crisis, `[1,10]` BHI, `[0,100]` polarización, `[-100,100]` NSS) y por eso es el único que rotula el eje Y (charts.js:306-317). El comentario de shell.js:1718-1722 explica exactamente por qué. **Este es el patrón que hay que generalizar, no la excepción.** |
| 33 | `shell.js:1736-1748` | ¿Qué tópicos empujan la métrica? | barra + % por fila | **✔** | Denominador declarado (`share`), orden por valor, número presente. |

## 1.2 Overview (`/overview`)

| # | Sitio | Pregunta | Gráfica | Veredicto | Defecto |
|---|---|---|---|---|---|
| 23 | `screens.js:4187` `OverviewTermometro` | ¿Cuánto de cada sentimiento? | 3 cards con número + % + delta | **✔** | Números grandes, % del total, delta con base declarada en el eyebrow ("vs ventana previa"). El punto de categoría naranja y el delta naranja comparten hex (fundaciones §5.3). |
| 24 | `screens.js:4295` | ¿Estoy en crisis? | igual que #5 | **✘** | Mismo `CRISIS_GRADIENT`, mismos rótulos fuera de umbral. |
| **25** | **`screens.js:4344`** | **¿Está subiendo lo negativo?** | **`MultiLineChart` per-series, `smooth`** | **✘ P0 — caso F2, §2** | Aritmética completa en §2.1. |
| 26 | `screens.js:4360` `DistributionBar` | ¿Cómo se reparte cada tópico? | barra 100% apilada | **✔** | Correcta: la pregunta es composición, el total va en su propia columna. Único detalle: el residuo de redondeo se descarga siempre en `positivo` (`posPct = 100 - negPct - neuPct`, screens.js:4364). |
| 25b | `charts.js:259-275` (tira-leyenda del chart) | ¿Cuánto cambió? | valor + delta con flecha y color | **✘** | Tres defectos en 15 líneas: (a) `delta` se calcula contra `s.vals[0]`, el **primer punto de la ventana** — un cuarto baseline en una pantalla que ya tiene tres; (b) `color: delta>=0 ? --pos : --neg` (charts.js:270) colorea la **dirección**, no la valencia: en `overview-desktop.png` se lee "NEGATIVO 43.0 ▼ 8.5%" en rojo — la mejor noticia de la pantalla pintada como alarma, y 300px arriba la card "NEGATIVO 583 ▲+34%" aplica la regla contraria; (c) `delta >= 0` pinta `▲` verde sobre un 0.0% ("POSITIVO 36.0 ▲ 0.0%" en la captura). |

## 1.3 Sentimiento (`/sentiment`)

| # | Sitio | Pregunta | Gráfica | Veredicto | Defecto |
|---|---|---|---|---|---|
| 10 | `screens.js:1646` | ¿Cómo se reparte el sentimiento? | `Donut` 3 categorías | **⚠** | 3 categorías es el uso legítimo de una dona. Defectos: (a) `colors` se aplica **por índice** (`colors[i]`, charts.js:599) mientras la leyenda de al lado deriva el color **por nombre** (screens.js:1656) — si el API reordena `SENTIMENT_BREAKDOWN`, dona y leyenda se contradicen sin fallar; (b) sin `viewBox` (charts.js:585) → `size=110` fijo, no escala; (c) con el default de `data.js:70-74` (tres ceros) `sum=0` → `frac=NaN` → `d="M NaN NaN A …"`: el estado vacío es un SVG roto. |
| 11 | `screens.js:1683` | ¿Está subiendo lo negativo? | `StackedAreaChart` absoluto | **✘** | La pregunta del título ("Sentimiento en el tiempo") es por serie individual y el apilado absoluto es justo la codificación que **no** la responde: la banda de `negativo` va encima de dos bandas que se mueven, así que su altura se lee sobre una línea base móvil. En `sentiment-desktop-fold.png` el pico del 22 jul es inequívoco en el total y ambiguo en la parte: no se puede saber si subió lo negativo o subió todo. Además: 5 gridlines y sólo 3 rótulos (charts.js:502-515), tope sin redondear (`367`, `184`, `0`), y `pickIdx` (charts.js:479-484) ignora la Y → un clic en el cielo vacío abre el día. |
| 12 | `screens.js:1856-1890` `EmotionsCard` | ¿Qué emoción domina? | barras ordenadas | **⚠** | Barras ordenadas es correcto. Defectos: (a) denominador = suma de conteos **multi-etiqueta** recortada al top-7 → los "%" no suman sobre una base declarable; (b) piso visual `Math.max(2, pct)` (screens.js:1860) infla las menores; (c) color: `emotionColor()` (screens.js:1777) deja "Ira" (la dominante, 223) en el gris de fallback, visible en `sentiment-desktop-fold.png`. |
| 13 | `screens.js:1736-1748` | ¿Qué fuente/tópico/región es más negativa? | barras 100% apiladas por fila | **✘ subóptima** | La normalización a 100% es correcta para comparar *mezcla*, pero **el peso desaparece**: una fila con 66 menciones y otra con 446 se dibujan con la misma longitud. El subtítulo lo confiesa ("Distribución normalizada") y el conteo está en la fila, pero el canal fuerte (longitud) codifica algo que no es magnitud. Falta un canal de peso (ancho de fila proporcional, o segundo carril de volumen). |

## 1.4 Tópicos (`/topics`)

| # | Sitio | Pregunta | Gráfica | Veredicto | Defecto |
|---|---|---|---|---|---|
| 14 | `screens.js:2049` `TopicTreemap` | ¿Cuál tópico pesa más? | **no es un treemap** | **✘ P0** | `const span = i < 2 ? 2 : 1; const rowSpan = i < 2 ? 2 : 1;` (screens.js:2055-2056) con `gridAutoRows:'76px'` y `repeat(4,1fr)`: **el área la decide el índice, no el valor.** Con los datos vigentes, "Desarrollo económico" (253) y "Permisos y trámites" (213) tienen 4 celdas cada uno; "Empleo" (173) y "Agricultura" (53) tienen 1 celda cada uno — 173 y 53 ocupan **exactamente la misma área** mientras 253 y 213 (a 16% de distancia) ocupan 4×. El control se llama "Treemap" y el usuario asume área ∝ valor. |
| 15 | `screens.js:2115` `TopicBubbles` | ¿Cuál pesa más? | burbujas, `r = 30 + (count/max)*70` | **✘** | Radio **lineal** → el área (lo que el ojo integra) crece con el cuadrado: 253 vs 53 es una razón de 4.8 en valor y de **9.4 en área**. Y el piso `r=30` comprime: 53 → área 2827px², 253 → 31416px². Área correcta: `r = rMax*sqrt(v/vMax)`. |
| 16 | `screens.js:2206-2213` `TopicList` | ¿Cuál pesa más y cómo se reparte? | barra de longitud ∝ count, subdividida por sentimiento | **✔ la mejor de las tres vistas** | Longitud sobre base común (`t.count/max`), subdivisión por composición, número presente. Es la vista que debería ser el default, no la tercera pestaña. |
| 17 | `screens.js:2388` | ¿Cómo evolucionó este tópico? | `AreaLineChart` | **⚠** | Es la primitiva más sana (`min = Math.min(...vals, 0)` en charts.js:121 fuerza el cero; rotula 5 ticks de Y en :157-160). Defectos: (a) `id="area-grad-ac"` **constante** (charts.js:145) → dos instancias simultáneas comparten el degradado de la primera; (b) rotula la Y con `Math.round(t*10)/10` sin unidad ni tope redondeado; (c) `smooth` no opcional (bezier de tangente horizontal, distinto del Catmull-Rom del resto). |
| 18 | `screens.js:2446` `TopicCalendar` | ¿Qué dominó cada día? | calendario-heatmap semanal | **⚠ + contrato sin validar** | Codificación correcta (día = celda, color = sentimiento dominante, opacidad = volumen). Tres defectos: (a) `intensity = 0.3 + (volume/maxV)*0.7` (screens.js:2548) → **un día de volumen 0 se pinta al 30%**; (b) la opacidad se compone con concatenación de hex (`` `${color}${alpha}` ``, screens.js:2559) — eso **obliga** a `SENT_HEX` hardcodeado (screens.js:2454, que son el verde y el rojo de `costa`, no de `mando`): con tokens se rompería. Solución: `color-mix()`, ya usado en screens.js:626/1830/5566; (c) el componente asume **una fila por día** y no lo valida: en `topics-desktop.png` la página mide 7807px porque el fixture trae 168 filas para 28 días (6 por día) y el grid pinta 168 celdas con el mismo número de día repetido y las columnas de día de semana desalineadas. **Ojo: el SQL de producción (`apps/web/src/app/api/eco-data/route.ts:751-758`, `WHERE rk = 1`) sí devuelve una fila por día** — el 7807px es artefacto del fixture. El hallazgo real es que un componente que asume un contrato y no lo valida degrada catastróficamente en silencio. |

## 1.5 Geografía (`/geography`)

| # | Sitio | Pregunta | Gráfica | Veredicto | Defecto |
|---|---|---|---|---|---|
| 19 | `screens.js:2779` → `charts.js:731` `PRMap` | ¿Dónde se habla? | símbolos proporcionales sobre Leaflet | **✘** | `const r = 8 + (v / max) * 22` (charts.js:805): radio **lineal** con piso de 8px. Efecto doble: comprime abajo (1 mención → área 201px²) y exagera arriba (max → 2827px², razón de área 14:1 para razones de valor que pueden ser de 300:1). Y **no hay leyenda de tamaño**: la leyenda de screens.js:2785-2791 es un solo punto que dice "Volumen" (`geography-desktop-fold.png`), así que ningún círculo es legible como cantidad. En modo Sentimiento el radio pasa a `Math.abs(m.nss)` (screens.js:2781) y la leyenda no lo menciona: el mismo canal cambia de significado sin avisar. Ver GEO-01. |
| 20 | `screens.js:2799` | ¿Qué municipio manda? | `HBarList` | **✔** | Correcta. Sin eje/%, igual que #8. |
| 21 | `screens.js:2838-2841` | ¿Qué región está mejor o peor? | barra divergente desde el centro | **✔ concepto, ⚠ escala** | Divergente con cero marcado es exactamente la codificación correcta para NSS. Pero `pct = clamp(avgNss/10, -1, 1)` (screens.js:2815) fija un dominio implícito de ±10 sin rotularlo: un NSS de −12 y uno de −40 dibujan la misma barra. |

## 1.6 Narrativas y Alertas

| # | Sitio | Pregunta | Gráfica | Veredicto | Defecto |
|---|---|---|---|---|---|
| 27 | `screens.js:4929` → `4662` `NarrativeSparkline` | ¿Esta narrativa sube? | sparkline (3ª implementación de suavizado) | **⚠** | `max = Math.max(...data,1)`, base 0 ✔. Pero `preserveAspectRatio="none"` sobre `viewBox="0 0 64 18"` (screens.js:4670) → **deforma la pendiente** según el ancho del contenedor: la misma serie "sube más" en una columna ancha. |
| 28 | `screens.js:4680` `NarrativeGraph` | ¿Qué narrativas se relacionan? | grafo force-directed | **⚠** | `r = 7 + sqrt(count/max)*15` (screens.js:4774) — **el único sitio del producto que usa raíz**, correcto. Defectos: la posición no significa nada (es resultado de 220 iteraciones de simulación) y no se advierte; y `NARRATIVE_STATUS_COLORS[n.status] || 'var(--accent)'` (:4785) manda cualquier estado desconocido al naranja, que es casi el de "pico" (F7). |
| 29 | `screens.js:5237` `NarrativeStreamgraph` | ¿Cómo evolucionó esta narrativa? | streamgraph centrado (`wiggle`) | **✘** | Base **centrada** (`baseline = -total/2`, screens.js:5262): ninguna de las tres bandas descansa sobre una línea recta, así que ninguna se puede leer individualmente, y el total tampoco (hay que sumar arriba y abajo del centro). Un streamgraph es para 8+ series donde sólo importa la textura; con 3 series de sentimiento es una pérdida neta contra un apilado con base en cero. Cero rótulos de eje Y. |
| 22a | `screens.js:3374` | ¿Qué severidad predomina? | barras con `width: sev[k]/rows.length` | **✔** | Denominador = total de activaciones, declarado en el subtítulo. |
| 22b | `screens.js:3388` | ¿Qué regla se dispara más? | barras `n/ruleMax` en 90px | **⚠** | Base común pero track de 90px fijo: la resolución para 6 valores es de 15px por barra. Y el relleno es `var(--accent)` a 200px de barras donde `--accent`≡`--neg` significa "severidad alta" (fundaciones §2.1-J). |
| 22c | `screens.js:3403-3412` | ¿Cuándo se disparan? | columnas por día | **✘** | `days = Object.keys(byDay).sort()` (screens.js:3358): **sólo los días con eventos**, en columnas de ancho igual. Si hubo alertas el 3 y el 20 de julio, son columnas contiguas. Es un eje **categórico disfrazado de temporal**. Ver AL-07. |
| 30 | `screens.js:5563` `SentimentSplitBar`, `5840+` Radar | ¿Qué agencia está peor? | barras 100% / barras `crisis/maxCrisis` | **⚠** | `w = max(6, (a.crisis/maxCrisis)*100)` (screens.js:5844): normaliza al **máximo observado**, no al dominio real de la métrica (0-1), así que la agencia peor siempre llena la barra aunque esté en NORMAL. Con `yDomain`-equivalente (0-1) el muro diría la verdad. |

## 1.7 Resumen del inventario

- **34 sitios**. **11 deshonestos** (#1, #3, #4, #5, #6, #7, #14, #15, #19, #22c, #25, #29, #31 — trece contando los dos de la tira-leyenda y el histograma sintético), **12 subóptimos**, **9 correctos**, **2 primitivas muertas**.
- **Ningún sitio** declara la unidad de su eje.
- **Un solo sitio** (32, `shell.js:1714`) declara un dominio absoluto — y es el único con eje Y rotulado.
- **Ningún** SVG tiene `<title>`, `role` ni foco por teclado (verificado: `grep -c "<title" charts.js` → 0; `grep -n "aria\|role=" charts.js` → una sola línea, `role={clickable?'button':undefined}` en el div del heatmap).

---

# 2 · El caso F2 en detalle

## 2.1 La aritmética exacta

`OverviewTendencia` (screens.js:4306-4348) pasa tres series de conteos diarios a `MultiLineChart` **sin** `sharedScale` ni `yDomain`, así que cae en la rama por defecto (charts.js:220-227), que escala **cada serie a su propio min/max**.

Datos vigentes (`fixtures/overview.json`, DDEC 21–27 jul 2026, los mismos que sirve `/api/overview`):

| día | negativo | neutral | positivo |
|---|---|---|---|
| 21 jul | 41 | 75 | 51 |
| 22 jul | **181** | **109** | **59** |
| 23 jul | 150 | 90 | 49 |
| 24 jul | 71 | 42 | **23** |
| 25 jul | 36 | 62 | 42 |
| 26 jul | **35** | 48 | 32 |
| 27 jul | 38 | 57 | 38 |

Dominios que calcula la rama por defecto: negativo `[35, 181]` (rango 146) · neutral `[42, 109]` (rango 67) · positivo `[23, 59]` (rango 36).

Altura relativa que dibuja cada serie el **27 de julio** (`(v−min)/range`):

| serie | valor | altura dibujada |
|---|---|---|
| negativo | 38 | **2.1%** (casi en el suelo) |
| neutral | 57 | 22.4% |
| positivo | 38 | **41.7%** (la más alta) |

**Negativo y positivo valen exactamente lo mismo ese día (38 menciones) y se dibujan a 40 puntos de altura de distancia.** La serie más pequeña de la pantalla se pinta arriba de las otras dos. Y en el otro sentido: la variación real de negativo entre el 26 y el 27 (35→38, **tres menciones**) consume el 2% de altura mientras la de positivo (32→38, **seis menciones**) consume el 17% — el mismo gráfico da a 3 menciones más peso vertical que a 6.

La captura confirma el resultado con el draw anterior del mismo fixture (`shots/overview-desktop.png`, sección «03 · TENDENCIA»): la tira-leyenda dice `NEGATIVO 43.0 · NEUTRAL 54.0 · POSITIVO 36.0` y en el borde derecho la línea **verde (36)** está por encima de la **gris (54)** y de la **naranja (43)**. El menor arriba, el mayor abajo.

## 2.2 El conflicto es real, y lo que el usuario pidió no es lo que hace falta romper

El comentario de screens.js:4339-4343 lo documenta: *"petición explícita del usuario: 'me gustaba más como se veía antes… me gustaban las líneas suavizadas'. Con shared-scale, los picos grandes (ej. neg=203) comprimían las variaciones diarias normales en una banda plana al fondo."*

Hay que separar dos cosas que el código mezcló:

1. **Suavizado (Catmull-Rom)** = decisión de *render*. Es defendible mientras la curva pase por cada punto (lo hace: charts.js:20-36 es Catmull-Rom sin overshoot) y los puntos estén marcados (lo están: charts.js:349-361 dibuja un círculo por día). El único límite: **no se suaviza sobre un hueco** (§4.5). **Se conserva.**
2. **Escala por serie** = decisión de *verdad*. No tiene defensa: destruye la comparabilidad y amplifica el ruido.

Y la queja de "banda plana" merece una respuesta cuantitativa, porque es la palanca para convencer al cliente: con dominio compartido `[0, 200]` e `innerH = 178px` (240 − 28 − 34), **una mención = 0.89px**. Los tres días bajos de negativo (35, 36, 38) caen en 2.7px de recorrido — **porque son planos**: 3 menciones de diferencia. La escala por serie no revela variación; la **inventa**. Ese es el argumento que hay que ponerle por escrito al usuario.

Lo que sí es cierto es que un pico 4-5× el típico (181 contra una mediana de 41) aplana la lectura del día a día. Ahí es donde entra el diseño.

## 2.3 Las cuatro opciones, evaluadas

Evaluación contra: **honestidad** · **legibilidad a 390px** (el ancho real de plot en móvil es 270px: 366 − 32 de padding − 44 − 20) · **gusto del usuario** (curvas suaves, rellenos, sin retícula pesada).

### (a) Escala compartida en un panel + eje + banda de contexto

Un solo panel, `[0, niceCeil(max)] = [0,200]`, tres curvas, eje Y con 3 rótulos, y una banda gris al 6% que marca el rango típico (P25–P75 de 90 días) de la serie primaria.

- Honestidad: **alta**. Escala única, cero impreso, banda que da contexto histórico.
- 390px: **regular**. Tres curvas y tres rellenos superpuestos en 178px de alto; en `/tmp/ov4.png` (móvil, hoy) las curvas naranja y verde ya son indistinguibles en el pico y la gris queda **tapada** por el relleno de la primera serie. Comprimirlas más no mejora eso.
- Gusto: **alto** (es lo más parecido a hoy). Pero reintroduce exactamente la queja: positivo (23–59) vive en el 12-30% inferior del panel.
- Extra: la banda P25–P75 sólo existe hoy para las métricas del modal (`historicalP25/P75`, shell.js:1754); para las series de sentimiento habría que añadirla en `/api/overview`.

### (b) Small multiples: un panel por serie, misma altura, eje rotulado ⭐

Tres paneles apilados de 64px, un eje X compartido abajo, un crosshair único que recorre los tres, curvas Catmull-Rom con relleno suave, y las cifras exactas (mín / máx / último) en tipografía a la derecha de cada panel.

- Honestidad: **la más alta de las cuatro**. **El cruce es estructuralmente imposible** — dos series nunca comparten sistema de coordenadas. Y con dominio compartido `[0,200]` la comparación entre paneles sigue siendo válida porque comparten escala **y** está impresa.
- 390px: **la mejor**. 3 × 64 + 2 × 8 de gap + 18 de eje + 16 de leyenda = **214px**, menos que los 240 de hoy. Cada panel: 270px de ancho para 7 puntos = 38px por día (en escritorio, ~150px por día). Ninguna oclusión: cada serie tiene su propia línea base.
- Gusto: **alto**. Es *más* sparkline que hoy — paneles bajos, curvas suaves, rellenos que no se pisan, sin retícula (una sola línea base por panel). El usuario pidió "que se vea bonito y suave"; esto lo es, y encima es la única de las cuatro donde la curva de cada sentimiento se lee limpia.
- Coste: una primitiva nueva (~120 líneas, §2.5).
- Alturas reales con los datos vigentes, dominio `[0,200]`, panel 64px (`64 − v·0.32` px desde el techo del panel): negativo recorre 6.1→52.8 (**46.7px de amplitud**), neutral 29.1→50.6 (**21.5px**), positivo 45.1→56.6 (**11.5px**). El panel de positivo es una ondulación baja — que **es la verdad**: positivo se mueve entre 23 y 59 mientras negativo llega a 181.
- Escape hatch para el caso "quiero más amplitud" (documentado, no oculto): `scale="perPanel"` da a cada panel `[0, niceCeil(seriesMax)]` — positivo pasaría a `[0,60]` y su amplitud a **38px** — y **obliga** a imprimir el dominio en la esquina de cada panel (`esc. 0–60`) y a marcar con una línea punteada el nivel del máximo global. Sigue siendo honesto porque la escala está declarada por panel; deja de serlo si se omite el rótulo. Por eso el rótulo no es opcional en la implementación.

### (c) Área 100% apilada + línea de volumen total (dos carriles)

Carril 1: composición (0-100%). Carril 2: total diario.

- Honestidad: **alta**, y responde bien "¿cambió la mezcla?".
- 390px: **buena** (dos carriles de ~90px).
- Gusto: **medio-bajo**. Bloques planos de color, no curvas; y el usuario perdería la lectura directa de "cuántas menciones negativas hubo el martes" (tendría que multiplicar % × total).
- Veredicto: es la gráfica correcta para **otra** pregunta. Debería existir como *toggle* secundario ("Mezcla" / "Volumen"), no como reemplazo.

### (d) Índice base-100

Cada serie a 100 en el primer día de la ventana.

- Honestidad: **baja para este dato**. Con conteos que tienen cero natural, indexar oculta la magnitud (positivo 51 y negativo 41 arrancarían **iguales**, en 100) y es inestable con bases pequeñas: negativo 41→38 = 92.7 mientras positivo 51→38 = 74.5, y el lector concluye que positivo cayó tres veces más cuando ambos perdieron 3 y 13 menciones respectivamente. Además el día base es una elección arbitraria que cambia con el selector de periodo.
- Veredicto: **descartada**. El índice base-100 sirve para series de unidades distintas y sin cero comparable (precios, PIB). No para conteos de menciones.

### Matriz

| | honestidad | 390px | gusto | coste | veredicto |
|---|---|---|---|---|---|
| (a) compartida + banda | ●●●○ | ●●○○ | ●●●● | bajo | fallback |
| **(b) small multiples** | **●●●●** | **●●●●** | **●●●●** | medio | **RECOMENDADA** |
| (c) 100% + total | ●●●● | ●●●○ | ●●○○ | medio | toggle secundario |
| (d) base-100 | ●○○○ | ●●●○ | ●●○○ | bajo | descartada |

## 2.4 Cómo se ve la recomendación

Card `03 · Tendencia · Día a día`, subtítulo `Menciones por día · TZ Puerto Rico · escala común 0–200 · clic en un día para ver sus menciones`.

Debajo, tres franjas de 64px separadas por 8px. Cada franja:

- **Rótulo a la izquierda** en un canal de 40px: `NEG` / `NEU` / `POS` en overline de 11px, con el punto de color de la serie y su glifo (`▲` / `●` / `▼`) — para que el sentido no dependa del color.
- **Línea base** de 1px en `var(--chart-grid)` al pie de la franja (el cero). Ninguna otra retícula: una sola línea punteada horizontal, la del tope del dominio, con el rótulo `200` en `var(--chart-axis)` sobre la **primera** franja únicamente (el dominio es compartido, se imprime una vez).
- **Curva** Catmull-Rom de 2px en el color de la serie, con relleno del degradado propio al 18→0% de opacidad, y un punto de 2.5px por día.
- **A la derecha**, en un canal de 44px: el último valor en `.num` de 13px — **dentro** del área del SVG, alineado a la derecha, sin caja de color (así muere F1: la etiqueta ya no se dibuja en `innerW+4` con `padding.r = 20`).
- Bajo la franja de positivo, **un solo eje X** con hasta 7 fechas (`22 jul`, `24 jul`, …) más marcas de 3px por día cuando hay más de 14 días.

Interacción: un movimiento del ratón (o `ArrowLeft`/`ArrowRight` con el SVG enfocado) mueve **un** crosshair vertical que atraviesa las tres franjas y engorda el punto del día en cada una; la tira superior imprime `27 jul · NEG 38 · NEU 57 · POS 38` con los tres valores del **mismo** día. Un clic abre el `MentionsSliceModal` de ese día, igual que hoy.

En 390px: las franjas bajan a 52px y el canal de rótulo a 34px; el eje X pasa a 4 fechas; el canal del último valor se mantiene (es el que da precisión cuando la amplitud es baja).

Frente a hoy se pierde: nada. Se gana: el orden vertical de los tres sentimientos deja de ser una ficción, aparece el cero, aparece el tope de escala, la curva gris deja de estar tapada por el relleno naranja, y la card mide 214px en vez de 240.

## 2.5 Código

### Llamada nueva (sustituye `screens.js:4344`)

```jsx
      <div className="card-bd">
        {/* Small multiples: un panel por sentimiento, MISMO dominio [0, niceCeil(max)]
            y eje rotulado una vez. Sustituye la normalización por-serie de
            MultiLineChart, que dibujaba positivo (38) por encima de negativo (38).
            El suavizado Catmull-Rom y los rellenos se conservan (petición del
            usuario); lo que se separa es una serie de otra, no la curva del dato. */}
        <SeriesPanels
          data={chartData}
          series={[
            { key: 'negative', label: 'Negativo', short: 'NEG', glyph: '▼', color: 'var(--neg)',    ink: 'var(--neg-ink)' },
            { key: 'neutral',  label: 'Neutral',  short: 'NEU', glyph: '●', color: 'var(--neu)',    ink: 'var(--neu-ink)' },
            { key: 'positive', label: 'Positivo', short: 'POS', glyph: '▲', color: 'var(--pos)',    ink: 'var(--pos-ink)' },
          ]}
          kind="count"                /* fuerza dominio [0, niceCeil(max)] */
          scale="shared"              /* 'perPanel' exige rótulo de dominio por panel */
          unit="menciones por día"
          panelH={window.ecoIsMobile() ? 52 : 64}
          smooth
          onPointClick={onDayClick}
          title="Volumen de menciones por sentimiento, día a día"
          desc={`Tres paneles con escala común. Periodo ${chartData[0]?.date} a ${chartData[chartData.length-1]?.date}.`}
        />
      </div>
```

`chartData` no cambia (screens.js:4310-4317 ya produce `{date, fullDate, negative, neutral, positive, totalMentions}`).

### Núcleo compartido (nuevo en `charts.js`, antes de las primitivas)

```js
// ── NÚCLEO DE ESCALA Y NULOS ────────────────────────────────────────────────
// Un punto puede ser: número (dato), null/undefined (HUECO), NaN (error).
// 0 es un dato. Los nulos NUNCA se coercen a 0 (hoy: screens.js:463 `?? 0`).
const NUM = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Escalera de topes "bonitos": 200 en vez de 181, 400 en vez de 367.
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceCeil(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  return (NICE.find((s) => f <= s + 1e-9) ?? 10) * pow;
}

// Dominio por TIPO de magnitud. El tipo es obligatorio en toda llamada.
//   'count'   → [0, niceCeil(max)]                cero obligatorio
//   'signed'  → [-m, m] simétrico                 cero al centro
//   'bounded' → bounds declarados                 (0–1, 1–10, 0–100, -100–100)
//   'index'   → [min, niceCeil(max)] + MARCA DE CORTE obligatoria
function chartDomain(values, kind, bounds) {
  if (kind === 'bounded' && Array.isArray(bounds)) return bounds;
  const vals = values.map(NUM).filter((v) => v !== null);
  if (!vals.length) return [0, 1];
  const max = Math.max(...vals), min = Math.min(...vals);
  if (kind === 'signed') { const m = niceCeil(Math.max(Math.abs(min), Math.abs(max))); return [-m, m]; }
  if (kind === 'index') return [min, niceCeil(max)];
  return [0, niceCeil(max)];
}

// Parte una serie en tramos contiguos sin huecos. Un hueco NO se interpola:
// se dibuja como banda --chart-void y rompe el path.
function segments(data, key) {
  const out = []; let cur = null;
  data.forEach((d, i) => {
    const v = NUM(d[key]);
    if (v === null) { cur = null; return; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push({ i, v });
  });
  return out;
}
```

### `SeriesPanels`

```jsx
function SeriesPanels({
  data, series, kind = 'count', bounds, scale = 'shared', unit = '',
  panelH = 64, gap = 8, smooth = true, onPointClick, valueFormat,
  title, desc,
}) {
  const [ref, w] = useChartWidth(600);
  const uid = React.useId();
  const [hover, setHover] = React.useState(null);
  const [showTable, setShowTable] = React.useState(false);

  const isMob = window.ecoIsMobile();
  const pad = { l: isMob ? 34 : 40, r: 46, t: 4 };
  const axisH = 18;
  const innerW = Math.max(60, w - pad.l - pad.r);
  const step = innerW / Math.max(1, data.length - 1);
  const H = series.length * (panelH + gap) - gap + axisH + pad.t;

  if (!Array.isArray(data) || !data.length || !Array.isArray(series) || !series.length) {
    return <div ref={ref} className="chart-empty">Sin datos suficientes para graficar.</div>;
  }

  // Dominio: compartido (default) o por panel (exige rótulo propio).
  const shared = chartDomain(series.flatMap((s) => data.map((d) => d[s.key])), kind, bounds);
  const domainOf = (s) => (scale === 'shared' ? shared : chartDomain(data.map((d) => d[s.key]), kind, bounds));

  const fmt = valueFormat || ((v) => (v == null ? '—' : Math.round(v).toLocaleString('es-PR')));
  const hoverIdx = hover == null ? data.length - 1 : hover;

  function pick(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - pad.l) / step);
    return i >= 0 && i < data.length ? i : null;
  }

  return (
    <figure ref={ref} style={{ margin: 0, width: '100%' }}>
      {/* tira de valores: el MISMO día en las tres series */}
      <div className="chart-strip" aria-live="polite">
        <span className="t-overline">{data[hoverIdx].date}</span>
        {series.map((s) => (
          <span key={s.key} className="chart-strip-item">
            <i style={{ background: s.color }} aria-hidden="true" />
            <span className="t-overline">{s.short || s.label}</span>
            <b className="num">{fmt(NUM(data[hoverIdx][s.key]))}</b>
          </span>
        ))}
      </div>

      <svg width={w} height={H} role="img" aria-labelledby={`${uid}-t ${uid}-d`}
        tabIndex={0}
        onMouseMove={(e) => setHover(pick(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { const i = pick(e); if (i != null && onPointClick) onPointClick(data[i], i); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { setHover(Math.min(data.length - 1, hoverIdx + 1)); e.preventDefault(); }
          else if (e.key === 'ArrowLeft') { setHover(Math.max(0, hoverIdx - 1)); e.preventDefault(); }
          else if (e.key === 'Home') { setHover(0); e.preventDefault(); }
          else if (e.key === 'End') { setHover(data.length - 1); e.preventDefault(); }
          else if (e.key === 'Enter' && onPointClick) { onPointClick(data[hoverIdx], hoverIdx); }
          else if (e.key === 'Escape') setHover(null);
        }}
        style={{ display: 'block', cursor: onPointClick ? 'pointer' : 'crosshair' }}>
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{desc}</desc>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${uid}-g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {series.map((s, row) => {
          const [lo, hi] = domainOf(s);
          const top = pad.t + row * (panelH + gap);
          const y = (v) => top + panelH - ((v - lo) / (hi - lo || 1)) * panelH;
          const segs = segments(data, s.key);
          return (
            <g key={s.key}>
              {/* rótulo del panel: color + glifo + texto (nunca sólo color) */}
              <text x={0} y={top + 11} fontSize="11" fontWeight="700" fill={s.color}
                    fontFamily="var(--ff-sans)">{s.glyph} {s.short || s.label}</text>
              {/* línea base = cero */}
              <line x1={pad.l} y1={top + panelH} x2={pad.l + innerW} y2={top + panelH}
                    stroke="var(--chart-grid)" strokeWidth="1" />
              {/* tope de dominio: rotulado una vez si es compartido, por panel si no */}
              {(scale !== 'shared' || row === 0) && (
                <>
                  <line x1={pad.l} y1={top} x2={pad.l + innerW} y2={top}
                        stroke="var(--chart-grid)" strokeDasharray="2 3" />
                  <text x={pad.l - 6} y={top + 4} fontSize="11" textAnchor="end"
                        fill="var(--chart-axis)" fontFamily="var(--ff-numeric)">{fmt(hi)}</text>
                </>
              )}
              {/* huecos: banda explícita, el path no los cruza */}
              {data.map((d, i) => NUM(d[s.key]) === null ? (
                <rect key={`v${i}`} x={pad.l + (i - 0.5) * step} y={top} width={step} height={panelH}
                      fill="var(--chart-void)" />
              ) : null)}
              {segs.map((seg, si) => {
                const pts = seg.map((p) => [pad.l + p.i * step, y(p.v)]);
                if (pts.length === 1) return <circle key={si} cx={pts[0][0]} cy={pts[0][1]} r="2.5" fill={s.color} />;
                const line = smooth ? catmullRomPath(pts) : pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]},${p[1]}`).join(' ');
                const area = `M ${pts[0][0]},${top + panelH} ${line.replace(/^M /, 'L ')} L ${pts[pts.length-1][0]},${top + panelH} Z`;
                return (
                  <g key={si}>
                    <path d={area} fill={`url(#${uid}-g-${s.key})`} />
                    <path d={line} stroke={s.color} strokeWidth="2" fill="none"
                          strokeLinecap="round" strokeLinejoin="round" />
                    {pts.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r={seg[i].i === hoverIdx ? 3.5 : (data.length <= 14 ? 2.5 : 1.8)}
                              fill={s.color} stroke="var(--canvas)" strokeWidth={seg[i].i === hoverIdx ? 1 : 0} />
                    ))}
                  </g>
                );
              })}
              {/* último valor DENTRO del SVG (mata F1: ya no se dibuja en innerW+4) */}
              <text x={w - 4} y={y(NUM(data[data.length-1][s.key]) ?? lo) + 4} fontSize="13" fontWeight="700"
                    textAnchor="end" fill={s.color} fontFamily="var(--ff-numeric)">
                {fmt(NUM(data[data.length-1][s.key]))}
              </text>
            </g>
          );
        })}

        {/* un crosshair para los tres paneles */}
        {hover != null && (
          <line x1={pad.l + hoverIdx * step} y1={pad.t} x2={pad.l + hoverIdx * step}
                y2={pad.t + series.length * (panelH + gap) - gap}
                stroke="var(--chart-crosshair)" strokeWidth="0.75" strokeDasharray="3 3" />
        )}

        {/* eje X compartido, una sola vez */}
        {(() => {
          const maxL = Math.max(2, Math.floor(innerW / (isMob ? 64 : 84)));
          const n = Math.min(maxL, data.length);
          const seen = new Set();
          return Array.from({ length: n }, (_, i) => Math.round(i * (data.length - 1) / Math.max(1, n - 1)))
            .filter((i) => !seen.has(i) && seen.add(i) && data[i]?.date)
            .map((i) => (
              <text key={i} x={pad.l + i * step} y={H - 4} fontSize="11" textAnchor="middle"
                    fill="var(--chart-axis)" fontFamily="var(--ff-numeric)">{data[i].date}</text>
            ));
        })()}
      </svg>

      <figcaption className="chart-caption">
        {unit}{scale === 'perPanel' ? ' · escala independiente por panel' : ` · escala común 0–${fmt(shared[1])}`}
        <button className="chip" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? 'Ocultar datos' : 'Ver datos'}
        </button>
      </figcaption>
      {showTable && <ChartDataTable data={data} series={series} unit={unit} fmt={fmt} />}
    </figure>
  );
}
```

Notas de implementación: `maxL = innerW/84` (contra el `innerW/50` de charts.js:427) mata la colisión de fechas de F13 — `"28 jun"` mide ~46px en `--ff-numeric` a 11px, y 84 deja aire. `React.useId()` está disponible en el UMD de React 18.3.1 que carga `index.html:1301`, así que los `id` de degradado dejan de colisionar (hoy `charts.js:145` usa el literal `"area-grad-ac"`).

---

# 3 · Reglas duras: pregunta → gráfica permitida → gráfica prohibida

| Pregunta del usuario | Permitida | Prohibida | Por qué |
|---|---|---|---|
| ¿Cuántas menciones hubo cada día? | Línea o columnas con dominio `[0, niceCeil(max)]`, cero visible y rotulado | Área o columnas con base ≠ 0; normalización por serie; sparkline como única superficie | El área y la longitud son canales de **magnitud**: sobre una base recortada mienten por construcción. Hoy: #7, #2, `charts.js:322-330` |
| ¿Está subiendo lo negativo? | **Small multiples** con dominio compartido y eje (§2) | Apilado absoluto (la base se mueve); per-series scale; streamgraph centrado | Una serie sólo se lee si su base es recta. Hoy: #11, #25, #29 |
| ¿Cómo se reparte el total **hoy**? | Barra 100% apilada; dona **sólo con ≤3 categorías** y el total al centro | Dona con >5 categorías; dona sobre datos **multi-etiqueta** | El ángulo se compara peor que la longitud; y una dona sobre multi-etiqueta suma >100%. Hoy: #10 ✔ (3 cat.), #12 (multi-etiqueta → barras) |
| ¿Cuál es mayor? | Barras horizontales ordenadas, base común 0, valor impreso, y **% del total** | Burbujas con radio lineal; tiles cuya área la fija el índice; barras con track de ancho distinto entre cards vecinas | Sin base común no hay comparación; el área con radio lineal exagera al cuadrado. Hoy: #8 ✔, #14 ✘, #15 ✘, #20 ✔, #22b ⚠ |
| ¿Cómo cambió el **reparto** en el tiempo? | Área 100% apilada **más** una línea de total en su propio carril | Apilado absoluto solo (confunde "subió la parte" con "subió el todo") | Son dos preguntas y necesitan dos carriles. Hoy: #11 |
| ¿En qué banda estoy (crisis, BHI, polarización, NSS)? | Escala de bandas con **los rótulos posicionados en su umbral** (`left: <umbral>%`) + marcador + número | Gauge radial; rótulos con `justify-content: space-between`; escalas distintas para la misma métrica entre card y modal | Un rótulo por reparto tipográfico nombra la zona equivocada: medido, 24 puntos de error en crisis. Hoy: #4, #5, #6, `shell.js:1679-1684` |
| ¿Dónde se habla? | Coropleta por **tasa** (menciones/10k hab.) o símbolos con **área ∝ valor** (`r = rMax·√(v/vMax)`) + **leyenda de tamaño** con 3 círculos rotulados | Radio lineal; piso de radio >4px; magnitud pintada con `--accent` | El ojo integra área, no radio; sin leyenda de tamaño ningún círculo es una cantidad. Hoy: #19 |
| ¿A qué hora se habla? | Heatmap con rampa secuencial `--seq-1..5` y `--seq-0` **transparente** para el cero, leyenda con los **mismos tokens** | Piso de alfa > 0; leyenda de otro hue; celdas < 24px táctiles sin fila/columna alternativa | Con piso de alfa, "nada" se ve como "poco". Hoy: #9 |
| ¿Qué emoción domina? | Barras ordenadas con el denominador escrito ("N etiquetas sobre M menciones") | Dona; % sin denominador; piso visual que infla las menores | Multi-etiqueta: los % no suman 100 y hay que decirlo. Hoy: #12 |
| ¿Se mueven juntas dos métricas de **unidades distintas**? | Small multiples (un panel por métrica, cada uno con su dominio rotulado) o scatter | **Doble eje Y** (§4.3) | El cruce de dos ejes independientes es un artefacto de la elección de escalas, no un hecho. |
| ¿Este valor es normal? | Banda de contexto P25–P75 de 90 días + marcador + número + dominio de la métrica | Sparkline sin dominio como única evidencia; delta contra el primer punto de la ventana | "Alto" sólo existe contra una referencia declarada. Hoy: #32 ✔, #1-3 ✘, `charts.js:263` ✘ |
| ¿Qué narrativas se relacionan? | Grafo **más** tabla equivalente ordenable, con aviso de que la posición no significa nada | Grafo como única superficie; estado sin glifo ni etiqueta | 220 iteraciones de simulación no son un dato. Hoy: #28 |
| ¿Cómo se distribuyó **dentro** del día? | Sólo con serie horaria real (`HOUR_HEATMAP` o un agregado por hora) | **Cualquier valor derivado de `Math.sin`, `jitter` o `Math.random`** | Hoy hay tres réplicas de un histograma senoidal presentado como dato: `screens.js:272-275`, `1574-1577`, `2003-2007`. Si no hay serie horaria, el bloque no se dibuja. |
| ¿Cuánto cambió respecto al periodo anterior? | Un solo contrato de delta (`formatDelta` de `@eco/shared/format`) con base declarada, flecha = dirección, color = **valencia**, palabra siempre | Cuatro baselines con el mismo tratamiento visual; color por signo; `▲` sobre 0.0% | Hoy convive delta vs ventana previa (#23), vs primer punto de la ventana (`charts.js:263`), vs mitad del periodo (`route.ts:705-718`) y vs P25/P75 (#32). |

---

# 4 · Doctrina de eje y escala

## 4.1 Cuándo se puede ocultar el cero

| Tipo de magnitud | Ejemplos en ECO | Cero | Regla |
|---|---|---|---|
| **Conteo** (`kind:'count'`) | menciones/día, negativo/neutral/positivo, activaciones, alcance | **Obligatorio.** `[0, niceCeil(max)]` | Sin excepciones. Todo canal de longitud o área exige base 0. |
| **Con signo** (`kind:'signed'`) | NSS (−100..100), delta de posiciones | **Obligatorio y centrado.** `[-m, m]` simétrico | El cero es el eje de simetría y se dibuja más fuerte que la retícula. **Prohibido rellenar el área** de una serie con signo (hoy: #1). |
| **Acotada** (`kind:'bounded'`) | crisis 0–1, BHI 1–10, polarización 0–100, engagement % | **El dominio declarado manda**, aunque el cero quede fuera | `[1,10]` para BHI es correcto: 1 es el piso de la escala, no un cero recortado. Es lo que ya hace bien `shell.js:1723-1729`. |
| **Índice** (`kind:'index'`) | ninguna hoy | Se puede recortar **sólo con marca visible** | Se exige: (a) glifo de corte en el arranque del eje, (b) pie `eje recortado 40–70`, (c) prohibición de relleno de área. |

`niceCeil` (§2.5) redondea el tope: `181 → 200`, `367 → 400`, `59 → 60`. Eso mata los rótulos `367 / 184 / 0` de `charts.js:512-515`.

## 4.2 Cuándo se exige eje Y

**Regla:** si la posición vertical codifica valor, el eje Y se rotula. Sin condiciones.

Eso significa borrar la condición de `charts.js:296` (`{sharedScale && …}`) — hoy el eje sólo aparece con `sharedScale` o `yDomain`, es decir en 1 de los 3 usos de `MultiLineChart`. Y su corolario, hoy incumplido: **retícula y rótulos van juntos.** `charts.js:293-302` dibuja 5 gridlines *siempre* y rótulos *casi nunca*: cinco líneas de referencia sin referencia. Si no hay escala rotulable, no se dibuja retícula (sólo la línea base). Ver OV-02.

Rótulos mínimos: 2 (base y tope) en paneles ≤ 80px; 3 en 80–200px; 5 por encima. El canal izquierdo se dimensiona con el rótulo más largo: `padding.l = 40` alcanza para 5 dígitos a 11px; hoy es 44 fijo y se reserva **aunque no se dibuje nada** (OV-02).

**Única excepción — el sparkline dentro de una `KpiCard`:** puede omitir el eje si la card imprime (a) el valor actual, (b) el dominio del sparkline (`rango 23–59`), y (c) la ventana (`30 días`). Sin los tres, el sparkline es decoración y se retira.

## 4.3 Doble eje Y

**Prohibido. Cero excepciones.** El punto de cruce de dos series con ejes independientes se puede mover a voluntad cambiando cualquiera de los dos dominios; es decir, la afirmación visual más fuerte del gráfico ("aquí se cruzaron") es un artefacto del diseñador. En su lugar: small multiples (§2), o scatter si la pregunta es correlación.

Esto tiene una consecuencia inmediata en `screens.js:508`: los chips permiten activar hasta 3 series de **unidades incompatibles** (`nss` −100..100, `totalMentions` conteo, `crisisRiskScore` 0..1, `brandHealthIndex` 0..1, `polarizationIndex` 0..100, `engagementRate` %). Hoy eso "funciona" porque cada serie tiene su propia escala invisible — es doble eje encubierto, con seis ejes. La corrección: `MultiLineChart` acepta series de **una sola** `kind`+`bounds`; si el usuario mezcla unidades, el componente conmuta a `SeriesPanels` (un panel por métrica, cada uno con su dominio rotulado). Regla de implementación: `if (new Set(series.map(s=>s.kind+String(s.bounds))).size > 1) → SeriesPanels`.

## 4.4 Cómo se rotula la unidad

1. **La unidad va en el pie del gráfico** (`<figcaption>`), no en el título: `Menciones por día · TZ Puerto Rico · escala común 0–200`.
2. **Un solo formateador por métrica**, espejo de `@eco/shared/format`. Hoy `charts.js:243-252` (`fmtVal`) es un `switch` por `key` que se mantiene sincronizado a mano — está declarado como espejo en el comentario de :238-242. Debe recibir el formateador desde el sitio de llamada (`valueFormat`) y el `switch` desaparece, con `v.toFixed(1)` como fallback **guardado** (hoy revienta con `null`: F4).
3. **Puntos porcentuales vs porcentaje.** Un cambio de 41% a 46% es `+5 pts`, no `+12%`. Hoy la app hace las dos cosas sin distinguir (`+7 pts` en la card de Polarización, `▲ 5.6%` en la tira del chart calculado como cambio relativo). Regla: métricas cuya **unidad es el %** (polarización, engagement, % positivo) reportan deltas en `pts`; conteos reportan en `%`.
4. **Nunca "3" cuando el valor es 43.0.** El último valor se dibuja dentro del área del SVG, alineado a la derecha (§2.4), y `padding.r` se dimensiona con el texto real. Esto cierra F1 estructuralmente en vez de subir `padding.r` a 56.

## 4.5 Huecos de datos vs ceros reales

Hoy **no se distinguen en ninguna parte**, y hay tres mecanismos que borran activamente la diferencia:

| Mecanismo | Ubicación | Efecto |
|---|---|---|
| `?? 0` en el frontend | `screens.js:463` | 4 de 30 puntos de `polarizationIndex` son `null` en el payload vigente; el sparkline dibuja caídas verticales al suelo. Visible en `crop-mob-chart.png`. |
| `d[s.key] \|\| 0` en `sharedScale` | `charts.js:213, 218` | Igual, dentro de la primitiva. |
| Pre-relleno de la ventana con ceros | `packages/shared/src/aggregations/sentiment-report.ts:181-185` (`// Pre-fill todos los días de la ventana (incluso si tienen 0 menciones) para que el chart renderice bien sin gaps`) | Un día **sin ingesta** es indistinguible de un día **sin conversación**. Con el incidente de julio (SGPR y Gobernadora, tres días en crash-loop) el gráfico habría dicho "el ciudadano dejó de hablar". |

### Contrato

1. **El API nunca inventa ceros.** `dailySeries[].negative` etc. son `number | null`. Se añade `dailySeries[].coverage: 'ok' | 'partial' | 'none'`.
2. **`coverage` se deriva de `mentions.ingested_at`** (`packages/database/src/schema/mentions.ts:96`), que ya existe: un día publicado *D* es `'none'` si la agencia no escribió **ninguna** fila durante *D* ni durante las 24h siguientes (la ventana en la que el crawler habría recogido *D*):

```sql
-- Cobertura de ingesta por día publicado, TZ Puerto Rico.
WITH ingest AS (
  SELECT (ingested_at AT TIME ZONE 'America/Puerto_Rico')::date AS d,
         COUNT(*) AS rows_written
    FROM mentions
   WHERE agency_id = $1
     AND ingested_at >= ($2::date - INTERVAL '1 day')
     AND ingested_at <  ($3::date + INTERVAL '2 days')
   GROUP BY 1
), days AS (
  SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS d
)
SELECT days.d::text AS day,
       CASE
         WHEN COALESCE(i0.rows_written,0) + COALESCE(i1.rows_written,0) = 0 THEN 'none'
         WHEN COALESCE(i1.rows_written,0) = 0                               THEN 'partial'
         ELSE 'ok'
       END AS coverage
  FROM days
  LEFT JOIN ingest i0 ON i0.d = days.d
  LEFT JOIN ingest i1 ON i1.d = days.d + 1
 ORDER BY 1;
```

3. **`null` no se interpola.** El path se rompe (`segments()`, §2.5). Catmull-Rom **no** cruza un hueco: eso es exactamente el punto de F3 llevado a su límite — inventar un valor entre dos días es tolerable; inventar uno donde no hubo medición, no.
4. **El hueco se dibuja.** Banda vertical de ancho `step` en `var(--chart-void)` (ya en `tokens.css:349`, `rgba(255,255,255,0.03)`, comentada literalmente como *"hueco de datos ≠ cero real"*). Cero real: el punto se dibuja **sobre la línea base**, con su marcador.
5. **El hueco se cuenta en el pie:** `3 de 30 días sin ingesta (22–24 jul)` en `<figcaption>`, con tono `--info`, nunca `--neg` (es una nota del sistema, no un veredicto sobre el dato — fundaciones §5.1).
6. **Los agregados excluyen los huecos y lo dicen.** Un promedio sobre 27 de 30 días se rotula `media de 27 días con dato`.
7. **`fmtVal` guardado:** `null` → `'—'`, nunca `v.toFixed()` (F4 es un `TypeError` que tumba la pantalla entera).

---

# 5 · Doctrina de color en gráficas

Los tokens ya existen (`tokens.css:295-395`) y están especificados con contraste y ΔE medidos en `docs/auditoria-diseno-2026-07-fundaciones.md` §3.2–3.6. `charts.js` consume **cero**. Esta sección define cómo se usan **dentro** de una gráfica.

## 5.1 Categórico vs semántico: el caso "verde = Noticias"

Está confirmado por píxel en `/tmp/dash-sources2.png` (card «FUENTES TOP» de `/dashboard`, `screens.js:544`):

| Fuente | Color hoy | Lo que el lector entiende |
|---|---|---|
| Noticias (452) | `var(--pos)` **verde** | "las noticias son positivas" — y a 300px hay barras donde el verde **es** "positivo" |
| Facebook (319) | `#0A7EA4` teal | (literal huérfano) |
| Instagram (186) | `#8B5CF6` violeta | (literal huérfano, 10 usos en el repo) |
| X / Twitter (159) | `var(--accent)` **naranja** | "alarma" |
| Blogs (80) | `var(--warn)` **ámbar** | "precaución" |
| **Foros (66)** | **fallback `var(--accent)`** | **el mismo naranja que X / Twitter: dos plataformas, un color** |

El fallback es el hallazgo nuevo: `colorFn` (screens.js:544) mapea 6 claves (`facebook, twitter, news, instagram, youtube, blog`) y el payload trae `forum` (verificado en `fixtures/eco-data.json` → `TOP_SOURCES`), que cae a `|| 'var(--accent)'`.

**Regla dura: los espacios de color categórico y semántico son disjuntos.**

- `--pos` / `--neg` / `--warn` / `--neu` = **veredicto** sobre un valor. Jamás identifican una categoría.
- `--accent` = **interfaz** (foco, selección, IA). Jamás entra en un área de datos, ni como fallback.
- `--cat-1..5` + `--cat-other` = **identidad**. Jamás significan bueno ni malo.

Reasignación exacta (sustituye `screens.js:290` y `544`, que son la **misma tabla copiada dos veces**, y `screens.js:311`, `1998`, `2448`, `4143`, que son la paleta de tópicos copiada **cuatro** veces):

| Fuente | Token |
|---|---|
| news | `--cat-1` |
| facebook | `--cat-2` |
| twitter / X | `--cat-3` |
| instagram | `--cat-4` |
| youtube | `--cat-5` |
| blog / forum / reddit / resto | `--cat-other` |

Y la coartada de por qué 5+1 alcanza: en la lista de menciones cada fuente **ya tiene glifo de marca** (`Icons.Facebook`, `Icons.Twitter`…, screens.js:577). La identidad de plataforma se lleva con glifo + etiqueta; el color sólo entra cuando hay que **ligar la misma serie entre dos vistas**.

## 5.2 Orden de asignación

**Prohibido asignar color por índice del array** (`colors[i]` de `charts.js:599`, `palette[i % 8]` de `screens.js:311/1998/2448/4143`) y **prohibido derivarlo de un hash del nombre**: el mismo tópico cambia de color al cambiar el periodo, porque cambia su posición en el ranking.

Regla: **un mapa estable slug → token**, construido una vez por dimensión y persistido en el módulo (no en el render):

```js
// charts.js — un solo mapa por dimensión, estable entre pantallas y periodos.
const CAT_TOKENS = ['--cat-1','--cat-2','--cat-3','--cat-4','--cat-5'];
function makeCategoryScale(slugsOrdered) {           // orden canónico: volumen desc del PRIMER load
  const m = new Map();
  slugsOrdered.forEach((s, i) => m.set(s, i < CAT_TOKENS.length ? CAT_TOKENS[i] : '--cat-other'));
  return (slug) => `var(${m.get(slug) || '--cat-other'})`;
}
```

El orden canónico se fija con el ranking por volumen del primer render de la sesión y se guarda en `sessionStorage` por (agencia, dimensión), para que el color de "Permisos y trámites" sea el mismo en Overview, Tópicos, Geografía y el modal.

## 5.3 Secuencial (magnitud sin valencia)

`--seq-0..5` (`tokens.css:331-336`; valores medidos en fundaciones §3.5). Se usa en heatmap horario, calendario de tópicos y coropleta.

- **`--seq-0` es el cero y es transparente** + `inset 0 0 0 1px var(--hairline)`. Esto elimina los dos pisos de alfa que hoy pintan la nada: `0.08 + …` (screens.js:688) y `0.3 + …` (screens.js:2548).
- **La leyenda usa los mismos tokens que las celdas.** Esa es la regla que cierra F6 (leyenda `rgba(11,95,128,…)` de `costa` contra celdas naranja de `mando`, screens.js:674 vs 688). Implementación: la leyenda se genera desde el mismo `colorFn` que las celdas, nunca a mano.
- **`--seq-3` está prohibido en celdas con texto** (3.98:1 / 4.01:1: falla por los dos lados). Con etiqueta se usan 4 buckets: `seq-1`, `seq-2`, `seq-4`, `seq-5`, con tinta `--text` en los dos primeros y `--cat-ink` en los dos últimos.
- **Opacidad con `color-mix`, no con concatenación de hex.** `` `${color}${alphaHex}` `` (screens.js:2559) obliga a que `color` sea un hex de 6 dígitos y es la razón técnica por la que ese componente tiene `SENT_HEX` hardcodeado con colores de `costa`. Sustituto: `color-mix(in oklab, var(--pos) ${pct}%, transparent)` — ya se usa en screens.js:626/1830/5566, así que el soporte está probado.

## 5.4 Divergente

Para todo lo que tenga un centro con significado (NSS, delta, sentimiento neto por región): `--div-neg-2 … --div-mid … --div-pos-2` (`tokens.css:339-343`). El centro se dibuja como línea, no como color, y el dominio es **simétrico** (`kind:'signed'`) para que dos desviaciones iguales tengan longitudes iguales. Hoy #21 lo hace bien en concepto y mal en escala (`avgNss/10` sin rotular).

## 5.5 Más de 5 (u 8) categorías

1. Ordenar por valor descendente.
2. Top-5 → `--cat-1..5`; el resto se **agrega** en `Otros` → `--cat-other`, y la etiqueta dice cuántos agrupa (`Otros (7)`).
3. Si el usuario necesita ver los 10, la superficie correcta es una **tabla ordenable**, no más hues: por encima de 8 categorías el color deja de identificar (los ΔE caen por debajo de 20 y ningún deuteranope los separa).
4. **Nunca** se generan colores por `hsl(i * 360/n)` ni por hash.

## 5.6 El color nunca es el único canal (WCAG 1.4.1)

- Series de línea: color **+** posición del panel (small multiples) **+** rótulo dentro del gráfico. Cuando hay que superponer, además `stroke-dasharray` distinto por serie.
- Bandas de sentimiento: color **+** glifo (`▲` positivo / `●` neutral / `▼` negativo), como en el rótulo de panel de §2.5.
- Estados de narrativa: color **+** glifo (`▲▲` pico, `●` activa, `▲` emergente, `↻` revivida, `▼` decae, `·` dormida, `?` desconocido) **+** texto, y `border-style: dashed` para el desconocido, de modo que "no sé qué estado es esto" se vea (F7).
- Deltas: flecha (dirección) + color (valencia) + **palabra** (`mejora` / `empeora` / `sin valencia`), aunque la palabra vaya en `.sr-only`.

## 5.7 Tinta sobre relleno

Cada serie declara `{ color, ink }`. Hoy `charts.js:417` pinta el texto del tag con `var(--on-accent)` (`#1A0A04`) **sea cual sea el color de la serie** — funciona por casualidad sobre `--pos` y `--text-2`, y es una bomba en cuanto una serie use un token oscuro. Con `ink` explícito (`--on-pos`, `--on-neg`, `--cat-ink`…) el contraste se garantiza en el sitio de la definición, no en el de uso.

---

# 6 · Accesibilidad de gráficas: contrato mínimo

Punto de partida medido: `grep -c "<title" charts.js` → **0**. `grep -n "aria\|role=" charts.js` → **una** coincidencia (`role={clickable?'button':undefined}` en el `<div>` de celda del heatmap, charts.js:697). `grep -n "tabIndex\|onKeyDown\|focus" charts.js` → **ninguna**. Los únicos `<title>` del producto están en `screens.js:4784` (nodo del grafo) y `5349` (día del streamgraph).

Consecuencias reales, no teóricas: (1) para un lector de pantalla las nueve gráficas son elementos sin nombre; (2) las cifras exactas por día existen **sólo** en el tooltip de `mouseMove` (charts.js:364-407) — sin ratón no hay forma de llegar a ellas, y en táctil tampoco; (3) el marcador del mapa es un `<path>` de Leaflet sin `tabindex`, sin `role` y sin nombre (charts.js:807-832).

## 6.1 Los siete requisitos

**A1 · Nombre y descripción.** Todo SVG de datos: `role="img"` + `aria-labelledby` a un `<title>` y un `<desc>` con `id` derivado de `React.useId()`. El `<title>` dice **qué** ("Volumen de menciones por sentimiento, día a día"); el `<desc>` dice **cuánto** ("Escala común 0–200. Del 21 al 27 de julio. Negativo entre 35 y 181, máximo el 22 de julio.") y se genera de los datos, no a mano.

**A2 · Tabla equivalente, visible.** Toda gráfica lleva un `<figure>` con `<figcaption>` y un botón `Ver datos` que despliega la tabla real. No `sr-only`: la tabla también sirve al usuario de gobierno que necesita la cifra exacta para un comunicado — hoy la única forma de obtenerla es pasar el ratón por encima.

```jsx
function ChartDataTable({ data, series, unit, fmt }) {
  return (
    <div className="scroll-x">
      <table className="chart-table">
        <caption className="t-caption">{unit}</caption>
        <thead>
          <tr><th scope="col">Día</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.fullDate || d.date}</th>
              {series.map((s) => {
                const v = NUM(d[s.key]);
                return <td key={s.key} className="num">{v === null ? <span title="sin dato">—</span> : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**A3 · No depender del color.** §5.6. Verificación obligatoria antes de mergear: captura en escala de grises; si dos series no se distinguen, falta un canal.

**A4 · Foco por teclado en los puntos interactivos.** El SVG es `tabIndex={0}` (un solo tab-stop, no N). Dentro: `ArrowLeft`/`ArrowRight` mueven el índice; `Home`/`End` a los extremos; `Enter` dispara `onPointClick`; `Escape` limpia. El valor del punto enfocado se anuncia por la tira superior, que lleva `aria-live="polite"` (implementado en §2.5). `:focus-visible` ya está resuelto globalmente por `tokens.css:415-419` (`outline: 2px solid var(--accent)`).

Para el heatmap (25×7 = 175 celdas) el patrón de un tab-stop por celda es inaceptable: el contenedor es un `role="grid"` con un único tab-stop y navegación 2D con las cuatro flechas (`aria-rowindex`/`aria-colindex` en las celdas), más el mismo botón `Ver datos`. Para los marcadores de Leaflet: `L.circleMarker(..., { pane:'markerPane', keyboard:true })` no alcanza — hay que añadir `marker.getElement().setAttribute('tabindex','0')` y un `aria-label` con nombre + conteo + NSS, y un `tooltip` con `permanent:false` **más** el `title` accesible (hoy el único camino a "341 menciones · NSS −0.4" es el hover, GEO-*).

**A5 · Objetivo táctil.** Ninguna superficie interactiva por debajo de 24×24 CSS px (y 44×44 donde se pueda). Hoy: celdas de heatmap a ~11px medidos en `zz-mob-heat3.png`, puntos de línea de 1.8–2.5px. Solución para las líneas: la zona de captura no es el punto, es una banda invisible de ancho `step` (`<rect fill="transparent">` por día), que es lo que ya hace bien `NarrativeStreamgraph` (screens.js:5326-5333).

**A6 · `prefers-reduced-motion`.** `tokens.css:145-152` ya pone `--dur*: 0ms` bajo `reduce`, pero **las gráficas no usan los tokens**: `charts.js:627` (`transition:'width 0.3s var(--ease)'`), `charts.js:706` (`transition:'transform 0.12s var(--ease)'`) y `screens.js:1879` llevan la duración literal, así que la preferencia no tiene efecto. Sustituir por `var(--dur)` / `var(--dur-fast)`. Y en Leaflet: `fitBounds(..., { animate: false })` cuando `matchMedia('(prefers-reduced-motion: reduce)').matches` (hoy `charts.js:838` anima siempre).

**A7 · Estado vacío y de error accesibles.** El estado vacío es texto, nunca un SVG roto: `Donut` con `sum === 0` hoy emite `d="M NaN NaN A …"` (charts.js:580-599 con los defaults de `data.js:70-74`). Regla: toda primitiva valida su entrada y devuelve el mismo bloque `.chart-empty` con `role="status"`, con un texto que diga **por qué** está vacío ("sin menciones en el periodo" ≠ "sin ingesta" ≠ "error al cargar") — hoy hay tres redacciones distintas de "Sin datos" en `/narrative`.

## 6.2 Checklist de merge (bloqueante)

1. `<title>` + `<desc>` derivados de datos.
2. `role="img"` + `aria-labelledby`.
3. `<figure>` + `<figcaption>` con unidad, dominio y cobertura.
4. Botón `Ver datos` + tabla con `<caption>`, `scope`, y `—` para los huecos.
5. `tabIndex={0}` + las seis teclas + `aria-live`.
6. Captura en escala de grises: series distinguibles.
7. Objetivos ≥ 24px.
8. Cero duraciones literales.
9. Estado vacío como texto con causa.
10. Contraste del texto **dentro** del SVG ≥ 4.5:1 contra su relleno (`ink` declarado por serie).

---

# 7 · Tokens de gráfica que hay que añadir a `tokens.css`

Los cuatro que ya existen (`--chart-grid`, `--chart-axis`, `--chart-crosshair`, `--chart-void`, `tokens.css:346-349`) no alcanzan:

```css
[data-theme="mando"][data-mode="dark"] {
  --chart-baseline: rgba(255,255,255,0.16);   /* el CERO: más fuerte que la retícula */
  --chart-band:     rgba(255,255,255,0.05);   /* banda de contexto P25–P75 */
  --chart-halo:     var(--canvas);            /* aro de los puntos sobre la línea */
  --chart-cut:      var(--warn);              /* glifo de eje recortado */
  --h-panel:        64px;                     /* alto de panel de small multiple */
  --h-panel-mob:    52px;
}
```
(y su espejo en `[data-mode="light"]`). Motivo del `--chart-baseline` separado: hoy la línea de cero y las cuatro guías intermedias comparten `var(--hairline)` (charts.js:295), así que el cero no se distingue de una guía cualquiera — y en una serie con signo el cero es la información más importante del gráfico.

---

# 8 · Cómo se verifica que esto quedó bien

1. **Prueba de la escala invertida.** Con los datos vigentes, en `/overview`, el panel de `positivo` del 27 jul **no** puede estar por encima del de `negativo` cuando ambos valen 38. Test: renderizar `fixtures/overview.json` y comparar las `y` de los tres paneles.
2. **Prueba del hueco.** Inyectar `polarizationIndex: null` en 3 de 30 puntos: el sparkline debe mostrar tres bandas `--chart-void` y **ninguna** caída al suelo; el pie debe decir `3 de 30 días sin dato`.
3. **Prueba del rótulo de banda.** Con `crisis = 0.41`, el rótulo `ALERTA` debe empezar en el 40% del ancho de la barra y el marcador caer **dentro** de la zona `ALERTA` (hoy: rótulo en 65.5%, marcador en 41.1%).
4. **Prueba del recorte.** A 390px, ningún SVG puede exceder el content box de su card. Test: `svg.getBoundingClientRect().right <= card.getBoundingClientRect().right - padding` para todos los SVG (hoy falla en los tres sparklines de `KpiCard` por 60px).
5. **Prueba de gris.** Captura de `/dashboard` con `filter: grayscale(1)`: "Noticias" y "X / Twitter" deben seguir distinguibles (hoy: sin el color, `Foros` y `X / Twitter` eran ya el mismo).
6. **Prueba de teclado.** Tab hasta el gráfico, `→` siete veces, `Enter`: se abre el modal del día 7. Sin ratón.


## Decisiones

**Ninguna librería de gráficas nueva: el andamiaje (dominio, eje, nulos, leyenda, vacío, a11y) se escribe a mano en charts.js, ~250 líneas compartidas**

- *Por qué:* Los candidatos serios (Chart.js, ECharts, uPlot) renderizan a canvas, así que el contrato de accesibilidad de §6 (title/desc, tabla equivalente, foco por punto) habría que construirlo igual por fuera; y ninguno lee custom properties, así que cada color de serie exige un puente getComputedStyle que se re-ejecute al cambiar de modo. Lo que aportarían (escalas y generadores de path) son ~60 de las 250 líneas. d3-scale+d3-shape es la opción menos mala pero son ESM y quedarían como dos globals UMD más.
- *Alternativas descartadas:* uPlot vía CDN con integrity (47KB, 0 deps) — mejor motor, pero canvas: pierde los nodos DOM que la a11y necesita y obliga a un adaptador para los cuatro shapes de datos que ya circulan. Chart.js 4 — 200KB, mismo problema de canvas más leyenda/tooltip propios que hay que re-tematizar.

**F2 se resuelve con small multiples de dominio Y compartido (nueva primitiva SeriesPanels), no con escala compartida en un solo panel**

- *Por qué:* Con dominio compartido en un panel las tres curvas siguen superponiéndose: en la captura móvil actual la naranja y la verde ya son indistinguibles en el pico y la gris queda tapada por el relleno de la primera serie. Separadas en tres franjas de 64px el cruce es estructuralmente imposible, cada serie tiene su propia línea base, la comparación entre paneles sigue válida porque comparten escala impresa, la card baja de 240px a 214px, y el resultado es MÁS sparkline que hoy — que es exactamente el gusto que el usuario pidió preservar.
- *Alternativas descartadas:* (a) Un panel con escala compartida + banda de contexto: honesto pero reintroduce la queja original (positivo vive en el 12-30% inferior) y no resuelve la oclusión. (c) Área 100% apilada + línea de total: responde otra pregunta (mezcla, no volumen) y pierde la lectura directa de cuántas menciones negativas hubo el martes; queda como toggle secundario. (d) Índice base-100: descartada — con conteos que tienen cero natural oculta la magnitud (positivo 51 y negativo 41 arrancarían iguales en 100) y el día base cambia con el selector de periodo.

**El suavizado Catmull-Rom se conserva; lo que se elimina es la normalización por serie**

- *Por qué:* Son dos decisiones distintas que el código mezcló. Suavizar es una decisión de render, defendible mientras la curva pase por cada punto (charts.js:20-36 lo hace, sin overshoot) y los puntos estén marcados (charts.js:349-361 los marca). Escalar cada serie a su propio min/max es una decisión de verdad, y con los datos vigentes dibuja positivo (38) cuarenta puntos de altura por encima de negativo (38). Se respeta el gusto sin ceder en la honestidad.
- *Alternativas descartadas:* Quitar el suavizado junto con la normalización: rompería una petición explícita del usuario documentada en screens.js:4339-4343 sin ganancia de honestidad. Único límite nuevo: prohibido suavizar sobre un hueco de datos.

**Doble eje Y prohibido sin excepciones; si el usuario mezcla unidades, el componente conmuta a small multiples**

- *Por qué:* El punto de cruce de dos series con ejes independientes se mueve a voluntad cambiando cualquiera de los dos dominios: la afirmación visual más fuerte del gráfico sería un artefacto del diseñador. Consecuencia inmediata en screens.js:508, donde los chips permiten activar 3 de 6 series de unidades incompatibles (conteo, 0-1, 0-100, %, -100..100): hoy eso es doble eje encubierto con seis ejes invisibles.
- *Alternativas descartadas:* Permitir doble eje con rótulos de color en cada lado: sigue siendo una comparación falsa, y el color ya está sobrecargado (§5).

**Los nulos nunca se coercen a cero: contrato number|null + campo coverage derivado de mentions.ingested_at**

- *Por qué:* Hay tres mecanismos que hoy borran la diferencia: `?? 0` en screens.js:463, `|| 0` en charts.js:213/218, y el pre-relleno de la ventana con ceros en sentiment-report.ts:181-185 (cuyo propio comentario dice que es 'para que el chart renderice bien sin gaps'). Con el incidente de ingesta de julio (SGPR y Gobernadora, tres días en crash-loop) el gráfico habría afirmado que el ciudadano dejó de hablar. mentions.ingested_at ya existe (schema/mentions.ts:96), así que la cobertura por día se calcula sin tablas nuevas.
- *Alternativas descartadas:* Interpolar los huecos (lo que hace hoy de facto al coercer a 0 y suavizar): inventa una medición donde no hubo ninguna. Marcar el hueco sólo en el tooltip: invisible en la lectura de un segundo, que es como se lee un dashboard proyectado en una reunión.

**Categórico y semántico son espacios de color disjuntos; --accent queda prohibido como fallback en áreas de datos**

- *Por qué:* Confirmado por píxel en /dashboard: 'Noticias' es var(--pos) verde a 300px de barras donde el verde significa 'positivo', 'Blogs' es var(--warn) ámbar (precaución) y 'Foros' cae al fallback var(--accent), que es el mismo naranja que 'X / Twitter' — dos plataformas, un color. Los tokens --cat-1..5 + --cat-other ya están especificados con ΔE medido en fundaciones §3.2.
- *Alternativas descartadas:* Ampliar la paleta categórica a 8 hues (como hace tokens.css:298-305): con cuatro bandas de tono reservadas por los semánticos no caben 8 con ΔE≥30, y por encima de 8 el color deja de identificar. Top-5 + 'Otros (N)' y tabla ordenable para el detalle.

**Los rótulos de las escalas de banda se posicionan en su umbral con left:%, no con justify-content:space-between**

- *Por qué:* Medido en overview-mobile.png: el marcador de crisis cae en 41.1% del ancho de la barra y el rótulo ALERTA está centrado en 65.5%, cuando ALERTA empieza en 40%. El titular dice 'Alerta' y el gráfico parece decir 'apenas pasó Elevado'. El mismo defecto en BrandHealthMini (rótulos en 0/25/50/75/100 contra fronteras en 40/60/80) y en Polarización, que además usa 3 zonas en la card (screens.js:467) y 4 en su modal (shell.js:1589).
- *Alternativas descartadas:* Repartir el gradiente en cuartos iguales para que coincida con los rótulos: falsearía los umbrales reales del backend (0.25/0.40/0.60), que son los que disparan las alertas de crisis.

**Borrar RadialGauge y linePath en vez de arreglarlos; unificar los tres suavizados en catmullRomPath**

- *Por qué:* Verificado con grep -o: RadialGauge tiene 0 sitios de llamada (el max=3 de F15 es un defecto en código muerto) y linePath tiene 0. Y hay tres implementaciones de suavizado activas — catmullRomPath (charts.js:20), smoothLinePath (charts.js:52, único consumidor Sparkline) y smoothPath (screens.js:4644, misma matemática con tensión 1/6) — así que la misma serie se dibuja distinta en tres pantallas.
- *Alternativas descartadas:* Dejarlos por si se usan más adelante: cada primitiva muerta es una API más que la doctrina tiene que cubrir y un sitio más donde un futuro desarrollador copia el max=3.

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-G1` | P0 | M | Núcleo de escala + contrato de nulos en charts.js | `apps/web/public/eco-prototype/charts.js:1-95 (nuevo bloque antes de las primitivas); borrar :38-50 (linePath, ` | — |
| `WS-G2` | P0 | L | SeriesPanels (small multiples) + reemplazo de OverviewTendencia | `apps/web/public/eco-prototype/charts.js (nueva primitiva ~120 líneas + barrel :875); screens.js:4306-4348 (Ove` | WS-G1 |
| `WS-G3` | P0 | L | Eje obligatorio y cero obligatorio en MultiLineChart | `apps/web/public/eco-prototype/charts.js:184-452 (padding :188, normalización :205-227, gridlines+labels :293-3` | WS-G1 |
| `WS-G4` | P0 | M | Un solo contrato de delta en la tira-leyenda del chart | `apps/web/public/eco-prototype/charts.js:259-275; contra screens.js:4204-4207 (regla contraria) y packages/shar` | — |
| `WS-G5` | P0 | M | Sparkline responsive, sin fill en series con signo, con huecos | `apps/web/public/eco-prototype/charts.js:97-112; screens.js:126 (width={200} en KpiCard), 430/452/463 (trendDat` | WS-G1 |
| `WS-G6` | P1 | L | BandScale: una primitiva para crisis, BHI, polarización y NSS con rótulos en el umbral | `apps/web/public/eco-prototype/screens.js:34 (CRISIS_GRADIENT), 444-450 (crisis), 467-473 (polarización), 611-6` | — |
| `WS-G7` | P1 | L | Color de dato: --cat-* para categorías, --seq-* para magnitud, leyendas generadas del mismo colorFn | `apps/web/public/eco-prototype/screens.js:290 y 544 (fuentes, tabla duplicada), 311/1998/2448/4143 (paleta de t` | — |
| `WS-G8` | P1 | XL | Contrato de accesibilidad de gráficas (ChartFigure + ChartDataTable + teclado) | `apps/web/public/eco-prototype/charts.js (todas las primitivas; hoy 0 <title>, 0 aria, 0 tabIndex), screens.js:` | WS-G1 |
| `WS-G9` | P1 | M | StackedAreaChart: contestar la pregunta correcta (mezcla vs volumen) | `apps/web/public/eco-prototype/charts.js:455-576 (max :469, labels :512-515, gridlines :502-504, pickIdx :479-4` | WS-G1 |
| `WS-G10` | P1 | M | PRMap: área proporcional, leyenda de tamaño y puente de tokens | `apps/web/public/eco-prototype/charts.js:800-832 (r = 8 + (v/max)*22, colores literales #0E1620/#3FD47A/#FF6A3D` | — |
| `WS-G11` | P1 | M | Retirar los tres histogramas sintéticos del drill-down | `apps/web/public/eco-prototype/screens.js:272-275, 1574-1577, 2003-2007 (Math.sin + jitter); shell.js:1328-1357` | — |
| `WS-G12` | P1 | M | Área real en la vista de tópicos (o renombrar la vista) | `apps/web/public/eco-prototype/screens.js:2049-2088 (span/rowSpan por índice), 2115-2178 (r lineal), 1988-1990 ` | — |
| `WS-G13` | P2 | S | Alertas: eje temporal completo en 'Activaciones por día' | `apps/web/public/eco-prototype/screens.js:3355-3412 (days = Object.keys(byDay).sort(), max, render de columnas)` | — |
| `WS-G14` | P2 | M | Limpieza: un solo suavizado, un solo estado vacío, ids de SVG por instancia | `apps/web/public/eco-prototype/charts.js:20-36 (catmullRomPath), 52-68 (smoothLinePath), 145 (id constante 'are` | WS-G1 |

## Riesgos

- El usuario pidió explícitamente las curvas por-serie ('me gustaba más como se veía antes... me gustaban las líneas suavizadas', documentado en screens.js:4339-4343). Small multiples conserva las curvas y los rellenos, pero el panel de positivo tendrá 11.5px de amplitud con los datos vigentes contra el 41.7% de altura de hoy: se va a percibir como 'más plano'. Mitigación: llevar a la conversación la aritmética de §2.1 (la escala por serie no revela variación, la inventa: da a 3 menciones más peso vertical que a 6) y ofrecer scale='perPanel' como escape hatch honesto, que sube positivo a 38px de amplitud siempre que se imprima el dominio de cada panel.
- Conflicto de nombres de tokens sin resolver: tokens.css (committed en HEAD a69ea2e) define --cat-1..8, --narr-*, --neg:#FF5470; docs/auditoria-diseno-2026-07-fundaciones.md (sin commitear) define --cat-1..5 + --cat-other, --nar-*, --neg:#FF6A3D intacto y --accent movido a azul. Esta doctrina se alineó con fundaciones. Si se implementa charts.js contra tokens.css se van a referenciar variables que el plan de color va a renombrar, y el resultado son colores sin definir (que en CSS es silencio, no error). Hay que cerrar la reconciliación ANTES de tocar charts.js.
- El campo coverage exige tocar packages/shared/src/aggregations/sentiment-report.ts, que es código COMPARTIDO con el lambda eco-weekly-report (los correos diario y semanal salen de buildSentimentReport). Un cambio de tipo de number a number|null en dailySeries puede romper render-daily-report.ts:138-145 y los prompts de weekly-report-insights.ts:174, que hacen aritmética directa sobre esos campos. Cambio en dos fases: añadir coverage sin cambiar los tipos existentes, y sólo después admitir null.
- El fixture de /api/eco-data que sirve el harness trae 6 filas por día en TOPIC_CALENDAR (168 filas / 28 días), y de ahí sale la página de 7807px de topics-desktop.png. El SQL de producción (eco-data/route.ts:751-758, WHERE rk = 1) devuelve una fila por día, así que ese síntoma NO está en prod. El hallazgo real es la falta de validación de contrato en el componente. No presentarlo al cliente como un bug de producción.
- Los tres histogramas senoidales (screens.js:272-275, 1574-1777, 2003-2007) alimentan el bloque 'Volumen por hora' del modal al que llevan todos los clics de todas las gráficas. Retirarlos deja un hueco visible en el drill-down más usado del producto, y la serie horaria real por día no existe en ningún endpoint (HOUR_HEATMAP es un agregado de 7x24 de todo el periodo, no por día). Hay que decidir si se construye el agregado o si el bloque desaparece; dejar el seno no es opción.
- charts.js está en el bundle dist/ que se sirve con ?v=prodcNN MANUAL desde index.html (ver memoria prototype-build-cachebust). Un cambio en las primitivas sin subir el cache-bust deja a los usuarios con el charts.js viejo y el screens.js nuevo — es decir, llamadas a SeriesPanels contra un window.ECO_CHARTS que no lo exporta: pantalla en blanco. El cache-bust es parte del cambio, no un paso posterior.
- React.useId() se usa en SeriesPanels para los ids de degradado y de aria-labelledby. Está disponible en el UMD de React 18.3.1 que carga index.html:1301, pero si alguien baja la versión del CDN a 17 el componente revienta en render. Vale un comentario en charts.js y, si se quiere cinturón, un fallback a un contador de módulo.


---

# Rediseño de `charts.js` — nueva API unificada de primitivas de gráfica de la SPA

## Resumen

`charts.js` (878 líneas, worktree `design-audit`) no es una librería: son nueve componentes escritos en momentos distintos, cada uno con su propio contrato de props, su propio dialecto de estado vacío, su propio formateador y cero accesibilidad. El problema de fondo no es cosmético: la primitiva más usada (`MultiLineChart`) escala cada serie a su propio min/max sin dibujar eje Y, así que en `/overview` tres líneas cuyos valores reales son 43 / 54 / 36 se cruzan y la de 54 se pinta por DEBAJO de la de 36 — el lector concluye lo contrario del dato. Encima, el suavizado Catmull-Rom con `tension=1` (el default, y el comentario del código tiene la polaridad invertida) dibuja valores que no existen: en una serie con un pico aislado tipo `[8,10,9,240,11,9,10]` la curva baja hasta −7.7 menciones. Y no hay contrato de nulos: `null` hace que `Math.min` lo coaccione a 0 y mueva el dominio entero en silencio; `undefined` produce `M 0,NaN` (path invisible, sin error); `fmtVal(key, null)` hace `null.toFixed(1)` → TypeError que tumba la pantalla; y el call site de Polarización parchea con `?? 0` (screens.js:463), convirtiendo "no medido" en "polarización 0% = apática". La solución no es parchear 12 líneas: es partir el archivo en un núcleo (`charts-core.js`: escalas, canon de nulos, registro de métricas servido por la API, ticks, tooltip, estados, a11y) y reescribir las nueve primitivas contra un contrato único de props. Los sitios de llamada son solo 11 (no ~40 — los conté: 10 en screens.js, 1 en shell.js), más 15 mini-gráficas ad-hoc dentro de screens.js/shell.js que deben absorberse como primitivas; con 11 llamadas y un solo bundle `dist/` no hay razón para un adaptador de compatibilidad permanente: se migran todas en un PR, y el shim de 30 líneas solo existe para que el PR sea bisectable. Todo se escribe a mano en SVG sin dependencias nuevas salvo el placer de la nube de palabras (150 líneas propias, justificado); Leaflet se queda como está.

> Ruta base del código auditado (worktree): `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit`
> Archivo objetivo: `<WT>/apps/web/public/eco-prototype/charts.js` — **878 líneas** en `HEAD` (`a69ea2e`), no 955. Los números de línea son los de ese archivo tal como está hoy. Único cambio respecto de `origin/main` (`8a996a8`): línea 417, `fill="#fff"` → `fill="var(--on-accent)"` (commit `92e0d4a`, agente de tokens).
> Tokens ya disponibles: `<WT>/apps/web/public/eco-prototype/tokens.css` (`--chart-grid`, `--chart-axis`, `--chart-crosshair`, `--chart-void`, `--cat-1..8`, `--seq-0..5`, `--div-*`, `--on-*`, escalas `--fs-*`, `--sp-*`, `--r-*`).

---

# 0 · Inventario real: qué existe y quién lo llama

## 0.1 Las 9 primitivas exportadas (`charts.js:875-878`)

| Primitiva | Línea | Props que recibe | Sitios de llamada |
|---|---|---|---|
| `Sparkline` | 97 | `data, width, height, color, accessor, fill` | 1 (`screens.js:126`) |
| `AreaLineChart` | 115 | `data, height, accessor, color, showAxis, showGrid, yMin, yMax` | 1 (`screens.js:2388`) |
| `MultiLineChart` | 184 | `data, series, height, onPointClick, sharedScale, smooth, yDomain, valueFormat` | 3 (`screens.js:508`, `screens.js:4344`, `shell.js:1714`) |
| `StackedAreaChart` | 455 | `data, keys, colors, height, onPointClick, labels` | 1 (`screens.js:1683`) |
| `Donut` | 579 | `data, size, thickness, colors, total` | 1 (`screens.js:1646`) |
| `HBarList` | 607 | `items, colorFn, max, labelKey, valueKey, trackHeight, onItemClick` | 2 (`screens.js:542`, `screens.js:2799`) |
| `RadialGauge` | 638 | `value, max, size, thickness, colorStops` | **0 — código muerto** |
| `Heatmap` | 675 | `data, colorFn, cellSize, gap, hours, days, onCellClick` | 1 (`screens.js:684`) |
| `PRMap` | 731 | `municipalities, accessor, colorFn, onMunicipalityClick` | 1 (`screens.js:2779`) |

**Total: 11 sitios de llamada JSX.** Verificado con `grep -n "<Sparkline\|<AreaLineChart\|…" screens.js shell.js`.

Cinco dialectos para lo mismo:
- **datos**: `data`+`accessor` (Sparkline, AreaLineChart, PRMap) · `data`+`series[].key` (MultiLineChart) · `data`+`keys[]`+`colors[]` paralelos por índice (StackedAreaChart) · `items`+`labelKey`/`valueKey` (HBarList) · `data[]` con `.value` implícito (Donut) · array plano de 168 posiciones indexado `d*24+h` (Heatmap).
- **color**: `color` · `colors[]` posicional · `colorFn(v)` · `colorFn(item,i)` · `series[].color` · `colorStops` (nunca leída, `charts.js:638`).
- **click**: `onPointClick(row,idx)` · `onItemClick(item,idx)` · `onCellClick({day,dayLabel,hour,value})` · `onMunicipalityClick(m)`.
- **tamaño**: `width`/`height` fijos (Sparkline 80×24, Donut/RadialGauge `size=120`) vs `useChartWidth`+`height` (AreaLineChart 180, MultiLineChart 260, StackedAreaChart 220) vs `cellSize` (Heatmap) vs alto CSS fijo 420px (PRMap, `charts.js:865`).
- **estado vacío**: string en español (MultiLineChart:198, StackedAreaChart:464, PRMap:856) · `<svg>` vacío (Sparkline:102) · **crash** (AreaLineChart, Donut, HBarList).

## 0.2 Las 15 gráficas ad-hoc que NO son primitivas (deben absorberse)

| Componente / bloque | Ubicación | Qué es | Primitiva destino |
|---|---|---|---|
| `BrandHealthMini` | `screens.js:611-646` | gauge segmentado 4 bandas + hitos | `BulletChart` |
| `CRISIS_GRADIENT` + marcador | `screens.js:34`, `444-450`, `4295-4300` | barra de bandas con marcador | `BulletChart` |
| barra de Polarización | `screens.js:466-473` | ídem, con **stops 30/60 en vez de 30/50/75** | `BulletChart` |
| `bandConfig()` + barra | `shell.js:1568-1602`, `1676-1685` | ídem, 4ª variante | `BulletChart` |
| leyenda del heatmap | `screens.js:670-678` | 5 swatches **azules de `costa`** (F6) | `Legend` + `seqScale` |
| `SentimentBar` | `screens.js:2093-2112` | barra apilada 3 partes + delta | `SplitBar` |
| `TopicList` barra inline | `screens.js:2206-2213` | ídem, 2ª implementación | `SplitBar` |
| `DistributionBar` | `screens.js:4360-4372` | ídem, 3ª implementación | `SplitBar` |
| `SentimentSplitBar` | `screens.js:5563-5575` | ídem, 4ª implementación | `SplitBar` |
| barra de `topContributingTopics` | `shell.js:1744-1746` | barra simple 80px | `BarList` |
| `TopicTreemap` | `screens.js:2049-2088` | grid 4×N con spans fijos (no es treemap) | `BarList` / renombrar |
| `TopicBubbles` | `screens.js:2115-2178` | packing pseudo-aleatorio determinista | `Beeswarm` (P2) |
| `TopicCalendar` | `screens.js:2446-2625` | calendario mes×semana | `CalendarHeatmap` |
| `NarrativeSparkline` | `screens.js:4662-4674` | sparkline propia con `smoothPath` local (`4640-4660`) | `Sparkline` |
| `NarrativeStreamgraph` | `screens.js:5237-5389` | streamgraph centrado, `viewBox` 1080×240 fijo | `AreaStackChart stack='center'` |

Superficie total a tocar: **26 lugares**.

---

# 1 · Bugs, con el diff conceptual exacto

Severidad: **P0** = engaña al lector o rompe la pantalla · **P1** = degrada · **P2** = pulido.

| id | Sev | Ubicación | Qué cambia |
|---|---|---|---|
| C-01 | P0 | `charts.js:415-418`, `188` | `padding.r: 20 → medido`; tag ancho fijo 46 → medido; tag opcional |
| C-02 | P0 | `charts.js:220-227`, `293-302` | eliminar la escala por-serie sin eje; `scale.mode` explícito |
| C-03 | P0 | `charts.js:336` | `useSmooth = curve !== 'linear'` (sin el `\|\|`) |
| C-04 | P0 | `charts.js:20-36`, `8`, `12` | Catmull-Rom → Fritsch-Carlson monótona; comentarios falsos corregidos |
| C-05 | P0 | `charts.js:222-226`, `243-252`, `264` | canon de nulos: `num()`, dominio ignora ausencias, `'—'`, delta `null` |
| C-06 | P0 | `charts.js:425-443` | ticks por *stride* medido, no `Math.round` sobre `innerW/50` |
| C-07 | P0 | `screens.js:670-678` | swatches `rgba(11,95,128,…)` → `var(--seq-1..5)` (F6) |
| C-08 | P0 | `screens.js:447-449`, `470-472`, `4298-4300`, `shell.js:1682-1684` | labels de banda en `space-between` (0/33/67/100%) vs bandas (12.5/32.5/50/80%) |
| C-09 | P0 | `screens.js:463` | `?? 0` convierte "no medido" en "0% apática" |
| C-10 | P1 | `charts.js:212-219` | `sharedMin = 0` hardcodeado rompe negativos; rama muerta |
| C-11 | P1 | `charts.js:97-112`, `579-604`, `638-668` | falta `viewBox` + `preserveAspectRatio` |
| C-12 | P1 | `charts.js:126`, `121`, `580`, `608`, `629` | crash con `data=[]` / `sum=0` / valor `null` |
| C-13 | P1 | `charts.js:638` | `RadialGauge max=3`; muerta — se borra |
| C-14 | P1 | `charts.js:675`, `700-702` | `cellSize` fijo sin `flexShrink:0`: celdas 14×9.5 en móvil |
| C-15 | P1 | `charts.js:145`, `283` | IDs de `<defs>` sin namespace por instancia |
| C-16 | P1 | todo `charts.js` | 0 `useMemo`/`React.memo`: ~1.510 nodos SVG reconciliados por `mousemove` |
| C-17 | P1 | todo `charts.js` | 0 `aria-*`/`<title>`/`<desc>`/`tabIndex`; `role="button"` sin foco (`:697`) |
| C-18 | P1 | `charts.js:278`, `486`, `709-718` | interacción sólo `onMouseMove`: inalcanzable en táctil |
| C-19 | P1 | `charts.js:297`, `311`, `441`, `514`, `523` | `fontSize="9"`/`"10"` sobre `--text-3`: 148+724 instancias bajo AA |
| C-20 | P1 | `shell.js:1723-1729` | `yDomain` nominal (`nss:[-100,100]`) vs datos en `[-4,+2]`: línea plana |
| C-21 | P2 | `charts.js:38-68` | `linePath`/`smoothLinePath` duplican la matemática; fugan como globales |
| C-22 | P2 | `charts.js:115`, `455`, `579`, `638` | props muertas: `showAxis`, `showGrid`, `yMin`, `yMax`, `total`, `colorStops` |

---

## C-01 · F1 · Tag del último valor recortado (P0)

`charts.js:415-418`:
```jsx
<g key={s.key + '-tag'} transform={`translate(${innerW + 4}, ${y})`}>
  <rect x={0} y={-8} width={46} height={16} fill={s.color} rx={2} />
  <text x={23} y={3} fontSize="10" … >{fmtVal(s.key, v)}</text>
</g>
```
`padding.r = 20` (`charts.js:188`). El tag arranca en `innerW+4` y mide 46 → necesita 50, sobran 20 → **se recortan 30px**. Evidencia: `scratchpad/z-chart-desktop.png` muestra "3", "5", "4" donde debería decir "36.0", "54.0", "43.0".

**Diff conceptual**

1. El ancho del tag se **mide**:
   ```js
   // charts-core.js — Besley tabular: dígitos 0.58em, resto ~0.52em, punto 0.28em.
   function measureNum(str, fontSize) {
     let w = 0;
     for (const ch of String(str)) w += /[0-9]/.test(ch) ? 0.58 : (ch === '.' || ch === ',') ? 0.28 : 0.52;
     return Math.ceil(w * fontSize);
   }
   const TAG_PAD_X = 6;
   const tagW = (label, fs) => measureNum(label, fs) + TAG_PAD_X * 2;
   ```
2. `padding.r` se calcula, no se declara:
   ```js
   const tagLabels = series.map(s => fmt(s, lastMeasured(s)));
   const maxTagW = tags === false ? 0 : Math.max(0, ...tagLabels.map(l => tagW(l, TICK_FS)));
   const padR = Math.max(basePad.r, maxTagW + 8);
   ```
3. Regla dura: `if (padR > wTotal * 0.28) tags = false` y el último valor vive en la tira de leyenda (`legend:'strip'`, ya existe en `charts.js:259-276`). En móvil (`window.ecoIsMobile()`) los tags están **siempre** apagados: en el card de 175px de `crop-mob-chart.png` un tag de 46px se come el 26% del ancho.

---

## C-02 · F2 · Normalización por-serie sin eje Y (P0 — el más grave)

`charts.js:220-227` (rama por defecto, la que usan **2 de 3** call sites):
```js
} else {
  normalized = series.map((s) => {
    const vals = data.map((d) => d[s.key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { ...s, min, max, range: max - min || 1, vals };
  });
}
```
y `charts.js:293-302`: los números del eje Y se pintan **sólo** `if (sharedScale)`.

Medido en `scratchpad/z-chart-desktop.png` (`/overview`, `OverviewTendencia`, `screens.js:4344`): con `negativo=43`, `neutral=54`, `positivo=36` la línea neutral (54) queda **por debajo** de la positiva (36). Sin eje Y el lector no puede detectarlo. El comentario `screens.js:4339-4343` dice que fue petición del usuario ("me gustaban las líneas suavizadas"); el gusto era por la **curva**, no por la escala.

**Diff conceptual** — `scale` explícito con cuatro modos; el modo por-serie sin marca se **elimina**:

| `scale.mode` | Dominio | Eje Y | Cuándo |
|---|---|---|---|
| `'shared'` (**default**) | `[min(todas), max(todas)]` con `nice()` | siempre | series comparables (3 sentimientos, 3 agencias) |
| `'fixed'` | `scale.domain` o el de `metric` | siempre, con bandas | métrica con escala oficial (crisis 0–1, BHI 1–10) |
| `'index'` | cada serie a 100 en su primer punto medido | eje en **% vs día 1** | comparar formas con unidades distintas |
| `'per-series'` | por serie | **prohibido**: obliga a `SmallMultiples` | nunca en un panel |

```js
if (scale.mode === 'per-series') {
  // Un solo par de ejes NO puede representar dos escalas: la lectura cruzada
  // siempre es falsa. Para "ver la forma de cada serie" existe SmallMultiples;
  // para "comparar formas con unidades distintas" existe mode:'index'.
  if (window.ECO_DEV) throw new Error("LineChart: scale.mode='per-series' no es representable en un panel.");
  scale = { ...scale, mode: 'shared' };
}
```

El gusto del usuario se preserva. `screens.js:4344` pasa a:
```jsx
<LineChart
  data={chartData} series={sentSeries}
  x={{ key:'date', full:'fullDate', type:'band' }}
  scale={{ mode:'shared', nice:true, zero:true }}
  curve="monotone"                 // sigue siendo curva, ahora sin inventar
  axes={{ y:true, x:true }} legend="strip" onSelect={onDayClick}
  title="Volumen por sentimiento, día a día" />
```
El argumento real del comentario (`screens.js:4342`: "los picos grandes, ej. neg=203, comprimían las variaciones diarias en una banda plana") se resuelve honestamente con dos mecanismos, no con escalas distintas:
- `scale.softMax` (nuevo): recorta el eje al percentil 97 y marca el pico que se sale con un **glifo de corte** (triángulo + `title` "203 · fuera de escala").
- `SmallMultiples` (§3.2) para "ver la forma de cada serie".

---

## C-03 y C-04 · F3 · Suavizado no opcional y con overshoot (P0)

`charts.js:336`: `const useSmooth = smooth || (!sharedScale && pts.length > 2);` — `smooth={false}` (el default) **no puede** dar líneas rectas.

Peor: el suavizado **inventa valores fuera del rango de los datos**. `catmullRomPath(pts)` se llama sin tensión (`charts.js:327` y `337`) → `tension = 1` (`charts.js:20`). Medido:

```
tension=0   → segmento entre dos ceros:  y = 0.000    (cuerda recta, sin overshoot)
tension=0.5 → segmento entre dos ceros:  y = −6.250   (6.25% del salto)
tension=1   → segmento entre dos ceros:  y = −12.500  (12.5% del salto)  ← el default

serie [8,10,9,240,11,9,10] (pico aislado — patrón típico de día de crisis)
  datos:    8 .. 240
  dibujado: −7.7 .. 240.0        ← la curva pinta −7.7 MENCIONES
serie [180,20,25,190,30,28,150]
  datos:    20 .. 190     dibujado: 2.1 .. 190.0
serie [90,92,91,20,19,21,88]
  datos:    19 .. 92      dibujado: 14.4 .. 96.6
```

Y dos comentarios falsos:
- `charts.js:8`: "La curva pasa EXACTAMENTE por cada data point (sin overshoot)" — pasar por los puntos no impide salirse **entre** puntos.
- `charts.js:12`: "Tensión 0.5 = standard Catmull-Rom; 1.0 = más recto; 0 = más curvo" — **invertido**: con `cp1 = P1 + (P2−P0)·t/6`, `t=0` da `cp=P1` ⇒ cuerda recta; `t` mayor ⇒ más curvatura y más overshoot.

**Diff conceptual**

1. `charts.js:336` → `const useSmooth = curve !== 'linear';`, con `curve` explícito (`'linear' | 'monotone' | 'step'`; `'auto'` = `'monotone'` si `x.type==='band'` y `n ≤ 60`, `'linear'` si `n > 60`).
2. Reemplazar `catmullRomPath` por interpolación **monótona** (Fritsch–Carlson), que por construcción no puede overshoot. ~35 líneas, cero dependencias:

```js
// charts-core.js — Fritsch-Carlson: Hermite cúbica con tangentes limitadas.
// GARANTÍA: en cada intervalo la curva queda entre y[i] e y[i+1].
// Reemplaza catmullRomPath (charts.js:20).
function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i+1][0] - pts[i][0]; dy[i] = pts[i+1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i-1] * m[i] <= 0) t[i] = 0;                       // extremo local ⇒ tangente 0
    else {
      const w1 = 2 * dx[i] + dx[i-1], w2 = dx[i] + 2 * dx[i-1];
      t[i] = (w1 + w2) / (w1 / m[i-1] + w2 / m[i]);         // media armónica ponderada
    }
  }
  t[n-1] = m[n-2];
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${pts[i][0]+h},${pts[i][1]+t[i]*h} ${pts[i+1][0]-h},${pts[i+1][1]-t[i+1]*h} ${pts[i+1][0]},${pts[i+1][1]}`;
  }
  return d;
}
```
3. Se borran `catmullRomPath`, `linePath` y `smoothLinePath` (`charts.js:20-68`). El núcleo expone `monotonePath`, `linearPath`, `stepPath`.
4. `screens.js:4640-4660` (`smoothPath` local, mismas tangentes `/6`) también se borra.

---

## C-05 · F4 · Canon de nulos (P0)

### Lo que pasa hoy, medido

```
Math.min(12, null, 40)      → 0        ← el dominio se MUEVE en silencio
Math.min(12, undefined, 40) → NaN      ← todo el path sale NaN
(null - 0)                  → 0        ← el punto se dibuja en el piso
(undefined - 0)             → NaN      ← "M 0,NaN L 40,NaN" (SVG lo descarta)
(null).toFixed(1)           → TypeError: Cannot read properties of null
(50 - 50) || 1              → 1        ← serie constante ⇒ y = innerH (pegada al piso)
```

Cadena afectada: `charts.js:222-226` (`min`/`max`/`range`), `:213` y `:218` (`d[s.key] || 0`), `:243-252` (`fmtVal`), `:264` (`delta`), y todos los `(d[s.key] - s.min) / s.range` de `:324`, `:335`, `:352`, `:380`, `:412`.

Fuente real: `<WT>/apps/web/src/app/api/eco-data/route.ts:76` declara `polarizationIndex: number | null` y `:263` lo emite tal cual. `polarizationIndex` es serie **seleccionable** en `/dashboard` (`screens.js:264` + `:508`). El parche existente está en el call site y es el bug: `screens.js:463` hace `D.TIMELINE.map(t => t.polarizationIndex ?? 0)` → un día sin medida se presenta como "Polarización 0% · Apática".

### Canon (normativo para toda gráfica)

```
DEFINICIÓN. Un valor es MEDIDA si y sólo si
    typeof v === 'number' && Number.isFinite(v)
Todo lo demás — null, undefined, NaN, ±Infinity, '', '12', {} — es AUSENCIA.
No hay grados: no existe "casi cero". La ausencia NUNCA se convierte en 0.

1. DOMINIO. Se calcula ignorando las ausencias.
   Serie sin ninguna medida → no se dibuja, y su entrada de leyenda queda en
   estado "sin dato" (label + '—', opacidad 0.45, sin trazo).
   Ninguna serie con medidas → state = 'empty'.

2. DIBUJO DEL HUECO. Por tipo de marca:
   · línea / área  → el path se ROMPE: nuevo `M` tras la ausencia
                     (series.nulls='gap', default). 'connect' y 'zero' existen
                     pero exigen declararse por serie y pintan el tramo con
                     strokeDasharray="2 3" para que se vea que es interpolación.
   · barra         → relleno var(--chart-void) + <pattern> diagonal 45°
   · celda heatmap → lo mismo
   · dot           → no se dibuja
   · tag último v. → se ancla al último punto MEDIDO; <title> "sin dato desde
                     el <fecha>"; rect en --chart-void, texto en --text-2

3. FORMATO. Una ausencia se imprime SIEMPRE como '—' (em dash U+2014).
   Nunca 'NaN', 'null', 'undefined', '0', '0%', 'nan%'.
       const fmtSafe = (v, f) => isNum(v) ? f(v) : '—';
   Esto elimina de raíz el "· nan%" de /narrative (F8) si formatea la
   primitiva, no cada card.

4. DELTAS. Si el punto base o el actual es ausencia, el delta es null y se
   imprime '—', jamás 0%. Hoy charts.js:264 hace
       const delta = first ? ((v - first) / first) * 100 : 0;
   que muestra "▲ 0.0%" cuando `first` es 0 o ausente: un falso "sin cambio".
   Sustituto:
       const delta = (isNum(v) && isNum(first) && first !== 0)
         ? ((v - first) / first) * 100 : null;

5. SERIE CONSTANTE (max === min, incluida la de un solo valor).
   Hoy: range = 0 || 1 y (v−min)/1 = 0 ⇒ y = innerH ⇒ la línea se pinta PEGADA
   AL PISO, como si fuera el mínimo posible. Falso.
   Canon: se dibuja CENTRADA y el eje Y rotula ese único valor.
       function padDomain([lo, hi]) {
         if (lo !== hi) return [lo, hi];
         const eps = Math.max(1, Math.abs(lo) * 0.1);
         return [lo - eps, lo + eps];        // ⇒ y = innerH / 2
       }

6. DATO INSUFICIENTE. data.length < minPoints (default 2) en una primitiva
   temporal ⇒ state='insufficient', NO 'empty': la acción del usuario es
   distinta (ampliar el período, no revisar filtros). Con 1 punto medido: se
   dibuja el dot + el tag, sin path, rotulado "1 día con datos".

7. FUERA DE DOMINIO (sólo con scale.mode='fixed'). El valor se CLAMPEA al
   borde del área de plot, el dot se dibuja HUECO (fill:none, stroke:color,
   strokeWidth 1.5) y lleva <title> "fuera de escala: <valor>". Nunca se pinta
   por fuera del área. Hoy charts.js:412 no clampea nada.
```

### Implementación mínima

```js
// charts-core.js
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num   = (v) => (isNum(v) ? v : null);
const EMPTY = '—';

function extent(rows, keys) {                    // ignora ausencias
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const r of rows) for (const k of keys) {
    const v = num(r[k]); if (v === null) continue;
    if (v < lo) lo = v; if (v > hi) hi = v; n++;
  }
  return n === 0 ? null : padDomain([lo, hi]);
}

// Parte una serie en tramos contiguos de medidas: un tramo por hueco.
function segments(rows, key) {
  const out = []; let cur = null;
  rows.forEach((r, i) => {
    const v = num(r[key]);
    if (v === null) { cur = null; return; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push({ i, v });
  });
  return out;
}
```
`LineChart` dibuja **un `<path>` por segmento**, no uno por serie. Con datos completos hay 1 segmento y el coste es idéntico al actual.

---

## C-06 · Colisión de labels del eje X (P0)

`charts.js:425-443`:
```js
const maxLabels = Math.max(2, Math.floor(innerW / 50));
const xTickCount = Math.min(maxLabels, data.length);
const denom = Math.max(1, xTickCount - 1);
const xIdxs = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / denom));
```
El defecto no es el 50: es que `Math.round` **cuantiza las posiciones a la retícula de datos**, así que el hueco *realizado* colapsa a múltiplos de `innerW/(n−1)`. Medido:

| n | innerW | maxLabels | labels | hueco mínimo real |
|---|---|---|---|---|
| 30 | 975 | 19 | 19 | **33.6 px** ← "28 jun" mide ≈32px ⇒ 1.6px de aire |
| 30 | 700 | 14 | 14 | 48.3 px |
| 90 | 975 | 19 | 19 | 43.8 px |
| 365 | 975 | 19 | 19 | 53.6 px |

El caso patológico es exactamente el de la captura (`/dashboard`, 30D, escritorio): "28 jun 29 jun", "7 jul 8 jul".

**Diff conceptual** — stride uniforme derivado del ancho **medido** de la etiqueta:
```js
// charts-core.js
function tickIndices(n, innerW, labelW, minAir = 8) {
  const step = innerW / Math.max(1, n - 1);
  const need = labelW + minAir;
  const k = Math.max(1, Math.ceil(need / step));         // stride en índices
  const out = [];
  for (let i = 0; i < n; i += k) out.push(i);
  const last = n - 1;
  if (out[out.length - 1] !== last) {
    if ((last - out[out.length - 1]) * step < need) out.pop();   // evita el choque final
    out.push(last);
  }
  return out;
}
```
Verificación (labelW = 34):

| n | innerW | labels | stride | hueco mínimo |
|---|---|---|---|---|
| 7 | 975 | 7 | 1 | 162.5 px |
| 30 | 975 | 15 | 2 | 67.2 px |
| 30 | 300 | 6 | 5 | 51.7 px |
| 90 | 975 | 23 | 4 | 43.8 px |
| 365 | 975 | 23 | 16 | 42.9 px |
| 365 | 300 | 8 | 51 | 42.0 px |

Regla adicional: con `n > 45` cambia la **granularidad** de la etiqueta vía `x.tickPolicy` (`'auto' | 'day' | 'week' | 'month' | 'first-last'`) en vez de mostrar días salteados que sugieren muestreo. `'auto'`: `n ≤ 14` día · `≤ 70` cada lunes · resto primero de mes.

---

## C-07 · F6 · Leyenda del heatmap con color de otro tema (P0)

**No está en `charts.js`.** Está en `screens.js:670-678`, dentro de `HourActivityCard`:
```jsx
{[0.1, 0.3, 0.5, 0.7, 0.95].map((o, i) => (
  <div key={i} style={{ width: 8, height: 8, background: `rgba(11, 95, 128, ${o})`, borderRadius: 1 }} />
))}
```
`rgba(11,95,128,…)` es el azul del tema `costa`. Las celdas, 10 líneas más abajo (`screens.js:686-689`), usan `rgba(255,106,61,…)` — el naranja de `mando`. Evidencia visual directa: `scratchpad/crop-mob-heat2.png` — cinco swatches azules bajo "menos … más" sobre una retícula naranja.

**Causa raíz, no síntoma**: la leyenda la escribe el card, no la gráfica. Arreglo estructural:
1. La escala se declara una vez y la primitiva la expone:
   ```jsx
   const seq = window.ECO_CHART_CORE.seqScale({ domain: [0, max], steps: 6 });
   // seq.color(v) → 'var(--seq-0..5)'   seq.stops → [{from,to,color}]
   <MatrixHeatmap data={data} scale={seq} legend="top" … />
   ```
2. `Legend` (§2.3) lee `scale.stops`. El card **no puede** pintar swatches: no tiene los valores.
3. Se borran las 10 líneas de `screens.js:670-678`.

---

## C-08 · Labels de banda desalineados de sus bandas (P0)

Cuatro barras de bandas (`screens.js:444-450`, `466-473`, `4295-4300`, `shell.js:1676-1685`) rotulan con `justifyContent:'space-between'` sobre 4 `<span>` → 0 / 33.3 / 66.7 / 100 %. Las bandas de crisis están en 0-25 / 25-40 / 40-60 / 60-100 %, con **puntos medios en 12.5 / 32.5 / 50 / 80 %**:

| Banda | Rango | Punto medio | Etiqueta | Error |
|---|---|---|---|---|
| NORMAL | 0–25 | 12.5 % | 0 % | 12.5 pts |
| ELEVADO | 25–40 | 32.5 % | 33.3 % | 0.8 pts |
| ALERTA | 40–60 | 50 % | 66.7 % | **16.7 pts** |
| CRISIS | 60–100 | 80 % | 100 % | **20 pts** |

Un marcador en 55 % (banda ALERTA) queda visualmente entre "ELEVADO" y "ALERTA": quien lee la etiqueta más cercana se equivoca de banda. En `crop-mob-chart.png` los cuatro rótulos de Polarización se solapan y salen como `APÁTICAMODERADAALTAEXTREMA`.

Drift de umbrales entre las cuatro copias:

| Fuente | Stops de Polarización | Canon `metrics-display.ts:164-169` |
|---|---|---|
| `screens.js:467` | 30 / 60 (3 colores, 4 etiquetas) | 30 / 50 / 75 |
| `shell.js:1589` | 30 / 50 / 75 | ✔ |
| `screens.js:34` (crisis) | 25 / 40 / 60 con hex suelto `#E0662E` | ✔ umbrales, ✘ color |
| `shell.js:1572` (crisis) | 25 / 40 / 60, ALERTA y CRISIS **del mismo color** | ✔ umbrales, ✘ color |

**Diff conceptual**: las cuatro desaparecen y las reemplaza `BulletChart` (§3.1), que coloca cada etiqueta en el **punto medio** de su banda (`x = (from+to)/2`) con un tick fino en cada **frontera**; si dos etiquetas no caben (`ecoIsMobile()` o banda < 12 % del ancho), rota a `Legend` inline y deja sólo los ticks; y lee bandas/umbrales de `window.ECO_METRICS[metric].bands` (§2.2), no de constantes copiadas.

---

## C-09 · El parche `?? 0` del call site (P0)

`screens.js:463`: se borra el `?? 0`. `Sparkline` recibe los nulos y los dibuja como huecos según el canon. El call site no debe compensar la falta de contrato de la primitiva.

---

## C-10 · `sharedScale` rompe con negativos, y está muerta (P1)

`charts.js:212-219`:
```js
const allVals = series.flatMap((s) => data.map((d) => d[s.key] || 0));
const sharedMin = 0;                                  // ← hardcodeado
const sharedMax = Math.max(1, ...allVals);
```
Con NSS en `[-20, +5]`: `min=0`, `range=max(1,5)=5`, y para `v=-20` →
`y = innerH − ((−20−0)/5)·innerH = 5·innerH` → la línea se pinta **cuatro alturas de gráfica por debajo** del área. `sharedScale` no tiene ningún call site (`grep -n "sharedScale" screens.js shell.js` → vacío). La rama entera (212-219), sus labels de eje (293-302, que además usan `Math.round` crudo en vez del formateador de la métrica) y el condicional del área (322) se borran; los cubre `scale.mode:'shared'` con `extent()` real.

---

## C-11 · Falta `viewBox` (P1)

- `Sparkline` `charts.js:107`: `<svg width={width} height={height}>` con `width=80` default y **`width={200}`** en el único call site (`screens.js:126`). En el KPI card de móvil, de ~175px, el SVG de 200px se **recorta** por el `overflow:hidden` del `.card`. Evidencia: `crop-mob-chart.png` — los sparklines de Polarización y Volumen están cortados a media curva.
- `Donut` `charts.js:585` y `RadialGauge` `charts.js:661`: `size` fijo, sin `viewBox`.

**Diff**: los tres pasan a
```jsx
<svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
     preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby={`${id}-t`}>
```
`Sparkline` **pierde la prop `width`**; el ancho lo da el contenedor o el `viewBox`. Alto por defecto `28` (no 24: a 24px una curva de 30 puntos es indistinguible de ruido).

---

## C-12 · Crashes por datos vacíos o nulos (P1)

| Ubicación | Expresión | Falla con |
|---|---|---|
| `charts.js:126` | ``let linePath = `M ${pts[0][0]},${pts[0][1]}` `` | `data=[]` → `pts[0]` undefined → TypeError. `screens.js:2388` pasa `topic.evolution`, que puede venir vacío |
| `charts.js:121-122` | `Math.min(...vals, 0)` / `Math.max(...vals)` | nulos → dominio corrido; vacío → `Infinity` |
| `charts.js:580` | `const sum = total ?? data.reduce(…)` | `sum = 0` → `frac = 0/0 = NaN` → `d="M NaN NaN A …"` |
| `charts.js:608` | `Math.max(...items.map(i => i[valueKey]))` | `items=[]` → `-Infinity`; valor nulo → `NaN` |
| `charts.js:629` | `it[valueKey].toLocaleString('es-PR')` | valor `null`/`undefined` → TypeError |

Todos desaparecen con el `ChartFrame` de §4 (resuelve `state` **antes** de cualquier matemática) y con `num()`.

---

## C-13 · `RadialGauge max=3` (P1)

`charts.js:638`: `max = 3` y cortes de color en `654-658` (`>=2` neg, `>=1` warn, `>=0.5` warn) calibrados para una escala 0–3 que **no existe** en el producto (las reales son 0–1, 1–10, 0–100, −100..100). `colorStops` se recibe y nunca se usa. Cero call sites. **Se borra**; su lugar lo toma `BulletChart`, que es lineal y por tanto comparable entre cards (un arco no lo es).

---

## C-14 · `Heatmap` con `cellSize` fijo (P1)

`charts.js:675` (`cellSize = 16`, llamado con `14` en `screens.js:690`) y `charts.js:700-702`: cada celda es un `<div>` con `width: cellSize, height: cellSize` en un `display:flex` **sin `flexShrink: 0`**. Ancho requerido a `cellSize=14`: `28 (label) + 2 + 24·14 + 23·2 + 3·4 = 424px`. En móvil el contenedor útil es ~326px, así que el navegador **encoge sólo el ancho**: celdas de 14 de alto × ≈9.5 de ancho. Se ven como rectángulos verticales en `crop-mob-heat2.png` — la retícula deja de ser cuadrada y la lectura hora×día se distorsiona. Además cada celda es `role="button"` de 9.5×14: parte de los 369 targets <44px de los probes.

**Diff**
1. `cellSize` deja de ser prop y se **deriva**: `cell = clamp(6, floor((innerW − labelW − gaps) / hours), 22)`.
2. `flexShrink: 0` + `aspectRatio: '1 / 1'` en la celda.
3. Con `cell < 12` (móvil) el eje X se **agrupa por turnos de 3h**: 8 columnas de ~34px. Se pierde resolución horaria y se gana retícula legible y tocable; el detalle horario sigue en el drawer que abre el tap.
4. La celda es `<button>` real con `tabIndex` y el `.touch-target` de `tokens.css:437` para el área táctil de 44px sin cambiar el tamaño visual.

---

## C-15 · IDs de `<defs>` sin namespace (P1)

`charts.js:145`: `<linearGradient id="area-grad-ac">` — **constante**. Dos `AreaLineChart` en una página comparten el ID y `url(#area-grad-ac)` resuelve al primero que exista. `charts.js:283`: `id={\`mlg-${s.key}\`}` colisiona entre dos `MultiLineChart` con la misma `key` (hoy no ocurre por casualidad: el modal usa `key:'value'` y `/overview` usa `negative|neutral|positive`).

**Diff**: `id` en el contrato con fallback `React.useId()` (React 18.3.1 cargado en `index.html:1300`) y **todo** ID de `defs` prefijado: `` `${uid}-grad-${s.key}` ``.

## C-16 · Cero memoización (P1 — ver §6) · C-17 · Cero a11y (P1)

`grep -n "aria-\|<title>\|<desc>\|tabIndex\|onFocus\|onKeyDown" charts.js` → **una** coincidencia: `role={clickable ? 'button' : undefined}` en `charts.js:697`, sin `tabIndex`, así que el lector de pantalla anuncia "botón" un elemento que el teclado no alcanza — peor que no ponerlo.

## C-18 · Interacción sólo con ratón (P1 — ver §5) · C-19 · Tipografía de ejes (P1)

`fontSize="9"` en `charts.js:297`, `311`, `441`; `"10"` en `159`, `162`, `514`, `523`. Los probes cuentan **148 instancias de 9px** y **724 de 10–11px** con `--text-3` a ratio 2.65 (el viejo `#525B68`). `tokens.css` ya sube `--text-3` a `#7C8798` (5.00:1), pero el tamaño sigue bajo el piso de 12px del sistema. Ver §7.3.

## C-20 · `yDomain` nominal contra datos reales (P1)

`shell.js:1723-1729` fija `nss → [-100, 100]`. Pero hay **dos NSS** en el mismo payload:
- `<WT>/packages/shared/src/metrics.ts:159`: `nss = ((pos − neg) / total) * 100` → rango −100..100.
- `<WT>/apps/web/src/app/api/eco-data/route.ts:824` (MUNICIPALITIES): `nss = Math.round(((pos − neg)/t) * 100) / 10` → rango **−10..+10**.

En la práctica el NSS del hero es −1.9 mientras el briefing de la **misma pantalla** dice −8.4 (`shots/dashboard-desktop-fold.png`). Con `yDomain=[-100,100]`, una serie que vive en `[-4, +2]` ocupa el **3 %** de la altura: se ve plana y el usuario concluye "no pasa nada".

**Diff**: `scale.mode:'fixed'` gana un guardarraíl. Si los datos ocupan menos del 15 % del dominio declarado, se **recorta el eje** al `extent()` real *y* se muestra el contexto absoluto de dos formas simultáneas: (a) glifo de eje partido (zigzag) en la base del eje Y, (b) las `reference` bands de la métrica dibujadas en la franja visible con su etiqueta. Nunca se recorta en silencio.
```js
const declared  = metricDomain(metric);       // p.ej. [-100, 100]
const real      = extent(data, keys);         // p.ej. [-4, 2]
const occupancy = real ? (real[1]-real[0]) / (declared[1]-declared[0]) : 0;
const yDomain   = occupancy < 0.15 ? niceExtent(real, { pad: 0.15 }) : declared;
const clipped   = yDomain !== declared;       // ⇒ dibuja el zigzag + nota
```
Reconciliar las dos escalas de NSS es trabajo de otra unidad, pero **debe** hacerse o `metric:'nss'` seguirá siendo ambiguo.

---

# 2 · La API unificada

## 2.1 El contrato común (`ChartProps`)

Todas las primitivas aceptan este objeto y ninguna acepta props fuera de él (salvo las 2-3 específicas que se listan en cada firma).

```js
{
  // ── DATOS ────────────────────────────────────────────────────────────────
  data,          // Array<Row>. Row = objeto plano. La primitiva NUNCA la muta.
  series,        // Array<SeriesDef>. SIEMPRE array, aun con una sola serie.
  x,             // XDef — el eje de categorías/tiempo.

  // ── ESCALA ───────────────────────────────────────────────────────────────
  scale,         // ScaleDef. Default { mode:'shared', nice:true }.

  // ── LAYOUT ───────────────────────────────────────────────────────────────
  height,        // number | { mobile, tablet, desktop } | 'aspect'
  aspect,        // number (ancho/alto). Se usa si height === 'aspect'.
  padding,       // Partial<{t,r,b,l}>. Se MEZCLA con el padding calculado
                 // (que ya reserva sitio para tags, eje Y y leyenda).
  density,       // 'comfortable' (default) | 'compact'

  // ── FORMATO ──────────────────────────────────────────────────────────────
  format,        // (v, ctx) => string. Default de todas las series.
  formatX,       // (row, i) => string

  // ── CHROME ───────────────────────────────────────────────────────────────
  legend,        // false | 'top' | 'bottom' | 'strip' | 'inline'
  axes,          // { x?: boolean|AxisDef, y?: boolean|AxisDef }
  grid,          // false | 'y' (default) | 'x' | 'both'
  reference,     // Array<RefDef> — bandas y líneas de umbral
  tags,          // false | 'last' (default en LineChart) | 'peak'

  // ── INTERACCIÓN ──────────────────────────────────────────────────────────
  tooltip,       // false | true (default) | (ctx) => ReactNode
  crosshair,     // false | true (default) | `shared:${groupId}`
  onSelect,      // (ctx) => void   click + Enter/Space + tap
  onHover,       // (ctx|null) => void
  selected,      // number | null — índice controlado

  // ── ESTADO ───────────────────────────────────────────────────────────────
  state,         // 'ready'|'loading'|'error'|'empty'|'insufficient'|undefined
                 // undefined ⇒ la primitiva lo DERIVA de data/series (§4)
  error,         // { code?: number, message: string }
  minPoints,     // number, default 2
  emptyHint,     // string — la acción concreta que el usuario puede tomar

  // ── IDENTIDAD Y A11Y ─────────────────────────────────────────────────────
  id,            // string — prefijo de todos los IDs de <defs>. Default useId()
  title,         // string OBLIGATORIO — <title> del SVG y aria-label
  description,   // string — <desc>
  summary,       // string | (data, series, scale) => string — resumen textual
}
```

### `SeriesDef`
```js
{
  key,        // string — propiedad de Row. Obligatoria.
  label,      // string — obligatoria (hoy StackedAreaChart la deriva con
              //   charAt(0).toUpperCase(), charts.js:489-492: sale en español
              //   por suerte, no por diseño).
  color,      // string CSS. Obligatoria. Debe ser token (var(--…)).
  on,         // string CSS — primer plano sobre `color`. Default 'var(--on-cat)'
  metric,     // string|null — clave de window.ECO_METRICS. Aporta dominio,
              //   formato, unidad y bandas. Vía preferida.
  format,     // (v) => string. Gana sobre metric y sobre props.format.
  area,       // false (default) | true | number (0..1 opacidad del degradado)
  width,      // number, default 2 (1.5 en density:'compact')
  dash,       // string|null — series proyectadas o interpoladas
  nulls,      // 'gap' (default) | 'connect' | 'zero'
  visible,    // boolean, default true
  emphasis,   // 'default' | 'muted' | 'strong'
  domain,     // [min,max] — SÓLO válido en SmallMultiples
}
```

### `XDef`, `ScaleDef`, `AxisDef`, `RefDef`
```js
XDef = {
  key,          // 'date' — propiedad corta que se rotula
  full,         // 'fullDate' — ISO completo para tooltip y onSelect
  type,         // 'band' (default) | 'time' | 'linear' | 'ordinal'
  tickPolicy,   // 'auto' (default) | 'day' | 'week' | 'month' | 'first-last'
  label,        // string|null
}
ScaleDef = {
  mode,    // 'shared' (default) | 'fixed' | 'index' | 'per-series'(prohibido)
  domain,  // [min,max] — obligatorio si mode==='fixed' y no hay metric
  metric,  // string — alternativa a domain: toma el de ECO_METRICS
  nice,    // boolean, default true
  zero,    // boolean, default false — fuerza incluir el 0
  softMax, // number|false — percentil (p.ej. 97) para recortar picos con glifo
  clamp,   // boolean, default true — nunca pintar fuera del área
  steps,   // number — gridlines/ticks Y, default 4 (2 en density:'compact')
}
AxisDef = { show, ticks, format, label, side /* 'left'|'right' */ }
RefDef =
  | { kind:'band', from, to, color, label, tone }
  | { kind:'line', at, color, label, dash }
  | { kind:'target', at, label }
```

### El contexto de interacción (`ctx`)
Un solo objeto para `tooltip`, `onSelect` y `onHover` — hoy hay cuatro firmas distintas:
```js
ctx = {
  index,     // number — índice en `data`
  row,       // Row completa (para armar el _filter del slice modal)
  x,         // { raw, label, full }
  values: [  // una entrada por serie VISIBLE, en orden de `series`
    { series, raw, formatted, present /* boolean */, px: {x,y} }
  ],
  px,        // { x, y } dentro del SVG
  rect,      // DOMRect del contenedor (para el clamp del tooltip)
  source,    // 'mouse' | 'touch' | 'keyboard'
}
```
Los call sites migran con una línea: `onPointClick={openTimelineDaySlice}` → `onSelect={(c) => openTimelineDaySlice(c.row, c.index)}`.

## 2.2 El registro de métricas — dónde vive la verdad

`fmtVal` (`charts.js:243-252`) es un `switch` sobre seis claves de negocio (`nss`, `crisisRiskScore`, `brandHealthIndex`, `polarizationIndex`, `engagementRate`, `totalMentions`) **dentro de una primitiva de dibujo**. El comentario `charts.js:238-241` lo admite ("ESPEJO de @eco/shared/format … Mantener en sync") y ya se desincronizó: `fmtVal('brandHealthIndex')` devuelve `"6.2"` mientras `formatMetric('bhi')` devuelve `"6.2 / 10"` (`metrics-display.ts:250`).

La SPA no puede `import`. El endpoint sí: `route.ts` ya importa `formatMetric`/`formatDelta` y su comentario (`:352-357`) declara la intención — *"para que la SPA estática no tenga que re-derivar escalas/bandas"*. Se cierra el círculo: **la API emite el registro**.

```ts
// apps/web/src/app/api/eco-data/route.ts — bloque nuevo en la respuesta
const METRIC_SPECS = {
  nss:            { label:'Net Sentiment Score', short:'NSS', domain:[-100,100], decimals:1, signed:true, suffix:'',
                    bands:[{to:-20,band:'MUY NEG',tone:'neg'},{to:-5,band:'NEG',tone:'neg'},
                           {to:5,band:'NEUTRAL',tone:'neutral'},{to:20,band:'POS',tone:'pos'},
                           {to:100,band:'MUY POS',tone:'pos'}] },
  bhi:            { label:'Brand Health', short:'BHI', domain:[1,10], decimals:1, suffix:' / 10',
                    rawScale:'0-1', toDisplay:'1 + raw*9',
                    bands:[{to:4.6,band:'CRÍTICO',tone:'neg'},{to:6.4,band:'DÉBIL',tone:'warn'},
                           {to:8.2,band:'SANO',tone:'pos'},{to:10,band:'FUERTE',tone:'accent'}] },
  crisis:         { label:'Riesgo de crisis', short:'Crisis', domain:[0,1], decimals:0, scaleBy:100, suffix:'%',
                    bands:[{to:0.25,band:'NORMAL',tone:'pos'},{to:0.40,band:'ELEVADO',tone:'warn'},
                           {to:0.60,band:'ALERTA',tone:'alert'},{to:1,band:'CRISIS',tone:'neg'}] },
  polarization:   { label:'Polarización', short:'Polar.', domain:[0,100], decimals:0, suffix:'%',
                    bands:[{to:30,band:'APÁTICA',tone:'neutral'},{to:50,band:'MODERADA',tone:'warn'},
                           {to:75,band:'ALTA',tone:'alert'},{to:100,band:'EXTREMA',tone:'neg'}] },
  engagementRate: { label:'Engagement', domain:null, decimals:1, suffix:'%', bands:null },
  totalMentions:  { label:'Menciones',  domain:null, decimals:0, compact:true, suffix:'', bands:null },
} as const;
// …y en el JSON de respuesta:  METRIC_SPECS,
```
(Los umbrales salen literalmente de `<WT>/packages/shared/src/format/metrics-display.ts:140-179`.)

```js
// charts-core.js
const FALLBACK_SPECS = Object.freeze({ /* copia literal, para el modo respaldo
   estático de index.html:1393 cuando la API devuelve != 200 */ });
window.ECO_METRICS = Object.freeze(
  (window.ECO_DATA && window.ECO_DATA.METRIC_SPECS) || FALLBACK_SPECS
);
// Las filas de TIMELINE usan nombres largos; el spec usa claves cortas.
const KEY_TO_METRIC = {
  nss:'nss', brandHealthIndex:'bhi', crisisRiskScore:'crisis',
  polarizationIndex:'polarization', engagementRate:'engagementRate',
  totalMentions:'totalMentions',
};
function metricFormatter(metricOrKey) {
  const spec = ECO_METRICS[metricOrKey] || ECO_METRICS[KEY_TO_METRIC[metricOrKey]];
  if (!spec) return (v) => (isNum(v) ? String(Math.round(v * 10) / 10) : EMPTY);
  return (v) => {
    if (!isNum(v)) return EMPTY;
    const n = v * (spec.scaleBy || 1);
    if (spec.compact) return fmtCompact(n);                 // 4.0K
    return (spec.signed && n > 0 ? '+' : '') + n.toFixed(spec.decimals) + (spec.suffix || '');
  };
}
```
Con esto `fmtVal` **desaparece de charts.js** y las gráficas dejan de saber qué es el BHI.

## 2.3 Las 9 firmas nuevas

Mapeo respecto de las 9 actuales: `AreaLineChart` y `MultiLineChart` se **fusionan** en `LineChart` (la única diferencia real era `series[0].area`); `RadialGauge` se **borra**; `Legend` entra como primitiva porque F6 demuestra que la leyenda no puede vivir en el card.

```js
// ═══ 1 · LineChart — reemplaza MultiLineChart (charts.js:184) y AreaLineChart (115)
function LineChart({
  data, series, x = { key:'date', full:'fullDate', type:'band' },
  scale = { mode:'shared', nice:true },
  curve = 'auto',              // 'auto'|'linear'|'monotone'|'step'
  height = { mobile:200, tablet:220, desktop:260 },
  padding, density = 'comfortable',
  format, formatX,
  legend = 'strip', axes = { x:true, y:true }, grid = 'y',
  reference, tags = 'last',
  tooltip = true, crosshair = true, onSelect, onHover, selected,
  state, error, minPoints = 2, emptyHint,
  id, title, description, summary,
}) {}

// ═══ 2 · AreaStackChart — reemplaza StackedAreaChart (charts.js:455)
function AreaStackChart({
  ...ChartProps,
  stack = 'zero',    // 'zero' (apilado desde 0) | 'center' (stream) | 'expand' (100%)
  order = 'none',    // 'none'|'inside-out'|'descending'
  showTotal = true,  // fila "Total" en el tooltip (hoy hardcodeada en :562)
}) {}
// `keys` + `colors` paralelos por índice (charts.js:455) desaparecen: pasan a
// series[], lo que elimina la clase de bug "colors[ki] desalineado".

// ═══ 3 · Sparkline — reemplaza Sparkline (charts.js:97) y NarrativeSparkline
//        (screens.js:4662). Es LineChart en modo micro.
function Sparkline({
  data, series,                    // 1 serie; más de 1 ⇒ warning en dev
  x, scale = { mode:'shared' },
  height = 28, curve = 'monotone',
  band,                            // {p25,p75} — franja de contexto histórico
  tags = false, state, minPoints = 2,
  id, title,                       // OBLIGATORIO: "NSS, últimos 30 días"
  summary,                         // "de −1.2 a −1.9; mínimo −4.1 el 14 jul"
}) {}
// `width` DESAPARECE (causa del recorte en el KPI card de móvil).

// ═══ 4 · Legend — NUEVA. Única fuente de swatches. Cierra F6 estructuralmente.
function Legend({
  variant = 'series',   // 'series' | 'sequential' | 'diverging' | 'bands'
  items,                // Array<{label, color, value?, present?, muted?}>
  scale,                // ScaleDef|SeqScale — para 'sequential'/'diverging'
  bands,                // RefDef[] de kind:'band' — para 'bands'
  orientation = 'horizontal',
  interactive = false,  // click ⇒ toggle de visibilidad de serie
  onToggle,             // (key, visible) => void
  size = 'sm', hint,    // "Toca un día para ver sus menciones"
}) {}
// Los swatches se derivan SIEMPRE de scale/series. No acepta colores literales.

// ═══ 5 · BarList — reemplaza HBarList (charts.js:607)
function BarList({
  data, series,               // 1 serie ⇒ barra simple; N ⇒ apilada
  label = { key:'label', width:'auto' },  // 'auto' = 28% del ancho, min 96, max 180
  scale = { mode:'shared', zero:true },
  sort = 'desc',              // 'desc'|'asc'|'none'
  limit,                      // agrupa el resto en "Otros (N)"
  trackHeight = 8,            // 6 en density:'compact'
  showValue = true, valueWidth = 'auto',
  delta,                      // { key, invert? } — la columna Δ, hoy repetida
                              //   en SentimentBar / TopicList / DistributionBar
  onSelect, tooltip = true,
  state, error, minPoints = 1, emptyHint,
  id, title, summary,
}) {}
// labelKey/valueKey/colorFn/max desaparecen. label.width:'auto' arregla el
// label de 120px fijos (charts.js:625) que en móvil deja la barra en ~90px
// (evidencia: crop-mob-heat.png).

// ═══ 6 · SplitBar — NUEVA. Absorbe las 4 copias de la barra pos/neu/neg
//        (screens.js:2093, 2206, 4360, 5563).
function SplitBar({
  parts,                      // Array<{key,label,value,color}> — orden fijo
  total,                      // number|null — si se da, el resto se pinta void
  height = 8, radius = 'var(--r-sm)',
  showLabels = false, tooltip = true,
  onSelect,                   // (part) => void — el segmento es clickeable
  state, id, title, summary,  // "62% positivo, 24% neutral, 14% negativo"
}) {}

// ═══ 7 · Donut — reemplaza Donut (charts.js:579)
function Donut({
  data, series = [{ key:'value' }], label = { key:'name' }, colors,
  size = { mobile:96, desktop:120 }, thickness = 'auto',   // auto = size*0.13
  center,                             // { value, label } — cifra en el hueco
  legend = 'inline', tooltip = true, onSelect,
  minSlice = 0.03,                    // fracciones <3% se agrupan en "Otros"
  state, error, emptyHint, id, title, summary,
}) {}
// Guardas nuevas: sum <= 0 ⇒ state='empty' (hoy da NaN, charts.js:580);
// viewBox; gap de 1.5° entre sectores para que dos colores contiguos no se
// lean como uno.

// ═══ 8 · MatrixHeatmap — reemplaza Heatmap (charts.js:675)
function MatrixHeatmap({
  data,                       // Array<number|null> len=rows*cols ó
                              // Array<{row,col,value}> (dispersa)
  rows = { count:7, labels:DOW_ES, groupBy:null },
  cols = { count:24, labels:HOURS, groupBy:'shift' },  // 'shift' = 0-5/6-11/12-17/18-23
  scale,                      // SeqScale de seqScale() — expone .stops
  cell = 'auto',              // 'auto' = clamp(6, calc, 22)
  legend = 'top', onSelect, tooltip = true,
  state, error, emptyHint, id, title, summary,
}) {}

// ═══ 9 · GeoMap — reemplaza PRMap (charts.js:731)
function GeoMap({
  features,                   // Array<{slug,name,lat,lon, ...metrics}>
  series,                     // [{key:'count', metric:'totalMentions', label:'Menciones'}]
  scale,                      // SeqScale para el color; radio siempre √(v/max)
  height = { mobile:300, desktop:420 },
  legend = 'bottom', onSelect, tooltip = true,
  state, error, emptyHint, id, title, summary,
}) {}
// Cambios de fondo: accessor/colorFn → series+scale; los 6 hex del tooltip HTML
// (charts.js:816, 824-827: #3FD47A, #FF6A3D, #8A94A1, #E6ECF3) pasan a tokens
// leídos con getComputedStyle una vez por cambio de data-mode; el stroke
// '#0E1620' (charts.js:810) pasa a var(--canvas).
```

### Contrato de altura responsive
```js
function resolveHeight(h, aspect, width) {
  if (h === 'aspect') return Math.round(width / (aspect || 2.4));
  if (typeof h === 'number') return h;
  const bp = window.ecoBp();            // shell.js:41-45
  return h[bp] ?? h.desktop ?? 240;
}
```
`window.ecoBp()` ya re-renderiza el árbol al cambiar de breakpoint (`shell.js:36-39`). **Nunca** `viewBox` con estirado en las primitivas grandes: `useChartWidth` (`charts.js:75-94`, PR #87) da píxeles reales y mantiene exacta la matemática del click. `viewBox` **sí** en las micro (Sparkline, Donut), donde el estirado es aceptable y ahorrar un ResizeObserver por card importa (hasta 5 KPI cards por pantalla).

## 2.4 Adaptador de compatibilidad — y por qué se migra todo

Son **11** sitios de llamada, no 40. El despliegue es un único bundle `dist/` con cache-bust manual (`index.html:1416`): no existe rollout parcial, o entra todo el bundle o no entra nada. Un adaptador permanente tendría coste peor que beneficio: **congelaría la semántica defectuosa** (escala por-serie por defecto, `?? 0`, suavizado forzado), que es justo lo que se quiere eliminar. **Se migran los 11 en el mismo PR.**

El shim existe sólo para que el PR sea bisectable; se borra antes del merge. 30 líneas:

```js
// charts-legacy.js — ANDAMIO. Borrar antes del merge (WS-G11).
// Traduce las props viejas SIN reproducir los bugs:
//  · la escala por-serie NO se reproduce → 'shared' (arregla F2 de una)
//  · smooth ausente ya no fuerza curva    → curve:'auto' (arregla F3)
//  · valueFormat/fmtVal → series[].format / metric
(function () {
  const C = window.ECO_CHARTS_NEXT;
  const S = (series) => (series || []).map((s) => ({
    key: s.key, label: s.label, color: s.color, on: 'var(--on-cat)',
    metric: window.ECO_CHART_CORE.metricOf(s.key),
  }));
  window.ECO_CHARTS = {
    ...C,
    MultiLineChart: ({ data, series, height, onPointClick, smooth, yDomain, valueFormat }) =>
      React.createElement(C.LineChart, {
        data, series: S(series), height,
        scale: Array.isArray(yDomain) ? { mode:'fixed', domain:yDomain } : { mode:'shared', nice:true },
        curve: smooth ? 'monotone' : 'auto',
        format: valueFormat,
        onSelect: onPointClick ? (c) => onPointClick(c.row, c.index) : undefined,
        title: 'Evolución temporal',            // el call site DEBE dar uno real
      }),
    AreaLineChart: ({ data, accessor, height, color }) =>
      React.createElement(C.LineChart, {
        data: data.map((r) => ({ ...r, __v: accessor(r) })), height,
        series: [{ key:'__v', label:'Valor', color, area:true }],
        title: 'Evolución',
      }),
    HBarList: ({ items, labelKey, valueKey, colorFn, onItemClick, trackHeight }) =>
      React.createElement(C.BarList, {
        data: items, label: { key: labelKey || 'label' },
        series: [{ key: valueKey || 'value', label:'Valor', color:'var(--cat-1)' }],
        colorFn, trackHeight,
        onSelect: onItemClick ? (c) => onItemClick(c.row, c.index) : undefined,
        title: 'Distribución',
      }),
    // Heatmap, Donut, Sparkline, StackedAreaChart, PRMap: análogos.
    RadialGauge: () => null,     // muerta: no hay a quién compatibilizar
  };
})();
```

Las 11 migraciones, línea por línea:

| # | Ubicación | Antes | Después |
|---|---|---|---|
| 1 | `screens.js:126` | `<Sparkline data width={200} height={30} color />` | `<Sparkline data series={[{key,label,color:accent,metric}]} height={28} title={…} />` |
| 2 | `screens.js:508` | `<MultiLineChart data={D.TIMELINE} series height={240} onPointClick />` | `<LineChart … scale={{mode:'index'}} legend="strip" axes={{y:true}} onSelect title="Evolución multi-métrica" />` — `'index'` porque las 3 series elegibles tienen unidades distintas |
| 3 | `screens.js:542` | `<HBarList items colorFn onItemClick />` | `<BarList data={D.TOP_SOURCES} label={{key:'source'}} series={[{key:'count',label:'Menciones',color:'var(--cat-1)'}]} … />` — y el `colorFn` con `news → var(--pos)` se sustituye por `--cat-1..8` en orden: hoy "Noticias" se pinta **verde** en un tablero de sentimiento (`crop-mob-heat.png`) |
| 4 | `screens.js:684` | `<Heatmap data colorFn cellSize={14} onCellClick />` | `<MatrixHeatmap data scale={seq} legend="top" onSelect title="Actividad por hora y día" />` + borrar `screens.js:670-678` |
| 5 | `screens.js:1646` | `<Donut data size={110} thickness={14} colors />` | `<Donut data series label center legend="inline" onSelect title="Reparto de sentimiento" />` |
| 6 | `screens.js:1683` | `<StackedAreaChart data keys colors labels height onPointClick />` | `<AreaStackChart data series stack="zero" legend="bottom" onSelect title="Sentimiento en el tiempo" />` + borrar la leyenda manual `1686-1690` |
| 7 | `screens.js:2388` | `<AreaLineChart data accessor height color />` | `<LineChart data series={[{key:'count',area:true,…}]} title={\`Evolución de ${topic.name}\`} />` |
| 8 | `screens.js:2779` | `<PRMap municipalities accessor colorFn onMunicipalityClick />` | `<GeoMap features series scale legend="bottom" onSelect title="Menciones por municipio" />` |
| 9 | `screens.js:2799` | `<HBarList … />` | `<BarList … />` |
| 10 | `screens.js:4344` | `<MultiLineChart … smooth={true} />` | `<LineChart … scale={{mode:'shared',nice:true,zero:true}} curve="monotone" axes={{y:true}} />` ← **el arreglo de F2** |
| 11 | `shell.js:1714` | `<MultiLineChart … yDomain valueFormat />` | `<LineChart … scale={{mode:'fixed',metric:metricKey}} reference={bandsOf(metricKey)} />` ← y borrar `bandConfig()` (`shell.js:1568-1602`) |

---

# 3 · Primitivas nuevas

Coste en líneas de SVG a mano (referencia: `MultiLineChart` son 268 líneas).

## 3.1 `BulletChart` — **P0. La que más falta.**

**Por qué**: hay **cinco** implementaciones de "valor contra bandas" (`screens.js:443-450`, `466-473`, `611-646`, `4295-4300`, `shell.js:1676-1685`), las cinco con C-08 y tres con umbrales que no coinciden con `@eco/shared/format`. F12 del brief general —"las 5 métricas del hero en 5 lenguajes visuales"— **es** este problema.

**Dónde**: los 5 KPI cards del Scorecard (`screens.js:430-474`), `OverviewTermometro`/`OverviewHighlights` (`screens.js:4187`, `4253`), `MetricInsightModal` (`shell.js:1676`), `ExecCompositeStrip` (`screens.js:5588`), la tabla de agencias de `TablaScreen`.

```js
function BulletChart({
  value,                    // number|null — valor crudo de la métrica
  metric,                   // string — clave de ECO_METRICS: domain + bands
  domain, bands,            // alternativa explícita si no hay metric
  target,                   // number|null — objetivo (línea vertical gruesa)
  comparison,               // number|null — período anterior (marca fantasma)
  orientation = 'horizontal',
  height = 8,               // grosor de la barra de bandas
  labels = 'auto',          // 'auto' | 'boundaries' | 'bands' | false
                            //   'auto': 'bands' si cada banda ≥12% del ancho
                            //           y no es móvil; si no, 'boundaries'
  showValue = true, tooltip = true, onSelect,
  state, id, title, summary,
}) {}
```
Reglas de dibujo (las que hoy se rompen):
- Bandas con `--band-ok/--band-watch/--band-alert/--band-crit` (§7.3), **no** un `linear-gradient` con stops escritos a mano.
- Ticks de 1px en cada **frontera**; etiquetas en el **punto medio** (`x = ((from+to)/2 − dmin)/(dmax − dmin)`).
- Marcador: barra vertical de 2px `--text`, alto `height+6` — no un círculo de 12px que tapa la frontera (`screens.js:445`).
- `comparison` como triángulo hueco bajo la barra.
- `value === null` ⇒ bandas al 40% de opacidad y "—" en lugar del marcador.

**Coste**: ~120 líneas. Retira ~150 ad-hoc. **Neto negativo.**

## 3.2 `SmallMultiples` — P1

**Por qué**: es la respuesta honesta a lo que hoy resuelve la escala por-serie (C-02). "Quiero ver la forma de cada serie" es legítimo; la solución es un panel por serie.

**Dónde**: `/dashboard` cuando el usuario marca 3 métricas de unidades distintas (`screens.js:485-503`); `/topics` (8 tópicos × 30 días); `TablaScreen`/`RadarScreen` (4 agencias × 4 métricas); `EmotionsCard` (`screens.js:1788`).

```js
function SmallMultiples({
  data, series,             // N series ⇒ N paneles
  x, scale = { mode:'per-series', nice:true },   // AQUÍ sí es correcto
  cols = 'auto',            // 'auto' = ecoCols(4,1,2)
  panelHeight = 72,
  chart = 'line',           // 'line'|'area'|'bar'
  sharedX = true,           // eje X sólo en la fila inferior
  syncCrosshair = true,     // §5.4
  sortBy,                   // (series, data) => number
  onSelect,                 // ctx incluye ctx.series
  state, id, title, summary,
}) {}
```
Cada panel es un `Sparkline` con su propio `extent()` **y su propio par min/max rotulado** en la esquina — es lo que hace legítima la escala independiente: el rango está escrito. **Coste**: ~90 líneas (reusa `Sparkline`).

## 3.3 `Streamgraph` — P1, y **no es una primitiva nueva**: es `stack:'center'`

**Por qué**: ya existe, mal ubicado. `NarrativeStreamgraph` (`screens.js:5237-5389`, 152 líneas) tiene `viewBox` de 1080×240 **fijo** (`:5238-5239`, `:5312`), lo que en móvil comprime el eje X 3.5× y deja las áreas de click de un día en `Math.max(1, x1-x0)` ≈ 1px (`:5329`); usa su propio `smoothPath` con overshoot; y tiene un `rgba(63,181,216,0.18)` (`:5331`) que no es de ningún tema activo.

**Dónde**: `/narrative` (donde está) y el caso que pide el brief de sistemas — evolución de términos dentro de una narrativa, que es la forma natural de mostrar el `drift_score` que hoy nunca se le muestra al usuario. **Coste**: ~20 líneas dentro de `AreaStackChart` + borrar 152 de `screens.js`.

## 3.4 `SlopeChart` — P1

**Por qué**: "¿qué tópicos subieron y bajaron de puesto?" hoy se responde con una columna Δ de texto (`screens.js:2214-2217`, `RankDelta` en `:5578`). Una columna de flechas no muestra los **cruces**, que es la información: que "Permisos" pase de 5º a 1º importa más que su −8%.

**Dónde**: `/topics` (ranking período vs anterior), `TablaScreen` (agencias por BHI), Overview §04 (`screens.js:4350`).

```js
function SlopeChart({
  data,                   // Array<{label, from, to, fromRank?, toRank?}>
  series = [{ key:'from', label:'Período anterior' }, { key:'to', label:'Actual' }],
  scale = { mode:'shared' },
  rank = true,            // true ⇒ el eje Y es la POSICIÓN (1..N) invertida
  height = { mobile:280, desktop:340 },
  emphasize = 'crossings',// 'crossings'|'top:N'|'none'
  labelSide = 'both', onSelect, tooltip = true,
  state, id, title, summary,
}) {}
```
Color: `--div-pos-2` sube, `--div-neg-2` baja, `--div-mid` estable. Desconflicto vertical de etiquetas (empuje iterativo, 12 pasadas, mínimo 14px). **Coste**: ~110 líneas.

## 3.5 `TermsChart` + `WordCloud` — P1 (el pedido explícito del usuario)

**Por qué**: el usuario pidió literalmente "nubes de palabras, algo bien dinámico y bien hecho" (SYSTEMS-BRIEF §B). Pero una nube codifica magnitud en **área de glifo**, que se lee mal, y con el corpus de ECO (español de PR, titulares + posts + comentarios, con "Puerto Rico", "gobierno" y los nombres de agencia como ruido garantizado) una nube ingenua es una nube de stopwords de dominio. Se envían **las dos**: `TermsChart` para análisis, `WordCloud` para presentación.

**Dónde**: `/mentions` (`MentionsScreen`, `screens.js:785`), `TopicDetail` (`screens.js:2226`), y `/narrative` para los términos presentes en la ventana reciente y **ausentes** de `centroid_at_naming` — la señal de novedad que hoy no se muestra.

```js
function TermsChart({
  data,                   // Array<{term, count, delta?, sentiment?, docFreq?}>
  metric = 'count',       // 'count' | 'tfidf' | 'lift'   (lift = novedad)
  limit = 25,
  colorBy = 'sentiment',  // 'sentiment'|'delta'|'none' — 'none' ⇒ --cat-1
  showDelta = true, showBar = true,
  onSelect,               // (ctx) ⇒ filtra /mentions por ese término
  state, emptyHint, id, title, summary,
}) {}

function WordCloud({
  data, limit = 60,
  sizeRange = [12, 44],   // px; escala √(count) — área proporcional, no altura
  colorBy = 'sentiment',
  layout = 'spiral',      // 'spiral' (arquimedeana) | 'rows' (fallback estable)
  seed = 1,               // determinista: mismo dato ⇒ misma nube
  rotate = false,         // FALSE por defecto: el texto rotado es ilegible y
                          //   rompe la selección por teclado
  onSelect, tooltip = true,
  state, emptyHint, id, title, summary,
}) {}
```

**Decisión de librería (restricción del brief)**: el placer se **escribe a mano**, opción (c).
- Descartado (b) CDN: `d3-cloud` arrastra `d3-dispatch` y en la práctica `d3-array`/`d3-scale` → 3 `<script>` con `integrity` que mantener, ~45KB, para 150 líneas de algoritmo.
- Descartado (a) embebido: `d3-cloud` es ESM y usa un canvas de sprite-mask; portarlo a script clásico es más trabajo que reescribirlo.
- El placer propio: espiral arquimedeana + máscara AABB, con un `<canvas>` 1×1 fuera de pantalla y `measureText` para medir el ancho real de cada palabra. Determinista con `seed`. ~150 líneas + ~40 de medición. **Además** `measureText` es lo único que da anchos correctos con Krub/Besley, que un port no resolvería mejor.
- Salvaguarda: si en 400 intentos una palabra no cabe, se descarta y se cuenta; la nube muestra "18 de 60 términos no caben — ver lista" con enlace a `TermsChart`. Nunca se dibujan palabras encimadas.

**Backend (dependencia, fuera de esta unidad)**: el brief confirma que **no existe** columna de términos ni índice FTS. Hace falta `/api/eco-terms`. Postgres 16 trae la configuración `spanish`; el camino barato es `ts_stat` sobre una vista materializada por agencia y ventana, con stopwords de dominio (nombres de agencia, "puerto rico", "gobierno", handles, URLs, emoji) y `unaccent`. Hay que **verificar** que `pg_trgm`/`unaccent` estén instaladas antes de asumirlo. Sin ese endpoint, ambas quedan en `state:'empty'` con `emptyHint`.

## 3.6 `CalendarHeatmap` — P1 (extracción)

**Por qué**: `TopicCalendar` (`screens.js:2446-2625`, **180 líneas**) es un calendario a mano con paleta de 8 hex sin tokenizar (`:2448`), una segunda paleta de 3 hex para sentimiento (`:2454`: `#2E8B6A`, `#C2412F`, `#7C8698`) que no son ni `--pos` ni `--neg`, opacidad concatenada como hex a pelo (`:2559`: `` `${color}${Math.round(intensity*255).toString(16).padStart(2,'0')}` ``), un `rgba(255,255,255,0.9)` residual (`:2573`) y una leyenda de opacidad con tres hex más (`:2610-2612`).

```js
function CalendarHeatmap({
  data,                   // Array<{date /*ISO*/, value, category?, sentiment?}>
  from, to,               // ISO — el rango, para pintar los días sin dato
  scale,                  // SeqScale (intensidad) o categórica
  encode = 'intensity',   // 'intensity' | 'category' | 'both'
  cell = 'auto', weekStart = 1,
  monthLabels = true, dayLabels = true, legend = 'side',
  onSelect, tooltip = true,
  state, emptyHint, id, title, summary,
}) {}
```
Días fuera del rango de datos: `--chart-void` con la diagonal del canon de nulos (hoy son celdas vacías indistinguibles de un día con volumen 0). **Coste**: ~130 líneas. Retira 180. **Neto negativo.**

## 3.7 `Waterfall` — P2

**Por qué**: cuando el NSS cae de −1.2 a −1.9, la única explicación disponible es el párrafo de IA del briefing. Un waterfall responde "qué tópico aportó cuánto" con aritmética verificable: es la gráfica que dice **dónde intervenir**.

**Dónde**: `MetricInsightModal` (`shell.js:1736-1751`, donde hoy hay barritas de `share` sin signo ni suma), Overview §03/§04, y el correo semanal comparativo.

```js
function Waterfall({
  start,                  // { label:'NSS 21 jul', value:-1.2 }
  steps,                  // Array<{label, delta, tone?, drill?}>
  end,                    // { label:'NSS 27 jul', value:-1.9 } — se VALIDA
  scale = { mode:'shared', zero:true },
  height = { mobile:260, desktop:300 },
  connectors = true, tolerance = 0.05,
  onSelect, tooltip = true, state, id, title, summary,
}) {}
```
Regla dura: si `|start + Σdelta − end| > tolerance`, la primitiva **no dibuja un waterfall bonito**: pinta la barra "no explicado" en `--chart-void` con la diferencia rotulada. Una descomposición que no cierra es una descomposición falsa. **Dependencia**: descomposición por tópico en el backend (`mention_topics.confidence` para el reparto). No la hay hoy. **Coste**: ~100 líneas.

## 3.8 `Beeswarm` — P2

**Por qué**: sustituye a `TopicBubbles` (`screens.js:2115-2178`), cuyo layout es un packing pseudo-aleatorio (`Math.sin(i*9973)*10000`, `:2123`) donde **la posición no significa nada**. Un beeswarm sobre un eje real (volumen, NSS, engagement) hace que la posición signifique algo y mantiene el "look" de burbujas que el usuario ya conoce.

```js
function Beeswarm({
  data, x: { key, metric }, size: { key, range=[6,26] },
  colorBy, groupBy,       // groupBy ⇒ una fila por grupo
  height = { mobile:220, desktop:280 },
  onSelect, tooltip = true, labels = 'top:8',
  state, id, title, summary,
}) {}
```
Layout: barrido ordenado por `x` con desplazamiento vertical al primer hueco libre (O(n·k), determinista, sin simulación). **Coste**: ~70 líneas.

## 3.9 `Sankey` — P2

**Por qué**: la genealogía de narrativas (`split`/`merge`/`spawn`) es el caso claro. **Pero** el brief es explícito: `narrative_edges.edge_type` sólo tiene `co_occurrence`, `author_overlap` y similitud de centroide — **no hay** `split`/`merge`, así que hoy un Sankey de narrativas no tiene nada que dibujar. Segundo caso, este sí viable: **fuente → sentimiento → tópico** con lo que ya emite `/api/eco-data`.

```js
function Sankey({
  nodes,                  // Array<{id, label, layer, color?}>
  links,                  // Array<{source, target, value}>
  layers,                 // Array<string> — 2 o 3; más de 3 se rechaza
  height = { mobile:320, desktop:420 },
  nodeWidth = 12, nodePadding = 10,
  onSelect, tooltip = true, state, id, title, summary,
}) {}
```
**Librería**: a mano, restringido a 2–3 capas. `d3-sankey` (12KB) arrastra `d3-array` + `d3-shape` (~60KB) y su valor está en minimizar cruces en grafos grandes; con ≤12 nodos por capa basta ordenar por valor descendente. **Coste**: ~120 líneas.

## 3.10 Lo que NO se debe construir

- **Treemap real** (squarified). `TopicTreemap` (`screens.js:2049`) no es un treemap: es un grid 4×N con `span 2` para los dos primeros (`:2055-2056`), así que **el área no es proporcional al valor**. Un treemap de verdad es peor que `BarList` para ≤12 tópicos: los rectángulos de proporción extrema no se comparan. Recomendación: renombrarlo `TopicGrid` (quitarle el nombre que promete proporcionalidad) o reemplazarlo por `BarList`.
- **Radar**. `RadarScreen` (`screens.js:5840`) existe; no se le añade primitiva. Un radar con 4 ejes de unidades distintas es la misma falacia que la escala por-serie, en polar.

---

# 4 · Estados y esqueleto

## 4.1 Los 4 dialectos actuales

| Dialecto | Ubicaciones | Aspecto |
|---|---|---|
| String centrado en el cuerpo | `charts.js:198`, `:464`, `:856`, `screens.js:1722`, `:2463`, `:4326`, `:4354`, `shell.js:1710` | "Sin datos suficientes para graficar." · `fontSize:12` · `--text-3` |
| `.skeleton` (shimmer) | `index.html:422-431`, usado en `shell.js:1302-1304`, `screens.js:4568-4570` | 3 barras de 14px |
| Clases de narrativa | `screens.js:4941`, `5097`, `5099`, `5115`, `5117`, `5139`, `5141`, `5166`, `5244`, `5246`, `5428`, `5430` | `.narrative-empty` / `.narrative-empty-small` |
| `ExecStateWrap` | `screens.js:5517-5548` | el único que distingue `loading`/`error`/`empty` y el único que trata el 403 |

Diez textos distintos: "Sin datos suficientes para graficar.", "…para graficar la serie.", "Sin datos", "Sin datos temporales todavía.", "Sin datos para el período seleccionado.", "Sin datos de tendencia en el periodo.", "Sin actividad de tópicos en este periodo.", "Sin datos para esta dimensión en el periodo.", "Cargando…", "Cargando timeline…".

## 4.2 La máquina canónica

**Cinco estados, en este orden de precedencia.** Los resuelve `ChartFrame` **antes** de cualquier cálculo, lo que hace imposibles los crashes de C-12.

```js
// charts-core.js
function resolveState({ state, error, data, series, minPoints }) {
  if (state) return state;                                   // override explícito
  if (error) return 'error';
  if (data == null) return 'loading';                        // ← null ≠ []
  if (!Array.isArray(data) || data.length === 0) return 'empty';
  if (!Array.isArray(series) || series.length === 0) return 'empty';
  const measured = series.reduce((n, s) => n + countMeasured(data, s.key), 0);
  if (measured === 0) return 'empty';
  if (data.length < (minPoints ?? 2)) return 'insufficient';
  return 'ready';
}
```
`data == null` ⇒ `loading` es la regla que elimina los `{loading ? … : …}` de los call sites: el fetch inicializa a `null`, no a `[]`.

| Estado | Qué se ve | Alto | Texto | Acción |
|---|---|---|---|---|
| `loading` | **esqueleto con la forma de la gráfica**: eje Y de 4 gridlines `--hairline` + un `<path>` de silueta en `--chart-void` con el `shimmer` de `index.html:423`. Nunca texto. | el `height` resuelto | ninguno | ninguna |
| `ready` | la gráfica | — | — | — |
| `insufficient` | la gráfica **dibujada** con lo que hay (1 dot + tag) + un pie | `height` | «Sólo **{n}** día{s} con datos en este período.» | `chip` "Ampliar a 30 días" ⇒ `setPeriod('30D')` |
| `empty` | marco del eje **presente**, área con la diagonal de `--chart-void`, icono `Inbox` 20px `--text-3` | `height` | «Sin menciones que graficar.» + `emptyHint` | `emptyHint` obligatorio y **accionable** ("Quita el filtro de fuente" / "Prueba un período más amplio") |
| `error` | marco presente, franja `--neg-bg` con borde izquierdo `--neg` 2px | `height` | 403 → «Sin acceso a estos datos.» · 429 → «Demasiadas solicitudes; reintentando…» · resto → «No se pudieron cargar los datos.» + `code` en `--text-3` | "Reintentar" cuando el call site pasa `onRetry` |

**Reglas transversales**

1. **La altura no cambia entre estados.** El `height` resuelto se reserva siempre. Hoy `charts.js:197` usa `minHeight` con `display:flex` y `screens.js:4325` usa `padding:24`, así que la página **salta** al llegar los datos. Cero layout shift.
2. El texto crudo del error **nunca** se muestra. `shell.js:1698` imprime `{error}` tal cual y `screens.js:5535` interpola `error.message`: un stack o un mensaje de Postgres delante de un usuario de gobierno. Lo técnico va a `console.error` y al `<desc>`.
3. Un estado no-`ready` **es** un `<figure>` con `role="img"` y `aria-label` que dice el estado: un lector de pantalla debe distinguir "cargando" de "vacío".
4. `.narrative-empty` / `.narrative-empty-small` se borran de `index.html`. `ExecStateWrap` (`screens.js:5517`) se conserva como envoltorio de **pantalla** (su manejo del 403 es correcto y de mayor granularidad) pero delega los textos a los constantes del núcleo.

```jsx
// charts-core.js — el envoltorio único
function ChartFrame({ state, error, height, title, description, summary,
                      emptyHint, onRetry, children, id }) {
  const H = height;
  return (
    <figure role="group" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
            style={{ margin: 0, width: '100%', minHeight: H, position: 'relative' }}>
      <figcaption id={`${id}-t`} className="sr-only">{title}</figcaption>
      <p id={`${id}-d`} className="sr-only">{description || summary}</p>
      {(state === 'ready' || state === 'insufficient') ? children : null}
      {state === 'loading'      && <ChartSkeleton height={H} />}
      {state === 'empty'        && <ChartEmpty height={H} hint={emptyHint} />}
      {state === 'error'        && <ChartError height={H} error={error} onRetry={onRetry} />}
      {state === 'insufficient' && <ChartInsufficientNote />}
      {/* Tabla oculta: el dato exacto para lector de pantalla y para copiar. */}
      {state === 'ready' && <ChartDataTable id={id} />}
    </figure>
  );
}
```

---

# 5 · Interacción

## 5.1 Tooltip: un solo componente

Hoy hay tres tooltips: `charts.js:388-404` y `charts.js:547-568` son **el mismo código copiado** (`tooltipW = 180`, `tooltipH = 22 + n*18`, `rx=6`), y `charts.js:822-830` es HTML dentro de un `bindTooltip` de Leaflet con 4 hex hardcodeados. Más los `title=""` nativos de `charts.js:699`, `screens.js:2553`, `screens.js:4367-4369`.

Problemas concretos del tooltip SVG actual:
- `tooltipW = 180` **constante**: una etiqueta larga se desborda del rect sin recorte (no hay `clipPath`).
- El clamp es sólo horizontal y sólo contra `innerW` (`charts.js:371`). No hay clamp vertical, y `tooltipY = 0` fijo (`:372`) hace que tape las gridlines superiores y, con 6 series, se salga del `height`.
- Sin `pointerEvents="none"` en el `<g>` de MultiLineChart (sí lo tiene el de StackedAreaChart, `:541`): el propio tooltip intercepta el `mousemove` y parpadea.
- Al estar en el `<svg>` no puede desbordar el card, así que en cards de 1/3 de ancho se apila sobre los datos.

**Contrato nuevo** — un `ChartTooltip` en un portal HTML, no en SVG:
```js
function ChartTooltip({ ctx, container, anchor = 'cursor', delay = 60,
                        maxWidth = 260, render }) {}
```
```
POSICIÓN
  1. Preferencia: a la derecha del cursor, +12px, alineado por su borde superior
     con el punto de la primera serie.
  2. Volteo horizontal si left + w + 12 > containerRight (clamp contra el RECT
     DEL CARD, no contra innerW).
  3. Volteo vertical si top + h + 12 > containerBottom; si tampoco cabe arriba,
     se ancla a containerTop + 8 (nunca sale de la ventana).
  4. Nunca tapa el punto activo: si el rect final contiene (px.x, px.y), se
     desplaza 16px en el eje con más holgura.
  5. Ancho: min(maxWidth, max(160, textoMásLargo + 24)). Overflow del label con
     ellipsis + title completo.

CONTENIDO (orden fijo, siempre el mismo)
  · línea 1: fecha larga — row[x.full] || row[x.key], en --fs-caption --fw-bold.
    Con x.type==='time', formato es-PR "lun 27 jul".
  · una línea por serie VISIBLE, en el orden de `series` (NO reordenado por
    valor: el orden estable es lo que permite comparar entre días):
      [swatch 8×8 rx2 series.color] label … valor formateado (tabular)
    Ausencia ⇒ '—' en --text-3, swatch al 30%.
  · línea "Total" sólo si showTotal y el stack es aditivo.
  · pie opcional --text-3: "click para ver menciones" — sólo si hay onSelect y
    source === 'mouse'.

TIEMPOS
  · apertura: 60ms de retardo (evita el flicker al cruzar la gráfica)
  · movimiento con el tooltip abierto: 0ms (sigue al cursor)
  · cierre: 120ms de gracia (permite pasar el cursor por encima del tooltip)
  · prefers-reduced-motion: sin transición de opacidad (los --dur-* ya se
    anulan en tokens.css:145-152)
```
El tooltip de Leaflet (`charts.js:822-830`) se reescribe con el mismo `render` para que mapa y gráficas digan lo mismo, y sus 4 hex pasan a valores leídos con `getComputedStyle` una vez por cambio de `data-mode` (ya hay un `MutationObserver` sobre `data-mode` en `charts.js:776-777` donde engancharlo).

## 5.2 Hover vs foco

Hoy: `charts.js:278` (`onMouseMove`/`onMouseLeave`), `:486`, `:709-718` (Heatmap, con mutación directa de `style.transform` en el handler). **Cero** `onFocus`, cero `tabIndex`, cero `onKeyDown`.

```
El estado "activo" es UNO, con tres orígenes: mouse, touch, keyboard.
  hover  → activo, ctx.source='mouse'
  focus  → activo, ctx.source='keyboard', + anillo :focus-visible
           (tokens.css:455 ya define outline 2px --accent, offset 2)
  tap    → activo Y SELECCIONADO (§5.3)

TECLADO (obligatorio en toda primitiva con onSelect)
  El contenedor lleva tabIndex={0} y role="application" con aria-label.
  ← / →         punto anterior / siguiente (sin wrap)
  Home / End    primer / último punto
  PageUp/Down   ±7 puntos (una semana)
  ↑ / ↓         serie anterior / siguiente cuando hay >1 (mueve el foco de
                lectura, no el índice X)
  Enter / Space onSelect(ctx)   ← hoy imposible: el click está en el <svg>
  Escape        limpia el activo
  El punto enfocado se anuncia con aria-live="polite" en un div sr-only:
    "27 de julio. Negativo 43. Neutral 54. Positivo 36."
```

## 5.3 Táctil

Hoy inalcanzable: crosshair, strip de valores y tooltips son `mouseMove`-only, y el subtítulo del card dice literalmente "pasa el cursor para ver valores" (`screens.js:482`, visible en `crop-mob-chart.png`) en un teléfono.

```
CONTRATO TÁCTIL
  1. Pointer Events, no Mouse Events: onPointerDown/Move/Up con e.pointerType
     ('mouse'|'touch'|'pen'). Un solo camino de código. setPointerCapture en el
     down para no perder el arrastre al salir del SVG.
  2. Primer tap = activa el punto más cercano y muestra el tooltip (NO navega).
     Segundo tap sobre el MISMO punto = onSelect. Patrón "tap-to-reveal,
     tap-to-commit"; sin él un tap abriría el drawer sin que el usuario haya
     visto el valor.
  3. Arrastre horizontal = barrido del crosshair. touch-action: pan-y en el
     contenedor: el scroll vertical de la página sigue, el barrido horizontal
     es de la gráfica.
  4. Zona de impacto mínima 44×44 px CSS, independiente del tamaño de la marca:
     · LineChart/AreaStack: bandas invisibles de max(44, step) de ancho, una por
       punto (<rect fill="transparent">), como ya hace el streamgraph en
       screens.js:5326-5333 pero con ancho mínimo garantizado.
     · MatrixHeatmap: .touch-target de tokens.css:437-444 sobre cada celda.
     · BarList/SplitBar: la FILA entera es el target, no la barra.
  5. onSelect se dispara con source:'touch' y el tooltip persiste hasta el
     siguiente tap fuera (no hay "mouse leave" en táctil).
  6. Los copys "pasa el cursor" pasan a "toca un día" cuando
     matchMedia('(pointer: coarse)'). Hoy: screens.js:482, 1680, 4335, 5310,
     4760.
```

## 5.4 Crosshair compartido

`SmallMultiples` y las dos gráficas apiladas de `/sentiment` (`screens.js:1683` + `EmotionsCard`) deben moverse juntas. Sin librería de estado:

```js
// charts-core.js — bus mínimo, un canal por groupId
const busses = new Map();
function useCrosshairGroup(groupId, localIndex, setLocalIndex) {
  React.useEffect(() => {
    if (!groupId) return;
    if (!busses.has(groupId)) busses.set(groupId, new Set());
    const subs = busses.get(groupId);
    const fn = (i) => setLocalIndex(i);
    subs.add(fn);
    return () => { subs.delete(fn); if (!subs.size) busses.delete(groupId); };
  }, [groupId]);
  return React.useCallback((i) => {
    if (!groupId) { setLocalIndex(i); return; }
    for (const fn of busses.get(groupId) || []) fn(i);
  }, [groupId]);
}
```
`crosshair="shared:sentiment"` en dos gráficas las sincroniza. **El bus es por índice, no por fecha**: es responsabilidad del call site que las gráficas de un grupo compartan longitud y orden. Se valida en desarrollo.

---

# 6 · Rendimiento

## 6.1 El coste actual, contado

`MultiLineChart` con `n=365`, 3 series, `innerW≈975`:

| Bloque | Línea | Nodos |
|---|---|---|
| `<defs>` gradientes | 282-287 | 9 |
| gridlines | 293-302 | 10 |
| relleno de área | 322-330 | 1 path (365 segmentos C) |
| líneas | 334-343 | 3 paths (364 segmentos C cada uno) |
| **dots por día por serie** | **349-361** | **3 `<g>` + 1.095 `<circle>`** |
| tags de último valor | 410-420 | 9 |
| labels X | 425-443 | 19 |
| **tick marks por día** | **445-447** | **365 `<line>`** |
| **Total** | | **≈ 1.510 elementos SVG** |

Y **nada está memoizado** (`grep "useMemo\|React.memo" charts.js` → 0 coincidencias). `onMove` (`charts.js:231-236`) llama `setHover(idx)` en cada `mousemove`, lo que re-ejecuta el cuerpo completo: se recalcula `normalized` (3 × 365 lecturas + 6 spreads), se reconstruyen los 4 paths (≈1.460 segmentos de bezier formateados a string) y se recrean los 1.510 elementos React para que el reconciliador los compare. A ~60 eventos/s son **~90.000 comparaciones de elemento por segundo** y ~87.000 formateos de número, sin `requestAnimationFrame`.

Además `hoverIdx = hover == null ? data.length - 1 : hover` (`charts.js:229`) hace que el strip superior muestre **siempre** el último día cuando no hay hover, sin decir que es el último: parece el valor "actual" cuando es el del cierre del período.

## 6.2 Presupuesto y reglas

```
PRESUPUESTO DE NODOS (por gráfica)
  ≤ 240 en la capa estática · ≤ 24 en la capa de hover.

REGLAS DE DENSIDAD (todas función de step = innerW / (n-1))
  dots por punto        sólo si step ≥ 8px   (n ≤ 122 a innerW=975)
  tick marks por punto  sólo si step ≥ 6px   (n ≤ 163)
  curve='monotone'      sólo si n ≤ 60; con n > 60 ⇒ 'linear'
  labels X              tickIndices() de §C-06 (≈23 máximo)
  tags de último valor  sólo si tags !== false Y no es móvil

SEPARACIÓN EN CAPAS (lo que hace posible el presupuesto de hover)
  <StaticLayer>  ejes, grid, bandas, áreas, líneas, dots, tags, labels
                 → React.memo con comparador propio sobre
                   (data, series, scale, w, h, density)
  <HoverLayer>   crosshair (1 line) + N dots (≤6) + banda activa (1 rect)
                 → el ÚNICO que re-renderiza al mover el cursor: ≤10 nodos
  Tooltip        en portal HTML (§5.1), fuera del árbol del SVG

  onPointerMove acumula en un ref y hace flush en requestAnimationFrame: como
  máximo un setState por frame, no uno por evento.
```
Resultado con `n=365`, 3 series: **≈54 nodos estáticos** (3 paths + 5 gridlines + 5 ticks Y + 23 labels X + 9 de tags + 9 de defs) memoizados, y **≈10 nodos** re-renderizados por frame. De ~1.510 reconciliaciones por evento a ~10.

## 6.3 Downsample (LTTB): cuándo, y cuándo no

**Con 365 puntos LTTB no hace falta.** A `innerW=975` cada punto ocupa 2.7px: el `<path>` tiene 364 segmentos, trivial para el rasterizador; el coste real son los 1.095 `<circle>`, y eso lo resuelve el presupuesto de densidad, no el downsample. Aplicar LTTB a 365 días sería **perder fidelidad sin ganar nada**, y rompería el mapeo índice→fecha del crosshair.

LTTB entra sólo con más de ~2 puntos por píxel (datos horarios o el período `Max`):
```
REGLA
  Sea n = data.length, W = innerW.
  · n ≤ 2·W  → sin downsample.  (365 días a 975px: 365 ≤ 1950 ⇒ NO)
  · n > 2·W  → LTTB a m = clamp(600, round(W / 1.5), 1400).  A W=975 ⇒ m = 650.
    Casos reales que lo activan: horario 365d (8.760 pts); 5 años diarios
    (1.825 pts) a W=300 en móvil ⇒ 1.825 > 600 ⇒ sí.
  · En móvil (W≈300) el umbral es 600: un año diario (365) sigue sin
    downsample y dos años (730) sí.

CONTRATO DE HONESTIDAD DEL DOWNSAMPLE
  1. LTTB conserva SIEMPRE el primer y el último punto, y por construcción
     conserva los extremos locales (es su propósito: máxima área triangular).
  2. Al downsamplear, la gráfica muestra en el pie, en --fs-caption --text-3:
     «Serie reducida de 8.760 a 650 puntos para dibujar; picos preservados.»
     Nunca en silencio.
  3. El HOVER y el onSelect NO usan la serie reducida: se resuelven contra el
     array original por búsqueda binaria sobre x. Así el tooltip nunca reporta
     un punto que no existe, y el drawer filtra el día correcto.
  4. Los agregados (mín, máx, media, último) se calculan sobre el array
     ORIGINAL, no sobre el reducido.
```
```js
// charts-core.js — LTTB, ~30 líneas, sin dependencias
function lttb(points, m) {                       // points: [{i, x, y}]
  const n = points.length;
  if (m >= n || m < 3) return points;
  const bucket = (n - 2) / (m - 2);
  const out = [points[0]];
  let a = 0;
  for (let k = 0; k < m - 2; k++) {
    let avgX = 0, avgY = 0,
        s = Math.floor((k + 1) * bucket) + 1,
        e = Math.min(Math.floor((k + 2) * bucket) + 1, n), c = e - s;
    for (let j = s; j < e; j++) { avgX += points[j].x; avgY += points[j].y; }
    avgX /= c; avgY /= c;
    const rs = Math.floor(k * bucket) + 1, re = Math.floor((k + 1) * bucket) + 1;
    let best = rs, bestA = -1;
    for (let j = rs; j < re; j++) {
      const area = Math.abs((points[a].x - avgX) * (points[j].y - points[a].y)
                          - (points[a].x - points[j].x) * (avgY - points[a].y));
      if (area > bestA) { bestA = area; best = j; }
    }
    out.push(points[best]); a = best;
  }
  out.push(points[n - 1]);
  return out;
}
```

## 6.4 Seis series

El selector del Scorecard (`screens.js:485-503`) ya limita a 3 (`activeMetrics.length < 3`). Se mantiene el tope de 3 en `mode:'shared'`/`'index'` y se sube a 6 sólo en `SmallMultiples` (6 paneles de 72px = 432px en escritorio, 6 filas en móvil). Razón: con 6 líneas en un panel la discriminación por color falla — las 8 categóricas de `tokens.css:298-305` son distinguibles entre sí, pero seis líneas cruzándose no se siguen visualmente a 2px de grosor. Con >3 series `LineChart` avisa en desarrollo y sugiere `SmallMultiples`.

---

# 7 · Arquitectura, migración y tokens

## 7.1 Archivos

```
apps/web/public/eco-prototype/
  charts-core.js   NUEVO ~520 líneas — sin JSX salvo ChartFrame/estados.
                   window.ECO_CHART_CORE = {
                     isNum, num, EMPTY, extent, padDomain, segments,
                     niceDomain, tickIndices, measureNum, lttb,
                     monotonePath, linearPath, stepPath, areaFrom,
                     useChartWidth, useCrosshairGroup, resolveHeight,
                     resolveState, seqScale, divScale, catScale,
                     metricFormatter, metricOf, bandsOf,
                     ChartFrame, ChartSkeleton, ChartEmpty, ChartError,
                     ChartTooltip, ChartDataTable, Legend,
                   }
  charts.js        REESCRITO ~900 líneas — las 9 primitivas + las nuevas.
                   window.ECO_CHARTS = { LineChart, AreaStackChart, Sparkline,
                     BarList, SplitBar, Donut, MatrixHeatmap, GeoMap, Legend,
                     BulletChart, SmallMultiples, SlopeChart, CalendarHeatmap,
                     TermsChart, WordCloud, Waterfall, Beeswarm, Sankey }
  charts-legacy.js ANDAMIO ~30 líneas. Se borra antes del merge.
```

**Registro obligatorio en tres sitios** (si falta uno, la SPA arranca sin gráficas):
1. `<WT>/apps/web/scripts/compile-prototype.js:18`
   ```js
   const FILES = ['data.js', 'icons.js', 'charts-core.js', 'charts.js',
                  'shell.js', 'screens.js', 'chat-drawer.js', 'app.js'];
   ```
2. `<WT>/apps/web/public/eco-prototype/index.html:1412`
   ```js
   const files = ['data.js', 'icons.js', 'charts-core.js', 'charts.js',
                  'shell.js', 'screens.js', 'chat-drawer.js', 'app.js'];
   ```
   El comentario de `index.html:1410` ("data -> icons -> charts -> shell -> screens -> app") se actualiza. La carga es secuencial con `s.async = false` (`index.html:1417`), así que el orden se respeta.
3. **Cache-bust manual**: `index.html:1416`, `?v=prodc22` → `?v=prodc23`. Sin esto el navegador sirve el `dist/` viejo (nota de memoria `prototype-build-cachebust`).

## 7.2 Sin librerías nuevas

| Necesidad | Decisión | Por qué |
|---|---|---|
| escalas, paths, ticks, stack, LTTB | **a mano**, `charts-core.js` | ~300 líneas de aritmética. `d3-scale`+`d3-shape`+`d3-array` en UMD son ~120KB y 3 `<script>` con `integrity`; el 90% no se usaría |
| interpolación monótona | **a mano**, 35 líneas (Fritsch–Carlson) | es `d3-shape.curveMonotoneX`; copiarla es menos que integrar d3 |
| medición de texto | `canvas.measureText` del navegador | exacto con Krub/Besley; ninguna librería lo hace mejor |
| layout de nube de palabras | **a mano**, ~150 líneas | `d3-cloud` es ESM y arrastra `d3-dispatch`; ver §3.5 |
| sankey | **a mano**, ~120 líneas, ≤3 capas | `d3-sankey` arrastra `d3-array`+`d3-shape` |
| mapa | **Leaflet 1.9.4 vía CDN, ya presente** | `index.html:14-15` con `integrity` (`sha256-p4Nx…`, `sha256-20nQ…`). No se toca |

## 7.3 Tokens que hay que añadir a `tokens.css`

Ninguno existe hoy. Van en la sección 6 ("PALETAS DE DATOS"), por modo.

```css
/* ── tamaño de tick: la ÚNICA excepción al piso de 12px, documentada ──────
   Los ejes densos (30 etiquetas de fecha en 975px) no caben a 12px sin tirar
   la mitad de las marcas, lo que empeora la lectura más que el tamaño. 11px
   sobre --chart-axis (#7C8798 = 5.00:1 sobre --canvas) cumple AA — WCAG 2.1 no
   impone tamaño mínimo, sólo contraste. Prohibido bajar de 11px: charts.js
   usaba 9px sobre #525B68 (2.65:1), las 148 instancias de 9px de los probes. */
--fs-tick: 11px;
--lh-tick: 1;

/* ── primer plano sobre relleno categórico ───────────────────────────────
   Un tag de valor se rellena con series.color, que puede ser cualquiera de
   --cat-1..8. Un --on-* por color serían 8 tokens; en oscuro todas las
   categóricas son claras y en claro todas son oscuras, así que basta uno.
   Medido: mínimo 6.95:1 en oscuro (cat-1) y 5.36:1 en claro (cat-7). */
--on-cat: #08101A;             /* modo oscuro  */
/* --on-cat: #FFFFFF;             modo claro   */

/* ── bandas de referencia de BulletChart / LineChart ─────────────────────
   Reemplazan los 4 linear-gradient con stops escritos a mano y el hex suelto
   #E0662E de screens.js:34. `alert` es el 4º nivel que faltaba entre warn y
   neg (--accent-2 ya existe). */
--band-ok:    color-mix(in oklab, var(--pos)      16%, transparent);
--band-watch: color-mix(in oklab, var(--warn)     16%, transparent);
--band-alert: color-mix(in oklab, var(--accent-2) 18%, transparent);
--band-crit:  color-mix(in oklab, var(--neg)      18%, transparent);
--band-edge:  var(--hairline-strong);
--band-label: var(--text-3);
```

Contrastes verificados del `--on-*` como texto del tag sobre cada color de serie posible (los que hoy comparten un solo `--on-accent`, `charts.js:417`):

| Fill del tag | `--on-accent` #1A0A04 | `#fff` (lo anterior) |
|---|---|---|
| `--accent` #FF6A3D (NSS) | 6.78 | 2.85 ✘ |
| `--pos` #3FD47A (BHI) | 10.02 | 1.92 ✘ |
| `--text-2` #A2ACBA (Menciones) | 8.40 | 2.30 ✘ |
| `--neg` #FF5470 (Crisis) | 6.20 | 3.11 ✘ |
| `#8B5CF6` (Polarización) | 4.55 | 4.23 ✘ |
| `--warn` #FFC043 (Engagement) | 11.82 | 1.63 ✘ |

El `#8B5CF6` de `screens.js:264`/`463`/`467` debe pasar a `--cat-2` (#A78BFA), que con `--on-cat` da 7.02.

Ya existen y se usan tal cual: `--chart-grid`, `--chart-axis`, `--chart-crosshair`, `--chart-void`, `--seq-0..5`, `--div-*`, `--cat-1..8`, `--on-accent`, `--r-sm`, `--sp-*`, `--dur-fast`, `--ease-out`, `.sr-only`, `.touch-target`, `.skeleton`.

## 7.4 Guardarraíles para que no se vuelva a degradar

1. **Ni un hex en `charts.js`.** Test: `grep -nE "#[0-9a-fA-F]{3,8}\b" charts.js charts-core.js` debe estar vacío. Hoy `charts.js` tiene `#0E1620` (`:810`), `#3FD47A`/`#FF6A3D`/`#8A94A1` (`:816`), `#E6ECF3`/`#8A94A1` (`:824-827`).
2. **`title` obligatorio.** En desarrollo `ChartFrame` lanza si falta; en producción cae a `'Gráfica'` y registra en consola.
3. **Ni un `fontSize` numérico en JSX de gráfica**: sólo `var(--fs-tick)` / `var(--fs-caption)` / `var(--fs-overline)`.
4. **Prohibido `toFixed`/`toLocaleString` fuera de `metricFormatter`.** Test: `grep -n "toFixed\|toLocaleString" charts.js` sólo debe encontrar coincidencias en `charts-core.js`.
5. **Cuenta de nodos**: test de humo en `apps/web/scripts/` que renderiza `LineChart` con 365×3 en jsdom y falla si `svg.querySelectorAll('*').length > 240`.
6. **Auditoría del `dist/`**: `node --check` sobre cada `dist/*.js` en el prebuild (hoy `compile-prototype.js:37` sólo verifica que Babel devolvió código).

## 7.5 Cómo verificar sin DB ni auth

Ya existe el harness de las auditorías previas: fixtures de `/api/*` en `scratchpad/fixtures` + `scratchpad/audit-server.py` y `shoot.mjs`. Para esta unidad hacen falta **tres fixtures nuevos** que hoy no existen y que son los que revelan los bugs:

- `timeline-nulls.json`: `TIMELINE` con `polarizationIndex: null` en 4 de 30 días, `nss` ausente en 2, y una serie enteramente nula → verifica el canon de nulos completo.
- `timeline-spike.json`: `[8,10,9,240,11,9,10]` en `totalMentions` → verifica ausencia de overshoot (la curva no debe bajar de 8).
- `timeline-365.json`: 365 días × 6 series → verifica presupuesto de nodos y ticks.

Y la regla de la nota de memoria `feedback_verify_within_dashboard_frame`: montar la **App completa** con el tema `mando` real, nunca la primitiva aislada.


## Decisiones

**Eliminar el modo de escala por-serie de LineChart y sustituirlo por `scale.mode` explícito ('shared' | 'fixed' | 'index'), redirigiendo 'per-series' a SmallMultiples**

- *Por qué:* La rama por defecto de charts.js:220-227 escala cada serie a su propio min/max y charts.js:293-302 sólo dibuja números en el eje Y cuando hay sharedScale o yDomain. En /overview eso hace que la línea de 54 se pinte por debajo de la de 36 (evidencia: scratchpad/z-chart-desktop.png). Ningún par de ejes puede representar dos escalas honestamente. El gusto del usuario era por la CURVA (screens.js:4339-4343), no por la escala, y se preserva con curve='monotone'. El argumento real del comentario ('picos de neg=203 comprimen las variaciones diarias') se resuelve con scale.softMax + glifo de corte y con SmallMultiples.
- *Alternativas descartadas:* (a) Dejar la escala por-serie y añadir dos ejes Y: sólo funciona con exactamente 2 series y sigue siendo ilegible con 3. (b) Añadir una nota de texto 'escalas independientes': una auditoría de gobierno no puede depender de que el lector lea la letra pequeña antes de comparar dos líneas. (c) Normalizar todo a 0-100 siempre: pierde la magnitud absoluta, que es lo que el usuario necesita para decidir.

**Reemplazar Catmull-Rom (tension=1) por interpolación monótona Fritsch-Carlson**

- *Por qué:* Medido: con tension=1 (el default de charts.js:20, invocado sin argumento en :327 y :337) un segmento entre dos mínimos iguales overshoot 12.5% del salto, y la serie [8,10,9,240,11,9,10] — patrón típico de día de crisis — se dibuja bajando hasta −7.7 menciones. Los comentarios de charts.js:8 ('sin overshoot') y :12 ('1.0 = más recto; 0 = más curvo') son ambos falsos: t=0 da la cuerda recta. Fritsch-Carlson garantiza por construcción que la curva quede entre y[i] e y[i+1], son 35 líneas y visualmente es indistinguible de lo que el usuario dijo que le gustaba.
- *Alternativas descartadas:* (a) Bajar tension a 0.5: reduce el overshoot a 6.25% pero no lo elimina; sigue dibujando valores negativos en series que empiezan cerca de 0. (b) curve='linear' siempre: contradice una petición explícita del usuario registrada en el código. (c) d3-shape curveMonotoneX vía CDN: es la misma función, ~60KB de UMD y un integrity a mantener.

**El registro de métricas (dominio, decimales, sufijo, bandas) lo emite /api/eco-data como METRIC_SPECS derivado de @eco/shared/format; charts.js pierde fmtVal**

- *Por qué:* fmtVal (charts.js:243-252) es un switch sobre seis claves de negocio dentro de una primitiva de dibujo, y su propio comentario (:238-241) lo declara 'ESPEJO … Mantener en sync'. Ya se desincronizó: fmtVal devuelve '6.2' para BHI mientras formatMetric devuelve '6.2 / 10'. Los umbrales están copiados en cuatro sitios con drift real (Polarización 30/60 en screens.js:467 vs el canon 30/50/75 en metrics-display.ts:164-169). La SPA no puede importar TypeScript, pero el endpoint ya importa formatMetric y su comentario en route.ts:352-357 declara justamente esta intención.
- *Alternativas descartadas:* (a) Un mirror en un archivo JS de la SPA con un test que lo pinne contra el TS: sigue siendo un mirror, y los mirrors de este repo se han desincronizado dos veces. (b) Compilar @eco/shared/format a UMD en el prebuild: añade un paso de build al único artefacto que hoy sólo pasa por Babel, y la SPA no tiene resolución de módulos.

**Migrar los 11 sitios de llamada en un solo PR; el adaptador de compatibilidad es un andamio de 30 líneas que se borra antes del merge**

- *Por qué:* Conté 11 sitios de llamada JSX (10 en screens.js, 1 en shell.js), no ~40. El despliegue es un único bundle dist/ con cache-bust manual (index.html:1416): no existe rollout parcial, así que un shim no reduce riesgo. Y lo que sí haría es congelar la semántica defectuosa (escala por-serie por defecto, suavizado forzado, ?? 0), que es exactamente lo que se quiere retirar. El shim propuesto deliberadamente NO reproduce esos defaults.
- *Alternativas descartadas:* (a) Adaptador permanente con las props viejas: perpetúa los bugs y duplica la superficie de mantenimiento. (b) Dos primitivas coexistiendo (MultiLineChart y LineChart) durante meses: garantiza que /dashboard y /overview divergen visualmente, que es el problema de origen.

**RadialGauge se borra; su lugar lo toma BulletChart, que además absorbe las cinco barras de banda ad-hoc**

- *Por qué:* RadialGauge tiene cero sitios de llamada, un max=3 que no corresponde a ninguna escala del producto (0-1, 1-10, 0-100, -100..100) y una prop colorStops que nunca se lee. Mientras tanto hay CINCO implementaciones ad-hoc de 'valor contra bandas' (screens.js:443-450, 466-473, 611-646, 4295-4300, shell.js:1676-1685) y las cinco desalinean las etiquetas: con space-between los rótulos caen en 0/33/67/100% mientras los puntos medios de las bandas de crisis están en 12.5/32.5/50/80% — 16.7 y 20 puntos de error para ALERTA y CRISIS. BulletChart es lineal (comparable entre cards, cosa que un arco no es) y cuesta 120 líneas retirando ~150.
- *Alternativas descartadas:* Arreglar el max=3 y darle uso: un arco no permite comparar dos métricas lado a lado, y F12 del brief general (cinco lenguajes visuales en cinco cards contiguos) exige justo lo contrario.

**La nube de palabras se envía junto con TermsChart (barras), y el placer de la nube se escribe a mano (~150 líneas) en vez de traer d3-cloud**

- *Por qué:* El usuario pidió explícitamente 'nubes de palabras, algo bien dinámico y bien hecho'. Pero una nube codifica magnitud en área de glifo, que se lee mal, y el corpus (español de PR, titulares + comentarios, con los nombres de agencia y 'Puerto Rico' como ruido garantizado) haría una nube de stopwords de dominio. TermsChart es la vista de análisis y la nube la de presentación. Sobre la librería: d3-cloud es ESM y arrastra d3-dispatch (y en la práctica d3-array), lo que serían 3 script con integrity para 150 líneas de algoritmo; además la medición correcta de anchos con Krub/Besley requiere canvas.measureText del navegador de todos modos.
- *Alternativas descartadas:* (a) Sólo la nube: no responde 'qué término subió y cuánto'. (b) Sólo barras: ignora una petición explícita del usuario. (c) d3-cloud vía CDN: dependencia transitiva ESM + integrity a mantener, y no resuelve la medición de fuentes.

**Con 365 puntos NO se hace downsample; el arreglo de rendimiento es presupuesto de nodos + separación StaticLayer/HoverLayer memoizadas. LTTB sólo entra cuando n > 2·innerW**

- *Por qué:* Conté ~1.510 elementos SVG con n=365 y 3 series, de los cuales 1.095 son circles por día por serie y 365 son tick marks (charts.js:349-361 y 445-447); charts.js no tiene ni un useMemo, así que cada mousemove reconstruye los cuatro paths (~1.460 segmentos de bezier) y recrea los 1.510 elementos: ~90.000 comparaciones de elemento por segundo. A innerW=975 cada punto ocupa 2.7px, así que el path no es el problema y LTTB perdería fidelidad sin ganar nada, además de romper el mapeo índice→fecha del crosshair. Con las reglas de densidad quedan ~54 nodos estáticos memoizados y ~10 nodos por frame en la capa de hover.
- *Alternativas descartadas:* (a) LTTB a 180 puntos siempre: el tooltip reportaría días que no existen y el drawer filtraría el día equivocado. (b) Canvas en vez de SVG: pierde el DOM accesible (tabla oculta, targets de 44px, foco por teclado) y obliga a hit-testing propio.

**El tooltip sale del SVG y pasa a un portal HTML con clamp contra el rect del card; toda la interacción migra de Mouse Events a Pointer Events con el patrón tap-to-reveal / tap-to-commit**

- *Por qué:* Hoy el tooltip está duplicado literalmente en charts.js:388-404 y :547-568 (mismo tooltipW=180, mismo tooltipH=22+n*18), con clamp sólo horizontal y sólo contra innerW, tooltipY=0 fijo (tapa las gridlines superiores) y sin pointerEvents='none' en MultiLineChart, lo que produce parpadeo. Al vivir dentro del SVG no puede desbordar el card, así que en cards de 1/3 de ancho se apila sobre los datos. Y toda la interacción es onMouseMove/onMouseEnter: en móvil el crosshair, el strip de valores y los tooltips son inalcanzables mientras el subtítulo dice literalmente 'pasa el cursor para ver valores' (screens.js:482, visible en crop-mob-chart.png).
- *Alternativas descartadas:* (a) Arreglar el clamp dentro del SVG: no resuelve el desbordamiento del card, que es la limitación de fondo. (b) Añadir onTouchStart junto a onMouseMove: dos caminos de código que divergen; Pointer Events con e.pointerType es un solo camino con la información del origen.

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-G1` | P0 | L | charts-core.js: canon de nulos, escalas, ticks, LTTB, paths + registro en el pipeline | `apps/web/public/eco-prototype/charts-core.js (nuevo, ~520 líneas); apps/web/scripts/compile-prototype.js:18; a` | — |
| `WS-G2` | P0 | S | METRIC_SPECS en /api/eco-data + window.ECO_METRICS en el núcleo | `apps/web/src/app/api/eco-data/route.ts (bloque nuevo junto a CURRENT_METRICS.display, ~línea 352); apps/web/pu` | WS-G1 |
| `WS-G3` | P0 | M | ChartFrame + los 5 estados canónicos + tabla oculta a11y | `apps/web/public/eco-prototype/charts-core.js (ChartFrame, ChartSkeleton, ChartEmpty, ChartError, ChartInsuffic` | WS-G1 |
| `WS-G4` | P0 | M | ChartTooltip en portal HTML + Pointer Events + teclado + crosshair compartido | `apps/web/public/eco-prototype/charts-core.js (ChartTooltip, usePointerIndex, useChartKeys, useCrosshairGroup)` | WS-G3 |
| `WS-G5` | P0 | L | LineChart — fusiona MultiLineChart y AreaLineChart; arregla F1, F2, F3, F4, C-06, C-15, C-20 | `apps/web/public/eco-prototype/charts.js:97-452 (reescribir)` | WS-G4 |
| `WS-G6` | P0 | S | Legend como primitiva + arreglo estructural de F6 | `apps/web/public/eco-prototype/charts-core.js (Legend); screens.js:670-678 (borrar); screens.js:1686-1690 (borr` | WS-G3 |
| `WS-G7` | P1 | M | BulletChart + retiro de las 5 barras de banda ad-hoc | `apps/web/public/eco-prototype/charts.js (BulletChart, ~120 líneas); screens.js:34, 443-450, 466-473, 611-646, ` | WS-G2 |
| `WS-G8` | P1 | M | Sparkline, BarList, SplitBar, Donut sobre el contrato nuevo | `apps/web/public/eco-prototype/charts.js:97-112 (Sparkline), 579-604 (Donut), 607-635 (HBarList->BarList); char` | WS-G3 |
| `WS-G9` | P1 | M | AreaStackChart con modos zero/center/expand — absorbe StackedAreaChart y el streamgraph | `apps/web/public/eco-prototype/charts.js:455-576 (reescribir); screens.js:5237-5389 (borrar NarrativeStreamgrap` | WS-G5 |
| `WS-G10` | P1 | M | MatrixHeatmap + CalendarHeatmap | `apps/web/public/eco-prototype/charts.js:675-726 (reescribir); screens.js:2446-2625 (borrar TopicCalendar y sus` | WS-G6 |
| `WS-G11` | P1 | S | GeoMap: tokens en el tooltip de Leaflet y contrato series+scale | `apps/web/public/eco-prototype/charts.js:731-873` | WS-G4 |
| `WS-G12` | P1 | L | Migrar los 11 sitios de llamada + borrar el andamio legacy | `screens.js:126, 463, 508, 542, 684, 1646, 1683, 2388, 2779, 2799, 4344; shell.js:1714; charts-legacy.js (borra` | WS-G5, WS-G7, WS-G8, WS-G9, WS-G10, WS-G11 |
| `WS-G13` | P1 | M | SmallMultiples + SlopeChart | `apps/web/public/eco-prototype/charts.js (nuevas, ~200 líneas); screens.js:485-503 (>3 series => SmallMultiples` | WS-G12 |
| `WS-G14` | P2 | L | TermsChart + WordCloud (nubes de palabras) — bloqueadas por /api/eco-terms | `apps/web/public/eco-prototype/charts.js (TermsChart ~70 líneas, WordCloud ~150+40); apps/web/src/app/api/eco-t` | WS-G12 |

## Riesgos

- El usuario pidió explícitamente las líneas suavizadas (documentado en screens.js:4339-4343) y podría percibir el cambio a escala compartida como una regresión visual: con nice+zero la variación diaria se aplana frente a un pico de neg=203. Mitigación obligatoria antes de mergear: capturas lado a lado de /overview con scale shared+softMax:97 y con SmallMultiples, y la decisión la toma él. Si rechaza ambas, la salida honesta es mode:'index' (todo a 100 en el día 1), NO volver a la escala por-serie.
- Fritsch-Carlson produce curvas visiblemente más 'apretadas' que Catmull-Rom con tension=1 en series muy dentadas: el overshoot que se elimina es precisamente lo que hacía las curvas más redondas. Riesgo real de que se lea como 'menos bonito'.
- Otro agente está commiteando en el mismo worktree (a69ea2e, d8ddb32, 92e0d4a son de la capa de tokens y ya tocaron charts.js:417 y screens.js:494-499). Los números de línea de esta spec se mueven con cada commit ajeno; hay que re-verificar cada ubicación contra el HEAD del momento antes de aplicar.
- charts-core.js hay que registrarlo en DOS sitios (compile-prototype.js:18 y index.html:1412) y subir el cache-bust en index.html:1416. Si se olvida cualquiera de los tres, la SPA arranca sin gráficas o sirve el dist/ viejo, y el síntoma (pantalla en blanco tras el boot) no apunta al archivo que falta.
- TermsChart, WordCloud y Waterfall dependen de datos que hoy NO existen: no hay columna de términos, ni índice FTS, ni descomposición de NSS por tópico (confirmado en SYSTEMS-BRIEF §B). Hay que verificar que pg_trgm/unaccent estén instaladas antes de asumirlo. Si el backend no llega, esas tres primitivas quedan en state:'empty' y el usuario ve un hueco donde pidió una nube.
- Reconciliar las dos escalas de NSS (metrics.ts:159 da −100..100; eco-data/route.ts:824 da −10..+10) NO es parte de esta unidad, pero sin resolverlo scale.mode:'fixed' con metric:'nss' sigue siendo ambiguo y el guardarraíl de ocupancia <15% quedará permanentemente activo, lo que enmascara el problema en vez de arreglarlo.
- La reescritura toca las 11 llamadas más 15 mini-gráficas ad-hoc en el mismo PR: es un diff grande sobre screens.js (5.956 líneas) sin ningún test de render existente. Sin el harness de fixtures (audit-server.py + los tres fixtures nuevos de §7.5) no hay forma de verificarlo, y la SPA no tiene suite de pruebas.
- La regla de agrupar el eje X del heatmap por turnos de 3h en móvil pierde resolución horaria real. El card se titula 'Actividad por hora' y su valor operativo es saber la hora del pico; si el usuario trabaja principalmente en teléfono, esto degrada la función principal del widget.
- El bus de crosshair compartido sincroniza por ÍNDICE, no por fecha. Si dos gráficas de un mismo groupId reciben arrays de distinta longitud u orden, el crosshair señalará días distintos en cada panel sin ningún error visible.


---

