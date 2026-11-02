/**
 * Prompt de clasificación del processor y rúbrica v2 (spec interpretación v1,
 * sección 6 y Anexo A).
 *
 * Dos rúbricas conviven detrás de banderas por agencia:
 *   - `legacy`: el prompt de siempre, byte a byte (prueba de no-regresión en
 *     infra/test/classification-rubric.test.ts).
 *   - `v2` (`rubric-v2.0`): el sentimiento pasa a ser la POSTURA del autor hacia
 *     la agencia; se añade el hecho adverso (`adverse_fact`), la línea
 *     «TIPO DE MENCIÓN», la regla de comentarios (solo en comentarios) y se
 *     quita la pista de Brandwatch.
 *
 * El texto de la rúbrica vive aquí, junto al processor, y no en
 * packages/shared: es parte del pipeline de clasificación y se versiona con
 * `nlp_prompt_version`. Implementación de referencia probada en laboratorio
 * (fuera del repo): K-rubrica-v2/v2.py, funciones `rubric()` y `transform()`;
 * el Anexo A del spec es el texto normativo.
 *
 * Módulo puro: sin AWS, sin pg, sin imports de valores de @eco/shared (el
 * catálogo de tópicos se inyecta), para poder probarlo aislado.
 */
import type { Emotion, NlpAnalysis, Sentiment } from '@eco/shared';
import type { MentionKind } from './mention-kind';

export const LEGACY_PROMPT_VERSION = 'legacy';
export const RUBRIC_V2_VERSION = 'rubric-v2.0';
export type RubricId = 'legacy' | 'v2';

export function promptVersionFor(rubric: RubricId): string {
  return rubric === 'v2' ? RUBRIC_V2_VERSION : LEGACY_PROMPT_VERSION;
}

export const VALID_SENTIMENTS: readonly Sentiment[] = ['negativo', 'neutral', 'positivo'];
export const VALID_EMOTIONS: readonly Emotion[] = [
  'frustración', 'enojo', 'alivio', 'gratitud', 'preocupación', 'sarcasmo', 'indiferencia',
];
export const VALID_PERTINENCE = ['alta', 'media', 'baja'] as const;

/** Resultado del NLP con el campo nuevo de la v2 (nulo en legacy). */
export type NlpAnalysisV2 = NlpAnalysis & { adverse_fact: boolean | null };

// ---------------------------------------------------------------------------
// Banderas
// ---------------------------------------------------------------------------

/** `"ddecpr, df"` → Set{'ddecpr','df'}. Vacío o indefinido → conjunto vacío. */
export function parseAgencyList(raw: string | null | undefined): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type RubricMode = 'legacy' | 'v2' | 'shadow';

/**
 * Modo de la agencia: `v2` si está en RUBRIC_V2_AGENCIES (gana sobre la
 * sombra), `shadow` si está en RUBRIC_V2_SHADOW_AGENCIES, si no `legacy`.
 */
export function rubricModeFor(slug: string, v2: Set<string>, shadow: Set<string>): RubricMode {
  const s = slug.toLowerCase();
  if (v2.has(s)) return 'v2';
  if (shadow.has(s)) return 'shadow';
  return 'legacy';
}

export interface ReprocessPlan {
  rubric: RubricId;
  /** Escribir `nlp_prompt_version`/`nlp_model` (y el resto de la traza) junto a las columnas NLP. */
  stamp: boolean;
}

/**
 * Rúbrica y estampado para RE-clasificar una fila ya guardada
 * (`reprocess-nlp-errors`, `reprocess-unclassified`). Invariante: la etiqueta
 * `nlp_prompt_version` describe SIEMPRE el contenido de las columnas NLP
 * (spec 12.2: los agregados filtran por versión y nunca mezclan).
 *
 *   - Una fila que ya es v2 (p. ej. backfill de `reclassify` en una agencia
 *     que aún no está en RUBRIC_V2_AGENCIES) se reclasifica con v2: degradarla
 *     a legacy agujerearía la ventana v2 que el backfill completó.
 *   - Si no, la rúbrica de la agencia (v2 solo si está en RUBRIC_V2_AGENCIES;
 *     la sombra no toca las columnas actuales → legacy).
 *   - Se estampa si la rúbrica es v2, si el enriquecimiento está encendido, o
 *     si la fila ya tenía versión: sobrescribir el contenido sin reescribir la
 *     etiqueta dejaría, p. ej., sentimiento legacy bajo `rubric-v2.0`.
 *   - Fila sin versión, agencia legacy y banderas apagadas → sin estampar
 *     (la escritura es la de siempre).
 */
