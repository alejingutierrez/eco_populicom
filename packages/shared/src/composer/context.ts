/**
 * Contexto común de los prompts del motor: agencia, periodo, hechos con
 * marcadores y muestras anotadas (port de `ctx` y `samples_txt` del prototipo).
 */
import { factsBlock, type FactPackage } from './facts';
import type { ComposerProfile } from './profiles';
import { samplesBlock } from './samples';
import type { AnnotatedSampleSet, ComposerInput } from './types';

export interface PromptContext {
  /** Agencia, periodo y bloque de hechos. */
  header: string;
  /** Muestras anotadas. */
  samples: string;
}

export function buildPromptContext(profile: ComposerProfile, input: ComposerInput, pkg: FactPackage, samples: AnnotatedSampleSet): PromptContext {
  const tz = input.window.timeZone ?? 'America/Puerto_Rico';
  const w = input.window;
  const lines: string[] = [`AGENCIA: ${input.agency.name}${input.agency.shortName ? ` (abreviada: ${input.agency.shortName})` : ''}`];
  if (profile.scope === 'day') {
    lines.push(`PERIODO: ${w.startYmd} a ${w.endYmd} (días calendario cerrados en ${tz}). DÍA QUE SE RESUME: ${pkg.dayLabel}.`);
  } else {
    let p = `PERIODO QUE SE RESUME: del ${pkg.startLabel} al ${pkg.endLabel} (${pkg.windowDays} días calendario cerrados en ${tz}).`;
    if (w.prevStartYmd && w.prevEndYmd) p += ` PERIODO PREVIO DE COMPARACIÓN: ${w.prevStartYmd} a ${w.prevEndYmd}.`;
    lines.push(p);
  }
  let header = `${lines.join('\n')}\n\nHECHOS (únicas cifras permitidas; refiérelas con el marcador):\n${factsBlock(pkg.facts)}\n\n`;
  if (input.extraContext?.trim()) header += `CONTEXTO ADICIONAL:\n${input.extraContext.trim()}\n\n`;
  const s = samplesBlock(samples, { includeToday: profile.includeTodaySamples, windowDays: pkg.windowDays });
  return { header, samples: s };
}
