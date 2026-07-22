/**
 * Template HTML del correo editorial de alerta de crisis.
 *
 * Diseño: estilo "briefing nocturno" — titular factual, sumario, 2–3
 * párrafos descriptivos, indicadores cuantitativos, drivers, tópicos y
 * voces. Misma paleta que el reporte semanal para no fragmentar la
 * identidad visual de la marca ECO.
 *
 * Compatibilidad: inline styles + tablas (Gmail, Outlook, Apple Mail).
 * El mini-chart de evolución del Crisis Score se sirve como PNG externo
 * de QuickChart, igual que en el semanal.
 */

import { formatMetric } from '../format/metrics-display';
import {
  EMAIL_COLORS,
  esc,
  fmtInt,
  indicatorTileNum,
  blockHeader,
  emailDocument,
} from './chrome';

export interface CrisisAlertRenderData {
  agencyName: string;
  agencyShortName: string;
  /** Etiqueta del momento (ej. "lun 18 may · 1:42 p.m. AST"). */
  detectedAtLabel: string;
  /** Día calendario AST sobre el que se computó la crisis (ej. "18 mayo"). */
  triggerDayLabel: string;

  band: 'NORMAL' | 'ELEVADO' | 'ALERTA' | 'CRISIS';

  /** Indicadores 0–1. Se renderizan como tarjetas. */
  metrics: {
    crisisRiskScore: number;
    crisisRiskScore24hAgo: number | null;
    crisisSeverity: number;
    crisisVelocity: number;
    crisisRelevance: number;
    volumeAnomalyZscore: number | null;
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
   * URL de un PNG con la evolución del Crisis Score los últimos 14 días.
   * Si no hay datos suficientes, queda vacío y el template oculta el bloque.
   */
  scoreTrendImageUrl: string;

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

  /** URL al dashboard (deeplink al overview de crisis de la agencia). */
  dashboardUrl: string;
}

// ------------------------------------------------------------
// Paleta — alineada con render-weekly-report.ts para coherencia de marca
// ------------------------------------------------------------

// Paleta = chrome compartido + alias local para la banda NORMAL (azul marca).
const COLORS = { ...EMAIL_COLORS, normal: EMAIL_COLORS.brand };

function bandColor(band: CrisisAlertRenderData['band']): string {
  if (band === 'CRISIS') return COLORS.crisis;
  if (band === 'ALERTA') return COLORS.alerta;
  if (band === 'ELEVADO') return COLORS.elevado;
  return COLORS.normal;
}

function bandLabelEs(band: CrisisAlertRenderData['band']): string {
  if (band === 'CRISIS') return 'Crisis';
  if (band === 'ALERTA') return 'Alerta';
  if (band === 'ELEVADO') return 'Elevado';
  return 'Normal';
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

/** Describe la anomalía de volumen en lenguaje llano (sin z-scores ni σ). */
function volumeVsUsual(z: number | null): string {
  if (z == null) return 'sin referencia de volumen';
  if (z >= 2) return 'volumen muy sobre lo usual';
  if (z >= 1) return 'volumen sobre lo usual';
  if (z > -1) return 'volumen dentro de lo usual';
  return 'volumen bajo lo usual';
}

// ------------------------------------------------------------
// Pull-quote: la frase parafraseada del LLM con su atribución
// ------------------------------------------------------------

function pullQuote(
  quote: string,
  attribution: string,
  tone: 'negative' | 'neutral' | 'positive',
  isLast: boolean,
): string {
  const toneColor = tone === 'negative' ? COLORS.alerta
                  : tone === 'positive' ? '#1F8A47'
                  : COLORS.inkSoft;
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
  return `<tr>
    <td style="padding:18px 20px;${border}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="width:6px;padding-right:14px;">
            <div style="width:3px;background:${toneColor};height:100%;min-height:48px;border-radius:2px;"></div>
          </td>
          <td valign="top">
            <p class="force-text-dark" style="margin:0 0 8px 0;font-size:15px;line-height:1.55;color:${COLORS.ink};font-style:italic;letter-spacing:-0.005em;">
              &ldquo;${esc(quote)}&rdquo;
            </p>
            <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">
              ${esc(attribution)}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ------------------------------------------------------------
// Highlighted mention card — incluye thumbnail si imageUrl está presente
// ------------------------------------------------------------

function mentionCard(
  m: CrisisAlertRenderData['highlightedMentions'][number],
  isLast: boolean,
): string {
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
  const link = m.url
    ? `<a href="${esc(m.url)}" style="color:${COLORS.brand};text-decoration:none;font-size:11.5px;font-weight:600;">Ver mención →</a>`
    : '';
  const thumb = m.imageUrl
    ? `<td valign="top" style="width:76px;padding-right:14px;">
        <a href="${esc(m.url ?? '#')}" style="text-decoration:none;display:block;">
          <img src="${esc(m.imageUrl)}" alt="" width="76" height="76" style="display:block;width:76px;height:76px;object-fit:cover;border-radius:6px;border:1px solid ${COLORS.borderSoft};">
        </a>
      </td>`
    : '';
  return `<tr>
    <td style="padding:14px 16px;${border}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${thumb}
          <td valign="top">
            <div class="force-text-soft" style="font-size:10.5px;color:${COLORS.inkMute};letter-spacing:0.05em;text-transform:uppercase;font-weight:700;margin-bottom:4px;">
              ${esc(m.sourceLabel)} <span style="color:${COLORS.borderSoft};">·</span> ${esc(m.publishedAtLabel)}
            </div>
            <div class="force-text-dark" style="font-size:13px;line-height:1.55;color:${COLORS.ink};">
              ${esc(m.snippet)}
            </div>
            ${link ? `<div style="margin-top:6px;">${link}</div>` : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ------------------------------------------------------------
// Driver list — número en círculo a la izquierda + texto.
//
// Layout sin tabla anidada: usa un solo <td> con tabla interna de 2
// columnas anchas fijas para que Gmail respete el espaciado entre el
// círculo y el contenido (Gmail strippea muchos paddings cuando hay
// <td>s directos sin width explícito, dando lugar al efecto "número
// pegado al borde" del primer release).
// ------------------------------------------------------------

function driverItem(label: string, description: string, idx: number, total: number): string {
  const isLast = idx === total - 1;
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
  return `<tr>
    <td style="padding:16px 18px;${border}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" width="36" style="width:36px;padding-right:14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.alertSoft}" style="background:${COLORS.alertSoft};background-color:${COLORS.alertSoft};border-radius:14px;width:28px;height:28px;">
              <tr>
                <td align="center" valign="middle" width="28" height="28" style="width:28px;height:28px;text-align:center;vertical-align:middle;color:${COLORS.alerta};font-size:13px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;line-height:1;">
                  ${idx + 1}
                </td>
              </tr>
            </table>
          </td>
          <td valign="top">
            <div class="force-text-dark" style="font-size:13.5px;font-weight:700;color:${COLORS.ink};line-height:1.35;letter-spacing:-0.005em;">${esc(label)}</div>
            <div class="force-text-soft" style="font-size:12.5px;line-height:1.6;color:${COLORS.inkSoft};margin-top:4px;">${esc(description)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ------------------------------------------------------------
// Main render
// ------------------------------------------------------------

export function renderCrisisAlertHtml(data: CrisisAlertRenderData): string {
  const accent = bandColor(data.band);
  const m = data.metrics;
  const v = data.volume;

  const score24hHint = m.crisisRiskScore24hAgo == null
    ? 'sin baseline 24h'
    : `hace 24h: ${fmtPct(m.crisisRiskScore24hAgo)}`;

  // Mismas representaciones que el dashboard (@eco/shared/format): el Crisis
  // Score como % de riesgo (vía formatMetric, una sola fuente con el scorecard);
  // los subcomponentes 0–1 como % para no mostrar "0.42" crudo al público. La
  // banda ya sale como palabra (bandLabelEs ≡ NORMAL/ELEVADO/ALERTA/CRISIS).
  // Tres tiles a 33.33% para llenar la fila tras retirar "Relevancia"
  // (minuta 21-jul-2026: el tile de Relevancia se elimina del bloque numérico).
  const indicators = [
    indicatorTileNum('Crisis Score', formatMetric('crisis', m.crisisRiskScore).value || '—', accent, esc(score24hHint), '33.33%'),
    indicatorTileNum('Severidad', fmtPct(m.crisisSeverity), COLORS.alerta, 'concentración negativa', '33.33%'),
    indicatorTileNum('Velocidad', fmtPct(m.crisisVelocity), COLORS.elevado, esc(volumeVsUsual(m.volumeAnomalyZscore)), '33.33%'),
  ].join('');

  const volumeDeltaLine = v.prevDayTotal != null
    ? `${fmtInt(v.totalMentions)} menciones &nbsp;·&nbsp; <strong style="color:${COLORS.alerta};">${fmtInt(v.negativeCount)} negativas</strong> (${fmtPct(v.negativeShare)}). Día previo: ${fmtInt(v.prevDayTotal)} / ${fmtInt(v.prevDayNegative ?? 0)} neg.`
    : `${fmtInt(v.totalMentions)} menciones &nbsp;·&nbsp; <strong style="color:${COLORS.alerta};">${fmtInt(v.negativeCount)} negativas</strong> (${fmtPct(v.negativeShare)}).`;

  // NOTA (minuta 21-jul-2026): la sección "Dónde se concentra" (concentración
  // por tópico y municipio) se eliminó por completo del correo de crisis. Los
  // campos `topNegativeTopics` / `topNegativeMunicipalities` se conservan en la
  // interfaz por compatibilidad con el caller, pero ya no se renderizan.

  const drivers = data.editorial.drivers
    .slice(0, 3)
    .map((d, i, arr) => driverItem(d.label, d.description, i, arr.length))
    .join('');

  const mentionsRows = data.highlightedMentions.length > 0
    ? data.highlightedMentions
        .slice(0, 6)
        .map((m2, i, arr) => mentionCard(m2, i === arr.length - 1))
        .join('')
    : `<tr><td style="padding:18px;text-align:center;font-size:12.5px;color:${COLORS.inkMute};font-style:italic;">Sin menciones negativas representativas en el periodo.</td></tr>`;

  const bodyParagraphs = data.editorial.bodyParagraphsHtml
    .filter((p) => p && p.trim().length > 0)
    .slice(0, 4)
    .map(
      (p, i) => {
        // El primer párrafo es el "lede secundario" — un poco más grande
        // que los demás para abrir la lectura como un editorial de prensa.
        const size = i === 0 ? '14.5px' : '14px';
        const weight = i === 0 ? 500 : 400;
        return `<p class="force-text-dark" style="margin:0 0 12px 0;font-size:${size};line-height:1.65;color:${COLORS.ink};font-weight:${weight};">${p}</p>`;
      },
    )
    .join('');

  const voicesBlock = data.editorial.representativeVoices && data.editorial.representativeVoices.length > 0
    ? `<tr>
        <td class="px-32" style="padding:6px 32px 8px 32px;">
          <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">02b · Voces representativas</div>
          <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
            ${data.editorial.representativeVoices.slice(0, 3).map((v, i, arr) => pullQuote(v.quote, v.attribution, v.tone, i === arr.length - 1)).join('')}
          </table>
        </td>
      </tr>`
    : '';

  // Hero image (opcional): se renderiza después del lede como gancho visual.
  // Cuando no hay og:image utilizable, se omite y la jerarquía cae natural
  // sobre los indicadores.
  const heroImageBlock = data.heroImageUrl
    ? `<tr>
        <td class="px-32" style="padding:6px 32px 6px 32px;">
          <div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid ${COLORS.border};background:${COLORS.surface};">
            <img src="${esc(data.heroImageUrl)}" alt="${esc(data.editorial.headline)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;">
            ${data.heroImageCaption
              ? `<div class="force-text-soft" style="padding:8px 14px;font-size:11px;color:${COLORS.inkMute};letter-spacing:0.05em;line-height:1.5;border-top:1px solid ${COLORS.borderSoft};background:${COLORS.page};">
                  ${esc(data.heroImageCaption)}
                </div>`
              : ''}
          </div>
        </td>
      </tr>`
    : '';

  const trendBlock = data.scoreTrendImageUrl
    ? `<tr>
        <td class="px-32" style="padding:16px 32px 16px 32px;">
          <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">03 · Evolución del Crisis Score</div>
          <div style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;padding:14px;">
            <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.05em;margin-bottom:8px;">Últimos 14 días</div>
            <img src="${esc(data.scoreTrendImageUrl)}" alt="Evolución del Crisis Score" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;">
          </div>
        </td>
      </tr>`
    : '';

  // Botón CTA — markup único reutilizado arriba (parte superior) y al cierre
  // del Bloque 2 (minuta 21-jul-2026: repetir el CTA al final del correo).
  const ctaButton = `
          <!-- CTA · Ver detalle en el dashboard -->
          <tr>
            <td class="px-32" align="center" style="padding:14px 32px 26px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${COLORS.ink}" style="background:${COLORS.ink};background-color:${COLORS.ink};border-radius:6px;">
                    <a href="${esc(data.dashboardUrl)}" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">
                      Ver detalle en el dashboard →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

  const contentRows = `
          <!-- HERO (parte superior · sin cambios salvo el tamaño del título) -->
          <tr>
            <td class="px-32" style="padding:24px 32px 18px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyShortName)} · ${esc(data.agencyName)} · Detección de crisis
              </div>
              <h1 class="headline force-text-dark" style="margin:0 0 12px 0;color:${COLORS.ink};font-size:28px;line-height:1.22;font-weight:700;letter-spacing:-0.02em;">
                ${esc(data.editorial.headline)}
              </h1>
              <div class="force-text-mute" style="color:${COLORS.inkSoft};font-size:13px;line-height:1.55;">
                Detectado ${esc(data.detectedAtLabel)} &nbsp;·&nbsp; día detonante: ${esc(data.triggerDayLabel)}
              </div>
              <p class="force-text-dark" style="margin:14px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.ink};font-weight:500;">
                ${esc(data.editorial.lede)}
              </p>
            </td>
          </tr>

          ${heroImageBlock}

          <!-- CTA superior · atajo inmediato al dashboard -->
          ${ctaButton}

${blockHeader('1', 'Análisis numérico', 'Volumen y tendencias de la conversación', accent)}
          <!-- BLOQUE 1 · 01 · INDICADORES (Crisis Score · Severidad · Velocidad) -->
          <tr>
            <td class="px-32" style="padding:6px 32px 12px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">01 · Indicadores</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                <tr>${indicators}</tr>
              </table>
              <div class="force-text-soft" style="margin-top:14px;font-size:12px;color:${COLORS.inkMute};line-height:1.55;">
                ${volumeDeltaLine}
              </div>
            </td>
          </tr>

${blockHeader('2', 'Detalle de la crisis', 'Qué está pasando, evolución del Crisis Score y fuentes', accent)}
          <!-- BLOQUE 2 · 02 · ¿QUÉ ESTÁ PASANDO? — cuantitativo (bullets) + cualitativo -->
          <tr>
            <td class="px-32" style="padding:6px 32px 4px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">02 · ¿Qué está pasando?</div>
              <div class="force-text-soft" style="font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">Qué lo está empujando</div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                ${drivers}
              </table>
            </td>
          </tr>
          <tr>
            <td class="px-32" style="padding:14px 32px 4px 32px;">
              ${bodyParagraphs}
            </td>
          </tr>

          ${voicesBlock}

          <!-- BLOQUE 2 · 03 · EVOLUCIÓN DEL CRISIS SCORE -->
          ${trendBlock}

          <!-- BLOQUE 2 · 04 · ENLACES Y FUENTES — la lista cruda con thumbnails -->
          <tr>
            <td class="px-32" style="padding:14px 32px 8px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">04 · Enlaces y fuentes</div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                ${mentionsRows}
              </table>
            </td>
          </tr>

          <!-- BLOQUE 2 · CONTEXTO DEL MOMENTO -->
          <tr>
            <td class="px-32" style="padding:18px 32px 10px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.alertSofter}" style="background:${COLORS.alertSofter};background-color:${COLORS.alertSofter};border:1px solid ${COLORS.alertSoft};border-radius:8px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div class="force-text-soft" style="font-size:10.5px;font-weight:700;color:${accent};letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;">Contexto del momento</div>
                    <div class="force-text-dark" style="font-size:13.5px;line-height:1.6;color:${COLORS.ink};">${esc(data.editorial.closing)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA repetido · cierre del Bloque 2 -->
          ${ctaButton}

`;

  return emailDocument({
    title: `${bandLabelEs(data.band)} · ${data.agencyShortName} · ${data.triggerDayLabel}`,
    preheader: `${bandLabelEs(data.band)} · ${data.agencyShortName} · ${data.editorial.headline}`,
    kind: 'crisis',
    // El badge y la barra superior llevan la BANDA (Crisis/Alerta/Elevado) con
    // su color de severidad — más específico que la etiqueta genérica del tipo.
    badge: { label: bandLabelEs(data.band), color: accent },
    contentRows,
  });
}
