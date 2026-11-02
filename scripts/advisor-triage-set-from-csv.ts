// Convierte la plantilla CSV de etiquetado del triaje a un set JSON y lo valida.
// No llama a ningún modelo y no mide nada.
//   node_modules/.bin/tsx scripts/advisor-triage-set-from-csv.ts <entrada.csv> <salida.json>
// Valida: columnas y valores, ids únicos, etiqueta ≥ piso por reglas, mínimo de casos, reparto por camino
// y casi copias (similitud de tokens ≥ 0,5) contra los sets existentes y entre sí.

import * as fs from 'fs';
import * as path from 'path';
import { csvToSet } from '../apps/web/src/lib/advisor/triage-set-csv';

const MIN_CASOS = 183;
const SETS_DIR = path.resolve(__dirname, '..', 'apps/web/src/lib/advisor/triage-set');
const toks = (t: string) => new Set(t.toLowerCase().match(/\p{L}[\p{L}\p{N}]*|\p{N}+/gu) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

const [entrada, salida] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error('Uso: tsx scripts/advisor-triage-set-from-csv.ts <entrada.csv> <salida.json>');
  process.exit(2);
}

const { items, errors } = csvToSet(fs.readFileSync(entrada, 'utf8'));
const avisos: string[] = [];
if (items.length < MIN_CASOS) errors.push(`Hay ${items.length} casos válidos; se necesitan al menos ${MIN_CASOS}.`);
const porCamino = [1, 2, 3].map((c) => items.filter((x) => x.caminoMinimo === c).length);
porCamino.forEach((n, i) => {
  if (items.length && n / items.length < 0.2) avisos.push(`Solo ${n} casos de camino ${i + 1} (${Math.round((100 * n) / items.length)} %); conviene al menos 20 %.`);
});

const otros = fs
  .readdirSync(SETS_DIR)
  .filter((f) => /^(set|holdout(-\d+)?|dev-.*)\.json$/.test(f))
  .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), 'utf8')) as { id: string; pregunta: string }[]).map((x) => ({ f, id: x.id, t: toks(x.pregunta) })));
const propios = items.map((x) => ({ id: x.id, t: toks(x.pregunta) }));
propios.forEach((p, i) => {
  const o = otros.find((x) => jaccard(p.t, x.t) >= 0.5);
  if (o) errors.push(`${p.id}: casi copia de ${o.id} (${o.f}); reescríbela con otra situación.`);
  for (let j = 0; j < i; j++) if (jaccard(p.t, propios[j].t) >= 0.5) errors.push(`${p.id}: casi copia de ${propios[j].id} (de este mismo archivo).`);
});

if (errors.length) {
  console.error(`No se escribió ${salida}. ${errors.length} problema(s):`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
fs.writeFileSync(salida, JSON.stringify(items, null, 1) + '\n');
console.log(`OK: ${items.length} casos → ${salida}. Camino 1/2/3: ${porCamino.join('/')}.`);
for (const a of avisos) console.log('Aviso: ' + a);
