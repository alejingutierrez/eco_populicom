/**
 * Template HTML del RESUMEN SEMANAL — correo NUEVO (jul 2026).
 *
 * Llega los viernes y compara la semana cerrada (7 días terminando ayer)
 * contra la semana anterior. Todo el correo está construido alrededor de la
 * comparación: menciones y sentimiento lado a lado, indicadores con delta
 * semanal, ritmo diario superpuesto (esta semana vs la anterior) y los
 * tópicos que subieron o bajaron.
 *
 * Identidad: asunto "[Semanal] …", barra y badge azul tinta (navy), footer
 * "reporte semanal". Indicadores NUMÉRICOS (paridad dashboard), sin palabra
 * cualitativa.
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

  /** PNG externo: volumen diario de esta semana superpuesto a la anterior. */
  chartImageUrl: string;

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
  }>;

  /** Deeplink al Overview del dashboard — lo usan los 3 CTAs (se omiten si falta). */
  dashboardUrl?: string | null;
}

// ------------------------------------------------------------
// Semana vs semana — bloque protagonista
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

function weekVsWeekBlock(data: WeeklySummaryRenderData): string {
  const { totals, prevTotals } = data;

  // Cabecera del bloque: total de la semana en grande + total previo al lado.
  const totalDeltaHtml = deltaInline(data.totalDelta, 'vs semana anterior');

  const sentimentRows = SENTIMENT_ROWS.map((s, i) => {
    const cur = totals[s.key];
    const prev = prevTotals[s.key];
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

  return `
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                <tr>
                  <td colspan="4" style="padding:18px 16px 14px 16px;border-bottom:1px solid ${COLORS.borderSoft};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="bottom">
                          <div class="force-text-soft" style="font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.1em;text-transform:uppercase;">Menciones esta semana</div>
                          <div class="kpi-value force-text-dark" style="font-size:34px;line-height:1;font-weight:700;color:${COLORS.ink};margin-top:10px;letter-spacing:-0.025em;">${fmtInt(totals.total)}</div>
                        </td>
                        <td valign="bottom" align="right">
                          <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};line-height:1.5;">Semana anterior: <strong style="color:${COLORS.inkSoft};">${fmtInt(prevTotals.total)}</strong></div>
                          <div style="margin-top:4px;font-size:12.5px;">${totalDeltaHtml}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 16px 6px 16px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;">Sentimiento</td>
                  <td align="right" style="padding:10px 8px 6px 8px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;">Esta semana</td>
                  <td align="right" style="padding:10px 8px 6px 8px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;">Anterior</td>
                  <td align="right" style="padding:10px 16px 6px 8px;font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;">Cambio</td>
                </tr>
                ${sentimentRows}
              </table>`;
}

// ------------------------------------------------------------
// Tópicos que subieron / bajaron
// ------------------------------------------------------------

function topicsCompareBlock(data: WeeklySummaryRenderData): string {
  if (!data.topicsCompare.length) {
    return `<div class="force-text-soft" style="padding:16px;font-size:12.5px;color:${COLORS.inkMute};font-style:italic;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">Sin menciones clasificadas por tópico en la semana.</div>`;
  }

  const rows = data.topicsCompare.slice(0, 8).map((t, i, arr) => {
    const border = i === arr.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
    const dd = t.delta;
    const deltaHtml = dd.hasBaseline && dd.value != null
      ? `<span style="color:${toneHex(dd.tone)};font-weight:700;white-space:nowrap;">${esc(dd.arrow)} ${esc(dd.value)}</span>`
      : `<span style="color:${COLORS.inkMute};">—</span>`;
    // Concentración negativa del tópico esta semana: rojo ≥50%, ámbar ≥25%.
    const negHtml = t.negShare == null
      ? `<span style="color:${COLORS.inkMute};">—</span>`
      : `<span style="color:${t.negShare >= 50 ? COLORS.neg : t.negShare >= 25 ? COLORS.elevado : COLORS.inkMute};font-weight:${t.negShare >= 25 ? 700 : 400};">${t.negShare}%</span>`;
    return `
      <tr>
        <td class="force-text-dark" style="padding:12px 16px;font-size:13.5px;color:${COLORS.ink};font-weight:600;${border}">${esc(t.topic)}</td>
        <td align="right" class="force-text-dark" style="padding:12px 8px;font-size:13.5px;color:${COLORS.ink};font-weight:700;${border}white-space:nowrap;">${fmtInt(t.cur)}</td>
        <td align="right" style="padding:12px 8px;font-size:12.5px;${border}white-space:nowrap;">${negHtml}</td>
        <td align="right" class="force-text-soft" style="padding:12px 8px;font-size:13px;color:${COLORS.inkMute};${border}white-space:nowrap;">${fmtInt(t.prev)}</td>
        <td align="right" style="padding:12px 16px;font-size:12.5px;${border}white-space:nowrap;">${deltaHtml}</td>
      </tr>`;
  }).join('');

  return `
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                <tr>
                  <th align="left" style="padding:11px 16px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};">Tópico</th>
                  <th align="right" style="padding:11px 8px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};white-space:nowrap;">Esta semana</th>
                  <th align="right" style="padding:11px 8px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};white-space:nowrap;">% neg.</th>
                  <th align="right" style="padding:11px 8px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};white-space:nowrap;">Anterior</th>
                  <th align="right" style="padding:11px 16px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};">Cambio</th>
                </tr>
                ${rows}
              </table>`;
}

/** "Salieron de la conversación: X (71 la semana anterior) · Y (12)." */
function goneTopicsLine(items: WeeklySummaryRenderData['goneTopics']): string {
  const list = (items ?? []).filter((t) => t.topic && t.prev > 0).slice(0, 4);
  if (!list.length) return '';
  const parts = list.map((t) => `<strong style="color:${COLORS.inkSoft};font-weight:600;">${esc(t.topic)}</strong> (${fmtInt(t.prev)} la semana anterior)`);
  return `<div class="force-text-soft" style="margin-top:10px;font-size:11.5px;color:${COLORS.inkMute};line-height:1.6;">Salieron de la conversación: ${parts.join(' &nbsp;·&nbsp; ')}.</div>`;
}

// ------------------------------------------------------------
// Highlights — "qué cambió esta semana"
// ------------------------------------------------------------

function highlightsBlock(items: string[], sec: string): string {
  const clean = items.filter((s) => s && s.trim().length > 0).slice(0, 4);
  if (!clean.length) return '';
  const lis = clean.map((s, i) => {
    const borderTop = i === 0 ? '' : `border-top:1px solid ${COLORS.borderSoft};`;
    return `<li class="force-text-dark" style="padding:12px 0 12px 28px;${borderTop}font-size:13.5px;line-height:1.6;color:${COLORS.ink};position:relative;">
          <span style="position:absolute;left:0;top:12px;color:${COLORS.brand};font-weight:700;font-size:13px;">${i + 1}.</span>
          ${s}
        </li>`;
  }).join('');
  return `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${sec} · Qué cambió`)}
              <h2 class="section-title force-text-dark" style="margin:0 0 12px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Los movimientos de la semana
              </h2>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                <tr>
                  <td style="padding:6px 18px;">
                    <ul style="margin:0;padding:0;list-style:none;">${lis}</ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

// ------------------------------------------------------------
// Lo más resonante — menciones top por engagement
// ------------------------------------------------------------

const TONE_META: Record<'negative' | 'neutral' | 'positive', { label: string; color: string; pillBg: string }> = {
  negative: { label: 'Negativo', color: COLORS.neg, pillBg: COLORS.negSoft },
  neutral: { label: 'Neutral', color: COLORS.neu, pillBg: COLORS.neuSoft },
  positive: { label: 'Positivo', color: COLORS.pos, pillBg: COLORS.posSoft },
};

function topMentionsBlock(data: WeeklySummaryRenderData, sec: string): string {
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
              ${sectionKicker(`${sec} · Lo más resonante`)}
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Las menciones con mayor engagement
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Ordenadas por interacciones (likes, comentarios y compartidos) durante la semana.
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

export function renderWeeklySummaryHtml(data: WeeklySummaryRenderData): string {
  // Numeración dinámica de secciones: las condicionales (ritmo, indicadores,
  // qué cambió, lo más resonante) ya no dejan huecos tipo "02 → 05" cuando
  // una no renderiza. Los números se asignan en orden de aparición.
  let secCount = 0;
  const nextSec = () => String(++secCount).padStart(2, '0');

  // CTA compartido (mismo botón azul de marca que el diario). Se repite 3×:
  // tras el hero, tras los indicadores y al cierre — patrón del diario
  // (minuta 21-jul-2026 + ajuste ago 2026 para paridad entre correos).
  const cta = data.dashboardUrl ? ctaButton(data.dashboardUrl) : '';

  const summarySec = nextSec();
  const weekVsWeekSec = nextSec();

  const chartBlock = data.chartImageUrl
    ? `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${nextSec()} · Ritmo diario`)}
              <h2 class="section-title force-text-dark" style="margin:0 0 16px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Esta semana vs la anterior, día a día
              </h2>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                <tr>
                  <td bgcolor="${COLORS.surface}" style="padding:18px 18px 14px 18px;background:${COLORS.surface};background-color:${COLORS.surface};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                      <tr>
                        <td align="left" class="force-text-mute" style="font-size:12px;color:${COLORS.inkSoft};">
                          <span style="display:inline-block;width:14px;height:3px;background:${COLORS.brand};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:14px;">Esta semana</span>
                          <span style="display:inline-block;width:14px;height:3px;background:${COLORS.inkMute};border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;">Semana anterior</span>
                        </td>
                      </tr>
                    </table>
                    <div style="width:100%;overflow:hidden;">
                      <img src="${esc(data.chartImageUrl)}" alt="Volumen diario de menciones: esta semana comparada con la anterior" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;">
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  // BLOQUE 2 — los números se asignan después del chart (orden del documento).
  const indicatorsBlock = data.metrics
    ? `
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${nextSec()} · Indicadores de la semana · mismos valores que el dashboard`)}
              ${renderMetricTiles([
                { label: 'Riesgo de crisis', metric: data.metrics.crisis },
                { label: 'Sentimiento neto', metric: data.metrics.nss },
                { label: 'Salud de marca', metric: data.metrics.bhi },
                ...(data.metrics.polarization ? [{ label: 'Polarización', metric: data.metrics.polarization }] : []),
              ], { cols: 2, deltaSuffix: 'vs semana anterior' })}
            </td>
          </tr>`
    : '';

  const hasHighlights = data.highlights.some((s) => s && s.trim().length > 0);
  const highlightsHtml = hasHighlights ? highlightsBlock(data.highlights, nextSec()) : '';

  const hasMentions = (data.topMentions ?? []).length > 0;
  const mentionsHtml = hasMentions ? topMentionsBlock(data, nextSec()) : '';

  const topicsSec = nextSec();

  const contentRows = `
          <!-- HERO -->
          <tr>
            <td class="px-32" style="padding:26px 32px 22px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyKicker)}
              </div>
              <h1 class="title force-text-dark" style="margin:0 0 10px 0;color:${COLORS.ink};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;">
                Resumen semanal de<br>conversación pública
              </h1>
              <div class="force-text-mute" style="color:${COLORS.inkSoft};font-size:13px;line-height:1.55;">
                Semana del ${esc(data.weekLabel)} &nbsp;·&nbsp; comparada con ${esc(data.prevWeekLabel)} &nbsp;·&nbsp; actualizado ${esc(data.updatedAtLabel)}
              </div>
            </td>
          </tr>

          <!-- CTA #1 · atajo inmediato al dashboard, antes del Bloque 1 -->
