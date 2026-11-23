/**
 * Asuntos abiertos y nivel sostenido dentro del motor (INT-01, spec secciones
 * 2.7, 2.8 y 2.10, WP-3).
 *
 * El motor sabía decir cuánto varió algo contra ayer o contra la semana
 * previa, pero no en qué NIVEL está la negatividad ni desde cuándo sigue
 * abierto un asunto: una baja de volumen podía leerse como mejora (correo de
 * DF del 24-oct-2026). Aquí se le da esa información de tres formas:
 *
 *   1. hechos con marcador (`level_*`, `issue_N_*`), como cualquier otra cifra;
 *   2. un bloque de contexto en palabras para analista, redactor, QA y
 *      corrector, con el veredicto «nivel sostenido: sí / no» ya calculado;
 *   3. un detector por código de «variación sin nivel» y de «mejora con nivel
 *      sostenido» sobre el borrador con marcadores.
 *
 * Los dos detectores son avisos (`soft`): van al corrector y quedan en el
 * archivo. Volverlos regla dura es INT-02.
 */
import { formatLongDay } from '../format-period';
import type { OpenIssue, OpenIssuesResult, OpenIssueStage } from '../narratives/open-issues';
import type { SustainedLevel, SustainedWindow } from '../narratives/sustained-level';
import { listDraftUnits, mapDraft } from './lint';
import { splitSentences, type SafetyNetLogEntry } from './safety-net';
import type { CodeDefect, Draft, Fact } from './types';

const fact = (id: string, value: number, display: string, label: string): Fact => ({ id, value, display, label });

/** Signo tipográfico: «−62», «+2», «0». El lint reconoce el número por su valor absoluto. */
const signedNss = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

// ------------------------------------------------------------------ hechos

function windowFacts(w: SustainedWindow): Fact[] {
  if (!w.enoughBase || w.negPct === null || w.nss === null) return [];
  const span = `del ${formatLongDay(w.startYmd)} al ${formatLongDay(w.endYmd)}`;
  const id = `level_${w.days}`;
  return [
    fact(`${id}_neg_pct`, w.negPct, `${w.negPct} %`, `NIVEL a ${w.days} días: % de negativas sobre todas las menciones de los últimos ${w.days} días (${span}). Es un nivel, no una variación`),
    fact(`${id}_nss`, w.nss, signedNss(w.nss), `NIVEL a ${w.days} días: sentimiento neto (NSS) de los últimos ${w.days} días, con su signo. Es un nivel, no una variación`),
    fact(`${id}_total`, w.total, `${w.total}`, `menciones pertinentes de los últimos ${w.days} días (${span})`),
  ];
}

/** Hechos del nivel sostenido. Una ventana sin base mínima no aporta hechos. */
export function sustainedLevelFacts(level: SustainedLevel | null | undefined): Fact[] {
  if (!level) return [];
  const out = [...windowFacts(level.d14), ...windowFacts(level.d28)];
  if (!out.length) return [];
  out.push(
    fact('level_threshold_neg_pct', level.thresholds.negPct, `${level.thresholds.negPct} %`, 'umbral fijo del % de negativas: en o sobre él, el nivel de negatividad es alto'),
    fact('level_threshold_nss', level.thresholds.nss, signedNss(level.thresholds.nss), 'umbral fijo del sentimiento neto (NSS): en o bajo él, el nivel es alto'),
  );
  return out;
}

const STAGE_ES: Record<OpenIssueStage, string> = { new: 'nuevo', rising: 'sube', falling: 'baja', steady: 'se mantiene' };

/** «Jay Fonseca, con el 39 % de las interacciones» / «sin voz dominante». Sin cifras propias: van por marcador. */
function voiceLabel(i: OpenIssue): string {
  if (!i.voice) return 'sin voz dominante';
  return i.voice.label;
}

