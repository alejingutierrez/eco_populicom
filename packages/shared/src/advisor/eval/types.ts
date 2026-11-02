// Tipos del arnés de evaluación del asesor (spec §13). Todo lo de esta carpeta es lógica pura:
// no llama a Bedrock ni a la base. Los CLIs viven en scripts/advisor-eval/.

import type { AdvisorUsage } from '../llm';

export type VariantId = 'a' | 'a2' | 'b' | 'c';
export const VARIANT_IDS: readonly VariantId[] = ['a', 'a2', 'b', 'c'];

export const VARIANT_LABEL: Record<VariantId, string> = {
  a: '(a) un agente',
  a2: '(a′) un agente ×3 + síntesis',
  b: '(b) panel',
  c: '(c) consejo',
};

/** Tipos de pregunta por episodio (spec §13.1): de 2 a 3 por episodio. */
export type QuestionType = 'descriptiva' | 'decision_reversible' | 'decision_irreversible' | 'redaccion';
export const QUESTION_TYPES: readonly QuestionType[] = ['descriptiva', 'decision_reversible', 'decision_irreversible', 'redaccion'];

export interface Question {
  id: string;
  tipo: QuestionType;
  texto: string;
  /** Preferencia del usuario dentro de la pregunta (prueba la alarma de complacencia, spec §13.5). */
  preferenciaUsuario?: string;
}

export interface Episode {
  id: string;
  agencySlug: 'ddecpr' | 'gobernadora' | 'df';
  titulo: string;
  /** Minuto congelado (ISO 8601): `ctx.asOf` de todas las herramientas (spec §13.1). */
  asOf: string;
  /** Etiquetas para exigir los episodios del spec: renuncia-ddec-2026-05, familia-2026-10, apagon-2025-04. */
  tags: string[];
  /** Contaminación (spec §13.1): preferir episodios de baja cobertura nacional. */
  bajaCoberturaNacional: boolean;
  /** Control con nombres sustituidos: el caso se corre también con alias estables. */
  control: { nombresSustituidos: boolean; nombres?: string[] };
  /** Los snapshots usados deben tener `computed_at` posterior a V5 (spec §13.1). */
  snapshotsV5: boolean;
  /** Había veda electoral vigente en `asOf` (activa la regla L-7 del detector y el punto 11 de la revisión). */
  vedaActiva?: boolean;
  preguntas: Question[];
}

/** Unidad de corrida: un episodio × una pregunta. */
export interface Case {
  caseId: string;
  episode: Episode;
  question: Question;
}

export interface CallRecord {
  model: string;
  stopReason: string;
  usage: AdvisorUsage;
  ms: number;
}

export interface RunRecord {
  variant: VariantId;
  caseId: string;
  episodeId: string;
  rep: number;
  status: 'done' | 'error' | 'cancelled';
  error?: string;
  memo: Record<string, unknown> | null;
  calls: CallRecord[];
  /** USD con precios verificados; null si algún modelo usado no tiene precio (no se inventa el de Opus). */
  costUsd: number | null;
  /** Cuántos modelos quedaron sin precio (para explicar un costUsd null). */
  unpricedCalls: number;
  citations: { total: number; invalid: number };
  latencyMs: number;
  /** Pistas del propio variante para calificar formato: objeciones del DA y vetos que DEBEN estar en el memorando. */
  expected: { objeciones: string[]; vetos: string[] } | null;
  alarms: Record<string, unknown> | null;
  /** Rangos `efectos_esperados` que emitió el variante (posiciones); el memorando no los trae (spec §8.6). */
  ranges: Array<{ metrica: string; horizonte_h: number; rango_min: number; rango_max: number }>;
  /** IDs M-/N- que conocía la corrida (hoja de hechos compartida); sirve para recalificar citas. */
  seenIds: string[];
}
