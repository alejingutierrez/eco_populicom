/**
 * Template HTML del REPORTE DIARIO (antes "reporte semanal" — se renombró en
 * jul 2026 porque siempre se envió todos los días con ventana rolante de 7
 * días y el nombre confundía al destinatario).
 *
 * Cromo «Instrumento» (sep 2026, camino A del rediseño de correos): grafito
 * acromático, color solo en el dato, cifras en mono. El orden del cuerpo es
 * el que aprobó el cliente:
 *
 *   1. Lecturas — lo que cambió: negativo (delta), riesgo de crisis y
 *      sentimiento neto, con su delta vs los 7 días previos.
 *   2. Reparto del periodo — total + barra neg·neu·pos con conteo, % y delta.
 *   3. Resumen del día — titular, foto opcional de la nota, párrafo, viñetas.
 *   4. Tendencia día a día — columnas apiladas en tablas HTML (sin PNG).
 *   5. Insights por sentimiento — solo los que traen señal.
 *   6. Tópicos — top 5 + "Otros" plegado, con barra de reparto.
 *
 * Indicadores SIEMPRE numéricos (paridad con el dashboard vía formatMetric /
 * formatDelta), nunca la palabra cualitativa.
 */

import type { DeltaDisplay } from '../format/metrics-display';
import { fmtInt, esc, type EmailMetric } from './chrome';
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionRow,
  columnChart,
  deltaMono,
  heroImage,
  instrumentDocument,
  mono,
  readoutRow,
  sectionLabel,
  sectionRow,
  sentimentDeltaColor,
  stackedBar,
  swatch,
} from './instrument';

export interface DailyReportRenderData {
  agencyName: string;
  /** Siglas de la agencia destinataria (ej. "DDEC", "AAA"). Se usa en `<title>`. */
  agencyShortName: string;
  agencyKicker: string;
  periodLabel: string;
  updatedAtLabel: string;
  totals: {
    negative: number;
    neutral: number;
    positive: number;
    total: number;
  };
  deltaVsPrev: {
    negative: number;
    neutral: number;
    positive: number;
  };
  /**
   * Deltas de sentimiento ya formateados con `formatDelta` (@eco/shared/format).
   * Opcional y retro-compatible: si falta, el termómetro cae al cálculo local
   * `signedPct()`/`deltaWord()` a partir de `deltaVsPrev`.
   */
  deltaDisplay?: {
    negative: DeltaDisplay;
    neutral: DeltaDisplay;
    positive: DeltaDisplay;
  };
  /**
   * Legado: URL del PNG de QuickChart. Desde el cromo Instrumento (sep 2026)
   * la tendencia se dibuja con tablas HTML a partir de `dailySeries`; el
   * campo se ignora y queda opcional para no romper bundles viejos del lambda.
   */
  chartImageUrl?: string;
  dailySeries: Array<{
    date: string;
    dayLabel: string;
    negative: number;
    neutral: number;
    positive: number;
  }>;
  topicsTable: Array<{
    topic: string;
    subtopics: string;
    total: number;
    /**
     * Menciones donde este tópico aparece pero no como su top-confidence.
     * El correo no lo renderiza (la audiencia ejecutiva ya tiene suficiente
     * con el conteo principal); el dashboard sí lo muestra como "+N también
     * lo tocan" para que el usuario entienda que hay multi-clasificación.
     */
    secondaryCount: number;
    negative: number;
    neutral: number;
    positive: number;
    /** Fila agregada de tópicos que no entraron al top — se renderiza en gris */
    isOther?: boolean;
    /** Menciones sin tópico (aún en proceso) — se renderiza en gris suave */
    isUnclassified?: boolean;
  }>;
  insights: {
    negative: string[];
    neutral: string[];
    positive: string[];
  };
  /**
   * El lede del correo (ago 2026, «opción B» de la ronda de moldes con el
   * cliente): titular + párrafo corto que explica + viñetas que también
   * explican. Antes era un párrafo único de 120–160 palabras; se partió porque
   * el lector lo abre en el teléfono a las 6 a.m. y no lo leía entero.
   *
   * `headline` y `highlights` son opcionales para que un bundle viejo del
   * lambda (que solo manda `paragraph`) siga renderizando sin romperse.
   */
  dailySummary: {
    label: string;
    /** Titular de 8–16 palabras, sin cifras. Si falta, el bloque abre por el párrafo. */
    headline?: string;
    paragraph: string;
    /** 2–4 viñetas; cada una cuenta un hecho con su cifra de apoyo. */
    highlights?: string[];
  };
  /**
   * Indicadores compuestos ya formateados con `formatMetric`/`formatDelta`
   * (@eco/shared/format) — misma fuente que el dashboard. Se renderizan como
   * tiles numéricos con el delta vs los 7 días previos como línea de apoyo.
   * Opcional y retro-compatible: si falta, la sección no se renderiza.
   */
  metrics?: {
    crisis: EmailMetric;
    bhi: EmailMetric;
    nss: EmailMetric;
    polarization?: EmailMetric;
    velocity?: EmailMetric;
    engagementRate?: EmailMetric;
  };
  /** URL a la landing de Overview del dashboard para el CTA. */
  overviewUrl?: string;
  /**
   * Foto de la nota del día (opcional). Se muestra bajo el titular del
   * resumen; sin URL el bloque no se emite y el correo se lee igual.
   */
  heroImage?: { url: string; alt?: string | null; caption?: string | null } | null;
}
// ------------------------------------------------------------
// Helpers locales
// ------------------------------------------------------------

