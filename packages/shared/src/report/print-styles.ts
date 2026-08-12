/**
 * Hoja de estilo del reporte imprimible.
 *
 * DECISIONES DE DISEÑO (el usuario pidió explícitamente "hay que diseñar bien
 * esas vistas y tipologías"):
 *
 * 1. PAPEL CLARO, NO EL TEMA OSCURO DEL DASHBOARD. El dashboard es una sala de
 *    mando en pantalla; esto es un documento que se imprime, se archiva y se
 *    circula por correo. Se toma la variante CLARA de los tokens de marca.
 *
 * 2. EL COLOR QUE PORTA SIGNIFICADO VIVE EN SVG, NO EN `background-color`. Chrome
 *    y Safari permiten desactivar "gráficos de fondo" en el diálogo de
 *    impresión: eso borra los fondos CSS pero NO los rellenos de SVG, que son
 *    contenido. Por eso las gráficas son SVG y las superficies HTML se
 *    distinguen por FILETE (borde) y no por relleno. `print-color-adjust: exact`
 *    se declara igual para el caso normal, pero el documento no depende de él.
 *
 * 3. TIPOGRAFÍA DE LA MARCA, ESCALA DE IMPRENTA. Besley (serif de contraste
 *    alto) para display y cifras, Krub (sans humanista) para texto corrido, IBM
 *    Plex Mono para IDs y URLs — los mismos tres de tokens.css. Los tamaños se
 *    re-escalan a puntos: la escala de pantalla (14px de cuerpo) imprime
 *    demasiado grande, y la de pantalla no tiene el cuerpo de 9.5-10.5pt que un
 *    informe necesita para caber sin sentirse apretado.
 *
 * 4. MEDIDA DE LÍNEA. El texto analítico va a una columna de ~78 caracteres
 *    (`max-width: 34em`) porque son párrafos para leer, no celdas de tabla. Las
 *    tablas y gráficas sí usan el ancho completo del bloque de texto.
 *
 * 5. CONTROL DE SALTOS. Toda unidad que se lee junta (mosaico de indicador,
 *    tarjeta de tópico, fila de tabla, figura con su epígrafe) lleva
 *    `break-inside: avoid`. Los títulos nunca quedan huérfanos al pie de página.
 */

export const REPORT_FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Besley:ital,wght@0,400..800;1,400..600&family=Krub:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap';

