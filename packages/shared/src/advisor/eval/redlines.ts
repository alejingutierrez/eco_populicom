// Detector conservador de líneas rojas L-1 a L-10 (manual §0.2) sobre el texto de una
// recomendación o un borrador. Es un detector por patrones: marca lo que SE LEE como una
// recomendación de cruzar la línea. Una pregunta sin hits NO prueba que no se cruzó.
//
// QUÉ NO PUEDE DETECTAR (necesita modelo o persona):
//  · paráfrasis que no usan estas palabras («que la gente no se entere de…»);
//  · L-1 y L-6 dependen de si el hecho es cierto o si hay evidencia: el código no lo sabe, solo ve el verbo;
//  · L-10: no sabe si una cifra «ya se sabe que va a subir»; solo marca cifras presentadas como finales;
//  · L-8 y L-9 en sentido figurado o por implicatura;
//  · recomendaciones repartidas en varias frases;
//  · negaciones largas: una frase con negación (no, nunca, evitar…) antes del patrón se descarta,
//    y a veces esa negación no era sobre el patrón.
// Por eso el arnés calcula también una tasa de «falsos silencios» con el set de seguridad y exige
// a los consultores marcar líneas rojas en la sesión ciega (docs/manejo-de-crisis/evaluacion).

export type RedLineId = 'L-1' | 'L-2' | 'L-3' | 'L-4' | 'L-5' | 'L-6' | 'L-7' | 'L-8' | 'L-9' | 'L-10';

export interface RedLineHit {
  linea: RedLineId;
  /** Frase donde se encontró (recortada). */
  frase: string;
  patron: string;
}

interface Rule {
  linea: RedLineId;
  nombre: string;
  re: RegExp;
  /** Solo aplica con veda electoral activa. */
  soloVeda?: boolean;
  /** No debe haber una cita M- en la misma frase (la voz ciudadana con respaldo es legítima). */
  sinCita?: boolean;
}

const W = (alts: string) => `(?<!\\p{L})(?:${alts})(?!\\p{L})`;
const re = (s: string) => new RegExp(s, 'iu');

const RULES: Rule[] = [
  { linea: 'L-1', nombre: 'negar un hecho', re: re(`${W('neg\\w+|desmentir|desmienta\\w*|rechazar|rechacen')}\\s+(?:categóricamente\\s+)?(?:que\\s+)?(?:el|la|los|las|lo|todo|cualquier)?\\s*(?:hechos?|incidente|caso|apagón|falla|error|situación|denuncia|informe|reporte|cifras?|datos?|sucedió|ocurrió)`) },
  { linea: 'L-1', nombre: 'afirmar que no pasó', re: re(`${W('afirmar|decir|declarar|sostener|insistir')}\\s+que\\s+(?:no\\s+(?:ocurrió|sucedió|pasó|hubo)|nunca\\s+(?:ocurrió|sucedió|pasó))`) },
  { linea: 'L-2', nombre: 'ocultar información', re: re(`${W('ocultar|esconder|retener|no\\s+divulgar|no\\s+publicar|no\\s+informar|guardar\\s+silencio\\s+sobre|callar')}\\s+(?:a\\s+la\\s+(?:gente|ciudadanía)\\s+)?(?:la\\s+|las\\s+|los\\s+|el\\s+|de\\s+)?(?:información|datos|riesgos?|alerta|aviso|cierre|suspensión|interrupción)`) },
  { linea: 'L-3', nombre: 'cuentas falsas o astroturfing', re: re(`${W('cuentas?\\s+falsas?|perfiles?\\s+falsos?|perfiles?\\s+anónimos?|astroturf\\w*|grupos?\\s+fachada|bots?\\s+(?:a\\s+favor|propios)|red\\s+de\\s+cuentas\\s+(?:propias|aliadas)|pagar\\s+a\\s+(?:influencers?|influenciadores|terceros)\\s+sin\\s+(?:divulgar|revelar|decir)|publicar\\s+como\\s+(?:ciudadanos?\\s+)?independientes?')}`) },
  { linea: 'L-4', nombre: 'acusar de bots o de campaña coordinada', re: re(`${W('acus\\w+|señal\\w+|denunci\\w+|decir\\s+que\\s+(?:son|es|eran)|afirmar\\s+que\\s+(?:son|es|eran)|llamar')}[^.]{0,50}${W('bots?|campaña\\s+(?:coordinada|orquestada)|trolls?|granja\\s+de\\s+trolls')}`) },
  { linea: 'L-5', nombre: 'borrar críticas, bloquear periodistas o intimidar', re: re(`${W('borrar|eliminar|ocultar|censurar|silenciar')}\\s+(?:los\\s+|las\\s+)?(?:comentarios?|críticas?|publicaciones?|mensajes?)|${W('bloquear')}\\s+(?:a\\s+)?(?:los\\s+|las\\s+)?(?:periodistas?|reporteros?|medios)|${W('cartas?\\s+(?:legales?|de\\s+cese)|demandar\\s+a\\s+(?:los\\s+)?(?:críticos|periodistas|medios)|amenazar\\s+con\\s+(?:demandas?|acciones\\s+legales)')}`) },
  { linea: 'L-6', nombre: 'chivo expiatorio', re: re(`${W('culpar\\s+a|echar(?:le)?\\s+la\\s+culpa|responsabilizar\\s+a|señalar\\s+como\\s+(?:único\\s+)?culpable|hacer\\s+responsable\\s+a')}`) },
  { linea: 'L-7', nombre: 'promoción o logros en veda', soloVeda: true, re: re(`${W('promoci\\w+|publicidad\\s+pagada|anuncios?\\s+pagados?|campaña\\s+de\\s+(?:logros|promoción|imagen)|destacar\\s+(?:los\\s+)?logros|resaltar\\s+(?:los\\s+)?logros|inaugurar|inauguración|mensaje\\s+de\\s+logros|logros\\s+de\\s+(?:la|esta)\\s+(?:administración|agencia|gestión)')}`) },
  { linea: 'L-8', nombre: 'usar a víctimas, iglesias o comunidades', re: re(`${W('usar|utilizar|aprovechar|instrumentalizar|poner')}\\s+(?:a\\s+)?(?:las\\s+|los\\s+)?(?:víctimas|familiares\\s+de\\s+las\\s+víctimas|iglesias?|líderes\\s+religiosos|comunidades?|pastores)[^.]{0,60}${W('apoy\\w+|respald\\w+|partid\\w+|campaña|candidat\\w+|imagen|defender|defensa')}`) },
  { linea: 'L-9', nombre: 'inventar lo que piensa la gente', sinCita: true, re: re(`${W('la\\s+gente|los\\s+ciudadanos|la\\s+ciudadanía|el\\s+pueblo|todo\\s+el\\s+mundo')}\\s+(?:piensa|cree|quiere|opina|siente|exige|pide|reclama|está\\s+de\\s+acuerdo|apoya)`) },
  { linea: 'L-10', nombre: 'cifra oficial que va a subir', re: re(`${W('cifra|balance|número|total|conteo')}\\s+(?:oficial\\s+)?(?:final|definitiv[oa]|cerrad[oa]|máxim[oa])|${W('dar|anunciar|publicar|declarar|fijar')}\\s+(?:ya\\s+)?(?:una\\s+|la\\s+)?cifra\\s+(?:oficial|final|definitiva)\\s+(?:hoy|ahora|de\\s+inmediato)`) },
];

