/**
 * Template HTML del correo de NOMBRAMIENTO (ago 2026; cromo «Instrumento»
 * desde sep 2026, camino A del rediseño de correos).
 *
 * Se dispara una sola vez, cuando se registra un nombramiento nuevo en una
 * agencia monitoreada, y cubre desde el día del nombramiento hasta HOY.
 *
 * Diferencias deliberadas con el diario y el semanal:
 *  - El encabezado no es el periodo: es la FICHA (retrato, nombre, cargo, a
 *    quién sustituye y desde cuándo). El lector abre el correo por el hecho.
 *  - El periodo INCLUYE hoy (parcial). El correo lo dice y la última columna
 *    del ritmo diario va punteada para que nadie la lea como una caída.
 *  - La comparación es contra los MISMOS días inmediatamente ANTERIORES al
 *    nombramiento — separa el efecto del anuncio del nivel base.
 *  - Sección propia "Recepción" (ejes del LLM).
 *
 * Indicadores NUMÉRICOS (paridad dashboard), sin palabra cualitativa.
 */

import type { DeltaDisplay } from '../format/metrics-display';
import { esc, fmtInt, type EmailMetric } from './chrome';
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionRow,
  columnChart,
  compareTable,
  deltaMono,
  heroImage,
  instrumentDocument,
  mentionRow,
  numberedList,
  readoutRow,
  sectionLabel,
  sectionRow,
  swatch,
} from './instrument';

export interface AppointmentTotalsLite {
  negative: number;
  neutral: number;
  positive: number;
  total: number;
}

export interface AppointmentRenderData {
  agencyName: string;
  agencyShortName: string;
  agencyKicker: string;

  /** Ficha del nombramiento — el protagonista del correo. */
  appointment: {
    personName: string;
    position: string;
    predecessor?: string | null;
    /** "lunes 10 de agosto de 2026". */
    announcedOnLabel: string;
    notes?: string | null;
    /**
     * Retrato de la persona. Debe ser una URL ESTABLE y servida por nosotros
     * (`{dashboard}/appointments/<slug>.jpg`): las og:image de los medios de PR
     * vienen con token firmado (`?auth=…`) que expira y dejaría el correo con
     * la imagen rota semanas después. Si falta, se dibuja un monograma con las
     * iniciales — el correo nunca depende de la foto.
     */
    photoUrl?: string | null;
  };

  /** "9 – 12 ago 2026" — ventana cubierta (nombramiento → hoy). */
  windowLabel: string;
  /** "5 – 8 ago 2026" — misma cantidad de días, justo antes del nombramiento. */
  baselineLabel: string;
  /** Días naturales cubiertos, incluyendo hoy parcial. */
  windowDays: number;
  updatedAtLabel: string;

  totals: AppointmentTotalsLite;
  baselineTotals: AppointmentTotalsLite;
  totalDelta: DeltaDisplay;
  sentimentDelta: {
    negative: DeltaDisplay;
    neutral: DeltaDisplay;
    positive: DeltaDisplay;
  };

  /** Indicadores compuestos con delta vs los días previos al nombramiento. */
  metrics?: {
    crisis: EmailMetric;
    bhi: EmailMetric;
    nss: EmailMetric;
    polarization?: EmailMetric;
  };

  /**
   * Legado: PNG de QuickChart. Desde el cromo Instrumento (sep 2026) el ritmo
   * diario se dibuja con tablas HTML desde `dailySeries`; se ignora.
   */
  chartImageUrl?: string;
  /** Volumen diario por sentimiento desde el nombramiento; el último día es HOY (parcial). */
  dailySeries?: Array<{ dayLabel: string; negative: number; neutral: number; positive: number }>;
  /** Foto de la nota más resonante del periodo (opcional). */
  heroImage?: { url: string; alt?: string | null; caption?: string | null } | null;

  /**
   * Titular del hallazgo: cómo cayó el nombramiento (LLM). Opcional para que un
   * bundle viejo del lambda siga renderizando; si falta, el bloque abre por el
   * párrafo, como antes de ago 2026.
   */
  headline?: string;
  /** Párrafo ejecutivo: cómo cayó el nombramiento (LLM). HTML inline permitido. */
  summary: string;
  /** 2–4 ejes de recepción (LLM). HTML inline permitido. */
  reception: string[];
  /** 2–4 movimientos numéricos vs los días previos (LLM). HTML inline permitido. */
  highlights: string[];

