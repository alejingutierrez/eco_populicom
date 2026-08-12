/**
 * Renderizador del reporte analítico imprimible.
 *
 * Se expone como PIEZAS (una función por sección) en vez de un único
 * `renderReport(data)` porque el endpoint emite el documento en STREAMING: la
 * portada y las secciones de datos salen en los primeros segundos y las de
 * análisis se van anexando conforme Claude responde. Un renderizador monolítico
 * obligaría a esperar la última llamada de Bedrock para mandar el primer byte,
 * y el usuario vería una pestaña en blanco 30 segundos.
 *
 * Cada sección devuelve HTML autocontenido y cierra todo lo que abre, así que el
 * orden de emisión es el orden del documento y un fallo en una sección no
 * corrompe las siguientes.
 */

import type { ReportContext } from '../prompts/full-report';
import type { SentimentReport } from '../aggregations/sentiment-report';
import type {
  ReportExecutiveSummaryOutput, MetricReadingsOutput, TrendAnalysisOutput,
  SentimentAnalysisOutput, TopicAnalysisOutput, ActorAnalysisOutput,
  GeoAnalysisOutput, RiskAnalysisOutput, SynthesisOutput,
} from '../prompts/full-report';
import { formatMetric, formatDelta, type MetricTone } from '../format/metrics-display';
import { formatPeriodLabel, formatShortDay } from '../format-period';
import { REPORT_STYLES, REPORT_FONT_LINK } from './print-styles';
import {
  escapeReportHtml as esc, dailyStackedChart, compositionBar, sparkline,
  hBarChart, bandMeter, hourHeatmap, deltaBars,
  SENTIMENT_LABEL, type HBarRow,
} from './charts-svg';

// ============================================================
// Utilidades de formato
// ============================================================

const n0 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('es-PR');

const n1 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('es-PR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const pctOf = (part: number, total: number): string =>
  total > 0 ? `${((part / total) * 100).toFixed(1)} %` : '—';

/** Alcance / engagement con abreviatura, porque son cifras de 6-7 dígitos. */
function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} M`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)} K`;
  return Math.round(v).toLocaleString('es-PR');
}

const TONE_CLASS: Record<MetricTone, string> = {
  neg: 'tone-neg', warn: 'tone-warn', pos: 'tone-pos', accent: 'tone-accent', neutral: 'tone-neutral',
};

/**
 * Umbrales de banda de cada índice, en su ESCALA DE DISPLAY. Son los mismos de
 * `crisisBand` / `bhiBand10` / `polarizationBand` / `nssBand` en
 * format/metrics-display.ts — esas funciones devuelven la etiqueta pero no los
 * cortes, y el medidor necesita los cortes para dibujar los separadores.
 *
 * ⚠️ Si cambian allá, cambian aquí. Escribirlos "a ojo" es lo que hacía que el
 * medidor marcara la frontera del NSS en −50 cuando la banda real corta en −20,
 * o sea un gráfico que contradecía la etiqueta impresa a 3 mm de distancia.
 */
const METER_BANDS = {
  nss: { min: -100, max: 100, bands: [{ upTo: -20, label: 'Muy neg' }, { upTo: -5, label: 'Neg' }, { upTo: 5, label: 'Neutral' }, { upTo: 20, label: 'Pos' }, { upTo: 100, label: 'Muy pos' }] },
  bhi: { min: 1, max: 10, bands: [{ upTo: 4.6, label: 'Crítico' }, { upTo: 6.4, label: 'Débil' }, { upTo: 8.2, label: 'Sano' }, { upTo: 10, label: 'Fuerte' }] },
  crisis: { min: 0, max: 1, bands: [{ upTo: 0.25, label: 'Normal' }, { upTo: 0.4, label: 'Elevado' }, { upTo: 0.6, label: 'Alerta' }, { upTo: 1, label: 'Crisis' }] },
  polarization: { min: 0, max: 100, bands: [{ upTo: 30, label: 'Apática' }, { upTo: 50, label: 'Moderada' }, { upTo: 75, label: 'Alta' }, { upTo: 100, label: 'Extrema' }] },
} as const;

/**
 * Tono de la banda de POLARIZACIÓN, resuelto aquí y no con el `tone` que trae
 * `formatMetric`.
 *
 * Motivo: el mapa BAND_TONE de metrics-display asigna `'ALTA' → 'pos'` porque
 * "ALTA" también es una banda de PERTINENCIA, donde alta es buena señal. En
 * polarización, "ALTA" es lo contrario, así que un índice de 64/100 se imprimía
 * en verde — el lector concluye lo opuesto al dato. Se corrige localmente para
 * no tocar el tono de las otras métricas del dashboard, que dependen del mismo
 * mapa compartido.
 */
function polarizationTone(band: string | null): MetricTone {
  switch (band) {
    case 'EXTREMA': return 'neg';
    case 'ALTA': return 'warn';
    case 'MODERADA': return 'neutral';
    case 'APÁTICA': return 'neutral';
    default: return 'neutral';
  }
}

/**
 * Párrafos de un bloque de IA. El prompt autoriza <strong> y nada más, así que
 * se escapa todo y se re-habilita únicamente esa etiqueta: si el modelo devuelve
 * cualquier otro marcado (o un <script>), sale como texto literal.
 */
function aiParagraphs(paragraphs: string[] | undefined): string {
  if (!paragraphs?.length) return '';
  return paragraphs.map((p) => `<p>${allowStrongOnly(p)}</p>`).join('');
}

function allowStrongOnly(s: string): string {
  return esc(s)
    .replace(/&lt;strong&gt;/g, '<strong>')
    .replace(/&lt;\/strong&gt;/g, '</strong>');
}

function inline(s: string | undefined | null): string {
  return s ? allowStrongOnly(s) : '';
}

/** Bloque de análisis con su marca de procedencia. */
function aiBlock(body: string, opts: { tag?: string; lead?: boolean } = {}): string {
  if (!body) return '';
  return `<div class="ai"><span class="ai-tag">${esc(opts.tag ?? 'Análisis generado con IA')}</span>`
    + `<div class="prose${opts.lead ? ' lead' : ''}">${body}</div></div>`;
}

/** Marcador para cuando una llamada de IA falló: el documento no miente. */
export function aiUnavailable(reason = 'El análisis de esta sección no pudo generarse en esta corrida.'): string {
  return `<p class="ai-pending">${esc(reason)} Los datos y gráficas de la sección son completos y verificables; sólo falta la lectura interpretativa.</p>`;
}

function sectionHead(n: string, title: string, sub?: string): string {
  return `<header class="sec-head"><span class="sec-n">${esc(n)}</span><h2>${esc(title)}</h2>`
    + (sub ? `<span class="sec-sub">${esc(sub)}</span>` : '') + '</header>';
}

