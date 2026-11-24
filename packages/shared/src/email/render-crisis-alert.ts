/**
 * Template HTML del correo editorial de alerta de crisis (cromo
 * «Instrumento» desde sep 2026, camino A del rediseño de correos).
 *
 * Es el único correo donde el estado manda sobre el cromo: la BANDA
 * (CRISIS / ALERTA / ELEVADO) decide el color de la etiqueta y del filete
 * superior, porque aquí el color ES el dato. Orden:
 *
 *   encabezado (titular + lede) → lecturas (crisis, severidad, velocidad) →
 *   volumen del día → foto opcional → evolución del score (tablas HTML) →
 *   qué lo está empujando + cuerpo → voces → enlaces y fuentes con
 *   miniaturas opcionales → contexto → acción.
 *
 * Compatibilidad: inline styles + tablas (Gmail, Outlook, Apple Mail).
 */

import { formatMetric } from '../format/metrics-display';
import { esc, fmtInt } from './chrome';
import { daysLabelEs } from '../crisis/episode';
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionRow,
  columnChart,
  compareTable,
  heroImage,
  instrumentDocument,
  mentionRow,
  readoutRow,
  sectionLabel,
  sectionRow,
} from './instrument';

export interface CrisisAlertRenderData {
  agencyName: string;
  agencyShortName: string;
  /** Etiqueta del momento (ej. "lun 18 may · 1:42 p.m. AST"). */
  detectedAtLabel: string;
  /** Día calendario AST sobre el que se computó la crisis (ej. "18 mayo"). */
  triggerDayLabel: string;

  band: 'NORMAL' | 'ELEVADO' | 'ALERTA' | 'CRISIS';

  /** Indicadores del bloque numérico. Se renderizan como tarjetas. */
  metrics: {
    crisisRiskScore: number;
    crisisRiskScore24hAgo: number | null;
    crisisSeverity: number;
    /**
     * Display del tile "Velocidad": cambio % del volumen de HOY (día parcial
     * en curso) vs el promedio de los 7 días previos AL MISMO CORTE HORARIO
     * (decisión ago 2026 — la crisisVelocity interna, clamp del z-score, se
     * leía como "0%" en crisis sin pico de volumen; la fórmula del score NO
     * cambió, solo lo que se muestra). null cuando no hay historial suficiente.
     */
    volumeVsAvg7Pct: number | null;
  };

  /** Conteo del día detonante + comparación. */
  volume: {
    totalMentions: number;
    negativeCount: number;
    negativeShare: number;
    prevDayTotal: number | null;
    prevDayNegative: number | null;
  };

  /** Top 3 tópicos con concentración negativa (ordenados por share). */
  topNegativeTopics: Array<{
    topic: string;
    total: number;
    negative: number;
    negativeShare: number;
  }>;

  /** Top 3 municipios con concentración negativa. */
  topNegativeMunicipalities: Array<{
    municipality: string;
    total: number;
    negative: number;
  }>;

  /** Voces destacadas (4–6 menciones negativas representativas con link). */
  highlightedMentions: Array<{
    sourceLabel: string;
    snippet: string;
    url: string | null;
    publishedAtLabel: string;
    /** Opcional: og:image scrappeada de la URL. Si falta, se renderiza sin foto. */
    imageUrl?: string | null;
  }>;

  /**
   * Legado: PNG de QuickChart. Desde el cromo Instrumento (sep 2026) la
   * evolución se dibuja con tablas HTML desde `scoreTrend`; se ignora.
   */
  scoreTrendImageUrl?: string;
  /**
   * Crisis Score de los últimos días (hasta 14), en escala pública 0–100,
   * del más viejo al más nuevo. Con menos de 2 puntos el bloque se oculta.
   */
  scoreTrend?: Array<{ label: string; score: number }>;
  /** Umbral de la banda ALERTA en escala 0–100 (default 40). */
  scoreThreshold?: number;

  /**
   * Imagen "hero" del periodo. Se obtiene scrappeando el og:image de la
   * mención más relevante (top engagement entre las negativas). Si ninguna
   * mención expone una imagen utilizable, se deja vacío y se oculta el bloque.
   */
  heroImageUrl?: string | null;
  /** Pie de foto opcional (ej. "Captura · ElNuevoDia.com · 18 may"). */
  heroImageCaption?: string | null;

