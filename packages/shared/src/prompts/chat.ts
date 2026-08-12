/**
 * Prompt del chat contextual del dashboard. El asistente responde preguntas
 * cuantitativas y cualitativas usando EXCLUSIVAMENTE el snapshot de la vista
 * actual (métricas, sentimiento, tópicos, fuentes y menciones del periodo y
 * filtros que el usuario tiene en pantalla). Si la respuesta no está en ese
 * contexto, debe decirlo en vez de inventar.
 *
 * No es agentic: no llama herramientas ni consulta la DB; trabaja solo con el
 * contexto que el route le inyecta.
 */

/** Snapshot de la vista actual que el frontend envía como contexto. */
export interface ChatViewContext {
  agencyName?: string | null;
  agencySlug?: string | null;
  screen?: string | null;
  screenLabel?: string | null;
  period?: string | null;
  from?: string | null;
  to?: string | null;
  /** Objeto CURRENT_METRICS de /api/eco-data (nss, brandHealthIndex, crisisRiskScore, …). */
  metrics?: Record<string, unknown> | null;
  /** SENTIMENT_BREAKDOWN: [{ name|label, value }]. */
  sentiment?: Array<Record<string, unknown>> | null;
  /** TOPICS: [{ name, count|c|value, sentiment?, delta? }]. */
  topics?: Array<Record<string, unknown>> | null;
  /** TOP_SOURCES: [{ name|pageType|label, count|c|value }]. */
  sources?: Array<Record<string, unknown>> | null;
  /** MUNICIPALITIES: [{ name, count|value }]. */
  municipalities?: Array<Record<string, unknown>> | null;
  /** EMOTIONS: [{ name|label, count|value }]. */
  emotions?: Array<Record<string, unknown>> | null;
  /** MENTIONS: [{ title, snippet, author, source, sentiment, engagement, publishedAt, url }]. */
  mentions?: Array<Record<string, unknown>> | null;
  /** Filtros activos de la pantalla (sentimiento, tópico, fuente, búsqueda, …). */
  filters?: Record<string, unknown> | null;
}

export const CHAT_SYSTEM_PROMPT = `
Eres el asistente analítico del dashboard de escucha social Populicom para agencias públicas de Puerto Rico. Respondes preguntas cuantitativas (cifras, volúmenes, métricas, sentimiento) y cualitativas (de qué habla la gente, ejemplos de menciones) de un analista.

REGLAS ESTRICTAS:

1. FUENTE ÚNICA: responde EXCLUSIVAMENTE con los datos del bloque <contexto_vista_actual> que recibes en cada turno. Ese bloque es lo que el usuario tiene en pantalla: una agencia, un periodo y unos filtros específicos. No tienes acceso a ninguna otra base de datos ni a internet.

2. SI NO ESTÁ, DILO: si la pregunta pide un dato que no aparece en el contexto (otra agencia, otro periodo, una métrica o mención que no está incluida, o un detalle que el snapshot no trae), dilo claramente. Usa una frase como: "No tengo ese dato en la vista actual (agencia X, periodo Y). Ajusta el periodo o los filtros del dashboard y vuelve a preguntar." NUNCA inventes cifras, nombres, autores ni tendencias que no estén en los datos.

3. CITA NÚMEROS: cada afirmación cuantitativa debe citar el número exacto del contexto (cantidad, porcentaje, score). No redondees a vaguedades.

4. CUALITATIVO CON EVIDENCIA: para preguntas de "qué dice la gente", apóyate en las menciones provistas (título/snippet) y, si ayuda, parafrasea o cita brevemente. No generalices sin respaldo en las menciones del contexto.

5. ALCANCE HONESTO: el snapshot incluye un número limitado de menciones (las más relevantes/recientes de la vista). Si la pregunta requiere exhaustividad que esa muestra no garantiza, acláralo ("según las N menciones de la vista…").

6. IDIOMA Y TONO: español de Puerto Rico, profesional, conciso y directo. Sin relleno, sin disclaimers innecesarios, sin recomendaciones prescriptivas a menos que te las pidan.

7. FORMATO: texto plano con markdown ligero permitido — **negritas** para cifras/nombres clave y viñetas con "- " para listas. No uses encabezados (#), ni tablas, ni bloques de código.
`.trim();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
}

