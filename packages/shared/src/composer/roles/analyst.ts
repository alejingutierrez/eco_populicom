/** Rol 1, analista (Opus): paquete de hechos + muestras → hallazgos con evidencia por id. */
import type { PromptContext } from '../context';
import type { ComposerProfile } from '../profiles';
import { COMPOSER_TEAM_RULES, ROLE_SUFFIX } from '../prompts';
import { FINDINGS_SCHEMA, normalizeFindings } from '../schemas';
import type { Findings } from '../types';
import { callRole, type RoleRuntime } from './call';

export function analystSystem(profile: ComposerProfile, systemBase?: string): string {
  return `${systemBase ?? profile.systemBase}\n\n${COMPOSER_TEAM_RULES}\n\n${ROLE_SUFFIX.analyst}`;
}

export function analystUser(profile: ComposerProfile, ctx: PromptContext): string {
  return ctx.header + ctx.samples + profile.analystTask;
}

export function runAnalyst(rt: RoleRuntime, profile: ComposerProfile, ctx: PromptContext, model: string, systemBase?: string) {
  return callRole<Findings>(rt, {
    role: 'analyst',
    model,
    system: analystSystem(profile, systemBase),
    user: analystUser(profile, ctx),
    tool: { name: 'submit_findings', description: 'Entrega los hallazgos estructurados.', input_schema: FINDINGS_SCHEMA },
    maxTokens: profile.maxTokens.analyst,
    normalize: normalizeFindings,
  });
}
