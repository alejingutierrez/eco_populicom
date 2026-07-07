/**
 * Chrome compartido de TODOS los correos ECO (diario, semanal, alertas).
 *
 * PROBLEMA QUE RESUELVE (jul 2026): cada template duplicaba paleta, <head>,
 * header y footer, y el destinatario no podía distinguir de un vistazo QUÉ
 * correo estaba recibiendo (el "Resumen semanal" llegaba todos los días, la
 * alerta de métrica usaba otro tema visual, la alerta de reglas era HTML
 * plano). Este módulo es la única fuente de:
 *
 *   - la paleta de email (hex sólidos — var(--*) no resuelve en clientes),
 *   - el tipo de correo (EmailKind): etiqueta, color, tag de asunto y nota
 *     de footer. El tipo se señala 4 veces por correo: prefijo del asunto,
 *     barra superior de color, badge del header y nota del footer.
 *   - el esqueleto del documento (head + CSS anti-dark-mode + header/footer),
 *   - el tile de indicador NUMÉRICO (decisión jul 2026: los indicadores en
 *     correos se muestran como número/% igual que el dashboard, sin la
 *     palabra cualitativa; el color del tono sigue codificando la banda).
 *
 * Compatibilidad: inline styles + tablas (Gmail, Outlook, Apple Mail).
 */

import type { DeltaDisplay, MetricDisplay, MetricTone } from '../format/metrics-display';

// ------------------------------------------------------------
// Paleta — sobria, light-first (la que ya usaban semanal + crisis)
// ------------------------------------------------------------

export const EMAIL_COLORS = {
  // Estructura
  page: '#F5F6F8',
  surface: '#FFFFFF',
  border: '#E6E8EC',
  borderSoft: '#EEF0F4',

  // Tipografía
  ink: '#0E1E2C',
  inkSoft: '#4A5563',
  inkMute: '#8A93A0',

  // Marca ECO
  brand: '#0A7EA4',
  brandSoft: '#E6F1F7',
  accent: '#F4C300',
  accentSoft: '#FFF8DB',

  // Semánticos
  neg: '#C8462F',
  negSoft: '#FBE9E5',
  neu: '#6B7280',
  neuSoft: '#EEF0F3',
  pos: '#1F8A47',
  posSoft: '#E6F4EC',

  // Severidad de alertas
  crisis: '#A6321F',
  alerta: '#C8462F',
  elevado: '#D97706',
  alertSoft: '#FBE9E5',
  alertSofter: '#FFF4F1',
} as const;

// ------------------------------------------------------------
// Tipo de correo — la señal de identidad que pidió el cliente
// ------------------------------------------------------------

export type EmailKind = 'daily' | 'weekly' | 'alert' | 'crisis';

export interface EmailKindMeta {
  /** Texto del badge del header, p.ej. "Reporte diario". */
  label: string;
  /** Prefijo del asunto, p.ej. "Diario" → "[Diario] DDEC · …". */
  subjectTag: string;
  /** Color de la barra superior y del badge. */
  color: string;
  /** Línea del footer que explica por qué llega este correo. */
  footerNote: string;
}

export const EMAIL_KIND_META: Record<EmailKind, EmailKindMeta> = {
  daily: {
    label: 'Reporte diario',
    subjectTag: 'Diario',
    color: EMAIL_COLORS.brand,
    footerNote: 'Recibes el reporte diario cada mañana con la conversación de los últimos 7 días.',
  },
  weekly: {
    label: 'Reporte semanal',
    subjectTag: 'Semanal',
    color: EMAIL_COLORS.ink,
    footerNote: 'Recibes el reporte semanal los viernes con la comparación de la semana vs la anterior.',
  },
  alert: {
    label: 'Alerta',
    subjectTag: 'Alerta',
    color: EMAIL_COLORS.elevado,
    footerNote: 'Recibes esta alerta automática porque estás en la lista de notificación de tu agencia.',
  },
  crisis: {
    label: 'Alerta de crisis',
    subjectTag: 'Crisis',
    color: EMAIL_COLORS.crisis,
    footerNote: 'Recibes esta alerta automática porque estás en la lista de notificación de crisis de tu agencia.',
  },
};

/** Asunto estándar: "[Tag] SIGLAS · detalle". El tag SIEMPRE va primero para
 *  que el tipo de correo sea lo primero que se lee en el inbox. */
export function buildSubject(tag: string, agencyShort: string, detail: string): string {
  return `[${tag}] ${agencyShort} · ${detail}`;
}

// ------------------------------------------------------------
// Helpers de texto/números
// ------------------------------------------------------------

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtInt(n: number): string {
  return n.toLocaleString('es-PR');
}

/** Mapa tono → hex del palette del correo. Los MetricDisplay/DeltaDisplay
 *  traen `color` como variable CSS ("var(--neg)") que NO resuelve en clientes
 *  de email; consumimos `tone` y lo mapeamos a un hex sólido. */
