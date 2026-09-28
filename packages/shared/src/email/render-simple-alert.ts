/**
 * Template HTML de ALERTA simple — compartido por las alertas de reglas
 * (eco-alerts: sentimiento negativo / keyword / pico de volumen) y las
 * alertas de umbral de métrica (eco-metrics-calculator: Crisis/BHI/…).
 *
 * Cromo «Instrumento» desde sep 2026 (camino A del rediseño de correos). La
 * alerta de CRISIS editorial tiene su propio template (render-crisis-alert)
 * porque lleva narrativa LLM; este es el formato corto y factual: qué regla
 * disparó, un medidor contra el umbral cuando la métrica tiene escala, la
 * mención que la detonó (con su imagen si trae) y los datos clave en números.
 *
 * Identidad: asunto "[Alerta] …", etiqueta y filete ámbar (el estado es el
 * dato: algo cruzó un umbral).
 */

import { esc } from './chrome';
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionRow,
  instrumentDocument,
  sectionLabel,
  sectionRow,
  swatch,
} from './instrument';

export interface SimpleAlertRenderData {
  agencyName: string;
  agencyShortName: string;
  /** Nombre de la regla configurada que disparó la alerta. */
  ruleName: string;
  /** Momento de detección, ej. "lun 7 jul · 6:04 a.m. AST". */
  detectedAtLabel: string;
  /** Qué disparó la alerta: una regla por mención/volumen o una métrica. Default 'rule'. */
  variant?: 'rule' | 'metric';
  /** Párrafo principal: qué pasó, en lenguaje claro. HTML inline permitido. */
  leadHtml: string;
  /**
   * Datos clave como filas etiqueta → valor. Los valores numéricos van en el
   * formato del dashboard ("59%", "5.9 / 10") — nunca niveles verbales.
   * `tone` resalta el valor cuando el color ES el dato (el sentimiento, el
   * valor que cruzó). `color` es legado (hex del cromo viejo): se lee como
   * `tone: 'neg'`.
   */
  facts: Array<{
    label: string;
    value: string;
    tone?: 'neg' | 'warn' | 'pos';
    /** Muestra un cuadro del color del tono antes del valor (sentimiento). */
    swatch?: boolean;
    /** Valor en mono (cifras, umbrales, fechas). */
    mono?: boolean;
    color?: string;
  }>;
  /**
   * Medidor del valor contra el umbral, para métricas con escala acotada
   * (crisis 0–100 %, salud de marca 1–10, polarización 0–100). `fraction` y
   * `thresholdFraction` en 0–1 sobre esa escala.
   */
  gauge?: {
    valueLabel: string;
    caption: string;
    fraction: number;
    thresholdFraction: number;
    scaleStart: string;
    scaleEnd: string;
    thresholdLabel: string;
  } | null;
  /** Mención que detonó la alerta (solo alertas de regla por mención). */
  mention?: {
    sourceLabel: string;
    title: string | null;
    snippet: string;
    url: string | null;
    /** "7 jul, 9:38 a.m." (opcional). */
    publishedAtLabel?: string | null;
    /** Imagen adjunta del post o foto de la nota (opcional). */
    imageUrl?: string | null;
  } | null;
  /** Deeplink al dashboard (opcional — se omite la acción si falta). */
  dashboardUrl?: string | null;
}

