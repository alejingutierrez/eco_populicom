/**
 * Episodio de crisis (COR-02, nov 2026).
 *
 * Un EPISODIO es el tramo entre el primer aviso de crisis de una regla y el
 * día en que el índice vuelve bajo el umbral. Antes no existía: cada correo
 * era independiente, así que el reaviso de las 12 horas se leía igual que el
 * primero y nadie avisaba cuando el asunto se apagaba.
 *
 * Aquí vive solo la DECISIÓN (pura, sin base de datos ni reloj): el lambda
 * `eco-metrics-calculator` le pasa lo que midió y hace lo que esto diga.
 *
 * Reglas:
 *  - Sobre el umbral, sin episodio abierto  → primer aviso (abre el episodio).
 *  - Sobre el umbral, con episodio abierto  → reaviso, respetando el cooldown.
 *  - Bajo el umbral, con episodio abierto   → cierre, pero solo cuando:
 *      a) ya hay un día CERRADO posterior o igual al del último aviso (nunca
 *         se cierra el mismo día en que se avisó: el día parcial sube y baja),
 *      b) ese último día cerrado terminó bajo el umbral, y
 *      c) son las 8:00 a.m. o más en Puerto Rico: a esa hora el día de ayer ya
 *         recibió sus menciones tardías y el recálculo de las 5 a.m., y el
 *         correo no llega de madrugada.
 */

export interface CrisisEpisodeValues {
  /** Día calendario de Puerto Rico al que pertenecen las cifras (YYYY-MM-DD). */
  day: string;
  /** Crisis score en escala interna 0–1. */
  score: number;
  severity: number | null;
  totalMentions: number;
  negativeCount: number;
}

export type CrisisEpisodeDecision =
  | { action: 'none'; reason: 'below-threshold' | 'cooldown' | 'close-too-early' | 'close-same-day' | 'closed-day-above' }
  | { action: 'alert'; kind: 'first' | 'followup' }
  | { action: 'close' };

export interface CrisisEpisodeDecisionInput {
  /** El día en curso cruza el umbral (score y severidad mínima). */
  above: boolean;
  /** Episodio abierto de la regla, si lo hay. */
  open: { lastAlertDay: string } | null;
  /** Horas desde el último aviso ENVIADO de la regla (null = nunca). */
  hoursSinceLastAlert: number | null;
  cooldownHours: number;
  /** Día en curso y hora local (0–23) en Puerto Rico. */
  today: string;
  localHour: number;
  /** ¿El último día cerrado (ayer) terminó sobre el umbral? null = sin datos de ese día. */
  lastClosedDayAbove: boolean | null;
  /** Hora local desde la que se permite cerrar (default 8). */
  closeFromHour?: number;
}

export const CRISIS_CLOSE_FROM_HOUR = 8;

export function decideCrisisEpisode(inp: CrisisEpisodeDecisionInput): CrisisEpisodeDecision {
  if (inp.above) {
    if (inp.hoursSinceLastAlert != null && inp.hoursSinceLastAlert < inp.cooldownHours) {
      return { action: 'none', reason: 'cooldown' };
    }
    return { action: 'alert', kind: inp.open ? 'followup' : 'first' };
  }
  if (!inp.open) return { action: 'none', reason: 'below-threshold' };
  if (inp.open.lastAlertDay >= inp.today) return { action: 'none', reason: 'close-same-day' };
  if (inp.localHour < (inp.closeFromHour ?? CRISIS_CLOSE_FROM_HOUR)) return { action: 'none', reason: 'close-too-early' };
  if (inp.lastClosedDayAbove === true) return { action: 'none', reason: 'closed-day-above' };
  return { action: 'close' };
}

/**
 * Aviso por un día ya cerrado (nov-2026).
 *
 * El aviso se decide sobre el día en curso, cada 5 minutos. Pero Brandwatch
 * sigue entregando menciones de un día varias horas después de medianoche, y
 * un día puede cruzar el umbral cuando ya no es «hoy»: nadie lo evaluaba y no
 * salía correo. Pasó en DF el 31-oct-2026 (máximo en curso 38 %, cierre 41 %)
 * y el 1-nov (32 % a las 23:59, cierre 40 %).
 *
 * Regla: a partir de las 8:00 a.m. de Puerto Rico (misma hora que el cierre de
 * episodio, por las mismas razones), si AYER terminó sobre el umbral, no tuvo
 * ningún aviso y el cooldown lo permite, se avisa por ese día. Hoy tiene
 * prioridad: si el día en curso ya está sobre el umbral, avisa por hoy.
 */
export interface ClosedDayCatchUpInput {
  /** El día en curso cruza el umbral (si es así, el aviso normal manda). */
  todayAbove: boolean;
  /** Ayer terminó cruzando el umbral (score y severidad mínima). */
  yesterdayAbove: boolean;
  /** Ya salió algún aviso cuyo día detonante fue ayer. */
  alertSentForYesterday: boolean;
  /** Horas desde el último aviso ENVIADO de la regla (null = nunca). */
  hoursSinceLastAlert: number | null;
  cooldownHours: number;
  /** Hora local (0–23) en Puerto Rico. */
  localHour: number;
  fromHour?: number;
}

export function shouldAlertForClosedDay(inp: ClosedDayCatchUpInput): boolean {
  if (inp.todayAbove) return false;
  if (!inp.yesterdayAbove) return false;
  if (inp.alertSentForYesterday) return false;
  if (inp.localHour < (inp.fromHour ?? CRISIS_CLOSE_FROM_HOUR)) return false;
  if (inp.hoursSinceLastAlert != null && inp.hoursSinceLastAlert < inp.cooldownHours) return false;
  return true;
}

/** Días calendario entre dos YYYY-MM-DD, contando ambos extremos (mínimo 1). */
export function crisisEpisodeDays(openedDay: string, untilDay: string): number {
  const toUtc = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diff = Math.round((toUtc(untilDay) - toUtc(openedDay)) / 86_400_000);
  return Math.max(1, diff + 1);
}

/** El pico del episodio tras incorporar una lectura nueva. */
export function crisisEpisodePeak(
  prev: { score: number; day: string } | null,
  cur: { score: number; day: string },
): { score: number; day: string } {
  if (!prev || cur.score > prev.score) return { score: cur.score, day: cur.day };
  return prev;
}

/** "1 día" / "4 días". */
export function daysLabelEs(n: number): string {
  return n === 1 ? '1 día' : `${n} días`;
}

/** Cambio en puntos porcentuales entre dos scores 0–1 (redondeado sobre lo que se muestra). */
export function scorePointsDelta(cur: number, prev: number): number {
  return Math.round(cur * 100) - Math.round(prev * 100);
}
