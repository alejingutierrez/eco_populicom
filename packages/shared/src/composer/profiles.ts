/**
 * Perfiles por superficie (spec 10.6). Todas usan el mismo motor; el perfil
 * fija el esquema de salida, las etapas, las muestras y las reglas de largo.
 *
 * Las tareas de `daily` son las del prototipo (agents.py) sin cambios de
 * fondo; las de los demás perfiles siguen el mismo molde.
 */
import { COMPOSER_EMAIL_SYSTEM_BASE, COMPOSER_WEB_SYSTEM_BASE } from './prompts';
import type { DraftShape } from './schemas';
import type { ComposerRole } from './types';

export type ComposerProfileId = 'daily' | 'weekly' | 'overview' | 'scorecard' | 'light';

export interface ComposerProfile {
  id: ComposerProfileId;
  /** Etiqueta del asunto (`Diario` → `[Diario]`); null si la superficie no es un correo. */
  subjectTag: string | null;
  /** `day`: resume el último día con contexto del periodo; `period`: resume la ventana entera. */
  scope: 'day' | 'period';
  shape: DraftShape;
  stages: {
    analyst: boolean;
    qaAgent: boolean;
    /** El corrector corre solo si hay defectos (agente o código). */
    corrector: boolean;
  };
  includeTodaySamples: boolean;
  systemBase: string;
  analystTask: string;
  writerTask: string;
  qaTask: string;
  correctorTask: string;
  maxTokens: Record<ComposerRole, number>;
}

const QA_TASK = `

TAREA (rol QA): revisa cada oración contra las muestras, sus fechas y la lista de hechos. Busca: cifras que no coinciden; cuantificadores que las muestras no respaldan (muchos, la mayoría, casi todos, al menos N; «varios» pide 3 o más muestras, «muchos» 8 o más); atribuciones a quien no lo dijo; días o fechas mal puestos, sobre todo una reacción a una publicación vieja contada como noticia del día; novedades que no se demuestran; afirmaciones de AUSENCIA («no hubo», «sin críticas», «ningún medio») que ningún hecho respalda; verbos dramáticos, figuras o intención atribuida; contradicciones entre titular, párrafo, viñetas e insights. Si no hay defectos, devuelve lista vacía.`;

const CORRECTOR_TASK = '\n\nTAREA (rol CORRECTOR): devuelve el borrador completo con esos defectos corregidos (mismos campos, cifras solo con marcadores {{id}}). Si una frase no se puede respaldar, elimínala en lugar de suavizarla.';

const ANALYST_DAY = `

TAREA (rol ANALISTA): agrupa lo que pasó el día en hilos (threads) y lo de la semana por sentimiento (week). Para cada hilo/hallazgo:
- 'what': una oración literal (qué dijo o hizo quién), sin cifras propias (si hace falta una cifra, nombra el id del hecho en fact_ids).
- 'evidence': los ids de muestra ([D3], [N2]...) que lo sostienen. Solo cuenta como evidencia una muestra que de verdad lo diga.
- 'kind': si las muestras de un hilo son comentarios a una publicación de más de 2 días, es 'reaccion_tardia_a_publicacion_anterior' y 'origin_day' es la fecha de esa publicación. Si el día solo tiene eso, dilo en 'tone_of_day' (por ejemplo, día tranquilo con reacciones tardías).
- 'who_said': autor o página tal como aparece en las muestras.
- week: 1 a 3 hallazgos por sentimiento; si el sentimiento de ECO de una muestra no coincide con su texto, no la uses como evidencia de ese sentimiento.
- 'cautions': cosas que el redactor no debe afirmar (por ejemplo, novedades o ausencias que las muestras no demuestran).`;

