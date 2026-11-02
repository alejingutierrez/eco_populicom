/**
 * Rol 4, corrector (Opus): borrador con marcadores + defectos → borrador
 * corregido. Si una frase no se respalda, se elimina.
 */
import type { PromptContext } from '../context';
import type { ComposerProfile } from '../profiles';
import { COMPOSER_TEAM_RULES, ROLE_SUFFIX } from '../prompts';
import { draftSchema, normalizeDraft } from '../schemas';
import type { CodeDefect, Draft, Findings, QaDefect } from '../types';
import { callRole, type RoleRuntime } from './call';

export function correctorSystem(profile: ComposerProfile, systemBase?: string): string {
  return `${systemBase ?? profile.systemBase}\n\n${COMPOSER_TEAM_RULES}\n\n${ROLE_SUFFIX.corrector}`;
}

export function correctorUser(
  profile: ComposerProfile,
  ctx: PromptContext,
  findings: Findings | null,
  rawDraft: Draft,
  qaDefects: QaDefect[],
  codeDefects: CodeDefect[],
): string {
  const defects = JSON.stringify({ defectos_del_QA: qaDefects, defectos_de_codigo: codeDefects }, null, 1);
  const f = findings ? `HALLAZGOS:\n${JSON.stringify(findings)}\n\n` : '';
  return `${ctx.header}${f}${ctx.samples}\n\nBORRADOR CON MARCADORES ORIGINALES (JSON):\n${JSON.stringify(rawDraft, null, 1)}\n\nDEFECTOS A CORREGIR:\n${defects}${profile.correctorTask}`;
}

export function runCorrector(
  rt: RoleRuntime,
  profile: ComposerProfile,
  ctx: PromptContext,
  findings: Findings | null,
  rawDraft: Draft,
  qaDefects: QaDefect[],
  codeDefects: CodeDefect[],
  model: string,
  systemBase?: string,
) {
  return callRole<Draft>(rt, {
    role: 'corrector',
    model,
    system: correctorSystem(profile, systemBase),
    user: correctorUser(profile, ctx, findings, rawDraft, qaDefects, codeDefects),
    tool: { name: 'submit_draft', description: 'Entrega el borrador corregido.', input_schema: draftSchema(profile.shape) },
    maxTokens: profile.maxTokens.corrector,
    normalize: (raw) => normalizeDraft(raw, profile.shape),
  });
}
