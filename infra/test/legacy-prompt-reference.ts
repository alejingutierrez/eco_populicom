/**
 * COPIA VERBATIM del prompt de clasificación del processor tal como estaba en
 * origin/main 6e499dc (infra/lambda/processor/index.ts, analyzeWithClaude),
 * antes de la interpretación v1. Es el oráculo de la prueba de no-regresión:
 * con la rúbrica legacy, buildClassificationPrompt debe producir exactamente
 * este texto. NO editar salvo para reflejar un cambio deliberado del prompt
 * legacy en producción.
 */
/* eslint-disable */
type BrandwatchMention = { title?: string | null; snippet?: string | null; contentSourceName?: string | null; domain?: string | null; author?: string | null; date?: string | null; sentiment?: string | null };
type AgencyInfo = { slug: string; name: string };
type TopicDefLike = { slug: string; name: string; subtopics: Array<{ slug: string; description: string }> };

export const LEGACY_ROUTING_RULES = `- Si el post anuncia el NÚMERO DE EMPLEOS como hecho central → topic = empleo-fuerza-laboral. Si habla de la DECISIÓN/SECTOR corporativo → topic = inversion-extranjera.
- Misión comercial España: si centra en "empresas PR exportando" → comercio-exterior; si centra en "atraer capital ES a PR" → inversion-extranjera.
- Hotel boutique con créditos Ley 60: si la conversación es "caso de éxito turístico" → turismo-economia; si es "controversia Ley 60" → incentivos-economicos.
- Compañía Turismo separación: legislacion-economica (NO turismo-economia).
- OGPe / PC 1183 / inspecciones bomberos: si discute "permisos como sistema" → permisos-reforma; si discute "DDEC como agencia receptora/cedente de funciones" → legislacion-economica.
- Críticas dirigidas a la PERSONA del Secretario (credibilidad, gestión, viajes): topic = gestion-secretario con sentiment=negativo; reserva criticas-controversias para críticas al PROYECTO o al MODELO económico, no a la persona.
- FITUR: turismo-economia.fitur-y-promocion-internacional (NO comercio-exterior).`;

