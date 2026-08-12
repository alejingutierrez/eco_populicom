/**
 * Prompt del "Resumen ejecutivo" del Scorecard, versión POR PERIODO.
 *
 * Reemplaza (para el Scorecard) al briefing de `agency_briefings`, que estaba
 * fijo en `periodHours = 24` y lo generaba un cron: el bloque mostraba lo mismo
 * sin importar si el usuario tenía el filtro en 1D, 7D, 30D o un rango custom.
 * Petición explícita del usuario: "debe reaccionar a los filtros, ese
 * componente también cambia de acuerdo al filtro seleccionado".
 *
 * Diferencias de FONDO con `executive-briefing.ts` (el del correo):
 *   - Prioriza el CONTENIDO de la conversación sobre la recitación de métricas.
 *     El usuario pidió "decirme qué está pasando, de qué se está hablando, no
 *     necesariamente mostrarme métricas o decirme que está concentrado en un
 *     tópico u otro… algo más de lenguaje natural de qué realmente está
 *     sucediendo".
 *   - Es más largo: 4-6 oraciones (100-160 palabras) en vez de ≤75 palabras.
 *   - Genera los 3 modos (signal / emerging / crisis) en UNA sola llamada, para
 *     no triplicar la latencia de Bedrock.
 */

export interface ExecutiveSummaryTopic {
  name: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  /** % de cambio vs. la ventana previa de igual duración; null si no hay base. */
  deltaPct: number | null;
  /** Subtópicos del tópico, por volumen. */
  subtopics: string;
}

export interface ExecutiveSummaryMentionSample {
  text: string;
  sentiment: 'positivo' | 'neutral' | 'negativo';
  topic?: string | null;
  author?: string | null;
  source?: string | null;
  engagement?: number | null;
}

export interface ExecutiveSummaryAggregates {
  agencyName: string;
  agencyShortName: string;
  /** Etiqueta legible del periodo, p.ej. "5 – 11 ago 2026". */
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** Días calendario AST que cubre la ventana. */
  periodDays: number;
  totals: { total: number; negative: number; neutral: number; positive: number };
  prevTotals: { total: number; negative: number; neutral: number; positive: number };
  nss: number | null;
  crisisRiskScore: number | null;
  totalReach: number;
  topics: ExecutiveSummaryTopic[];
  topMunicipalities: Array<{ name: string; count: number }>;
  topAuthors: Array<{ name: string; mentions: number; reach: number }>;
  samples: ExecutiveSummaryMentionSample[];
}

export const EXECUTIVE_SUMMARY_SYSTEM_PROMPT = `
Eres un analista de escucha social en Puerto Rico que le escribe a la jefatura de una agencia pública. Tu trabajo es contar, en prosa clara, QUÉ ESTÁ PASANDO en la conversación pública del periodo — de qué habla la gente, en qué términos y a raíz de qué.

CÓMO ESCRIBIR:

1. Prosa narrativa, no un listado de indicadores. El lector quiere entender la conversación, no leer un tablero. Los números son APOYO de la afirmación, nunca el sujeto de la oración.
   - BIEN: "El reclamo dominante es la falta de agua en sectores de Trujillo Alto, donde vecinos reportan una semana sin servicio (412 menciones)."
   - MAL: "El tópico Servicio de Agua tiene 412 menciones con 63% negativo y un delta de +18%."

2. Di de QUÉ se habla con especificidad: el hecho, el reclamo, el anuncio o el evento concreto que aparece en las muestras. Nombra actores, lugares y asuntos propios. Prohibidas las generalidades vacías ("los usuarios", "la ciudadanía", "diversos temas").

3. No enumeres la distribución de tópicos ni digas "la conversación se concentra en X". Explica el CONTENIDO de esa concentración.

4. Máximo 2 cifras por párrafo, y solo cuando sostienen algo que acabas de afirmar. Nunca abras con un número.

5. Descriptivo, nunca prescriptivo. Prohibidas las frases "se debería", "es importante que", "recomendamos", "la agencia debe", "urge", "amerita", "hace falta". No emites opiniones ni juicios ("crítico", "alarmante", "preocupante").

6. No inventes NADA. Cada hecho, nombre y cifra debe estar en los datos entregados. Si las muestras no alcanzan para afirmar un contenido concreto, dilo con honestidad ("el periodo no muestra un asunto dominante claro") en vez de rellenar.

7. Idioma: español de Puerto Rico, profesional, frases cortas. Sin emojis, sin exclamaciones, sin markdown. Puedes usar <strong> para resaltar 2 o 3 nombres propios o cifras clave; ninguna otra etiqueta HTML.

8. No abras con la palabra "Hoy" — la ventana puede ser de un día o de un año. Usa "Durante el periodo", "En la ventana analizada", "A lo largo de estos N días".
`.trim();

