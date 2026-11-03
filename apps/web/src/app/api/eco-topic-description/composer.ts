/**
 * Descripción de un tópico con el motor de redacción, perfil ligero (WP-8;
 * spec 10.6): redactor + QA por código + una vuelta de corrector, cifras por
 * marcador. Puro (sin DB ni SDK): la ruta le pasa el agregado, la serie del
 * tópico, las muestras anotadas y el cliente LLM.
 *
 * `topic_descriptions_cache` no tiene columna de composición: la versión del
 * motor va en `model_used` (`composer-x.y.z · <modelo>+primary`) y la
 * composición queda en el log de la ruta.
 */
import {
  compose,
  COMPOSER_PROFILES,
  COMPOSER_MODEL_SONNET,
  COMPOSER_VERSION,
  type ComposeResult,
  type ComposerInput,
  type ComposerLlm,
  type ComposerProfile,
  type Fact,
  type RoleModels,
  type TopicAggregateForDescription,
} from '@eco/shared';

/** Sonnet en redactor y corrector: la ruta es síncrona (maxDuration 30 s). */
export const TOPIC_MODELS: Partial<RoleModels> = { writer: COMPOSER_MODEL_SONNET, corrector: COMPOSER_MODEL_SONNET };

export const TOPIC_LIGHT_PROFILE: ComposerProfile = {
  ...COMPOSER_PROFILES.light,
  writerTask: `

TAREA (rol REDACTOR): describe DE QUÉ se habla en este tópico durante el periodo, en UNA sola pasada:
- headline: una línea con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo.
- paragraph: 3 a 5 oraciones con los asuntos concretos de las muestras (qué se pidió, criticó, anunció o informó y quién lo dijo). Cifras solo con marcadores {{id}}; no recites porcentajes de sentimiento.
- highlights: lista vacía.
Responde con la herramienta.`,
};

/** `composer-1.0.0 · <modelo>+primary` → `composer-1.0.0`; legacy → null. */
export function composerVersionFromModelUsed(modelUsed: string | null | undefined): string | null {
  const m = /(composer-\d+\.\d+\.\d+)/.exec(String(modelUsed ?? ''));
  return m ? m[1] : null;
}

/** `model_used` de una fila del motor (conserva el sufijo del universo primario). */
export function composerModelUsed(r: ComposeResult, primaryTag: string): string {
  return `${COMPOSER_VERSION} · ${r.composition.models.writer ?? 'determinista'}${primaryTag}`;
}

export function topicComposerInput(a: {
  agencyId: string;
  agencyName: string;
  shortName: string;
  startYmd: string;
  endYmd: string;
  aggregate: TopicAggregateForDescription;
  dailySeries: ComposerInput['dailySeries'];
  samples: ComposerInput['samples'];
}): ComposerInput {
  const g = a.aggregate;
  const extraFacts: Fact[] = g.topSubtopics.slice(0, 5).map((s, i) => ({
    id: `subtopic_${i + 1}`, value: s.count, display: `${s.count}`, label: `menciones del subtópico «${s.name}»`,
  }));
  return {
    agency: { id: a.agencyId, name: a.agencyName, shortName: a.shortName },
    window: { startYmd: a.startYmd, endYmd: a.endYmd, timeZone: 'America/Puerto_Rico' },
    totals: { negative: g.negative, neutral: g.neutral, positive: g.positive, total: g.totalMentions },
    dailySeries: a.dailySeries,
    municipalities: g.topMunicipalities.map((m) => ({ municipality: m.name, total: m.count })),
    samples: a.samples,
    extraFacts,
    extraContext: `TÓPICO: ${g.topicName}. Las cifras de los hechos son de este tópico (tópico principal de cada mención), no de toda la agencia.`,
    nameWhitelist: [...g.topSubtopics.map((s) => s.name), ...g.topMunicipalities.map((m) => m.name)],
  };
}

/** Descripción final: el párrafo (solo `<strong>`), con el tope legacy de 1200. */
export function topicDescription(r: ComposeResult): string | null {
  if (!r.composition.draft1Raw) return null;
  const t = String(r.final.paragraph ?? '').trim().replace(/<(?!\/?strong\b)[^>]*>/gi, '').slice(0, 1200);
  return t || null;
}

export async function composeTopic(input: ComposerInput, llm: ComposerLlm | null, log?: (m: string) => void): Promise<ComposeResult> {
  return compose(TOPIC_LIGHT_PROFILE, input, { llm, models: TOPIC_MODELS, retries: 2, backoffMs: 1000, log });
}
