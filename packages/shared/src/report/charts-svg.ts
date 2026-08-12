/**
 * Gráficas en SVG inline para el reporte imprimible.
 *
 * POR QUÉ SVG SERVIDO, Y NO LAS GRÁFICAS DEL DASHBOARD NI QUICKCHART:
 *  - Las del dashboard viven en charts.js y necesitan React + medición del DOM;
 *    el reporte se arma en el servidor y se emite como HTML plano.
 *  - QuickChart (lo que usan los correos) devuelve PNG: se pixela al imprimir y
 *    exige red desde el cliente. En SVG el PDF sale vectorial y nítido.
 *  - Un `fill` de SVG es CONTENIDO, así que se imprime siempre. Un
 *    `background-color` de CSS desaparece si el usuario desactiva "gráficos de
 *    fondo" en el diálogo de impresión. Todo lo que porta significado va en SVG
 *    justamente por eso.
 *
 * PALETA DE IMPRESIÓN (ver PRINT_PALETTE): los tokens de sentimiento del
 * dashboard NO se reutilizan tal cual. En modo claro valen #C2183F / #52525B /
 * #14722F, cuyas luminancias relativas son 0.125 / 0.086 / 0.124: negativo y
 * positivo son INDISTINGUIBLES en escala de grises (0.125 vs 0.124), así que
 * una barra apilada impresa en blanco y negro — el caso normal en una agencia —
 * no se puede leer. La paleta de abajo mantiene los hues de marca pero separa la
 * luminancia (0.059 / 0.622 / 0.224) y pasa los checks de separación CVD
 * (ΔE 24.6 protan, 29.0 visión normal). Aun así el color nunca es la única
 * codificación: el orden de los segmentos es fijo (negativo → neutral →
 * positivo), llevan etiqueta directa cuando caben, y cada gráfica va acompañada
 * de su tabla de números en el propio documento.
 */

// ============================================================
// Paleta
// ============================================================

export const PRINT_PALETTE = {
  /** Ink: texto y ejes. */
  ink: '#14181F',
  ink2: '#454C57',
  ink3: '#6E7683',
  hairline: '#D8DBE0',
  grid: '#E8EAEE',
  surface: '#FFFFFF',
  /** Sentimiento — orden fijo, luminancia separada para escala de grises. */
  negative: '#8A0F28',
  neutral: '#CBCFD6',
  positive: '#35935A',
  /** Acento de marca (ECO), para marcas de una sola serie. */
  accent: '#B4381E',
  accentSoft: '#E4CFC8',
  /** Rampa secuencial de un solo hue para el heatmap horario. */
  seq: ['#F6EDEA', '#EBD3CB', '#DDB2A5', '#CE8B78', '#C06550', '#A93B22'],
  warn: '#8A5B08',
  info: '#1F4575',
} as const;

/** Etiquetas canónicas del sentimiento, en el orden fijo de todo el reporte. */
export const SENTIMENT_ORDER = ['negative', 'neutral', 'positive'] as const;
export const SENTIMENT_LABEL: Record<string, string> = {
  negative: 'Negativo',
  neutral: 'Neutral',
  positive: 'Positivo',
};
export const SENTIMENT_FILL: Record<string, string> = {
  negative: PRINT_PALETTE.negative,
  neutral: PRINT_PALETTE.neutral,
  positive: PRINT_PALETTE.positive,
};
/** Color de texto legible ENCIMA de cada relleno (etiquetas dentro del segmento). */
export const SENTIMENT_ON_FILL: Record<string, string> = {
  negative: '#FFFFFF',
  neutral: PRINT_PALETTE.ink,
  positive: '#FFFFFF',
};

/** Separación entre rellenos contiguos: 2px del color del papel, no un borde. */
const GAP = 2;

// ============================================================
// Utilidades
// ============================================================

/**
 * Escape de HTML del reporte. Se llama `escapeReportHtml` y no `esc` porque
 * `@eco/shared` ya re-exporta un `esc` desde `email/chrome`, y dos `esc` en el
 * barrel colisionan (TS2308).
 */