// ============================================================
// Estructura del documento
// ============================================================

const SECTIONS = [
  'Resumen ejecutivo',
  'Panel de indicadores',
  'Evolución del período',
  'Composición del sentimiento',
  'Agenda temática',
  'Actores y canales',
  'Distribución geográfica',
  'Riesgo reputacional',
  'Menciones determinantes',
  'Síntesis analítica',
  'Anexo metodológico',
] as const;

/**
 * Cabecera del documento: `<head>`, estilos, barra de acciones y apertura de la
 * hoja. Se emite ANTES de tocar la base de datos para que el navegador tenga
 * algo que pintar de inmediato.
 */
export function renderDocumentHead(meta: {
  agencyName: string;
  agencyShortName: string;
  periodLabel: string;
  generatedLabel: string;
}): string {
  const title = `ECO · Reporte analítico · ${meta.agencyShortName} · ${meta.periodLabel}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="Reporte analítico de escucha social generado por ECO para ${esc(meta.agencyName)}, período ${esc(meta.periodLabel)}." />
<meta name="robots" content="noindex, nofollow" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${REPORT_FONT_LINK}" />
<style>${REPORT_STYLES}</style>
</head>
<body>
<div class="toolbar no-print">
  <strong>ECO · Reporte analítico</strong>
  <span class="tb-status" id="tb-status">Generando análisis…</span>
  <span class="tb-sep"></span>
  <button type="button" class="primary" id="btn-print" disabled>Guardar como PDF</button>
  <span class="tb-hint">Se abrirá el diálogo de impresión. Elige <strong>Guardar como PDF</strong> como destino y deja activada la opción de gráficos de fondo para conservar los colores.</span>
</div>
<div class="running-head" aria-hidden="true">
  <span>ECO · ${esc(meta.agencyShortName)} · Reporte analítico</span>
  <span>${esc(meta.periodLabel)}</span>
</div>
<main class="sheet">`;
}

/**
 * Metadatos de la portada. Es un tipo PROPIO y no `ReportContext` porque la
 * portada se emite ANTES de consultar la base de datos: en ese momento no
 * existen `report`, `detail` ni `metrics`. Pedir el contexto completo obligaba
 * al endpoint a construir un objeto falso y pasarlo con `as ReportContext`, un
 * cast que rompería en runtime la primera vez que esta función leyera un campo
 * de datos.
 */
export interface CoverMeta {
  agencyName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
  days: number;
  customRange: boolean;
  periodKey: string;
}

/** Portada. Sólo depende de metadatos, así que sale de inmediato. */
export function renderCover(ctx: CoverMeta, meta: { generatedLabel: string; requestedBy?: string | null }): string {
  const windowKind = ctx.customRange
    ? 'Rango personalizado'
    : `Período ${ctx.periodKey} · ventana cerrada`;
  return `<section class="cover">
  <div class="cover-rule"></div>
  <p class="cover-kicker">Escucha social · Gobierno de Puerto Rico</p>
  <h1>Reporte analítico del período</h1>
  <p class="cover-agency">${esc(ctx.agencyName)}</p>
  <dl class="cover-meta">
    <div><dt>Período analizado</dt><dd>${esc(ctx.periodLabel)}</dd></div>
    <div><dt>Días naturales</dt><dd>${ctx.days} · ${esc(windowKind)}</dd></div>
    <div><dt>Comparado contra</dt><dd>${esc(formatPeriodLabel(ctx.prevPeriodStart, ctx.prevPeriodEnd))}</dd></div>
    <div><dt>Generado</dt><dd>${esc(meta.generatedLabel)}</dd></div>
  </dl>
</section>`;
}

/**
 * Índice. Va inmediatamente después de la portada porque no depende de ninguna
 * llamada de IA: la portada y el índice salen en el primer segundo y el lector
 * ya sabe qué contiene el documento mientras el análisis se genera.
 */
export function renderToc(): string {
  return `<nav class="toc" aria-label="Contenido del reporte">
    <p class="eyebrow">Contenido</p>
    <ol>${SECTIONS.map((s, i) => `<li><span class="toc-n">${String(i + 1).padStart(2, '0')}</span><span>${esc(s)}</span></li>`).join('')}</ol>
  </nav>`;
}

// ============================================================
// 01 · Resumen ejecutivo
// ============================================================

export function renderExecutiveSummary(ctx: ReportContext, ai: ReportExecutiveSummaryOutput | null): string {
  const t = ctx.report.totals;
  // La tesis abre la sección, no la portada: es una conclusión analítica y
  // necesita el resumen detrás para sostenerse.
  const thesis = ai?.headline
    ? `<div class="thesis"><span class="thesis-label">Lectura del período</span><p>${allowStrongOnly(ai.headline)}</p></div>`
    : '';
  const body = ai
    ? aiBlock(aiParagraphs(ai.paragraphs), { lead: true })
      + (ai.keyFindings?.length
        ? `<h3 class="block">Hallazgos del período</h3><div class="findings">${
            ai.keyFindings.map((f) => `<div class="finding">
              <div class="finding-label">${esc(f.label)}</div>
              <div class="finding-body">${allowStrongOnly(f.finding)}<span class="evidence">${esc(f.evidence)}</span></div>
            </div>`).join('')
          }</div>`
        : '')
      + (ai.limitations?.length
        ? `<h3 class="block">Límites de esta lectura</h3><div class="prose">${
            ai.limitations.map((l) => `<p>${allowStrongOnly(l)}</p>`).join('')
          }</div>`
        : '')
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('01', 'Resumen ejecutivo', `${n0(t.total)} menciones · ${ctx.days} días`)}
  ${thesis}
  ${body}
