/**
 * Bloques de INT-01 para los correos (Diario y Semanal): la línea de nivel
 * sostenido y la tabla de asuntos abiertos. Los pinta el código a partir de
 * `buildSustainedLevel` y `buildOpenIssues`; el modelo no escribe nada de aquí.
 *
 * Todo numérico (regla de los correos): la etapa de un asunto va siempre con
 * sus dos cifras y con su % de negativas, y el nivel siempre con el umbral.
 */
import { formatShortDay } from '../format-period';
import type { OpenIssue, OpenIssuesResult, OpenIssueStage } from '../narratives/open-issues';
import type { SustainedLevel, SustainedWindow } from '../narratives/sustained-level';
import { esc, fmtInt } from './chrome';
import { INSTRUMENT as T, FONT_MONO, sectionLabel, sectionRow } from './instrument';

const MINUS = '−';
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : '0');

// ------------------------------------------------------------------ nivel sostenido

function windowCell(w: SustainedWindow, thresholdNeg: number): string {
  const label = `<span style="color:${T.text3};">${w.days} días</span>`;
  if (!w.enoughBase || w.negPct === null || w.nss === null) {
    return `${label} base insuficiente (${fmtInt(w.total)} menciones)`;
  }
  const color = w.overNegPct ? T.neg : T.ink;
  return `${label} <span style="color:${color};font-weight:500;">${w.negPct}% negativo</span> · NSS ${signed(w.nss)}`;
}

/** Texto plano del nivel, para el `alt`, el preheader y las pruebas. */
export function sustainedLevelText(level: SustainedLevel): string {
  const w = (x: SustainedWindow) => (x.enoughBase && x.negPct !== null && x.nss !== null
    ? `${x.days} días: ${x.negPct}% negativo, NSS ${signed(x.nss)}`
    : `${x.days} días: base insuficiente`);
  return `Nivel · ${w(level.d14)} · ${w(level.d28)} · umbral ${level.thresholds.negPct}% y NSS ${signed(level.thresholds.nss)}`;
}

/**
 * Caja del nivel a 14 y 28 días contra el umbral fijo. Va pegada a los grupos
 * de variaciones del correo para que una baja de volumen no se lea sola.
 * Vacía sin nivel.
 */
export function sustainedLevelBox(level: SustainedLevel | null | undefined, opts: { marginTop?: number } = {}): string {
  if (!level) return '';
  const th = level.thresholds;
  return `
              <div style="margin-top:${opts.marginTop ?? 0}px;padding:8px 10px;border:1px solid ${T.line};font-family:${FONT_MONO};font-size:12px;line-height:1.7;color:${T.ink2};">
                <div><span style="color:${T.text2};">Nivel de negatividad</span> <span style="color:${T.text3};">· no es la variación</span></div>
                <div>${windowCell(level.d14, th.negPct)}</div>
                <div>${windowCell(level.d28, th.negPct)}</div>
                <div style="color:${T.text2};">umbral ${th.negPct}% negativo · NSS ${signed(th.nss)}</div>
              </div>`;
}

/** El nivel como fila propia del correo (bajo las lecturas). Vacía sin nivel. */
export function sustainedLevelRow(level: SustainedLevel | null | undefined): string {
  const box = sustainedLevelBox(level);
  return box ? sectionRow(box, { padding: '14px 32px' }) : '';
}

// ------------------------------------------------------------------ asuntos abiertos

const STAGE_WORD: Record<OpenIssueStage, string> = { new: 'nuevo', rising: 'sube', falling: 'baja', steady: 'se mantiene' };

function daysText(n: number): string {
  return n === 1 ? '1 día abierto' : `${fmtInt(n)} días abierto`;
}

/** «Jay Fonseca · 39% de las interacciones · 87 voces» / «sin voz dominante · 6 voces». */
export function issueVoiceText(i: OpenIssue): string {
  const voices = i.voices === 1 ? '1 voz' : `${fmtInt(i.voices)} voces`;
  if (!i.voice) return `sin voz dominante · ${voices}`;
  const of = i.voice.basis === 'interactions' ? 'de las interacciones' : 'de las menciones';
  return `${i.voice.label} · ${i.voice.sharePct}% ${of} · ${voices}`;
}