export function escapeReportHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Alias corto para uso interno del módulo. */
const esc = escapeReportHtml;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('es-PR');
}

/** Recorta una etiqueta a `max` caracteres con elipsis tipográfica. */
function clip(s: string, max: number): string {
  const t = String(s ?? '');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Envuelve el SVG en un <figure> con su título y una nota opcional. El
 * `role="img"` + `<title>`/`<desc>` internos son lo que un lector de pantalla
 * (y un PDF etiquetado) anuncian.
 */
function figure(inner: string, opts: { title?: string; note?: string; className?: string }): string {
  return `<figure class="fig ${opts.className ?? ''}">${
    opts.title ? `<figcaption class="fig-cap">${esc(opts.title)}</figcaption>` : ''
  }${inner}${opts.note ? `<p class="fig-note">${esc(opts.note)}</p>` : ''}</figure>`;
}

function svgOpen(w: number, h: number, label: string): string {
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" `
    + `preserveAspectRatio="xMinYMin meet" role="img" aria-label="${esc(label)}" `
    + `xmlns="http://www.w3.org/2000/svg"><title>${esc(label)}</title>`;
}

function txt(
  x: number, y: number, s: string,
  o: { size?: number; fill?: string; weight?: number; anchor?: string; family?: string; tabular?: boolean } = {},
): string {
  const anchor = o.anchor ? ` text-anchor="${o.anchor}"` : '';
  const family = o.family ?? 'var(--rp-sans)';
  const tnum = o.tabular ? ' style="font-variant-numeric:tabular-nums"' : '';
  return `<text x="${x}" y="${y}" font-size="${o.size ?? 9}" fill="${o.fill ?? PRINT_PALETTE.ink3}" `
    + `font-weight="${o.weight ?? 400}" font-family="${family}"${anchor}${tnum}>${esc(s)}</text>`;
}

/** Rectángulo con las dos esquinas del extremo del dato redondeadas a 4px. */
function barPath(x: number, y: number, w: number, h: number, r: number, side: 'top' | 'right'): string {
  if (w <= 0 || h <= 0) return '';
  const rr = Math.max(0, Math.min(r, side === 'top' ? Math.min(w / 2, h) : Math.min(h / 2, w)));
  if (rr === 0) return `<path d="M${x} ${y}h${w}v${h}h${-w}Z" />`;
  if (side === 'top') {
    return `<path d="M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z" />`;
  }
  return `<path d="M${x} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h - rr}Q${x + w} ${y + h} ${x + w - rr} ${y + h}H${x}Z" />`;
}

// ============================================================
// Leyenda de sentimiento (siempre presente: 3 series)
// ============================================================

export function sentimentLegend(totals?: { negative: number; neutral: number; positive: number }): string {
  const items = SENTIMENT_ORDER.map((k) => {
    const n = totals ? ` <span class="lg-num">${fmt(totals[k])}</span>` : '';
    return `<span class="lg-item"><span class="lg-swatch" style="background:${SENTIMENT_FILL[k]}"></span>`
      + `${SENTIMENT_LABEL[k]}${n}</span>`;
  }).join('');
  return `<div class="legend">${items}</div>`;
}

// ============================================================
// 1 · Tendencia diaria — columnas apiladas
// ============================================================

export interface DailyPointLike {
  date: string;
  dayLabel: string;
  negative: number;
  neutral: number;
  positive: number;
}

/**
 * Columnas apiladas por día. Una sola escala vertical (el alto de la pila ES el
 * total del día), así que no hay segundo eje ni línea superpuesta — un gráfico
 * de doble eje inventa correlaciones que no están en los datos.
 *
 * Las etiquetas del eje X se ralean para que no colisionen: con 90 días no se
 * imprime una etiqueta por columna.
 */
export function dailyStackedChart(
  series: DailyPointLike[],
  // `grain` nombra la unidad de la columna. No es cosmético: con un período de
  // 365 días las columnas son MESES, y una nota que dice "total del día" o un
  // eje con nombres de día de semana describen algo que no es lo graficado.
  opts: { title?: string; grain?: 'día' | 'semana' | 'mes' } = {},
): string {
  const grain = opts.grain ?? 'día';
  if (!series.length) return emptyFigure(opts.title ?? 'Tendencia diaria', 'Sin menciones en el período.');

  const W = 720;
  const H = 230;
  const padL = 44;
  const padR = 10;
  const padT = 14;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const totals = series.map((d) => d.negative + d.neutral + d.positive);
  const max = Math.max(1, ...totals);
  const niceMax = niceCeil(max);
  const bw = Math.max(1, plotW / series.length);
  const barW = Math.max(1, Math.min(26, bw - (series.length > 60 ? 0.5 : 3)));

  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  // Rejilla horizontal: hairlines sólidas, un tono sobre el papel. Nunca
  // punteadas (una línea punteada se lee como umbral o proyección).
  const ticks = gridTicks(niceMax, 4);
  const grid = ticks.map((t) => {
    const yy = y(t);
    return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${PRINT_PALETTE.grid}" stroke-width="1" />`
      + txt(padL - 6, yy + 3, fmt(t), { anchor: 'end', size: 8.5, tabular: true });
  }).join('');

  const cols = series.map((d, i) => {
    const x = padL + i * bw + (bw - barW) / 2;
    let cursor = padT + plotH;
    // Orden fijo de abajo hacia arriba: negativo, neutral, positivo.
    return SENTIMENT_ORDER.map((k) => {
      const v = d[k];
      if (v <= 0) return '';
      const hRaw = (v / niceMax) * plotH;
      const h = Math.max(0.8, hRaw - GAP);
      cursor -= hRaw;
      const isTop = k === 'positive' || (k === 'neutral' && d.positive === 0)
        || (k === 'negative' && d.neutral === 0 && d.positive === 0);
      return `<g fill="${SENTIMENT_FILL[k]}">${barPath(x, cursor, barW, h, isTop ? 3 : 0, 'top')}</g>`;
    }).join('');
  }).join('');

  // Una etiqueta cada `step` columnas + siempre la primera y la última.
  const step = Math.max(1, Math.ceil(series.length / 12));
  const xLabels = series.map((d, i) => {
    if (i !== 0 && i !== series.length - 1 && i % step !== 0) return '';
    const x = padL + i * bw + bw / 2;
    return txt(x, H - 12, d.dayLabel, { anchor: 'middle', size: 8.5 });
  }).join('');

  // Etiqueta directa selectiva: sólo el día de mayor volumen. Un número por
  // columna sería ilegible y quedaría sin leer.
  const peakIdx = totals.indexOf(Math.max(...totals));
  const peakX = padL + peakIdx * bw + bw / 2;
  const peakLabel = totals[peakIdx] > 0
    ? txt(peakX, Math.max(padT + 8, y(totals[peakIdx]) - 5), fmt(totals[peakIdx]),
        { anchor: 'middle', size: 9, weight: 600, fill: PRINT_PALETTE.ink, tabular: true })
    : '';

  const svg = `${svgOpen(W, H, `Tendencia diaria de menciones por sentimiento, ${series[0].date} a ${series[series.length - 1].date}`)}
    ${grid}
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${PRINT_PALETTE.hairline}" stroke-width="1" />
    ${cols}${peakLabel}${xLabels}
  </svg>`;

  const unit = grain === 'día' ? 'del día' : grain === 'semana' ? 'de la semana' : 'del mes';
  return figure(sentimentLegend() + svg, {
    title: opts.title,
    note: `Alto de la columna = total ${unit}. Etiqueta directa sobre ${grain === 'día' ? 'el día' : grain === 'semana' ? 'la semana' : 'el mes'} de mayor volumen.`,
  });
}

// ============================================================
// 2 · Barra de composición 100 %
// ============================================================

/**
 * Una sola barra horizontal con la composición del período. Reemplaza a la dona:
 * para comparar valores cercanos una barra se lee mejor, y aquí además caben las
 * etiquetas dentro de cada segmento.
 */
export function compositionBar(
  totals: { negative: number; neutral: number; positive: number },
  opts: { title?: string; height?: number } = {},
): string {
  const total = totals.negative + totals.neutral + totals.positive;
  if (total <= 0) return emptyFigure(opts.title ?? 'Composición', 'Sin menciones en el período.');

  const W = 720;
  const h = opts.height ?? 46;
  const H = h + 22;
  let x = 0;

  const segs = SENTIMENT_ORDER.map((k) => {
    const v = totals[k];
    if (v <= 0) return '';
    const wRaw = (v / total) * W;
    const w = Math.max(0.8, wRaw - GAP);
    const share = (v / total) * 100;
    const cx = x + w / 2;
    const out: string[] = [`<g fill="${SENTIMENT_FILL[k]}">${barPath(x, 0, w, h, 3, 'right')}</g>`];
    // Sólo se rotula dentro del segmento si el texto cabe con aire; si no, el
    // valor vive en la leyenda y en la tabla (nunca se recorta un rótulo).
    if (w > 78) {
      out.push(txt(cx, h / 2 - 2, `${share.toFixed(1)} %`, {
        anchor: 'middle', size: 11, weight: 700, fill: SENTIMENT_ON_FILL[k],
      }));
      out.push(txt(cx, h / 2 + 12, `${fmt(v)} menciones`, {
        anchor: 'middle', size: 8.5, fill: SENTIMENT_ON_FILL[k],
      }));
    } else if (w > 34) {
      out.push(txt(cx, h / 2 + 4, `${Math.round(share)} %`, {
        anchor: 'middle', size: 9.5, weight: 700, fill: SENTIMENT_ON_FILL[k],
      }));
    }
    // Etiqueta de la serie bajo el segmento, cuando cabe: identidad sin depender
    // del color.
    if (w > 52) {
      out.push(txt(cx, H - 5, SENTIMENT_LABEL[k], { anchor: 'middle', size: 8.5, fill: PRINT_PALETTE.ink3 }));
    }
    x += wRaw;
    return out.join('');
  }).join('');

  const svg = `${svgOpen(W, H, `Composición del sentimiento: ${fmt(totals.negative)} negativas, ${fmt(totals.neutral)} neutrales, ${fmt(totals.positive)} positivas de ${fmt(total)}`)}${segs}</svg>`;
  return figure(svg, { title: opts.title });
}

// ============================================================
// 3 · Sparkline para los mosaicos de indicador
// ============================================================

/**
 * Línea de 2px sin relleno ni ejes, con marcador en el último punto. Vive dentro
 * de un mosaico de KPI donde el valor ya está impreso en grande, así que la
 * sparkline sólo aporta la FORMA de la serie.
 */
export function sparkline(
  values: Array<number | null>,
  opts: { stroke?: string; width?: number; height?: number } = {},
): string {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null && Number.isFinite(p.v));
  const W = opts.width ?? 190;
  const H = opts.height ?? 34;
  if (pts.length < 2) {
    return `${svgOpen(W, H, 'Serie insuficiente para graficar')}${txt(W / 2, H / 2 + 3, 'serie insuficiente', { anchor: 'middle', size: 8 })}</svg>`;
  }
  const stroke = opts.stroke ?? PRINT_PALETTE.accent;
  const xs = values.length - 1 || 1;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const pad = 4;
  const X = (i: number) => (i / xs) * (W - 2 * pad) + pad;
  const Y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);

  const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${X(p.i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `${svgOpen(W, H, `Evolución de la métrica en el período: de ${pts[0].v.toFixed(2)} a ${last.v.toFixed(2)}`)}
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${X(last.i).toFixed(1)}" cy="${Y(last.v).toFixed(1)}" r="3.2" fill="${stroke}" stroke="${PRINT_PALETTE.surface}" stroke-width="2" />
  </svg>`;
}

// ============================================================
// 4 · Barras horizontales
// ============================================================

export interface HBarRow {
  label: string;
  /** Sub-etiqueta opcional bajo el label (subtópicos, región, canal…). */
  sub?: string;
  value: number;
  /** Si viene, la barra se apila por sentimiento en vez de ir a un solo color. */
  breakdown?: { negative: number; neutral: number; positive: number };
}

/**
 * Barras horizontales con la etiqueta de la fila a la izquierda y el valor a la
 * derecha.
 *
 * MODO UNA SERIE (sin `breakdown`): TODAS las barras van del mismo color. Pintar
 * cada fila de un hue distinto sería codificar el largo dos veces y quemar el
 * único canal libre en información que la barra ya muestra; la identidad de la
 * fila la da su etiqueta, que está impresa al lado.
 *
 * MODO COMPOSICIÓN (con `breakdown`): apila negativo → neutral → positivo en el
 * orden fijo del reporte, con separación de 2px.
 */
export function hBarChart(rows: HBarRow[], opts: {
  title?: string;
  note?: string;
  labelWidth?: number;
  /** Sufijo del valor impreso a la derecha ('%', ' menciones'…). */
  valueSuffix?: string;
  /** Formateador alterno del valor (por defecto entero con separador de miles). */
  formatValue?: (v: number) => string;
  max?: number;
} = {}): string {
  if (!rows.length) return emptyFigure(opts.title ?? 'Distribución', 'Sin datos en el período.');

  const W = 720;
  const rowH = 26;
  const gap = 6;
  const labelW = opts.labelWidth ?? 168;
  const valueW = 76;
  const barMax = W - labelW - valueW - 14;
  // El alto se SUMA fila a fila (no rows.length × rowH) porque una fila de una
  // sola línea mide 6px menos: si el viewBox no lo refleja, el SVG deja aire al
  // final o recorta la última fila.
  const H = rows.reduce((acc, r) => acc + ((r.sub || r.breakdown) ? rowH : rowH - 6) + gap, 0);
  const max = opts.max ?? Math.max(1, ...rows.map((r) => r.value));
  const fv = opts.formatValue ?? fmt;
  const stacked = rows.some((r) => r.breakdown);

  const body = rows.map((r, i) => {
    // Una fila es de DOS LÍNEAS si lleva sub-etiqueta o si lleva desglose (que
    // imprime "% neg" bajo el valor). Antes el alto se decidía sólo por `sub`,
    // así que una fila con desglose y sin sub colocaba el valor en la línea
    // única y el "% neg" 5px más abajo, encima de la fila siguiente.
    const twoLine = Boolean(r.sub) || Boolean(r.breakdown);
    const barH = twoLine ? 11 : 13;
    const rowHeight = twoLine ? rowH : rowH - 6;
    const yTop = rows.slice(0, i).reduce(
      (acc, prev) => acc + ((prev.sub || prev.breakdown) ? rowH : rowH - 6) + gap, 0,
    );
    const barY = yTop + (twoLine ? 3 : (rowHeight - barH) / 2);
    const line1 = yTop + (twoLine ? 11 : rowHeight / 2 + 3.5);
    const line2 = yTop + 22;
    const total = Math.max(0, r.value);
    const wTotal = (total / max) * barMax;

    let bars = '';
    if (r.breakdown) {
      let cx = labelW + 8;
      const sum = r.breakdown.negative + r.breakdown.neutral + r.breakdown.positive || 1;
      bars = SENTIMENT_ORDER.map((k) => {
        const v = r.breakdown![k];
        if (v <= 0) return '';
        const wRaw = (v / sum) * wTotal;
        const w = Math.max(0.8, wRaw - GAP);
        const isLast = (k === 'positive') || (k === 'neutral' && r.breakdown!.positive === 0)
          || (k === 'negative' && r.breakdown!.neutral === 0 && r.breakdown!.positive === 0);
        const seg = `<g fill="${SENTIMENT_FILL[k]}">${barPath(cx, barY, w, barH, isLast ? 3 : 0, 'right')}</g>`;
        cx += wRaw;
        return seg;
      }).join('');
    } else {
      bars = `<g fill="${PRINT_PALETTE.accent}">${barPath(labelW + 8, barY, Math.max(0.8, wTotal), barH, 3, 'right')}</g>`;
    }

    const label = txt(0, line1, clip(r.label, 34), {
      size: 9.5, fill: PRINT_PALETTE.ink, weight: 500,
    });
    const sub = r.sub
      ? txt(0, line2, clip(r.sub, 46), { size: 8, fill: PRINT_PALETTE.ink3 })
      : '';
    const value = txt(W, line1, `${fv(r.value)}${opts.valueSuffix ?? ''}`, {
      size: 9.5, anchor: 'end', fill: PRINT_PALETTE.ink, weight: 600, tabular: true,
    });
    // % negativo como segunda cifra cuando la barra está descompuesta: es el
    // dato que el lector busca y que la pila sola no cuantifica.
    const negPct = r.breakdown && total > 0
      ? txt(W, line2, `${Math.round((r.breakdown.negative / total) * 100)} % neg`, {
          size: 7.5, anchor: 'end', fill: PRINT_PALETTE.ink3, tabular: true,
        })
      : '';

    return label + sub + bars + value + negPct;
  }).join('');

  const svg = `${svgOpen(W, H, `${opts.title ?? 'Distribución'}: ${rows.slice(0, 5).map((r) => `${r.label} ${fv(r.value)}`).join(', ')}`)}${body}</svg>`;
  return figure((stacked ? sentimentLegend() : '') + svg, { title: opts.title, note: opts.note });
}

// ============================================================
// 5 · Medidor con bandas (para los índices 0-1 y 0-100)
// ============================================================

export interface BandSpec { upTo: number; label: string }

/**
 * Medidor lineal: la posición del valor dentro de su rango, con las bandas del
 * índice marcadas. Sirve para crisis (0-1), BHI (0-1), polarización (0-100) y
 * NSS (-100 a +100), donde el número solo no dice si es alto o bajo PARA ESTE
 * índice. La banda activa va rotulada en texto, así que la lectura no depende
 * del color.
 */
export function bandMeter(opts: {
  value: number | null;
  min: number;
  max: number;
  bands: BandSpec[];
  /** Valor del período anterior — se marca con un tick hueco. */
  prev?: number | null;
  activeLabel?: string;
  invert?: boolean;
}): string {
  // El medidor vive DENTRO de un mosaico de ~200px de ancho y el SVG se escala a
  // ese ancho (width="100%"). Con un viewBox de 300 la escala era 0.66, así que
  // los rótulos de 7.5 quedaban en ~5px reales: ilegibles en pantalla y peor
  // impresos. El viewBox se dimensiona ahora ~1:1 con el mosaico y los cuerpos
  // suben, de modo que lo que se declara es lo que se lee.
  const W = 200;
  const H = 32;
  const trackY = 7;
  const trackH = 7;
  const { min, max } = opts;
  const span = max - min || 1;
  const X = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / span) * W;

  // Fondo del track y separadores de banda.
  const bandMarks = opts.bands.slice(0, -1).map((b) => {
    const x = X(b.upTo);
    return `<line x1="${x.toFixed(1)}" y1="${trackY - 2}" x2="${x.toFixed(1)}" y2="${trackY + trackH + 2}" stroke="${PRINT_PALETTE.surface}" stroke-width="2" />`;
  }).join('');

  const track = `<rect x="0" y="${trackY}" width="${W}" height="${trackH}" rx="3.5" fill="${PRINT_PALETTE.accentSoft}" />`;

  const baseline = trackY + trackH + 13;

  if (opts.value == null || !Number.isFinite(opts.value)) {
    return `${svgOpen(W, H, 'Indicador sin dato en el período')}${track}${bandMarks}
      ${txt(W / 2, baseline, 'sin dato en el período', { anchor: 'middle', size: 9 })}</svg>`;
  }

  const vx = X(opts.value);
  const fill = `<g fill="${PRINT_PALETTE.accent}">${barPath(0, trackY, Math.max(2, vx), trackH, 3.5, 'right')}</g>`;
  const knob = `<circle cx="${vx.toFixed(1)}" cy="${trackY + trackH / 2}" r="4.5" fill="${PRINT_PALETTE.accent}" stroke="${PRINT_PALETTE.surface}" stroke-width="2" />`;
  // Tick del período anterior. Va sin rótulo: el epígrafe de la sección ya
  // explica que el tick hueco es el período previo, y una palabra de 6 letras a
  // este ancho chocaba con los extremos de la escala.
  const prevTick = (opts.prev != null && Number.isFinite(opts.prev))
    ? `<line x1="${X(opts.prev).toFixed(1)}" y1="${trackY - 3}" x2="${X(opts.prev).toFixed(1)}" y2="${trackY + trackH + 3}" stroke="${PRINT_PALETTE.ink2}" stroke-width="1.5" />`
    : '';

  // Extremos de la escala + la banda activa nombrada en el centro: la lectura no
  // depende de acertar la posición del pomo contra un separador.
  const scale = txt(0, baseline, String(min), { size: 8.5, fill: PRINT_PALETTE.ink3, tabular: true })
    + txt(W, baseline, String(max), { size: 8.5, anchor: 'end', fill: PRINT_PALETTE.ink3, tabular: true })
    + (opts.activeLabel
      ? txt(W / 2, baseline, opts.activeLabel.toLowerCase(), { anchor: 'middle', size: 8.5, fill: PRINT_PALETTE.ink2, weight: 600 })
      : '');

  return `${svgOpen(W, H, `Valor ${opts.value} en escala ${min} a ${max}${opts.activeLabel ? `, banda ${opts.activeLabel}` : ''}`)}
    ${track}${fill}${bandMarks}${prevTick}${knob}${scale}</svg>`;
}

