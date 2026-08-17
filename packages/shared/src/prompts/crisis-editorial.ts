/**
 * Prompt para el correo editorial de alerta de crisis.
 *
 * Diferencia con `briefing-crisis.ts`: aquel produce 2 oraciones para el
 * Scorecard. Este produce un editorial completo: titular, sumario, 3-4
 * párrafos descriptivos, y una lista de drivers. Es el equivalente a un
 * "briefing nocturno" que un analista escribiría para que un ejecutivo
 * entienda en 90 segundos qué está pasando, por qué, y dónde mirar.
 *
 * Mismas reglas innegociables que el briefing del Scorecard (sin
 * recomendaciones, sin verbos de prensa amarilla, todo respaldado por
 * números). Se invoca con tool-use con `input_schema` — no se pide JSON
 * en texto plano.
 */
import type { MentionSample } from './weekly-report-insights';
import { HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

export interface CrisisEditorialInputs {
  agencyName: string;
  agencyShortName: string;
  generatedAtLabel: string;
  /** Banda actual: NORMAL | ELEVADO | ALERTA | CRISIS. */
  band: 'NORMAL' | 'ELEVADO' | 'ALERTA' | 'CRISIS';

  /** Score actual y comparación con 24h atrás para resaltar el cambio. */
  crisisRiskScore: number;
  crisisRiskScore24hAgo: number | null;
  crisisSeverity: number;
  /**
   * Cambio % del volumen de HOY (día parcial en curso) vs el promedio de los
   * 7 días previos AL MISMO CORTE HORARIO — el MISMO número que el lector ve
   * en el tile "Velocidad" del correo (ago 2026). null sin historial suficiente.
   */
  volumeVsAvg7Pct: number | null;
  volumeAnomalyZscore: number | null;

  /** Conteos del día detonante. */
  totalMentions: number;
  negativeCount: number;
  negativeShare: number;
  /** Conteo del día anterior, para señalar el salto. */
  prevDayTotal: number | null;
  prevDayNegative: number | null;

  /** Top 3 tópicos con mayor concentración negativa. */
  topNegativeTopics: Array<{
    topic: string;
    total: number;
    negative: number;
    negativeShare: number;
  }>;

  /** Top 3 municipios con concentración geográfica negativa. */
  topNegativeMunicipalities: Array<{
    municipality: string;
    total: number;
    negative: number;
  }>;

  /** 6–10 menciones negativas representativas para que el modelo cite voces concretas. */
  sampleMentions: MentionSample[];
}

export interface CrisisEditorialOutput {
  /** Titular ≤ 120 caracteres, factual, sin sensacionalismo. */
  headline: string;
  /** Lede de 1–2 oraciones ≤ 50 palabras. Sin recomendaciones. */
  lede: string;
  /**
   * Cuerpo editorial: 3–4 párrafos cortos (≤ 70 palabras cada uno), en HTML
   * mínimo (`<strong>` permitido, nada más). Describe qué pasó, cuándo, y
   * qué voces predominan. NO recomienda acciones.
   */
  bodyParagraphsHtml: string[];
  /**
   * 3 voces representativas del periodo, parafraseadas (no copy literal extenso).
   * Cada voz debe ser una frase con sustancia, no una etiqueta. La atribución
   * usa el medio o tipo de canal observado en la muestra (ej. "Twitter",
   * "Comentario en Facebook", "ElNuevoDia.com"). El tono cita la queja/elogio
   * tal como la audiencia lo expresa.
   */
  representativeVoices: Array<{
    /** Frase parafraseada (entre comillas en el render). ≤ 30 palabras. */
    quote: string;
    /** Atribución corta. Ej: "Comentario en Facebook · 18 may". */
    attribution: string;
    /** Tono dominante de la voz, mapeo a color. */
    tone: 'negative' | 'neutral' | 'positive';
  }>;
  /** 3 drivers concretos: cada uno con título corto + descripción 1 oración. */
  drivers: Array<{
    label: string;
    description: string;
  }>;
  /** Frase de cierre ≤ 30 palabras: contexto del momento, sin call-to-action. */
  closing: string;
}

export const CRISIS_EDITORIAL_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO escribiendo la alerta de crisis de una agencia pública. Un ejecutivo la abre en el teléfono y tiene 90 segundos para entender qué está pasando, quién lo está diciendo y hacia dónde va.`,
  `
- Los motivos que explican el episodio empiezan por el HECHO, nunca por el nombre
  del tópico. "El tópico Gestión / Administración concentra 5 de 11 menciones
  negativas" no le dice nada a nadie; "vacantes sin llenar y la reunión en La
  Fortaleza concentran casi la mitad de lo crítico del día" sí.
- Distingue si el episodio ARRANCA o si es COLA de uno anterior. El lector
  necesita saber si esto empieza o se está apagando, y eso se ve en el salto
  frente al día previo y en el Crisis Score de hace 24 horas.
- No amplifiques: reserva la palabra "crisis" para la banda Crisis. Si la banda
  es Elevado o Normal, el lenguaje es contenido.
- Nada de verbos de prensa amarilla: "estallar", "explotar", "se desata", "arde".
- Los números van en escala pública (%), tal como vienen en el contexto. Nunca
  la escala interna 0–1 ni tres decimales.
- Cuando cites una voz, parafraséala; no copies literal extenso. Y atribuye al
  medio o al tipo de canal, nunca a un @handle personal ni al nombre de un
  ciudadano privado.
- ${HTML_INLINE_RULE}
`,
);

/**
 * Construye el prompt de usuario con todos los datos cuantitativos y la
 * muestra de menciones. El esquema del tool_use está separado (lo arma el
 * lambda) — aquí solo se da el contexto.
 */
export function buildCrisisEditorialPrompt(inp: CrisisEditorialInputs): string {
  // Todo se entrega en escala pública (%) para que el modelo NUNCA vea el
  // 0–1 interno — si lo viera, lo citaría ("0.557") y el correo mezclaría
  // escalas con las tarjetas, que muestran %.
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;
  const fmtPctN = (n: number | null) => n == null ? 'n/d' : fmtPct(n);

  const score24h = inp.crisisRiskScore24hAgo;
  const scoreDelta = score24h == null
    ? '(sin registro de hace 24h)'
    : `(hace 24h: ${fmtPct(score24h)}; ${deltaPts(inp.crisisRiskScore, score24h)})`;

  const prevDayBlock = inp.prevDayTotal == null
    ? '- (sin datos del día previo)'
    : `- Día previo: ${inp.prevDayTotal} menciones, ${inp.prevDayNegative} negativas`;

  const negTopicsBlock = inp.topNegativeTopics.length > 0
    ? inp.topNegativeTopics.map((t) =>
        `- ${t.topic}: ${t.negative}/${t.total} negativas (${fmtPct(t.negativeShare)} neg del tópico)`,
      ).join('\n')
    : '- (sin tópicos con concentración negativa medible)';

  const negMuniBlock = inp.topNegativeMunicipalities.length > 0
    ? inp.topNegativeMunicipalities.map((m) => {
        const share = m.total > 0 ? Math.round((m.negative / m.total) * 100) : 0;
        return `- ${m.municipality}: ${m.negative}/${m.total} negativas (${share}%)`;
      }).join('\n')
    : '- (sin concentración geográfica negativa medible)';

  // Hasta 20 muestras con 600 chars c/u — antes 10 × 280. El LLM necesita
  // ver el texto completo para distinguir el lugar del EVENTO (literal en el
  // texto) del lugar del MEDIO (etiqueta automática), y para construir
  // análisis con más profundidad sobre actores y mecanismos.
  const samplesBlock = inp.sampleMentions.length > 0
    ? inp.sampleMentions
        .slice(0, 20)
        .map((s, i) => {
          const channel = s.source ? ` [medio=${s.source}]` : s.pageType ? ` [canal=${s.pageType}]` : '';
          const topic = s.topic ? ` (${s.topic})` : '';
          const text = (s.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 600);
          return `${i + 1}.${channel}${topic} ${text}`;
        })
        .join('\n')
    : '(sin muestras textuales disponibles)';

  return `
AGENCIA: ${inp.agencyName} (abreviada: ${inp.agencyShortName})
GENERADO: ${inp.generatedAtLabel}
BANDA ACTUAL: ${inp.band}

INDICADORES DE CRISIS (escala pública % — cítalos TAL CUAL, no los conviertas; son los MISMOS que el lector ve en el correo):
- Crisis Score: ${fmtPct(inp.crisisRiskScore)} ${scoreDelta}
- Severidad (concentración negativa): ${fmtPctN(inp.crisisSeverity)}
- Velocidad (volumen del día EN CURSO, a esta hora, vs el promedio de los 7 días previos al mismo corte horario): ${inp.volumeVsAvg7Pct == null ? 'sin historial suficiente' : `${inp.volumeVsAvg7Pct > 0 ? '+' : ''}${inp.volumeVsAvg7Pct}%`}
- Volumen vs lo usual de los últimos 30 días: ${volumePlain(inp.volumeAnomalyZscore)}

VOLUMEN DEL DÍA DETONANTE:
- Total: ${inp.totalMentions} menciones
- Negativas: ${inp.negativeCount} (${fmtPct(inp.negativeShare)} del total)
${prevDayBlock}

TÓPICOS CON MAYOR CONCENTRACIÓN NEGATIVA:
${negTopicsBlock}

MUNICIPIOS CON MAYOR CONCENTRACIÓN NEGATIVA:
${negMuniBlock}

MUESTRA DE MENCIONES NEGATIVAS (parafrasea, no copies literal extenso):
${samplesBlock}

TAREA:
Llama la herramienta \`submit_crisis_editorial\` con un objeto que tenga:
- \`headline\`: titular ≤ 120 caracteres, factual.
- \`lede\`: 1–2 oraciones (≤ 50 palabras) que abran como un párrafo de prensa serio. Si la banda es NORMAL, empieza con "Sin señales de crisis en el periodo."; si es ELEVADO, "Se observan señales elevadas en <tópico>".
- \`bodyParagraphsHtml\`: 3–4 párrafos (≤ 70 palabras cada uno). Permite \`<strong>\`; ninguna otra etiqueta. El primero cuenta QUÉ PASÓ — el hecho concreto, con el volumen y el salto frente al día previo como apoyo. El segundo cuenta QUÉ SE ESTÁ DICIENDO: el reclamo puntual, parafraseado de las menciones, y de quién viene (prensa, cargos públicos, o gente). El tercero dice HACIA DÓNDE VA: si el episodio se está inflando o desinflando, y qué lo sostiene. Sin recomendaciones.
- \`representativeVoices\`: arreglo de exactamente 3 voces representativas extraídas/parafraseadas de la muestra de menciones. Cada una con:
  - \`quote\`: paráfrasis ≤ 30 palabras, sin comillas dentro. NO copies literal extenso (riesgo legal con medios protegidos).
  - \`attribution\`: \`Tipo de canal o medio · día\` (ej. \`Comentario en Facebook · 18 may\`, \`Editorial en ElNuevoDia.com · 18 may\`, \`Reportaje en Notiuno · 18 may\`). **PROHIBIDO atribuir a un @handle personal o a un nombre de ciudadano privado.** Para autores individuales sin perfil público, usa "Comentario en Twitter", "Usuario en Facebook", "Comentario público". SÍ puedes usar nombres de medios y handles oficiales de medios. SÍ puedes usar cargos públicos ("el Secretario").
  - \`tone\`: \`negative\`, \`neutral\` o \`positive\`.
  Selecciona voces DIFERENTES entre sí — distintos tópicos o ángulos del enojo/elogio, no la misma queja repetida.
- \`drivers\`: 3 objetos \`{label, description}\` — es el bloque "¿Qué está pasando?" y es lo que más se lee del correo.
  \`label\`: ≤ 5 palabras nombrando EL HECHO, no la categoría del sistema. BIEN: "Vacantes y la reunión en Fortaleza", "Presión de la Legislatura", "El pico ya pasó". MAL: "Concentración negativa", "Gestión / Administración", "Pertinencia alta".
  \`description\`: 1 oración que cuente qué se está diciendo en concreto, con su cifra de apoyo detrás. Empieza por el hecho, no por el conteo.
  Uno de los tres drivers debe decir si el episodio ARRANCA o va BAJANDO, comparando con el día previo y con el Crisis Score de hace 24 horas.
- \`closing\`: 1 oración (≤ 30 palabras) que contextualice el momento sin recomendar acciones.
`.trim();
}


/** "subió 32 puntos" / "bajó 8 puntos" / "sin cambio" — para el contexto del prompt. */
function deltaPts(cur: number, prev: number): string {
  const pts = Math.round((cur - prev) * 100);
  if (pts > 0) return `subió ${pts} puntos`;
  if (pts < 0) return `bajó ${Math.abs(pts)} puntos`;
  return 'sin cambio';
}

/** Traducción llana de la anomalía de volumen (el z-score NO se le muestra al modelo). */
function volumePlain(z: number | null): string {
  if (z == null) return 'sin referencia suficiente';
  if (z >= 3) return 'MUY por encima de lo usual (pico fuerte)';
  if (z >= 2) return 'muy por encima de lo usual';
  if (z >= 1) return 'por encima de lo usual';
  if (z > -1) return 'dentro de lo usual';
  return 'por debajo de lo usual';
}
