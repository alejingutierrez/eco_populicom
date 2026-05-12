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

export interface InvokeClaudeWithToolOptions<TInput> extends InvokeClaudeOptions {
  /**
   * Tool definition. El modelo SIEMPRE retorna su respuesta como `input` de
   * este tool (forzado por `tool_choice`). Esto elimina el problema de
   * `JSON.parse` sobre texto crudo con comillas o saltos sin escapar.
   */
  tool: {
    name: string;
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input_schema: Record<string, any>;
  };
  /** Validación opcional sobre el input antes de retornar (lanza si falla). */
  validate?: (input: unknown) => TInput;
}

/**
 * Invoca Claude forzando una respuesta vía tool-use con input_schema. Devuelve
 * el `input` ya estructurado del tool_use block (no JSON crudo).
 *
 * Ventaja vs invokeClaude(): el modelo no puede romper el parser con comillas
 * o saltos de línea no escapados — Bedrock garantiza shape del tool_use. Es
 * el método preferido para cualquier output estructurado nuevo.
 */
export async function invokeClaudeWithTool<TInput = unknown>(
  opts: InvokeClaudeWithToolOptions<TInput>,
): Promise<TInput> {
  const primary = opts.primaryModel ?? DEFAULT_PRIMARY_MODEL;
  const fallback = opts.fallbackModel === undefined ? DEFAULT_FALLBACK_MODEL : opts.fallbackModel;
  const models = [primary, fallback].filter((m): m is string => !!m && typeof m === 'string');
  const seen = new Set<string>();
  const ordered = models.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));

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
          tools: [{
            name: opts.tool.name,
            description: opts.tool.description ?? '',
            input_schema: opts.tool.input_schema,
          }],
          tool_choice: { type: 'tool', name: opts.tool.name },
        }),
      }));
      const rawBody = response.body as unknown as Uint8Array;
      const body = JSON.parse(new TextDecoder().decode(rawBody));
      const content: Array<{ type: string; name?: string; input?: unknown }> = body.content ?? [];
      const toolUse = content.find((b) => b.type === 'tool_use' && b.name === opts.tool.name);
      if (!toolUse || toolUse.input === undefined) {
        throw new Error(`Model ${modelId} did not return tool_use block for "${opts.tool.name}"`);
      }
      const input = toolUse.input;
      return opts.validate ? opts.validate(input) : (input as TInput);
    } catch (err) {
      lastErr = err;
      console.warn(`[bedrock] model ${modelId} (tool=${opts.tool.name}) failed: ${(err as Error).message}`);
    }
  }
  throw lastErr ?? new Error('No Bedrock model produced a tool_use response');
}

/**
 * Invoca Claude. Devuelve el texto crudo (ya sin code fences de markdown).
 * Lanza si todos los modelos fallan. El caller hace el JSON.parse y maneja
 * fallback semántico (e.g. "Resumen no disponible") cuando lo deseable es no
 * romper el flujo.
 *
 * Prefer invokeClaudeWithTool() para nuevos callers — JSON crudo se rompe con
 * comillas/saltos no escapados.
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
