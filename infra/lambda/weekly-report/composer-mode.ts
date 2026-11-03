/**
 * Bandera del motor de redacción por agencia (`report_configs.composer_mode`)
 * y decisiones de tiempo del correo diario (WP-6). Puro: sin DB, sin red.
 *
 *   legacy   textos actuales (generateInsights + generateDailySummary). Es el
 *            default y con él el correo sale byte a byte igual que antes.
 *   shadow   el motor compone y su composición se ARCHIVA; el correo enviado
 *            sigue siendo el legacy.
 *   agentic  el correo enviado lleva el texto del motor.
 *
 * Regla de oro: NINGÚN camino retiene un correo. Si el motor no está listo a
 * tiempo, o falla, sale el texto legacy y queda registrado por qué.
 */

export type ComposerMode = 'legacy' | 'shadow' | 'agentic';

export const COMPOSER_MODES: readonly ComposerMode[] = ['legacy', 'shadow', 'agentic'];

/** Valor de la DB → modo. Cualquier cosa desconocida (NULL, typo) es `legacy`. */
export function normalizeComposerMode(v: unknown): ComposerMode {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (COMPOSER_MODES as readonly string[]).includes(s) ? (s as ComposerMode) : 'legacy';
}

/**
 * Modo efectivo de una corrida. El override del payload (`composerMode`) solo
 * se respeta en `dryRun`: forzar el motor en un envío real se hace cambiando
 * la fila de `report_configs`, no desde una invocación.
 */
export function resolveComposerMode(dbMode: unknown, override: unknown, dryRun: boolean): ComposerMode {
  if (dryRun && override !== undefined && override !== null) {
    const o = typeof override === 'string' ? override.trim().toLowerCase() : '';
    if ((COMPOSER_MODES as readonly string[]).includes(o)) return o as ComposerMode;
  }
  return normalizeComposerMode(dbMode);
}

// ------------------------------------------------------------------ composición anticipada

/** Horas antes del envío en que el barrido horario dispara la composición. */
export const COMPOSE_LEAD_HOURS = 2;

/** Hora local de la composición anticipada (envío a las 6 → compone a las 4; a la 1 → a las 23). */
export function composeAheadHour(sendHourLocal: number, leadHours = COMPOSE_LEAD_HOURS): number {
  const h = Number.isFinite(sendHourLocal) ? Math.trunc(sendHourLocal) : 6;
  return (((h - leadHours) % 24) + 24) % 24;
}

/** ¿Toca disparar la composición anticipada del diario en esta hora local? */
export function isComposeAheadDue(localHour: number, sendHourLocal: number, mode: ComposerMode): boolean {
  return mode !== 'legacy' && localHour === composeAheadHour(sendHourLocal);
}

/**
 * ¿Toca disparar la composición anticipada del SEMANAL (WP-7)? El semanal
 * sale un solo día (weekly_send_dow, convención JS getDay) a su hora
 * (weekly_send_hour_local): se compone `leadHours` antes, mirando el día y la
 * hora locales de «ahora + leadHours» para que una hora de envío temprana
 * (p. ej. 1 AM del viernes) componga el jueves a las 23. El barrido corre en
 * el minuto 0, así que la comparación por hora es exacta.
 */
export function isWeeklyComposeAheadDue(
  nowUtc: Date,
  timeZone: string,
  weekly: { enabled: boolean; dow: number; hourLocal: number },
  mode: ComposerMode,
  clock: { hourInTimeZone: (d: Date, tz: string) => number; dowInTimeZone: (d: Date, tz: string) => number },
  leadHours = COMPOSE_LEAD_HOURS,
): boolean {
  if (mode === 'legacy' || !weekly.enabled) return false;
  const at = new Date(nowUtc.getTime() + leadHours * 3_600_000);
  return clock.dowInTimeZone(at, timeZone) === weekly.dow && clock.hourInTimeZone(at, timeZone) === weekly.hourLocal;
}

// ------------------------------------------------------------------ presupuesto de tiempo

/**
 * Para componer en el momento (envío sin composición guardada) deben quedar
 * al menos 420 s de ejecución: ~3.5 min del motor + margen. Con menos, sale el
 * texto legacy.
 */
export const MIN_REMAINING_MS_TO_COMPOSE = 420_000;

/**
 * Lo que se reserva al final para el camino legacy (2 llamadas al modelo en
 * paralelo), SES y el registro, si la composición en el momento se pasa de
 * tiempo. El motor recibe como plazo `remaining - LEGACY_RESERVE_MS`.
 */
