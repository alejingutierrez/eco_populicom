/**
 * Naming de narrativas con Bedrock Claude (tool-use).
 *
 * Cuando un cluster denso nace, le pedimos a Claude que produzca:
 *   - name: 3-5 palabras en español, sin emojis, sin comillas
 *   - slug: kebab-case del name, único por agencia
 *   - summary: 1-2 oraciones describiendo el eje conversacional
 *   - keywords: 4-8 términos clave que caracterizan la narrativa
 *
 * Usamos invokeClaudeWithTool() de @eco/shared/src/bedrock (líneas 60-115)
 * que fuerza la respuesta vía input_schema y evita el problema de JSON crudo
 * con comillas o saltos sin escapar.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { invokeClaudeWithTool } from '@eco/shared/src/bedrock';

export interface NarrativeSample {
  title: string | null;
  snippet: string | null;
  author: string | null;
  publishedAt: string | null;
  platform: string | null;
}

export interface NarrativeNaming {
  name: string;
  slug: string;
  summary: string;
  keywords: string[];
}

const NAMING_SYSTEM_PROMPT = `Eres un analista de medios y conversación pública en español (Puerto Rico y Latinoamérica).
Recibes muestras de menciones (titulares y extractos) que forman parte de una conversación o tema emergente.
Tu trabajo es nombrarla con identidad clara y útil para un dashboard de monitoreo.

REGLAS ESTRICTAS:
- Idioma: español neutro caribeño, sin anglicismos innecesarios.
- "name": 3 a 5 palabras. Específico al evento/persona/tema; NO genérico (ej. evita "Noticias políticas", "Eventos recientes").
- "slug": kebab-case del name, sin tildes, sin caracteres especiales, máximo 60 chars.
- "summary": 1-2 oraciones (máx 200 chars) describiendo el ángulo común que conecta las menciones.
- "keywords": 4 a 8 términos clave (nombres propios, lugares, conceptos). Sin verbos genéricos.
- No uses comillas en name ni summary. Sin emojis.
- Si las menciones son sobre temas DISTINTOS y no hay eje común claro, igual nombra el tema dominante (mayoría) y refleja el resto en summary brevemente.`;

const NAMING_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      maxLength: 80,
      description: 'Nombre identificable de 3-5 palabras en español. Específico, no genérico.',
    },
    slug: {
      type: 'string',
      pattern: '^[a-z0-9-]+$',
      maxLength: 60,
      description: 'kebab-case del name, sin tildes ni caracteres especiales.',
    },
    summary: {
      type: 'string',
      maxLength: 220,
      description: '1-2 oraciones describiendo el eje conversacional.',
    },
    keywords: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      minItems: 3,
      maxItems: 8,
      description: '4-8 términos clave (nombres propios, lugares, conceptos).',
    },
  },
  required: ['name', 'slug', 'summary', 'keywords'],
  additionalProperties: false,
};

function buildUserPrompt(samples: NarrativeSample[]): string {
  const lines: string[] = [
    `Estas son ${samples.length} menciones que han clusterizado juntas (similitud coseno alta sobre embeddings de Titan v2). Identifica el eje conversacional y nómbralo.`,
    '',
    'MUESTRAS:',
  ];
  samples.forEach((s, i) => {
    const title = (s.title ?? '').slice(0, 220);
    const snippet = (s.snippet ?? '').slice(0, 400);
    const author = s.author ?? 'desconocido';
    const date = s.publishedAt ? new Date(s.publishedAt).toISOString().slice(0, 10) : '';
    const platform = s.platform ?? '';
    lines.push(`[${i + 1}] (${date} ${platform} @${author})`);
    if (title) lines.push(`  Título: ${title}`);
    if (snippet) lines.push(`  Extracto: ${snippet}`);
    lines.push('');
  });
  lines.push('Nombra la narrativa siguiendo las reglas del system prompt.');
  return lines.join('\n');
}

/**
 * Nombra una narrativa a partir de un cluster denso. Lanza si Bedrock falla con
 * ambos modelos (primary + fallback). El caller decide si reintenta luego o
 * descarta el cluster (lo dejará en candidates para próxima corrida).
 */
export async function nameNarrative(
  client: BedrockRuntimeClient,
  samples: NarrativeSample[],
): Promise<NarrativeNaming> {
  if (samples.length === 0) throw new Error('nameNarrative: empty samples');

  const result = await invokeClaudeWithTool<NarrativeNaming>({
    client,
    systemPrompt: NAMING_SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(samples),
    maxTokens: 800,
    temperature: 0,
    tool: {
      name: 'submit_narrative_naming',
      description: 'Devuelve el nombre, slug, summary y keywords de la narrativa.',
      input_schema: NAMING_TOOL_SCHEMA,
    },
    validate: (input) => {
      const obj = input as Partial<NarrativeNaming>;
      if (!obj.name || typeof obj.name !== 'string') {
        throw new Error('naming: missing name');
      }
      if (!obj.slug || typeof obj.slug !== 'string' || !/^[a-z0-9-]+$/.test(obj.slug)) {
        throw new Error(`naming: invalid slug "${obj.slug}"`);
      }
      if (!obj.summary || typeof obj.summary !== 'string') {
        throw new Error('naming: missing summary');
      }
      if (!Array.isArray(obj.keywords) || obj.keywords.length < 3) {
        throw new Error('naming: keywords must have ≥3 items');
      }
      return obj as NarrativeNaming;
    },
  });

  return result;
}

/**
 * Selecciona hasta N muestras representativas del cluster para mandar al LLM.
 * Priorización: mayor engagement, luego mayor reach, luego diversidad temporal
 * (no todas el mismo día). N=10 es buen balance precisión/coste.
 */
export function pickRepresentativeSamples<T extends NarrativeSample & {
  engagement?: number;
  reach?: number;
}>(items: T[], maxSamples = 10): T[] {
  const sorted = [...items].sort((a, b) => {
    const eA = (a.engagement ?? 0) + (a.reach ?? 0) / 1000;
    const eB = (b.engagement ?? 0) + (b.reach ?? 0) / 1000;
    return eB - eA;
  });
  if (sorted.length <= maxSamples) return sorted;

  const picked: T[] = [];
  const usedDates = new Set<string>();
  // Round 1: top engagement con diversidad temporal (un item por día).
  for (const item of sorted) {
    if (picked.length >= maxSamples) break;
    const date = (item.publishedAt ?? '').slice(0, 10);
    if (date && usedDates.has(date)) continue;
    picked.push(item);
    if (date) usedDates.add(date);
  }
  // Round 2: rellena si faltan.
  for (const item of sorted) {
    if (picked.length >= maxSamples) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}
