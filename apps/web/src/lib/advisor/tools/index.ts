import type { AdvisorTool } from '@eco/shared/src/advisor/llm';
import type { AdvisorToolCtx, AdvisorToolResult, AdvisorToolSpec } from './types';
import { errorResult } from './common';
import { situacionActual } from './situacion-actual';
import { comoViajo } from './como-viajo';
import { quienMovioNss } from './quien-movio-nss';
import { municipios } from './municipios';
import { historialAgencia } from './historial-agencia';
import { calendarioLegal } from './calendario-legal';

export type { AdvisorToolCtx, AdvisorToolResult, AdvisorToolSpec } from './types';

/** Orden fijo: los tests lo congelan y la caché del prompt depende de él. */
export const ADVISOR_TOOL_SPECS: AdvisorToolSpec[] = [
  situacionActual,
  comoViajo,
  quienMovioNss,
  municipios,
  historialAgencia,
  calendarioLegal,
];

export function advisorToolDefs(): AdvisorTool[] {
  return ADVISOR_TOOL_SPECS.map((s) => s.def);
}

/**
 * Ejecuta una herramienta por nombre. Nunca lanza: un nombre desconocido, unos
 * argumentos inválidos o un error de base de datos devuelven ok:false.
 */
export async function runAdvisorTool(name: string, args: unknown, ctx: AdvisorToolCtx): Promise<AdvisorToolResult> {
  const spec = typeof name === 'string' ? ADVISOR_TOOL_SPECS.find((s) => s.def.name === name) : undefined;
  if (!spec) {
    const disponibles = ADVISOR_TOOL_SPECS.map((s) => s.def.name).join(', ');
    return errorResult(`Herramienta desconocida «${String(name)}». Herramientas disponibles: ${disponibles}.`);
  }
  try {
    return await spec.run(ctx, args as Record<string, unknown>);
  } catch {
    return errorResult(`No se pudo completar «${name}» por un error interno. Vuelve a intentarlo; si persiste, pide un periodo más corto.`);
  }
}