const TONE_HEX: Record<MetricTone, string> = {
  neg: EMAIL_COLORS.neg,
  warn: EMAIL_COLORS.elevado,
  pos: EMAIL_COLORS.pos,
  accent: EMAIL_COLORS.brand,
  neutral: EMAIL_COLORS.inkSoft,
};

export function toneHex(tone: MetricTone): string {
  return TONE_HEX[tone] ?? EMAIL_COLORS.inkSoft;
}

/** "▲ +12% vs semana anterior" — delta inline coloreado por tono. Devuelve
 *  cadena vacía si no hay baseline (mejor omitir que mostrar "sin base"). */
export function deltaInline(dd: DeltaDisplay | null | undefined, suffix = 'vs semana anterior'): string {
  if (!dd || !dd.hasBaseline || dd.value == null) return '';
  const color = toneHex(dd.tone);
  return `<span style="color:${color};font-weight:700;">${esc(dd.arrow)} ${esc(dd.value)}</span> <span style="color:${EMAIL_COLORS.inkMute};">${esc(suffix)}</span>`;
}

/** Kicker de sección: "01 · Termómetro". */
export function sectionKicker(text: string, color: string = EMAIL_COLORS.brand): string {
  return `<div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${color};margin-bottom:6px;">${text}</div>`;
}

// ------------------------------------------------------------
// Tile de indicador NUMÉRICO — número protagonista, sin palabra cualitativa.
// El mismo patrón visual para diario, semanal y alertas.
// ------------------------------------------------------------

export function indicatorTileNum(
  label: string,
  value: string,
  accentColor: string,
  /** Línea de apoyo (delta vs período previo, o aclaración de escala). HTML permitido. */
  hintHtml: string,
  widthPct = '25%',
): string {
  // Altura uniforme: la tabla interna llena el <td> de la fila (height:100%)
  // y label/hint reservan su alto aunque el contenido sea corto, para que
  // todas las cajas de una sección midan lo mismo.
  return `<td class="stack stack-pad" valign="top" width="${widthPct}" style="padding:0 4px;height:100%;">
    <table role="presentation" class="force-bg-white force-border" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.surface}" style="background:${EMAIL_COLORS.surface};background-color:${EMAIL_COLORS.surface};border-radius:8px;border:1px solid ${EMAIL_COLORS.border};height:100%;">
      <tr>
        <td valign="top" style="padding:14px 14px 12px 14px;">
          <div class="force-text-soft" style="font-size:10px;font-weight:700;color:${EMAIL_COLORS.inkMute};letter-spacing:0.1em;text-transform:uppercase;min-height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(label)}</div>
          <div class="force-text-dark" style="font-size:24px;line-height:1.1;font-weight:700;color:${accentColor};margin-top:8px;letter-spacing:-0.02em;white-space:nowrap;">${esc(value)}</div>
          <div class="force-text-soft" style="margin-top:6px;font-size:11px;color:${EMAIL_COLORS.inkMute};line-height:1.4;min-height:31px;">${hintHtml || '&nbsp;'}</div>
        </td>
      </tr>
    </table>
  </td>`;
}

/** Fila de tiles (rellena con celdas vacías hasta `cols` para no romper el
 *  grid de table-layout fixed). */
export function indicatorRow(tiles: string[], cols: number): string {
  const filler: string[] = [];
  for (let k = tiles.length; k < cols; k++) {
    filler.push(`<td class="stack stack-pad" valign="top" width="${(100 / cols).toFixed(2)}%" style="padding:0 4px;">&nbsp;</td>`);
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
    <tr>${tiles.join('')}${filler.join('')}</tr>
  </table>`;
}

// ------------------------------------------------------------
// Métrica formateada para email — display numérico + delta opcional
// ------------------------------------------------------------

export interface EmailMetric {
  display: MetricDisplay;
  /** Delta vs el período previo de igual duración, ya formateado. */
  delta?: DeltaDisplay | null;
  /** Hint alternativo cuando no hay delta (aclaración de escala/fuente). */
  hint?: string;
}

/**
 * Renderiza los indicadores compuestos como tiles NUMÉRICOS (sin palabra
 * cualitativa — decisión jul 2026, paridad con el dashboard). El color del
 * número codifica la banda (tono del MetricDisplay). El hint es el delta
 * vs el período previo cuando existe.
 */
export function renderMetricTiles(
  entries: Array<{ label: string; metric: EmailMetric }>,
  opts: { cols?: number; deltaSuffix?: string } = {},
): string {
  const cols = opts.cols ?? 3;
  const suffix = opts.deltaSuffix ?? 'vs período previo';
  const widthPct = `${(100 / cols).toFixed(2)}%`;

  const tiles = entries.map(({ label, metric }) => {
    const value = metric.display.value ?? '—';
    const color = metric.display.value != null ? toneHex(metric.display.tone) : EMAIL_COLORS.inkMute;
    const hint = deltaInline(metric.delta, suffix)
      || (metric.hint ? `<span style="color:${EMAIL_COLORS.inkMute};">${esc(metric.hint)}</span>` : '');
    return indicatorTileNum(label, value, color, hint, widthPct);
  });

  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += cols) {
    const rowTiles = tiles.slice(i, i + cols);
    const marginTop = i === 0 ? '' : 'margin-top:8px;';
    rows.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;${marginTop}">
    <tr>${rowTiles.join('')}${fillerCells(cols - rowTiles.length, widthPct)}</tr>
  </table>`);
  }
  return rows.join('\n');
}

