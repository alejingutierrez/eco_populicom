/**
 * Template HTML del correo de NOMBRAMIENTO — correo NUEVO (ago 2026).
 *
 * Se dispara una sola vez, cuando se registra un nombramiento nuevo en una
 * agencia monitoreada, y cubre desde el día del nombramiento hasta HOY.
 *
 * Diferencias deliberadas con el diario y el semanal:
 *  - El HERO no es el volumen: es la FICHA del nombramiento (quién, qué cargo,
 *    a quién sustituye, desde cuándo). El lector abre el correo por el hecho.
 *  - El periodo INCLUYE hoy (parcial). El diario y el semanal cierran en ayer;
 *    aquí el punto es justamente "hasta hoy", así que el correo lo dice de
 *    forma explícita para que nadie lea el último día como una caída.
 *  - La comparación no es contra un periodo equivalente cualquiera, sino contra
 *    los MISMOS días inmediatamente ANTERIORES al nombramiento — así se separa
 *    el efecto del anuncio del nivel base de la agencia.
 *  - Sección propia "Cómo se está recibiendo" (ejes de recepción del LLM), que
 *    es la pregunta específica de un nombramiento y no existe en los otros.
 *
 * Identidad: asunto "[Nombramiento] …", barra y badge violeta, footer propio.
 * Indicadores NUMÉRICOS (paridad dashboard), sin palabra cualitativa.
 *
 * Compatibilidad: inline styles + tablas (Gmail, Outlook, Apple Mail).
 */

import type { DeltaDisplay } from '../format/metrics-display';
import {
  EMAIL_COLORS as COLORS,
  esc,
  fmtInt,
  toneHex,
  deltaInline,
  sectionKicker,
  blockHeader,
  ctaButton,
  renderMetricTiles,
  emailDocument,
  type EmailMetric,
} from './chrome';

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

  /** PNG externo: volumen diario desde el nombramiento. */
  chartImageUrl: string;

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
  }>;

  /** Deeplink al Overview del dashboard. */
  dashboardUrl?: string | null;
}

// ------------------------------------------------------------
// Ficha del nombramiento — HERO
// ------------------------------------------------------------