export function reprocessPlanFor(
  currentVersion: string | null | undefined,
  agencyMode: RubricMode,
  enrichmentEnabled: boolean,
): ReprocessPlan {
  const rubric: RubricId = currentVersion === RUBRIC_V2_VERSION || agencyMode === 'v2' ? 'v2' : 'legacy';
  const stamp = rubric === 'v2' || enrichmentEnabled || (currentVersion != null && currentVersion !== '');
  return { rubric, stamp };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface PromptTopic {
  slug: string;
  name: string;
  subtopics: Array<{ slug: string; description: string }>;
}

export interface PromptAgency {
  slug: string;
  name: string;
}

/** Campos de la mención que entran al prompt (BrandwatchMention es compatible). */
export interface PromptMention {
  title?: string | null;
  snippet?: string | null;
  contentSourceName?: string | null;
  domain?: string | null;
  author?: string | null;
  date?: string | null;
  /** Sentimiento de Brandwatch: solo lo usa la rúbrica legacy (pista). */
  sentiment?: string | null;
}

export interface PromptCatalog {
  agencyTopics: PromptTopic[];
  /** AGENCY_NLP_CONTEXT[slug] (o indefinido). */
  agencyContext?: string | null;
  /** TOPIC_ROUTING_RULES[slug] ?? reglas históricas. */
  routingRules: string;
}

export interface BuildPromptInput {
  mention: PromptMention;
  agency: PromptAgency;
  fullText?: string | null;
  textLimit: number;
  catalog: PromptCatalog;
  rubric: RubricId;
  /** Tipo de mención (solo v2: línea TIPO DE MENCIÓN y regla de comentarios). */
  kind?: MentionKind | null;
}

/**
 * Cómo se nombra a la agencia dentro de la rúbrica v2. `A` es el `{A}` del
 * Anexo A; las otras formas arman la línea TIPO DE MENCIÓN con concordancia.
 * DDEC y DF reproducen exactamente el texto probado en el laboratorio.
 */
export interface AgencyRubricLabels {
  A: string;
  /** «del propio DDEC» */
  ofOwn: string;
  /** «del DDEC» */
  of: string;
  /** «el DDEC» */
  subject: string;
}

const AGENCY_RUBRIC_LABELS: Record<string, AgencyRubricLabels> = {
  ddecpr: {
    A: 'el Departamento de Desarrollo Económico y Comercio (DDEC)',
    ofOwn: 'del propio DDEC',
    of: 'del DDEC',
    subject: 'el DDEC',
  },
  df: {
    A: 'Departamento de la Familia',
    ofOwn: 'del propio Departamento de la Familia',
    of: 'del Departamento de la Familia',
    subject: 'el Departamento de la Familia',
  },
  gobernadora: {
    A: 'la Gobernadora de Puerto Rico',
    ofOwn: 'de la propia Gobernadora',
    of: 'de la Gobernadora',
    subject: 'la Gobernadora',
  },
};

export function agencyRubricLabels(agency: PromptAgency): AgencyRubricLabels {
  return AGENCY_RUBRIC_LABELS[agency.slug] ?? {
    A: agency.name,
    ofOwn: `de la propia agencia (${agency.name})`,
    of: `de la agencia (${agency.name})`,
    subject: `la agencia (${agency.name})`,
  };
}

/** Línea «TIPO DE MENCIÓN» del Anexo A, según el tipo. */
export function mentionKindLine(kind: MentionKind, agency: PromptAgency): string {
  const L = agencyRubricLabels(agency);
  switch (kind) {
    case 'comment':
      return `TIPO DE MENCIÓN: COMENTARIO de un usuario en una publicación ${L.ofOwn}.`;
    case 'agency_post':
      return `TIPO DE MENCIÓN: publicación propia ${L.of} (el autor es ${L.subject}).`;
    case 'article':
      return 'TIPO DE MENCIÓN: nota de prensa o blog.';
    case 'third_party_post':
    default:
      return 'TIPO DE MENCIÓN: publicación de un tercero.';
  }
}

/**
 * Bloque de la rúbrica v2 que reemplaza «REGLAS DE SENTIMIENTO» y
 * «PERTINENCIA» (texto del Anexo A; idéntico a `rubric()` de v2.py con la
 * regla de tópico de comentarios apagada, que no entra a v1: F-02).
 */
export function rubricV2Block(A: string, isComment: boolean): string {
  const com = isComment
    ? `
COMENTARIOS A PUBLICACIONES DE ${A}:
- En un comentario, «Título» es la publicación de ${A} (contexto: NO lo escribió el usuario) y «Texto» es el comentario: clasifica SOLO el comentario.
- Un comentario que responde al contenido de la publicación (la elogia, la critica, pregunta por lo que ofrece o anuncia, pide información sobre el negocio, programa o servicio destacado) es pertinente: "media" como mínimo; "alta" si habla del programa, servicio o gestión de ${A}. Solo es "baja" si es spam, un saludo o una conversación entre usuarios sin relación con la publicación.
`
    : '';
  return `SENTIMIENTO = POSTURA del autor/medio HACIA ${A} (su contenido, programas, servicios, gestión, secretario/a o personal), en la VOZ del propio autor:
- "positivo": el autor elogia, agradece, defiende o celebra a ${A}, o a sus programas, servicios o contenido. Una reacción breve de aplauso o elogio a una publicación de ${A}, o a la iniciativa o negocio que ${A} destaca en ella (por ejemplo «Excelente», «Bravo», «Qué chévere, mucho éxito»), cuenta como positivo hacia ${A}.
- "negativo": el autor critica, culpa, acusa, reclama o se queja contra ${A}, sus programas, servicios, contenido o gestión (incluye reclamos ciudadanos, preguntas retóricas de reclamo, y el reclamo de que una publicación de ${A} omite información que el público necesita), o usa un encuadre acusatorio o burlón con juicios propios.
- "neutral": informa hechos, plazos, declaraciones o críticas ATRIBUIDAS a terceros sin sumarse a ellas (aunque el hecho sea malo para ${A}); publicaciones propias de ${A}; preguntas o respuestas prácticas (direcciones, teléfonos, etiquetas a amigos); opiniones sobre un tercero que NO son una reacción a la publicación de ${A} (por ejemplo una experiencia personal con un negocio); y lo negativo dirigido a OTRO actor cuando ${A} es solo contexto.
- No uses la pista de otras herramientas: decide solo por el texto. No hay un porcentaje esperado de ninguna categoría.

HECHO ADVERSO (campo adverse_fact):
- true si el HECHO que se reporta o discute es desfavorable para la reputación de ${A} (escándalo, investigación, demanda, incumplimiento, fallo operativo, queja ciudadana sobre un servicio), con independencia del tono del autor. Una nota informativa sobre un escándalo es sentimiento "neutral" y adverse_fact=true.

PERTINENCIA:
- "alta" si ${A}, una de sus administraciones, programas o su secretario/a es el tema principal. "media" si es una parte sustancial pero no el tema principal. "baja" si se menciona de paso o el texto trata de otra cosa.
${com}
`;
}

/** Reglas de sentimiento y pertinencia del prompt legacy (sin tocar). */
function legacyRulesBlock(agencyName: string): string {
  return `REGLAS DE SENTIMIENTO (muy importantes — los datos actuales tienen sesgo positivo):
- "positivo" EXCLUSIVAMENTE cuando el autor/medio expresa evaluación explícitamente favorable hacia ${agencyName}: elogios, logros celebrados por la ciudadanía, resolución de problemas agradecida, decisiones aplaudidas. Señales: "felicita", "excelente", "gracias a", "aplauden", "reconocimiento".
- "negativo" cuando la mención expresa queja, crítica, denuncia, fallo operativo, escándalo, protesta, reclamo ciudadano, o el autor/medio usa lenguaje desfavorable. Señales: "denuncia", "protesta", "falla", "critica", "cuestiona", "sigue sin", "años sin", "exigen".
- "neutral" por defecto para: reportajes informativos sin valoración, comunicados oficiales, anuncios institucionales sin reacción pública visible, datos, números de contacto, inauguraciones descritas sin entusiasmo evaluativo. Si el texto solo DESCRIBE sin evaluar, es neutral.
- NO marques positivo solo porque se resuelva un problema o se inaugure algo. Solo cuando haya elogio explícito.
- Si el Sentimiento Brandwatch dice "neutral", usa "neutral" salvo que el texto tenga señales inequívocas de positivo/negativo.

PERTINENCIA:
- "alta" si la mención TRATA sobre ${agencyName}. "media" si ${agencyName} es secundaria. "baja" si ${agencyName} se menciona de paso.

`;
}

/**
 * Prompt completo de `classify_mention`. Con `rubric: 'legacy'` es el prompt
 * de producción anterior a v1, carácter por carácter.
 */
export function buildClassificationPrompt(input: BuildPromptInput): string {
  const { mention, agency, fullText, textLimit, catalog, rubric } = input;
  const agencyTopics = catalog.agencyTopics;
  const topicSlugs = agencyTopics.map((t) => t.slug).join(', ');

  // Construye el menú de subtopics anidado bajo cada topic padre, con sus
  // descripciones cortas. Esto evita que Claude empareje un subtopic con un
  // topic incorrecto (problema con la lista plana anterior).
  const topicSubtopicMenu = agencyTopics
    .map((t) => {
      if (!t.subtopics.length) return `  • ${t.slug} — ${t.name}: (sin subtopics)`;
      const subs = t.subtopics.map((s) => `      - ${s.slug} — ${s.description}`).join('\n');
      return `  • ${t.slug} — ${t.name}:\n${subs}`;
    })
    .join('\n');

  // Legacy: la pista de Brandwatch (positive/neutral/negative) como ancla.
  // Históricamente Claude era demasiado positivo; las reglas legacy sesgan a
  // neutral. La v2 la quita: la postura se decide solo por el texto.
  const bwSentimentHint = rubric === 'legacy' && mention.sentiment
    ? `\nSentimiento Brandwatch (referencia): ${mention.sentiment}`
    : '';

  // Cuando hay cuerpo del artículo, ese es el texto a analizar y el snippet
  // sobra (es su prefijo). Se marca como recortado cuando se pasa del tope
  // para que Claude sepa que el final falta y no lo interprete como un corte
  // abrupto del autor.
  const textoAnalizado = fullText
    ? fullText.slice(0, textLimit) + (fullText.length > textLimit ? '\n[…texto recortado]' : '')
    : (mention.snippet ?? '(sin texto)');

  const agencyContext = catalog.agencyContext ? `\n\nCONTEXTO DE LA AGENCIA:\n${catalog.agencyContext}` : '';

  let kindLine = '';
  let rules: string;
  if (rubric === 'v2') {
    const kind = input.kind ?? null;
    if (kind) kindLine = `${mentionKindLine(kind, agency)}\n`;
    rules = rubricV2Block(agencyRubricLabels(agency).A, kind === 'comment');
  } else {
    rules = legacyRulesBlock(agency.name);
  }

  return `Eres un analista de social listening especializado en Puerto Rico.
Analiza esta mención sobre ${agency.name}.${agencyContext}

MENCIÓN:
Título: ${mention.title ?? '(sin título)'}
Texto: ${textoAnalizado}
Fuente: ${mention.contentSourceName ?? mention.domain} (${mention.domain})
Autor: ${mention.author ?? 'Desconocido'}
Fecha: ${mention.date}${bwSentimentHint}

${kindLine}Llama a la herramienta classify_mention con los campos correctos.

${rules}EMOTIONS:
- del set [frustración, enojo, alivio, gratitud, preocupación, sarcasmo, indiferencia]. Máximo 3. Omite el campo si el texto es meramente factual.

TOPICS Y SUBTOPICS (menú jerárquico — el subtopic_slug DEBE pertenecer al topic_slug elegido):
${topicSubtopicMenu}

REGLAS DE TOPICS/SUBTOPICS:
- topic_slug obligatorio. Usa SOLO uno de: ${topicSlugs}.
- subtopic_slug opcional pero MUY recomendado. Debe ser uno de los listados bajo el topic_slug elegido. NUNCA mezcles un subtopic de un topic con otro topic.
- Máximo 3 tópicos por mención. confidence: 0.0 a 1.0.

REGLAS DE ROUTING CROSS-TOPIC (cuando la mención toca varios temas, elige UNO primario):
${catalog.routingRules}

MUNICIPALITIES:
- Slugs de los 78 municipios de PR (ej: san-juan, ponce, bayamon, mayaguez).
- Incluye TODO municipio mencionado por nombre, barrio (Santurce→san-juan, Río Piedras→san-juan, Levittown→toa-baja, Condado→san-juan) o contexto geográfico claro.
- Si el texto menciona sólo "Puerto Rico" sin municipio, deja el array vacío.`;
}

// ---------------------------------------------------------------------------
// Herramienta classify_mention
// ---------------------------------------------------------------------------

/**
 * Bedrock tool-use con input_schema: garantiza un objeto estructurado y
 * elimina parse-errors de JSON crudo. La v2 añade `adverse_fact` (requerido).
 */
export function buildClassifyTool(rubric: RubricId) {
  const properties: Record<string, unknown> = {
    sentiment: { type: 'string', enum: ['negativo', 'neutral', 'positivo'] },
    emotions: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', enum: ['frustración', 'enojo', 'alivio', 'gratitud', 'preocupación', 'sarcasmo', 'indiferencia'] },
    },
    pertinence: { type: 'string', enum: ['alta', 'media', 'baja'] },
    topics: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          topic_slug: { type: 'string' },
          subtopic_slug: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['topic_slug', 'confidence'],
      },
    },
    municipalities: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  };
  const required = ['sentiment', 'pertinence', 'summary'];
  if (rubric === 'v2') {
    // Mismo orden que en el laboratorio: adverse_fact tras sentiment.
    const { sentiment, ...rest } = properties;
    return {
      name: 'classify_mention',
      description: 'Registra la clasificación NLP de una mención de social listening sobre la agencia.',
      input_schema: {
        type: 'object',
        properties: { sentiment, adverse_fact: { type: 'boolean' }, ...rest },
        required: ['sentiment', 'adverse_fact', 'pertinence', 'summary'],
      },
    };
  }
  return {
    name: 'classify_mention',
    description: 'Registra la clasificación NLP de una mención de social listening sobre la agencia.',
    input_schema: { type: 'object', properties, required },
  };
}

