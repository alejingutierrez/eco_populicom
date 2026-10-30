// Revisión automática de borradores (spec §7.3 y M-116: los trece puntos).
// Comprobaciones mecánicas, sin modelo. Lo que requiere juicio queda en `no_mecanico`
// para que el revisor FAST o una persona lo vean; nunca se marca «ok» sin comprobarlo.

export type ReviewState = 'ok' | 'alerta' | 'no_mecanico';

export interface ReviewPoint {
  id: number;
  nombre: string;
  estado: ReviewState;
  nota: string;
}

export interface ReviewContext {
  /** Veda electoral vigente en la fecha de la pieza (lo calcula `calendario_legal`). */
  vedaActiva: boolean;
  /** La agencia es de Familia: aplica el punto de datos de menores. */
  esFamilia: boolean;
}

export interface ReviewResult {
  puntos: ReviewPoint[];
  /** Cuántos puntos quedaron en alerta. */
  alertas: number;
}

// `\b` de JavaScript no reconoce letras acentuadas: los bordes de palabra van con \p{L}.
const word = (alts: string) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, 'iu');

const ADJ_CULPA = word('vergonzos[oa]s?|escandalos[oa]s?|inaceptable|irresponsable|desastros[oa]s?|negligencia|culpa');
const ADJ_ELOGIO = word('excelente|extraordinari[oa]|histórico|histórica|sin precedentes|el mejor|la mejor|magnífic[oa]');
const SIN_COMENTARIOS = word('sin comentarios?|no (?:vamos a )?(?:comentar|hacer declaraciones)');
const NO_DISCULPA = word('no (?:nos )?disculpamos|no hay (?:nada )?que disculpar');
// Marcas fuertes: «te», «su» o «tu» aparecen en cualquier texto y darían falsas alertas.
const TU_FORMS = word('tú|contigo|tienes|puedes|eres|estás|sabes|tus');
const USTED_FORMS = word('usted|ustedes');
const PROMESA_AJENA = word('garantizamos|prometemos|aseguramos que|el (?:gobierno|estado) (?:va a|garantiza)');
const LOGRO = word('logramos|logro|éxito|exitos[oa]|hemos conseguido|récord|record');
const AMENAZA_PENAL = word('los vamos a (?:demandar|procesar)|cárcel|arresto|delito penal|denuncia penal');
const ACUSACION_PERSONA = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ (?:es|fue|son|era) (?:un |una )?(?:corrupt[oa]s?|ladr[oó]n|ladrona|mentiros[oa]s?|criminal)/;
const MENOR_IDENT = /\b(?:menor|niñ[oa]|adolescente)\b[^.\n]{0,60}\b(?:de \d{1,2} a[ñn]os|\d{1,2} años|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/;
const HORA = /\b\d{1,2}(?::\d{2})?\s?(?:a\.?\s?m\.?|p\.?\s?m\.?)\b|\b(?:mañana|tarde|noche) (?:de|a las) \d{1,2}\b/i;

function frases(text: string): string[] {
  return text.split(/[.!?]+\s/).map((s) => s.trim()).filter(Boolean);
}

/** Legibilidad aproximada: palabras por oración y longitud media de palabra (proxy de grado escolar). */
function gradoAproximado(text: string): number {
  const oraciones = frases(text);
  const palabras = text.split(/\s+/).filter((w) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(w));
  if (oraciones.length === 0 || palabras.length === 0) return 0;
  const largoMedio = palabras.reduce((a, w) => a + w.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '').length, 0) / palabras.length;
  const palabrasPorFrase = palabras.length / oraciones.length;
  // Aproximación tipo Szigriszt/Fernández: cuanto más largas las frases y las palabras, más alto el grado.
  return +(0.39 * palabrasPorFrase + 11.8 * largoMedio - 15.59).toFixed(1);
}

