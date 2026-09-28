/**
 * Cromo «Instrumento» de los correos ECO (sep 2026 — camino A del rediseño).
 *
 * Es la traducción a correo de la dirección B del sistema de diseño del
 * dashboard (ago 2026): cromo ACROMÁTICO —el grafito es color de acción, no de
 * marca— y todo el color reservado al dato. IBM Plex Sans para el texto y
 * IBM Plex Mono para toda cifra; donde el cliente no carga fuentes web (Gmail)
 * cae a Helvetica / Menlo, que conservan la jerarquía.
 *
 * El tipo de correo ya NO se señala con color (antes: barra azul, badge azul,
 * navy, violeta…). Se señala con una ETIQUETA tipográfica en mono cuyo trazo
 * cambia por tipo. Solo Alerta y Crisis llevan color, porque ahí el color ES
 * el dato (el estado que dispara el correo).
 *
 * Las gráficas se dibujan con tablas HTML en lugar de PNG externos: se ven
 * aunque el cliente bloquee imágenes y hablan la misma paleta que el
 * dashboard. Las imágenes que sí quedan (foto de la nota, miniaturas,
 * retratos, GIFs) son SIEMPRE opcionales: sin URL, el bloque no se emite.
 *
 * Los templates migran a este módulo uno por uno; mientras tanto conviven con
 * `chrome.ts` (que sigue siendo la fuente de EMAIL_KIND_META y buildSubject).
 */

import type { DeltaDisplay, MetricTone } from '../format/metrics-display';
import { EMAIL_KIND_META, esc, type EmailKind } from './chrome';

// ------------------------------------------------------------
// Tokens — hex sólidos (var(--*) no resuelve en clientes de correo)
// ------------------------------------------------------------

export const INSTRUMENT = {
  // Estructura
  page: '#F4F5F6',
  surface: '#FFFFFF',
  subtle: '#FAFAFB',
  line: '#E3E5E8',
  /** Filete fuerte: cierre del encabezado y eje de las gráficas. */
  rule: '#14171C',
  /** Borde de los espacios de imagen mientras cargan / texto de link. */
  lineStrong: '#9AA0A8',

  // Texto
  ink: '#14171C',
  ink2: '#2B3038',
  text2: '#5A616B',
  text3: '#6B7280',

  // Acción (acromática)
  action: '#14171C',
  onAction: '#FFFFFF',

  // Dato — sentimiento
  neg: '#B42318',
  neu: '#8A9099',
  pos: '#1B7F4B',
  /** Serie de referencia (período anterior, barras de contexto). */
  ref: '#C9CCD1',

  // Estado — solo Alerta y Crisis
  warn: '#A15C07',
  crisis: '#B42318',
} as const;

export const FONT_SANS = "'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";
export const FONT_MONO = "'IBM Plex Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";

const T = INSTRUMENT;

// ------------------------------------------------------------
// Etiqueta de tipo — la identidad del correo sin color de marca
// ------------------------------------------------------------

interface KindTag {
  text: string;
  /** CSS de la etiqueta (borde/relleno). */
  style: string;
  /** Filete superior del contenedor: solo los tipos de estado lo tienen. */
  topRule: string | null;
}

function tagStyle(variant: 'outline' | 'solid' | 'dashed' | 'plain', color: string = T.ink): string {
  const base = `display:inline-block;font-family:${FONT_MONO};font-size:11px;font-weight:600;letter-spacing:0.08em;line-height:1;`;
  switch (variant) {
    case 'solid':
      return `${base}background:${color};background-color:${color};color:#FFFFFF;padding:5px 8px;`;
    case 'dashed':
      return `${base}border:1px dashed ${color};color:${color};padding:4px 7px;`;
    case 'plain':
      return `${base}color:${T.text2};padding:4px 0;`;
    default:
      return `${base}border:1px solid ${color};color:${color};padding:4px 7px;`;
  }
}

