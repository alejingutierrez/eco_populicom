/**
 * Rol 3b, QA agente (Sonnet, otra familia de modelo que el redactor):
 * borrador rellenado + muestras + hechos → defectos con cita, tipo y arreglo.
 */
import type { PromptContext } from '../context';
import { draftText } from '../lint';
import type { ComposerProfile } from '../profiles';
import { COMPOSER_QA_SYSTEM } from '../prompts';
import { DEFECTS_SCHEMA, normalizeDefects } from '../schemas';
import type { Draft, QaDefect } from '../types';
import { callRole, type RoleRuntime } from './call';

export function qaUser(profile: ComposerProfile, ctx: PromptContext, filledDraft: Draft): string {
  return `${ctx.header}${ctx.samples}\n\nBORRADOR A REVISAR:\n${draftText(filledDraft)}${profile.qaTask}`;
}

export function runQa(rt: RoleRuntime, profile: ComposerProfile, ctx: PromptContext, filledDraft: Draft, model: string) {
  return callRole<QaDefect[]>(rt, {
    role: 'qa',
    model,
    system: COMPOSER_QA_SYSTEM,
    user: qaUser(profile, ctx, filledDraft),
    tool: { name: 'submit_defects', description: 'Entrega la lista de defectos.', input_schema: DEFECTS_SCHEMA },
    maxTokens: profile.maxTokens.qa,
    normalize: normalizeDefects,
  });
}
