/**
 * Template HTML del RESUMEN SEMANAL (jul 2026; cromo «Instrumento» desde
 * sep 2026, camino A del rediseño de correos).
 *
 * Llega los viernes y compara la semana cerrada (7 días terminando ayer)
 * contra la anterior. Orden aprobado:
 *
 *   1. Lecturas — los 4 indicadores con su delta semanal.
 *   2. La semana en un vistazo — titular, foto opcional, párrafo.
 *   3. Semana vs semana — tabla de menciones y sentimiento.
 *   4. Ritmo diario — columnas pareadas (anterior gris, actual grafito).
 *   5. Qué cambió — viñetas del LLM.
 *   6. Tópicos — esta semana, anterior, cambio y % negativo.
 *   7. Lo más resonante — menciones top con miniatura opcional.
 *
 * Las secciones condicionales se numeran en orden de aparición para no dejar
 * huecos ("02 → 05"). Indicadores NUMÉRICOS (paridad dashboard).
 */

import type { DeltaDisplay } from '../format/metrics-display';
import { esc, fmtInt, type EmailMetric } from './chrome';
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionRow,
  compareTable,
  deltaMono,
  heroImage,
  instrumentDocument,
  mentionRow,
  mono,
  numberedList,
  pairedColumnChart,
  readoutRow,
  sectionLabel,
  sectionRow,
  swatch,
} from './instrument';

export interface SentimentTotalsLite {
  negative: number;
  neutral: number;
  positive: number;
  total: number;
}

export interface WeeklySummaryRenderData {
  agencyName: string;
  agencyShortName: string;
  agencyKicker: string;
  /** "30 jun – 6 jul 2026" — semana cerrada que cubre el correo. */
  weekLabel: string;
  /** "23 – 29 jun 2026" — semana de comparación. */
  prevWeekLabel: string;
  updatedAtLabel: string;

  totals: SentimentTotalsLite;
  prevTotals: SentimentTotalsLite;
  /** Delta % de menciones totales vs semana anterior (formatDelta percent). */
  totalDelta: DeltaDisplay;
  /** Delta % por sentimiento vs semana anterior (formatDelta percent; negativo con invert). */
  sentimentDelta: {
    negative: DeltaDisplay;
    neutral: DeltaDisplay;
    positive: DeltaDisplay;
  };

  /**
   * Indicadores compuestos con delta semanal — mismos valores que el dashboard.
   * Se renderizan 4 tiles (crisis, nss, bhi, polarization — decisión del
   * cliente ago 2026, espejo del recorte del diario). `velocity` y
   * `engagementRate` se aceptan por retro-compatibilidad pero YA NO se
   * muestran: la Velocidad es cambio % de volumen desde jul 2026 y duplicaba
   * el delta que preside "Semana vs semana".
   */
  metrics?: {
    crisis: EmailMetric;
    bhi: EmailMetric;
    nss: EmailMetric;
    polarization?: EmailMetric;
    velocity?: EmailMetric;
    engagementRate?: EmailMetric;
  };

  /**
   * Legado: PNG de QuickChart. Desde el cromo Instrumento (sep 2026) el ritmo
   * diario se dibuja con tablas HTML desde `dailyCompare`; se ignora.
   */
  chartImageUrl?: string;
  /** Volumen diario de esta semana junto al mismo día de la anterior. */
  dailyCompare?: Array<{ label: string; cur: number; prev: number }>;
  /** Foto de la nota más resonante de la semana (opcional). */
  heroImage?: { url: string; alt?: string | null; caption?: string | null } | null;

  /**
   * Titular del cambio central de la semana (LLM). Opcional para que un bundle
   * viejo del lambda siga renderizando sin él (ago 2026).
   */
  weeklyHeadline?: string;
  /** Párrafo ejecutivo de la semana (LLM). HTML inline permitido. */
  weeklySummary: string;
  /** 2–4 highlights "qué cambió esta semana" (LLM). HTML inline permitido. */
  highlights: string[];