/** Hechos de los asuntos abiertos (hasta 3). El nombre del asunto y la voz van en la etiqueta. */
export function openIssueFacts(issues: OpenIssuesResult | null | undefined): Fact[] {
  const out: Fact[] = [];
  (issues?.issues ?? []).slice(0, 3).forEach((i, k) => {
    const id = `issue_${k + 1}`;
    const name = `«${i.name}»`;
    out.push(
      fact(`${id}_days_open`, i.daysOpen, `${i.daysOpen}`, `días que lleva abierto el asunto ${name} (desde el ${formatLongDay(i.openSince)}${i.reopened ? '; volvió tras más de 14 días sin menciones' : ''})`),
      fact(`${id}_week`, i.week, `${i.week}`, `menciones de los últimos 7 días del asunto ${name}`),
      fact(`${id}_prev`, i.prevWeek, `${i.prevWeek}`, `menciones de los 7 días previos del asunto ${name}`),
      fact(`${id}_neg_pct`, i.negPct, `${i.negPct} %`, `% de negativas entre las menciones de los últimos 7 días del asunto ${name}`),
      fact(`${id}_voices`, i.voices, `${i.voices}`, `voces distintas (medios, cuentas y personas) que hablaron del asunto ${name} en los últimos 7 días`),
    );
    if (i.voice) {
      const of = i.voice.basis === 'interactions' ? 'de las interacciones' : 'de las menciones';
      out.push(fact(`${id}_voice_share`, i.voice.sharePct, `${i.voice.sharePct} %`, `% ${of} del asunto ${name} que son de ${i.voice.label} (la voz que más lo empuja)`));
    }
  });
  return out;
}

// ------------------------------------------------------------------ contexto en palabras

/**
 * Bloques «NIVEL SOSTENIDO» y «ASUNTOS ABIERTOS» del prompt. Sin cifras
 * propias: cada cifra va con su marcador. Vacío si no hay ninguno de los dos.
 */
