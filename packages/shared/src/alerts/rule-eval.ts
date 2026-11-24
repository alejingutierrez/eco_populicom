/**
 * Reglas de alerta por mención (COR-04, nov 2026).
 *
 * `eco-alerts` evalúa tres tipos de regla cada vez que el processor clasifica
 * una mención: palabra clave, pico de volumen y proporción negativa. Hasta
 * COR-04 ninguna tenía freno: «negative_sentiment» avisaba por CADA mención
 * negativa (ignoraba su propio umbral) y «volume_spike» por cada mención
 * mientras el conteo siguiera arriba. Mientras solo una persona podía crear
 * reglas eso no se notó; al abrir la pantalla a todos, una regla así manda
 * cientos de correos al día a los destinatarios de una agencia.
 *
 * Aquí viven las decisiones puras (sin base de datos), para poder probarlas:
 * el cooldown de cada regla y cuándo dispara cada tipo.
 */

export type MentionRuleType = 'keyword' | 'volume_spike' | 'negative_sentiment';

export const MENTION_RULE_TYPES: readonly MentionRuleType[] = ['keyword', 'volume_spike', 'negative_sentiment'];

/** Horas mínimas entre dos avisos de la misma regla cuando la regla no lo fija. */
export const DEFAULT_MENTION_RULE_COOLDOWN_HOURS: Record<MentionRuleType, number> = {
  keyword: 1,
  volume_spike: 6,
  negative_sentiment: 6,
};

/** Mínimo de menciones en la ventana para que una proporción negativa signifique algo. */
export const NEGATIVE_SHARE_MIN_MENTIONS = 10;

type LooseConfig = Record<string, unknown> | null | undefined;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Cooldown de la regla en horas: `cooldownHours` (o `cooldown_hours`) entre 1 y 168, o el default del tipo. */
export function mentionRuleCooldownHours(config: LooseConfig): number {
  const type = config?.type as MentionRuleType;
  const explicit = num(config?.cooldownHours) ?? num(config?.cooldown_hours);
  if (explicit != null && explicit >= 1 && explicit <= 168) return explicit;
  return DEFAULT_MENTION_RULE_COOLDOWN_HOURS[type] ?? 6;
}

/** ¿La regla sigue en cooldown? `lastTriggeredAt` null = nunca disparó. */
export function inCooldown(lastTriggeredAt: Date | null, now: Date, cooldownHours: number): boolean {
  if (!lastTriggeredAt) return false;
  return now.getTime() - lastTriggeredAt.getTime() < cooldownHours * 60 * 60 * 1000;
}

/**
 * Parámetros de un pico de volumen. Devuelve null si la regla está mal formada
 * (las creadas desde un detalle antes de COR-04 guardaban `threshold` como
 * objeto): una regla así no dispara nunca, en vez de disparar siempre.
 */
export function volumeSpikeParams(config: LooseConfig): { threshold: number; windowMinutes: number } | null {
  const threshold = num(config?.threshold);
  if (threshold == null || threshold < 1) return null;
  const w = num(config?.window_minutes) ?? 60;
  return { threshold, windowMinutes: Math.min(Math.max(w, 5), 24 * 60) };
}

/** Parámetros de la proporción negativa, con defaults para reglas viejas sin umbral. */
export function negativeShareParams(config: LooseConfig): { thresholdPct: number; windowHours: number } {
  const pct = num(config?.threshold_pct);
  const hours = num(config?.window_hours);
  return {
    thresholdPct: pct != null && pct > 0 && pct <= 100 ? pct : 50,
    windowHours: hours != null && hours >= 1 && hours <= 168 ? hours : 24,
  };
}

/** ¿La proporción negativa de la ventana cruza el umbral, con muestra suficiente? */
export function negativeShareTriggered(total: number, negative: number, thresholdPct: number): boolean {
  if (total < NEGATIVE_SHARE_MIN_MENTIONS) return false;
  return (negative / total) * 100 >= thresholdPct;
}

/** Palabras clave limpias de una regla (sin vacías, en minúsculas). */
export function keywordList(config: LooseConfig): string[] {
  const raw = Array.isArray(config?.keywords) ? (config!.keywords as unknown[]) : [];
  return raw.filter((k): k is string => typeof k === 'string').map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2);
}

/**
 * Valida la `config` de una regla antes de guardarla. La comparten el
 * endpoint que la guarda y las pruebas; el lambda tolera además las reglas
 * viejas mal formadas (no disparan).
 */
export function validateMentionRuleConfig(config: LooseConfig): { ok: true } | { ok: false; error: string } {
  const type = config?.type;
  const cd = config?.cooldownHours;
  if (cd != null && (num(cd) == null || (cd as number) < 1 || (cd as number) > 168)) {
    return { ok: false, error: 'cooldownHours debe estar entre 1 y 168' };
  }
  if (type === 'keyword') {
    const kws = keywordList(config);
    if (kws.length === 0) return { ok: false, error: 'al menos una palabra clave de 2 o más letras' };
    if (kws.length > 20) return { ok: false, error: 'máximo 20 palabras clave' };
    const s = config?.sentiment;
    if (s != null && s !== 'negativo' && s !== 'neutral' && s !== 'positivo') return { ok: false, error: 'sentiment inválido' };
    return { ok: true };
  }
  if (type === 'volume_spike') {
    const t = num(config?.threshold);
    if (t == null || t < 5) return { ok: false, error: 'threshold debe ser un número de 5 o más menciones' };
    const w = num(config?.window_minutes);
    if (w == null || w < 15 || w > 24 * 60) return { ok: false, error: 'window_minutes debe estar entre 15 y 1440' };
    return { ok: true };
  }
  if (type === 'negative_sentiment') {
    const p = num(config?.threshold_pct);
    if (p == null || p < 5 || p > 100) return { ok: false, error: 'threshold_pct debe estar entre 5 y 100' };
    const h = num(config?.window_hours);
    if (h == null || h < 1 || h > 168) return { ok: false, error: 'window_hours debe estar entre 1 y 168' };
    return { ok: true };
  }
  return { ok: false, error: 'tipo de regla por mención desconocido' };
}
