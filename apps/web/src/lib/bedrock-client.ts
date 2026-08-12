/**
 * Cliente singleton de Bedrock Runtime para los endpoints AI del scorecard
 * (`/api/ai/*`). Las credenciales vienen del task role de ECS en producción
 * o de `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` en dev local.
 *
 * El módulo se importa con `await import(...)` desde el endpoint para que
 * el bundler de Next.js NO traiga `@aws-sdk/client-bedrock-runtime` al
 * grafo de páginas (es de uso server-only). Por la misma razón
 * `packages/shared/src/index.ts` no re-exporta bedrock.ts.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

let cached: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (!cached) {
    cached = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }
  return cached;
}