export const KIND_TAGS: Record<EmailKind, KindTag> = {
  daily: { text: 'DIARIO', style: tagStyle('outline'), topRule: null },
  weekly: { text: 'SEMANAL', style: tagStyle('solid'), topRule: null },
  alert: { text: 'ALERTA', style: tagStyle('outline', T.warn), topRule: T.warn },
  crisis: { text: 'CRISIS', style: tagStyle('solid', T.crisis), topRule: T.crisis },
  appointment: { text: 'NOMBRAMIENTO', style: tagStyle('dashed'), topRule: null },
  welcome: { text: 'BIENVENIDA', style: tagStyle('plain'), topRule: null },
};

// ------------------------------------------------------------
// Primitivas de texto
// ------------------------------------------------------------

/** Cifra en mono. `value` se escapa. */
export function mono(value: string, css = ''): string {
  return `<span style="font-family:${FONT_MONO};${css}">${esc(value)}</span>`;
}

/** Rótulo de sección: "01 · RESUMEN DEL DÍA". */
export function sectionLabel(text: string): string {
  return `<div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${T.text3};margin:0 0 14px 0;">${esc(text)}</div>`;
}

/** Cuadro de color de una serie (leyendas, cabeceras de insight). */
export function swatch(color: string): string {
  return `<span style="display:inline-block;width:8px;height:8px;background:${color};background-color:${color};vertical-align:middle;margin-right:6px;font-size:0;line-height:0;">&nbsp;</span>`;
}

/** Tono del formato compartido → hex del cromo Instrumento. */
export function instrumentToneHex(tone: MetricTone): string {
  switch (tone) {
    case 'neg': return T.neg;
    case 'pos': return T.pos;
    case 'warn': return T.warn;
    case 'accent': return T.ink;
    default: return T.text2;
  }
}

/** "▲ +17 pts" coloreado por tono. Vacío si no hay base de comparación. */
export function deltaMono(dd: DeltaDisplay | null | undefined, color?: string): string {
  if (!dd || !dd.hasBaseline || dd.value == null) return '';
  const c = color ?? instrumentToneHex(dd.tone);
  const arrow = dd.arrow && dd.arrow !== '·' && dd.arrow !== '—' ? `${dd.arrow} ` : '';
  return mono(`${arrow}${dd.value}`, `color:${c};`);
}

/**
 * Color de un delta de CONTEO de sentimiento: que el negativo suba es malo,
 * que el positivo suba es bueno; el neutral no se juzga.
 */
export function sentimentDeltaColor(sentiment: 'negative' | 'neutral' | 'positive', dd: DeltaDisplay | null | undefined): string {
  if (!dd || dd.direction === 'flat' || dd.direction === 'none' || sentiment === 'neutral') return T.text2;
  const up = dd.direction === 'up';
  if (sentiment === 'negative') return up ? T.neg : T.pos;
  return up ? T.pos : T.neg;
}

// ------------------------------------------------------------
// Bloques (cada uno devuelve una fila <tr> del contenedor)
// ------------------------------------------------------------

/** Sección estándar: padding lateral 32, filete inferior. */
export function sectionRow(inner: string, opts: { padding?: string; last?: boolean; bg?: string } = {}): string {
  const border = opts.last ? '' : `border-bottom:1px solid ${T.line};`;
  const bg = opts.bg ? `background:${opts.bg};background-color:${opts.bg};` : '';
  return `
          <tr>
            <td class="px-32" style="padding:${opts.padding ?? '28px 32px'};${border}${bg}">
${inner}
            </td>
          </tr>`;
}

/**
 * Fila de lecturas: N celdas separadas por filetes verticales. Cada celda es
 * rótulo + cifra grande en mono + línea de apoyo (HTML ya armado).
 */