  /** Tópicos del periodo con su concentración negativa. */
  topics: Array<{
    topic: string;
    total: number;
    negShare?: number | null;
  }>;

  /** Menciones con mayor engagement del periodo. */
  topMentions?: Array<{
    sourceLabel: string;
    title: string | null;
    snippet: string;
    url: string | null;
    engagementLabel: string;
    publishedAtLabel: string;
    tone: 'negative' | 'neutral' | 'positive';
    /** Miniatura 72×72 opcional. */
    imageUrl?: string | null;
  }>;

  /** Deeplink al Overview del dashboard. */
  dashboardUrl?: string | null;
}
/**
 * Iniciales para el monograma cuando no hay foto.
 *
 * Toma el nombre de pila y el PRIMER apellido, no el último: en la convención
 * española el apellido que identifica es el primero, así que "Norma E. Burgos
 * Andújar" es NB (no NA, que sería el apellido materno). Descarta las
 * iniciales sueltas tipo "E." para que no se cuelen como palabra.
 */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length > 1);
  const first = words[0]?.[0] ?? name.replace(/[^\p{L}]/gu, '')[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return `${first}${second}`.toUpperCase();
}

const PHOTO_PX = 88;

/**
 * Retrato cuadrado 88×88, o monograma acromático con las iniciales en mono si
 * no hay foto. `width`/`height` como atributos: Outlook desktop solo respeta
 * esos.
 */