// ============================================================
// 6 · Heatmap horario (rampa secuencial de un solo hue)
// ============================================================

export function hourHeatmap(byHour: number[], opts: { title?: string } = {}): string {
  const total = byHour.reduce((a, b) => a + b, 0);
  if (total <= 0) return emptyFigure(opts.title ?? 'Distribución horaria', 'Sin datos horarios en el período.');

  const W = 720;
  const cell = 27;
  const H = cell + 40;
  const max = Math.max(...byHour);
  const steps = PRINT_PALETTE.seq;

  const cells = byHour.map((v, h) => {
    const x = h * (W / 24);
    const w = W / 24 - GAP;
    // Un hue, luminosidad creciente. El paso 0 significa "sin menciones" y va
    // deliberadamente casi al color del papel para que no se lea como dato.
    const idx = v === 0 ? 0 : Math.max(1, Math.min(steps.length - 1, Math.ceil((v / max) * (steps.length - 1))));
    const onDark = idx >= 4;
    return `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${cell}" rx="2" fill="${steps[idx]}" />`
      + (w > 16 ? txt(x + w / 2, cell / 2 + 3.5, v > 0 ? fmt(v) : '·', {
          anchor: 'middle', size: 8, weight: 600, tabular: true,
          fill: v === 0 ? PRINT_PALETTE.ink3 : (onDark ? '#FFFFFF' : PRINT_PALETTE.ink),
        }) : '')
      + (h % 3 === 0 ? txt(x + w / 2, cell + 12, `${h}h`, { anchor: 'middle', size: 8 }) : '');
  }).join('');

  // Escala de la rampa, con los mismos tokens que las celdas.
  const legW = 12;
  const legend = steps.map((c, i) => `<rect x="${i * (legW + 2)}" y="${cell + 22}" width="${legW}" height="8" rx="1.5" fill="${c}" />`).join('')
    + txt(steps.length * (legW + 2) + 6, cell + 29, `menos → más (máx. ${fmt(max)} en una hora)`, { size: 8 });

  const svg = `${svgOpen(W, H, `Menciones por hora del día en hora de Puerto Rico; máximo ${fmt(max)} menciones`)}${cells}${legend}</svg>`;
  return figure(svg, {
    title: opts.title,
    note: 'Hora de publicación en AST. El valor va impreso en cada celda: la lectura no depende del color.',
  });
}

