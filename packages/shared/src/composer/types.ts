/**
 * Tipos del motor de redacción (composer). Spec interpretación v1, sección 10
 * y Anexo B.
 *
 * El motor no conoce la base de datos ni el SDK de Bedrock: recibe agregados
 * ya calculados, muestras anotadas y un cliente de LLM inyectado.
 */

export type ComposerSentiment = 'negative' | 'neutral' | 'positive';

export interface ComposerDailyPoint {
  date: string; // YYYY-MM-DD (día calendario en la zona de la agencia)
  negative: number;
  neutral: number;
  positive: number;
}

export interface ComposerTotals {
  negative: number;
  neutral: number;
  positive: number;
  total: number;
}

/** Tipo de mención (spec 5.1). `social_post` = publicación en redes cuyo autor no sabemos si es la agencia. */
export type MentionKind = 'article' | 'agency_post' | 'comment' | 'third_party_post' | 'social_post';

/** Hilo de muestras: grupo al que pertenece la muestra en el prompt. */
export type SampleGroup = 'today' | 'negative' | 'neutral' | 'positive';

/** Publicación original de un comentario. */
export interface AnnotatedParent {
  /** Clave del hilo (id del padre o, si no hay, una firma estable). */
  key: string;
  text: string | null;
  author: string | null;
  publishedAt: string | null;
  dayYmd: string | null;
  dayLabel: string | null;
  /** Días entre la publicación original y el comentario (1 decimal). */
  ageDays: number | null;
}

/** Muestra anotada (spec 10.2): lo que ven analista, redactor, QA y juez. */
export interface AnnotatedSample {
  sid: string;
  id: string;
  group: SampleGroup;
  kind: MentionKind;
  kindLabel: string;
  isComment: boolean;
  author: string | null;
  source: string | null;
  sentiment: string | null;
  topic: string | null;
  createdAt: string;
  dayYmd: string;
  dayLabel: string;
  text: string;
  /** Solo comentarios; null si el padre no se resolvió (fecha desconocida). */
  parent: AnnotatedParent | null;
  /** Comentario a una publicación de más de 2 días. */
  lateReaction: boolean;
  /** «+N comentarios más sobre esta publicación» (solo en la última muestra conservada del hilo). */
  moreInThread?: number;
  url?: string | null;
  engagement?: number | null;
}

export interface AnnotatedSampleSet {
  today: AnnotatedSample[];
  negative: AnnotatedSample[];
  neutral: AnnotatedSample[];
  positive: AnnotatedSample[];
  /** Muestras quitadas por el tope por hilo, por grupo. */
  droppedByThreadCap: Record<SampleGroup, number>;
}

/** Hecho del paquete (spec 10.2): toda cifra del texto sale de un marcador {{id}}. */
export interface Fact {
  id: string;
  value: number;
  display: string;
  label: string;
}

export interface ComposerInput {
  agency: { id?: string; name: string; shortName?: string | null };
  window: {
    startYmd: string;
    endYmd: string;
    prevStartYmd?: string | null;
    prevEndYmd?: string | null;
    /** Día que se resume (default: último día de la serie). */
    dayYmd?: string | null;
    timeZone?: string | null;
  };
  /** Totales del periodo (universo pertinente). */
  totals: ComposerTotals;
  /** Totales del periodo previo. Si faltan se estiman con `deltaVsPrev`. */
  prevTotals?: ComposerTotals | null;
  /** Variación porcentual contra el periodo previo (como la calcula el lambda). */
  deltaVsPrev?: Partial<Record<ComposerSentiment | 'total', number | null>> | null;
  dailySeries: ComposerDailyPoint[];
  prevDailySeries?: ComposerDailyPoint[] | null;
  topics?: Array<{ topic: string; total: number; negative?: number; neutral?: number; positive?: number }>;
  sources?: Array<{ source: string; mentions: number }>;
  municipalities?: Array<{ municipality: string; total: number; negative?: number }>;
  emotions?: Array<{ emotion: string; count: number }>;
  /** Composición: menciones que son comentarios de usuarios en redes de la agencia. */
  composition?: {
    week: { total: number; comments: number };
    prevWeek?: { total: number; comments: number } | null;
  } | null;
  samples: AnnotatedSampleSet;
  /** Hechos extra del caller (p. ej. el valor de un KPI en el perfil ligero). */
  extraFacts?: Fact[];
  /** Contexto extra en texto (sin cifras propias: las cifras van como extraFacts). */
  extraContext?: string | null;
  /** Nombres propios con dígitos que el lint no debe tratar como cifras. */
  nameWhitelist?: string[];
}

// ------------------------------------------------------------------ esquemas (Anexo B)

export type ThreadKind =
  | 'noticia_del_dia'
  | 'reaccion_tardia_a_publicacion_anterior'
  | 'actividad_propia_de_la_agencia'
  | 'reaccion_a_hecho_externo'
  | 'otro';

export interface FindingThread {
  id: string;
  what: string;
  evidence: string[];
  kind: ThreadKind;
  origin_day?: string;
  fact_ids?: string[];
  who_said?: string;
}

export interface FindingItem {
  what: string;
  evidence: string[];
  fact_ids?: string[];
  who_said?: string;
  dates?: string;
}

export interface Findings {
  threads: FindingThread[];
  week: { negative: FindingItem[]; neutral: FindingItem[]; positive: FindingItem[] };
  tone_of_day?: string;
  cautions?: string[];
}

export interface DraftSection {
  narrative: string;
  points: string[];
}

/** Borrador (redactor y corrector). Los campos opcionales dependen del perfil. */
export interface Draft {
  headline: string;
  paragraph: string;
  highlights: string[];
  insights?: { negative: string[]; neutral: string[]; positive: string[] };
  /** Solo semanal. */
  comparison?: string[];
  /** Solo scorecard: signal, emerging, crisis. */
  sections?: Record<string, DraftSection>;
}

export type QaDefectType =
  | 'cifra'
  | 'cuantificador'
  | 'atribucion'
  | 'fecha_o_dia'
  | 'novedad_sin_base'
  | 'contradiccion'
  | 'tono_dramatico'
  | 'intencion_atribuida'
  | 'sin_respaldo'
  | 'publicacion_vieja_como_del_dia'
  | 'otro';

export interface QaDefect {
  where: string;
  quote: string;
  type: QaDefectType;
  why: string;
  fix: string;
}

export type CodeDefectType = 'marcador_invalido' | 'tono_dramatico' | 'cifra_sin_fuente' | 'titular_largo';

/**
 * Defecto detectado por código. `hard`: la red de seguridad actúa (quita la
 * frase o reemplaza el titular). `soft`: va al corrector y queda como aviso.
 */
export interface CodeDefect {
  where: string;
  type: CodeDefectType;
  quote: string;
  severity: 'hard' | 'soft';
}

// ------------------------------------------------------------------ LLM inyectado

export interface ComposerToolSpec {
  name: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input_schema: Record<string, any>;
}

export interface ComposerLlmRequest {
  role: ComposerRole;
  model: string;
  system: string;
  user: string;
  tool: ComposerToolSpec;
  maxTokens: number;
  temperature?: number;
}

/** Cliente de LLM con tool-use forzado. Ver `bedrock-llm.ts` para el adaptador real. */
export interface ComposerLlm {
  invokeTool(req: ComposerLlmRequest): Promise<unknown>;
}

export type ComposerRole = 'analyst' | 'writer' | 'qa' | 'corrector';

export type RoleModels = Record<ComposerRole, string>;