const ANALYST_PERIOD = `

TAREA (rol ANALISTA): agrupa lo que pasó en el periodo en hilos (threads) y resume por sentimiento (week). Para cada hilo/hallazgo:
- 'what': una oración literal (qué dijo o hizo quién), sin cifras propias (si hace falta una cifra, nombra el id del hecho en fact_ids).
- 'evidence': los ids de muestra ([N2], [P4]...) que lo sostienen. Solo cuenta como evidencia una muestra que de verdad lo diga.
- 'kind': si las muestras de un hilo son comentarios a una publicación anterior al día en que se escribieron por más de 2 días, es 'reaccion_tardia_a_publicacion_anterior' y 'origin_day' es la fecha de esa publicación.
- 'who_said': autor o página tal como aparece en las muestras.
- week: 1 a 3 hallazgos por sentimiento; si el sentimiento de ECO de una muestra no coincide con su texto, no la uses como evidencia de ese sentimiento.
- 'cautions': cosas que el redactor no debe afirmar (novedades, ausencias o cambios contra el periodo previo que los hechos no demuestran).`;

const WRITER_DAILY = `

TAREA (rol REDACTOR): escribe el análisis completo del correo del día en UNA sola pasada para que todos los bloques sean coherentes:
- headline: titular con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo; si el día solo tuvo reacciones tardías a una publicación vieja, el titular lo dice (con su fecha).
- paragraph: 2 a 4 oraciones; puedes usar <strong>…</strong> en lo clave; cifras solo con marcadores {{id}}.
- highlights: 3 o 4 viñetas, cada una cuenta un hecho (no una cifra con etiqueta).
- insights: 1 o 2 ítems por sentimiento (negative, neutral, positive) sobre la semana, con fechas del post cuando sea reacción a una publicación.
Responde con la herramienta.`;

const WRITER_WEEKLY = `

TAREA (rol REDACTOR): escribe el resumen semanal comparativo en UNA sola pasada para que todos los bloques sean coherentes:
- headline: titular de la semana con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo; nombra el hecho o el cambio central de la semana.
- paragraph: 3 a 5 oraciones sobre qué pasó en la semana y quién lo dijo; puedes usar <strong>…</strong> en lo clave; cifras solo con marcadores {{id}}.
- highlights: 3 o 4 viñetas, cada una cuenta un hecho de la semana (no una cifra con etiqueta).
- insights: 1 o 2 ítems por sentimiento (negative, neutral, positive), con fechas del post cuando sea reacción a una publicación.
- comparison: 2 a 4 ítems que comparan esta semana con la previa usando SOLO los marcadores del periodo previo y de variación (prev_week_*, week_*_delta_*) y de composición (comment_share_week, comment_share_prev_week). Si el peso de los comentarios cambió mucho entre semanas, dilo: los totales no comparan el mismo tipo de conversación. Si un porcentaje de variación no está en los hechos (base previa pequeña), usa la variación absoluta.
Responde con la herramienta.`;

const WRITER_OVERVIEW = `

TAREA (rol REDACTOR): escribe el lede del periodo para el Overview en UNA sola pasada para que todos los bloques sean coherentes:
- headline: titular del periodo con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo.
- paragraph: 3 a 5 oraciones que expliquen qué pasó en el periodo, a raíz de qué y quién lo dijo; puedes usar <strong>…</strong> en lo clave; cifras solo con marcadores {{id}}.
- highlights: 2 a 4 viñetas, cada una cuenta un hecho (no una cifra con etiqueta).
- insights: 1 o 2 ítems por sentimiento (negative, neutral, positive), con fechas del post cuando sea reacción a una publicación.
Responde con la herramienta.`;

const WRITER_SCORECARD = `

TAREA (rol REDACTOR): escribe el resumen ejecutivo del Scorecard en UNA sola pasada para que las secciones sean coherentes:
- headline: titular del periodo con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo.
- paragraph: 2 o 3 oraciones con lo central del periodo; cita el periodo tal como aparece en el contexto.
- highlights: lista vacía o 1 o 2 viñetas si algo no cabe en las secciones.
- sections.signal: qué domina la conversación (narrative de 2 a 3 oraciones, points con DOS viñetas que cuentan hechos).
- sections.emerging: qué empezó a aparecer; solo si las muestras con fecha lo demuestran; si no, de qué sigue hablando la gente, sin presentarlo como emergente.
- sections.crisis: qué críticas o hechos adversos hay y quién los dice; sin alarmismo.
Cifras solo con marcadores {{id}}. Responde con la herramienta.`;