function appointmentCard(data: AppointmentRenderData): string {
  const a = data.appointment;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Cargo', value: a.position },
    ...(a.predecessor ? [{ label: 'Sustituye a', value: a.predecessor }] : []),
    { label: 'Desde', value: a.announcedOnLabel },
  ];

  const cells = rows.map((r, i) => {
    const border = i === rows.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
    return `
      <tr>
        <td class="force-text-soft" style="padding:10px 16px;${border}font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;width:1px;">${esc(r.label)}</td>
        <td class="force-text-dark" style="padding:10px 16px 10px 0;${border}font-size:13.5px;color:${COLORS.ink};font-weight:600;line-height:1.45;">${esc(r.value)}</td>
      </tr>`;
  }).join('');

  return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.eventSoft}" style="background:${COLORS.eventSoft};background-color:${COLORS.eventSoft};border:1px solid ${COLORS.event};border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:18px 16px 14px 16px;border-bottom:1px solid ${COLORS.borderSoft};">
                    <div style="font-size:10.5px;font-weight:700;color:${COLORS.event};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">Nombramiento registrado</div>
                    <div class="force-text-dark" style="font-size:24px;line-height:1.2;font-weight:700;color:${COLORS.ink};letter-spacing:-0.02em;">${esc(a.personName)}</div>
                  </td>
                </tr>
                ${cells}
                ${a.notes
                  ? `<tr><td colspan="2" class="force-text-mute" style="padding:12px 16px;border-top:1px solid ${COLORS.borderSoft};font-size:12.5px;color:${COLORS.inkSoft};line-height:1.55;">${esc(a.notes)}</td></tr>`
                  : ''}
              </table>`;
}

// ------------------------------------------------------------
// Desde el nombramiento vs los días previos
// ------------------------------------------------------------

const SENTIMENT_ROWS: Array<{ key: 'negative' | 'neutral' | 'positive'; label: string; color: string; pillBg: string }> = [
  { key: 'negative', label: 'Negativo', color: COLORS.neg, pillBg: COLORS.negSoft },
  { key: 'neutral', label: 'Neutral', color: COLORS.neu, pillBg: COLORS.neuSoft },
  { key: 'positive', label: 'Positivo', color: COLORS.pos, pillBg: COLORS.posSoft },
];

function share(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function sinceVsBeforeBlock(data: AppointmentRenderData): string {
  const { totals, baselineTotals } = data;
  const totalDeltaHtml = deltaInline(data.totalDelta, 'vs los días previos');

  const sentimentRows = SENTIMENT_ROWS.map((s, i) => {
    const cur = totals[s.key];
    const prev = baselineTotals[s.key];
    const dd = data.sentimentDelta[s.key];
    const border = i === SENTIMENT_ROWS.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
    const deltaHtml = dd.hasBaseline && dd.value != null
      ? `<span style="color:${toneHex(dd.tone)};font-weight:700;white-space:nowrap;">${esc(dd.arrow)} ${esc(dd.value)}</span>`
      : `<span style="color:${COLORS.inkMute};">—</span>`;
    return `
      <tr>
        <td style="padding:12px 16px;${border}">
          <span style="display:inline-block;background:${s.pillBg};color:${s.color};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:3px 8px;border-radius:4px;">${s.label}</span>
        </td>
        <td align="right" class="force-text-dark" style="padding:12px 8px;${border}white-space:nowrap;">
          <span style="font-size:16px;font-weight:700;color:${COLORS.ink};">${fmtInt(cur)}</span>
          <span class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};"> · ${share(cur, totals.total)}%</span>
        </td>
        <td align="right" class="force-text-soft" style="padding:12px 8px;${border}font-size:13px;color:${COLORS.inkMute};white-space:nowrap;">
          ${fmtInt(prev)}
        </td>
        <td align="right" style="padding:12px 16px;${border}font-size:12.5px;white-space:nowrap;">
          ${deltaHtml}
        </td>
      </tr>`;
  }).join('');

  const dayWord = data.windowDays === 1 ? 'día' : 'días';

  return `
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                <tr>
                  <td colspan="4" style="padding:18px 16px 14px 16px;border-bottom:1px solid ${COLORS.borderSoft};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="bottom">
                          <div class="force-text-soft" style="font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.1em;text-transform:uppercase;">Menciones desde el nombramiento</div>
                          <div class="kpi-value force-text-dark" style="font-size:34px;line-height:1;font-weight:700;color:${COLORS.ink};margin-top:10px;letter-spacing:-0.025em;">${fmtInt(totals.total)}</div>
                          <div class="force-text-soft" style="margin-top:6px;font-size:11px;color:${COLORS.inkMute};">${data.windowDays} ${dayWord} · ${esc(data.windowLabel)}</div>
                        </td>
                        <td valign="bottom" align="right">
                          <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};line-height:1.5;">${data.windowDays} ${dayWord} previos: <strong style="color:${COLORS.inkSoft};">${fmtInt(baselineTotals.total)}</strong></div>
                          <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};line-height:1.5;">${esc(data.baselineLabel)}</div>
                          <div style="margin-top:4px;font-size:12.5px;">${totalDeltaHtml}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 16px 6px 16px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;">Sentimiento</td>
                  <td align="right" style="padding:10px 8px 6px 8px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;">Desde</td>
                  <td align="right" style="padding:10px 8px 6px 8px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;">Previos</td>
                  <td align="right" style="padding:10px 16px 6px 8px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;">Cambio</td>
                </tr>
                ${sentimentRows}
              </table>`;
}

// ------------------------------------------------------------
// Tópicos del periodo
// ------------------------------------------------------------

function topicsBlock(data: AppointmentRenderData): string {
  if (!data.topics.length) {
    return `<div class="force-text-soft" style="padding:16px;font-size:12.5px;color:${COLORS.inkMute};font-style:italic;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">Sin menciones clasificadas por tópico en el periodo.</div>`;
  }

  const rows = data.topics.slice(0, 8).map((t, i, arr) => {
    const border = i === arr.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
    const negHtml = t.negShare == null
      ? `<span style="color:${COLORS.inkMute};">—</span>`
      : `<span style="color:${t.negShare >= 50 ? COLORS.neg : t.negShare >= 25 ? COLORS.elevado : COLORS.inkMute};font-weight:${t.negShare >= 25 ? 700 : 400};">${t.negShare}%</span>`;
    return `
      <tr>
        <td class="force-text-dark" style="padding:12px 16px;font-size:13.5px;color:${COLORS.ink};font-weight:600;${border}">${esc(t.topic)}</td>
        <td align="right" class="force-text-dark" style="padding:12px 8px;font-size:13.5px;color:${COLORS.ink};font-weight:700;${border}white-space:nowrap;">${fmtInt(t.total)}</td>
        <td align="right" style="padding:12px 16px;font-size:12.5px;${border}white-space:nowrap;">${negHtml}</td>
      </tr>`;
  }).join('');

  return `
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                <tr>
                  <th align="left" style="padding:11px 16px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};">Tópico</th>
                  <th align="right" style="padding:11px 8px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};white-space:nowrap;">Menciones</th>
                  <th align="right" style="padding:11px 16px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};white-space:nowrap;">% neg.</th>
                </tr>
                ${rows}
              </table>`;
}

// ------------------------------------------------------------
// Listas del LLM (recepción / movimientos)
// ------------------------------------------------------------

function numberedList(items: string[], accent: string): string {
  const clean = items.filter((s) => s && s.trim().length > 0).slice(0, 4);
  if (!clean.length) return '';
  const lis = clean.map((s, i) => {
    const borderTop = i === 0 ? '' : `border-top:1px solid ${COLORS.borderSoft};`;
    return `<li class="force-text-dark" style="padding:12px 0 12px 28px;${borderTop}font-size:13.5px;line-height:1.6;color:${COLORS.ink};position:relative;">
          <span style="position:absolute;left:0;top:12px;color:${accent};font-weight:700;font-size:13px;">${i + 1}.</span>
          ${s}
        </li>`;
  }).join('');
  return `<table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                <tr>
                  <td style="padding:6px 18px;">
                    <ul style="margin:0;padding:0;list-style:none;">${lis}</ul>
                  </td>
                </tr>
              </table>`;
}

// ------------------------------------------------------------
// Lo más resonante
// ------------------------------------------------------------

const TONE_META: Record<'negative' | 'neutral' | 'positive', { label: string; color: string; pillBg: string }> = {
  negative: { label: 'Negativo', color: COLORS.neg, pillBg: COLORS.negSoft },
  neutral: { label: 'Neutral', color: COLORS.neu, pillBg: COLORS.neuSoft },
  positive: { label: 'Positivo', color: COLORS.pos, pillBg: COLORS.posSoft },
};

function topMentionsBlock(data: AppointmentRenderData, sec: string): string {
  const items = (data.topMentions ?? []).slice(0, 5);
  if (!items.length) return '';

  const rows = items.map((m, i) => {
    const border = i === items.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
    const tone = TONE_META[m.tone];
    return `
      <tr>
        <td style="padding:14px 16px;${border}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="left" valign="middle">
                <span class="force-text-soft" style="font-size:10.5px;color:${COLORS.inkMute};letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">${esc(m.sourceLabel)} <span style="color:${COLORS.borderSoft};">·</span> ${esc(m.publishedAtLabel)}</span>
              </td>
              <td align="right" valign="middle" style="white-space:nowrap;">
                <span style="display:inline-block;background:${tone.pillBg};color:${tone.color};font-size:9.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:2px 7px;border-radius:4px;">${tone.label}</span>
              </td>
            </tr>
          </table>
          ${m.title
            ? `<div class="force-text-dark" style="margin-top:6px;font-size:13.5px;font-weight:700;color:${COLORS.ink};line-height:1.4;">${esc(m.title)}</div>`
            : ''}
          <div class="force-text-dark" style="margin-top:${m.title ? '3px' : '6px'};font-size:13px;line-height:1.55;color:${COLORS.inkSoft};">
            ${esc(m.snippet)}
          </div>
          <div style="margin-top:8px;">
            <span class="force-text-dark" style="font-size:12px;font-weight:700;color:${COLORS.ink};">${esc(m.engagementLabel)}</span>
            ${m.url ? `<span style="color:${COLORS.borderSoft};">&nbsp;·&nbsp;</span><a href="${esc(m.url)}" style="color:${COLORS.brand};text-decoration:none;font-size:11.5px;font-weight:600;">Ver mención →</a>` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${sec} · Lo más resonante`, COLORS.event)}
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Las menciones con mayor engagement
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Ordenadas por interacciones (likes, comentarios y compartidos) desde el nombramiento.
              </div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                ${rows}
              </table>
            </td>
          </tr>`;
}

