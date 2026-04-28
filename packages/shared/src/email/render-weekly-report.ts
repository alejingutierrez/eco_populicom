/**
 * Renderiza el template HTML del reporte semanal con datos reales.
 * El HTML está pensado para clientes de correo: tablas, estilos inline,
 * SVG inline para el gráfico, máximo 600px de ancho.
 */

export interface WeeklyReportRenderData {
  agencyName: string;              // "Departamento de Desarrollo Económico y Comercio"
  agencyKicker: string;            // "DDEC · Departamento de Desarrollo Económico y Comercio"
  periodLabel: string;             // "15 – 21 abr 2026"
  updatedAtLabel: string;          // "21 abr, 4:00 p.m. AST"
  totals: {
    negative: number;
    neutral: number;
    positive: number;
    total: number;
  };
  deltaVsPrev: {
    negative: number;              // porcentaje, e.g. 18 = +18%
    neutral: number;
    positive: number;
  };
  /** URL absoluta de la imagen PNG del gráfico de tendencia (generada vía QuickChart u otro servicio). Requerida para clientes como Gmail que no soportan SVG. */
  chartImageUrl: string;
  dailySeries: Array<{
    date: string;                  // YYYY-MM-DD
    dayLabel: string;              // "mar 15"
    negative: number;
    neutral: number;
    positive: number;
  }>;
  topicsTable: Array<{
    topic: string;                 // "Desarrollo económico"
    subtopics: string;             // "Incentivos · Permisos"
    total: number;
    negative: number;
    neutral: number;
    positive: number;
  }>;
  insights: {
    negative: string[];
    neutral: string[];
    positive: string[];
  };
  dailySummary: {
    label: string;                 // "Resumen del día · 21 abr"
    paragraph: string;             // HTML-safe; puede contener <strong>
  };
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

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function signedPct(n: number): string {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return '0%';
}

function arrow(n: number): string {
  if (n > 0) return '▲';
  if (n < 0) return '▼';
  return '■';
}

// ------------------------------------------------------------
// Gráfico de serie de tiempo — imagen PNG externa (ej. QuickChart).
// La URL se pasa en data.chartImageUrl. Gmail/Outlook/Apple Mail
// cargan la imagen y la muestran. Hay un <table> fallback con un
// alt text por si el cliente bloquea imágenes.
// ------------------------------------------------------------

function renderChart(data: WeeklyReportRenderData): string {
  if (!data.dailySeries.length) {
    return '<div style="padding:40px;text-align:center;color:#94A3B8;font-size:13px;">Sin datos para el periodo.</div>';
  }
  if (!data.chartImageUrl) {
    return '<div style="padding:40px;text-align:center;color:#94A3B8;font-size:13px;">Gráfico no disponible.</div>';
  }

  const altText = `Tendencia de sentimiento últimos 7 días · ` +
    data.dailySeries
      .map((d) => `${d.dayLabel}: neg ${d.negative} · neu ${d.neutral} · pos ${d.positive}`)
      .join(' | ');

  return `
  <img src="${esc(data.chartImageUrl)}" alt="${esc(altText)}" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto;">
  `;
}

function niceCeil(n: number): number {
  if (n <= 10) return Math.max(10, Math.ceil(n));
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const d = n / pow;
  let nice: number;
  if (d <= 1) nice = 1;
  else if (d <= 2) nice = 2;
  else if (d <= 5) nice = 5;
  else nice = 10;
  return Math.ceil(nice * pow);
}

// ------------------------------------------------------------
// Insight lists
// ------------------------------------------------------------

function renderInsights(items: string[], color: string): string {
  const clean = items.filter((s) => s && s.trim().length > 0);
  if (clean.length === 0) {
    return `<li class="force-text-soft" style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px;line-height:1.55;color:#94A3B8;font-style:italic;">Sin señal suficiente en los datos de la semana.</li>`;
  }
  return clean
    .map(
      (s, i) =>
        `<li class="force-text-dark" style="padding:8px 0;border-top:1px solid #F1F5F9;font-size:13px;line-height:1.55;color:#0E1E2C;"><strong style="color:${color};">${i + 1}.</strong> ${s}</li>`,
    )
    .join('');
}

// ------------------------------------------------------------
// Main render
// ------------------------------------------------------------

export function renderWeeklyReportHtml(data: WeeklyReportRenderData): string {
  const { totals, deltaVsPrev } = data;

  const topicsRows = data.topicsTable
    .slice(0, 8)
    .map((t) => {
      const subs = t.subtopics ? `<div class="force-text-soft" style="font-size:11px;color:#94A3B8;font-weight:500;margin-top:2px;">${esc(t.subtopics)}</div>` : '';
      return `
      <tr>
        <td class="force-text-dark" style="padding:12px 14px;font-size:13px;color:#0E1E2C;font-weight:600;border-bottom:1px solid #EEF2F6;">
          ${esc(t.topic)}
          ${subs}
        </td>
        <td align="right" class="force-text-dark" style="padding:12px 14px;font-size:13px;color:#0E1E2C;font-weight:700;border-bottom:1px solid #EEF2F6;">${t.total}</td>
        <td align="right" style="padding:12px 14px;font-size:13px;color:#E86452;font-weight:700;border-bottom:1px solid #EEF2F6;">${t.negative}</td>
        <td align="right" class="force-text-mute" style="padding:12px 14px;font-size:13px;color:#64748B;border-bottom:1px solid #EEF2F6;">${t.neutral}</td>
        <td align="right" style="padding:12px 14px;font-size:13px;color:#52C47A;border-bottom:1px solid #EEF2F6;">${t.positive}</td>
      </tr>`;
    })
    .join('');

  const topicsEmpty = data.topicsTable.length === 0
    ? `<tr><td colspan="5" style="padding:16px;text-align:center;font-size:13px;color:#94A3B8;">Sin menciones clasificadas por tópico en el periodo.</td></tr>`
    : '';

  return `<!doctype html>
<html lang="es" style="color-scheme:light only;supported-color-schemes:light only;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>Resumen semanal · últimos 7 días</title>
  <!--[if mso]>
  <style type="text/css">
    table, td, div, h1, h2, h3, p { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; background: #0E1E2C; }
    a { text-decoration: none; }
    img { -ms-interpolation-mode: bicubic; }
    /* Impide que iOS / Apple Mail auto-detecte y recolore fechas, direcciones, teléfonos */
    .appleLinks a { color: inherit !important; text-decoration: none !important; }
    /* Outlook.com / Office 365 dark mode: fuerza los colores claros definidos */
    [data-ogsc] .force-bg-white { background-color: #FFFFFF !important; }
    [data-ogsc] .force-bg-surface { background-color: #F4F7FA !important; }
    [data-ogsc] .force-text-dark { color: #0E1E2C !important; }
    [data-ogsc] .force-text-mute { color: #64748B !important; }
    [data-ogsc] .force-text-soft { color: #94A3B8 !important; }
    [data-ogsc] .force-border { border-color: #EEF2F6 !important; }
    /* Gmail iOS dark mode: evita que invierta backgrounds claros */
    u + .body .gmail-dark-fix { background: #F4F7FA !important; }
    @media (prefers-color-scheme: dark) {
      /* Forzamos modo claro siempre en dark mode del cliente */
      .container, .container td, .container div, .container p, .container h1, .container h2, .container h3, .container span, .container strong {
        color-scheme: light only !important;
      }
    }
    @media (max-width: 620px) {
      .container { width: 100% !important; }
      .px-24 { padding-left: 16px !important; padding-right: 16px !important; }
      .stack { display: block !important; width: 100% !important; }
      .stack-pad { padding-bottom: 12px !important; }
      .kpi-value { font-size: 28px !important; }
      h1.title { font-size: 20px !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:#0E1E2C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0E1E2C;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#0E1E2C;opacity:0;">
    ${esc(data.agencyKicker)} · ${totals.negative} menciones negativas (${pct(totals.negative, totals.total)}%) · últimos 7 días
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E1E2C;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" class="container force-bg-surface gmail-dark-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F7FA" style="width:600px;max-width:600px;background:#F4F7FA;background-color:#F4F7FA;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.35);">

          <tr>
            <td style="background:#0E1E2C;padding:20px 28px;" class="px-24">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <img src="https://www.populicom.com/wp-content/themes/populicom/img/logo-populicom-white.svg" alt="Populicom" width="130" style="display:block;border:0;outline:none;text-decoration:none;height:auto;">
                  </td>
                  <td align="right" valign="middle" style="color:#94A3B8;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;">
                    Radar semanal
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:linear-gradient(135deg,#0A7EA4 0%,#0E1E2C 100%);padding:28px 28px 22px 28px;" class="px-24">
              <div style="color:#FFD100;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;margin-bottom:8px;">
                ${esc(data.agencyKicker)}
              </div>
              <h1 class="title" style="margin:0 0 6px 0;color:#FFFFFF;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;">
                Resumen de conversación pública · últimos 7 días
              </h1>
              <div style="color:#CBD5E1;font-size:13px;line-height:1.5;">
                Periodo: <strong style="color:#FFFFFF;">${esc(data.periodLabel)}</strong> &nbsp;·&nbsp; Actualizado: ${esc(data.updatedAtLabel)}
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 28px 8px 28px;" class="px-24">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#0A7EA4;margin-bottom:4px;">01 · Termómetro de sentimiento</div>
              <h2 class="force-text-dark" style="margin:0 0 14px 0;font-size:18px;line-height:1.3;color:#0E1E2C;font-weight:700;">Cómo se sintió la conversación esta semana</h2>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;table-layout:fixed;">
                <tr>
                  ${kpiCard('Negativo', '#FDECE8', '#B94030', '#E86452', totals.negative, pct(totals.negative, totals.total), arrow(deltaVsPrev.negative), signedPct(deltaVsPrev.negative), 'right')}
                  ${kpiCard('Neutral', '#EEF2F6', '#475569', '#64748B', totals.neutral, pct(totals.neutral, totals.total), arrow(deltaVsPrev.neutral), signedPct(deltaVsPrev.neutral), 'both')}
                  ${kpiCard('Positivo', '#E6F6EC', '#1F8A47', '#52C47A', totals.positive, pct(totals.positive, totals.total), arrow(deltaVsPrev.positive), signedPct(deltaVsPrev.positive), 'left')}
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 8px 28px;" class="px-24">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#0A7EA4;margin-bottom:4px;">02 · Tendencia diaria</div>
              <h2 class="force-text-dark" style="margin:0 0 14px 0;font-size:18px;line-height:1.3;color:#0E1E2C;font-weight:700;">Evolución del sentimiento, día a día</h2>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-color:#FFFFFF;border:1px solid #EEF2F6;border-radius:14px;">
                <tr>
                  <td bgcolor="#FFFFFF" style="padding:20px 20px 16px 20px;background:#FFFFFF;background-color:#FFFFFF;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                      <tr>
                        <td align="left" class="force-text-mute" style="font-size:12px;color:#475569;font-weight:600;">
                          <span style="display:inline-block;width:10px;height:10px;background:#E86452;border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:18px;">Negativo <span class="force-text-soft" style="color:#94A3B8;font-weight:500;">${totals.negative}</span></span>
                          <span style="display:inline-block;width:10px;height:10px;background:#94A3B8;border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;margin-right:18px;">Neutral <span class="force-text-soft" style="color:#94A3B8;font-weight:500;">${totals.neutral}</span></span>
                          <span style="display:inline-block;width:10px;height:10px;background:#52C47A;border-radius:2px;vertical-align:middle;margin-right:6px;"></span>
                          <span style="vertical-align:middle;">Positivo <span class="force-text-soft" style="color:#94A3B8;font-weight:500;">${totals.positive}</span></span>
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

          <tr>
            <td style="padding:22px 28px 8px 28px;" class="px-24">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#0A7EA4;margin-bottom:4px;">03 · Tópicos y subtópicos</div>
              <h2 class="force-text-dark" style="margin:0 0 14px 0;font-size:18px;line-height:1.3;color:#0E1E2C;font-weight:700;">Dónde se concentra la conversación</h2>
              <table role="presentation" class="force-bg-white" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-color:#FFFFFF;border:1px solid #EEF2F6;border-radius:14px;overflow:hidden;">
                <tr>
                  <th align="left" bgcolor="#FAFBFD" style="background:#FAFBFD;background-color:#FAFBFD;padding:10px 14px;font-size:11px;font-weight:700;color:#475569;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid #EEF2F6;">Tópico</th>
                  <th align="right" bgcolor="#FAFBFD" style="background:#FAFBFD;background-color:#FAFBFD;padding:10px 14px;font-size:11px;font-weight:700;color:#475569;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid #EEF2F6;width:64px;">Total</th>
                  <th align="right" bgcolor="#FAFBFD" style="background:#FAFBFD;background-color:#FAFBFD;padding:10px 14px;font-size:11px;font-weight:700;color:#E86452;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid #EEF2F6;width:58px;">Neg</th>
                  <th align="right" bgcolor="#FAFBFD" style="background:#FAFBFD;background-color:#FAFBFD;padding:10px 14px;font-size:11px;font-weight:700;color:#64748B;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid #EEF2F6;width:58px;">Neu</th>
                  <th align="right" bgcolor="#FAFBFD" style="background:#FAFBFD;background-color:#FAFBFD;padding:10px 14px;font-size:11px;font-weight:700;color:#52C47A;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid #EEF2F6;width:58px;">Pos</th>
                </tr>
                ${topicsRows}
                ${topicsEmpty}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 28px 8px 28px;" class="px-24">
              <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#0A7EA4;margin-bottom:4px;">04 · Insights de la semana</div>
              <h2 class="force-text-dark" style="margin:0 0 14px 0;font-size:18px;line-height:1.3;color:#0E1E2C;font-weight:700;">Lo que está diciendo la audiencia</h2>

              <table role="presentation" class="force-bg-white" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-color:#FFFFFF;border:1px solid #EEF2F6;border-radius:14px;margin-bottom:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="display:inline-block;background:#FDECE8;color:#B94030;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 8px;border-radius:999px;margin-bottom:10px;">Negativo · ${pct(totals.negative, totals.total)}% del total</div>
                    <ul style="margin:0;padding:0;list-style:none;">${renderInsights(data.insights.negative, '#E86452')}</ul>
                  </td>
                </tr>
              </table>

              <table role="presentation" class="force-bg-white" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-color:#FFFFFF;border:1px solid #EEF2F6;border-radius:14px;margin-bottom:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="display:inline-block;background:#EEF2F6;color:#475569;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 8px;border-radius:999px;margin-bottom:10px;">Neutral · ${pct(totals.neutral, totals.total)}% del total</div>
                    <ul style="margin:0;padding:0;list-style:none;">${renderInsights(data.insights.neutral, '#64748B')}</ul>
                  </td>
                </tr>
              </table>

              <table role="presentation" class="force-bg-white" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-color:#FFFFFF;border:1px solid #EEF2F6;border-radius:14px;margin-bottom:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="display:inline-block;background:#E6F6EC;color:#1F8A47;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 8px;border-radius:999px;margin-bottom:10px;">Positivo · ${pct(totals.positive, totals.total)}% del total</div>
                    <ul style="margin:0;padding:0;list-style:none;">${renderInsights(data.insights.positive, '#52C47A')}</ul>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0E1E2C 0%,#0A7EA4 100%);border-radius:14px;margin-top:4px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="display:inline-block;background:#FFD100;color:#0E1E2C;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;padding:5px 10px;border-radius:999px;margin-bottom:12px;">${esc(data.dailySummary.label)}</div>
                    <p style="margin:0;color:#F4F7FA;font-size:14px;line-height:1.6;">${data.dailySummary.paragraph}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr><td style="padding:8px 28px 22px 28px;" class="px-24">&nbsp;</td></tr>

          <tr>
            <td style="background:#0E1E2C;padding:18px 28px;" class="px-24" align="center">
              <div style="color:#64748B;font-size:11px;line-height:1.6;">© ${new Date().getFullYear()} Populicom · San Juan, Puerto Rico</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function kpiCard(
  label: string,
  pillBg: string,
  pillColor: string,
  valueColor: string,
  value: number,
  percentOfTotal: number,
  arrowChar: string,
  deltaLabel: string,
  side: 'left' | 'right' | 'both',
): string {
  const paddingL = side === 'right' ? 0 : 3;
  const paddingR = side === 'left' ? 0 : 3;
  const padLStyle = side === 'right' ? '' : `padding-left:${paddingL}px;`;
  const padRStyle = side === 'left' ? '' : `padding-right:${paddingR}px;`;
  const leftPad = side === 'right' ? 'padding-right:6px;' : side === 'left' ? 'padding-left:6px;' : 'padding-left:3px;padding-right:3px;';

  return `<td class="stack stack-pad" valign="top" width="33.33%" style="${leftPad}">
    <table role="presentation" class="force-bg-white force-border" width="100%" height="168" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;background-color:#FFFFFF;border-radius:14px;border:1px solid #EEF2F6;height:168px;">
      <tr>
        <td valign="top" style="padding:16px;height:168px;">
          <div style="display:inline-block;background:${pillBg};background-color:${pillBg};color:${pillColor};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 8px;border-radius:999px;">${label}</div>
          <div class="kpi-value" style="font-size:30px;line-height:1;font-weight:800;color:${valueColor};margin-top:14px;letter-spacing:-0.02em;">${value}</div>
          <div class="force-text-mute" style="font-size:13px;color:#64748B;margin-top:6px;font-weight:600;">${percentOfTotal}% del total</div>
          <div style="margin-top:12px;font-size:12px;color:${pillColor};font-weight:600;">${arrowChar} ${deltaLabel} <span class="force-text-soft" style="color:#94A3B8;font-weight:500;">vs 7 días previos</span></div>
        </td>
      </tr>
    </table>
  </td>`;
}
