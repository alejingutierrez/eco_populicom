export * from './sentiment-report';
export * from './report-detail';
export * from './pr-range';
export * from './composition';
export * from './facts';
// Universo pertinente único (D4). Vive en packages/shared/src/universe.ts; se
// re-exporta aquí para que llegue a `@eco/shared` por `export * from './aggregations'`
// sin tocar src/index.ts (WP-3 es su único dueño y puede exportarlo directo).
export * from '../universe';