const METRIC_LABELS: Array<[string, string]> = [
  ['totalMentions', 'Total de menciones'],
  ['positiveCount', 'Menciones positivas'],
  ['neutralCount', 'Menciones neutrales'],
  ['negativeCount', 'Menciones negativas'],
  ['nss', 'NSS (sentimiento neto)'],
  ['brandHealthIndex', 'BHI (salud de marca)'],
  ['crisisRiskScore', 'Índice de crisis'],
  ['polarizationIndex', 'Polarización'],
  ['engagementRate', 'Tasa de engagement'],
  ['totalReach', 'Alcance total'],
  ['engagementVelocity', 'Velocidad de engagement'],
  ['highPertinenceCount', 'Menciones de alta pertinencia'],
];

const DELTA_KEYS: Record<string, string> = {
  nss: 'nssDelta',
  brandHealthIndex: 'brandHealthDelta',
  crisisRiskScore: 'crisisDelta',
  totalMentions: 'totalMentionsDelta',
  engagementRate: 'engagementDelta',
};

/**
 * Serializa el snapshot de la vista en un bloque de texto compacto para el
 * modelo. Capa defensiva sobre los nombres de campo de /api/eco-data; tolera
 * campos ausentes. Limita menciones (`maxMentions`) y longitud de snippet.
 */