// ============================================================
// 7 · Barras divergentes (delta vs período anterior)
// ============================================================

/**
 * Cambio porcentual de cada sentimiento contra el período previo. Divergente
 * real: dos polos opuestos (caída ← 0 → alza) alrededor de un cero neutro, con
 * el eje del cero marcado.
 */
export function deltaBars(deltas: Array<{ label: string; value: number; tone?: 'neg' | 'pos' | 'neu' }>, opts: { title?: string } = {}): string {
  if (!deltas.length) return emptyFigure(opts.title ?? 'Variación', 'Sin base de comparación.');
  const W = 720;
  const rowH = 30;
  const H = deltas.length * rowH + 6;
  const labelW = 150;
  const zeroX = labelW + (W - labelW) / 2;
  const halfW = (W - labelW) / 2 - 60;
  const max = Math.max(10, ...deltas.map((d) => Math.abs(d.value)));

  const body = deltas.map((d, i) => {
    const y = i * rowH;
    const barH = 12;
    const barY = y + (rowH - barH) / 2 - 2;
    const w = (Math.abs(d.value) / max) * halfW;
    const isUp = d.value >= 0;
    const fill = d.tone === 'pos' ? PRINT_PALETTE.positive
      : d.tone === 'neg' ? PRINT_PALETTE.negative
      : PRINT_PALETTE.ink2;
    const x = isUp ? zeroX + 1 : zeroX - 1 - w;
    const bar = `<g fill="${fill}">${barPath(x, barY, Math.max(1, w), barH, 3, 'right')}</g>`;
    const label = txt(0, barY + barH / 2 + 3.5, clip(d.label, 30), { size: 9.5, fill: PRINT_PALETTE.ink, weight: 500 });
    const value = txt(isUp ? Math.min(W, zeroX + w + 6) : Math.max(labelW, zeroX - w - 6), barY + barH / 2 + 3.5,
      `${d.value >= 0 ? '+' : ''}${d.value.toFixed(1)} %`,
      { size: 9.5, anchor: isUp ? 'start' : 'end', fill: PRINT_PALETTE.ink, weight: 600, tabular: true });
    return label + bar + value;
  }).join('');

  const axis = `<line x1="${zeroX}" y1="0" x2="${zeroX}" y2="${H - 6}" stroke="${PRINT_PALETTE.hairline}" stroke-width="1" />`;
  const svg = `${svgOpen(W, H, `Variación porcentual vs período anterior: ${deltas.map((d) => `${d.label} ${d.value.toFixed(1)}%`).join(', ')}`)}${axis}${body}</svg>`;
  return figure(svg, { title: opts.title, note: 'Cambio porcentual del conteo de cada sentimiento contra el período anterior de igual duración.' });
}

// ============================================================
// Utilidades internas
// ============================================================

function emptyFigure(title: string, message: string): string {
  return `<figure class="fig"><figcaption class="fig-cap">${esc(title)}</figcaption>`
    + `<p class="fig-empty">${esc(message)}</p></figure>`;
}

/**
 * Techo "redondo" para el eje. La escalera incluye 1.5 y 3 además de
 * 1/2/2.5/5: con sólo las potencias clásicas, un máximo de 141 saltaba a 200 y
 * la columna más alta ocupaba el 70 % del alto disponible — un tercio del
 * gráfico impreso era aire.
 */
function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/**
 * Marcas del eje. Se prefiere el número de divisiones que produzca valores
 * enteros: un eje con 37.5 en un conteo de menciones es ruido.
 */
function gridTicks(max: number, count: number): number[] {
  const divisions = [count, 5, 3, 2].find((d) => Number.isInteger(max / d)) ?? count;
  const out: number[] = [];
  for (let i = 1; i <= divisions; i += 1) out.push((max / divisions) * i);
  return out;
}