/** Revisa un borrador. Pura: no llama al modelo ni a la base. */
export function reviewDraft(text: string, ctx: ReviewContext): ReviewResult {
  const pts: ReviewPoint[] = [];
  const add = (id: number, nombre: string, estado: ReviewState, nota: string) => pts.push({ id, nombre, estado, nota });

  // 1 · Hora del próximo parte: debe aparecer una hora concreta.
  add(1, 'Hora del próximo parte', HORA.test(text) ? 'ok' : 'alerta', HORA.test(text) ? 'hay hora' : 'no se encontró una hora concreta');

  // 2 · Cifras con corte y estado: requiere saber qué cifra es → juicio.
  add(2, 'Cifras con corte y estado', 'no_mecanico', 'revisar cada cifra contra su fecha de corte');

  // 3 · Palabras del marco adversario: lista por caso; juicio.
  add(3, 'Palabras del marco adversario', 'no_mecanico', 'depende del marco del adversario de la semana');

  // 4 · Adjetivos de elogio o culpa en las primeras 24 h.
  const adj = ADJ_CULPA.test(text) || ADJ_ELOGIO.test(text);
  add(4, 'Adjetivos de elogio o culpa', adj ? 'alerta' : 'ok', adj ? 'hay adjetivo de elogio o culpa' : 'sin adjetivos marcados');

  // 5 · «Sin comentarios» o no-disculpas.
  const sc = SIN_COMENTARIOS.test(text) || NO_DISCULPA.test(text);
  add(5, '«Sin comentarios» o no-disculpas', sc ? 'alerta' : 'ok', sc ? 'frase de cierre sin explicación' : 'no aparece');

  // 6 · Repetir la acusación para negarla: juicio sobre el contexto.
  add(6, 'Repetir la acusación para negarla', 'no_mecanico', 'revisar si la negación repite el titular del adversario');

  // 7 · Tres o cuatro acciones en positivo: conteo de frases imperativas no fiable → juicio.
  add(7, 'Tres o cuatro acciones en positivo', 'no_mecanico', 'contar acciones concretas');

  // 8 · Legibilidad de sexto a octavo grado.
  const grado = gradoAproximado(text);
  const legible = grado >= 6 && grado <= 8;
  add(8, 'Legibilidad de sexto a octavo grado', legible ? 'ok' : 'alerta', `grado aproximado ${grado}`);

  // 9 · «Usted» sin mezclar con «tú».
  const mezcla = TU_FORMS.test(text) && USTED_FORMS.test(text);
  add(9, '«Usted» sin mezclar con «tú»', mezcla ? 'alerta' : 'ok', mezcla ? 'aparecen formas de tú y de usted' : 'consistente');

  // 10 · Promesas que dependen de otro.
  const promesa = PROMESA_AJENA.test(text);
  add(10, 'Promesas que dependen de otro', promesa ? 'alerta' : 'ok', promesa ? 'promesa que depende de otra instancia' : 'sin promesas marcadas');

  // 11 · Logros en veda.
  const logroVeda = ctx.vedaActiva && LOGRO.test(text);
  add(11, 'Logros en veda', logroVeda ? 'alerta' : 'ok', ctx.vedaActiva ? (logroVeda ? 'logro durante la veda' : 'veda activa, sin logros marcados') : 'sin veda');

  // 12 · La prueba del titular (la peor frase sacada de contexto): juicio.
  add(12, 'Prueba del titular', 'no_mecanico', 'revisar la frase más dañina sacada de contexto');

  // 13 · En Familia, ningún dato que identifique al menor.
  const menor = ctx.esFamilia && MENOR_IDENT.test(text);
  add(13, 'Datos que identifican al menor', menor ? 'alerta' : 'ok', ctx.esFamilia ? (menor ? 'posible identificación de menor' : 'sin datos de menor') : 'no aplica (no es Familia)');

  // Comprobaciones de §7.3 que M-116 no numera: amenazas penales (14) y acusaciones a personas (15).
  if (AMENAZA_PENAL.test(text)) add(14, 'Amenaza penal', 'alerta', 'lenguaje de amenaza penal');
  if (ACUSACION_PERSONA.test(text)) add(15, 'Acusación a persona identificable', 'alerta', 'acusación directa a una persona');

  return { puntos: pts, alertas: pts.filter((p) => p.estado === 'alerta').length };
}