${cta}

${blockHeader('1', 'Análisis numérico', 'Volumen y tendencias del periodo')}
          <!-- BLOQUE 1 · LA SEMANA EN UN VISTAZO -->
          <tr>
            <td class="px-32" style="padding:0 32px 22px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.accentSoft}" style="background:${COLORS.accentSoft};background-color:${COLORS.accentSoft};border:1px solid ${COLORS.accent};border-radius:8px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <div class="force-text-soft" style="font-size:10.5px;font-weight:700;color:${COLORS.ink};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">
                      ${summarySec} · La semana en un vistazo
                    </div>
                    <p class="force-text-dark" style="margin:0;color:${COLORS.ink};font-size:14px;line-height:1.65;">${data.weeklySummary}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BLOQUE 1 · SEMANA VS SEMANA -->
          <tr>
            <td class="px-32" style="padding:0 32px 8px 32px;">
              ${sectionKicker(`${weekVsWeekSec} · Semana vs semana`)}
              <h2 class="section-title force-text-dark" style="margin:0 0 14px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Cuánto se habló y cómo
              </h2>
              ${weekVsWeekBlock(data)}
            </td>
          </tr>
${chartBlock}

${blockHeader('2', 'Insights y detalles', 'Análisis de las conversaciones del periodo')}
${indicatorsBlock}
          <!-- CTA #2 · tras los indicadores del Bloque 2 -->
${cta}
${highlightsHtml}
${mentionsHtml}
          <!-- BLOQUE 2 · TÓPICOS QUE SUBIERON / BAJARON -->
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker(`${topicsSec} · Tópicos`)}
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Qué subió y qué bajó
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Menciones por tópico principal, comparadas con la semana anterior.
              </div>
              ${topicsCompareBlock(data)}
              ${goneTopicsLine(data.goneTopics)}
            </td>
          </tr>

          <!-- CTA #3 · cierre del correo -->
${cta}`;

  return emailDocument({
    title: `Resumen semanal ECO · ${data.agencyShortName} · ${data.weekLabel}`,
    preheader: `Reporte semanal · ${data.agencyKicker} — ${fmtInt(data.totals.total)} menciones (${data.weekLabel}) vs ${fmtInt(data.prevTotals.total)} la semana anterior`,
    kind: 'weekly',
    contentRows,
  });
}