export function buildChatViewContextBlock(ctx: ChatViewContext, maxMentions = 50): string {
  const lines: string[] = [];

  const periodLabel = ctx.period === 'custom' && ctx.from && ctx.to
    ? `${ctx.from} → ${ctx.to} (rango personalizado)`
    : (ctx.period ?? 'desconocido');
  lines.push(`AGENCIA: ${ctx.agencyName ?? ctx.agencySlug ?? 'desconocida'}`);
  lines.push(`PANTALLA ACTIVA: ${ctx.screenLabel ?? ctx.screen ?? 'desconocida'}`);
  lines.push(`PERIODO: ${periodLabel} (zona horaria America/Puerto_Rico)`);

  const filters = ctx.filters && Object.keys(ctx.filters).length > 0
    ? Object.entries(ctx.filters)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join(', ')
    : '';
  if (filters) lines.push(`FILTROS ACTIVOS: ${filters}`);

  // ---- Métricas ----
  if (ctx.metrics) {
    const m = ctx.metrics;
    const out: string[] = [];
    for (const [key, label] of METRIC_LABELS) {
      const v = num(m[key]);
      if (v === null) continue;
      const dKey = DELTA_KEYS[key];
      const d = dKey ? num(m[dKey]) : null;
      const deltaStr = d !== null && d !== 0 ? ` (Δ ${d > 0 ? '+' : ''}${d} vs periodo previo)` : '';
      out.push(`- ${label}: ${v}${deltaStr}`);
    }
    if (out.length) {
      lines.push('', 'MÉTRICAS DEL PERIODO:', ...out);
    }
  }

  // ---- Sentimiento ----
  if (Array.isArray(ctx.sentiment) && ctx.sentiment.length) {
    const out = ctx.sentiment
      .map((s) => {
        const label = pick(s, ['label', 'name']);
        const value = num(pick(s, ['value', 'count', 'c']));
        return label && value !== null ? `- ${label}: ${value}` : null;
      })
      .filter(Boolean) as string[];
    if (out.length) lines.push('', 'DESGLOSE DE SENTIMIENTO:', ...out);
  }

  // ---- Tópicos ----
  if (Array.isArray(ctx.topics) && ctx.topics.length) {
    const out = ctx.topics.slice(0, 15).map((t) => {
      const name = pick(t, ['name', 'label', 'topicName']);
      const cnt = num(pick(t, ['count', 'c', 'value', 'total']));
      const delta = num(pick(t, ['delta', 'deltaPct']));
      const deltaStr = delta !== null && delta !== 0 ? ` (Δ ${delta > 0 ? '+' : ''}${delta})` : '';
      return name ? `- ${name}: ${cnt ?? 0}${deltaStr}` : null;
    }).filter(Boolean) as string[];
    if (out.length) lines.push('', 'TÓPICOS PRINCIPALES (por volumen):', ...out);
  }

  // ---- Fuentes ----
  if (Array.isArray(ctx.sources) && ctx.sources.length) {
    const out = ctx.sources.slice(0, 10).map((s) => {
      const name = pick(s, ['name', 'label', 'pageType', 'source']);
      const cnt = num(pick(s, ['count', 'c', 'value']));
      return name ? `- ${name}: ${cnt ?? 0}` : null;
    }).filter(Boolean) as string[];
    if (out.length) lines.push('', 'FUENTES PRINCIPALES:', ...out);
  }

  // ---- Municipios ----
  if (Array.isArray(ctx.municipalities) && ctx.municipalities.length) {
    const out = ctx.municipalities.slice(0, 10).map((mu) => {
      const name = pick(mu, ['name', 'label']);
      const cnt = num(pick(mu, ['count', 'c', 'value']));
      return name ? `- ${name}: ${cnt ?? 0}` : null;
    }).filter(Boolean) as string[];
    if (out.length) lines.push('', 'CONCENTRACIÓN GEOGRÁFICA:', ...out);
  }

  // ---- Emociones ----
  if (Array.isArray(ctx.emotions) && ctx.emotions.length) {
    const out = ctx.emotions.slice(0, 10).map((e) => {
      const name = pick(e, ['name', 'label']);
      const cnt = num(pick(e, ['count', 'c', 'value']));
      return name ? `- ${name}${cnt !== null ? `: ${cnt}` : ''}` : null;
    }).filter(Boolean) as string[];
    if (out.length) lines.push('', 'EMOCIONES DETECTADAS:', ...out);
  }

  // ---- Menciones ----
  if (Array.isArray(ctx.mentions) && ctx.mentions.length) {
    const items = ctx.mentions.slice(0, maxMentions).map((mn, i) => {
      const title = String(pick(mn, ['title']) ?? '').replace(/\s+/g, ' ').trim();
      const snippet = String(pick(mn, ['snippet']) ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
      const author = pick(mn, ['author']);
      const source = pick(mn, ['source', 'domain']);
      const sentiment = pick(mn, ['sentiment']);
      const eng = num(pick(mn, ['engagement']));
      const when = pick(mn, ['publishedAt']);
      const text = title || snippet;
      if (!text) return null;
      const meta = [
        sentiment ? `sent=${sentiment}` : null,
        source ? `fuente=${source}` : null,
        author ? `autor=${author}` : null,
        eng !== null ? `eng=${eng}` : null,
        when ? `cuándo=${when}` : null,
      ].filter(Boolean).join(' · ');
      const body = title && snippet && snippet !== title ? `${title} — ${snippet}` : text;
      return `${i + 1}. (${meta}) "${body}"`;
    }).filter(Boolean) as string[];
    if (items.length) {
      lines.push('', `MENCIONES DE LA VISTA (${items.length}${ctx.mentions.length > items.length ? ` de ${ctx.mentions.length}` : ''}):`, ...items);
    }
  }

  return lines.join('\n');
}

/**
 * Compone el contenido del turno de usuario que se envía al modelo: el bloque
 * de contexto de la vista + la pregunta. El historial conversacional previo lo
 * arma el route por separado (mensajes anteriores en texto plano).
 */
export function buildChatUserTurn(ctx: ChatViewContext, question: string, maxMentions = 50): string {
  const block = buildChatViewContextBlock(ctx, maxMentions);
  return `<contexto_vista_actual>\n${block}\n</contexto_vista_actual>\n\nPregunta del usuario:\n${question.trim()}`;
}