</section>`;
}

// ============================================================
// 02 · Panel de indicadores
// ============================================================

interface KpiSpec {
  key: string;
  label: string;
  value: string;
  unit?: string;
  band?: string | null;
  tone: MetricTone;
  delta: string;
  series?: Array<number | null>;
  meter?: string;
}

/** Serie diaria de una métrica del snapshot, para las sparklines. */
export interface MetricSeries {
  nss: Array<number | null>;
  bhi: Array<number | null>;
  crisis: Array<number | null>;
  polarization: Array<number | null>;
  volume: Array<number | null>;
  engagement: Array<number | null>;
}

export function renderIndicators(
  ctx: ReportContext,
  ai: MetricReadingsOutput | null,
  series: MetricSeries,
): string {
  const m = ctx.metrics;
  const p = ctx.prevMetrics;
  const t = ctx.report.totals;

  const dNss = formatDelta(m.nss, p.nss, { kind: 'absolute', decimals: 1 });
  const dVol = formatDelta(t.total, ctx.report.prevTotals.total, { kind: 'percent', decimals: 0 });
  const dEng = formatDelta(m.engagementRate, p.engagementRate, { kind: 'absolute', decimals: 1, suffix: ' pts' });
  const dCrisis = formatDelta(
    m.crisisRiskScore != null ? m.crisisRiskScore * 100 : null,
    p.crisisRiskScore != null ? p.crisisRiskScore * 100 : null,
    { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true },
  );
  const dBhi = formatDelta(
    m.brandHealthIndex != null ? 1 + m.brandHealthIndex * 9 : null,
    p.brandHealthIndex != null ? 1 + p.brandHealthIndex * 9 : null,
    { kind: 'absolute', decimals: 1 },
  );
  const dPol = formatDelta(m.polarizationIndex, p.polarizationIndex, { kind: 'absolute', decimals: 0, suffix: ' pts' });

  const dNss2 = formatMetric('nss', m.nss);
  const dBhi2 = formatMetric('bhi', m.brandHealthIndex);
  const dCri2 = formatMetric('crisis', m.crisisRiskScore);
  const dPol2 = formatMetric('polarization', m.polarizationIndex);

  const deltaText = (d: ReturnType<typeof formatDelta>): string =>
    d.hasBaseline ? `${d.arrow} ${d.value ?? ''} vs. período anterior` : 'sin base de comparación';

  const kpis: KpiSpec[] = [
    {
      key: 'volume', label: 'Volumen de menciones', value: n0(t.total), tone: 'accent',
      delta: deltaText(dVol), series: series.volume,
    },
    {
      key: 'nss', label: 'Net Sentiment Score', value: n1(dNss2.raw), unit: '/ 100',
      band: dNss2.band, tone: dNss2.tone, delta: deltaText(dNss),
      meter: bandMeter({
        ...METER_BANDS.nss, bands: [...METER_BANDS.nss.bands],
        value: dNss2.raw, prev: p.nss, activeLabel: dNss2.band ?? undefined,
      }),
    },
    {
      key: 'bhi', label: 'Brand Health Index', value: n1(dBhi2.raw), unit: '/ 10',
      band: dBhi2.band, tone: dBhi2.tone, delta: deltaText(dBhi),
      meter: bandMeter({
        ...METER_BANDS.bhi, bands: [...METER_BANDS.bhi.bands],
        value: dBhi2.raw,
        prev: p.brandHealthIndex != null ? 1 + p.brandHealthIndex * 9 : null,
        activeLabel: dBhi2.band ?? undefined,
      }),
    },
    {
      key: 'crisis', label: 'Riesgo de crisis', value: dCri2.raw != null ? dCri2.raw.toFixed(2) : '—', unit: '/ 1.00',
      band: dCri2.band, tone: dCri2.tone, delta: deltaText(dCrisis),
      meter: bandMeter({
        ...METER_BANDS.crisis, bands: [...METER_BANDS.crisis.bands],
        value: dCri2.raw, prev: p.crisisRiskScore, activeLabel: dCri2.band ?? undefined,
      }),
    },
    {
      key: 'polarization', label: 'Índice de polarización', value: n0(dPol2.raw), unit: '/ 100',
      band: dPol2.band, tone: polarizationTone(dPol2.band), delta: deltaText(dPol),
      meter: bandMeter({
        ...METER_BANDS.polarization, bands: [...METER_BANDS.polarization.bands],
        value: dPol2.raw, prev: p.polarizationIndex, activeLabel: dPol2.band ?? undefined,
      }),
    },
    {
      key: 'engagement', label: 'Tasa de engagement', value: m.engagementRate != null ? `${n1(m.engagementRate)}` : '—',
      unit: '%', tone: 'neutral', delta: deltaText(dEng),
      // Sin banda cualitativa (la tasa de engagement no tiene uno canónico), así
      // que el mosaico llevaría un hueco del alto del medidor de sus vecinos: la
      // sparkline lo ocupa con información real en vez de aire.
      series: series.engagement,
    },
  ];

  const tiles = kpis.map((k) => `<div class="kpi">
    <div class="kpi-label">${esc(k.label)}</div>
    <div class="kpi-value">${esc(k.value)}${k.unit ? ` <span class="kpi-unit">${esc(k.unit)}</span>` : ''}</div>
    ${k.band ? `<div class="kpi-band ${TONE_CLASS[k.tone]}">${esc(k.band)}</div>` : ''}
    <div class="kpi-delta">${esc(k.delta)}</div>
    ${k.meter ?? (k.series ? sparkline(k.series) : '')}
  </div>`).join('');

  // Lecturas de IA, en el orden que pidió el prompt.
  const readingMap = new Map((ai?.readings ?? []).map((r) => [r.metric, r]));
  const LABELS: Record<string, string> = {
    volume: 'Volumen', nss: 'Net Sentiment Score', bhi: 'Brand Health Index',
    crisis: 'Riesgo de crisis', polarization: 'Polarización', engagement: 'Engagement',
  };
  const readings = ai
    ? (['volume', 'nss', 'bhi', 'crisis', 'polarization', 'engagement'] as const)
        .map((key) => {
          const r = readingMap.get(key);
          if (!r) return '';
          return `<div class="reading">
            <div class="reading-h">${esc(LABELS[key])}</div>
            <p>${allowStrongOnly(r.reading)}</p>
            <p class="driver">${allowStrongOnly(r.driver)}</p>
          </div>`;
        }).join('')
    : aiUnavailable();

  const reach = ctx.detail.totals.reach;
  const engagement = ctx.detail.totals.engagement;

  return `<section class="section">
  ${sectionHead('02', 'Panel de indicadores', 'Valor del período y su banda; el tick hueco marca el período anterior')}
  <div class="kpi-grid">${tiles}</div>

  <div class="table-scroll"><table class="rp">
    <caption>Magnitudes agregadas del período</caption>
    <thead><tr><th>Magnitud</th><th class="n">Período</th><th class="n">Anterior</th><th>Nota</th></tr></thead>
    <tbody>
      <tr><td>Menciones (universo pertinente)</td><td class="n">${n0(ctx.report.totals.total)}</td><td class="n">${n0(ctx.report.prevTotals.total)}</td><td>Sin duplicados, pertinencia distinta de baja</td></tr>
      <tr><td>Alcance estimado agregado</td><td class="n">${compact(reach)}</td><td class="n">—</td><td>Suma de <code>reach_estimate</code> reportado por la fuente</td></tr>
      <tr><td>Engagement agregado</td><td class="n">${compact(engagement)}</td><td class="n">—</td><td>Likes + comentarios + compartidas</td></tr>
      <tr><td>Engagement por mención</td><td class="n">${n1(ctx.metrics.engagementPerMention)}</td><td class="n">${n1(ctx.prevMetrics.engagementPerMention)}</td><td>Promedio del período</td></tr>
      <tr><td>Anomalía de volumen (z)</td><td class="n">${n1(ctx.metrics.volumeAnomalyZscore)}</td><td class="n">—</td><td>Desviaciones respecto al histórico previo</td></tr>
    </tbody>
  </table></div>

  <h3 class="block">Lectura de cada indicador</h3>
  ${ai ? `<div class="ai"><span class="ai-tag">Análisis generado con IA</span>${readings}</div>` : readings}
