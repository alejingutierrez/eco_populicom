/**
 * Template HTML de ALERTA simple — compartido por las alertas de reglas
 * (eco-alerts: sentimiento negativo / keyword / pico de volumen) y las
 * alertas de umbral de métrica (eco-metrics-calculator: Crisis/BHI/…).
 *
 * Reemplaza (jul 2026) el HTML inline sin marca que enviaban ambos lambdas.
 * La alerta de CRISIS editorial tiene su propio template (render-crisis-alert)
 * porque lleva narrativa LLM; este es el formato corto y factual: qué regla
 * disparó, los datos clave en números (formato del dashboard) y, si aplica,
 * la mención que la detonó.
 *
 * Identidad: asunto "[Alerta] …", barra y badge ámbar, footer "alerta".
 */

import {
  EMAIL_COLORS as COLORS,
  esc,
  emailDocument,
} from './chrome';

export interface SimpleAlertRenderData {
  agencyName: string;
  agencyShortName: string;
  /** Nombre de la regla configurada que disparó la alerta. */
  ruleName: string;
  /** Momento de detección, ej. "lun 7 jul · 6:04 a.m. AST". */
  detectedAtLabel: string;
  /** Párrafo principal: qué pasó, en lenguaje claro. HTML inline permitido. */
  leadHtml: string;
  /**
   * Datos clave como filas etiqueta → valor. Los valores numéricos van en el
   * formato del dashboard ("59%", "5.9 / 10") — nunca niveles verbales.
   * `color` opcional para resaltar el valor (hex).
   */
  facts: Array<{ label: string; value: string; color?: string }>;
  /** Mención que detonó la alerta (solo alertas de regla por mención). */
  mention?: {
    sourceLabel: string;
    title: string | null;
    snippet: string;
    url: string | null;
  } | null;
  /** Deeplink al dashboard (opcional — se omite el CTA si falta). */
  dashboardUrl?: string | null;
}

export function renderSimpleAlertHtml(data: SimpleAlertRenderData): string {
  const factsRows = data.facts.map((f, i, arr) => {
    const border = i === arr.length - 1 ? '' : `border-bottom:1px solid ${COLORS.borderSoft};`;
    const valueColor = f.color ?? COLORS.ink;
    return `
      <tr>
        <td class="force-text-soft" style="padding:12px 16px;font-size:11px;font-weight:700;color:${COLORS.inkMute};letter-spacing:0.08em;text-transform:uppercase;${border}width:45%;">${esc(f.label)}</td>
        <td align="right" class="force-text-dark" style="padding:12px 16px;font-size:15px;font-weight:700;color:${valueColor};${border}white-space:nowrap;">${esc(f.value)}</td>
      </tr>`;
  }).join('');

  const mentionBlock = data.mention
    ? `
          <tr>
            <td class="px-32" style="padding:6px 32px 8px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.elevado};margin-bottom:10px;">Mención que la detonó</div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;">
                <tr>
                  <td style="padding:14px 16px;">
                    <div class="force-text-soft" style="font-size:10.5px;color:${COLORS.inkMute};letter-spacing:0.05em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">
                      ${esc(data.mention.sourceLabel)}
                    </div>
                    ${data.mention.title
                      ? `<div class="force-text-dark" style="font-size:14px;font-weight:700;color:${COLORS.ink};line-height:1.4;margin-bottom:4px;">${esc(data.mention.title)}</div>`
                      : ''}
                    <div class="force-text-dark" style="font-size:13px;line-height:1.55;color:${COLORS.inkSoft};">
                      ${esc(data.mention.snippet)}
                    </div>
                    ${data.mention.url
                      ? `<div style="margin-top:8px;"><a href="${esc(data.mention.url)}" style="color:${COLORS.brand};text-decoration:none;font-size:11.5px;font-weight:600;">Ver mención original →</a></div>`
                      : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const ctaBlock = data.dashboardUrl
    ? `
          <tr>
            <td class="px-32" align="center" style="padding:16px 32px 24px 32px;">
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
          </tr>`
    : `
          <tr>
            <td style="padding:0 0 16px 0;font-size:0;line-height:0;">&nbsp;</td>
          </tr>`;

  const contentRows = `
          <!-- HERO -->
          <tr>
            <td class="px-32" style="padding:24px 32px 18px 32px;">
              <div class="force-text-soft" style="font-size:11px;color:${COLORS.inkMute};letter-spacing:0.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px;">
                ${esc(data.agencyShortName)} · ${esc(data.agencyName)} · Alerta automática
              </div>
              <h1 class="headline force-text-dark" style="margin:0 0 10px 0;color:${COLORS.ink};font-size:23px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;">
                ${esc(data.ruleName)}
              </h1>
              <div class="force-text-mute" style="color:${COLORS.inkSoft};font-size:13px;line-height:1.55;">
                Detectada ${esc(data.detectedAtLabel)}
              </div>
              <p class="force-text-dark" style="margin:14px 0 0 0;font-size:14.5px;line-height:1.6;color:${COLORS.ink};">
                ${data.leadHtml}
              </p>
            </td>
          </tr>

          <!-- DATOS CLAVE -->
          <tr>
            <td class="px-32" style="padding:6px 32px 16px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${COLORS.elevado};margin-bottom:10px;">Datos clave</div>
              <table role="presentation" class="force-bg-white force-border" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.surface}" style="background:${COLORS.surface};background-color:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:8px;overflow:hidden;">
                ${factsRows}
              </table>
            </td>
          </tr>
${mentionBlock}
${ctaBlock}`;

  return emailDocument({
    title: `Alerta ECO · ${data.agencyShortName} · ${data.ruleName}`,
    preheader: `Alerta · ${data.agencyShortName} · ${data.ruleName} — detectada ${data.detectedAtLabel}`,
    kind: 'alert',
    contentRows,
  });
}