  /** Comparación de tópicos: conteo actual vs semana anterior + delta %. */
  topicsCompare: Array<{
    topic: string;
    cur: number;
    prev: number;
    delta: DeltaDisplay;
    /** % de menciones negativas del tópico en la semana actual (0–100). null cuando cur=0. */
    negShare?: number | null;
  }>;

  /**
   * Tópicos que tenían volumen la semana anterior y esta semana no registran
   * (excluye los que ya aparecen en la tabla con cur=0). Línea al pie de Tópicos.
   */
  goneTopics?: Array<{ topic: string; prev: number }>;

  /**
   * Menciones con mayor engagement de la semana (3–5), para aterrizar el
   * reporte en contenido concreto y no solo en categorías.
   */
  topMentions?: Array<{
    sourceLabel: string;
    title: string | null;
    snippet: string;
    url: string | null;
    /** "1,240 interacciones". */
    engagementLabel: string;
    /** "2 jul". */
    publishedAtLabel: string;
    tone: 'negative' | 'neutral' | 'positive';
    /** Miniatura 72×72 opcional (foto del post o de la nota). */
    imageUrl?: string | null;
  }>;

  /** Deeplink al Overview del dashboard — lo usan los 3 CTAs (se omiten si falta). */
  dashboardUrl?: string | null;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

type Sentiment = 'negative' | 'neutral' | 'positive';

const SENTIMENTS: Array<{ key: Sentiment; label: string; color: string }> = [
  { key: 'negative', label: 'Negativo', color: T.neg },
  { key: 'neutral', label: 'Neutral', color: T.neu },
  { key: 'positive', label: 'Positivo', color: T.pos },
];

function share(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

/**
 * Delta en mono o "—" sin base de comparación. `judged: false` lo pinta en
 * gris: el volumen total, el neutral y el de un tópico cambian sin que eso
 * sea bueno o malo, y el color se reserva para lo que sí se juzga.
 */
function deltaOrDash(dd: DeltaDisplay | null | undefined, judged = true): string {
  return deltaMono(dd, judged ? undefined : T.text2) || `<span style="font-family:${FONT_MONO};color:${T.text3};">—</span>`;
}

const TH = `font-family:${FONT_MONO};font-size:12px;font-weight:400;color:${T.text3};padding:0 0 8px 0;border-bottom:1px solid ${T.rule};`;
const TD_NUM = `font-family:${FONT_MONO};font-size:14px;padding:8px 0;border-bottom:1px solid ${T.line};white-space:nowrap;`;

// ------------------------------------------------------------
// Secciones
// ------------------------------------------------------------

/** Lecturas: los 4 indicadores en una rejilla 2×2. */
function renderReadouts(data: WeeklySummaryRenderData): string {
  const m = data.metrics;
  if (!m) return '';
  const cell = (label: string, metric: EmailMetric | undefined) => metric
    ? {
        label,
        valueHtml: esc(metric.display.value ?? '—'),
        hintHtml: deltaMono(metric.delta) || (metric.hint ? esc(metric.hint) : ''),
      }
    : null;
  const cells = [
    cell('Riesgo de crisis', m.crisis),
    cell('Sentimiento neto', m.nss),
    cell('Salud de marca', m.bhi),
    cell('Polarización', m.polarization),
  ].filter((c): c is NonNullable<typeof c> => c != null);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(readoutRow(cells.slice(i, i + 2)));
  return rows.join('\n');
}

function renderGlance(data: WeeklySummaryRenderData, sec: string): string {
  const headline = (data.weeklyHeadline ?? '').trim();
  const h2 = headline
    ? `<h2 class="force-text-dark" style="margin:0 0 14px 0;font-family:${FONT_SANS};font-size:20px;font-weight:600;line-height:1.3;color:${T.ink};">${esc(headline)}</h2>`
    : '';
  const img = heroImage(data.heroImage ? { ...data.heroImage, alt: data.heroImage.alt ?? headline } : null);
  return sectionRow(`
              ${sectionLabel(`${sec} · La semana en un vistazo`)}
              ${h2}
              ${img}
              <p style="margin:0;font-size:15px;line-height:1.6;color:${T.ink2};">${data.weeklySummary}</p>`);
}

function renderWeekVsWeek(data: WeeklySummaryRenderData, sec: string): string {
  const { totals, prevTotals } = data;
  return sectionRow(`
              ${sectionLabel(`${sec} · Semana vs semana`)}
              ${compareTable({
                headers: ['Sentimiento', 'Esta', 'Anterior', 'Cambio'],
                rows: [
                  { labelHtml: 'Menciones', cur: fmtInt(totals.total), prev: fmtInt(prevTotals.total), changeHtml: deltaOrDash(data.totalDelta, false), strong: true },
                  ...SENTIMENTS.map((s) => ({
                    labelHtml: `${swatch(s.color)}${esc(s.label)}`,
                    cur: `${fmtInt(totals[s.key])} <span style="color:${T.text3};font-size:12px;">· ${share(totals[s.key], totals.total)}%</span>`,
                    prev: fmtInt(prevTotals[s.key]),
                    changeHtml: deltaOrDash(data.sentimentDelta[s.key], s.key !== 'neutral'),
                  })),
                ],
              })}`);
}

function renderRhythm(data: WeeklySummaryRenderData, sec: string): string {
  const days = data.dailyCompare ?? [];
  if (!days.length) return '';
  const alt = 'Volumen diario, esta semana vs la anterior: ' +
    days.map((d) => `${d.label}: ${d.cur} (antes ${d.prev})`).join('; ');
  return sectionRow(`
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;">
                <tr>
                  <td align="left" valign="top">${sectionLabel(`${sec} · Ritmo diario`)}</td>
                  <td align="right" valign="top" style="font-size:12px;color:${T.text2};white-space:nowrap;">${swatch(T.ink)}Esta semana &nbsp; ${swatch(T.ref)}Anterior</td>
                </tr>
              </table>
              ${pairedColumnChart(days, { height: 120, barWidth: 18, alt })}`);
}

function renderHighlights(items: string[], sec: string): string {
  const list = numberedList(items);
  if (!list) return '';
  return sectionRow(`
              ${sectionLabel(`${sec} · Qué cambió`)}
              ${list}`);
}

function renderTopics(data: WeeklySummaryRenderData, sec: string): string {
  const items = data.topicsCompare.slice(0, 8);
  if (!items.length) {
    return sectionRow(`${sectionLabel(`${sec} · Tópicos`)}
              <div style="font-size:13px;color:${T.text2};">Sin menciones clasificadas por tópico en la semana.</div>`);
  }
  const rows = items.map((t, i) => {
    const b = i === items.length - 1 ? 'border-bottom:0;' : '';
    // Concentración negativa: el color es el dato (rojo ≥50%, ámbar ≥25%).
    const neg = t.negShare == null
      ? `<span style="color:${T.text3};">—</span>`
      : `<span style="color:${t.negShare >= 50 ? T.neg : t.negShare >= 25 ? T.warn : T.text2};">${t.negShare}%</span>`;
    return `<tr>
                  <td style="font-size:14px;font-weight:600;line-height:1.35;padding:8px 8px 8px 0;border-bottom:1px solid ${T.line};${b}">${esc(t.topic)}</td>
                  <td align="right" style="${TD_NUM}${b}">${fmtInt(t.cur)}</td>
                  <td align="right" class="hide-mobile" style="${TD_NUM}${b}color:${T.text2};padding-left:10px;">${fmtInt(t.prev)}</td>
                  <td align="right" style="${TD_NUM}${b}padding-left:10px;">${deltaOrDash(t.delta, false)}</td>
                  <td align="right" style="${TD_NUM}${b}padding-left:10px;">${neg}</td>
                </tr>`;
  }).join('');
  const gone = (data.goneTopics ?? []).filter((t) => t.topic && t.prev > 0).slice(0, 4);
  const goneLine = gone.length
    ? `<div style="margin-top:12px;font-size:13px;line-height:1.5;color:${T.text2};">Salieron de la conversación: ${gone.map((t) => `<strong style="font-weight:600;color:${T.ink};">${esc(t.topic)}</strong> ${mono(`(${fmtInt(t.prev)} la semana anterior)`)}`).join(' · ')}.</div>`
    : '';
  return sectionRow(`
              ${sectionLabel(`${sec} · Tópicos`)}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <th align="left" style="${TH}font-family:${FONT_SANS};">Tópico</th>
                  <th align="right" style="${TH}">Esta</th>
                  <th align="right" class="hide-mobile" style="${TH}padding-left:10px;">Anterior</th>
                  <th align="right" style="${TH}padding-left:10px;">Cambio</th>
                  <th align="right" style="${TH}padding-left:10px;">% neg.</th>
                </tr>
                ${rows}
              </table>
              ${goneLine}`);
}

const TONE_WORD: Record<Sentiment, string> = { negative: 'negativo', neutral: 'neutral', positive: 'positivo' };

function renderTopMentions(data: WeeklySummaryRenderData, sec: string): string {
  const items = (data.topMentions ?? []).slice(0, 5);
  if (!items.length) return '';
  const rows = items.map((m, i) => mentionRow({
    meta: `${m.sourceLabel} · ${m.publishedAtLabel} · ${TONE_WORD[m.tone]} · ${m.engagementLabel}`,
    title: m.title,
    text: m.snippet,
    url: m.url,
    imageUrl: m.imageUrl,
    last: i === items.length - 1,
  })).join('');
  return sectionRow(`
              ${sectionLabel(`${sec} · Lo más resonante`)}
              ${rows}`);
}

/**
 * Vista previa del inbox: el volumen contra la semana anterior y los dos
 * movimientos que más pesan, para que el asunto pueda ser el titular.
 */
export function weeklyPreheader(data: WeeklySummaryRenderData): string {
  const parts: string[] = [];
  const td = data.totalDelta;
  parts.push(`${fmtInt(data.totals.total)} menciones vs ${fmtInt(data.prevTotals.total)}${td.hasBaseline && td.value ? ` (${td.value})` : ''}`);
  const neg = data.sentimentDelta.negative;
  if (neg.hasBaseline && neg.value) parts.push(`negativo ${neg.value}`);
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

export function renderWeeklySummaryHtml(data: WeeklySummaryRenderData): string {
  let n = 0;
  const next = () => String(++n).padStart(2, '0');

  const sections = [
    renderReadouts(data),
    renderGlance(data, next()),
    renderWeekVsWeek(data, next()),
  ];
  const rhythm = (data.dailyCompare ?? []).length ? renderRhythm(data, next()) : '';
  const highlights = data.highlights.some((s) => s && s.trim()) ? renderHighlights(data.highlights, next()) : '';
  const topics = renderTopics(data, next());
  const mentions = (data.topMentions ?? []).length ? renderTopMentions(data, next()) : '';
  sections.push(rhythm, highlights, topics, mentions);
  if (data.dashboardUrl) sections.push(actionRow(data.dashboardUrl, 'Abrir la semana en el dashboard'));

  return instrumentDocument({
    title: `Resumen semanal ECO · ${data.agencyShortName} · ${data.weekLabel}`,
    preheader: weeklyPreheader(data),
    kind: 'weekly',
    heading: {
      kicker: data.agencyKicker,
      title: `Semana del ${data.weekLabel}`,
      meta: `comparada con ${data.prevWeekLabel} · actualizado ${data.updatedAtLabel}`,
    },
    contentRows: sections.filter(Boolean).join('\n'),
  });
}