function portrait(a: AppointmentRenderData['appointment']): string {
  if (a.photoUrl) {
    return `<img src="${esc(a.photoUrl)}" alt="${esc(a.personName)}" width="${PHOTO_PX}" height="${PHOTO_PX}" style="display:block;width:${PHOTO_PX}px;height:${PHOTO_PX}px;object-fit:cover;border:0;background:${T.page};">`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PHOTO_PX}" height="${PHOTO_PX}" style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;background:${T.page};background-color:${T.page};border:1px solid ${T.line};">
                    <tr><td align="center" valign="middle" style="height:${PHOTO_PX}px;font-family:${FONT_MONO};font-size:28px;font-weight:500;color:${T.ink};line-height:1;">${esc(initialsOf(a.personName))}</td></tr>
                  </table>`;
}

type Sentiment = 'negative' | 'neutral' | 'positive';

const SENTIMENTS: Array<{ key: Sentiment; label: string; color: string }> = [
  { key: 'negative', label: 'Negativo', color: T.neg },
  { key: 'neutral', label: 'Neutral', color: T.neu },
  { key: 'positive', label: 'Positivo', color: T.pos },
];

const TONE_WORD: Record<Sentiment, string> = { negative: 'negativo', neutral: 'neutral', positive: 'positivo' };

function share(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

/** Delta en mono o "—"; `judged: false` lo pinta en gris (volumen, neutral). */
function deltaOrDash(dd: DeltaDisplay | null | undefined, judged = true): string {
  return deltaMono(dd, judged ? undefined : T.text2) || `<span style="font-family:${FONT_MONO};color:${T.text3};">—</span>`;
}

// ------------------------------------------------------------
// Secciones
// ------------------------------------------------------------

function renderWindowBand(data: AppointmentRenderData): string {
  const days = `${data.windowDays} ${data.windowDays === 1 ? 'día' : 'días'}, hoy incluido (parcial)`;
  return sectionRow(
    `<div style="font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${T.text2};">${esc(data.windowLabel)} · ${esc(days)} · vs ${esc(data.baselineLabel)}</div>`,
    { padding: '14px 32px', bg: T.subtle },
  );
}

function renderReadouts(data: AppointmentRenderData): string {
  const td = data.totalDelta;
  const first = [{
    label: 'Menciones',
    valueHtml: fmtInt(data.totals.total),
    hintHtml: `${deltaMono(td, T.text2) || ''}${td.hasBaseline ? ` · antes ${fmtInt(data.baselineTotals.total)}` : ''}`,
  }];
  const m = data.metrics;
  if (!m) return readoutRow(first);
  const cell = (label: string, metric: EmailMetric | undefined) => metric
    ? { label, valueHtml: esc(metric.display.value ?? '—'), hintHtml: deltaMono(metric.delta) || (metric.hint ? esc(metric.hint) : '') }
    : null;
  const row1 = [...first, cell('Riesgo de crisis', m.crisis), cell('Sentimiento neto', m.nss)].filter((c): c is NonNullable<typeof c> => c != null);
  const row2 = [cell('Salud de marca', m.bhi), cell('Polarización', m.polarization)].filter((c): c is NonNullable<typeof c> => c != null);
  return [readoutRow(row1), row2.length ? readoutRow(row2) : ''].join('\n');
}

function renderLanding(data: AppointmentRenderData, sec: string): string {
  const headline = (data.headline ?? '').trim();
  const h2 = headline
    ? `<h2 class="force-text-dark" style="margin:0 0 14px 0;font-family:${FONT_SANS};font-size:20px;font-weight:600;line-height:1.3;color:${T.ink};">${esc(headline)}</h2>`
    : '';
  const img = heroImage(data.heroImage ? { ...data.heroImage, alt: data.heroImage.alt ?? headline } : null);
  return sectionRow(`
              ${sectionLabel(`${sec} · Cómo cayó el nombramiento`)}
              ${h2}
              ${img}
              <p style="margin:0;font-size:15px;line-height:1.6;color:${T.ink2};">${data.summary}</p>`);
}

function renderSinceVsBefore(data: AppointmentRenderData, sec: string): string {
  const { totals, baselineTotals } = data;
  return sectionRow(`
              ${sectionLabel(`${sec} · Desde el nombramiento vs los días previos`)}
              ${compareTable({
                headers: ['Sentimiento', 'Desde', 'Antes', 'Cambio'],
                rows: [
                  { labelHtml: 'Menciones', cur: fmtInt(totals.total), prev: fmtInt(baselineTotals.total), changeHtml: deltaOrDash(data.totalDelta, false), strong: true },
                  ...SENTIMENTS.map((s) => ({
                    labelHtml: `${swatch(s.color)}${esc(s.label)}`,
                    cur: `${fmtInt(totals[s.key])} <span style="color:${T.text3};font-size:12px;">· ${share(totals[s.key], totals.total)}%</span>`,
                    prev: fmtInt(baselineTotals[s.key]),
                    changeHtml: deltaOrDash(data.sentimentDelta[s.key], s.key !== 'neutral'),
                  })),
                ],
              })}`);
}

function renderRhythm(data: AppointmentRenderData, sec: string): string {
  const series = data.dailySeries ?? [];
  if (!series.length) return '';
  const totals = series.map((d) => d.negative + d.neutral + d.positive);
  const peak = Math.max(...totals);
  const lastIdx = series.length - 1;
  const alt = 'Menciones por día desde el nombramiento (el último día es hoy, parcial): ' +
    series.map((d) => `${d.dayLabel}: ${d.negative} neg, ${d.neutral} neu, ${d.positive} pos`).join('; ');
  const chart = columnChart(
    series.map((d, i) => ({
      label: i === lastIdx ? `${d.dayLabel} (hoy)` : d.dayLabel,
      emphasis: peak > 0 && totals[i] === peak,
      partial: i === lastIdx,
      totalLabel: i === lastIdx ? `${totals[i]} · parcial` : undefined,
      segments: [
        { value: d.negative, color: T.neg },
        { value: d.neutral, color: T.neu },
        { value: d.positive, color: T.pos },
      ],
    })),
    { height: 120, barWidth: series.length > 10 ? 20 : 40, alt },
  );
  return sectionRow(`
              ${sectionLabel(`${sec} · Día a día desde el nombramiento`)}
              ${chart}
              <div style="margin-top:10px;font-size:12px;line-height:1.5;color:${T.text2};">El último día es HOY y va parcial: no lo leas como una caída de la conversación.</div>`);
}

function renderList(items: string[], sec: string, title: string): string {
  const list = numberedList(items);
  if (!list) return '';
  return sectionRow(`
              ${sectionLabel(`${sec} · ${title}`)}
              ${list}`);
}

function renderTopics(data: AppointmentRenderData, sec: string): string {
  const items = data.topics.slice(0, 8);
  if (!items.length) {
    return sectionRow(`${sectionLabel(`${sec} · Tópicos`)}
              <div style="font-size:13px;color:${T.text2};">Sin menciones clasificadas por tópico en el periodo.</div>`);
  }
  const th = `font-family:${FONT_MONO};font-size:12px;font-weight:400;color:${T.text3};padding:0 0 8px 0;border-bottom:1px solid ${T.rule};`;
  const rows = items.map((t, i) => {
    const b = i === items.length - 1 ? '' : `border-bottom:1px solid ${T.line};`;
    const neg = t.negShare == null
      ? `<span style="color:${T.text3};">—</span>`
      : `<span style="color:${t.negShare >= 50 ? T.neg : t.negShare >= 25 ? T.warn : T.text2};">${t.negShare}%</span>`;
    return `<tr>
                  <td style="font-size:14px;font-weight:600;line-height:1.35;padding:8px 8px 8px 0;${b}">${esc(t.topic)}</td>
                  <td align="right" style="font-family:${FONT_MONO};font-size:14px;padding:8px 0 8px 10px;${b}">${fmtInt(t.total)}</td>
                  <td align="right" style="font-family:${FONT_MONO};font-size:14px;padding:8px 0 8px 10px;${b}">${neg}</td>
                </tr>`;
  }).join('');
  return sectionRow(`
              ${sectionLabel(`${sec} · Tópicos`)}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <th align="left" style="${th}font-family:${FONT_SANS};">Tópico</th>
                  <th align="right" style="${th}padding-left:10px;">Menciones</th>
                  <th align="right" style="${th}padding-left:10px;">% neg.</th>
                </tr>
                ${rows}
              </table>`);
}

function renderTopMentions(data: AppointmentRenderData, sec: string): string {
  const items = (data.topMentions ?? []).slice(0, 5);
  if (!items.length) return '';
  return sectionRow(`
              ${sectionLabel(`${sec} · Lo más resonante`)}
              ${items.map((m, i) => mentionRow({
                meta: `${m.sourceLabel} · ${m.publishedAtLabel} · ${TONE_WORD[m.tone]} · ${m.engagementLabel}`,
                title: m.title,
                text: m.snippet,
                url: m.url,
                imageUrl: m.imageUrl,
                last: i === items.length - 1,
              })).join('')}`);
}

/** Vista previa del inbox: cargo + volumen contra los días previos. */
export function appointmentPreheader(data: AppointmentRenderData): string {
  const td = data.totalDelta;
  const parts = [
    data.appointment.position,
    `${fmtInt(data.totals.total)} menciones desde el nombramiento vs ${fmtInt(data.baselineTotals.total)} antes${td.hasBaseline && td.value ? ` (${td.value})` : ''}`,
  ];
  const pol = data.metrics?.polarization;
  if (pol?.display.value) parts.push(`polarización ${pol.display.value}`);
  return parts.join(' · ');
}

// ------------------------------------------------------------
// Render principal
// ------------------------------------------------------------

export function renderAppointmentReportHtml(data: AppointmentRenderData): string {
  const a = data.appointment;
  let n = 0;
  const next = () => String(++n).padStart(2, '0');

  const sections = [
    renderWindowBand(data),
    renderReadouts(data),
    renderLanding(data, next()),
    renderSinceVsBefore(data, next()),
  ];
  if ((data.dailySeries ?? []).length) sections.push(renderRhythm(data, next()));
  if (data.reception.some((s) => s && s.trim())) sections.push(renderList(data.reception, next(), 'Recepción'));
  if (data.highlights.some((s) => s && s.trim())) sections.push(renderList(data.highlights, next(), 'Qué movió'));
  sections.push(renderTopics(data, next()));
  if ((data.topMentions ?? []).length) sections.push(renderTopMentions(data, next()));
  if (data.dashboardUrl) sections.push(actionRow(data.dashboardUrl, `Abrir ${data.agencyShortName} en el dashboard`));

  const meta = [`Desde el ${a.announcedOnLabel}`, a.predecessor ? `sustituye a ${a.predecessor}` : null].filter(Boolean).join(' · ');
  const notes = a.notes && a.notes.trim()
    ? `<p style="margin:16px 0 0 0;font-size:14px;line-height:1.55;color:${T.ink2};">${esc(a.notes.trim())}</p>`
    : '';

  return instrumentDocument({
    title: `Nombramiento · ${data.agencyShortName} · ${a.personName}`,
    preheader: appointmentPreheader(data),
    kind: 'appointment',
    heading: {
      kicker: data.agencyKicker,
      title: a.personName,
      subtitle: a.position,
      meta,
      aside: portrait(a),
      extraHtml: notes,
    },
    contentRows: sections.filter(Boolean).join('\n'),
  });
}
