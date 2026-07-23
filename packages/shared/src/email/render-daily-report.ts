/**
 * Template HTML del REPORTE DIARIO (antes "reporte semanal" — se renombró en
 * jul 2026 porque siempre se envió todos los días con ventana rolante de 7
 * días y el nombre confundía al destinatario).
 *
 * Identidad: asunto "[Diario] …", barra y badge azul marca, footer "reporte
 * diario". Los indicadores compuestos se muestran NUMÉRICOS (%, /10, con
 * signo — paridad con el dashboard), sin palabra cualitativa; el color del
 * número codifica la banda.
 *
 * Diseño: minimalista, fondo claro, marca ECO (azul + amarillo) usada con
 * moderación. Tablas e inline styles para compatibilidad con Gmail /
 * Outlook / Apple Mail. Imagen PNG externa (QuickChart) para la tendencia.
 */

import type { DeltaDisplay } from '../format/metrics-display';
import {
  EMAIL_COLORS as COLORS,
  esc,
  fmtInt,
  sectionKicker,
  blockHeader,
  renderMetricTiles,
  emailDocument,
  type EmailMetric,
} from './chrome';

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
  /** URL absoluta del PNG del gráfico de tendencia (QuickChart u otro). */
  chartImageUrl: string;
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
  dailySummary: {
    label: string;
    paragraph: string;
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
  /** URL a la landing de Overview del dashboard para el CTA del Bloque 2. */
  overviewUrl?: string;
}

// ------------------------------------------------------------
// Helpers locales
// ------------------------------------------------------------

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function signedPct(n: number): string {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;  // ya viene con −
  return '0%';
}

function deltaWord(n: number): string {
  // Deriva la palabra del valor REDONDEADO para que concuerde con signedPct
  // (que también redondea). Mismo vocabulario que formatDelta (sube/baja/estable).
  const r = Math.round(n);
  if (r > 0) return 'sube';
  if (r < 0) return 'baja';
  return 'estable';
}

// ------------------------------------------------------------
// Gráfico — PNG externo (QuickChart) con alt-text descriptivo
// ------------------------------------------------------------

function renderChart(data: DailyReportRenderData): string {
  if (!data.dailySeries.length) {
    return `<div style="padding:32px;text-align:center;color:${COLORS.inkMute};font-size:13px;">Sin datos en el periodo.</div>`;
  }
  if (!data.chartImageUrl) {
    return `<div style="padding:32px;text-align:center;color:${COLORS.inkMute};font-size:13px;">Gráfico no disponible.</div>`;
  }
  const altText = `Tendencia diaria del sentimiento — ` +
    data.dailySeries
      .map((d) => `${d.dayLabel}: ${d.negative} neg, ${d.neutral} neu, ${d.positive} pos`)
      .join('; ');

  return `<img src="${esc(data.chartImageUrl)}" alt="${esc(altText)}" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;">`;
}

// ------------------------------------------------------------
// Main render
// ------------------------------------------------------------

