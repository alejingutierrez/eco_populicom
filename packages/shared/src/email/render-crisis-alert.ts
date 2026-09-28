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
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionRow,
  columnChart,
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

  /** URL al Overview de la agencia en el dashboard (misma que diario/semanal). */
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
    { label: 'Severidad', valueHtml: esc(fmtPct(m.crisisSeverity)), hintHtml: 'concentración negativa' },
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
function renderTrend(data: CrisisAlertRenderData): string {
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
    renderHero(data),
    renderTrend(data),
    renderDrivers(data),
    renderVoices(data),
    renderSources(data),
    renderContext(data),
    actionRow(data.dashboardUrl, 'Abrir la crisis en el dashboard'),
  ].filter(Boolean).join('\n');

  return instrumentDocument({
    title: `${bandLabelEs(data.band)} · ${data.agencyShortName} · ${data.triggerDayLabel}`,
    preheader: `${bandLabelEs(data.band)} · riesgo de crisis ${scoreStr} · ${fmtInt(data.volume.totalMentions)} menciones, ${fmtPct(data.volume.negativeShare)} negativas · ${data.editorial.headline}`,
    kind: 'crisis',
    tagText: `${bandLabelEs(data.band).toUpperCase()} · ${scoreStr}`,
    // CRISIS en sólido; ALERTA y ELEVADO en contorno (menos peso, mismo dato).
    tagState: { variant: data.band === 'CRISIS' ? 'solid' : 'outline', color: accent },
    heading: {
      kicker: `${data.agencyShortName} · Detección de crisis`,
      title: data.editorial.headline,
      meta: `Detectado ${data.detectedAtLabel} · día detonante ${data.triggerDayLabel}`,
      extraHtml: lede ? `<p style="margin:14px 0 0 0;font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:${T.ink2};">${esc(lede)}</p>` : '',
    },
    contentRows,
  });
}
