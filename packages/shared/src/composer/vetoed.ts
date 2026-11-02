/**
 * Lista de vetados para titulares y textos del motor (spec, Anexo C).
 *
 * Insensible a mayúsculas y por palabra completa: «flanco» se marca, pero
 * «al frente del Departamento» no (las figuras «frente» y «ola» las detecta el
 * QA agente, no el código). Se amplía con cada hallazgo del QA y se versiona.
 */
export const VETOED_VERSION = 'vetados-v1';

export const VETOED_PHRASES: readonly string[] = [
  'aprieta', 'aprietan', 'apretó',
  'acorrala', 'acorralan',
  'se deslinda', 'se deslindan',
  'traslada la carga',
  'se apaga', 'se apagó',
  'sobrevive', 'sobreviven',
  'flanco',
  'dispara', 'disparan',
  'arremete', 'arremetió',
  'copó',
  'tira y jala',
  'bajo fuego', 'bajo la lupa', 'contra el reloj',
  'arrastra',
  'se agudiza',
  'estalla',
  'sacude', 'sacudió',
  'zozobra',
  'otro frente', 'nuevo frente', 'segundo frente',
];

/** Verbos literales que las reglas del equipo recomiendan (spec 9.1). */
export const LITERAL_VERBS: readonly string[] = [
  'dijo', 'afirmó', 'pidió', 'exigió', 'solicitó', 'reclamó', 'informó', 'anunció', 'publicó',
  'respondió', 'entregó', 'advirtió', 'aprobó', 'citó', 'presentó', 'explicó', 'preguntó',
  'felicitó', 'criticó',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VETOED_RES: ReadonlyArray<{ phrase: string; re: RegExp }> = /* @__PURE__ */ VETOED_PHRASES.map((phrase) => ({
  phrase,
  re: new RegExp(
    `(?<![\\p{L}\\p{N}])${phrase.split(/\s+/).map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}])`,
    'iu',
  ),
}));

/** Vetados presentes en el texto (en el orden de la lista). */
export function findVetoed(text: string): string[] {
  const t = text.normalize('NFC');
  return VETOED_RES.filter(({ re }) => re.test(t)).map(({ phrase }) => phrase);
}
