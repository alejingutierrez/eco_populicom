/**
 * Shared embeddings helper.
 *
 * Wraps Amazon Titan Embed Text v2 (1024-dim) on Bedrock. Used by:
 *   - processor lambda: genera embedding tras el NLP de cada mención nueva.
 *   - migration lambda (action backfill-embeddings): recorre menciones sin
 *     embedding y las puebla en lotes.
 *
 * Best-effort: si Bedrock falla, retorna null y el caller decide si reintenta
 * o persiste sin embedding. Embeddings no son críticos para el dato (NLP sí).
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({});
const EMBED_MODEL_ID = process.env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
export const EMBED_DIMENSIONS = 1024;
// Titan v2 admite hasta 8192 tokens (~32000 chars). Recortamos por seguridad.
const MAX_INPUT_CHARS = 8000;

export function buildEmbeddingInput(title: string | null | undefined, snippet: string | null | undefined): string {
  const t = (title ?? '').trim();
  const s = (snippet ?? '').trim();
  const combined = t && s ? `${t}\n\n${s}` : t || s;
  return combined.slice(0, MAX_INPUT_CHARS);
}

export async function embedText(input: string): Promise<number[] | null> {
  const text = input.trim();
  if (!text) return null;

  try {
    const response = await bedrock.send(
      new InvokeModelCommand({
        modelId: EMBED_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text,
          dimensions: EMBED_DIMENSIONS,
          normalize: true,
        }),
      }),
    );
    const decoded = JSON.parse(new TextDecoder().decode(response.body)) as { embedding?: number[] };
    if (!Array.isArray(decoded.embedding) || decoded.embedding.length !== EMBED_DIMENSIONS) {
      console.warn(`[embeddings] unexpected shape from ${EMBED_MODEL_ID}: dim=${decoded.embedding?.length}`);
      return null;
    }
    return decoded.embedding;
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.warn(`[embeddings] failed (${e.name ?? 'Error'}): ${e.message ?? String(err)}`);
    return null;
  }
}

export function toPgvectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