export const EXECUTIVE_SUMMARY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    signal_narrative: {
      type: 'string',
      minLength: 200,
      maxLength: 1600,
      description: 'De 4 a 6 oraciones (100-160 palabras) contando qué está pasando y de qué se habla en el periodo. Este es el texto principal del resumen ejecutivo.',
    },
    signal_dominant: {
      type: 'string',
      maxLength: 90,
      description: 'Etiqueta corta de la señal dominante: "<asunto> · <tono>". Sin punto final.',
    },
    signal_action: {
      type: 'string',
      maxLength: 70,
      description: 'Siguiente paso de exploración, en imperativo y terminado en "→". Descriptivo, no prescriptivo: "Ver menciones de <asunto> →".',
    },
    emerging_narrative: {
      type: 'string',
      minLength: 120,
      maxLength: 1200,
      description: 'De 2 a 4 oraciones sobre lo que ESTÁ CRECIENDO en la segunda mitad del periodo respecto de la primera, con el contenido concreto de esa alza. Si nada crece de forma clara, dilo.',
    },
    emerging_dominant: { type: 'string', maxLength: 90 },
    emerging_action: { type: 'string', maxLength: 70 },
    crisis_narrative: {
      type: 'string',
      minLength: 120,
      maxLength: 1200,
      description: 'De 2 a 4 oraciones sobre el frente negativo del periodo: de qué se queja la gente y con qué intensidad. Si no hay señal de crisis, dilo sin dramatizar.',
    },
    crisis_dominant: { type: 'string', maxLength: 90 },
    crisis_action: { type: 'string', maxLength: 70 },
  },
  required: [
    'signal_narrative', 'signal_dominant', 'signal_action',
    'emerging_narrative', 'emerging_dominant', 'emerging_action',
    'crisis_narrative', 'crisis_dominant', 'crisis_action',
  ],
};

export interface ExecutiveSummaryOutput {
  signal_narrative: string;
  signal_dominant: string;
  signal_action: string;
  emerging_narrative: string;
  emerging_dominant: string;
  emerging_action: string;
  crisis_narrative: string;
  crisis_dominant: string;
  crisis_action: string;
}