</section>`;
}

// ============================================================
// 03 · Evolución del período
// ============================================================

const ES_MONTH = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "ago 25" — etiqueta de un cubo mensual, con año corto por si cruza diciembre. */
function monthLabel(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return `${ES_MONTH[m - 1]} ${String(y).slice(2)}`;
}

interface Bucket {
  date: string;
  dayLabel: string;
  negative: number;
  neutral: number;
  positive: number;
  /** Etiqueta larga para la tabla ("29 jul – 4 ago"). */
  rangeLabel: string;
}

/**
 * Agrupa la serie diaria en cubos del tamaño necesario para que la sección sea
 * legible en papel.
 *
 * El header ofrece hasta "Max", que son 730 días. Sin agrupar, la gráfica
 * tendría 730 columnas de menos de un punto de ancho y la tabla "serie diaria
 * completa" ocuparía unas treinta páginas de filas — es decir, el reporte de un
 * período largo sería ilegible justo por ser largo.
 *
 * Cortes: hasta 45 días se muestra día a día (lo que el usuario espera de 1D a
 * 30D); hasta 200 se agrupa por semana; más allá, por mes.
 */
function bucketSeries(series: SentimentReport['dailySeries']): {
  buckets: Bucket[];
  grain: 'día' | 'semana' | 'mes';
  size: number;
} {
  const n = series.length;
  const grain: 'día' | 'semana' | 'mes' = n <= 45 ? 'día' : n <= 200 ? 'semana' : 'mes';
  const size = grain === 'día' ? 1 : grain === 'semana' ? 7 : 30;

  if (size === 1) {
    return {
      buckets: series.map((d) => ({ ...d, rangeLabel: d.date })),
      grain, size,
    };
  }

  const out: Bucket[] = [];
  for (let i = 0; i < n; i += size) {
    const chunk = series.slice(i, i + size);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    out.push({
      date: first.date,
      // Etiqueta del eje según el grano. Con cubos mensuales, reusar el
      // `dayLabel` del primer día ("mar 12") rotula un mes con un día de semana:
      // el eje decía algo que la columna no es. Semanal usa el día de inicio
      // ("12 ago"); mensual, el mes.
      dayLabel: grain === 'semana' ? formatShortDay(first.date) : monthLabel(first.date),
      rangeLabel: chunk.length === 1 ? first.date : `${first.date} → ${last.date}`,
      negative: chunk.reduce((s, d) => s + d.negative, 0),
      neutral: chunk.reduce((s, d) => s + d.neutral, 0),
      positive: chunk.reduce((s, d) => s + d.positive, 0),
    });
  }
  return { buckets: out, grain, size };
}

export function renderTrend(ctx: ReportContext, ai: TrendAnalysisOutput | null): string {
  const { report, detail } = ctx;
  const { buckets, grain, size } = bucketSeries(report.dailySeries);
  const bucketed = size > 1;
  const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const dowRows: HBarRow[] = detail.byDow
    .map((v, i) => ({ label: DOW[i], value: v }))
    .filter((r) => r.value > 0);

  const peakNotes = new Map((ai?.peakNotes ?? []).map((p) => [p.date, p.note]));

  const peakTable = detail.peaks.length
    ? `<div class="table-scroll"><table class="rp">
        <caption>Días atípicos por volumen</caption>
        <thead><tr><th>Día</th><th class="n">Menciones</th><th class="n">Negativas</th><th class="n">z</th><th>Lectura</th></tr></thead>
        <tbody>${detail.peaks.map((p) => `<tr>
          <td>${esc(p.dayLabel)} <span class="sub">${esc(p.date)}</span></td>
          <td class="n">${n0(p.total)}</td>
          <td class="n">${n0(p.negative)}</td>
          <td class="n">${p.zScore >= 0 ? '+' : ''}${p.zScore.toFixed(2)}</td>
          <td>${peakNotes.has(p.date) ? allowStrongOnly(peakNotes.get(p.date)!) : '<span class="ai-pending">sin lectura</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '';

  const grainCaption = bucketed
    ? `Serie por ${grain} — la tabla equivalente de la gráfica. El período tiene ${report.dailySeries.length} días, así que se agrupa por ${grain} para que sea legible en papel.`
    : 'Serie diaria completa — la tabla equivalente de la gráfica';

  const dailyTable = `<div class="table-scroll"><table class="rp">
    <caption>${esc(grainCaption)}</caption>
    <thead><tr><th>${bucketed ? esc(grain.charAt(0).toUpperCase() + grain.slice(1)) : 'Día'}</th><th class="n">Negativo</th><th class="n">Neutral</th><th class="n">Positivo</th><th class="n">Total</th></tr></thead>
    <tbody>${buckets.map((d) => {
      const tot = d.negative + d.neutral + d.positive;
      return `<tr><td>${esc(d.dayLabel)} <span class="sub">${esc(d.rangeLabel)}</span></td>`
        + `<td class="n">${n0(d.negative)}</td><td class="n">${n0(d.neutral)}</td>`
        + `<td class="n">${n0(d.positive)}</td><td class="n">${n0(tot)}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td>Total</td><td class="n">${n0(report.totals.negative)}</td><td class="n">${n0(report.totals.neutral)}</td><td class="n">${n0(report.totals.positive)}</td><td class="n">${n0(report.totals.total)}</td></tr></tfoot>
  </table></div>`;

  return `<section class="section">
  ${sectionHead('03', 'Evolución del período', ai?.shape ? undefined : `${ctx.days} días · hora de Puerto Rico`)}
  ${ai?.shape ? `<p class="eyebrow">Forma de la ventana</p><div class="prose" style="margin-bottom:5mm"><p><strong>${esc(ai.shape)}</strong></p></div>` : ''}
  ${dailyStackedChart(buckets, {
    title: bucketed ? `Menciones por ${grain} y sentimiento` : 'Menciones por día y sentimiento',
    grain,
  })}
  ${bucketed ? `<p class="fig-note" style="margin-top:-3mm">Cada columna agrupa ${size} días. El análisis y la tabla de días atípicos de abajo trabajan sobre la serie DIARIA, así que sus cifras son de un día y no de ${grain === 'semana' ? 'una semana' : 'un mes'} completo.</p>` : ''}
  ${ai ? aiBlock(aiParagraphs(ai.paragraphs)) : aiUnavailable()}
  ${peakTable}
  <h3 class="block">Ritmo de la conversación</h3>
  <div class="split-wide split">
    <div>${hourHeatmap(detail.byHour, { title: 'Menciones por hora del día' })}</div>
    <div>${hBarChart(dowRows, { title: 'Menciones por día de la semana', labelWidth: 110, valueSuffix: '' })}</div>
  </div>
  ${dailyTable}
</section>`;
}

// ============================================================
// 04 · Composición del sentimiento
// ============================================================

export function renderSentiment(ctx: ReportContext, ai: SentimentAnalysisOutput | null): string {
  const { report, detail } = ctx;
  const t = report.totals;

  const emotionRows: HBarRow[] = detail.emotions.slice(0, 8).map((e) => ({
    label: e.emotion, value: e.count,
  }));

  const deltas = [
    { label: SENTIMENT_LABEL.negative, value: report.deltaVsPrev.negative, tone: 'neg' as const },
    { label: SENTIMENT_LABEL.neutral, value: report.deltaVsPrev.neutral, tone: 'neu' as const },
    { label: SENTIMENT_LABEL.positive, value: report.deltaVsPrev.positive, tone: 'pos' as const },
  ];

  const compTable = `<div class="table-scroll"><table class="rp">
    <caption>Termómetro del período contra el anterior</caption>
    <thead><tr><th>Sentimiento</th><th class="n">Período</th><th class="n">% del total</th><th class="n">Anterior</th><th class="n">Variación</th></tr></thead>
    <tbody>
      ${(['negative', 'neutral', 'positive'] as const).map((k) => `<tr>
        <td>${esc(SENTIMENT_LABEL[k])}</td>
        <td class="n">${n0(t[k])}</td>
        <td class="n">${pctOf(t[k], t.total)}</td>
        <td class="n">${n0(report.prevTotals[k])}</td>
        <td class="n">${report.deltaVsPrev[k] >= 0 ? '+' : ''}${report.deltaVsPrev[k].toFixed(1)} %</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr><td>Total</td><td class="n">${n0(t.total)}</td><td class="n">100 %</td><td class="n">${n0(report.prevTotals.total)}</td><td class="n">${report.prevTotals.total > 0 ? `${(((t.total - report.prevTotals.total) / report.prevTotals.total) * 100).toFixed(1)} %` : '—'}</td></tr></tfoot>
  </table></div>`;

  const blocks = ai
    ? `<div class="ai"><span class="ai-tag">Análisis generado con IA</span>
        <div class="prose">${aiParagraphs(ai.paragraphs)}</div>
        <div class="reading"><div class="reading-h">De qué está hecha la negatividad</div><p>${inline(ai.negativeComposition)}</p></div>
        <div class="reading"><div class="reading-h">De qué está hecho lo positivo</div><p>${inline(ai.positiveComposition)}</p></div>
        <div class="reading"><div class="reading-h">Perfil emocional</div><p>${inline(ai.emotionalProfile)}</p></div>
      </div>`
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('04', 'Composición del sentimiento', `Universo pertinente · ${n0(t.total)} menciones`)}
  ${compositionBar(t, { title: 'Reparto del período' })}
  ${deltaBars(deltas, { title: 'Variación de cada sentimiento vs. período anterior' })}
  ${compTable}
  <h3 class="block">Perfil emocional</h3>
  ${hBarChart(emotionRows, {
    title: 'Emociones detectadas por el NLP',
    labelWidth: 130,
    note: `Etiquetas sobre ${n0(detail.emotionsTagged)} detecciones. Una mención puede traer varias emociones, así que la suma excede el número de menciones.`,
  })}
  ${blocks}
</section>`;
}

// ============================================================
// 05 · Agenda temática
// ============================================================

export function renderTopics(ctx: ReportContext, ai: TopicAnalysisOutput | null): string {
  const { report, detail } = ctx;

  const topicRows: HBarRow[] = report.topicsTable.map((r) => ({
    label: r.topic,
    sub: r.subtopics || undefined,
    value: r.total,
    breakdown: { negative: r.negative, neutral: r.neutral, positive: r.positive },
  }));

  const subRows: HBarRow[] = detail.subtopics.slice(0, 12).map((s) => ({
    label: s.subtopic,
    sub: s.topic,
    value: s.total,
    breakdown: { negative: s.negative, neutral: s.neutral, positive: s.positive },
  }));

  const table = `<div class="table-scroll"><table class="rp">
    <caption>Tabla de tópicos — conteo principal y secundario</caption>
    <thead><tr><th>Tópico</th><th class="n">Total</th><th class="n">Neg</th><th class="n">% neg</th><th class="n">Neu</th><th class="n">Pos</th><th class="n">Secund.</th></tr></thead>
    <tbody>${report.topicsTable.map((r) => `<tr class="${r.isOther || r.isUnclassified ? 'agg' : ''}">
      <td>${esc(r.topic)}${r.subtopics ? `<span class="sub">${esc(r.subtopics)}</span>` : ''}</td>
      <td class="n">${n0(r.total)}</td>
      <td class="n">${n0(r.negative)}</td>
      <td class="n">${pctOf(r.negative, r.total)}</td>
      <td class="n">${n0(r.neutral)}</td>
      <td class="n">${n0(r.positive)}</td>
      <td class="n">${r.secondaryCount > 0 ? n0(r.secondaryCount) : '—'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  const cards = ai?.topics?.length
    ? ai.topics.map((tp) => {
        const row = report.topicsTable.find((r) => r.topic === tp.topic);
        return `<div class="topic-card">
          <div class="topic-card-head">
            <h4>${esc(tp.topic)}</h4>
            <span class="chip chip-strong">${esc(tp.pattern)}</span>
            <span class="chip">${esc(tp.actor)}</span>
            ${row ? `<span class="chip">${n0(row.total)} menc. · ${pctOf(row.negative, row.total)} neg</span>` : ''}
          </div>
          <p>${allowStrongOnly(tp.analysis)}</p>
        </div>`;
      }).join('')
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('05', 'Agenda temática', 'Cada mención cuenta una vez, bajo su tópico de mayor confianza')}
  ${hBarChart(topicRows, {
    title: 'Volumen y composición por tópico',
    note: 'El largo total es el volumen del tópico; los segmentos son su composición de sentimiento en el orden fijo negativo → neutral → positivo.',
  })}
  ${ai?.overview ? aiBlock(`<p>${allowStrongOnly(ai.overview)}</p>`) : ''}
  ${table}
  <h3 class="block">Análisis por tópico</h3>
  ${cards}
  <h3 class="block">Subtópicos más activos</h3>
  ${hBarChart(subRows, {
    title: 'Volumen y composición por subtópico',
    labelWidth: 150,
    note: 'Cada mención cuenta bajo su par tópico-subtópico de mayor confianza, así que los subtotales no exceden el total del período.',
  })}
</section>`;
}

// ============================================================
// 06 · Actores y canales
// ============================================================

export function renderActors(ctx: ReportContext, ai: ActorAnalysisOutput | null): string {
  const { detail, report } = ctx;

  const channelRows: HBarRow[] = detail.channels.map((c) => ({
    label: c.label,
    value: c.total,
    breakdown: { negative: c.negative, neutral: c.neutral, positive: c.positive },
  }));

  const channelTable = `<div class="table-scroll"><table class="rp">
    <caption>Canales — volumen, engagement y alcance no coinciden</caption>
    <thead><tr><th>Canal</th><th class="n">Menciones</th><th class="n">% del total</th><th class="n">% neg</th><th class="n">Engagement</th><th class="n">Alcance</th></tr></thead>
    <tbody>${detail.channels.map((c) => `<tr>
      <td>${esc(c.label)}</td>
      <td class="n">${n0(c.total)}</td>
      <td class="n">${pctOf(c.total, report.totals.total)}</td>
      <td class="n">${pctOf(c.negative, c.total)}</td>
      <td class="n">${compact(c.engagement)}</td>
      <td class="n">${compact(c.reach)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  const authorTable = detail.authors.length
    ? `<div class="table-scroll"><table class="rp">
        <caption>Autores más activos del período</caption>
        <thead><tr><th>Autor</th><th>Canal</th><th class="n">Menciones</th><th class="n">Neg</th><th class="n">Pos</th><th class="n">Engagement</th></tr></thead>
        <tbody>${detail.authors.map((a) => `<tr>
          <td>${esc(a.author)}</td>
          <td>${esc(a.channel)}</td>
          <td class="n">${n0(a.total)}</td>
          <td class="n">${n0(a.negative)}</td>
          <td class="n">${n0(a.positive)}</td>
          <td class="n">${compact(a.engagement)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="fig-empty">El período no trae datos de autoría.</p>';

  const domainRows: HBarRow[] = detail.domains.slice(0, 10).map((d) => ({
    label: d.domain, value: d.total,
  }));

  const blocks = ai
    ? `<div class="ai"><span class="ai-tag">Análisis generado con IA</span>
        <div class="prose">${aiParagraphs(ai.paragraphs)}</div>
        <div class="reading"><div class="reading-h">Quién ordena la narrativa</div><p>${inline(ai.narrativeControl)}</p></div>
        <div class="reading"><div class="reading-h">Lectura por canal</div><p>${inline(ai.channelReading)}</p></div>
      </div>`
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('06', 'Actores y canales', 'Quién produce la conversación y dónde ocurre')}
  ${hBarChart(channelRows, { title: 'Volumen y composición por canal' })}
  ${channelTable}
  ${blocks}
  <h3 class="block">Autores</h3>
  ${authorTable}
  <h3 class="block">Dominios y medios</h3>
  ${hBarChart(domainRows, { title: 'Menciones por dominio', labelWidth: 190 })}
</section>`;
}

// ============================================================
// 07 · Distribución geográfica
// ============================================================

export function renderGeography(ctx: ReportContext, ai: GeoAnalysisOutput | null): string {
  const { detail, report } = ctx;
  const geoTotal = detail.municipalities.reduce((s, m) => s + m.total, 0);

  const muniRows: HBarRow[] = detail.municipalities.slice(0, 14).map((m) => ({
    label: m.name,
    sub: m.region,
    value: m.total,
    breakdown: { negative: m.negative, neutral: m.neutral, positive: m.positive },
  }));

  const regionRows: HBarRow[] = detail.regions.slice(0, 8).map((r) => ({
    label: r.region,
    sub: `${r.municipalities} municipio${r.municipalities === 1 ? '' : 's'}`,
    value: r.total,
    breakdown: { negative: r.negative, neutral: r.neutral, positive: r.positive },
  }));

  const coverageNote = `Las etiquetas de municipio suman ${n0(geoTotal)} sobre ${n0(report.totals.total)} menciones del período: el municipio lo extrae el NLP del texto, una mención puede citar varios y muchas no citan ninguno. Los conteos geográficos NO son una partición del total.`;

  const body = ai
    ? `<div class="ai"><span class="ai-tag">Análisis generado con IA</span>
        <div class="prose">${aiParagraphs(ai.paragraphs)}</div>
        <div class="reading"><div class="reading-h">Concentración</div><p>${inline(ai.concentration)}</p></div>
      </div>`
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('07', 'Distribución geográfica', 'Municipios extraídos del texto por el NLP')}
  ${geoTotal === 0
    ? '<p class="fig-empty">El período no tiene menciones con municipio detectado. La lectura geográfica no aplica.</p>'
    : `${hBarChart(regionRows, { title: 'Menciones por región', labelWidth: 150 })}
       ${hBarChart(muniRows, { title: 'Menciones por municipio', labelWidth: 150, note: coverageNote })}`}
  ${body}
</section>`;
}

// ============================================================
// 08 · Riesgo reputacional
// ============================================================

export function renderRisk(ctx: ReportContext, ai: RiskAnalysisOutput | null): string {
  const m = ctx.metrics;
  const comps = [
    { label: 'Severidad', value: m.crisisSeverity, note: 'Peso de la negatividad del período' },
    { label: 'Velocidad', value: m.crisisVelocity, note: 'Ritmo de cambio del volumen contra el período previo' },
    { label: 'Relevancia', value: m.crisisRelevance, note: 'Pertinencia y alcance del material negativo' },
    { label: 'Confianza', value: m.crisisConfidence, note: 'Cobertura del NLP sobre el material del período' },
  ];

  const compTable = `<div class="table-scroll"><table class="rp">
    <caption>Componentes del índice de riesgo de crisis</caption>
    <thead><tr><th>Componente</th><th class="n">Valor</th><th>Qué mide</th></tr></thead>
    <tbody>${comps.map((c) => `<tr>
      <td>${esc(c.label)}</td>
      <td class="n">${c.value != null ? c.value.toFixed(3) : '—'}</td>
      <td>${esc(c.note)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td>Índice compuesto</td><td class="n">${m.crisisRiskScore != null ? m.crisisRiskScore.toFixed(3) : '—'}</td><td>Escala 0 – 1</td></tr></tfoot>
  </table></div>`;

  const negTable = ctx.detail.topNegative.length
    ? `<div class="table-scroll"><table class="rp">
        <caption>Menciones negativas con más engagement — el material que sostiene el riesgo</caption>
        <thead><tr><th>Mención</th><th class="n">Engagement</th><th class="n">Alcance</th></tr></thead>
        <tbody>${ctx.detail.topNegative.map((mn) => `<tr class="mention-row">
          <td>
            <span class="mention-title">${esc(mn.title.slice(0, 190))}</span>
            <span class="mention-meta">${esc(mn.date)} · ${esc(mn.author ?? 'autor n/d')} · ${esc(mn.channel)}${mn.domain ? ` · ${esc(mn.domain)}` : ''}${mn.topic ? ` · ${esc(mn.topic)}` : ''}${mn.emotions.length ? ` · ${esc(mn.emotions.join(', '))}` : ''}</span>
          </td>
          <td class="n">${compact(mn.engagement)}</td>
          <td class="n">${compact(mn.reach)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="fig-empty">El período no registra menciones negativas en el universo pertinente.</p>';

  const body = ai
    ? `<div class="ai"><span class="ai-tag">Análisis generado con IA</span>
        ${ai.assessment ? `<div class="prose" style="margin-bottom:3mm"><p><strong>${esc(ai.assessment)}</strong></p></div>` : ''}
        <div class="prose">${aiParagraphs(ai.paragraphs)}</div>
        ${ai.signals?.length ? `<h4 class="block">Señales presentes en el período</h4><div class="signals">${
          ai.signals.map((s) => `<div class="signal">
            <span>${allowStrongOnly(s.signal)}</span>
            <span class="sig-ev">${esc(s.evidence)}</span>
            <span class="sig-w ${s.weight === 'alta' ? 'tone-neg' : s.weight === 'media' ? 'tone-warn' : 'tone-neutral'}">${esc(s.weight)}</span>
          </div>`).join('')
        }</div>` : ''}
      </div>`
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('08', 'Riesgo reputacional', 'Descripción cuantificada del riesgo observado; el reporte no emite recomendaciones')}
  ${compTable}
  ${body}
  <h3 class="block">Material de riesgo</h3>
  ${negTable}
</section>`;
}

// ============================================================
// 09 · Menciones determinantes
// ============================================================

export function renderMentions(ctx: ReportContext): string {
  const rows = ctx.detail.topByEngagement;
  const pillClass = (s: string | null): string =>
    s === 'negative' ? 'tone-neg' : s === 'positive' ? 'tone-pos' : 'tone-neutral';

  const table = rows.length
    ? `<div class="table-scroll"><table class="rp">
        <caption>Las ${rows.length} menciones con más engagement del período</caption>
        <thead><tr><th>Mención</th><th>Sentimiento</th><th class="n">Engag.</th><th class="n">Alcance</th></tr></thead>
        <tbody>${rows.map((m) => `<tr class="mention-row">
          <td>
            <span class="mention-title">${esc(m.title.slice(0, 200))}</span>
            <span class="mention-meta">${esc(m.date)} · ${esc(m.author ?? 'autor n/d')} · ${esc(m.channel)}${m.domain ? ` · ${esc(m.domain)}` : ''}${m.topic ? ` · ${esc(m.topic)}` : ' · sin clasificar'}</span>
            ${m.url ? `<span class="mention-link">${esc(m.url.slice(0, 120))}</span>` : ''}
          </td>
          <td><span class="pill ${pillClass(m.sentiment)}">${esc(m.sentiment ? SENTIMENT_LABEL[m.sentiment] : 'sin evaluar')}</span></td>
          <td class="n">${compact(m.engagement)}</td>
          <td class="n">${compact(m.reach)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : '<p class="fig-empty">El período no tiene menciones en el universo pertinente.</p>';

  return `<section class="section">
  ${sectionHead('09', 'Menciones determinantes', 'Ordenadas por engagement; la URL se imprime para poder verificar la fuente')}
  ${table}
</section>`;
}

// ============================================================
// 10 · Síntesis
// ============================================================

export function renderSynthesis(ctx: ReportContext, ai: SynthesisOutput | null): string {
  const body = ai
    ? `<div class="ai"><span class="ai-tag">Análisis generado con IA</span>
        <div class="prose lead">${aiParagraphs(ai.paragraphs)}</div>
        ${ai.watchItems?.length ? `<h3 class="block">Qué conviene seguir midiendo</h3><div class="findings">${
          ai.watchItems.map((w, i) => `<div class="finding">
            <div class="finding-label">${String(i + 1).padStart(2, '0')}</div>
            <div class="finding-body">${allowStrongOnly(w.item)}<span class="evidence">${esc(w.rationale)}</span></div>
          </div>`).join('')
        }</div>` : ''}
      </div>`
    : aiUnavailable();

  return `<section class="section">
  ${sectionHead('10', 'Síntesis analítica', `${ctx.agencyShortName} · ${ctx.periodLabel}`)}
  ${body}
</section>`;
}

// ============================================================
// 11 · Anexo metodológico
// ============================================================

export function renderAnnex(ctx: ReportContext, meta: {
  generatedLabel: string;
  model: string;
  aiSectionsOk: number;
  aiSectionsTotal: number;
}): string {
  const d = ctx.detail;
  const windowExplain = ctx.customRange
    ? `Rango personalizado: del ${ctx.periodStart} al ${ctx.periodEnd}, ambos inclusive, en días calendario de Puerto Rico.`
    : `Preset <code>${esc(ctx.periodKey)}</code>: ventana CERRADA de ${ctx.days} días naturales que termina AYER en hora de Puerto Rico. El día en curso nunca se incluye porque estaría parcial y ensuciaría las comparaciones.`;

  return `<section class="section annex">
  ${sectionHead('11', 'Anexo metodológico', 'Cómo leer cada número de este reporte')}

  <h3 class="block">Ventana temporal</h3>
  <dl>
    <dt>Período analizado</dt><dd>${windowExplain}</dd>
    <dt>Período de comparación</dt><dd>Del ${esc(ctx.prevPeriodStart)} al ${esc(ctx.prevPeriodEnd)} (${esc(formatPeriodLabel(ctx.prevPeriodStart, ctx.prevPeriodEnd))}): misma duración, inmediatamente anterior. Todos los deltas del reporte son contra esta ventana.</dd>
    <dt>Zona horaria</dt><dd><code>America/Puerto_Rico</code> (AST, UTC−4, sin horario de verano). La fecha de una mención es su fecha de PUBLICACIÓN, nunca la de ingesta al sistema.</dd>
  </dl>

  <h3 class="block">Universo de conteo</h3>
  <dl>
    <dt>Qué se cuenta</dt><dd>Menciones no duplicadas cuya pertinencia evaluada por el NLP no es <code>baja</code>. Las de pertinencia baja son ruido y se excluyen de todos los conteos, gráficas y tablas de este documento.</dd>
    <dt>Por qué los índices no cuadran con los conteos</dt><dd>NSS, Brand Health Index, riesgo de crisis y polarización se calculan sobre el universo calibrado por backtest de <code>@eco/shared/metrics</code>, que no es el mismo del termómetro. No son una función aritmética de los conteos que aparecen en las tablas: son índices con su propia normalización.</dd>
    <dt>Sentimiento</dt><dd>Se usa el del NLP (Claude) y, cuando falta, el de la plataforma de origen. Tres niveles: negativo, neutral, positivo.</dd>
    <dt>Engagement</dt><dd>Suma de likes, comentarios y compartidas reportados por la fuente. El alcance es el <code>reach_estimate</code> de la plataforma, no una medición propia.</dd>
    <dt>Tópicos</dt><dd>Cada mención cuenta UNA vez, bajo su tópico de mayor confianza. La columna "secundarias" cuenta las menciones donde el tópico aparece sin ser el principal, y por eso puede sumar más que el total.</dd>
    <dt>Geografía</dt><dd>El municipio lo extrae el NLP del texto. Una mención puede citar varios municipios y la mayoría no cita ninguno, así que los conteos geográficos no son una partición del total del período.</dd>
  </dl>

  <h3 class="block">Cobertura del NLP en este período</h3>
  <div class="table-scroll"><table class="rp">
    <thead><tr><th>Indicador de cobertura</th><th class="n">Menciones</th><th class="n">% del período</th></tr></thead>
    <tbody>
      <tr><td>Menciones del período (universo pertinente)</td><td class="n">${n0(d.totals.mentions)}</td><td class="n">100 %</td></tr>
      <tr><td>Sin tópico asignado</td><td class="n">${n0(d.unclassified)}</td><td class="n">${pctOf(d.unclassified, d.totals.mentions)}</td></tr>
      <tr><td>Sin sentimiento evaluado</td><td class="n">${n0(d.withoutSentiment)}</td><td class="n">${pctOf(d.withoutSentiment, d.totals.mentions)}</td></tr>
    </tbody>
  </table></div>
  <p class="fig-note">Una cobertura incompleta no invalida los porcentajes, pero sí acota su alcance: la agenda temática describe la parte clasificada del período, no su totalidad.</p>

  <h3 class="block">Análisis generado con IA</h3>
  <dl>
    <dt>Modelo</dt><dd><code>${esc(meta.model)}</code> vía AWS Bedrock. ${meta.aiSectionsOk} de ${meta.aiSectionsTotal} bloques de análisis se generaron correctamente en esta corrida.</dd>
    <dt>Qué produce el modelo</dt><dd>Únicamente el texto interpretativo señalado con el filete lateral y la marca "Análisis generado con IA". Todas las cifras, tablas y gráficas se calculan en la base de datos: el modelo las lee, no las produce.</dd>
    <dt>Registro editorial</dt><dd>El reporte es descriptivo y cuantificado. No emite recomendaciones, sugerencias de acción ni juicios prescriptivos: describe la dinámica de una conversación ajena y deja la decisión a la agencia.</dd>
    <dt>Verificabilidad</dt><dd>Cada afirmación del análisis debe apoyarse en una cifra y un elemento propio (tópico, autor, medio, municipio o fecha) presentes en las tablas de este mismo documento.</dd>
  </dl>

  <h3 class="block">Diseño del documento</h3>
  <dl>
    <dt>Color y escala de grises</dt><dd>La paleta de sentimiento del reporte separa la luminancia (negativo 0.06, neutral 0.62, positivo 0.22) para que las gráficas se lean impresas en blanco y negro. El color nunca es la única codificación: el orden de los segmentos es fijo (negativo → neutral → positivo), llevan etiqueta directa y cada gráfica va acompañada de su tabla de números.</dd>
    <dt>Impresión</dt><dd>Todo lo que porta significado está en SVG, que se imprime siempre. Si desactivas "gráficos de fondo" en el diálogo de impresión el documento pierde algunos matices de superficie pero conserva íntegras las gráficas y los datos.</dd>
  </dl>

  <footer class="colophon">
    <span>ECO · Plataforma de escucha social · Populicom para el Gobierno de Puerto Rico</span>
    <span>${esc(ctx.agencyName)} · ${esc(ctx.periodLabel)} · generado ${esc(meta.generatedLabel)}</span>
  </footer>
</section>`;
}

// ============================================================
// Cierre del documento
// ============================================================

/**
 * Cierra la hoja y activa la impresión. El script se emite al FINAL del stream,
 * así que sólo corre cuando el documento está completo — no se puede imprimir a
 * medias.
 *
 * `document.fonts.ready` importa: Besley y Krub llegan de Google Fonts y si el
 * diálogo se abre antes de que carguen, el PDF sale con la fuente de respaldo y
 * la paginación cambia.
 */
export function renderDocumentFoot(opts: { autoPrint: boolean; statusLabel: string }): string {
  return `</main>
<script>
(function () {
  var btn = document.getElementById('btn-print');
  var status = document.getElementById('tb-status');
  if (status) status.textContent = ${JSON.stringify(opts.statusLabel)};
  if (btn) {
    btn.disabled = false;
    btn.addEventListener('click', function () { window.print(); });
  }
  var ready = (document.fonts && document.fonts.ready)
    ? document.fonts.ready
    : Promise.resolve();
  ${opts.autoPrint ? `
  ready.then(function () {
    // Un frame extra para que el layout con las fuentes reales se asiente antes
    // de que el navegador tome la instantánea de impresión.
    requestAnimationFrame(function () {
      setTimeout(function () { window.print(); }, 150);
    });
  }).catch(function () { window.print(); });` : ''}
})();
</script>
</body>
</html>`;
}

/**
 * Actualiza el indicador de la barra mientras el stream avanza. Se emite entre
 * secciones: el navegador ejecuta cada `<script>` en cuanto lo recibe, así que
 * el usuario ve el progreso real sin polling ni websockets.
 */
export function renderProgress(label: string): string {
  return `<script>(function(){var e=document.getElementById('tb-status');if(e)e.textContent=${JSON.stringify(label)};})();</script>`;
}

/** Página de error dentro del propio documento (el usuario ya abrió la pestaña). */
export function renderFatalError(message: string, detail?: string): string {
  return `<section class="section">
  ${sectionHead('!!', 'El reporte no pudo generarse')}
  <div class="prose">
    <p>${esc(message)}</p>
    ${detail ? `<p class="ai-pending">${esc(detail)}</p>` : ''}
    <p>Cierra esta pestaña y vuelve a intentarlo desde el dashboard. Si el problema persiste con el mismo período, prueba con un rango más corto.</p>
  </div>
</section>`;
}

export { SECTIONS };