export function readoutRow(cells: Array<{ label: string; valueHtml: string; hintHtml: string }>): string {
  const n = cells.length;
  const w = `${(100 / n).toFixed(2)}%`;
  const tds = cells.map((c, i) => {
    const padL = i === 0 ? 32 : 16;
    const padR = i === n - 1 ? 32 : 16;
    const divider = i === n - 1 ? '' : `border-right:1px solid ${T.line};`;
    const edge = i === 0 ? ' readout-first' : i === n - 1 ? ' readout-last' : '';
    return `<td class="readout${edge}" valign="top" width="${w}" style="padding:18px ${padR}px 16px ${padL}px;${divider}">
                  <div style="font-size:12px;color:${T.text2};line-height:1.3;">${esc(c.label)}</div>
                  <div class="readout-value" style="font-family:${FONT_MONO};font-size:26px;font-weight:500;color:${T.ink};line-height:1.2;margin-top:4px;white-space:nowrap;">${c.valueHtml}</div>
                  <div style="font-family:${FONT_MONO};font-size:12px;color:${T.text2};line-height:1.4;margin-top:4px;">${c.hintHtml || '&nbsp;'}</div>
                </td>`;
  }).join('');
  return `
          <tr>
            <td style="padding:0;border-bottom:1px solid ${T.line};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
                <tr>${tds}</tr>
              </table>
            </td>
          </tr>`;
}

/**
 * Barra horizontal apilada neg · neu · pos. Tabla con anchos en % (Outlook
 * 2016 no soporta flexbox). Las celdas de 0% se omiten para no dejar filos.
 */
