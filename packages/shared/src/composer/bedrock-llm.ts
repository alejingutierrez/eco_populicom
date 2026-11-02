/**
 * Adaptador del motor al cliente Bedrock existente (`invokeClaudeWithTool`).
 *
 * NO se re-exporta desde `composer/index.ts` ni desde `@eco/shared`: trae
 * `../bedrock` (y con él el SDK) al grafo de webpack de apps/web. Los lambdas
 * lo importan directo: `@eco/shared/src/composer/bedrock-llm`.
 *
 * Sin fallback de modelo por defecto: los reintentos los hace el motor por rol
 * y el modelo de cada rol se registra en la composición (un fallback silencioso
 * a otro modelo dejaría el registro mintiendo).
 */
import { invokeClaudeWithTool } from '../bedrock';
import type { ComposerLlm } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BedrockClientLike = { send: (cmd: any) => Promise<any> };

export interface BedrockComposerLlmOptions {
  /** Modelo de respaldo dentro de cada intento (default: ninguno). */
  fallbackModel?: string | null;
}

export function createBedrockComposerLlm(client: BedrockClientLike, opts: BedrockComposerLlmOptions = {}): ComposerLlm {
  return {
    invokeTool: (req) =>
      invokeClaudeWithTool({
        client,
        systemPrompt: req.system,
        userPrompt: req.user,
        maxTokens: req.maxTokens,
        primaryModel: req.model,
        fallbackModel: opts.fallbackModel ?? null,
        temperature: req.temperature ?? 0,
        tool: req.tool,
      }),
  };
}