function toneHex(tone: 'neg' | 'warn' | 'pos' | undefined, legacyColor?: string): string | null {
  if (tone === 'neg') return T.neg;
  if (tone === 'warn') return T.warn;
  if (tone === 'pos') return T.pos;
  return legacyColor ? T.neg : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function renderGauge(g: NonNullable<SimpleAlertRenderData['gauge']>): string {
  const pct = Math.round(clamp01(g.fraction) * 100);
  const thr = Math.round(clamp01(g.thresholdFraction) * 100);
  // Barra en tabla: relleno ámbar hasta el valor; la marca del umbral es una
  // celda grafito de 2 px en su posición (Outlook no posiciona en absoluto).
  const cells: string[] = [];
  const seg = (w: number, color: string) =>
    w > 0 ? `<td width="${w}%" height="12" bgcolor="${color}" style="height:12px;background:${color};background-color:${color};font-size:0;line-height:0;">&nbsp;</td>` : '';
  if (thr <= pct) {
    cells.push(seg(thr, T.warn), `<td width="2" bgcolor="${T.ink}" style="width:2px;background:${T.ink};font-size:0;line-height:0;">&nbsp;</td>`, seg(pct - thr, T.warn), seg(100 - pct, T.page));
  } else {
    cells.push(seg(pct, T.warn), seg(thr - pct, T.page), `<td width="2" bgcolor="${T.ink}" style="width:2px;background:${T.ink};font-size:0;line-height:0;">&nbsp;</td>`, seg(100 - thr, T.page));
  }
  return sectionRow(`
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="baseline" style="font-family:${FONT_MONO};font-size:48px;font-weight:500;line-height:1;color:${T.warn};padding-right:14px;white-space:nowrap;">${esc(g.valueLabel)}</td>
                  <td valign="baseline" style="font-size:14px;line-height:1.4;color:${T.text2};">${esc(g.caption)}</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin-top:16px;border:1px solid ${T.line};">
                <tr>${cells.join('')}</tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin-top:6px;">
                <tr>
                  <td width="${Math.max(thr, 1)}%" align="left" style="font-family:${FONT_MONO};font-size:11px;color:${T.text2};white-space:nowrap;">${esc(g.scaleStart)}</td>
                  <td align="left" style="font-family:${FONT_MONO};font-size:11px;color:${T.ink};white-space:nowrap;">${esc(g.thresholdLabel)}</td>
                  <td align="right" width="48" style="width:48px;font-family:${FONT_MONO};font-size:11px;color:${T.text2};white-space:nowrap;">${esc(g.scaleEnd)}</td>
                </tr>
              </table>`);
}

/**
 * La mención que detonó la alerta. La imagen va como miniatura 88×88 junto al
 * texto y no a ancho completo: la media de redes que resuelve el processor
 * suele medir ~130 px y estirada saldría borrosa. En redes el título suele
 * ser el inicio del mismo texto; si lo repite, se omite.
 */
function renderMention(m: NonNullable<SimpleAlertRenderData['mention']>): string {
  const meta = [m.sourceLabel, m.publishedAtLabel].filter(Boolean).join(' · ');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const title = m.title && !norm(m.snippet).startsWith(norm(m.title).replace(/…$/, '').slice(0, 60)) ? m.title : null;
  const thumb = m.imageUrl
    ? `<td valign="top" width="88" style="width:88px;padding:0 14px 0 0;"><img src="${esc(m.imageUrl)}" alt="" width="88" height="88" style="display:block;width:88px;height:88px;object-fit:cover;border:0;background:${T.page};"></td>`
    : '';
  return sectionRow(`
              ${sectionLabel('Mención que la detonó')}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.subtle}" style="background:${T.subtle};background-color:${T.subtle};border:1px solid ${T.line};">
                <tr>
                  <td style="padding:16px;">
                    <div style="font-family:${FONT_MONO};font-size:12px;line-height:1.4;color:${T.text2};">${esc(meta)}</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
                      <tr>
                        ${thumb}
                        <td valign="top">
                          ${title ? `<div style="font-size:15px;font-weight:600;line-height:1.4;color:${T.ink};margin-bottom:6px;">${esc(title)}</div>` : ''}
                          <div style="font-size:15px;line-height:1.55;color:${T.ink};">${esc(m.snippet)}</div>
                        </td>
                      </tr>
                    </table>
                    ${m.url ? `<div style="margin-top:10px;"><a href="${esc(m.url)}" style="font-size:13px;color:${T.ink};text-decoration:underline;text-decoration-color:${T.lineStrong};">Ver mención original</a></div>` : ''}
                  </td>
                </tr>
              </table>`);
}

function renderFacts(facts: SimpleAlertRenderData['facts']): string {
  if (!facts.length) return '';
  const rows = facts.map((f, i) => {
    const b = i === facts.length - 1 ? '' : `border-bottom:1px solid ${T.line};`;
    const color = toneHex(f.tone, f.color);
    const sw = f.swatch && color ? swatch(color) : '';
    const valueStyle = `${f.mono ? `font-family:${FONT_MONO};` : ''}${color && !f.swatch ? `color:${color};` : `color:${T.ink};`}`;
    return `<tr>
                  <td class="px-32" valign="top" style="padding:12px 16px 12px 32px;font-size:14px;color:${T.text2};${b}width:40%;">${esc(f.label)}</td>
                  <td class="px-32" valign="top" align="right" style="padding:12px 32px 12px 16px;font-size:14px;line-height:1.45;${b}"><span style="${valueStyle}">${sw}${esc(f.value)}</span></td>
                </tr>`;
  }).join('');
  return `
          <tr>
            <td style="padding:0;border-bottom:1px solid ${T.line};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
            </td>
          </tr>`;
}

export function renderSimpleAlertHtml(data: SimpleAlertRenderData): string {
  const variant = data.variant ?? 'rule';
  const contentRows = [
    sectionRow(`<p style="margin:0;font-family:${FONT_SANS};font-size:16px;line-height:1.55;color:${T.ink2};">${data.leadHtml}</p>`, { padding: '24px 32px' }),
    data.gauge ? renderGauge(data.gauge) : '',
    data.mention ? renderMention(data.mention) : '',
    renderFacts(data.facts),
    data.dashboardUrl ? actionRow(data.dashboardUrl, 'Ver en el dashboard') : '',
  ].filter(Boolean).join('\n');

  return instrumentDocument({
    title: `Alerta ECO · ${data.agencyShortName} · ${data.ruleName}`,
    preheader: `Alerta · ${data.agencyShortName} · ${data.ruleName} — detectada ${data.detectedAtLabel}`,
    kind: 'alert',
    tagText: variant === 'metric' ? 'ALERTA · MÉTRICA' : 'ALERTA · REGLA',
    heading: {
      kicker: `${data.agencyShortName} · Alerta automática`,
      title: data.ruleName,
      meta: `Detectada ${data.detectedAtLabel}`,
    },
    contentRows,
  });
}
