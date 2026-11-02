/** Rol 2, redactor (Opus): hallazgos + hechos → todos los bloques en una pasada, cifras por marcador. */
import type { PromptContext } from '../context';
import type { ComposerProfile } from '../profiles';
import { COMPOSER_TEAM_RULES, ROLE_SUFFIX } from '../prompts';
import { draftSchema, normalizeDraft } from '../schemas';
import type { Draft, Findings } from '../types';
import { callRole, type RoleRuntime } from './call';

export function writerSystem(profile: ComposerProfile, systemBase?: string): string {
  return `${systemBase ?? profile.systemBase}\n\n${COMPOSER_TEAM_RULES}\n\n${ROLE_SUFFIX.writer}`;
}

export function writerUser(profile: ComposerProfile, ctx: PromptContext, findings: Findings | null): string {
  const f = findings ? `HALLAZGOS DEL ANALISTA (JSON):\n${JSON.stringify(findings, null, 1)}\n\n` : '';
  return ctx.header + f + ctx.samples + profile.writerTask;
}

export function runWriter(rt: RoleRuntime, profile: ComposerProfile, ctx: PromptContext, findings: Findings | null, model: string, systemBase?: string) {
  return callRole<Draft>(rt, {
    role: 'writer',
    model,
    system: writerSystem(profile, systemBase),
    user: writerUser(profile, ctx, findings),
    tool: { name: 'submit_draft', description: 'Entrega el borrador estructurado.', input_schema: draftSchema(profile.shape) },
    maxTokens: profile.maxTokens.writer,
    normalize: (raw) => normalizeDraft(raw, profile.shape),
  });
}
