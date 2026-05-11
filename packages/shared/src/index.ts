export * from './types';
export * from './topics';
export * from './municipalities';
export * from './dates';
export * from './format-period';
export * from './aggregations';
export * from './email/render-weekly-report';
export * from './prompts/weekly-report-insights';
export * from './prompts/topic-description';
export * from './prompts/executive-briefing';
// `./bedrock` se importa directamente desde lambdas via
// `@eco/shared/src/bedrock`. NO se re-exporta aquí porque trae el SDK
// `@aws-sdk/client-bedrock-runtime` al grafo de webpack de apps/web, que
// no tiene esa dep — y rompe el build de Next.js incluso si nadie llama
// invokeClaude desde el server route.