export function interpretationContext(level: SustainedLevel | null | undefined, issues: OpenIssuesResult | null | undefined): string {
  const lines: string[] = [];
  const hasLevel = sustainedLevelFacts(level).length > 0;
  if (level && hasLevel) {
    const w = (x: SustainedWindow) => (x.enoughBase
      ? `a ${x.days} días, {{level_${x.days}_neg_pct}} de negativas y NSS {{level_${x.days}_nss}}`
      : `a ${x.days} días no hay base suficiente`);
    const verdict = level.sustained === null
      ? 'NO SE PUEDE DECIR (falta base en una de las dos ventanas)'
      : level.sustained
        ? 'SÍ: el % de negativas pasa el umbral a 14 y a 28 días'
        : 'NO: el % de negativas no pasa el umbral en las dos ventanas';
    lines.push(
      'NIVEL SOSTENIDO (calculado por código; es el NIVEL de la negatividad, no su variación):',
      `- ${w(level.d14)}; ${w(level.d28)}. Umbral fijo: {{level_threshold_neg_pct}} de negativas y NSS {{level_threshold_nss}}.`,
      `- ¿Nivel sostenido? ${verdict}.`,
      '- Una variación («sube», «baja», un marcador *_delta_*) dice cuánto cambió algo contra ayer o contra la semana previa. No dice si la situación es buena o mala: eso lo dice el nivel. Menos menciones con el mismo % de negativas no es una mejora.',
    );
  }
  const list = issues?.issues ?? [];
  if (issues) {
    if (lines.length) lines.push('');
    lines.push('ASUNTOS ABIERTOS (calculados por código; el correo los muestra en una tabla aparte, no la repitas):');
    if (!list.length) {
      lines.push('- Ninguno cumple la definición esta semana (5 menciones o más en 7 días y actividad en los últimos 3).');
    }
    list.slice(0, 3).forEach((i, k) => {
      const id = `issue_${k + 1}`;
      const voice = i.voice ? `voz que más lo empuja: ${voiceLabel(i)} ({{${id}_voice_share}} ${i.voice.basis === 'interactions' ? 'de las interacciones' : 'de las menciones'})` : 'sin voz dominante';
      lines.push(
        `- ${id}: «${i.name}» · abierto hace {{${id}_days_open}} días (desde el ${formatLongDay(i.openSince)}${i.reopened ? ', reabierto' : ''}) · etapa por volumen: ${STAGE_ES[i.stage]} ({{${id}_week}} menciones en 7 días, {{${id}_prev}} en los 7 previos) · {{${id}_neg_pct}} de negativas · ${voice} · {{${id}_voices}} voces.`,
      );
    });
    if (list.length) {
      lines.push('- La etapa «baja» o «sube» de un asunto habla solo de su volumen; léela junto a su % de negativas. Un asunto con más de tres días abierto no es «nuevo» ni «de hoy»: di cuántos días lleva con su marcador.');
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ detectores

const MARKER_ID_RE = /\{\{([a-zA-Z0-9_\-]+)\}\}/g;

/**
 * Marcadores que son una VARIACIÓN del volumen, de un sentimiento o de un
 * indicador: `day_delta_*`, `week_*_delta_*`, `ind_*_delta`. Los movimientos
 * de tópicos (`topic_up_*`, `*_rise`, `*_drop`) no cuentan: no hablan del
 * nivel de la conversación.
 */
export function isVariationMarker(id: string): boolean {
  return /^(day_delta_|week_(total|neg|neu|pos)_delta_)/.test(id) || /^ind_[a-z]+_delta$/.test(id);
}

/** Marcadores de nivel que deben acompañar a una variación. */
export const LEVEL_MARKERS = ['level_14_neg_pct', 'level_28_neg_pct'] as const;

const SUBJECT_RE = /(volumen|menciones|negativ|positiv|conversaci[oó]n|cr[ií]ticas?|tono|sentimiento|riesgo de crisis|negatividad)/iu;
/**
 * «bajó» y «aumentó» piden la tilde: sin ella son la preposición «bajo» y el
 * sustantivo «aumento» («aumento salarial», DF 23-nov-2026).
 */
const DIRECTION_RE = /(?<![\p{L}])(sub(?:e|en|i[oó]|ieron)|baj(?:a|an|ó|aron)|aument(?:a|an|ó|aron)|ca(?:e|en|y[oó]|yeron)|creci(?:[oó]|eron)|crece[n]?|disminu(?:ye|yen|y[oó]|yeron)|se redu(?:ce|cen|jo|jeron)|descend(?:i[oó]|ieron)|desciende[n]?|se duplic(?:[oó]|aron)|se triplic(?:[oó]|aron))(?![\p{L}])/iu;
/** Nombres citados entre comillas (un asunto, un tópico): no son prosa del redactor. */
const QUOTED_NAME_RE = /«[^»]*»/g;

/**
 * Frases que dicen que la situación mejora o se calma. Con nivel sostenido,
 * no se sostienen. Estas son inequívocas: se marcan donde aparezcan.
 */
export const CALMING_PHRASES: readonly string[] = [
  'va bajando', 'van bajando', 'va a la baja', 'va en descenso', 'sigue bajando', 'siguen bajando',
  'se calma', 'se calmó', 'se calman', 'se enfría', 'se enfrió', 'se enfrían',
  'amaina', 'amainó', 'se disipa', 'se disipó', 'se desinfla', 'se desinfló',
  'pierde fuerza', 'perdió fuerza', 'pierden fuerza', 'pierde intensidad', 'perdió intensidad',
  'se normaliza', 'se normalizó', 'vuelve a la normalidad', 'volvió a la normalidad',
  'baja la tensión', 'bajó la tensión', 'baja la presión', 'bajó la presión', 'se apacigua', 'se apaciguó',
  'tiende a bajar', 'tendencia a la baja',
];

/**
 * Estas otras también se usan para otras cosas («mejora salarial», «cede
 * terrenos»): solo se marcan si el bloque habla de la conversación, el
 * volumen o el sentimiento.
 */
export const CALMING_PHRASES_WEAK: readonly string[] = [
  'mejora', 'mejoró', 'mejoran', 'mejoría', 'cede', 'cedió', 'ceden', 'se alivia', 'se alivió',
  'a la baja', 'se estabiliza', 'se estabilizó', 'un respiro',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRes = (list: readonly string[]) => list.map((phrase) => ({
  phrase,
  re: new RegExp(`(?<![\\p{L}\\p{N}])${phrase.split(/\s+/).map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu'),
}));
const CALMING_RES = /* @__PURE__ */ phraseRes(CALMING_PHRASES);
const CALMING_WEAK_RES = /* @__PURE__ */ phraseRes(CALMING_PHRASES_WEAK);

/** Frases de calma presentes en el texto (las ambiguas, solo si el texto habla de la conversación). */
export function findCalming(text: string): string[] {
  const t = (text ?? '').normalize('NFC');
  const strong = CALMING_RES.filter(({ re }) => re.test(t)).map(({ phrase }) => phrase);
  // «tendencia a la baja» ya contiene «a la baja»: no se repite.
  const weak = SUBJECT_RE.test(t)
    ? CALMING_WEAK_RES.filter(({ re }) => re.test(t)).map(({ phrase }) => phrase).filter((w) => !strong.some((s) => s.includes(w)))
    : [];
  return [...strong, ...weak];
}

const stripHtml = (s: string) => (s ?? '').replace(/<[^>]+>/g, '');

export interface LevelLintContext {
  /** Hechos del paquete (para saber qué marcadores de nivel existen). */
  facts: Record<string, Fact>;
  /** Veredicto de `buildSustainedLevel`. */
  sustained: boolean | null | undefined;
}

/**
 * ¿Este bloque (sin HTML) cita una variación sin los marcadores de nivel?
 * Devuelve la cita (el marcador o el verbo) y los marcadores que faltan.
 */
function unitDirectionDefect(text: string, required: readonly string[]): { quote: string; missing: string[] } | null {
  const ids = Array.from(text.matchAll(MARKER_ID_RE), (m) => m[1]);
  const variation = ids.find(isVariationMarker);
  const plain = text.replace(MARKER_ID_RE, ' ');
  const verb = !variation && SUBJECT_RE.test(plain) ? plain.replace(QUOTED_NAME_RE, ' ').match(DIRECTION_RE)?.[0] : undefined;
  if (!variation && !verb) return null;
  const missing = required.filter((id) => !ids.includes(id));
  if (!missing.length) return null;
  return { quote: variation ? `{{${variation}}}` : verb!, missing };
}

/**
 * Detectores sobre el borrador CON MARCADORES (antes de rellenar):
 *
 *  - `direccion_sin_nivel`: un bloque (párrafo, viñeta, insight, ítem de
 *    comparación) cita una variación —por marcador, o con un verbo de dirección
 *    aplicado al volumen, las menciones o el sentimiento— y no cita el nivel a
 *    14 y a 28 días en ese mismo bloque. El titular no lleva cifras, así que no
 *    se le pide el nivel.
 *  - `mejora_con_nivel_sostenido`: con nivel sostenido, cualquier bloque
 *    (también el titular) que diga que la situación mejora, se calma o va
 *    bajando.
 *
 * Sin hechos de nivel en el paquete no devuelve nada: el motor se comporta
 * como antes.
 */
export function directionLevelDefects(raw: Draft, ctx: LevelLintContext): CodeDefect[] {
  const required = LEVEL_MARKERS.filter((id) => ctx.facts[id]);
  if (!required.length) return [];
  const out: CodeDefect[] = [];
  for (const u of listDraftUnits(raw)) {
    const text = stripHtml(u.text);
    if (!text.trim()) continue;
    if (ctx.sustained === true) {
      for (const phrase of findCalming(text.replace(MARKER_ID_RE, ' '))) {
        out.push({ where: u.where, type: 'mejora_con_nivel_sostenido', quote: phrase, severity: 'soft' });
      }
    }
    if (u.kind === 'headline') continue;
    const d = unitDirectionDefect(text, required);
    if (d) out.push({ where: u.where, type: 'direccion_sin_nivel', quote: d.quote, severity: 'soft' });
  }
  return out;
}

/** Texto que explica al corrector qué hacer con cada defecto de este módulo. */
export const LEVEL_DEFECT_HELP = `
- defecto de código 'direccion_sin_nivel': ese bloque cita una variación (sube, baja, un marcador *_delta_*) sin el nivel. Añade en ese mismo bloque el nivel a 14 y a 28 días con {{level_14_neg_pct}} y {{level_28_neg_pct}} (por ejemplo: «…; a 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}»), o quita la variación si no aporta.
- defecto de código 'direccion_contradice_cifra': el texto dice que algo sube y su marcador es negativo, o que baja y es positivo. Corrige el verbo para que coincida con la cifra del marcador; no cambies el marcador.
- defecto de código 'mejora_con_nivel_sostenido': el nivel de negatividad es sostenido y ese bloque dice que la situación mejora, se calma o va bajando. Quita esa afirmación. Puedes decir que el volumen o las menciones bajaron, con su marcador y con el nivel al lado.`;

// ------------------------------------------------------------------ red de seguridad de nivel

/** Oración con el nivel que falta, con marcadores (las cifras las pone `fillDraft`). */
export function levelSentence(missing: readonly string[]): string {
  const days = (id: string) => (id === 'level_14_neg_pct' ? 14 : 28);
  if (missing.length >= 2) {
    return 'A 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}.';
  }
  return `A ${days(missing[0])} días el {{${missing[0]}}} de las menciones es negativo.`;
}

const hasPhrase = (text: string, phrase: string) => phraseRes([phrase])[0].re.test(stripHtml(text).replace(MARKER_ID_RE, ' ').normalize('NFC'));
const closed = (s: string) => (/[.!?…]["”»)]?$/.test(stripHtml(s).trim()) ? s : `${s.trimEnd()}.`);

/**
 * Lo que el corrector no resolvió lo resuelve el código, antes de rellenar y
 * de enviar (INT-01 criterio 2, INT-02): ningún correo sale con una variación
 * sin su nivel ni con una frase de calma cuando el nivel es sostenido.
 *
 *  - `mejora_con_nivel_sostenido`: se quita la oración que lo dice. Un titular
 *    queda vacío y la red de seguridad pone el determinista.
 *  - `direccion_sin_nivel`: tras la oración que cita la variación se añade el
 *    nivel a 14 y a 28 días (los marcadores que falten).
 *
 * Trabaja sobre el borrador CON MARCADORES y es determinista: el re-relleno de
 * una composición guardada lo aplica igual y obtiene el mismo texto. Cada
 * cambio queda en el registro con el antes (`text`) y el después (`after`).
 */
export function enforceLevelRules(raw: Draft, ctx: LevelLintContext): { draft: Draft; log: SafetyNetLogEntry[] } {
  const defects = directionLevelDefects(raw, ctx);
  if (!defects.length) return { draft: raw, log: [] };
  const required = LEVEL_MARKERS.filter((id) => ctx.facts[id]);
  const log: SafetyNetLogEntry[] = [];
  const draft = mapDraft(raw, (text, where, kind) => {
    const mine = defects.filter((d) => d.where === where);
    if (!mine.length) return text;
    let out = text;

    const calm = mine.filter((d) => d.type === 'mejora_con_nivel_sostenido');
    if (calm.length) {
      const before = out;
      out = kind === 'headline'
        ? ''
        : splitSentences(out).filter((s) => !calm.some((d) => hasPhrase(s, d.quote))).join(' ');
      log.push({ action: 'frase_removida', where, text: before, after: out, reasons: calm });
    }

    if (kind === 'headline') return out;
    const dir = unitDirectionDefect(stripHtml(out), required);
    if (dir) {
      const before = out;
      const sentences = splitSentences(out);
      const at = Math.max(0, sentences.findIndex((s) => stripHtml(s).includes(dir.quote)));
      sentences[at] = closed(sentences[at] ?? '');
      sentences.splice(at + 1, 0, levelSentence(dir.missing));
      out = sentences.join(' ').trim();
      log.push({
        action: 'nivel_añadido', where, text: before, after: out,
        reasons: [{ where, type: 'direccion_sin_nivel', quote: dir.quote, severity: 'soft' }],
      });
    }
    return out;
  });
  return { draft, log };
}