export function referenceLegacyPrompt(
  mention: BrandwatchMention,
  agency: AgencyInfo,
  fullText: string | null,
  deps: { NLP_TEXT_LIMIT: number; TOPICS_BY_AGENCY: Record<string, TopicDefLike[]>; AGENCY_NLP_CONTEXT: Record<string, string>; TOPIC_ROUTING_RULES: Record<string, string> },
): string {
  const { NLP_TEXT_LIMIT, TOPICS_BY_AGENCY, AGENCY_NLP_CONTEXT, TOPIC_ROUTING_RULES } = deps;
  const agencyTopics = TOPICS_BY_AGENCY[agency.slug] ?? [];
  const topicSlugs = agencyTopics.map((t) => t.slug).join(', ');
  const subtopicSlugs = agencyTopics.flatMap((t) => t.subtopics.map((s) => s.slug)).join(', ');

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

  // Pass Brandwatch's own sentiment (positive/neutral/negative) as a hint so
  // Claude has an anchor. Historically Claude was too positive — it rated
  // 5,600 "bw=neutral" news items as "positivo". The rules below bias
  // toward neutral for factual reporting and require overt language for a
  // positivo call.
  const bwSentimentHint = mention.sentiment
    ? `\nSentimiento Brandwatch (referencia): ${mention.sentiment}`
    : '';

  // Cuando hay cuerpo del artículo, ese es el texto a analizar y el snippet
  // sobra (es su prefijo). Se marca como recortado cuando se pasa del tope
  // para que Claude sepa que el final falta y no lo interprete como un corte
  // abrupto del autor.
  const textoAnalizado = fullText
    ? fullText.slice(0, NLP_TEXT_LIMIT) + (fullText.length > NLP_TEXT_LIMIT ? '\n[…texto recortado]' : '')
    : (mention.snippet ?? '(sin texto)');

  // Contexto y reglas de routing propios de la agencia (topics.ts). Sin
  // entrada, el prompt es el de siempre: el bloque de routing histórico
  // (escrito para DDEC) se conserva tal cual para no mover la clasificación
  // de las agencias que ya lo usan.
  const agencyContext = AGENCY_NLP_CONTEXT[agency.slug] ? `\n\nCONTEXTO DE LA AGENCIA:\n${AGENCY_NLP_CONTEXT[agency.slug]}` : '';
  const routingRules = TOPIC_ROUTING_RULES[agency.slug] ?? LEGACY_ROUTING_RULES;

  const prompt = `Eres un analista de social listening especializado en Puerto Rico.
Analiza esta mención sobre ${agency.name}.${agencyContext}

MENCIÓN:
Título: ${mention.title ?? '(sin título)'}
Texto: ${textoAnalizado}
Fuente: ${mention.contentSourceName ?? mention.domain} (${mention.domain})
Autor: ${mention.author ?? 'Desconocido'}
Fecha: ${mention.date}${bwSentimentHint}

Llama a la herramienta classify_mention con los campos correctos.

REGLAS DE SENTIMIENTO (muy importantes — los datos actuales tienen sesgo positivo):
- "positivo" EXCLUSIVAMENTE cuando el autor/medio expresa evaluación explícitamente favorable hacia ${agency.name}: elogios, logros celebrados por la ciudadanía, resolución de problemas agradecida, decisiones aplaudidas. Señales: "felicita", "excelente", "gracias a", "aplauden", "reconocimiento".
- "negativo" cuando la mención expresa queja, crítica, denuncia, fallo operativo, escándalo, protesta, reclamo ciudadano, o el autor/medio usa lenguaje desfavorable. Señales: "denuncia", "protesta", "falla", "critica", "cuestiona", "sigue sin", "años sin", "exigen".
- "neutral" por defecto para: reportajes informativos sin valoración, comunicados oficiales, anuncios institucionales sin reacción pública visible, datos, números de contacto, inauguraciones descritas sin entusiasmo evaluativo. Si el texto solo DESCRIBE sin evaluar, es neutral.
- NO marques positivo solo porque se resuelva un problema o se inaugure algo. Solo cuando haya elogio explícito.
- Si el Sentimiento Brandwatch dice "neutral", usa "neutral" salvo que el texto tenga señales inequívocas de positivo/negativo.

PERTINENCIA:
- "alta" si la mención TRATA sobre ${agency.name}. "media" si ${agency.name} es secundaria. "baja" si ${agency.name} se menciona de paso.

EMOTIONS:
- del set [frustración, enojo, alivio, gratitud, preocupación, sarcasmo, indiferencia]. Máximo 3. Omite el campo si el texto es meramente factual.

TOPICS Y SUBTOPICS (menú jerárquico — el subtopic_slug DEBE pertenecer al topic_slug elegido):
${topicSubtopicMenu}

REGLAS DE TOPICS/SUBTOPICS:
- topic_slug obligatorio. Usa SOLO uno de: ${topicSlugs}.
- subtopic_slug opcional pero MUY recomendado. Debe ser uno de los listados bajo el topic_slug elegido. NUNCA mezcles un subtopic de un topic con otro topic.
- Máximo 3 tópicos por mención. confidence: 0.0 a 1.0.

REGLAS DE ROUTING CROSS-TOPIC (cuando la mención toca varios temas, elige UNO primario):
${routingRules}

MUNICIPALITIES:
- Slugs de los 78 municipios de PR (ej: san-juan, ponce, bayamon, mayaguez).
- Incluye TODO municipio mencionado por nombre, barrio (Santurce→san-juan, Río Piedras→san-juan, Levittown→toa-baja, Condado→san-juan) o contexto geográfico claro.
- Si el texto menciona sólo "Puerto Rico" sin municipio, deja el array vacío.`;
  return prompt;
}
