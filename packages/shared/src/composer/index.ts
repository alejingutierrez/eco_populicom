/**
 * Motor de redacción agéntico (spec interpretación v1, sección 10).
 *
 *   const { samples } = await prepareSamples(dataAccess, rawSamples);
 *   const r = await compose('daily', { ...aggregates, samples }, {
 *     llm: createBedrockComposerLlm(bedrockClient),   // de './bedrock-llm'
 *     dryRun: true,
 *   });
 *   r.final; r.subject; r.composition;   // nunca lanza
 *
 * El adaptador de Bedrock (`./bedrock-llm`) no se exporta aquí a propósito:
 * ver el comentario al pie de `packages/shared/src/index.ts`.
 */
export * from './types';
export * from './vetoed';
export * from './facts';
export * from './samples';
export * from './lint';
export * from './safety-net';
export * from './schemas';
export * from './prompts';
export * from './profiles';
export * from './context';
export * from './archive';
export * from './compose';
export type { RoleCallRecord, RoleRuntime } from './roles/call';
export { analystSystem, analystUser } from './roles/analyst';
export { writerSystem, writerUser } from './roles/writer';
export { qaUser } from './roles/qa';
export { correctorSystem, correctorUser } from './roles/corrector';