export function stackedBar(neg: number, neu: number, pos: number, height = 8): string {
  const total = neg + neu + pos;
  if (total <= 0) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${height}" style="height:${height}px;background:${T.line};background-color:${T.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
  }
  const parts = [
    { v: neg, c: T.neg },
    { v: neu, c: T.neu },
    { v: pos, c: T.pos },
  ].filter((p) => p.v > 0);
  const tds = parts
    .map((p) => `<td width="${((p.v / total) * 100).toFixed(2)}%" height="${height}" bgcolor="${p.c}" style="height:${height}px;background:${p.c};background-color:${p.c};font-size:0;line-height:0;">&nbsp;</td>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${tds}</tr></table>`;
}

export interface ColumnDatum {
  label: string;
  /** Segmentos de abajo hacia arriba. */
  segments: Array<{ value: number; color: string }>;
  /** Resaltar la etiqueta y el total (p.ej. el día pico). */
  emphasis?: boolean;
  /** Marca de periodo parcial: contorno punteado. */
  partial?: boolean;
  /** Texto del total sobre la columna; por defecto la suma. */
  totalLabel?: string;
}

/**
 * Columnas apiladas dibujadas con tablas (sin imagen). Cada columna es una
 * celda alineada abajo con su total arriba y los segmentos en celdas con
 * `height` + `bgcolor`, que es lo único que Outlook de escritorio respeta.
 */
export function columnChart(data: ColumnDatum[], opts: { height?: number; barWidth?: number; alt: string }): string {
  const H = opts.height ?? 120;
  const barW = opts.barWidth ?? 36;
  const max = Math.max(1, ...data.map((d) => d.segments.reduce((s, x) => s + x.value, 0)));
  const colW = `${(100 / Math.max(1, data.length)).toFixed(2)}%`;

  const cols = data.map((d) => {
    const total = d.segments.reduce((s, x) => s + x.value, 0);
    const label = d.totalLabel ?? String(total);
    const weight = d.emphasis ? 600 : 400;
    const labelColor = d.emphasis ? T.ink : T.text2;
    // De arriba hacia abajo en la tabla = segmentos invertidos.
    const segRows = [...d.segments]
      .reverse()
      .filter((s) => s.value > 0)
      .map((s) => {
        const h = Math.max(2, Math.round((s.value / max) * H));
        return `<tr><td height="${h}" bgcolor="${s.color}" style="height:${h}px;background:${s.color};background-color:${s.color};font-size:0;line-height:0;">&nbsp;</td></tr>`;
      })
      .join('');
    const bar = total > 0
      ? `<table role="presentation" width="${barW}" cellpadding="0" cellspacing="0" border="0" style="width:${barW}px;margin:0 auto;${d.partial ? `outline:1px dashed ${T.lineStrong};` : ''}">${segRows}</table>`
      : `<table role="presentation" width="${barW}" cellpadding="0" cellspacing="0" border="0" style="width:${barW}px;margin:0 auto;"><tr><td height="1" style="height:1px;background:${T.line};background-color:${T.line};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
    return `<td width="${colW}" valign="bottom" align="center" style="padding:0 2px;">
                    <div style="font-family:${FONT_MONO};font-size:11px;font-weight:${weight};color:${labelColor};line-height:1;margin-bottom:4px;">${esc(label)}</div>
                    ${bar}
                  </td>`;
  }).join('');

  const labels = data.map((d) => `<td width="${colW}" align="center" style="padding:6px 2px 0 2px;font-family:${FONT_MONO};font-size:11px;color:${d.emphasis ? T.ink : T.text2};line-height:1.2;white-space:nowrap;">${esc(d.label)}</td>`).join('');

  return `<table role="img" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;" aria-label="${esc(opts.alt)}">
                <tr>${cols}</tr>
                <tr><td colspan="${data.length}" height="1" style="height:1px;background:${T.rule};background-color:${T.rule};font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>
                <tr>${labels}</tr>
              </table>`;
}

/**
 * Columnas pareadas: por día, la serie de referencia (periodo anterior, gris)
 * junto a la actual (grafito). Misma técnica de tablas que `columnChart`.
 */
export function pairedColumnChart(
  data: Array<{ label: string; cur: number; prev: number }>,
  opts: { height?: number; barWidth?: number; alt: string },
): string {
  const H = opts.height ?? 120;
  const barW = opts.barWidth ?? 18;
  const max = Math.max(1, ...data.flatMap((d) => [d.cur, d.prev]));
  const colW = `${(100 / Math.max(1, data.length)).toFixed(2)}%`;
  const bar = (v: number, color: string) => {
    const h = v > 0 ? Math.max(2, Math.round((v / max) * H)) : 1;
    const c = v > 0 ? color : T.line;
    return `<td valign="bottom" style="padding:0 1px;"><table role="presentation" width="${barW}" cellpadding="0" cellspacing="0" border="0" style="width:${barW}px;"><tr><td height="${h}" bgcolor="${c}" style="height:${h}px;background:${c};background-color:${c};font-size:0;line-height:0;">&nbsp;</td></tr></table></td>`;
  };
  const cols = data.map((d) => `<td width="${colW}" valign="bottom" align="center" style="padding:0 2px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>${bar(d.prev, T.ref)}${bar(d.cur, T.ink)}</tr></table>
                  </td>`).join('');
  const labels = data.map((d) => `<td width="${colW}" align="center" style="padding:6px 2px 0 2px;font-family:${FONT_MONO};font-size:11px;color:${T.text2};line-height:1.2;">${esc(d.label)}</td>`).join('');
  return `<table role="img" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;" aria-label="${esc(opts.alt)}">
                <tr>${cols}</tr>
                <tr><td colspan="${data.length}" height="1" style="height:1px;background:${T.rule};background-color:${T.rule};font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>
                <tr>${labels}</tr>
              </table>`;
}

/** Lista numerada en mono (viñetas del LLM: HTML inline ya saneado). */
export function numberedList(items: string[], opts: { max?: number; marginTop?: number } = {}): string {
  const clean = items.filter((x) => x && x.trim().length > 0).slice(0, opts.max ?? 4);
  if (!clean.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${opts.marginTop ?? 0}px;">
                ${clean.map((x, i) => `<tr>
                  <td valign="top" width="24" style="width:24px;padding:5px 0;font-family:${FONT_MONO};font-size:14px;line-height:1.5;color:${T.text3};">${i + 1}</td>
                  <td valign="top" class="force-text-dark" style="padding:5px 0;font-size:14px;line-height:1.5;color:${T.ink};">${x}</td>
                </tr>`).join('')}
              </table>`;
}

/**
 * Fila de mención: miniatura 72×72 opcional a la izquierda (sin imagen, el
 * texto ocupa el ancho completo — no queda hueco), línea de metadatos en
 * mono, título/texto y enlace subrayado. Todo el texto se escapa.
 */
export function mentionRow(m: {
  meta: string;
  title?: string | null;
  text?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  linkLabel?: string;
  last?: boolean;
}): string {
  const border = m.last ? '' : `border-bottom:1px solid ${T.line};`;
  const thumb = m.imageUrl
    ? `<td valign="top" width="72" style="width:72px;padding:12px 14px 12px 0;"><img src="${esc(m.imageUrl)}" alt="" width="72" height="72" style="display:block;width:72px;height:72px;object-fit:cover;border:0;background:${T.page};"></td>`
    : '';
  const title = m.title ? `<div style="font-size:14px;font-weight:600;line-height:1.4;color:${T.ink};margin-top:4px;">${esc(m.title)}</div>` : '';
  const text = m.text ? `<div style="font-size:14px;line-height:1.5;color:${T.ink2};margin-top:4px;">${esc(m.text)}</div>` : '';
  const link = m.url
    ? `<div style="margin-top:6px;"><a href="${esc(m.url)}" style="font-size:13px;color:${T.ink};text-decoration:underline;text-decoration-color:${T.lineStrong};">${esc(m.linkLabel ?? 'Ver mención')}</a></div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${border}">
                <tr>
                  ${thumb}
                  <td valign="top" style="padding:12px 0;">
                    <div style="font-family:${FONT_MONO};font-size:12px;color:${T.text2};line-height:1.4;">${esc(m.meta)}</div>
                    ${title}${text}${link}
                  </td>
                </tr>
              </table>`;
}

/**
 * Tabla "actual vs referencia": una fila por medida con su cifra actual, la de
 * referencia y el cambio (HTML ya armado, p.ej. `deltaMono`). La primera fila
 * va en negrita (el total); la columna de referencia se puede ocultar en móvil.
 */
export function compareTable(opts: {
  headers: [string, string, string, string];
  rows: Array<{ labelHtml: string; cur: string; prev: string; changeHtml: string; strong?: boolean }>;
}): string {
  const th = `font-family:${FONT_MONO};font-size:12px;font-weight:400;color:${T.text3};padding:0 0 8px 0;border-bottom:1px solid ${T.rule};`;
  const num = `font-family:${FONT_MONO};font-size:14px;padding:8px 0 8px 10px;white-space:nowrap;`;
  const rows = opts.rows.map((r, i) => {
    const b = i === opts.rows.length - 1 ? '' : `border-bottom:1px solid ${T.line};`;
    return `<tr>
                  <td style="font-size:14px;${r.strong ? 'font-weight:600;' : ''}padding:8px 0;${b}">${r.labelHtml}</td>
                  <td align="right" style="${num}${b}${r.strong ? 'font-weight:600;' : ''}">${r.cur}</td>
                  <td align="right" style="${num}${b}color:${T.text2};">${r.prev}</td>
                  <td align="right" style="${num}${b}">${r.changeHtml}</td>
                </tr>`;
  }).join('');
  const [h0, h1, h2, h3] = opts.headers.map(esc);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <th align="left" style="${th}font-family:${FONT_SANS};">${h0}</th>
                  <th align="right" style="${th}padding-left:10px;">${h1}</th>
                  <th align="right" style="${th}padding-left:10px;">${h2}</th>
                  <th align="right" style="${th}padding-left:10px;">${h3}</th>
                </tr>
                ${rows}
              </table>`;
}

/**
 * Foto de portada (536 × auto, recorte máximo 280). Devuelve '' sin URL: el
 * correo nunca depende de la imagen.
 */
export function heroImage(img: { url: string; alt?: string | null; caption?: string | null } | null | undefined): string {
  if (!img || !img.url) return '';
  const caption = img.caption
    ? `<div style="font-family:${FONT_MONO};font-size:12px;color:${T.text2};line-height:1.4;margin-top:6px;">${esc(img.caption)}</div>`
    : '';
  return `<div style="margin:0 0 14px 0;">
                <img src="${esc(img.url)}" alt="${esc(img.alt ?? '')}" width="536" style="display:block;width:100%;max-width:536px;height:auto;max-height:280px;object-fit:cover;border:0;outline:none;text-decoration:none;background:${T.page};">
                ${caption}
              </div>`;
}

/** Botón de acción grafito (tabla con bgcolor: lo único que respeta Outlook). */
export function actionButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="${T.action}" style="background:${T.action};background-color:${T.action};">
                          <a href="${esc(url)}" style="display:inline-block;padding:14px 22px;font-family:${FONT_SANS};font-size:14px;font-weight:600;color:${T.onAction};text-decoration:none;">${esc(label)}</a>
                        </td>
                      </tr>
                    </table>`;
}

/** Fila de acción: botón grafito + dominio en mono a la derecha. */
export function actionRow(url: string, label: string, domain = 'citizenecho.com'): string {
  return `
          <tr>
            <td class="px-32" style="padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    ${actionButton(url, label)}
                  </td>
                  <td class="hide-mobile" align="right" valign="middle" style="font-family:${FONT_MONO};font-size:12px;color:${T.text3};">${esc(domain)}</td>
                </tr>
              </table>
            </td>
          </tr>`;
}

// ------------------------------------------------------------
// Documento
// ------------------------------------------------------------

export interface InstrumentDocumentOpts {
  /** <title> del documento. */
  title: string;
  /** Texto oculto de vista previa del inbox (lo que se lee bajo el asunto). */
  preheader: string;
  kind: EmailKind;
  /** Override del texto de la etiqueta ("CRISIS · 56%"). */
  tagText?: string;
  /**
   * Override de la etiqueta completa cuando el ESTADO la decide (la banda de
   * una crisis): trazo, color y filete superior del contenedor.
   */
  tagState?: { variant: 'solid' | 'outline'; color: string };
  /**
   * Encabezado del correo: línea de agencia, título y metadatos en mono.
   * `subtitle` va bajo el título (p.ej. el cargo); `aside` es HTML a la
   * izquierda del bloque de texto (el retrato del nombramiento; en móvil pasa
   * arriba); `extraHtml` cierra el encabezado (p.ej. las notas de contexto).
   */
  heading: { kicker: string; title: string; subtitle?: string; meta?: string; aside?: string; extraHtml?: string };
  /** Filas <tr> del contenido, ya renderizadas. */
  contentRows: string;
}

/**
 * Esqueleto estándar: página gris, contenedor blanco de 600 px sin esquinas
 * redondeadas, encabezado «ECO Radar» + etiqueta de tipo cerrado por un
 * filete grafito, contenido, y el pie FUERA del contenedor.
 */
export function instrumentDocument(opts: InstrumentDocumentOpts): string {
  const meta = EMAIL_KIND_META[opts.kind];
  const baseTag = KIND_TAGS[opts.kind];
  const tag = opts.tagState
    ? { text: baseTag.text, style: tagStyle(opts.tagState.variant, opts.tagState.color), topRule: opts.tagState.color }
    : baseTag;
  const topBorder = tag.topRule ? `border-top:3px solid ${tag.topRule};` : `border-top:1px solid ${T.line};`;
  const headingMeta = opts.heading.meta
    ? `<div style="font-family:${FONT_MONO};font-size:12px;color:${T.text3};line-height:1.4;margin-top:6px;">${esc(opts.heading.meta)}</div>`
    : '';

  const subtitle = opts.heading.subtitle
    ? `<div style="font-size:15px;color:${T.ink};line-height:1.4;margin-top:4px;">${esc(opts.heading.subtitle)}</div>`
    : '';
  const headingText = `<div style="font-size:13px;color:${T.text2};line-height:1.4;">${esc(opts.heading.kicker)}</div>
              <h1 class="title force-text-dark" style="margin:4px 0 0 0;font-family:${FONT_SANS};font-size:26px;font-weight:600;letter-spacing:-0.01em;line-height:1.2;color:${T.ink};">${esc(opts.heading.title)}</h1>
              ${subtitle}
              ${headingMeta}`;
  const headingBlock = opts.heading.aside
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                <tr>
                  <td class="stack-mobile" valign="top" width="1" style="width:1px;padding:0 20px 0 0;">${opts.heading.aside}</td>
                  <td class="stack-mobile" valign="top">${headingText}</td>
                </tr>
              </table>`
    : `<div style="margin-top:16px;">${headingText}</div>`;

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
    table, td, div, h1, h2, h3, p, span, a { font-family: Arial, Helvetica, sans-serif !important; }
  </style>
  <![endif]-->
  <!--[if !mso]><!-->
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;display=swap" rel="stylesheet">
  <!--<![endif]-->
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; background: ${T.page}; }
    a { color: ${T.ink}; }
    img { -ms-interpolation-mode: bicubic; }
    .appleLinks a { color: inherit !important; text-decoration: none !important; }
    /* Outlook.com / Office 365 dark mode: fuerza el claro */
    [data-ogsc] .force-bg-page { background-color: ${T.page} !important; }
    [data-ogsc] .force-bg-white { background-color: ${T.surface} !important; }
    [data-ogsc] .force-text-dark { color: ${T.ink} !important; }
    u + .body .gmail-dark-fix { background: ${T.page} !important; }
    @media (prefers-color-scheme: dark) {
      .container, .container td, .container div, .container p, .container h1, .container h2, .container span, .container strong {
        color-scheme: light only !important;
      }
    }
    @media (max-width: 620px) {
      .container { width: 100% !important; }
      .px-32 { padding-left: 20px !important; padding-right: 20px !important; }
      .readout { padding-left: 12px !important; padding-right: 12px !important; }
      .readout-first { padding-left: 20px !important; }
      .readout-last { padding-right: 20px !important; }
      .readout-value { font-size: 22px !important; }
      .stack-mobile { display: block !important; width: 100% !important; padding: 0 0 8px 0 !important; text-align: left !important; }
      .hide-mobile { display: none !important; }
      h1.title { font-size: 22px !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:${T.page};font-family:${FONT_SANS};color:${T.ink};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.page};opacity:0;">
    ${esc(opts.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="force-bg-page" style="background:${T.page};">
    <tr>
      <td align="center" style="padding:24px 0;">
        <table role="presentation" class="container force-bg-white gmail-dark-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.surface}" style="width:600px;max-width:600px;font-family:${FONT_SANS};color:${T.ink};background:${T.surface};background-color:${T.surface};${topBorder}border-bottom:1px solid ${T.line};">

          <!-- ENCABEZADO -->
          <tr>
            <td class="px-32" style="padding:28px 32px 24px 32px;border-bottom:1px solid ${T.rule};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle" style="font-family:${FONT_SANS};font-size:15px;font-weight:600;color:${T.ink};">ECO Radar</td>
                  <td align="right" valign="middle"><span style="${tag.style}">${esc(opts.tagText ?? tag.text)}</span></td>
                </tr>
              </table>
              ${headingBlock}
              ${opts.heading.extraHtml ?? ''}
            </td>
          </tr>

          ${opts.contentRows}

        </table>

        <!-- PIE (fuera del contenedor) -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container" style="width:600px;max-width:600px;">
          <tr>
            <td class="px-32" style="padding:16px 32px 8px 32px;font-size:12px;line-height:1.5;color:${T.text2};">
              <div style="font-family:${FONT_MONO};">ECO Radar · IDEA · ${esc(meta.subjectTag)}</div>
              <div style="margin-top:6px;">${esc(meta.footerNote)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