function fillerCells(count: number, widthPct: string): string {
  let out = '';
  for (let k = 0; k < count; k++) {
    out += `<td class="stack stack-pad" valign="top" width="${widthPct}" style="padding:0 4px;">&nbsp;</td>`;
  }
  return out;
}

// ------------------------------------------------------------
// Documento — head/CSS + header con badge de tipo + footer
// ------------------------------------------------------------

export interface EmailDocumentOpts {
  /** <title> del documento. */
  title: string;
  /** Texto oculto de vista previa del inbox. */
  preheader: string;
  kind: EmailKind;
  /** Override del badge del header (p.ej. banda "Crisis"/"Alerta" con su color). */
  badge?: { label: string; color: string };
  /** Filas <tr> del contenido, ya renderizadas. */
  contentRows: string;
}

/**
 * Envuelve el contenido en el esqueleto estándar: fondo de página, container
 * de 600px, barra superior del color del tipo, header "ECO Radar" + badge de
 * tipo, contenido y footer con la nota del tipo. El CSS es la unión del que
 * usaban el semanal y la alerta de crisis (probado en Gmail/Outlook/Apple
 * Mail — no tocar sin re-verificar dark mode de Outlook.com).
 */
export function emailDocument(opts: EmailDocumentOpts): string {
  const C = EMAIL_COLORS;
  const meta = EMAIL_KIND_META[opts.kind];
  const badge = opts.badge ?? { label: meta.label, color: meta.color };

  return `<!doctype html>
<html lang="es" style="color-scheme:light only;supported-color-schemes:light only;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${esc(opts.title)}</title>
  <!--[if mso]>
  <style type="text/css">
    table, td, div, h1, h2, h3, p { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; background: ${C.page}; }
    a { text-decoration: none; }
    img { -ms-interpolation-mode: bicubic; }
    /* iOS / Apple Mail: evita auto-detección coloreada de fechas y direcciones */
    .appleLinks a { color: inherit !important; text-decoration: none !important; }
    /* Outlook.com / Office 365 dark mode override — fuerza colores claros */
    [data-ogsc] .force-bg-page { background-color: ${C.page} !important; }
    [data-ogsc] .force-bg-white { background-color: ${C.surface} !important; }
    [data-ogsc] .force-text-dark { color: ${C.ink} !important; }
    [data-ogsc] .force-text-mute { color: ${C.inkSoft} !important; }
    [data-ogsc] .force-text-soft { color: ${C.inkMute} !important; }
    [data-ogsc] .force-border { border-color: ${C.border} !important; }
    /* Gmail iOS: no invertir backgrounds claros */
    u + .body .gmail-dark-fix { background: ${C.page} !important; }
    @media (prefers-color-scheme: dark) {
      .container, .container td, .container div, .container p, .container h1, .container h2, .container h3, .container span, .container strong {
        color-scheme: light only !important;
      }
    }
    @media (max-width: 620px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .px-32 { padding-left: 20px !important; padding-right: 20px !important; }
      .stack { display: block !important; width: 100% !important; }
      .stack-pad { padding: 0 0 10px 0 !important; }
      .kpi-value { font-size: 30px !important; }
      h1.title { font-size: 22px !important; }
      h1.headline { font-size: 22px !important; line-height: 1.25 !important; }
      h2.section-title { font-size: 16px !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">
    ${esc(opts.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="force-bg-page" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" class="container force-bg-white gmail-dark-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="width:600px;max-width:600px;background:${C.surface};background-color:${C.surface};border-radius:10px;overflow:hidden;border:1px solid ${C.border};">

          <!-- BARRA DE TIPO -->
          <tr>
            <td style="background:${badge.color};background-color:${badge.color};height:5px;line-height:5px;font-size:0;padding:0;">&nbsp;</td>
          </tr>

          <!-- HEADER -->
          <tr>
            <td class="px-32" style="padding:18px 32px 14px 32px;border-bottom:1px solid ${C.borderSoft};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <span style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">ECO <span style="color:${C.brand};">Radar</span></span>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;background:${badge.color};color:#FFFFFF;font-size:10.5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 10px;border-radius:4px;">${esc(badge.label)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${opts.contentRows}

          <!-- FOOTER -->
          <tr>
            <td class="px-32" style="padding:20px 32px 22px 32px;border-top:1px solid ${C.borderSoft};" align="center">
              <div class="force-text-soft" style="color:${C.inkMute};font-size:11.5px;line-height:1.6;">
                ECO Radar &nbsp;·&nbsp; IDEA &nbsp;·&nbsp; ${esc(meta.label)}
              </div>
              <div class="force-text-soft" style="margin-top:6px;color:${C.inkMute};font-size:11px;line-height:1.5;">
                ${esc(meta.footerNote)}
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