// ---------------------------------------------------------------------------
// Validación del resultado
// ---------------------------------------------------------------------------

/**
 * El tool-use de Bedrock no garantiza el TIPO de cada campo: a veces llega un
 * array como texto ("san-juan" o '["san-juan"]') y `.filter` revienta la
 * mención entera (pasó en la primera carga de DF, oct-2026). Se normaliza a
 * array; lo que no sea interpretable queda vacío.
 */
export function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed as T[];
      } catch { /* cae al split */ }
    }
    return s.split(',').map((x) => x.trim()).filter(Boolean) as unknown as T[];
  }
  return [];
}

/**
 * Enums del resultado crudo. En modo estricto un `sentiment` o `pertinence`
 * fuera de enum es un resultado INVÁLIDO (se prueba el siguiente modelo o se
 * registra como error de NLP), en vez de mapearse en silencio a neutral/media:
 * un «negative» en inglés del fallback a Sonnet contaba como neutral.
 */
export function nlpEnumProblem(raw: unknown): string | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!VALID_SENTIMENTS.includes(r.sentiment as Sentiment)) return `sentiment fuera de enum: ${JSON.stringify(r.sentiment)}`;
  if (!(VALID_PERTINENCE as readonly string[]).includes(r.pertinence as string)) return `pertinence fuera de enum: ${JSON.stringify(r.pertinence)}`;
  return null;
}