type Sentiment = 'negative' | 'neutral' | 'positive';

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

/**
 * Delta de conteo: el DeltaDisplay del formato compartido si el lambda lo
 * mandó; si no (bundle viejo), uno equivalente armado con `deltaVsPrev`, que
 * ya viene como % vs los 7 días previos.
 */
function countDelta(data: DailyReportRenderData, s: Sentiment): DeltaDisplay {
  const given = data.deltaDisplay?.[s];
  if (given) return given;
  const r = Math.round(data.deltaVsPrev[s]);
  const direction = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  return {
    word: r > 0 ? 'sube' : r < 0 ? 'baja' : 'estable',
    direction,
    arrow: r > 0 ? '▲' : r < 0 ? '▼' : '·',
    value: r > 0 ? `+${r}%` : r < 0 ? `−${Math.abs(r)}%` : '0%',
    magnitude: r,
    hasBaseline: true,
    tone: 'neutral',
  };
}

function countDeltaHtml(data: DailyReportRenderData, s: Sentiment): string {
  const dd = countDelta(data, s);
  return deltaMono(dd, sentimentDeltaColor(s, dd));
}

const SENTIMENTS: Array<{ key: Sentiment; label: string; short: string; color: string }> = [
  { key: 'negative', label: 'Negativo', short: 'Neg', color: T.neg },
  { key: 'neutral', label: 'Neutral', short: 'Neu', color: T.neu },
  { key: 'positive', label: 'Positivo', short: 'Pos', color: T.pos },
];

// ------------------------------------------------------------
// Secciones
// ------------------------------------------------------------