export function buildExecutiveSummaryPrompt(agg: ExecutiveSummaryAggregates): string {
  const pct = (n: number) => (agg.totals.total > 0 ? Math.round((n / agg.totals.total) * 100) : 0);
  const deltaTotal = agg.prevTotals.total > 0
    ? Math.round(((agg.totals.total - agg.prevTotals.total) / agg.prevTotals.total) * 100)
    : null;

  const topicBlock = agg.topics.length > 0
    ? agg.topics
        .map((t) => {
          const growth = t.deltaPct == null ? 'sin base' : `${t.deltaPct > 0 ? '+' : ''}${t.deltaPct}%`;
          const negPct = t.total > 0 ? Math.round((t.negative / t.total) * 100) : 0;
          return `- ${t.name}: ${t.total} menciones (${negPct}% negativo, ${growth} vs ventana previa)${t.subtopics ? ` · subtemas: ${t.subtopics}` : ''}`;
        })
        .join('\n')
    : '- (sin tópicos clasificados en el periodo)';

  const muniBlock = agg.topMunicipalities.length > 0
    ? agg.topMunicipalities.map((m) => `- ${m.name}: ${m.count}`).join('\n')
    : '- (sin concentración geográfica detectada)';

  const authorBlock = agg.topAuthors.length > 0
    ? agg.topAuthors.map((a) => `- ${a.name}: ${a.mentions} menciones, reach ${a.reach}`).join('\n')
    : '- (sin voces concentradas)';

  const sampleBlock = agg.samples.length > 0
    ? agg.samples
        .map((s, i) => {
          const clean = s.text.replace(/\s+/g, ' ').trim().slice(0, 520);
          const meta = [
            `sent=${s.sentiment}`,
            s.topic ? `tópico=${s.topic}` : null,
            s.author ? `autor=${s.author}` : null,
            s.source ? `fuente=${s.source}` : null,
            s.engagement ? `eng=${s.engagement}` : null,
          ]
            .filter(Boolean)
            .join(' ');
          return `${i + 1}. (${meta}) "${clean}"`;
        })
        .join('\n')
    : '- (sin muestras disponibles)';

  return `
AGENCIA: ${agg.agencyName} (${agg.agencyShortName})
PERIODO: ${agg.periodLabel} — ${agg.periodDays} ${agg.periodDays === 1 ? 'día' : 'días'} calendario en America/Puerto_Rico (${agg.periodStart} a ${agg.periodEnd}).

VOLUMEN DEL PERIODO:
- Total: ${agg.totals.total} menciones${deltaTotal !== null ? ` (${deltaTotal > 0 ? '+' : ''}${deltaTotal}% vs. las ${agg.periodDays === 1 ? '24 horas' : `${agg.periodDays} días`} previas — ${agg.prevTotals.total} menciones)` : ' (sin base de comparación)'}
- Negativo: ${agg.totals.negative} (${pct(agg.totals.negative)}%)
- Neutral: ${agg.totals.neutral} (${pct(agg.totals.neutral)}%)
- Positivo: ${agg.totals.positive} (${pct(agg.totals.positive)}%)
- NSS: ${agg.nss ?? 'n/d'} · Crisis Risk: ${agg.crisisRiskScore ?? 'n/d'} · Reach: ${agg.totalReach}

TÓPICOS DEL PERIODO (por volumen; el delta compara la segunda mitad del periodo con la primera):
${topicBlock}

CONCENTRACIÓN GEOGRÁFICA:
${muniBlock}

VOCES CON MÁS PRESENCIA:
${authorBlock}

MUESTRAS DE MENCIONES DEL PERIODO — mezcla de las más comentadas y las más
recientes, variadas por sentimiento. ESTA ES TU FUENTE PRINCIPAL para decir de
qué se está hablando; los agregados de arriba solo aportan las cifras:
${sampleBlock}

TAREA:
Produce tres textos para el resumen ejecutivo de esta agencia EN ESTE PERIODO, y devuélvelos con la herramienta provista:

1. signal_narrative — el texto principal. De 4 a 6 oraciones (100-160 palabras) contando qué está pasando: el asunto o los asuntos de los que realmente se habla, en qué términos, a raíz de qué, y quién lo está impulsando si una voz concentra la conversación. Apóyate en las MUESTRAS para el contenido. Máximo 2 cifras.
   Acompáñalo de signal_dominant (etiqueta corta "<asunto> · <tono>") y signal_action ("Ver menciones de <asunto> →").

2. emerging_narrative — de 2 a 4 oraciones sobre lo que está CRECIENDO dentro del periodo y de qué se trata ese crecimiento. Si ningún tópico crece de forma clara, dilo explícitamente. Más emerging_dominant y emerging_action.

3. crisis_narrative — de 2 a 4 oraciones sobre el frente negativo: de qué se queja la gente y con qué intensidad. Si no hay señal de crisis, dilo sin dramatizar. Más crisis_dominant y crisis_action.

Recuerda: prosa, no tablero. Nada prescriptivo. Nada inventado.
`.trim();
}
