/**
 * Renderiza el template HTML del reporte semanal con datos reales.
 *
 * Diseño: minimalista, fondo claro, marca Populicom (azul + amarillo) usada
 * con moderación. Sin gradients oscuros ni elementos decorativos. Tablas e
 * inline styles para compatibilidad con Gmail / Outlook / Apple Mail.
 * Imagen PNG externa (QuickChart) para el gráfico de tendencia.
 */

export interface WeeklyReportRenderData {
  agencyName: string;
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
}

// ------------------------------------------------------------
// Paleta — sobria, light-first
// ------------------------------------------------------------

const COLORS = {
  // Estructura
  page: '#F5F6F8',          // gris muy claro detrás del email
  surface: '#FFFFFF',       // tarjetas y secciones
  border: '#E6E8EC',        // bordes sutiles
  borderSoft: '#EEF0F4',    // separadores internos

  // Tipografía
  ink: '#0E1E2C',           // texto principal (azul muy oscuro Populicom)
  inkSoft: '#4A5563',       // texto secundario
  inkMute: '#8A93A0',       // texto terciario, labels

  // Marca Populicom
  brand: '#0A7EA4',         // azul Populicom
  brandSoft: '#E6F1F7',     // azul muy claro para acentos
  accent: '#F4C300',        // amarillo Populicom
  accentSoft: '#FFF8DB',    // amarillo crema para destacar

  // Semánticos
  neg: '#C8462F',           // rojo, ligeramente más oscuro/serio
  negSoft: '#FBE9E5',
  neu: '#6B7280',
  neuSoft: '#EEF0F3',
  pos: '#1F8A47',
  posSoft: '#E6F4EC',
};

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

function fmtInt(n: number): string {
  return n.toLocaleString('es-PR');
}

function deltaWord(n: number): string {
  if (n > 0) return 'sube';
  if (n < 0) return 'baja';
  return 'estable';
}

// ------------------------------------------------------------
// Gráfico — PNG externo (QuickChart) con alt-text descriptivo
// ------------------------------------------------------------