/** 1 · Lecturas: lo que cambió, en tres cifras. */
function renderReadouts(data: DailyReportRenderData): string {
  const neg = countDelta(data, 'negative');
  const negValue = neg.hasBaseline && neg.value ? esc(neg.value) : fmtInt(data.totals.negative);
  const negHint = neg.hasBaseline && neg.value
    ? `${fmtInt(data.totals.negative)} menciones`
    : 'sin base previa';
  const cells = [{ label: 'Negativo', valueHtml: negValue, hintHtml: negHint }];

  const metricCell = (label: string, m: EmailMetric | undefined) => {
    if (!m) return null;
    return {
      label,
      valueHtml: esc(m.display.value ?? '—'),
      hintHtml: deltaMono(m.delta) || (m.hint ? esc(m.hint) : ''),
    };
  };
  for (const c of [
    metricCell('Riesgo de crisis', data.metrics?.crisis),
    metricCell('Sentimiento neto', data.metrics?.nss),
  ]) {
    if (c) cells.push(c);
  }
  // Sin métricas (bundle viejo): las tres cifras son los conteos.
  if (cells.length === 1) {
    cells.push(
      { label: 'Neutral', valueHtml: fmtInt(data.totals.neutral), hintHtml: countDeltaHtml(data, 'neutral') },
      { label: 'Positivo', valueHtml: fmtInt(data.totals.positive), hintHtml: countDeltaHtml(data, 'positive') },
    );
  }
  return readoutRow(cells);
}

/** 2 · Reparto del periodo: total + barra + leyenda con conteo, % y delta. */
function renderDistribution(data: DailyReportRenderData): string {
  const { totals } = data;
  const legend = SENTIMENTS.map((s, i) => {
    const align = i === 0 ? 'left' : i === 1 ? 'center' : 'right';
    const delta = countDeltaHtml(data, s.key);
    return `<td class="stack-mobile" align="${align}" style="font-family:${FONT_MONO};font-size:12px;color:${T.ink2};line-height:1.5;padding-top:10px;">
                    ${swatch(s.color)}${esc(s.short)} ${fmtInt(totals[s.key])} · ${pct(totals[s.key], totals.total)}%${delta ? ` · ${delta}` : ''}
                  </td>`;
  }).join('');
  return sectionRow(`
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
                <tr>
                  <td align="left" valign="baseline" style="font-size:13px;color:${T.text2};">Menciones · 7 días vs 7 previos</td>
                  <td align="right" valign="baseline">${mono(fmtInt(totals.total), `font-size:20px;font-weight:500;color:${T.ink};`)}</td>
                </tr>
              </table>
              ${stackedBar(totals.negative, totals.neutral, totals.positive, 10)}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                <tr>${legend}</tr>
              </table>`, { padding: '20px 32px' });
}