// ------------------------------------------------------------
// Main render
// ------------------------------------------------------------

export function renderAppointmentReportHtml(data: AppointmentRenderData): string {
  let secCount = 0;
  const nextSec = () => String(++secCount).padStart(2, '0');

  // CTA violeta (el color del tipo) para no competir con el azul del diario.
  const cta = data.dashboardUrl ? ctaButton(data.dashboardUrl, 'Ver detalle en el dashboard →', COLORS.event) : '';

  const summarySec = nextSec();
  const volumeSec = nextSec();

  const chartBlock = data.chartImageUrl
    ? `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${nextSec()} · Ritmo diario`, COLORS.event)}
              <h2 class="section-title force-text-dark" style="margin:0 0 16px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Día a día desde el nombramiento
              </h2>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                <tr>
                  <td bgcolor="${COLORS.surface}" style="padding:18px 18px 14px 18px;background:${COLORS.surface};background-color:${COLORS.surface};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                      <tr>
                        <td align="left" class="force-text-mute" style="font-size:12px;color:${COLORS.inkSoft};">
                          <span style="display:inline-block;width:14px;height:3px;background:${COLORS.neg};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:14px;">Negativo</span>
                          <span style="display:inline-block;width:14px;height:3px;background:${COLORS.neu};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:14px;">Neutral</span>
                          <span style="display:inline-block;width:14px;height:3px;background:${COLORS.pos};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;">Positivo</span>
                        </td>
                      </tr>
                    </table>
                    <div style="width:100%;overflow:hidden;">
                      <img src="${esc(data.chartImageUrl)}" alt="Volumen diario de menciones por sentimiento desde el nombramiento" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;">
                    </div>
                    <div class="force-text-soft" style="margin-top:10px;font-size:11px;color:${COLORS.inkMute};line-height:1.5;">
                      El último día del gráfico es HOY y va parcial — no lo leas como una caída de la conversación.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const indicatorsBlock = data.metrics
    ? `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${nextSec()} · Indicadores del periodo · mismos valores que el dashboard`, COLORS.event)}
              ${renderMetricTiles([
                { label: 'Riesgo de crisis', metric: data.metrics.crisis },
                { label: 'Sentimiento neto', metric: data.metrics.nss },
                { label: 'Salud de marca', metric: data.metrics.bhi },
                ...(data.metrics.polarization ? [{ label: 'Polarización', metric: data.metrics.polarization }] : []),
              ], { cols: 2, deltaSuffix: 'vs los días previos' })}
            </td>
          </tr>`
    : '';

  const hasReception = data.reception.some((s) => s && s.trim().length > 0);
  const receptionSec = hasReception ? nextSec() : '';
  const receptionHtml = hasReception
    ? `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${receptionSec} · Recepción`, COLORS.event)}
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Cómo se está recibiendo
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Ejes de la discusión pública sobre el nombramiento, con el actor que ocupa cada uno.
              </div>
              ${numberedList(data.reception, COLORS.event)}
            </td>
          </tr>`
    : '';

  const hasHighlights = data.highlights.some((s) => s && s.trim().length > 0);
  const highlightsSec = hasHighlights ? nextSec() : '';
  const highlightsHtml = hasHighlights
    ? `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${highlightsSec} · Qué movió`, COLORS.event)}
              <h2 class="section-title force-text-dark" style="margin:0 0 12px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Lo que cambió en los números
              </h2>
              ${numberedList(data.highlights, COLORS.event)}
            </td>
          </tr>`
    : '';

  const hasMentions = (data.topMentions ?? []).length > 0;
  const mentionsHtml = hasMentions ? topMentionsBlock(data, nextSec()) : '';

  const topicsSec = nextSec();
  const dayWord = data.windowDays === 1 ? 'día' : 'días';

  const contentRows = `
          <!-- HERO · la ficha del nombramiento -->
          <tr>
            <td class="px-32" style="padding:26px 32px 18px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyKicker)}
              </div>
              <h1 class="title force-text-dark" style="margin:0 0 10px 0;color:${COLORS.ink};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;">
                Nombramiento nuevo:<br>la conversación desde el día uno
              </h1>
              <div class="force-text-mute" style="color:${COLORS.inkSoft};font-size:13px;line-height:1.55;">
                ${esc(data.windowLabel)} &nbsp;·&nbsp; ${data.windowDays} ${dayWord} desde el nombramiento, hoy incluido &nbsp;·&nbsp; actualizado ${esc(data.updatedAtLabel)}
              </div>
            </td>
          </tr>

          <tr>
            <td class="px-32" style="padding:0 32px 22px 32px;">
              ${appointmentCard(data)}
            </td>
          </tr>

          <!-- CTA #1 -->
