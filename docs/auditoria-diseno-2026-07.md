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

<!-- SLOT:MENCIONES -->

---

## 9 · Narrativas: detección, novedad y experiencia

<!-- SLOT:NARRATIVAS -->

---

## 10 · Plan

<!-- SLOT:PLAN -->