/** 3 · Resumen del día: titular, foto opcional, párrafo y viñetas numeradas. */
function renderSummary(data: DailyReportRenderData): string {
  const s = data.dailySummary;
  const headline = (s.headline ?? '').trim();
  const h2 = headline
    ? `<h2 class="force-text-dark" style="margin:0 0 14px 0;font-family:${FONT_SANS};font-size:20px;font-weight:600;line-height:1.3;color:${T.ink};">${esc(headline)}</h2>`
    : '';
  const img = heroImage(data.heroImage ? { ...data.heroImage, alt: data.heroImage.alt ?? headline } : null);
  const items = (s.highlights ?? []).filter((x) => x && x.trim().length > 0).slice(0, 4);
  const list = items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
                ${items.map((x, i) => `<tr>
                  <td valign="top" width="24" style="width:24px;padding:5px 0;font-family:${FONT_MONO};font-size:14px;line-height:1.5;color:${T.text3};">${i + 1}</td>
                  <td valign="top" class="force-text-dark" style="padding:5px 0;font-size:14px;line-height:1.5;color:${T.ink};">${x}</td>
                </tr>`).join('')}
              </table>`
    : '';
  return sectionRow(`
              ${sectionLabel(`01 · ${s.label}`)}
              ${h2}
              ${img}
              <p style="margin:0;font-size:15px;line-height:1.6;color:${T.ink2};">${s.paragraph}</p>
              ${list}`);
}

/** 4 · Tendencia día a día — columnas apiladas; el día pico va resaltado. */
function renderTrend(data: DailyReportRenderData): string {
  const series = data.dailySeries;
  if (!series.length) {
    return sectionRow(`${sectionLabel('02 · Tendencia día a día')}
              <div style="font-size:13px;color:${T.text2};">Sin datos en el periodo.</div>`);
  }
  const totals = series.map((d) => d.negative + d.neutral + d.positive);
  const peak = Math.max(...totals);
  const alt = 'Tendencia diaria del sentimiento: ' +
    series.map((d) => `${d.dayLabel}: ${d.negative} neg, ${d.neutral} neu, ${d.positive} pos`).join('; ');
  const chart = columnChart(
    series.map((d, i) => ({
      label: d.dayLabel,
      emphasis: peak > 0 && totals[i] === peak,
      segments: [
        { value: d.negative, color: T.neg },
        { value: d.neutral, color: T.neu },
        { value: d.positive, color: T.pos },
      ],
    })),
    { height: 120, barWidth: 36, alt },
  );
  return sectionRow(`
              ${sectionLabel('02 · Tendencia día a día')}
              ${chart}`);
}

/** 5 · Insights: un bloque por sentimiento con señal; si ninguno, una línea. */
function renderInsights(data: DailyReportRenderData): string {
  const { totals } = data;
  const blocks = SENTIMENTS
    .map((s) => ({ ...s, items: data.insights[s.key].filter((x) => x && x.trim().length > 0) }))
    .filter((b) => b.items.length > 0);
  const body = blocks.length
    ? blocks.map((b, bi) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${bi > 0 ? 'margin-top:18px;' : ''}">
                <tr>
                  <td align="left" style="padding:0 0 6px 0;border-bottom:1px solid ${T.line};font-size:13px;font-weight:600;color:${T.ink};">${swatch(b.color)}${esc(b.label)}</td>
                  <td align="right" style="padding:0 0 6px 0;border-bottom:1px solid ${T.line};font-family:${FONT_MONO};font-size:12px;color:${T.text2};">${pct(totals[b.key], totals.total)}% del total</td>
                </tr>
                ${b.items.map((x) => `<tr><td colspan="2" class="force-text-dark" style="padding:8px 0 0 0;font-size:14px;line-height:1.55;color:${T.ink};">${x}</td></tr>`).join('')}
              </table>`).join('')
    : `<div style="font-size:13px;color:${T.text2};">Sin señal suficiente para insights en este periodo.</div>`;
  return sectionRow(`
              ${sectionLabel('03 · Insights')}
              ${body}`);
}

