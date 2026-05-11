/**
 * Helper compartido para invocar Claude vía AWS Bedrock con fallback Opus→Sonnet.
 *
 * Lo importan Lambdas (eco-weekly-report, eco-ai-tasks, eco-processor) y
 * scripts locales. El cliente Bedrock se pasa por dependency injection y
 * `InvokeModelCommand` se trae con `await import(...)` para evitar que el
 * bundler de Next.js — que arma el server de apps/web y consume `@eco/shared`
 * para tipos compartidos como `WeeklyReportRenderData` — intente resolver
 * `@aws-sdk/client-bedrock-runtime` (que no es dep de apps/web). Solo los
 * consumidores que efectivamente llaman `invokeClaude()` necesitan el SDK
 * en su node_modules.
 */
// Estructural y `any`-friendly: el caller pasa su propia instancia ya tipada
// (típicamente `BedrockRuntimeClient` de @aws-sdk/client-bedrock-runtime).
// Aquí solo necesitamos `.send(cmd)`; el SDK garantiza la firma real.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BedrockClientLike = { send: (cmd: any) => Promise<any> };

export interface InvokeClaudeOptions {
  /** Cliente `BedrockRuntimeClient` ya construido por el caller. */
  client: BedrockClientLike;
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

  // Resolver el SDK solo en runtime (no estáticamente) — ver comentario al
  // tope del archivo. La librería se cachea en el module loader, así que el
  // costo de import dinámico es despreciable para invocaciones repetidas.
  const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

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
      const rawBody = response.body as unknown as Uint8Array;
      const body = JSON.parse(new TextDecoder().decode(rawBody));
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
