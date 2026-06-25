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

const COLORS = {
  page: '#F5F6F8',
  surface: '#FFFFFF',
  border: '#E6E8EC',
  borderSoft: '#EEF0F4',

  ink: '#0E1E2C',
  inkSoft: '#4A5563',
  inkMute: '#8A93A0',

  brand: '#0A7EA4',
  brandSoft: '#E6F1F7',
  accent: '#F4C300',

  // Banda de severidad (toda la jerarquía visual de la alerta)
  crisis: '#A6321F',         // rojo más oscuro/serio para banda CRISIS
  alerta: '#C8462F',         // rojo "neg" del semanal
  elevado: '#D97706',        // ámbar
  normal: '#0A7EA4',         // azul de marca

  alertSoft: '#FBE9E5',
  alertSofter: '#FFF4F1',
};

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

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtInt(n: number): string {
  return n.toLocaleString('es-PR');
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

function fmtZ(n: number | null): string {
  if (n == null) return '—';
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}σ`;
}

// ------------------------------------------------------------
// Indicator tile — 4 columnas en una fila, ancho ~25%
// ------------------------------------------------------------

function indicatorTile(label: string, value: string, accentColor: string, hint: string): string {
  return `<td class="stack stack-pad" valign="top" width="25%" style="padding:0 4px;">
    <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border-radius:8px;border:1px solid ${COLORS.border};">
      <tr>
        <td valign="top" style="padding:14px 14px 12px 14px;">
          <div class="force-text-soft" style="font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.1em;text-transform:uppercase;">${esc(label)}</div>
          <div class="force-text-dark" style="font-size:26px;line-height:1.1;font-weight:700;color:${accentColor};margin-top:8px;letter-spacing:-0.02em;">${esc(value)}</div>
          <div class="force-text-soft" style="margin-top:6px;font-size:11px;color:${COLORS.inkMute};line-height:1.4;">${esc(hint)}</div>
        </td>
      </tr>
    </table>
  </td>`;
}

// ------------------------------------------------------------
// Concentración: una fila por concepto (tópico o municipio). Layout:
// kicker | nombre | barra horizontal | conteo y %. Stacked verticalmente
// para evitar la asimetría visual que producía el grid de 2 columnas
// cuando las cuentas de cada lado eran desiguales.
// ------------------------------------------------------------

function concentrationRow(
  kind: 'TÓPICO' | 'MUNICIPIO',
  name: string,
  negative: number,
  total: number,
  share: number,
  isLast: boolean,
): string {
  const pct = Math.round(share * 100);
  // Barra: ancho proporcional al share. Min 4% para que siempre se vea algo.
  const barWidth = Math.max(4, pct);
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
  return `<tr>
    <td style="padding:14px 16px;${border}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top">
            <div class="force-text-soft" style="font-size:10px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px;">${esc(kind)}</div>
            <div class="force-text-dark" style="font-size:14px;font-weight:600;color:${COLORS.ink};line-height:1.3;">${esc(name)}</div>
          </td>
          <td align="right" valign="top" style="white-space:nowrap;padding-left:12px;">
            <div class="force-text-dark" style="font-size:18px;font-weight:700;color:${COLORS.alerta};line-height:1;letter-spacing:-0.01em;">${pct}%</div>
            <div class="force-text-soft" style="margin-top:3px;font-size:11px;color:${COLORS.inkMute};">${fmtInt(negative)} de ${fmtInt(total)} negativas</div>
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-collapse:separate;border-radius:3px;overflow:hidden;background:${COLORS.borderSoft};">
        <tr>
          <td bgcolor="${COLORS.alerta}" style="background:${COLORS.alerta};background-color:${COLORS.alerta};width:${barWidth}%;height:6px;line-height:6px;font-size:0;padding:0;">&nbsp;</td>
          <td style="width:${100 - barWidth}%;height:6px;line-height:6px;font-size:0;padding:0;background:${COLORS.borderSoft};">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>`;
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
  const indicators = [
    indicatorTile('Crisis Score', formatMetric('crisis', m.crisisRiskScore).value || '—', accent, score24hHint),
    indicatorTile('Severidad', fmtPct(m.crisisSeverity), COLORS.alerta, 'concentración negativa'),
    indicatorTile('Velocidad', fmtPct(m.crisisVelocity), COLORS.elevado, `volumen ${fmtZ(m.volumeAnomalyZscore)}`),
    indicatorTile('Relevancia', fmtPct(m.crisisRelevance), COLORS.brand, 'pertinencia alta'),
  ].join('');

  const volumeDeltaLine = v.prevDayTotal != null
    ? `${fmtInt(v.totalMentions)} menciones &nbsp;·&nbsp; <strong style="color:${COLORS.alerta};">${fmtInt(v.negativeCount)} negativas</strong> (${fmtPct(v.negativeShare)}). Día previo: ${fmtInt(v.prevDayTotal)} / ${fmtInt(v.prevDayNegative ?? 0)} neg.`
    : `${fmtInt(v.totalMentions)} menciones &nbsp;·&nbsp; <strong style="color:${COLORS.alerta};">${fmtInt(v.negativeCount)} negativas</strong> (${fmtPct(v.negativeShare)}).`;

  // Concentración: un solo bloque vertical con tópicos + municipios. Ordenado
  // por share descendente. Cada tipo se mantiene en un sub-bloque separado
  // visualmente con su propio kicker para no fragmentar lectura.
  const topicConcentrationItems = data.topNegativeTopics
    .slice(0, 3)
    .map((t, i, arr) => concentrationRow('TÓPICO', t.topic, t.negative, t.total, t.negativeShare, i === arr.length - 1));
  const muniConcentrationItems = data.topNegativeMunicipalities
    .slice(0, 3)
    .map((mu, i, arr) => {
      const share = mu.total > 0 ? mu.negative / mu.total : 0;
      return concentrationRow('MUNICIPIO', mu.municipality, mu.negative, mu.total, share, i === arr.length - 1);
    });

  const topicsBlock = topicConcentrationItems.length > 0
    ? `<table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;margin-bottom:12px;">
        ${topicConcentrationItems.join('')}
      </table>`
    : `<div class="force-text-soft" style="padding:14px 16px;font-size:12px;color:${COLORS.inkMute};font-style:italic;background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;margin-bottom:12px;">Sin concentración por tópico medible.</div>`;

  const muniBlock = muniConcentrationItems.length > 0
    ? `<table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
        ${muniConcentrationItems.join('')}
      </table>`
    : '';

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
        <td class="px-32" style="padding:6px 32px 16px 32px;">
          <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.inkMute};margin-bottom:8px;">Evolución del Crisis Score · últimos 14 días</div>
          <div style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;padding:14px;">
            <img src="${esc(data.scoreTrendImageUrl)}" alt="Evolución del Crisis Score" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;">
          </div>
        </td>
      </tr>`
    : '';

  return `<!doctype html>
<html lang="es" style="color-scheme:light only;supported-color-schemes:light only;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${esc(bandLabelEs(data.band))} · ${esc(data.agencyShortName)} · ${esc(data.triggerDayLabel)}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; background: ${COLORS.page}; }
    a { text-decoration: none; }
    img { -ms-interpolation-mode: bicubic; }
    .appleLinks a { color: inherit !important; text-decoration: none !important; }
    [data-ogsc] .force-bg-page { background-color: ${COLORS.page} !important; }
    [data-ogsc] .force-bg-white { background-color: ${COLORS.surface} !important; }
    [data-ogsc] .force-text-dark { color: ${COLORS.ink} !important; }
    [data-ogsc] .force-text-mute { color: ${COLORS.inkSoft} !important; }
    [data-ogsc] .force-text-soft { color: ${COLORS.inkMute} !important; }
    [data-ogsc] .force-border { border-color: ${COLORS.border} !important; }
    u + .body .gmail-dark-fix { background: ${COLORS.page} !important; }
    @media (max-width: 620px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .px-32 { padding-left: 20px !important; padding-right: 20px !important; }
      .stack { display: block !important; width: 100% !important; }
      .stack-pad { padding: 0 0 8px 0 !important; }
      h1.headline { font-size: 22px !important; line-height: 1.25 !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${COLORS.ink};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.page};opacity:0;">
    ${esc(bandLabelEs(data.band))} · ${esc(data.agencyShortName)} · ${esc(data.editorial.headline)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="force-bg-page" style="background:${COLORS.page};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" class="container force-bg-white gmail-dark-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="width:600px;max-width:600px;background:${COLORS.surface};background-color:${COLORS.surface};border-radius:10px;overflow:hidden;border:1px solid ${COLORS.border};">

          <!-- BAND BAR -->
          <tr>
            <td style="background:${accent};background-color:${accent};height:6px;line-height:6px;font-size:0;padding:0;">&nbsp;</td>
          </tr>

          <!-- HEADER -->
          <tr>
            <td class="px-32" style="padding:18px 32px 14px 32px;border-bottom:1px solid ${COLORS.borderSoft};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <span style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${COLORS.ink};">ECO <span style="color:${COLORS.brand};">Radar</span></span>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;background:${accent};color:#FFFFFF;font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 10px;border-radius:4px;">${esc(bandLabelEs(data.band))}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td class="px-32" style="padding:24px 32px 18px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyShortName)} · ${esc(data.agencyName)} · Detección de crisis
              </div>
              <h1 class="headline force-text-dark" style="margin:0 0 12px 0;color:${COLORS.ink};font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;">
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

          <!-- INDICADORES -->
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

          <!-- CUERPO EDITORIAL -->
          <tr>
            <td class="px-32" style="padding:18px 32px 4px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:8px;">02 · Qué está pasando</div>
              ${bodyParagraphs}
            </td>
          </tr>

          ${voicesBlock}

          ${trendBlock}

          <!-- DRIVERS -->
          <tr>
            <td class="px-32" style="padding:16px 32px 8px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">03 · Qué lo está empujando</div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                ${drivers}
              </table>
            </td>
          </tr>

          <!-- CONCENTRACIÓN — stacked vertical con barras de progreso -->
          <tr>
            <td class="px-32" style="padding:18px 32px 6px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">04 · Dónde se concentra</div>
              ${topicsBlock}
              ${muniBlock}
            </td>
          </tr>

          <!-- ENLACES Y FUENTES — la lista cruda con thumbnails -->
          <tr>
            <td class="px-32" style="padding:14px 32px 8px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">05 · Enlaces y fuentes</div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                ${mentionsRows}
              </table>
            </td>
          </tr>

          <!-- CIERRE -->
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

          <!-- CTA -->
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
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="px-32" style="padding:18px 32px 22px 32px;border-top:1px solid ${COLORS.borderSoft};" align="center">
              <div class="force-text-soft" style="color:${COLORS.inkMute};font-size:11.5px;line-height:1.6;">
                ECO Radar &nbsp;·&nbsp; IDEA
              </div>
              <div class="force-text-soft" style="margin-top:6px;color:${COLORS.inkMute};font-size:11px;line-height:1.5;">
                Recibes este correo porque eres administrador del Radar de tu agencia.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
