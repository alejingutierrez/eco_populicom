/**
 * Prompt para generar descripciones de tópicos por agencia. Una vez por tópico
 * (descongelable cuando se re-corra el script). Las descripciones citan
 * volúmenes y subtópicos reales de los últimos 30 días — son descriptivas, no
 * prescriptivas (mismos guardrails que el reporte semanal).
 *
 * Salida esperada del modelo: JSON `{ "description": "<2-3 oraciones>" }`.
 */

import { HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

export interface TopicAggregateForDescription {
  agencyName: string;
  topicName: string;
  topicSlug: string;
  periodDays: number;
  totalMentions: number;
  positive: number;
  neutral: number;
  negative: number;
  /** Top subtópicos ordenados por volumen, máx 10. */
  topSubtopics: Array<{ name: string; count: number }>;
  /** Top municipios ordenados por volumen, máx 5. */
  topMunicipalities: Array<{ name: string; count: number }>;
}

export interface TopicMentionSample {
  text: string;
  sentiment: 'positivo' | 'neutral' | 'negativo';
  subtopic?: string | null;
  source?: string | null;
  /** Autor de la mención, cuando está disponible — da contexto de quién habla. */
  author?: string | null;
}

export const TOPIC_DESCRIPTION_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO describiendo de qué hablan las menciones agrupadas bajo un tópico de una agencia pública. El lector hizo clic en el nombre del tópico porque quiere saber qué hay dentro.`,
  `
- Di DE QUÉ SE HABLA en concreto: el reclamo, el anuncio, el evento. El nombre
  del tópico ya lo tiene en la pantalla; repetirlo no aporta.
- Si dentro del tópico conviven dos conversaciones distintas, dilo: es el dato
  más útil que puede dar esta descripción.
- De 3 a 5 oraciones. ${HTML_INLINE_RULE}
`,
);

export function buildTopicDescriptionPrompt(
  agg: TopicAggregateForDescription,
  samples: TopicMentionSample[],
): string {
  const subBlock = agg.topSubtopics.length > 0
    ? agg.topSubtopics.map((s) => `- ${s.name}: ${s.count} menciones`).join('\n')
    : '- (sin subtópicos clasificados)';

  const muniBlock = agg.topMunicipalities.length > 0
    ? agg.topMunicipalities.map((m) => `- ${m.name}: ${m.count} menciones`).join('\n')
    : '- (sin concentración geográfica detectada)';

  // 480 chars por muestra (antes 280) y ahora incluye el autor: la descripción
  // debe poder decir DE QUÉ se está hablando, no solo cuánto.
  const sampleBlock = samples.length > 0
    ? samples.map((s, i) => {
        const clean = s.text.replace(/\s+/g, ' ').trim().slice(0, 480);
        const meta = [
          s.subtopic ? `sub=${s.subtopic}` : null,
          s.source ? `src=${s.source}` : null,
          s.author ? `autor=${s.author}` : null,
          `sent=${s.sentiment}`,
        ].filter(Boolean).join(' ');
        return `${i + 1}. (${meta}) "${clean}"`;
      }).join('\n')
    : '- (sin muestras disponibles)';

  const pct = (n: number) => agg.totalMentions > 0 ? Math.round((n / agg.totalMentions) * 100) : 0;

  return `
AGENCIA: ${agg.agencyName}
TÓPICO: ${agg.topicName}
PERIODO ANALIZADO: últimos ${agg.periodDays} días (zona horaria America/Puerto_Rico).

VOLUMEN DEL TÓPICO EN EL PERIODO:
- Total: ${agg.totalMentions} menciones
- Negativo: ${agg.negative} (${pct(agg.negative)}%)
- Neutral: ${agg.neutral} (${pct(agg.neutral)}%)
- Positivo: ${agg.positive} (${pct(agg.positive)}%)

TOP SUBTÓPICOS (por volumen):
${subBlock}

CONCENTRACIÓN GEOGRÁFICA (top municipios):
${muniBlock}

MUESTRAS DE MENCIONES DEL PERIODO (variadas por sentimiento; mezcla de las más
comentadas y las más recientes — es la evidencia de QUÉ se está diciendo):
${sampleBlock}

TAREA:
Redacta UNA descripción de 3 a 5 oraciones (90 a 130 palabras) que explique DE
QUÉ SE ESTÁ HABLANDO en este tópico durante el periodo. Debe:
1. Empezar describiendo el contenido concreto de la conversación ("Conversaciones
   sobre…", "Menciones que cubren…"), nombrando los asuntos ESPECÍFICOS que
   aparecen en las muestras — el reclamo, el anuncio o el hecho puntual, no la
   categoría abstracta. Esto es lo más importante de la descripción.
2. Citar 2 a 3 subtemas concretos con sus números, en el orden de volumen.
3. Indicar el balance de sentimiento del periodo con porcentaje explícito.
4. Si y solo si la concentración geográfica es clara (un municipio > 25% del
   total), mencionarlo con número. Si no, no fuerces geografía.
5. Si las muestras revelan un patrón que los agregados no muestran (una queja
   repetida, un evento que disparó el volumen, una voz que concentra la
   conversación), nómbralo con su evidencia.

Apóyate en las MUESTRAS para el contenido y en los AGREGADOS para las cifras.
No cites las muestras textualmente entre comillas: parafrasea el asunto.

PROHIBIDO: recomendaciones, sugerencias, juicios prescriptivos, opiniones
propias, calificativos cargados ("crítico", "urgente", "alarmante").

Devuelve la descripción mediante la herramienta provista.
`.trim();
}