${cta}

${blockHeader('1', 'Análisis numérico', `Volumen y tendencias desde el nombramiento`, COLORS.event)}
          <!-- BLOQUE 1 · EN UN VISTAZO -->
          <tr>
            <td class="px-32" style="padding:0 32px 22px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.accentSoft}" style="background:${COLORS.accentSoft};background-color:${COLORS.accentSoft};border:1px solid ${COLORS.accent};border-radius:8px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <div class="force-text-soft" style="font-size:10.5px;font-weight:700;color:${COLORS.ink};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">
                      ${summarySec} · Cómo cayó el nombramiento
                    </div>
                    <p class="force-text-dark" style="margin:0;color:${COLORS.ink};font-size:14px;line-height:1.65;">${data.summary}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BLOQUE 1 · DESDE EL NOMBRAMIENTO VS LOS DÍAS PREVIOS -->
          <tr>
            <td class="px-32" style="padding:0 32px 8px 32px;">
              ${sectionKicker(`${volumeSec} · Desde el nombramiento vs los días previos`, COLORS.event)}
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Cuánto se habló y cómo
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                La comparación es contra los ${data.windowDays} ${dayWord} inmediatamente anteriores al nombramiento (${esc(data.baselineLabel)}), para separar el efecto del anuncio del nivel normal de la agencia.
              </div>
              ${sinceVsBeforeBlock(data)}
            </td>
          </tr>
${chartBlock}

${blockHeader('2', 'Insights y detalles', 'Cómo se recibió y qué movió', COLORS.event)}
${indicatorsBlock}
          <!-- CTA #2 -->
${cta}
${receptionHtml}
${highlightsHtml}
${mentionsHtml}
          <!-- BLOQUE 2 · TÓPICOS -->
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${topicsSec} · Tópicos`, COLORS.event)}
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Sobre qué se habló
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Menciones por tópico principal desde el nombramiento.
              </div>
              ${topicsBlock(data)}
            </td>
          </tr>

          <!-- CTA #3 -->
${cta}`;

  return emailDocument({
    title: `Nombramiento · ${data.agencyShortName} · ${data.appointment.personName}`,
    preheader: `Nombramiento · ${data.appointment.personName} — ${data.appointment.position} · ${fmtInt(data.totals.total)} menciones desde el ${data.appointment.announcedOnLabel}`,
    kind: 'appointment',
    contentRows,
  });
}
