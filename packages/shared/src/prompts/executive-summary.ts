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

import { HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

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

export const EXECUTIVE_SUMMARY_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO escribiendo el resumen ejecutivo que la jefatura de una agencia pública ve al entrar al dashboard. Cuentas, en prosa clara, QUÉ ESTÁ PASANDO en la conversación del periodo: de qué habla la gente, en qué términos y a raíz de qué.`,
  `
- Prosa narrativa, no un listado de indicadores. El lector quiere entender la
  conversación, no leer un tablero — las tarjetas de arriba ya son el tablero.
  BIEN: "El reclamo dominante es la falta de agua en sectores de Trujillo Alto,
        donde vecinos reportan una semana sin servicio."
  MAL:  "El tópico Servicio de Agua tiene 412 menciones con 63% negativo."
- Máximo dos cifras por párrafo, y solo cuando sostienen algo que acabas de
  afirmar. Nunca abras con un número.
- No enumeres la distribución de tópicos ni digas "la conversación se concentra
  en X". Explica el CONTENIDO de esa concentración.
- Las MUESTRAS de menciones son tu fuente principal para decir de qué se habla;
  los agregados solo aportan las cifras.
- Si las muestras no alcanzan para afirmar un contenido concreto, dilo con
  honestidad ("el periodo no muestra un asunto dominante claro") en vez de
  rellenar.
- ${HTML_INLINE_RULE}
`,
);

export const EXECUTIVE_SUMMARY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    signal_narrative: {
      type: 'string',
      minLength: 200,
      maxLength: 1600,
      description: 'De 4 a 6 oraciones (100-160 palabras) contando qué está pasando y de qué se habla en el periodo. Este es el texto principal del resumen ejecutivo.',
    },
    signal_points: {
      type: 'array',
      items: { type: 'string', maxLength: 320 },
      minItems: 2,
      maxItems: 2,
      description: 'Dos viñetas sobre lo que está pasando. Cada una cuenta un hecho con su cifra de apoyo detrás, nunca una cifra con etiqueta.',
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
    emerging_points: {
      type: 'array',
      items: { type: 'string', maxLength: 320 },
      minItems: 2,
      maxItems: 2,
      description: 'Dos viñetas. Cada una cuenta un hecho con su cifra de apoyo detrás, nunca una cifra con etiqueta.',
    },
    emerging_dominant: { type: 'string', maxLength: 90 },
    emerging_action: { type: 'string', maxLength: 70 },
    crisis_narrative: {
      type: 'string',
      minLength: 120,
      maxLength: 1200,
      description: 'De 2 a 4 oraciones sobre el frente negativo del periodo: de qué se queja la gente y con qué intensidad. Si no hay señal de crisis, dilo sin dramatizar.',
    },
    crisis_points: {
      type: 'array',
      items: { type: 'string', maxLength: 320 },
      minItems: 2,
      maxItems: 2,
      description: 'Dos viñetas. Cada una cuenta un hecho con su cifra de apoyo detrás, nunca una cifra con etiqueta.',
    },
    crisis_dominant: { type: 'string', maxLength: 90 },
    crisis_action: { type: 'string', maxLength: 70 },
  },
  required: [
    'signal_narrative', 'signal_points', 'signal_dominant', 'signal_action',
    'emerging_narrative', 'emerging_points', 'emerging_dominant', 'emerging_action',
    'crisis_narrative', 'crisis_points', 'crisis_dominant', 'crisis_action',
  ],
};

export interface ExecutiveSummaryOutput {
  signal_narrative: string;
  /** Dos viñetas que explican, no dos cifras con etiqueta (ago 2026). */
  signal_points: string[];
  signal_dominant: string;
  signal_action: string;
  emerging_narrative: string;
  emerging_points: string[];
  emerging_dominant: string;
  emerging_action: string;
  crisis_narrative: string;
  crisis_points: string[];
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
Produce tres bloques para el resumen ejecutivo de esta agencia EN ESTE PERIODO. Cada bloque es un párrafo más dos viñetas.

1. signal_narrative — el texto principal. De 4 a 6 oraciones (100-160 palabras) contando qué está pasando: el asunto o los asuntos de los que realmente se habla, en qué términos, a raíz de qué, y quién lo está impulsando si una voz concentra la conversación. Apóyate en las MUESTRAS. Máximo 2 cifras.
   signal_points — DOS viñetas. Cada una cuenta algo que pasó, con su cifra detrás como apoyo. No repitas lo que ya dijo el párrafo: las viñetas son para lo que no cupo. Una sola oración cada una, de 20 a 40 palabras.
   BIEN: "El reclamo se movió del servicio a la administración: vacantes sin llenar y la reunión en Fortaleza concentran casi la mitad de lo crítico."
   MAL:  "Negatividad: 54% del total."
   Más signal_dominant (etiqueta corta "<asunto> · <tono>") y signal_action ("Ver menciones de <asunto> →").

2. emerging_narrative — de 2 a 4 oraciones sobre lo que está CRECIENDO dentro del periodo y de qué se trata ese crecimiento. Si ningún tópico crece de forma clara, dilo explícitamente.
   emerging_points — DOS viñetas con el mismo criterio. Si no hay nada emergente, que cuenten de qué sigue hablando la gente, sin presentarlo como emergente.
   Más emerging_dominant y emerging_action.

3. crisis_narrative — de 2 a 4 oraciones sobre el frente negativo: de qué se queja la gente y con qué intensidad. Si no hay señal de crisis, dilo sin dramatizar.
   crisis_points — DOS viñetas con el mismo criterio.
   Más crisis_dominant y crisis_action.

Recuerda: prosa, no tablero. Las viñetas también explican. Nada prescriptivo. Nada inventado.
`.trim();
}