  /** Salida editorial del LLM. */
  editorial: {
    headline: string;
    lede: string;
    bodyParagraphsHtml: string[];
    representativeVoices: Array<{
      quote: string;
      attribution: string;
      tone: 'negative' | 'neutral' | 'positive';
    }>;
    drivers: Array<{ label: string; description: string }>;
    closing: string;
  };

  /**
   * Contexto del episodio cuando el correo es un REAVISO (COR-02): desde
   * cuándo está abierto y qué cambió desde el aviso anterior. Ausente en el
   * primer aviso — el correo sale igual que siempre.
   */
  episode?: CrisisEpisodeRenderContext | null;

  /** URL a la vista de crisis de la agencia (Overview con el detalle de riesgo abierto). */
  dashboardUrl: string;
}

/** Una lectura del episodio: las cifras del día en que salió un aviso. */
export interface CrisisEpisodeReading {
  /** Día al que pertenecen las cifras ("18 nov"). */
  dayLabel: string;
  /** Crisis score 0–1. */
  score: number;
  totalMentions: number;
  negativeCount: number;
}

export interface CrisisEpisodeRenderContext {
  /** Número de este aviso dentro del episodio (2 = primer reaviso). */
  alertNumber: number;
  /** Cuándo salió el primer aviso ("16 nov, 2:10 p.m."). */
  openedAtLabel: string;
  /** Días calendario abierto, contando el de apertura. */
  daysOpen: number;
  /** Cuándo salió el aviso anterior ("17 nov, 2:15 p.m."). */
  previousAtLabel: string;
  previous: CrisisEpisodeReading;
  current: CrisisEpisodeReading;
  /** Lectura más alta del episodio hasta ahora (incluye la actual). */
  peak: { score: number; dayLabel: string };
}

export interface CrisisCloseRenderData {
  agencyName: string;
  agencyShortName: string;
  /** Momento del cierre ("21 nov · 8:05 a.m. AST"). */
  closedAtLabel: string;
  /** Cuándo salió el primer aviso del episodio. */
  openedAtLabel: string;
  /** Días calendario del episodio: del primer aviso al último día sobre el umbral o con aviso. */
  daysOpen: number;
  /** Avisos enviados durante el episodio. */
  alertsSent: number;
  /** El día cerrado que terminó bajo el umbral. */
  closedDay: {
    dayLabel: string;
    /** null = ese día no tuvo menciones suficientes para calcular el índice. */
    score: number | null;
    severity: number | null;
    totalMentions: number;
    negativeCount: number;
  };
  peak: { score: number; dayLabel: string };
  /** Umbral de la regla en escala interna 0–1 (0.40). */
  threshold: number;
  /** Severidad mínima de la regla (0 = no aplica). */
  severityMin: number;
  /** Titular del primer aviso, para que el lector reconozca de qué episodio se trata. */
  firstHeadline?: string | null;
  scoreTrend?: Array<{ label: string; score: number }>;
  dashboardUrl: string;
}
// ------------------------------------------------------------
// Banda → estado
// ------------------------------------------------------------

type Band = CrisisAlertRenderData['band'];

function bandColor(band: Band): string {
  if (band === 'CRISIS' || band === 'ALERTA') return T.crisis;
  if (band === 'ELEVADO') return T.warn;
  return T.ink;
}

