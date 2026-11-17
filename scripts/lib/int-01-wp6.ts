/**
 * INT-01 · WP-6 — veredicto de un envío real contra el criterio de cierre:
 * el correo salió con el motor, con los dos bloques (nivel y asuntos) y sin
 * avisos de nivel después del corrector. Puro: lo usan
 * `scripts/int-01-wp6-check.ts` y su prueba.
 */

/** Avisos que rompen el criterio 2 del spec si quedan en el correo enviado. */
export const LEVEL_WARNING_TYPES = ['direccion_sin_nivel', 'mejora_con_nivel_sostenido'] as const;

/** Primer motor que lleva nivel y asuntos (WP-3). */
export const MIN_COMPOSER_VERSION = 'composer-1.1.0';

export interface SendRow {
  slug: string;
  /** 'daily-sentiment-summary' | 'weekly-comparison-v1'. */
  templateKey: string;
  status: string;
  sentAt: string;
  composerVersion: string | null;
  /** `report_send_log.composition` (null si el archivo no se pudo guardar o el correo fue legacy). */
  composition: {
    facts?: Record<string, { id: string; value: number }> | Array<{ id: string; value: number }>;
    warnings?: Array<{ type: string; where?: string; quote?: string }>;
    residualCodeProblems?: Array<{ type: string; where?: string; quote?: string }>;
    degraded?: boolean;
    delivery?: { sentText?: string; mode?: string; compositionSource?: string; interpretationErrors?: string[] };
  } | null;
}

export type Verdict = 'ok' | 'falla' | 'sin_evidencia';

export interface SendVerdict {
  verdict: Verdict;
  /** Hechos `level_*` e `issue_*` archivados (0 = el bloque no entró al correo). */
  levelFacts: number;
  issueFacts: number;
  /** Avisos de nivel que quedaron tras el corrector. */
  levelWarnings: string[];
  reasons: string[];
}

function factIds(c: SendRow['composition']): string[] {
  const f = c?.facts;
  if (!f) return [];
  return Array.isArray(f) ? f.map((x) => x.id) : Object.keys(f);
}

const cmpVersion = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function judgeSend(row: SendRow): SendVerdict {
  const reasons: string[] = [];
  if (row.status !== 'sent') {
    return { verdict: 'falla', levelFacts: 0, issueFacts: 0, levelWarnings: [], reasons: [`estado ${row.status}`] };
  }
  if (!row.composition) {
    // Sin archivo no se puede saber qué llevó el correo: ni OK ni falla.
    return {
      verdict: 'sin_evidencia', levelFacts: 0, issueFacts: 0, levelWarnings: [],
      reasons: ['el envío no dejó composición archivada (correo legacy o fallo al guardar): revisar los logs del lambda'],
    };
  }
  const ids = factIds(row.composition);
  const levelFacts = ids.filter((i) => /^level_(14|28)_neg_pct$/.test(i)).length;
  const issueFacts = ids.filter((i) => /^issue_\d+_/.test(i)).length;
  const all = [...(row.composition.warnings ?? []), ...(row.composition.residualCodeProblems ?? [])];
  const levelWarnings = all
    .filter((w) => (LEVEL_WARNING_TYPES as readonly string[]).includes(w.type))
    .map((w) => `${w.type}${w.where ? ` en ${w.where}` : ''}`);

  if (!row.composerVersion || cmpVersion(row.composerVersion, MIN_COMPOSER_VERSION) < 0) {
    reasons.push(`motor ${row.composerVersion ?? 'sin versión'} (anterior a ${MIN_COMPOSER_VERSION})`);
  }
  if (row.composition.degraded) reasons.push('composición degradada');
  if (row.composition.delivery?.sentText && row.composition.delivery.sentText !== 'composer') {
    reasons.push(`texto enviado: ${row.composition.delivery.sentText}`);
  }
  if (levelFacts < 2) reasons.push('sin nivel a 14 y 28 días');
  // Un día sin asuntos abiertos es válido (el bloque lo dice); solo se anota.
  if (levelWarnings.length) reasons.push(`avisos de nivel tras el corrector: ${levelWarnings.join(', ')}`);
  return { verdict: reasons.length ? 'falla' : 'ok', levelFacts, issueFacts, levelWarnings, reasons };
}

export interface DayVerdict {
  day: string;
  verdict: Verdict | 'sin_envios';
  sends: Array<SendRow & SendVerdict>;
}

/** Un día cuenta si TODOS sus envíos programados están OK. */
export function judgeDay(day: string, rows: SendRow[]): DayVerdict {
  const sends = rows.map((r) => ({ ...r, ...judgeSend(r) }));
  const verdict = !sends.length ? 'sin_envios'
    : sends.some((s) => s.verdict === 'falla') ? 'falla'
      : sends.some((s) => s.verdict === 'sin_evidencia') ? 'sin_evidencia' : 'ok';
  return { day, verdict, sends };
}

/** Racha de días OK seguidos contando desde el final, y cuántos faltan para la meta. */
export function streak(days: DayVerdict[], goal = 7): { run: number; missing: number } {
  let run = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].verdict !== 'ok') break;
    run += 1;
  }
  return { run, missing: Math.max(0, goal - run) };
}