function renderChart(data: WeeklyReportRenderData): string {
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
// Insights list
// ------------------------------------------------------------

function renderInsights(items: string[], color: string): string {
  const clean = items.filter((s) => s && s.trim().length > 0);
  if (clean.length === 0) {
    return `<li class="force-text-soft" style="padding:10px 0;font-size:13px;line-height:1.6;color:${COLORS.inkMute};font-style:italic;">No hay señal suficiente en los datos del periodo.</li>`;
  }
  return clean
    .map(
      (s, i, arr) => {
        const borderTop = i === 0 ? '' : `border-top:1px solid ${COLORS.borderSoft};`;
        return `<li class="force-text-dark" style="padding:12px 0 12px 28px;${borderTop}font-size:13.5px;line-height:1.6;color:${COLORS.ink};position:relative;">
          <span style="position:absolute;left:0;top:12px;color:${color};font-weight:700;font-size:13px;">${i + 1}.</span>
          ${s}
        </li>`;
      },
    )
    .join('');
}

// ------------------------------------------------------------
// Main render
// ------------------------------------------------------------

export function renderWeeklyReportHtml(data: WeeklyReportRenderData): string {
  const { totals, deltaVsPrev } = data;

  const topicsList = data.topicsTable.slice(0, 9);
  const topicsRows = topicsList
    .map((t, idx) => {
      const isLast = idx === topicsList.length - 1;
      const rowBorder = isLast ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
      const isMuted = Boolean(t.isOther || t.isUnclassified);
      const labelColor = isMuted ? COLORS.inkSoft : COLORS.ink;
      const totalColor = isMuted ? COLORS.inkSoft : COLORS.ink;
      const totalWeight = isMuted ? 600 : 700;
      const totalPct = totals.total > 0 ? Math.round((t.total / totals.total) * 100) : 0;
      const subs = t.subtopics
        ? `<div class="force-text-soft" style="font-size:11.5px;color:${COLORS.inkMute};font-weight:400;margin-top:3px;font-style:${t.isUnclassified ? 'italic' : 'normal'};">${esc(t.subtopics)}</div>`
        : '';
      return `
      <tr>
        <td class="force-text-dark" style="padding:14px 16px;font-size:13.5px;color:${labelColor};font-weight:${isMuted ? 500 : 600};${rowBorder}">
          ${esc(t.topic)}
          ${subs}
        </td>
        <td align="right" class="force-text-dark" style="padding:14px 12px;font-size:13.5px;color:${totalColor};font-weight:${totalWeight};${rowBorder};white-space:nowrap;">
          ${fmtInt(t.total)}
          <span class="force-text-soft" style="display:block;font-size:10.5px;color:${COLORS.inkMute};font-weight:500;margin-top:2px;">${totalPct}%</span>
        </td>
        <td style="padding:14px 16px 14px 12px;${rowBorder}">
          ${distributionBar(t.negative, t.neutral, t.positive, t.total, isMuted)}
        </td>
      </tr>`;
    })
    .join('');

  // Total al pie de la tabla — debe cuadrar con el universo del termómetro.
  const topicsFooter = data.topicsTable.length > 0
    ? `
      <tr>
        <td style="padding:14px 16px;font-size:11px;color:${COLORS.inkMute};font-weight:700;letter-spacing:0.06em;text-transform:uppercase;border-top:1px solid ${COLORS.border};background:${COLORS.page};">Total del periodo</td>
        <td align="right" class="force-text-dark" style="padding:14px 12px;font-size:14px;color:${COLORS.ink};font-weight:800;border-top:1px solid ${COLORS.border};background:${COLORS.page};white-space:nowrap;">${fmtInt(totals.total)}</td>
        <td style="padding:14px 16px 14px 12px;border-top:1px solid ${COLORS.border};background:${COLORS.page};">
          ${distributionBar(totals.negative, totals.neutral, totals.positive, totals.total, false)}
        </td>
      </tr>`
    : '';

  const topicsEmpty = data.topicsTable.length === 0
    ? `<tr><td colspan="3" style="padding:18px;text-align:center;font-size:13px;color:${COLORS.inkMute};">Sin menciones clasificadas por tópico en este periodo.</td></tr>`
    : '';

  const negPct = pct(totals.negative, totals.total);
  const neuPct = pct(totals.neutral, totals.total);
  const posPct = pct(totals.positive, totals.total);

  return `<!doctype html>
<html lang="es" style="color-scheme:light only;supported-color-schemes:light only;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Resumen semanal Populicom · ${esc(data.periodLabel)}</title>
  <!--[if mso]>
  <style type="text/css">
    table, td, div, h1, h2, h3, p { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; background: ${COLORS.page}; }
    a { text-decoration: none; }
    img { -ms-interpolation-mode: bicubic; }
    /* iOS / Apple Mail: evita auto-detección coloreada de fechas y direcciones */
    .appleLinks a { color: inherit !important; text-decoration: none !important; }
    /* Outlook.com / Office 365 dark mode override — fuerza colores claros */
    [data-ogsc] .force-bg-page { background-color: ${COLORS.page} !important; }
    [data-ogsc] .force-bg-white { background-color: ${COLORS.surface} !important; }
    [data-ogsc] .force-text-dark { color: ${COLORS.ink} !important; }
    [data-ogsc] .force-text-mute { color: ${COLORS.inkSoft} !important; }
    [data-ogsc] .force-text-soft { color: ${COLORS.inkMute} !important; }
    [data-ogsc] .force-border { border-color: ${COLORS.border} !important; }
    /* Gmail iOS: no invertir backgrounds claros */
    u + .body .gmail-dark-fix { background: ${COLORS.page} !important; }
    @media (prefers-color-scheme: dark) {
      .container, .container td, .container div, .container p, .container h1, .container h2, .container h3, .container span, .container strong {
        color-scheme: light only !important;
      }
    }
    @media (max-width: 620px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .px-32 { padding-left: 20px !important; padding-right: 20px !important; }
      .stack { display: block !important; width: 100% !important; }
      .stack-pad { padding-bottom: 10px !important; padding-left: 0 !important; padding-right: 0 !important; }
      .kpi-value { font-size: 30px !important; }
      h1.title { font-size: 22px !important; }
      h2.section-title { font-size: 16px !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:${COLORS.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${COLORS.ink};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.page};opacity:0;">
    ${esc(data.agencyKicker)} — ${fmtInt(totals.total)} menciones · periodo ${esc(data.periodLabel)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="force-bg-page" style="background:${COLORS.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="container force-bg-white gmail-dark-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="width:600px;max-width:600px;background:${COLORS.surface};background-color:${COLORS.surface};border-radius:10px;overflow:hidden;border:1px solid ${COLORS.border};">

          <!-- HEADER -->
          <tr>
            <td class="px-32" style="padding:22px 32px 18px 32px;border-bottom:1px solid ${COLORS.borderSoft};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <span style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${COLORS.ink};">Populicom <span style="color:${COLORS.brand};">Radar</span></span>
                  </td>
                  <td align="right" valign="middle" class="force-text-soft" style="font-size:11.5px;color:${COLORS.inkMute};letter-spacing:0.02em;">
                    Reporte semanal
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td class="px-32" style="padding:28px 32px 24px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyKicker)}
              </div>
              <h1 class="title force-text-dark" style="margin:0 0 10px 0;color:${COLORS.ink};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;">
                Conversación pública<br>de los últimos 7 días
              </h1>
              <div class="force-text-mute" style="color:${COLORS.inkSoft};font-size:13px;line-height:1.55;">
                ${esc(data.periodLabel)} &nbsp;·&nbsp; actualizado ${esc(data.updatedAtLabel)}
              </div>
            </td>
          </tr>

          <!-- 01 · TERMÓMETRO -->
          <tr>
            <td class="px-32" style="padding:6px 32px 8px 32px;">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.brand};margin-bottom:6px;">01 · Termómetro</div>
              <h2 class="section-title force-text-dark" style="margin:0 0 18px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Cómo se sintió la conversación
              </h2>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                <tr>
                  ${kpiCard('Negativo', COLORS.neg, COLORS.negSoft, totals.negative, negPct, deltaVsPrev.negative, 'right')}
                  ${kpiCard('Neutral', COLORS.neu, COLORS.neuSoft, totals.neutral, neuPct, deltaVsPrev.neutral, 'both')}
                  ${kpiCard('Positivo', COLORS.pos, COLORS.posSoft, totals.positive, posPct, deltaVsPrev.positive, 'left')}
                </tr>
              </table>

              <div class="force-text-soft" style="margin-top:14px;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Total del periodo: <strong style="color:${COLORS.ink};">${fmtInt(totals.total)}</strong> menciones &nbsp;·&nbsp; comparado con la semana previa
              </div>
            </td>
          </tr>

          <!-- 02 · TENDENCIA -->
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.brand};margin-bottom:6px;">02 · Tendencia</div>
              <h2 class="section-title force-text-dark" style="margin:0 0 16px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Día a día
              </h2>

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

          <!-- 03 · TÓPICO PRINCIPAL -->
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.brand};margin-bottom:6px;">03 · Tópico principal</div>
              <h2 class="section-title force-text-dark" style="margin:0 0 6px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Dónde se concentra la conversación
              </h2>
              <div class="force-text-soft" style="margin:0 0 14px 0;font-size:11.5px;color:${COLORS.inkMute};line-height:1.5;">
                Cada mención se cuenta una sola vez bajo su tópico principal. Las menciones aún sin clasificar se agrupan al final.
              </div>

              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                <tr>
                  <th align="left" style="padding:11px 16px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};">Tópico</th>
                  <th align="right" style="padding:11px 12px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};width:78px;">Total</th>
                  <th align="left" style="padding:11px 16px 11px 12px;font-size:10.5px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid ${COLORS.borderSoft};">Distribución <span style="font-weight:500;text-transform:none;letter-spacing:0;color:${COLORS.inkMute};">(neg · neu · pos)</span></th>
                </tr>
                ${topicsRows}
                ${topicsEmpty}
                ${topicsFooter}
              </table>
            </td>
          </tr>

          <!-- 04 · INSIGHTS -->
          <tr>
            <td class="px-32" style="padding:24px 32px 8px 32px;">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.brand};margin-bottom:6px;">04 · Insights</div>
              <h2 class="section-title force-text-dark" style="margin:0 0 16px 0;font-size:18px;line-height:1.35;color:${COLORS.ink};font-weight:700;letter-spacing:-0.01em;">
                Lo que está diciendo la audiencia
              </h2>

              ${insightBlock('Negativo', `${negPct}% del total`, COLORS.neg, COLORS.negSoft, renderInsights(data.insights.negative, COLORS.neg))}
              ${insightBlock('Neutral', `${neuPct}% del total`, COLORS.neu, COLORS.neuSoft, renderInsights(data.insights.neutral, COLORS.neu))}
              ${insightBlock('Positivo', `${posPct}% del total`, COLORS.pos, COLORS.posSoft, renderInsights(data.insights.positive, COLORS.pos))}
            </td>
          </tr>

          <!-- RESUMEN DEL DÍA -->
          <tr>
            <td class="px-32" style="padding:14px 32px 28px 32px;">
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

          <!-- FOOTER -->
          <tr>
            <td class="px-32" style="padding:20px 32px 22px 32px;border-top:1px solid ${COLORS.borderSoft};" align="center">
              <div class="force-text-soft" style="color:${COLORS.inkMute};font-size:11.5px;line-height:1.6;">
                Populicom · San Juan, Puerto Rico &nbsp;·&nbsp; <a href="https://www.populicom.com" style="color:${COLORS.brand};text-decoration:none;">populicom.com</a>
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
): string {
  const padCss = side === 'right'
    ? 'padding-right:5px;'
    : side === 'left'
    ? 'padding-left:5px;'
    : 'padding-left:5px;padding-right:5px;';

  return `<td class="stack stack-pad" valign="top" width="33.33%" style="${padCss}">
    <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border-radius:8px;border:1px solid ${COLORS.border};">
      <tr>
        <td valign="top" style="padding:16px 16px 14px 16px;">
          <div style="display:inline-block;background:${pillBg};color:${color};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:3px 8px;border-radius:4px;">${label}</div>
          <div class="kpi-value force-text-dark" style="font-size:32px;line-height:1;font-weight:700;color:${COLORS.ink};margin-top:14px;letter-spacing:-0.025em;">${fmtInt(value)}</div>
          <div class="force-text-mute" style="font-size:12.5px;color:${COLORS.inkSoft};margin-top:4px;font-weight:500;">${percentOfTotal}% del total</div>
          <div class="force-text-soft" style="margin-top:10px;font-size:11.5px;color:${COLORS.inkMute};line-height:1.4;">
            <span style="color:${color};font-weight:600;">${signedPct(delta)}</span> ${deltaWord(delta)} vs. semana previa
          </div>
        </td>
      </tr>
    </table>
  </td>`;
}

// ------------------------------------------------------------
// Distribution bar — barra horizontal stacked con los 3 sentimientos +
// porcentajes inline. Usa <table> con widths en % para máxima compatibilidad
// con clientes de email (Outlook 2016 no soporta flexbox; sí soporta tables
// con widths fraccionarios). Si total = 0, renderiza una barra vacía gris.
// ------------------------------------------------------------

function distributionBar(neg: number, neu: number, pos: number, total: number, isMuted: boolean): string {
  if (total === 0) {
    return `<div style="height:6px;background:${COLORS.borderSoft};border-radius:3px;"></div>
            <div class="force-text-soft" style="margin-top:6px;font-size:10.5px;color:${COLORS.inkMute};">—</div>`;
  }
  const negPct = Math.round((neg / total) * 100);
  const neuPct = Math.round((neu / total) * 100);
  const posPct = Math.max(0, 100 - negPct - neuPct);

  // Colores: cuando isMuted (filas "Otros" o "Sin clasificar"), bajamos
  // saturación para no llamar la atención.
  const negC = isMuted ? '#D89B92' : COLORS.neg;
  const neuC = isMuted ? '#B5BBC4' : COLORS.neu;
  const posC = isMuted ? '#9DC9AC' : COLORS.pos;

  // Cada segmento es un <td> con width fraccional. Si un sentimiento es 0,
  // omitimos el <td> para que no genere un pixel residual.
  const segs: string[] = [];
  if (neg > 0) segs.push(`<td bgcolor="${negC}" style="background:${negC};background-color:${negC};width:${negPct}%;height:6px;line-height:6px;font-size:0;padding:0;">&nbsp;</td>`);
  if (neu > 0) segs.push(`<td bgcolor="${neuC}" style="background:${neuC};background-color:${neuC};width:${neuPct}%;height:6px;line-height:6px;font-size:0;padding:0;">&nbsp;</td>`);
  if (pos > 0) segs.push(`<td bgcolor="${posC}" style="background:${posC};background-color:${posC};width:${posPct}%;height:6px;line-height:6px;font-size:0;padding:0;">&nbsp;</td>`);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:3px;overflow:hidden;background:${COLORS.borderSoft};">
    <tr>${segs.join('')}</tr>
  </table>
  <div class="force-text-soft" style="margin-top:6px;font-size:10.5px;color:${COLORS.inkMute};line-height:1.4;">
    <span style="color:${negC};font-weight:600;">${negPct}%</span>
    <span style="color:${COLORS.inkMute};">·</span>
    <span style="color:${neuC};font-weight:600;">${neuPct}%</span>
    <span style="color:${COLORS.inkMute};">·</span>
    <span style="color:${posC};font-weight:600;">${posPct}%</span>
  </div>`;
}

// ------------------------------------------------------------
// Insight block — tarjeta suave con etiqueta y lista numerada
// ------------------------------------------------------------

function insightBlock(label: string, sub: string, color: string, pillBg: string, listHtml: string): string {
  return `<table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;margin-bottom:10px;">
    <tr>
      <td style="padding:14px 18px 6px 18px;">
        <div style="margin-bottom:4px;">
          <span style="display:inline-block;background:${pillBg};color:${color};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:3px 8px;border-radius:4px;vertical-align:middle;">${label}</span>
          <span class="force-text-soft" style="margin-left:8px;font-size:11.5px;color:${COLORS.inkMute};vertical-align:middle;">${sub}</span>
        </div>
        <ul style="margin:0;padding:0;list-style:none;">${listHtml}</ul>
      </td>
    </tr>
  </table>`;
}
