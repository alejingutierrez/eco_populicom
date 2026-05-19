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
  }>;

  /**
   * URL de un PNG con la evolución del Crisis Score los últimos 14 días.
   * Si no hay datos suficientes, queda vacío y el template oculta el bloque.
   */
  scoreTrendImageUrl: string;

  /** Salida editorial del LLM. */
  editorial: {
    headline: string;
    lede: string;
    bodyParagraphsHtml: string[];
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

function fmtScore(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function fmtPct(n: number): string {
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
// Topic / municipality row con barra de share negativo
// ------------------------------------------------------------

function negShareRow(name: string, negative: number, total: number, share: number): string {
  const pct = Math.round(share * 100);
  return `<tr>
    <td class="force-text-dark" style="padding:10px 14px;font-size:13px;color:${COLORS.ink};border-bottom:1px solid ${COLORS.borderSoft};">${esc(name)}</td>
    <td align="right" class="force-text-soft" style="padding:10px 12px;font-size:12.5px;color:${COLORS.inkSoft};white-space:nowrap;border-bottom:1px solid ${COLORS.borderSoft};">${fmtInt(negative)} / ${fmtInt(total)}</td>
    <td align="right" class="force-text-dark" style="padding:10px 14px;font-size:13px;font-weight:700;color:${COLORS.alerta};white-space:nowrap;border-bottom:1px solid ${COLORS.borderSoft};">${pct}%</td>
  </tr>`;
}

// ------------------------------------------------------------
// Highlighted mention card
// ------------------------------------------------------------

function mentionCard(
  m: CrisisAlertRenderData['highlightedMentions'][number],
  isLast: boolean,
): string {
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
  const link = m.url
    ? `<a href="${esc(m.url)}" style="color:${COLORS.brand};text-decoration:none;font-size:11.5px;font-weight:600;">Ver mención →</a>`
    : '';
  return `<tr>
    <td style="padding:14px 16px;${border}">
      <div class="force-text-soft" style="font-size:10.5px;color:${COLORS.inkMute};letter-spacing:0.05em;text-transform:uppercase;font-weight:700;margin-bottom:4px;">
        ${esc(m.sourceLabel)} <span style="color:${COLORS.borderSoft};">·</span> ${esc(m.publishedAtLabel)}
      </div>
      <div class="force-text-dark" style="font-size:13px;line-height:1.55;color:${COLORS.ink};">
        ${esc(m.snippet)}
      </div>
      ${link ? `<div style="margin-top:6px;">${link}</div>` : ''}
    </td>
  </tr>`;
}

// ------------------------------------------------------------
// Driver list
// ------------------------------------------------------------

function driverItem(label: string, description: string, idx: number, total: number): string {
  const isLast = idx === total - 1;
  const border = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
  return `<tr>
    <td style="padding:14px 16px 14px 0;${border}width:32px;vertical-align:top;">
      <div style="display:inline-block;background:${COLORS.alertSoft};color:${COLORS.alerta};width:24px;height:24px;border-radius:12px;text-align:center;line-height:24px;font-size:11.5px;font-weight:700;">${idx + 1}</div>
    </td>
    <td style="padding:14px 0 14px 0;${border}">
      <div class="force-text-dark" style="font-size:13px;font-weight:700;color:${COLORS.ink};">${esc(label)}</div>
      <div class="force-text-soft" style="font-size:12.5px;line-height:1.55;color:${COLORS.inkSoft};margin-top:2px;">${esc(description)}</div>
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
    : `hace 24h: ${fmtScore(m.crisisRiskScore24hAgo)}`;

  const indicators = [
    indicatorTile('Crisis Score', fmtScore(m.crisisRiskScore), accent, score24hHint),
    indicatorTile('Severidad', fmtScore(m.crisisSeverity), COLORS.alerta, 'concentración negativa'),
    indicatorTile('Velocidad', fmtScore(m.crisisVelocity), COLORS.elevado, `volumen ${fmtZ(m.volumeAnomalyZscore)}`),
    indicatorTile('Relevancia', fmtScore(m.crisisRelevance), COLORS.brand, 'pertinencia alta'),
  ].join('');

  const volumeDeltaLine = v.prevDayTotal != null
    ? `${fmtInt(v.totalMentions)} menciones &nbsp;·&nbsp; <strong style="color:${COLORS.alerta};">${fmtInt(v.negativeCount)} negativas</strong> (${fmtPct(v.negativeShare)}). Día previo: ${fmtInt(v.prevDayTotal)} / ${fmtInt(v.prevDayNegative ?? 0)} neg.`
    : `${fmtInt(v.totalMentions)} menciones &nbsp;·&nbsp; <strong style="color:${COLORS.alerta};">${fmtInt(v.negativeCount)} negativas</strong> (${fmtPct(v.negativeShare)}).`;

  const topicsRows = data.topNegativeTopics.length > 0
    ? data.topNegativeTopics
        .slice(0, 5)
        .map((t) => negShareRow(t.topic, t.negative, t.total, t.negativeShare))
        .join('')
    : `<tr><td colspan="3" style="padding:14px 16px;font-size:12px;color:${COLORS.inkMute};font-style:italic;">Sin concentración por tópico medible.</td></tr>`;

  const muniRows = data.topNegativeMunicipalities.length > 0
    ? data.topNegativeMunicipalities
        .slice(0, 5)
        .map((mu) => {
          const share = mu.total > 0 ? mu.negative / mu.total : 0;
          return negShareRow(mu.municipality, mu.negative, mu.total, share);
        })
        .join('')
    : `<tr><td colspan="3" style="padding:14px 16px;font-size:12px;color:${COLORS.inkMute};font-style:italic;">Sin concentración geográfica medible.</td></tr>`;

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
      (p) =>
        `<p class="force-text-dark" style="margin:0 0 12px 0;font-size:14px;line-height:1.65;color:${COLORS.ink};">${p}</p>`,
    )
    .join('');

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

          <!-- TÓPICOS Y MUNICIPIOS -->
          <tr>
            <td class="px-32" style="padding:18px 32px 6px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">04 · Concentración</div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
                <tr>
                  <td class="stack" valign="top" width="50%" style="padding-right:8px;">
                    <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                      <tr>
                        <td style="padding:10px 14px;background:${COLORS.page};border-bottom:1px solid ${COLORS.borderSoft};font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;">Tópicos</td>
                      </tr>
                      ${topicsRows}
                    </table>
                  </td>
                  <td class="stack stack-pad" valign="top" width="50%" style="padding-left:8px;">
                    <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                      <tr>
                        <td style="padding:10px 14px;background:${COLORS.page};border-bottom:1px solid ${COLORS.borderSoft};font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;">Municipios</td>
                      </tr>
                      ${muniRows}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- VOCES -->
          <tr>
            <td class="px-32" style="padding:8px 32px 8px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:10px;">05 · Voces destacadas</div>
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
