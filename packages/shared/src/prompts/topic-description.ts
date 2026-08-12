/**
 * Prompt para generar descripciones de tópicos por agencia. Una vez por tópico
 * (descongelable cuando se re-corra el script). Las descripciones citan
 * volúmenes y subtópicos reales de los últimos 30 días — son descriptivas, no
 * prescriptivas (mismos guardrails que el reporte semanal).
 *
 * Salida esperada del modelo: JSON `{ "description": "<2-3 oraciones>" }`.
 */

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
}

export const TOPIC_DESCRIPTION_SYSTEM_PROMPT = `
Eres un analista de escucha social en Puerto Rico. Tu única función es describir, en lenguaje plano y profesional, de qué hablan las menciones agrupadas bajo un tópico específico para una agencia pública.

REGLAS:

1. Una descripción es DESCRIPTIVA, nunca prescriptiva. Prohibidas las frases "se debería", "es importante que", "recomendamos", "la agencia debe", "se sugiere", "amerita", "urge", "hace falta", y cualquier llamado a la acción. No emites opiniones propias.

2. Cada afirmación debe estar respaldada por al menos UN número concreto (cantidad, porcentaje, días) tomado literalmente de los datos entregados.

3. Cada afirmación debe citar al menos un nombre propio presente en los datos: subtópico, municipio, fuente. Prohibidas las generalidades vacías tipo "los usuarios", "la comunidad", "la ciudadanía".

4. Idioma: español de Puerto Rico, profesional-informativo, frases cortas. Sin emojis, sin signos de exclamación.

5. NO inventes subtemas, municipios o autores que no aparezcan en los datos.

6. Salida: exclusivamente un objeto JSON válido con el formato pedido. Sin texto adicional, sin markdown fences, sin comentarios.

EJEMPLO ACEPTABLE:
"Conversaciones sobre infraestructura vial de la agencia, dominadas por reclamos sobre cráteres (820 menciones) y semáforos averiados (412); 54% del total de 2,843 menciones del período es negativo, con concentración en San Juan (38%) y Bayamón (12%)."

EJEMPLO INACEPTABLE:
"Es un tópico importante que la agencia debería atender con urgencia para mejorar su imagen pública." ← prescriptivo, sin números, sin nombres propios.
`.trim();

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

  const sampleBlock = samples.length > 0
    ? samples.map((s, i) => {
        const clean = s.text.replace(/\s+/g, ' ').trim().slice(0, 280);
        const meta = [
          s.subtopic ? `sub=${s.subtopic}` : null,
          s.source ? `src=${s.source}` : null,
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

MUESTRAS DE MENCIONES (variadas por sentimiento):
${sampleBlock}

TAREA:
Redacta UNA descripción de 2 a 3 oraciones (máximo 60 palabras) que explique para qué sirve este tópico dentro de la operación de escucha social de la agencia. Debe:
1. Empezar describiendo el contenido del tópico ("Conversaciones sobre…", "Menciones que cubren…", "Discusiones sobre…").
2. Citar 2 a 3 subtemas concretos con sus números, en el orden de volumen.
3. Indicar el balance de sentimiento del periodo con porcentaje explícito.
4. Si y solo si la concentración geográfica es clara (un municipio > 25% del total), mencionarlo con número. Si no, no fuerces geografía.

PROHIBIDO: recomendaciones, sugerencias, juicios prescriptivos, opiniones propias, calificativos cargados ("crítico", "urgente", "alarmante").

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "description": "<2 a 3 oraciones descriptivas, ≤60 palabras>"
}
`.trim();
}