export const LEGACY_RESERVE_MS = 180_000;

/** Plazo máximo (ms) para una composición en el momento con `remainingMs` de ejecución. */
export function composeDeadlineMs(remainingMs: number): number {
  return Math.max(0, remainingMs - LEGACY_RESERVE_MS);
}

// ------------------------------------------------------------------ decisión del envío

/** Estado de la composición guardada del periodo frente a los datos del momento del envío. */
export type StoredState =
  /** Completa, mismo periodo y las cifras que cita no cambiaron. */
  | 'fresh'
  /** Completa y mismo periodo; alguna cifra citada cambió poco: se re-rellena por código. */
  | 'refreshable'
  /** Completa pero las cifras citadas cambiaron demasiado: hay que recomponer. */
  | 'stale'
  /** No hay fila, está degradada o es de otra ventana. */
  | 'missing';

export type DailyTextPlan =
  /** Textos legacy (modo legacy). */
  | { text: 'legacy'; compose: 'none'; reason: 'mode_legacy' }
  /** Texto del motor tomado de la composición guardada (agentic). */
  | { text: 'composer'; compose: 'stored'; reason: 'stored_fresh' | 'stored_refreshed' }
  /** Componer ahora; el texto final depende del modo y de que el motor responda a tiempo. */
  | { text: 'composer' | 'legacy'; compose: 'now'; reason: 'dry_run' | 'stored_missing' | 'stored_stale' }
  /** Shadow: se envía legacy y se archiva la composición guardada. */
  | { text: 'legacy'; compose: 'stored'; reason: 'shadow_stored' }
  /** Shadow sin composición guardada: se envía legacy y se pide componer aparte (asíncrono). */
  | { text: 'legacy'; compose: 'async'; reason: 'shadow_missing' }
  /** Sin tiempo para componer: legacy. */
  | { text: 'legacy'; compose: 'none'; reason: 'no_time' };

/**
 * Plan del texto del correo diario (y del semanal: misma regla, WP-7).
 * `remainingMs` es el tiempo de ejecución que le queda al lambda en este
 * momento.
 */
export function planDailyText(opts: { mode: ComposerMode; dryRun: boolean; stored: StoredState; remainingMs: number }): DailyTextPlan {
  const { mode, dryRun, stored, remainingMs } = opts;
  if (mode === 'legacy') return { text: 'legacy', compose: 'none', reason: 'mode_legacy' };
  const canCompose = remainingMs > MIN_REMAINING_MS_TO_COMPOSE;
  const text: 'composer' | 'legacy' = mode === 'agentic' ? 'composer' : 'legacy';
  // dryRun siempre compone de cero (sin leer ni escribir la tabla): es la vista previa.
  if (dryRun) return canCompose ? { text, compose: 'now', reason: 'dry_run' } : { text: 'legacy', compose: 'none', reason: 'no_time' };
  if (mode === 'shadow') {
    return stored === 'fresh' || stored === 'refreshable' || stored === 'stale'
      ? { text: 'legacy', compose: 'stored', reason: 'shadow_stored' }
      : { text: 'legacy', compose: 'async', reason: 'shadow_missing' };
  }
  if (stored === 'fresh') return { text: 'composer', compose: 'stored', reason: 'stored_fresh' };
  if (stored === 'refreshable') return { text: 'composer', compose: 'stored', reason: 'stored_refreshed' };
  if (!canCompose) return { text: 'legacy', compose: 'none', reason: 'no_time' };
  return { text: 'composer', compose: 'now', reason: stored === 'stale' ? 'stored_stale' : 'stored_missing' };
}

// ------------------------------------------------------------------ deriva de cifras

/**
 * Tolerancia de deriva de una cifra citada entre la composición anticipada y
 * el envío (llegadas tardías de 4 a 6 AM: medido 0 a 7 menciones por día en
 * DDEC, DF y Gobernadora, 24-oct a 1-nov). Dentro de la tolerancia el texto se
 * re-rellena con la cifra nueva; fuera, se recompone.
 */
export function withinDriftTolerance(prev: number, cur: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return false;
  const d = Math.abs(cur - prev);
  return d <= Math.max(3, Math.abs(prev) * 0.05);
}

/** Ids de hecho citados como marcadores `{{id}}` en un texto o un borrador. */
export function markerIds(value: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') { for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_\-]+)\s*\}\}/g)) ids.add(m[1]); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return Array.from(ids);
}
