/**
 * Invocación de un rol con tool-use forzado, reintentos y registro. Nunca
 * lanza: devuelve `value: null` y el error en el registro.
 */
import type { ComposerLlm, ComposerRole, ComposerToolSpec } from '../types';

export interface RoleCallRecord {
  role: ComposerRole;
  model: string;
  ok: boolean;
  attempts: number;
  seconds: number;
  maxTokens: number;
  errors: string[];
}

export interface RoleRuntime {
  llm: ComposerLlm;
  retries: number;
  /** Espera entre intentos (inyectable para pruebas). */
  sleep: (ms: number) => Promise<void>;
  backoffMs: number;
  log?: (msg: string) => void;
}

export interface RoleCall<T> {
  role: ComposerRole;
  model: string;
  system: string;
  user: string;
  tool: ComposerToolSpec;
  maxTokens: number;
  normalize: (raw: unknown) => T;
}

const MAX_TOKENS_CAP = 16000;

export async function callRole<T>(rt: RoleRuntime, call: RoleCall<T>): Promise<{ value: T | null; record: RoleCallRecord }> {
  const t0 = Date.now();
  const errors: string[] = [];
  let maxTokens = call.maxTokens;
  const attempts = Math.max(1, rt.retries);
  for (let a = 1; a <= attempts; a++) {
    try {
      const raw = await rt.llm.invokeTool({
        role: call.role, model: call.model, system: call.system, user: call.user,
        tool: call.tool, maxTokens, temperature: 0,
      });
      const value = call.normalize(raw);
      return { value, record: { role: call.role, model: call.model, ok: true, attempts: a, seconds: (Date.now() - t0) / 1000, maxTokens, errors } };
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      errors.push(msg.slice(0, 500));
      rt.log?.(`[composer] ${call.role} intento ${a}/${attempts} falló: ${msg.slice(0, 200)}`);
      // Truncamiento: el siguiente intento pide más tokens.
      if (/max_tokens|truncat/i.test(msg)) maxTokens = Math.min(MAX_TOKENS_CAP, Math.round(maxTokens * 1.5));
      if (a < attempts) await rt.sleep(rt.backoffMs * a);
    }
  }
  return { value: null, record: { role: call.role, model: call.model, ok: false, attempts, seconds: (Date.now() - t0) / 1000, maxTokens, errors } };
}