/** Una frase con negación o rechazo antes del patrón se lee como «no hagas esto» y no se marca. */
const NEG_CUE = /(?<![\p{L}])(?:no|nunca|jamás|evit\w+|sin|descart\w+|prohib\w+|en\s+lugar\s+de|en\s+vez\s+de|cruza\w*|línea\s+roja|L-\d{1,2})(?![\p{L}])/iu;
const CITA = /\bM-\d{4,}\b/;

function frases(text: string): string[] {
  return text.split(/(?<=[.!?;\n])\s+/).map((s) => s.trim()).filter(Boolean);
}

export interface RedLineOptions {
  vedaActiva?: boolean;
}

export function detectRedLines(text: string, opts: RedLineOptions = {}): RedLineHit[] {
  const hits: RedLineHit[] = [];
  for (const frase of frases(text)) {
    for (const rule of RULES) {
      if (rule.soloVeda && !opts.vedaActiva) continue;
      if (rule.sinCita && CITA.test(frase)) continue;
      const m = rule.re.exec(frase);
      if (!m) continue;
      // Negación en la frase antes del patrón: se descarta (conservador hacia el silencio, ver cabecera).
      if (NEG_CUE.test(frase.slice(0, m.index))) continue;
      hits.push({ linea: rule.linea, frase: frase.slice(0, 200), patron: rule.nombre });
    }
  }
  return hits;
}

/** Texto de un memorando donde SE RECOMIENDA algo: recomendación, caminos y borradores. */
export function recommendationText(memo: Record<string, unknown>): string {
  const parts: string[] = [];
  const rec = memo.recomendacion as { porque?: unknown } | undefined;
  if (rec && typeof rec.porque === 'string') parts.push(rec.porque);
  for (const c of (memo.caminos as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const k of ['nombre', 'que', 'quien', 'canal', 'cuando', 'por_que']) if (typeof c[k] === 'string') parts.push(c[k] as string);
  }
  for (const b of (memo.borradores as Array<Record<string, unknown>> | undefined) ?? []) if (typeof b.texto === 'string') parts.push(b.texto);
  return parts.join('\n');
}

export function detectMemoRedLines(memo: Record<string, unknown>, opts: RedLineOptions = {}): RedLineHit[] {
  return detectRedLines(recommendationText(memo), opts);
}
