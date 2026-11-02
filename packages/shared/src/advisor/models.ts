// Roles del asesor → modelo, esfuerzo y tope de salida (spec §5.3).
// Los IDs son los perfiles `us.*` de bedrock-runtime (backend `runtime`, plan B).
// Mantle sirve Opus 5.5 pero no Sonnet/Haiku 5.5 (docs/manejo-de-crisis/investigacion/13).

export type AdvisorTier = 'FAST' | 'MAIN' | 'DEEP';
export type AdvisorEffort = 'low' | 'medium' | 'high';
export type AdvisorRole =
  | 'triage'
  | 'camino1'
  | 'analyst_r0'
  | 'contention'
  | 'seat'
  | 'opposition'
  | 'devils_advocate'
  | 'moderator_group'
  | 'moderator_memo'
  | 'reviewer';

export interface AdvisorRoleConfig {
  tier: AdvisorTier;
  effort: AdvisorEffort;
  maxTokens: number;
}

export const ADVISOR_ROLES: Record<AdvisorRole, AdvisorRoleConfig> = {
  triage: { tier: 'FAST', effort: 'low', maxTokens: 1000 },
  camino1: { tier: 'MAIN', effort: 'medium', maxTokens: 8000 },
  analyst_r0: { tier: 'MAIN', effort: 'medium', maxTokens: 12000 },
  contention: { tier: 'MAIN', effort: 'low', maxTokens: 2000 },
  seat: { tier: 'MAIN', effort: 'low', maxTokens: 3000 },
  opposition: { tier: 'MAIN', effort: 'low', maxTokens: 3000 },
  devils_advocate: { tier: 'DEEP', effort: 'medium', maxTokens: 5000 },
  moderator_group: { tier: 'DEEP', effort: 'medium', maxTokens: 6000 },
  moderator_memo: { tier: 'DEEP', effort: 'medium', maxTokens: 12000 },
  reviewer: { tier: 'FAST', effort: 'low', maxTokens: 2000 },
};

const DEFAULT_MODEL_IDS: Record<AdvisorTier, string> = {
  FAST: 'us.anthropic.claude-haiku-5-5',
  MAIN: 'us.anthropic.claude-sonnet-5-5',
  DEEP: 'us.anthropic.claude-opus-5-5',
};

export type AdvisorBackend = 'runtime' | 'mantle';

/** Lee `ADVISOR_LLM_BACKEND`. Solo `runtime` está cableado en fase 0. */
export function advisorBackend(env: Record<string, string | undefined> = process.env): AdvisorBackend {
  const v = (env.ADVISOR_LLM_BACKEND ?? 'runtime').trim().toLowerCase();
  if (v === 'runtime' || v === 'mantle') return v;
  throw new Error(`ADVISOR_LLM_BACKEND inválido: "${v}" (esperado runtime | mantle)`);
}

/** Modelo para un nivel. Configurable con ADVISOR_MODEL_FAST / _MAIN / _DEEP. */
export function advisorModelId(tier: AdvisorTier, env: Record<string, string | undefined> = process.env): string {
  const key = `ADVISOR_MODEL_${tier}` as const;
  return env[key]?.trim() || DEFAULT_MODEL_IDS[tier];
}

/**
 * Precios por millón de tokens, USD. Versionado: cambiar aquí y subir `version`.
 * `verified: false` = cifras de fuentes secundarias (octubre 2026) que citan la
 * página de precios de Anthropic; confirmar antes de usar en topes de costo.
 * Opus 5.5 sin cifra: el costo de esa ruta queda `null`, no se estima.
 */
export const ADVISOR_PRICING = {
  version: '2026-10-28',
  models: {
    'us.anthropic.claude-haiku-5-5': {
      input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, verified: false,
    },
    'us.anthropic.claude-sonnet-5-5': {
      input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 2.5, cacheRead: 0.1, verified: false,
    },
    'us.anthropic.claude-opus-5-5': null,
  } as Record<string, null | {
    input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; verified: boolean;
  }>,
} as const;