const WRITER_LIGHT = `

TAREA (rol REDACTOR): escribe un texto breve en UNA sola pasada:
- headline: una línea con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo.
- paragraph: 2 o 3 oraciones; cifras solo con marcadores {{id}}.
- highlights: 0 a 3 viñetas, cada una cuenta un hecho.
Responde con la herramienta.`;

const OPUS_TOKENS = { analyst: 5000, writer: 4000, qa: 3000, corrector: 4000 };

export const COMPOSER_PROFILES: Record<ComposerProfileId, ComposerProfile> = {
  daily: {
    id: 'daily', subjectTag: 'Diario', scope: 'day',
    shape: { insights: true, comparison: false },
    stages: { analyst: true, qaAgent: true, corrector: true },
    includeTodaySamples: true,
    systemBase: COMPOSER_EMAIL_SYSTEM_BASE,
    analystTask: ANALYST_DAY, writerTask: WRITER_DAILY, qaTask: QA_TASK, correctorTask: CORRECTOR_TASK,
    maxTokens: OPUS_TOKENS,
  },
  weekly: {
    id: 'weekly', subjectTag: 'Semanal', scope: 'period',
    shape: { insights: true, comparison: true },
    stages: { analyst: true, qaAgent: true, corrector: true },
    includeTodaySamples: false,
    systemBase: COMPOSER_EMAIL_SYSTEM_BASE,
    analystTask: ANALYST_PERIOD, writerTask: WRITER_WEEKLY, qaTask: QA_TASK, correctorTask: CORRECTOR_TASK,
    maxTokens: { ...OPUS_TOKENS, writer: 5000, corrector: 5000 },
  },
  overview: {
    id: 'overview', subjectTag: null, scope: 'period',
    shape: { insights: true, comparison: false },
    stages: { analyst: true, qaAgent: true, corrector: true },
    includeTodaySamples: false,
    systemBase: COMPOSER_WEB_SYSTEM_BASE,
    analystTask: ANALYST_PERIOD, writerTask: WRITER_OVERVIEW, qaTask: QA_TASK, correctorTask: CORRECTOR_TASK,
    maxTokens: OPUS_TOKENS,
  },
  scorecard: {
    id: 'scorecard', subjectTag: null, scope: 'period',
    shape: { insights: false, comparison: false, sections: ['signal', 'emerging', 'crisis'] },
    stages: { analyst: true, qaAgent: true, corrector: true },
    includeTodaySamples: false,
    systemBase: COMPOSER_WEB_SYSTEM_BASE,
    analystTask: ANALYST_PERIOD, writerTask: WRITER_SCORECARD, qaTask: QA_TASK, correctorTask: CORRECTOR_TASK,
    maxTokens: { ...OPUS_TOKENS, writer: 5000, corrector: 5000 },
  },
  // Perfil ligero (KPI, tópicos, texto de crisis): redactor + QA código + una vuelta de corrector.
  light: {
    id: 'light', subjectTag: null, scope: 'period',
    shape: { insights: false, comparison: false },
    stages: { analyst: false, qaAgent: false, corrector: true },
    includeTodaySamples: false,
    systemBase: COMPOSER_WEB_SYSTEM_BASE,
    analystTask: '', writerTask: WRITER_LIGHT, qaTask: QA_TASK, correctorTask: CORRECTOR_TASK,
    maxTokens: { analyst: 0, writer: 1500, qa: 1500, corrector: 1500 },
  },
};

export function getProfile(p: ComposerProfileId | ComposerProfile): ComposerProfile {
  return typeof p === 'string' ? COMPOSER_PROFILES[p] : p;
}