export function renderDailyReportHtml(data: DailyReportRenderData): string {
  const { totals, deltaVsPrev } = data;

  const negPct = pct(totals.negative, totals.total);
  const neuPct = pct(totals.neutral, totals.total);
  const posPct = pct(totals.positive, totals.total);

  // Indicadores compuestos numéricos: sólo si el caller adjuntó las métricas
  // ya formateadas. Retro-compatible: sin `metrics`, no se renderiza.
  const indicatorsBlock = data.metrics ? renderIndicators(data.metrics) : '';

  const contentRows = `
          <!-- HERO -->
          <tr>
            <td class="px-32" style="padding:26px 32px 22px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyKicker)}
              </div>
              <h1 class="title force-text-dark" style="margin:0 0 10px 0;color:${COLORS.ink};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;">
                Reporte diario de<br>conversación pública
              </h1>
              <div class="force-text-mute" style="color:${COLORS.inkSoft};font-size:13px;line-height:1.55;">
                Ventana: últimos 7 días (${esc(data.periodLabel)}) &nbsp;·&nbsp; actualizado ${esc(data.updatedAtLabel)}
              </div>
            </td>
          </tr>

${blockHeader('1', 'Análisis numérico', 'Volumen y tendencias del periodo')}
          <!-- BLOQUE 1 · RESUMEN DEL DÍA — el lede del diario: qué pasó ayer -->
          <tr>
            <td class="px-32" style="padding:0 32px 22px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.accentSoft}" style="background:${COLORS.accentSoft};background-color:${COLORS.accentSoft};border:1px solid ${COLORS.accent};border-radius:8px;">
                <tr>
                  <td style="padding:18px 22px;">
                    <div class="force-text-soft" style="font-size:10.5px;font-weight:700;color:${COLORS.ink};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px;">
                      ${esc(data.dailySummary.label)}
                    </div>
                    <p class="force-text-dark" style="margin:0;color:${COLORS.ink};font-size:14px;line-height:1.65;">${data.dailySummary.paragraph}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- 02 · TERMÓMETRO -->
          <tr>
            <td class="px-32" style="padding:0 32px 8px 32px;">
              ${sectionKicker('01 · Termómetro · últimos 7 días')}
              <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                <tr>
                  ${kpiCard('Negativo', COLORS.neg, COLORS.negSoft, totals.negative, negPct, deltaVsPrev.negative, 'right', data.deltaDisplay?.negative)}
                  ${kpiCard('Neutral', COLORS.neu, COLORS.neuSoft, totals.neutral, neuPct, deltaVsPrev.neutral, 'both', data.deltaDisplay?.neutral)}
                  ${kpiCard('Positivo', COLORS.pos, COLORS.posSoft, totals.positive, posPct, deltaVsPrev.positive, 'left', data.deltaDisplay?.positive)}
                </tr>
              </table>

              <div class="force-text-soft" style="margin-top:14px;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Total del periodo: <strong style="color:${COLORS.ink};">${fmtInt(totals.total)}</strong> menciones &nbsp;·&nbsp; comparado con los 7 días previos
              </div>
            </td>
          </tr>

          <!-- BLOQUE 1 · 02 · TENDENCIA -->
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              ${sectionKicker('02 · Tendencia día a día')}
              <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>

              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                <tr>
                  <td bgcolor="${COLORS.surface}" style="padding:18px 18px 14px 18px;background:${COLORS.surface};background-color:${COLORS.surface};">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                      <tr>
                        <td align="left" class="force-text-mute" style="font-size:12px;color:${COLORS.inkSoft};">
                          <span style="display:inline-block;width:8px;height:8px;background:${COLORS.neg};border-radius:50%;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:14px;">Negativo</span>
                          <span style="display:inline-block;width:8px;height:8px;background:${COLORS.neu};border-radius:50%;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:14px;">Neutral</span>
                          <span style="display:inline-block;width:8px;height:8px;background:${COLORS.pos};border-radius:50%;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;">Positivo</span>
                        </td>
                      </tr>
                    </table>
                    <div style="width:100%;overflow:hidden;">
                      ${renderChart(data)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

${blockHeader('2', 'Insights y detalles', 'Análisis de las conversaciones del periodo')}
${indicatorsBlock}
          <!-- BLOQUE 2 · CTA · Ver insights y detalle en el dashboard (landing de Overview) -->
          <tr>
            <td class="px-32" style="padding:8px 32px 26px 32px;" align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${COLORS.brand}" style="background:${COLORS.brand};background-color:${COLORS.brand};border-radius:6px;">
                    <a href="${esc(data.overviewUrl || '#')}" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">
                      Ver insights y detalle en el dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

  return emailDocument({
    title: `Reporte diario ECO · ${data.agencyShortName} · ${data.periodLabel}`,
    preheader: `Reporte diario · ${data.agencyKicker} — ${fmtInt(totals.total)} menciones · últimos 7 días (${data.periodLabel})`,
    kind: 'daily',
    contentRows,
  });
}

// ------------------------------------------------------------
// KPI Card — sin flechas, sin sombras. Pill arriba + número grande
// + delta abajo en línea sutil.
// ------------------------------------------------------------

function kpiCard(
  label: string,
  color: string,
  pillBg: string,
  value: number,
  percentOfTotal: number,
  delta: number,
  side: 'left' | 'right' | 'both',
  deltaDisplay?: DeltaDisplay,
): string {
  const padCss = side === 'right'
    ? 'padding-right:5px;'
    : side === 'left'
    ? 'padding-left:5px;'
    : 'padding-left:5px;padding-right:5px;';

  // Preferimos el DeltaDisplay de @eco/shared/format (vocabulario y magnitud
  // idénticos al dashboard) cuando se provee; de lo contrario caemos al
  // cálculo local retro-compatible sobre el número crudo.
  const deltaValue = deltaDisplay?.value ?? signedPct(delta);
  const deltaWordStr = deltaDisplay?.word ?? deltaWord(delta);

  return `<td class="stack stack-pad" valign="top" width="33.33%" style="${padCss}">
    <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border-radius:8px;border:1px solid ${COLORS.border};">
      <tr>
        <td valign="top" style="padding:16px 16px 14px 16px;">
          <div style="display:inline-block;background:${pillBg};color:${color};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:3px 8px;border-radius:4px;">${label}</div>
          <div class="kpi-value force-text-dark" style="font-size:32px;line-height:1;font-weight:700;color:${COLORS.ink};margin-top:14px;letter-spacing:-0.025em;">${fmtInt(value)}</div>
          <div class="force-text-mute" style="font-size:12.5px;color:${COLORS.inkSoft};margin-top:4px;font-weight:500;">${percentOfTotal}% del total</div>
          <div class="force-text-soft" style="margin-top:10px;font-size:11.5px;color:${COLORS.inkMute};line-height:1.4;">
            <span style="color:${color};font-weight:600;">${esc(deltaValue)}</span> ${esc(deltaWordStr)} vs. 7 días previos
          </div>
        </td>
      </tr>
    </table>
  </td>`;
}

// ------------------------------------------------------------
// Indicadores compuestos — tiles numéricos (paridad dashboard), sin palabra
// cualitativa. Delta vs los 7 días previos como línea de apoyo.
// ------------------------------------------------------------

function renderIndicators(metrics: NonNullable<DailyReportRenderData['metrics']>): string {
  const entries: Array<{ label: string; metric: EmailMetric }> = [
    { label: 'Riesgo de crisis', metric: metrics.crisis },
    { label: 'Salud de marca', metric: metrics.bhi },
    { label: 'Sentimiento neto', metric: metrics.nss },
  ];
  if (metrics.polarization) entries.push({ label: 'Polarización', metric: metrics.polarization });
  if (metrics.velocity) entries.push({ label: 'Velocidad', metric: metrics.velocity });
  if (metrics.engagementRate) entries.push({ label: 'Tasa de interacción', metric: metrics.engagementRate });

  return `
          <tr>
            <td class="px-32" style="padding:6px 32px 8px 32px;">
              ${sectionKicker('Indicadores · mismos valores que el dashboard')}
              ${renderMetricTiles(entries, { cols: 3, deltaSuffix: 'vs 7 días previos' })}
            </td>
          </tr>`;
}