export function asBooleanOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

/**
 * Normaliza el resultado de la herramienta. Idéntico al `validateNlpResult`
 * histórico para los campos de siempre; `adverse_fact` solo se lee en v2.
 */
export function normalizeNlpResult(
  raw: NlpAnalysis & { adverse_fact?: unknown },
  opts: { validTopics: readonly string[]; validMunicipalities: readonly string[]; rubric: RubricId },
): NlpAnalysisV2 {
  const { validTopics, validMunicipalities } = opts;
  return {
    sentiment: VALID_SENTIMENTS.includes(raw.sentiment) ? raw.sentiment : 'neutral',
    emotions: asArray<Emotion>(raw.emotions).filter((e) => VALID_EMOTIONS.includes(e)).slice(0, 3),
    pertinence: (VALID_PERTINENCE as readonly string[]).includes(raw.pertinence) ? raw.pertinence : 'media',
    topics: asArray<NlpAnalysis['topics'][number]>(raw.topics)
      .filter((t) => t && typeof t === 'object' && validTopics.includes(t.topic_slug))
      .slice(0, 3)
      .map((t) => ({
        ...t,
        confidence: Math.max(0, Math.min(1, t.confidence ?? 0.5)),
      })),
    municipalities: asArray<string>(raw.municipalities).filter((m) => validMunicipalities.includes(m)),
    summary: (raw.summary ?? '').slice(0, 500),
    adverse_fact: opts.rubric === 'v2' ? asBooleanOrNull(raw.adverse_fact) : null,
  };
}
