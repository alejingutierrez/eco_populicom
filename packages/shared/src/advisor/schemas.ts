// Esquemas de salida estructurada del asesor (spec §5.2 regla 2, §8.6). Fase 0 solo define
// el del revisor. Las salidas de triaje, asientos y memorando llegan con las fases 1 y 2.
// Structured outputs / herramientas estrictas: nunca tool_choice forzado.

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    puntos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ok: { type: 'boolean' },
          nota: { type: 'string' },
        },
        required: ['id', 'ok', 'nota'],
        additionalProperties: false,
      },
    },
    titular_peor: { type: 'string' },
  },
  required: ['puntos', 'titular_peor'],
  additionalProperties: false,
} as const;

export interface ReviewOutput {
  puntos: Array<{ id: number; ok: boolean; nota: string }>;
  titular_peor: string;
}

/**
 * Valida la salida del revisor contra REVIEW_SCHEMA. Devuelve null si no cumple.
 * Tool-use no valida tipos (memoria: coerceBulletList): los campos llegan normalizados aquí.
 */
export function parseReviewOutput(raw: unknown): ReviewOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.puntos) || typeof r.titular_peor !== 'string') return null;
  const puntos: ReviewOutput['puntos'] = [];
  for (const p of r.puntos) {
    if (!p || typeof p !== 'object') return null;
    const q = p as Record<string, unknown>;
    if (typeof q.id !== 'number' || !Number.isInteger(q.id) || typeof q.ok !== 'boolean' || typeof q.nota !== 'string') {
      return null;
    }
    puntos.push({ id: q.id, ok: q.ok, nota: q.nota });
  }
  return { puntos, titular_peor: r.titular_peor };
}