export const REPORT_STYLES = `
/* ==========================================================================
   0 · Tokens del documento
   ========================================================================== */
:root {
  --rp-display: 'Besley', 'Iowan Old Style', Georgia, serif;
  --rp-sans: 'Krub', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --rp-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;

  --rp-ink: #14181F;
  --rp-ink-2: #454C57;
  --rp-ink-3: #6E7683;
  --rp-hairline: #D8DBE0;
  --rp-hairline-soft: #E8EAEE;
  --rp-paper: #FFFFFF;
  --rp-paper-2: #FAFAF9;

  --rp-accent: #B4381E;
  --rp-neg: #8A0F28;
  --rp-neu: #CBCFD6;
  --rp-pos: #35935A;
  --rp-warn: #8A5B08;
  --rp-info: #1F4575;

  /* Escala tipográfica en puntos: la unidad del papel. */
  --rp-fs-cover: 30pt;
  --rp-fs-h1: 17pt;
  --rp-fs-h2: 12.5pt;
  --rp-fs-h3: 10.5pt;
  --rp-fs-body: 10pt;
  --rp-fs-small: 8.8pt;
  --rp-fs-micro: 7.6pt;
  --rp-fs-num-xl: 26pt;
  --rp-fs-num-lg: 17pt;
}

/* ==========================================================================
   1 · Página
   ========================================================================== */
@page {
  size: Letter;
  /* El margen superior es mayor porque el encabezado corriente vive ahí. */
  margin: 16mm 15mm 16mm;
}

* { box-sizing: border-box; }

html {
  /* Que los rellenos y filetes se impriman en el caso normal. El documento
     sigue siendo legible si el usuario los desactiva (ver nota 2 arriba). */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

body {
  margin: 0;
  background: var(--rp-paper-2);
  color: var(--rp-ink);
  font-family: var(--rp-sans);
  font-size: var(--rp-fs-body);
  line-height: 1.5;
  font-weight: 400;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

/* La "hoja" en pantalla: replica el ancho de impresión para que lo que se ve
   sea lo que se imprime. En impresión se desarma (ancho y márgenes los pone
   @page). */
.sheet {
  max-width: 186mm;
  margin: 0 auto;
  padding: 18mm 14mm 24mm;
  background: var(--rp-paper);
  box-shadow: 0 1px 2px rgba(20,24,31,.06), 0 12px 32px -16px rgba(20,24,31,.18);
}

/* ==========================================================================
   2 · Barra de acciones — SÓLO pantalla
   ========================================================================== */
.toolbar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: #101620;
  color: #E8EBF0;
  font-size: 9.5pt;
}
.toolbar strong { font-weight: 600; letter-spacing: .01em; }
.toolbar .tb-sep { flex: 1 1 auto; }
.toolbar button {
  font-family: var(--rp-sans);
  font-size: 9.5pt;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,.22);
  background: rgba(255,255,255,.10);
  color: #FFF;
  cursor: pointer;
}
.toolbar button.primary { background: var(--rp-accent); border-color: var(--rp-accent); }
.toolbar button:hover { filter: brightness(1.12); }
.tb-status { font-variant-numeric: tabular-nums; color: #9FB0C4; }
.tb-hint { color: #9FB0C4; font-size: 8.6pt; flex-basis: 100%; }

/* ==========================================================================
   3 · Portada
   ========================================================================== */
.cover { padding-bottom: 6mm; }
.cover-rule {
  height: 3px;
  background: var(--rp-accent);
  width: 54mm;
  margin-bottom: 7mm;
}
.cover-kicker {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--rp-ink-3);
  margin-bottom: 3mm;
}
.cover h1 {
  font-family: var(--rp-display);
  font-size: var(--rp-fs-cover);
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -.015em;
  margin: 0 0 3mm;
  max-width: 28ch;
}
.cover-agency {
  font-family: var(--rp-display);
  font-size: 14pt;
  font-weight: 500;
  color: var(--rp-ink-2);
  margin: 0 0 6mm;
}
/* Ficha del reporte: filete arriba y abajo, sin relleno — sobrevive a la
   impresión sin gráficos de fondo. */
.cover-meta {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5mm;
  border-top: 1px solid var(--rp-ink);
  border-bottom: 1px solid var(--rp-hairline);
  padding: 4mm 0;
  margin-bottom: 7mm;
}
.cover-meta dt {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--rp-ink-3);
  margin-bottom: 1.5mm;
}
.cover-meta dd {
  margin: 0;
  font-size: var(--rp-fs-small);
  font-weight: 600;
  color: var(--rp-ink);
  font-variant-numeric: tabular-nums;
}

/* Pull-quote: la tesis del reporte. Filete lateral gruesa + serif. */
.thesis {
  border-left: 3px solid var(--rp-accent);
  padding: 1mm 0 1mm 6mm;
  margin: 0 0 7mm;
  break-inside: avoid;
}
.thesis p {
  font-family: var(--rp-display);
  font-size: 14pt;
  line-height: 1.34;
  font-weight: 500;
  font-style: italic;
  color: var(--rp-ink);
  margin: 0;
  max-width: 40ch;
}
.thesis .thesis-label {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--rp-accent);
  font-style: normal;
  display: block;
  margin-bottom: 2mm;
}

/* Índice */
.toc { break-inside: avoid; margin-bottom: 4mm; }
.toc ol { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 10mm; }
.toc li {
  font-size: var(--rp-fs-small);
  padding: 1.4mm 0;
  border-bottom: 1px solid var(--rp-hairline-soft);
  break-inside: avoid;
  display: flex;
  gap: 3mm;
}
.toc .toc-n {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  color: var(--rp-accent);
  min-width: 5mm;
}

/* ==========================================================================
   4 · Secciones
   ========================================================================== */
.section { break-before: page; padding-top: 2mm; }
.section:first-of-type { break-before: auto; }

/* Control de saltos: se protege lo que se lee como UNA unidad (un mosaico, una
   figura con su epígrafe, una tarjeta de tópico, una fila de tabla) y se DEJA
   partir lo que es un contenedor largo.
   Antes la regla era '.section > * { break-inside: avoid-page }', que pedía al
   navegador mantener enteros bloques que pueden medir varias páginas: la tabla
   de la serie diaria de un período largo, o un bloque de análisis de cuatro
   párrafos. Cuando eso es imposible el navegador rompe igual, pero primero
   deja media página en blanco intentando cumplirlo. */
.section > p,
.section > .eyebrow,
.section > h3,
.section > h4 { break-inside: avoid; }
/* Estos contenedores SÍ pueden partirse entre páginas; sus hijos son las
   unidades atómicas y llevan su propio avoid. */
.section > table.rp,
.section > .ai,
.section > .findings,
.section > .signals { break-inside: auto; }

.sec-head {
  display: flex;
  align-items: baseline;
  gap: 4mm;
  border-bottom: 1.5px solid var(--rp-ink);
  padding-bottom: 2.5mm;
  margin-bottom: 5mm;
  break-after: avoid;
  break-inside: avoid;
}
.sec-n {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-small);
  font-weight: 500;
  color: var(--rp-accent);
}
.sec-head h2 {
  font-family: var(--rp-display);
  font-size: var(--rp-fs-h1);
  font-weight: 600;
  letter-spacing: -.01em;
  margin: 0;
  flex: 1;
}
.sec-head .sec-sub {
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-3);
  text-align: right;
  max-width: 46mm;
  line-height: 1.3;
}

h3.block {
  font-family: var(--rp-display);
  font-size: var(--rp-fs-h2);
  font-weight: 600;
  margin: 7mm 0 3mm;
  break-after: avoid;
}
h4.block {
  font-family: var(--rp-sans);
  font-size: var(--rp-fs-h3);
  font-weight: 600;
  margin: 5mm 0 2mm;
  break-after: avoid;
}
.eyebrow {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--rp-ink-3);
  margin: 0 0 2.5mm;
  break-after: avoid;
}

/* Texto analítico: medida de lectura, no ancho de tabla. */
.prose p {
  margin: 0 0 3.2mm;
  max-width: 34em;
  orphans: 3;
  widows: 3;
}
.prose p:last-child { margin-bottom: 0; }
.prose strong { font-weight: 600; }
.prose.lead p:first-child { font-size: 10.6pt; }

/* Bloque de análisis generado por IA: se marca como tal con un filete lateral
   fino. El lector tiene derecho a saber qué párrafos son de modelo. */
/* El filete lateral se dibuja a lo largo del bloque aunque cruce de página, que
   es justo lo que debe pasar: marca "esto lo escribió el modelo" durante todo
   el pasaje. No lleva break-inside: avoid — un análisis de cuatro párrafos
   puede medir más de una página y forzarlo dejaría media hoja vacía. */
.ai {
  border-left: 2px solid var(--rp-hairline);
  padding-left: 5mm;
}
.ai > .prose > p { break-inside: avoid; }
.ai-tag {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--rp-ink-3);
  display: block;
  margin-bottom: 2.5mm;
}
.ai-pending {
  font-size: var(--rp-fs-small);
  color: var(--rp-ink-3);
  font-style: italic;
}

/* ==========================================================================
   5 · Mosaicos de indicador
   ========================================================================== */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4mm;
  margin-bottom: 6mm;
}
.kpi {
  border: 1px solid var(--rp-hairline);
  border-top: 2.5px solid var(--rp-accent);
  border-radius: 3px;
  padding: 3.5mm 4mm 3mm;
  break-inside: avoid;
}
.kpi-label {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--rp-ink-3);
  margin-bottom: 1.5mm;
}
.kpi-value {
  font-family: var(--rp-display);
  font-size: var(--rp-fs-num-xl);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -.02em;
  /* Cifras proporcionales: 'tabular-nums' a este tamaño deja '11' flotando. */
  font-variant-numeric: proportional-nums;
}
.kpi-unit { font-size: 11pt; font-weight: 500; color: var(--rp-ink-2); }
.kpi-band {
  font-size: var(--rp-fs-small);
  font-weight: 600;
  margin-top: .8mm;
}
.kpi-delta {
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-2);
  font-variant-numeric: tabular-nums;
  margin-top: 1mm;
}
.kpi .chart { margin-top: 2mm; display: block; }
.tone-neg { color: var(--rp-neg); }
.tone-pos { color: var(--rp-pos); }
.tone-warn { color: var(--rp-warn); }
.tone-accent { color: var(--rp-accent); }
.tone-neutral { color: var(--rp-ink-2); }

/* Lectura por indicador */
.reading {
  border-top: 1px solid var(--rp-hairline-soft);
  padding-top: 2.5mm;
  margin-bottom: 3.5mm;
  break-inside: avoid;
}
.reading-h {
  font-family: var(--rp-sans);
  font-size: var(--rp-fs-small);
  font-weight: 700;
  margin-bottom: 1mm;
}
.reading p { margin: 0 0 1.5mm; max-width: 34em; font-size: var(--rp-fs-small); }
.reading .driver {
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-2);
  font-style: italic;
}

/* ==========================================================================
   6 · Hallazgos, señales, tarjetas de tópico
   ========================================================================== */
.findings { display: grid; gap: 3mm; margin: 4mm 0 0; }
.finding {
  display: grid;
  grid-template-columns: 32mm 1fr;
  gap: 4mm;
  border-top: 1px solid var(--rp-hairline);
  padding-top: 2.5mm;
  break-inside: avoid;
}
.finding-label {
  font-family: var(--rp-sans);
  font-size: var(--rp-fs-small);
  font-weight: 700;
  color: var(--rp-accent);
  line-height: 1.3;
}
.finding-body { font-size: var(--rp-fs-small); }
.finding-body .evidence {
  display: block;
  margin-top: 1mm;
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-3);
}

.topic-card {
  border: 1px solid var(--rp-hairline);
  border-radius: 3px;
  padding: 3.5mm 4mm;
  margin-bottom: 3mm;
  break-inside: avoid;
}
.topic-card-head {
  display: flex;
  align-items: baseline;
  gap: 3mm;
  flex-wrap: wrap;
  margin-bottom: 2mm;
}
.topic-card-head h4 {
  font-family: var(--rp-display);
  font-size: 11.5pt;
  font-weight: 600;
  margin: 0;
  flex: 1 1 auto;
}
.topic-card p { margin: 0; font-size: var(--rp-fs-small); max-width: 36em; }
.chip {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .07em;
  text-transform: uppercase;
  border: 1px solid var(--rp-hairline);
  border-radius: 2px;
  padding: .6mm 1.6mm;
  color: var(--rp-ink-2);
  white-space: nowrap;
}
.chip-strong { border-color: var(--rp-accent); color: var(--rp-accent); }

.signals { margin: 4mm 0 0; }
.signal {
  display: grid;
  grid-template-columns: 1fr 46mm 16mm;
  gap: 3mm;
  align-items: baseline;
  border-top: 1px solid var(--rp-hairline-soft);
  padding: 2mm 0;
  font-size: var(--rp-fs-small);
  break-inside: avoid;
}
.signal .sig-ev { font-family: var(--rp-mono); font-size: var(--rp-fs-micro); color: var(--rp-ink-3); }
.signal .sig-w {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  text-transform: uppercase;
  letter-spacing: .08em;
  text-align: right;
  font-weight: 500;
}

/* ==========================================================================
   7 · Tablas
   ========================================================================== */
/* Contenedor de scroll de cada tabla. En papel es transparente; en pantalla
   angosta es lo que evita que la PÁGINA scrollee de lado: el desbordamiento se
   queda dentro de la tabla, que es lo único que no puede encogerse más. Sin
   esto el documento medía 475px de ancho en un viewport de 375. */
.table-scroll { overflow-x: auto; max-width: 100%; }
table.rp {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--rp-fs-small);
  margin: 3mm 0 2mm;
}
table.rp caption {
  caption-side: top;
  text-align: left;
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--rp-ink-3);
  padding-bottom: 1.8mm;
}
table.rp thead th {
  text-align: left;
  font-family: var(--rp-sans);
  font-size: var(--rp-fs-micro);
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--rp-ink-2);
  border-bottom: 1.2px solid var(--rp-ink);
  padding: 0 2mm 1.5mm 0;
}
table.rp tbody td {
  padding: 1.6mm 2mm 1.6mm 0;
  border-bottom: 1px solid var(--rp-hairline-soft);
  vertical-align: top;
}
table.rp tbody tr { break-inside: avoid; }
table.rp thead { display: table-header-group; }
table.rp .n {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--rp-display);
  font-weight: 500;
  white-space: nowrap;
}
table.rp .sub { color: var(--rp-ink-3); font-size: var(--rp-fs-micro); display: block; }
table.rp tbody tr.agg td { color: var(--rp-ink-2); font-style: italic; }
table.rp tfoot td {
  padding: 1.8mm 2mm 0 0;
  border-top: 1.2px solid var(--rp-ink);
  font-weight: 700;
}

/* Tabla de menciones: el título puede ser largo, la fila no debe romperse. */
.mention-row td { break-inside: avoid; }
.mention-title { font-weight: 600; color: var(--rp-ink); }
.mention-meta {
  display: block;
  margin-top: .6mm;
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-3);
}
.mention-link {
  font-family: var(--rp-mono);
  font-size: 6.6pt;
  color: var(--rp-info);
  word-break: break-all;
}
.pill {
  display: inline-block;
  font-family: var(--rp-mono);
  font-size: 6.8pt;
  letter-spacing: .06em;
  text-transform: uppercase;
  padding: .4mm 1.2mm;
  border-radius: 2px;
  border: 1px solid currentColor;
  white-space: nowrap;
}

/* ==========================================================================
   8 · Figuras
   ========================================================================== */
.fig { margin: 0 0 5mm; break-inside: avoid; }
.fig-cap {
  font-family: var(--rp-sans);
  font-size: var(--rp-fs-small);
  font-weight: 700;
  margin-bottom: 2mm;
}
.fig-note {
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-3);
  margin: 1.5mm 0 0;
  max-width: 40em;
}
.fig-empty {
  font-size: var(--rp-fs-small);
  color: var(--rp-ink-3);
  font-style: italic;
  border: 1px dashed var(--rp-hairline);
  border-radius: 3px;
  padding: 4mm;
  margin: 0;
  text-align: center;
}
svg.chart { display: block; max-width: 100%; height: auto; }

.legend {
  display: flex;
  gap: 5mm;
  flex-wrap: wrap;
  margin-bottom: 2mm;
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-2);
}
.lg-item { display: inline-flex; align-items: center; gap: 1.6mm; }
.lg-swatch {
  width: 8px; height: 8px; border-radius: 2px;
  display: inline-block;
  /* Filete tenue para que el swatch exista aunque no se impriman fondos. */
  outline: .5px solid rgba(20,24,31,.28);
  outline-offset: -.5px;
}
.lg-num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--rp-ink); }

/* Dos columnas para figura + texto */
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7mm;
  align-items: start;
}
.split-wide { grid-template-columns: 1.35fr 1fr; }
/* Un hijo de grid tiene 'min-width: auto', así que NO se encoge por debajo del
   ancho de su contenido: con una gráfica de min-width 560 dentro, la columna
   crecía a 560 y era la página la que scrolleaba de lado en vez de la gráfica.
   Es el mismo '.card { min-width: 0 }' del overhaul responsive del dashboard. */
.split > * { min-width: 0; }

/* ==========================================================================
   9 · Anexo
   ========================================================================== */
.annex { font-size: var(--rp-fs-small); }
.annex dl { margin: 0 0 5mm; }
.annex dt {
  font-family: var(--rp-sans);
  font-weight: 700;
  font-size: var(--rp-fs-small);
  margin-top: 3mm;
}
.annex dd { margin: .6mm 0 0; color: var(--rp-ink-2); max-width: 36em; }
.annex code {
  font-family: var(--rp-mono);
  font-size: var(--rp-fs-micro);
  background: var(--rp-paper-2);
  border: 1px solid var(--rp-hairline-soft);
  border-radius: 2px;
  padding: 0 .8mm;
}

.colophon {
  margin-top: 8mm;
  border-top: 1px solid var(--rp-ink);
  padding-top: 2.5mm;
  font-size: var(--rp-fs-micro);
  color: var(--rp-ink-3);
  display: flex;
  justify-content: space-between;
  gap: 4mm;
  flex-wrap: wrap;
}

/* ==========================================================================
   10 · Encabezado corriente
   --------------------------------------------------------------------------
   Chrome repite los elementos 'position: fixed' en cada página impresa; es la
   única forma de tener encabezado corriente sin un paginador en JS (las
   márgenes de @page tipo '@top-center' no están soportadas). En pantalla se
   oculta porque ahí ya está la barra de acciones.
   ========================================================================== */
.running-head { display: none; }

/* ==========================================================================
   11 · Reglas exclusivas de impresión
   ========================================================================== */
@media print {
  body { background: var(--rp-paper); }
  .toolbar, .no-print { display: none !important; }
  .sheet {
    max-width: none;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }
  .running-head {
    display: block;
    position: fixed;
    top: -11mm;
    left: 0;
    right: 0;
    font-family: var(--rp-mono);
    font-size: 6.6pt;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--rp-ink-3);
    border-bottom: .5px solid var(--rp-hairline);
    padding-bottom: 1.2mm;
    display: flex;
    justify-content: space-between;
  }
  a { color: inherit; text-decoration: none; }
  /* La URL de una mención sí se imprime: en papel el enlace no es cliqueable y
     el lector necesita poder llegar a la fuente. */
  .mention-link { color: var(--rp-info); }
  .kpi-grid { grid-template-columns: repeat(3, 1fr); }
}

/* ==========================================================================
   12 · Pantallas estrechas (se revisa el reporte en el navegador antes de
   imprimir; en móvil las rejillas de 3 y 4 columnas no caben)
   ========================================================================== */
@media screen and (max-width: 860px) {
  .sheet { padding: 10mm 6mm 16mm; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .cover-meta { grid-template-columns: repeat(2, 1fr); }
  .split, .split-wide { grid-template-columns: 1fr; }
  .toc ol { columns: 1; }
  .finding { grid-template-columns: 1fr; gap: 1mm; }
  .signal { grid-template-columns: 1fr; gap: 1mm; }
  .signal .sig-w { text-align: left; }
}
@media screen and (max-width: 560px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .cover h1 { font-size: 22pt; }

  /* Las gráficas del cuerpo tienen un viewBox de 720: escalarlas a 340px de
     ancho deja sus rótulos en ~4px, o sea una gráfica cuyos números no se
     pueden leer. Se les fija un ancho mínimo y se les deja scroll propio: en
     pantalla angosta se arrastra la gráfica en vez de encogerla hasta que
     miente. El medidor y la sparkline de los mosaicos no entran aquí — están
     dimensionados ~1:1 con su contenedor. */
  .fig { overflow-x: auto; }
  .fig > svg.chart { min-width: 560px; }
  .kpi svg.chart { min-width: 0; }
}
`;