/** 6 · Tópicos: top 5 con nombre; el resto se pliega en "Otros tópicos". */
function renderTopics(data: DailyReportRenderData): string {
  const namedTopics = data.topicsTable.filter((t) => !t.isOther && !t.isUnclassified);
  const foldedTopics = namedTopics.slice(5);
  const prevOther = data.topicsTable.find((t) => t.isOther);
  const otherRow: DailyReportRenderData['topicsTable'] = (foldedTopics.length > 0 || prevOther)
    ? [{
        // Si plegamos tópicos aquí, el "(N)" del label upstream quedaría corto;
        // un label plano nunca miente.
        topic: foldedTopics.length > 0 ? 'Otros tópicos' : (prevOther?.topic ?? 'Otros tópicos'),
        subtopics: '',
        secondaryCount: 0,
        total: (prevOther?.total ?? 0) + foldedTopics.reduce((s, t) => s + t.total, 0),
        negative: (prevOther?.negative ?? 0) + foldedTopics.reduce((s, t) => s + t.negative, 0),
        neutral: (prevOther?.neutral ?? 0) + foldedTopics.reduce((s, t) => s + t.neutral, 0),
        positive: (prevOther?.positive ?? 0) + foldedTopics.reduce((s, t) => s + t.positive, 0),
        isOther: true,
      }]
    : [];
  const list = [
    ...namedTopics.slice(0, 5),
    ...otherRow,
    ...data.topicsTable.filter((t) => t.isUnclassified),
  ];
  if (!list.length) {
    return sectionRow(`${sectionLabel('04 · Tópicos')}
              <div style="font-size:13px;color:${T.text2};">Sin menciones clasificadas por tópico en este periodo.</div>`);
  }
  const rows = list.map((t) => {
    const muted = Boolean(t.isOther || t.isUnclassified);
    const subs = t.subtopics
      ? `<div style="font-size:12px;color:${T.text3};line-height:1.4;margin-top:2px;${t.isUnclassified ? 'font-style:italic;' : ''}">${esc(t.subtopics)}</div>`
      : '';
    return `<tr>
                  <td valign="middle" style="padding:10px 12px 10px 0;border-bottom:1px solid ${T.line};">
                    <div style="font-size:14px;font-weight:${muted ? 400 : 600};color:${muted ? T.text2 : T.ink};line-height:1.35;">${esc(t.topic)}</div>
                    ${subs}
                  </td>
                  <td valign="middle" align="right" width="56" style="width:56px;padding:10px 12px;border-bottom:1px solid ${T.line};font-family:${FONT_MONO};font-size:14px;color:${muted ? T.text2 : T.ink};">${fmtInt(t.total)}</td>
                  <td valign="middle" width="150" class="hide-mobile" style="width:150px;padding:10px 0;border-bottom:1px solid ${T.line};">${stackedBar(t.negative, t.neutral, t.positive, 8)}</td>
                </tr>`;
  }).join('');
  const { totals } = data;
  const footer = `<tr>
                  <td style="padding:10px 12px 0 0;font-size:12px;color:${T.text2};">Total del periodo</td>
                  <td align="right" style="padding:10px 12px 0 12px;font-family:${FONT_MONO};font-size:14px;font-weight:600;color:${T.ink};">${fmtInt(totals.total)}</td>
                  <td class="hide-mobile" style="padding:10px 0 0 0;font-family:${FONT_MONO};font-size:11px;color:${T.text2};text-align:right;">${pct(totals.negative, totals.total)} · ${pct(totals.neutral, totals.total)} · ${pct(totals.positive, totals.total)}%</td>
                </tr>`;
  return sectionRow(`
              ${sectionLabel('04 · Tópicos')}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                ${rows}
                ${footer}
              </table>`);
}

/**
 * Vista previa del inbox (lo que se lee bajo el asunto): las cifras que
 * cambiaron, para que el asunto pueda contar el hecho del día.
 */
export function dailyPreheader(data: DailyReportRenderData): string {
  const parts = [`${fmtInt(data.totals.total)} menciones en 7 días`];
  const neg = countDelta(data, 'negative');
  parts.push(`negativo ${fmtInt(data.totals.negative)}${neg.hasBaseline && neg.value ? ` (${neg.value})` : ''}`);
  const crisis = data.metrics?.crisis;
  if (crisis?.display.value) {
    const d = crisis.delta?.hasBaseline && crisis.delta.value ? ` (${crisis.delta.value})` : '';
    parts.push(`riesgo de crisis ${crisis.display.value}${d}`);
  }
  return parts.join(' · ');
}

// ------------------------------------------------------------
// Render principal
// ------------------------------------------------------------

export function renderDailyReportHtml(data: DailyReportRenderData): string {
  const contentRows = [
    renderReadouts(data),
    renderDistribution(data),
    renderSummary(data),
    renderTrend(data),
    renderInsights(data),
    renderTopics(data),
    actionRow(data.overviewUrl || '#', 'Abrir el dashboard'),
  ].join('\n');

  return instrumentDocument({
    title: `Reporte diario ECO · ${data.agencyShortName} · ${data.periodLabel}`,
    preheader: dailyPreheader(data),
    kind: 'daily',
    heading: {
      kicker: data.agencyKicker,
      title: `Conversación pública, ${data.periodLabel}`,
      meta: `7 días cerrados · actualizado ${data.updatedAtLabel}`,
    },
    contentRows,
  });
}
