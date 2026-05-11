/**
 * Helper compartido para invocar Claude vía AWS Bedrock con fallback Opus→Sonnet.
 *
 * Lo importan tanto Lambdas (eco-weekly-report, eco-briefing-generator,
 * eco-processor) como scripts locales (`scripts/generate-topic-descriptions.ts`).
 * El cliente Bedrock se pasa por dependency injection para evitar que
 * `@eco/shared` arrastre una dependencia hard del SDK — cada consumidor
 * controla su propia construcción y región.
 */
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

export interface InvokeClaudeOptions {
  client: BedrockRuntimeClient;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  /** Primer modelo a intentar. Default: claude-opus-4-6. */
  primaryModel?: string;
  /** Fallback cuando el primario falla. Default: claude-sonnet-4-6. Pasa null para deshabilitar. */
  fallbackModel?: string | null;
  /** 0..1; default 0 — determinismo casi total para insights y briefings. */
  temperature?: number;
}

export const DEFAULT_PRIMARY_MODEL = 'us.anthropic.claude-opus-4-6-v1';
export const DEFAULT_FALLBACK_MODEL = 'us.anthropic.claude-sonnet-4-6';

/**
 * Invoca Claude. Devuelve el texto crudo (ya sin code fences de markdown).
 * Lanza si todos los modelos fallan. El caller hace el JSON.parse y maneja
 * fallback semántico (e.g. "Resumen no disponible") cuando lo deseable es no
 * romper el flujo.
 */
export async function invokeClaude(opts: InvokeClaudeOptions): Promise<string> {
  const primary = opts.primaryModel ?? DEFAULT_PRIMARY_MODEL;
  const fallback = opts.fallbackModel === undefined ? DEFAULT_FALLBACK_MODEL : opts.fallbackModel;
  const models = [primary, fallback].filter((m): m is string => !!m && typeof m === 'string');
  const seen = new Set<string>();
  const ordered = models.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));

  let lastErr: unknown = null;
  for (const modelId of ordered) {
    try {
      const response = await opts.client.send(new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: opts.maxTokens,
          system: opts.systemPrompt,
          messages: [{ role: 'user', content: opts.userPrompt }],
          temperature: opts.temperature ?? 0,
        }),
      }));
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const text: string = body.content?.[0]?.text ?? '';
      return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    } catch (err) {
      lastErr = err;
      // Log via console por consistencia con el patrón existente; el caller
      // decide si swallow o re-throw.
      console.warn(`[bedrock] model ${modelId} failed: ${(err as Error).message}`);
    }
  }
  throw lastErr ?? new Error('No Bedrock model produced a response');
}