/** Línea de etapa: «sube · 121 esta semana · 57 la previa». */
export function issueStageText(i: OpenIssue): string {
  return `${STAGE_WORD[i.stage]} · ${fmtInt(i.week)} en 7 días · ${fmtInt(i.prevWeek)} en los 7 previos`;
}

function issueRow(i: OpenIssue, k: number, last: boolean, negThreshold: number): string {
  const border = last ? '' : `border-bottom:1px solid ${T.line};`;
  const negColor = i.negPct >= negThreshold ? T.neg : T.ink;
  const since = `desde el ${formatShortDay(i.openSince)}${i.reopened ? ' · reabierto' : ''}`;
  const lead = i.lead ? `<div style="font-size:12px;line-height:1.45;color:${T.text2};margin-top:2px;">Lo más activo: ${esc(i.lead.name)}</div>` : '';
  return `<tr>
                  <td valign="top" width="24" style="width:24px;padding:10px 0;${border}font-family:${FONT_MONO};font-size:14px;line-height:1.4;color:${T.text3};">${k + 1}</td>
                  <td valign="top" style="padding:10px 0;${border}">
                    <div class="force-text-dark" style="font-size:14px;font-weight:600;line-height:1.35;color:${T.ink};">${esc(i.name)}</div>${lead}
                    <div style="font-family:${FONT_MONO};font-size:12px;line-height:1.6;color:${T.ink2};margin-top:4px;">${esc(daysText(i.daysOpen))} <span style="color:${T.text3};">· ${esc(since)}</span></div>
                    <div style="font-family:${FONT_MONO};font-size:12px;line-height:1.6;color:${T.ink2};">${esc(issueStageText(i))} · <span style="color:${negColor};font-weight:500;">${i.negPct}% negativas</span></div>
                    <div style="font-size:12px;line-height:1.6;color:${T.text2};">Voz principal: ${esc(issueVoiceText(i))}</div>
                  </td>
                </tr>`;
}

/**
 * Sección «Asuntos abiertos»: hasta 3 asuntos con días abierto, etapa, % de
 * negativas y voz principal, y al pie la cobertura. Sin asuntos, lo dice (no
 * se omite). `null` → cadena vacía (correo legacy o carga fallida).
 */
export function openIssuesSection(
  issues: OpenIssuesResult | null | undefined,
  sec: string,
  opts: { negThresholdPct?: number } = {},
): string {
  if (!issues) return '';
  const list = issues.issues.slice(0, 3);
  const th = opts.negThresholdPct ?? 30;
  const body = list.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${list.map((i, k) => issueRow(i, k, k === list.length - 1, th)).join('\n                ')}
              </table>`
    : `<div style="font-size:13px;line-height:1.5;color:${T.text2};">Sin asuntos abiertos esta semana: ninguna historia tuvo ${issues.thresholds.minWeek} menciones o más en 7 días con actividad en los últimos ${issues.thresholds.recentDays}.</div>`;
  const c = issues.coverage;
  const more = issues.openCount > list.length ? ` · ${fmtInt(issues.openCount)} asuntos abiertos en total` : '';
  const foot = c.pct !== null
    ? `<div style="margin-top:10px;font-family:${FONT_MONO};font-size:12px;line-height:1.5;color:${T.text2};">${c.pct} de cada 100 menciones de los 7 días pertenecen a un asunto identificado${more}</div>`
    : '';
  return sectionRow(`
              ${sectionLabel(`${sec} · Asuntos abiertos`)}
              ${body}
              ${foot}`);
}

/** Oración para la nota de metodología (texto plano, sin cifras fuera de las reglas). */
export function interpretationMethodologyNote(level: SustainedLevel | null | undefined, issues: OpenIssuesResult | null | undefined): string {
  const parts: string[] = [];
  if (level) {
    parts.push(`El nivel de negatividad es el % de menciones negativas y el sentimiento neto de los últimos 14 y 28 días cerrados, contra un umbral fijo de ${level.thresholds.negPct}% y ${signed(level.thresholds.nss)}; no es una variación.`);
  }
  if (issues) {
    parts.push(`Un asunto abierto agrupa las historias del mismo caso con ${issues.thresholds.minWeek} menciones o más en 7 días y actividad en los últimos ${issues.thresholds.recentDays}; los días abierto se cuentan desde su primera mención, o desde que volvió tras más de ${issues.thresholds.gapDays} días sin menciones. La voz principal es el medio o la cuenta con más interacciones.`);
  }
  return parts.join(' ');
}