function bandLabelEs(band: Band): string {
  if (band === 'CRISIS') return 'Crisis';
  if (band === 'ALERTA') return 'Alerta';
  if (band === 'ELEVADO') return 'Elevado';
  return 'Normal';
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

// ------------------------------------------------------------
// Secciones
// ------------------------------------------------------------

function renderReadouts(data: CrisisAlertRenderData, accent: string): string {
  const m = data.metrics;
  // Mismas representaciones que el dashboard: el score vía formatMetric; los
  // subcomponentes 0–1 como %. "Velocidad" = cambio % de volumen a esta hora
  // vs el promedio de 7 días al mismo corte (la crisisVelocity interna se
  // leía como "0%" sin pico).
  const velocity = m.volumeVsAvg7Pct == null
    ? '—'
    : `${m.volumeVsAvg7Pct > 0 ? '+' : m.volumeVsAvg7Pct < 0 ? '−' : ''}${Math.abs(m.volumeVsAvg7Pct)}%`;
  return readoutRow([
    {
      label: 'Crisis score',
      valueHtml: `<span style="color:${accent};font-weight:600;">${esc(formatMetric('crisis', m.crisisRiskScore).value || '—')}</span>`,
      hintHtml: m.crisisRiskScore24hAgo == null ? 'sin base 24 h' : `hace 24 h: ${esc(fmtPct(m.crisisRiskScore24hAgo))}`,
    },
    { label: 'Severidad', valueHtml: esc(fmtPct(m.crisisSeverity)), hintHtml: 'negativas, solas y frente a lo usual' },
    {
      label: 'Velocidad',
      valueHtml: esc(velocity),
      hintHtml: m.volumeVsAvg7Pct == null ? 'sin historial suficiente' : 'vs promedio 7 días',
    },
  ]);
}

function renderVolumeBand(data: CrisisAlertRenderData): string {
  const v = data.volume;
  const prev = v.prevDayTotal != null
    ? ` · día previo ${fmtInt(v.prevDayTotal)} / ${fmtInt(v.prevDayNegative ?? 0)} neg.`
    : '';
  return sectionRow(
    `<div style="font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${T.text2};">${fmtInt(v.totalMentions)} menciones · <span style="color:${T.neg};">${fmtInt(v.negativeCount)} negativas (${esc(fmtPct(v.negativeShare))})</span>${esc(prev)}</div>`,
    { padding: '14px 32px', bg: T.subtle },
  );
}

function renderHero(data: CrisisAlertRenderData): string {
  const img = heroImage(data.heroImageUrl ? { url: data.heroImageUrl, alt: data.editorial.headline, caption: data.heroImageCaption } : null);
  return img ? sectionRow(img, { padding: '24px 32px 14px 32px' }) : '';
}

/**
 * Evolución del score: columnas grises; las que cruzan el umbral (que es el
 * de la banda ALERTA) van en rojo siempre —aunque HOY la banda sea normal,
 * ese día sí cruzó— y la de hoy se resalta. Solo se rotulan la primera, la
 * última y las que cruzan, para que 14 fechas quepan a 536 px.
 */
function renderTrend(data: { scoreTrend?: Array<{ label: string; score: number }>; scoreThreshold?: number }): string {
  const pts = (data.scoreTrend ?? []).slice(-14);
  if (pts.length < 2) return '';
  const thr = data.scoreThreshold ?? 40;
  const last = pts.length - 1;
  const alt = `Crisis score de los últimos ${pts.length} días (umbral ${thr}%): ` +
    pts.map((p) => `${p.label}: ${p.score}%`).join('; ');
  const chart = columnChart(
    pts.map((p, i) => {
      const over = p.score >= thr;
      return {
        label: i === 0 || i === last ? p.label : '',
        emphasis: i === last,
        totalLabel: i === last || over ? `${p.score}%` : '',
        segments: [{ value: p.score, color: over ? T.crisis : T.ref }],
      };
    }),
    { height: 90, barWidth: 22, alt },
  );
  return sectionRow(`
              ${sectionLabel(`Crisis score · últimos ${pts.length} días`)}
              ${chart}
              <div style="margin-top:8px;font-family:${FONT_MONO};font-size:11px;line-height:1.5;color:${T.text2};">En rojo, los días en o sobre el umbral de ${thr}%.</div>`);
}

/** "+9 pts" / "−22 pts" / "sin cambio", en mono. `worseWhenUp` pinta de rojo las subidas. */
function ptsChange(cur: number, prev: number): string {
  const d = Math.round(cur * 100) - Math.round(prev * 100);
  if (d === 0) return `<span style="color:${T.text2};">sin cambio</span>`;
  const color = d > 0 ? T.neg : T.pos;
  return `<span style="color:${color};">${d > 0 ? '+' : '−'}${Math.abs(d)} pts</span>`;
}

function countChange(cur: number, prev: number): string {
  const d = cur - prev;
  if (d === 0) return `<span style="color:${T.text2};">sin cambio</span>`;
  return `<span style="color:${T.text2};">${d > 0 ? '+' : '−'}${fmtInt(Math.abs(d))}</span>`;
}

function negShare(r: CrisisEpisodeReading): number {
  return r.totalMentions > 0 ? r.negativeCount / r.totalMentions : 0;
}

/**
 * Reaviso: desde cuándo está abierto el episodio y qué cambió desde el aviso
 * anterior. Las cifras de cada columna son las del día de ese aviso (parcial
 * a la hora en que salió), por eso la nota al pie nombra los dos días cuando
 * no coinciden.
 */
function renderEpisode(data: CrisisAlertRenderData): string {
  const ep = data.episode;
  if (!ep) return '';
  const { previous: prev, current: cur } = ep;
  const sameDay = prev.dayLabel === cur.dayLabel;
  const table = compareTable({
    headers: ['Desde el aviso anterior', 'Ahora', 'Aviso anterior', 'Cambio'],
    rows: [
      { labelHtml: 'Crisis score', cur: esc(fmtPct(cur.score)), prev: esc(fmtPct(prev.score)), changeHtml: ptsChange(cur.score, prev.score), strong: true },
      { labelHtml: 'Menciones del día', cur: fmtInt(cur.totalMentions), prev: fmtInt(prev.totalMentions), changeHtml: countChange(cur.totalMentions, prev.totalMentions) },
      { labelHtml: 'Negativas', cur: fmtInt(cur.negativeCount), prev: fmtInt(prev.negativeCount), changeHtml: countChange(cur.negativeCount, prev.negativeCount) },
      { labelHtml: 'Proporción negativa', cur: esc(fmtPct(negShare(cur))), prev: esc(fmtPct(negShare(prev))), changeHtml: ptsChange(negShare(cur), negShare(prev)) },
    ],
  });
  const peakIsNow = Math.round(ep.peak.score * 100) <= Math.round(cur.score * 100);
  const peak = peakIsNow
    ? 'Esta es la lectura más alta del episodio.'
    : `La lectura más alta del episodio fue ${fmtPct(ep.peak.score)} (${ep.peak.dayLabel}).`;
  const days = sameDay
    ? `Las dos lecturas son del ${cur.dayLabel}, cada una a la hora de su aviso.`
    : `Cada lectura es la del día de su aviso: ${prev.dayLabel} y ${cur.dayLabel} (día en curso).`;
  return sectionRow(`
              ${sectionLabel(`Episodio abierto · aviso n.º ${ep.alertNumber}`)}
              <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:${T.ink};">Abierto desde el <strong style="font-weight:600;">${esc(ep.openedAtLabel)}</strong> (${esc(daysLabelEs(ep.daysOpen))}). El aviso anterior salió el ${esc(ep.previousAtLabel.replace(/\.$/, ''))}.</p>
              ${table}
              <div style="margin-top:10px;font-family:${FONT_MONO};font-size:11px;line-height:1.5;color:${T.text2};">${esc(peak)} ${esc(days)}</div>`);
}

function renderDrivers(data: CrisisAlertRenderData): string {
  const drivers = data.editorial.drivers.slice(0, 3);
  const list = drivers.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${drivers.map((d, i) => `<tr>
                  <td valign="top" width="24" style="width:24px;padding:6px 0;font-family:${FONT_MONO};font-size:14px;line-height:1.5;color:${T.text3};">${i + 1}</td>
                  <td valign="top" style="padding:6px 0;font-size:14px;line-height:1.5;color:${T.ink};"><strong style="font-weight:600;">${esc(d.label)}.</strong> ${esc(d.description)}</td>
                </tr>`).join('')}
              </table>`
    : '';
  const paragraphs = data.editorial.bodyParagraphsHtml
    .filter((p) => p && p.trim().length > 0)
    .slice(0, 4)
    .map((p) => `<p style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:${T.ink2};">${p}</p>`)
    .join('');
  if (!list && !paragraphs) return '';
  return sectionRow(`
              ${sectionLabel('01 · Qué lo está empujando')}
              ${list}
              ${paragraphs}`);
}

function renderVoices(data: CrisisAlertRenderData): string {
  const voices = (data.editorial.representativeVoices ?? []).slice(0, 3);
  if (!voices.length) return '';
  const rows = voices.map((v, i) => {
    const b = i === voices.length - 1 ? '' : `border-bottom:1px solid ${T.line};`;
    return `<tr><td style="padding:12px 0;${b}">
                  <div style="font-size:15px;line-height:1.5;color:${T.ink};">«${esc(v.quote)}»</div>
                  <div style="margin-top:6px;font-family:${FONT_MONO};font-size:12px;color:${T.text2};">${esc(v.attribution)}</div>
                </td></tr>`;
  }).join('');
  return sectionRow(`
              ${sectionLabel('02 · Voces representativas')}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`);
}

function renderSources(data: CrisisAlertRenderData): string {
  const items = data.highlightedMentions.slice(0, 6);
  const body = items.length
    ? items.map((m, i) => mentionRow({
        meta: `${m.sourceLabel} · ${m.publishedAtLabel}`,
        text: m.snippet,
        url: m.url,
        imageUrl: m.imageUrl,
        last: i === items.length - 1,
      })).join('')
    : `<div style="font-size:13px;color:${T.text2};">Sin menciones negativas representativas en el periodo.</div>`;
  return sectionRow(`
              ${sectionLabel('03 · Enlaces y fuentes')}
              ${body}`);
}

function renderContext(data: CrisisAlertRenderData): string {
  const closing = (data.editorial.closing ?? '').trim();
  if (!closing) return '';
  return sectionRow(`
              ${sectionLabel('Contexto')}
              <p style="margin:0;font-size:14px;line-height:1.55;color:${T.ink2};">${esc(closing)}</p>`,
    { padding: '20px 32px', bg: T.subtle });
}

// ------------------------------------------------------------
// Render principal
// ------------------------------------------------------------

export function renderCrisisAlertHtml(data: CrisisAlertRenderData): string {
  const accent = bandColor(data.band);
  const scoreStr = formatMetric('crisis', data.metrics.crisisRiskScore).value || '—';
  const lede = (data.editorial.lede ?? '').trim();

  const contentRows = [
    renderReadouts(data, accent),
    renderVolumeBand(data),
    renderEpisode(data),
    renderHero(data),
    renderTrend(data),
    renderDrivers(data),
    renderVoices(data),
    renderSources(data),
    renderContext(data),
    actionRow(data.dashboardUrl, 'Abrir la vista de crisis'),
  ].filter(Boolean).join('\n');

  return instrumentDocument({
    title: `${bandLabelEs(data.band)} · ${data.agencyShortName} · ${data.triggerDayLabel}`,
    preheader: `${bandLabelEs(data.band)} · riesgo de crisis ${scoreStr} · ${fmtInt(data.volume.totalMentions)} menciones, ${fmtPct(data.volume.negativeShare)} negativas · ${data.editorial.headline}`,
    kind: 'crisis',
    tagText: `${bandLabelEs(data.band).toUpperCase()} · ${scoreStr}`,
    // CRISIS en sólido; ALERTA y ELEVADO en contorno (menos peso, mismo dato).
    tagState: { variant: data.band === 'CRISIS' ? 'solid' : 'outline', color: accent },
    heading: {
      kicker: data.episode
        ? `${data.agencyShortName} · Detección de crisis · Reaviso`
        : `${data.agencyShortName} · Detección de crisis`,
      title: data.editorial.headline,
      meta: data.episode
        ? `Detectado ${data.detectedAtLabel} · día detonante ${data.triggerDayLabel} · episodio abierto hace ${daysLabelEs(data.episode.daysOpen)}`
        : `Detectado ${data.detectedAtLabel} · día detonante ${data.triggerDayLabel}`,
      extraHtml: lede ? `<p style="margin:14px 0 0 0;font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:${T.ink2};">${esc(lede)}</p>` : '',
    },
    contentRows,
  });
}

// ------------------------------------------------------------
// Correo de cierre del episodio (COR-02)
// ------------------------------------------------------------

/**
 * Por qué se cerró, en una oración. El episodio cierra cuando el último día
 * completo dejó de cumplir la regla: casi siempre porque el índice bajó del
 * umbral; a veces el índice sigue arriba pero la severidad cayó bajo su mínimo.
 */
export function crisisCloseReason(data: Pick<CrisisCloseRenderData, 'closedDay' | 'threshold' | 'severityMin'>): string {
  const c = data.closedDay;
  const thr = fmtPct(data.threshold);
  if (c.score == null) {
    return `El ${c.dayLabel} no hubo conversación suficiente para calcular el índice (${fmtInt(c.totalMentions)} menciones).`;
  }
  if (Math.round(c.score * 100) < Math.round(data.threshold * 100)) {
    return `El ${c.dayLabel} cerró con el riesgo de crisis en ${fmtPct(c.score)}, bajo el umbral de ${thr}.`;
  }
  return `El ${c.dayLabel} cerró con el riesgo de crisis en ${fmtPct(c.score)}, pero con la severidad en ${fmtPct(c.severity)}, bajo el mínimo de ${fmtPct(data.severityMin)} que exige la regla.`;
}

export function crisisCloseHeadline(): string {
  return 'El episodio de crisis se cerró';
}

/**
 * Correo de cierre: sale una vez, cuando el último día completo terminó bajo
 * el umbral. No lleva texto de modelo: todo son cifras guardadas del episodio.
 */
export function renderCrisisCloseHtml(data: CrisisCloseRenderData): string {
  const c = data.closedDay;
  const reason = crisisCloseReason(data);
  const scoreStr = c.score == null ? '—' : fmtPct(c.score);
  const avisos = data.alertsSent === 1 ? '1 aviso' : `${data.alertsSent} avisos`;
  const share = c.totalMentions > 0 ? c.negativeCount / c.totalMentions : 0;

  const readouts = readoutRow([
    { label: `Cierre del ${c.dayLabel}`, valueHtml: esc(scoreStr), hintHtml: `umbral ${esc(fmtPct(data.threshold))}` },
    { label: 'Lectura más alta', valueHtml: `<span style="color:${T.crisis};font-weight:600;">${esc(fmtPct(data.peak.score))}</span>`, hintHtml: esc(data.peak.dayLabel) },
    { label: 'Duración', valueHtml: esc(daysLabelEs(data.daysOpen)), hintHtml: esc(avisos) },
  ]);
  const volume = sectionRow(
    `<div style="font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${T.text2};">${esc(c.dayLabel)} · ${fmtInt(c.totalMentions)} menciones · ${fmtInt(c.negativeCount)} negativas (${esc(fmtPct(share))})</div>`,
    { padding: '14px 32px', bg: T.subtle },
  );
  const about = data.firstHeadline
    ? sectionRow(`
              ${sectionLabel('El episodio')}
              <p style="margin:0;font-size:14px;line-height:1.55;color:${T.ink2};">Se abrió el ${esc(data.openedAtLabel)} con este aviso: «${esc(data.firstHeadline)}».</p>`)
    : '';
  const note = sectionRow(`
              ${sectionLabel('Qué sigue')}
              <p style="margin:0;font-size:14px;line-height:1.55;color:${T.ink2};">Este es el último correo del episodio. Si el índice vuelve a cruzar el umbral se abre un episodio nuevo y llega un primer aviso.</p>`,
    { padding: '20px 32px', bg: T.subtle });

  const contentRows = [
    readouts,
    volume,
    about,
    renderTrend({ scoreTrend: data.scoreTrend, scoreThreshold: Math.round(data.threshold * 100) }),
    note,
    actionRow(data.dashboardUrl, 'Abrir la vista de crisis'),
  ].filter(Boolean).join('\n');

  return instrumentDocument({
    title: `Episodio cerrado · ${data.agencyShortName} · ${c.dayLabel}`,
    preheader: `${reason} Estuvo abierto ${daysLabelEs(data.daysOpen)} y tuvo ${avisos}.`,
    kind: 'crisis',
    tagText: 'EPISODIO CERRADO',
    // Contorno grafito: el estado ya no es de alarma, así que no lleva rojo.
    tagState: { variant: 'outline', color: T.ink },
    heading: {
      kicker: `${data.agencyShortName} · Detección de crisis · Cierre`,
      title: crisisCloseHeadline(),
      meta: `Cerrado ${data.closedAtLabel} · abierto desde el ${data.openedAtLabel}`,
      extraHtml: `<p style="margin:14px 0 0 0;font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:${T.ink2};">${esc(reason)} Estuvo abierto ${esc(daysLabelEs(data.daysOpen))} y tuvo ${esc(avisos)}.</p>`,
    },
    contentRows,
  });
}
