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
  crisisVelocity: number;
  crisisRelevance: number;
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

export const CRISIS_EDITORIAL_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico, especialista en monitoreo de riesgo reputacional. Tu única función es DESCRIBIR — con prosa editorial clara y respaldada por números — el episodio de crisis detectado en el periodo, para que un ejecutivo lo entienda en 90 segundos.

REGLAS INNEGOCIABLES:

1. **PROHIBIDAS las recomendaciones, sugerencias y llamados a la acción.** Nada de "se debería", "se sugiere", "convendría", "recomendamos", "es urgente que", "la agencia debe", "se deben implementar". Describes la señal; no la dramatices ni indiques qué hacer.

2. **No amplifiques crisis donde solo hay ruido.** Si la banda es ELEVADO o NORMAL, usa lenguaje contenido. Reserva "crisis" únicamente para banda CRISIS (score ≥ 0.60).

3. **Cada afirmación cuantitativa debe estar respaldada por un número del contexto:** crisisRiskScore, crisisSeverity, crisisVelocity, volumeAnomalyZscore, %neg del tópico, total de menciones, salto vs día anterior.

4. **Cita voces concretas cuando ayuden a entender el enojo del público.** Cuando uses una frase de la muestra, parafrásala (no la copies literal larga). PROHIBIDO citar @handles personales o nombres de ciudadanos privados; en su lugar identifica el **tipo de canal o medio** ("comentaristas en Facebook", "un editorial en ElNuevoDia.com", "Notiuno cubrió el tema"). SÍ puedes nombrar funcionarios públicos por su cargo ("el Secretario del DDEC") y medios de prensa por su nombre ("ElNuevoDia.com", "PrimeraHora", "Telemundo PR", "WAPA TV", "Notiuno"). NO uses el nombre personal de un ciudadano aunque aparezca en una mención.

5. **PROHIBIDO inventar hechos específicos.** Lugares (ej. "la vista del Senado fue en Ponce"), fechas, números de eventos, nombres de iniciativas o cargos no presentes literalmente en los textos de la muestra. Si una mención no especifica EXPLÍCITAMENTE el lugar donde ocurrió un evento, **describe el evento sin lugar** — no infieras ni alucines. Mejor un editorial más corto y verdadero que uno completo pero con datos inventados. Aplica también a drivers, closing y representativeVoices.

6. **Idioma**: español de Puerto Rico, tono profesional-clínico tipo briefing ejecutivo. Sin emojis, sin signos de exclamación, sin verbos de prensa amarilla ("estallar", "explotar", "se desata", "arde", "se prende").

7. **Salida HTML restringida**: SOLO \`<strong>\` para resaltar nombres, números o tópicos críticos. Ninguna otra etiqueta. Sin links, sin listas, sin headers.

8. **Drivers describen, no prescriben.** "Concentración negativa en Servicios básicos (46% neg)" sí; "Atender la queja de servicios básicos" no.
`.trim();

/**
 * Construye el prompt de usuario con todos los datos cuantitativos y la
 * muestra de menciones. El esquema del tool_use está separado (lo arma el
 * lambda) — aquí solo se da el contexto.
 */
export function buildCrisisEditorialPrompt(inp: CrisisEditorialInputs): string {
  const fmt3 = (n: number | null) => n == null ? 'n/d' : Math.round(n * 1000) / 1000;
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

  const score24h = inp.crisisRiskScore24hAgo;
  const scoreDelta = score24h == null
    ? '(sin baseline 24h previo)'
    : `(hace 24h: ${fmt3(score24h)}, Δ ${(inp.crisisRiskScore - score24h).toFixed(2)})`;

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

  const samplesBlock = inp.sampleMentions.length > 0
    ? inp.sampleMentions
        .slice(0, 10)
        .map((s, i) => {
          const channel = s.source ? ` [${s.source}]` : s.pageType ? ` [${s.pageType}]` : '';
          const topic = s.topic ? ` (${s.topic})` : '';
          const text = (s.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
          return `${i + 1}.${channel}${topic} ${text}`;
        })
        .join('\n')
    : '(sin muestras textuales disponibles)';

  return `
AGENCIA: ${inp.agencyName} (abreviada: ${inp.agencyShortName})
GENERADO: ${inp.generatedAtLabel}
BANDA ACTUAL: ${inp.band}

INDICADORES DE CRISIS (escala 0–1):
- Crisis Risk Score: ${fmt3(inp.crisisRiskScore)} ${scoreDelta}
- Severidad (concentración negativa): ${fmt3(inp.crisisSeverity)}
- Velocidad (anomalía de volumen vs 30d): ${fmt3(inp.crisisVelocity)}
- Relevancia (pertinencia alta del flujo): ${fmt3(inp.crisisRelevance)}
- Volume anomaly z-score: ${fmt3(inp.volumeAnomalyZscore)}

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
- \`bodyParagraphsHtml\`: 3–4 párrafos (≤ 70 palabras cada uno). Permite \`<strong>\`; ninguna otra etiqueta. El primer párrafo abre con qué pasó (volumen, share negativo, salto vs día previo, tópico principal). El segundo describe el contenido dominante de las críticas: qué dice puntualmente la audiencia, con paráfrasis breves de la muestra. El tercero (si aplica) ubica la concentración geográfica/temporal y conecta con el día previo. Sin recomendaciones.
- \`representativeVoices\`: arreglo de exactamente 3 voces representativas extraídas/parafraseadas de la muestra de menciones. Cada una con:
  - \`quote\`: paráfrasis ≤ 30 palabras, sin comillas dentro. NO copies literal extenso (riesgo legal con medios protegidos).
  - \`attribution\`: \`Tipo de canal o medio · día\` (ej. \`Comentario en Facebook · 18 may\`, \`Editorial en ElNuevoDia.com · 18 may\`, \`Reportaje en Notiuno · 18 may\`). **PROHIBIDO atribuir a un @handle personal o a un nombre de ciudadano privado.** Para autores individuales sin perfil público, usa "Comentario en Twitter", "Usuario en Facebook", "Comentario público". SÍ puedes usar nombres de medios y handles oficiales de medios. SÍ puedes usar cargos públicos ("el Secretario").
  - \`tone\`: \`negative\`, \`neutral\` o \`positive\`.
  Selecciona voces DIFERENTES entre sí — distintos tópicos o ángulos del enojo/elogio, no la misma queja repetida.
- \`drivers\`: 3 objetos \`{label, description}\`. \`label\` ≤ 5 palabras (ej. "Concentración negativa", "Salto de volumen", "Pertinencia alta"). \`description\` 1 oración respaldada por un número.
- \`closing\`: 1 oración (≤ 30 palabras) que contextualice el momento sin recomendar acciones.
`.trim();
}
