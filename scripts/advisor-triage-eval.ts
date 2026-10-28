// Evaluación en vivo del triaje del asesor (spec §8.1; aceptación: subestimación ≤ 2 %).
// Corre triage() con el RuntimeLLM real (bedrock-runtime, us-east-1) sobre el set de triaje.
// Uso (env inline, sin imprimir secretos):
//   set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
//   node_modules/.bin/tsx scripts/advisor-triage-eval.ts
// El informe no contiene el texto de las preguntas: solo ids, etiquetas y decisiones.

import * as fs from 'fs';
import * as path from 'path';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { RuntimeLLM, type AdvisorLLM, type AdvisorResponse, type AdvisorRequest } from '../packages/shared/src/advisor/llm';
import { triage, type TriageContexto, type TriageDecision } from '../apps/web/src/lib/advisor/triage';

const SET_PATH = path.resolve(__dirname, '..', 'apps/web/src/lib/advisor/triage-set/set.json');
const REPORT_PATH =
  '/private/tmp/claude-502/-Users-alegut-MyApps-eco-populicom--claude-worktrees-distracted-stonebraker-7d0bec/388bdcbe-d975-4d3b-b443-b1ee4004b8b9/scratchpad/triage-eval.json';
const CONCURRENCIA = 5;

interface SetItem {
  id: string;
  tipo: string;
  variante: string;
  pregunta: string;
  contexto: TriageContexto;
  caminoMinimo: 1 | 2 | 3;
  reglaBase: boolean;
}

interface Fila {
  id: string;
  tipo: string;
  variante: string;
  reglaBase: boolean;
  gold: 1 | 2 | 3;
  decidido: 1 | 2 | 3 | null;
  piso: 1 | 2 | 3 | null;
  sugeridoClasificador: 1 | 2 | 3 | null;
  clasificadorOk: boolean;
  legalObligatorio: boolean | null;
  resultado: 'subestimado' | 'exacto' | 'sobrestimado' | 'error';
  motivo: string | null;
  error: string | null;
}

// Cliente que suma tokens de cada llamada, para reportar el consumo sin tocar la lógica.
function conContador(inner: AdvisorLLM) {
  const tot = { llamadas: 0, inputNew: 0, cacheRead: 0, output: 0 };
  const llm: AdvisorLLM = {
    create: async (req: AdvisorRequest): Promise<AdvisorResponse> => {
      const r = await inner.create(req);
      tot.llamadas++;
      tot.inputNew += r.usage.inputNew;
      tot.cacheRead += r.usage.cacheRead;
      tot.output += r.usage.output;
      return r;
    },
    stream: (req, h) => inner.stream(req, h),
  };
  return { llm, tot };
}

async function evaluar(item: SetItem, llm: AdvisorLLM): Promise<Fila> {
  const base = {
    id: item.id,
    tipo: item.tipo,
    variante: item.variante,
    reglaBase: item.reglaBase,
    gold: item.caminoMinimo,
  };
  try {
    const d: TriageDecision = await triage({
      llm,
      question: item.pregunta,
      inputs: item.contexto,
      override: null,
    });
    const resultado =
      d.camino < item.caminoMinimo ? 'subestimado' : d.camino > item.caminoMinimo ? 'sobrestimado' : 'exacto';
    return {
      ...base,
      decidido: d.camino,
      piso: d.piso,
      sugeridoClasificador: d.clasificacion?.camino_sugerido ?? null,
      clasificadorOk: d.clasificacion !== null,
      legalObligatorio: d.legalObligatorio,
      resultado,
      motivo: d.motivo,
      error: null,
    };
  } catch (e) {
    // Sin texto de la pregunta: solo el nombre del error.
    return {
      ...base,
      decidido: null,
      piso: null,
      sugeridoClasificador: null,
      clasificadorOk: false,
      legalObligatorio: null,
      resultado: 'error',
      motivo: null,
      error: e instanceof Error ? e.name : 'error desconocido',
    };
  }
}

async function main(): Promise<void> {
  const set: SetItem[] = JSON.parse(fs.readFileSync(SET_PATH, 'utf8'));
  const client = new BedrockRuntimeClient({ region: 'us-east-1' });
  const { llm, tot } = conContador(new RuntimeLLM(client));

  const filas: Fila[] = new Array(set.length);
  let siguiente = 0;
  const worker = async () => {
    while (siguiente < set.length) {
      const i = siguiente++;
      filas[i] = await evaluar(set[i], llm);
      if ((i + 1) % 25 === 0) console.log(`progreso ${i + 1}/${set.length}`);
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCIA }, worker));
  const ms = Date.now() - t0;

  const ok = filas.filter((f) => f.resultado !== 'error');
  const subs = filas.filter((f) => f.resultado === 'subestimado');
  const sobs = filas.filter((f) => f.resultado === 'sobrestimado');
  const exactos = filas.filter((f) => f.resultado === 'exacto');
  const errores = filas.filter((f) => f.resultado === 'error');
  const sinClasificador = filas.filter((f) => !f.clasificadorOk && f.resultado !== 'error');
  const pct = (n: number, d: number) => (d === 0 ? null : +((100 * n) / d).toFixed(2));

  const porTipo: Record<string, { n: number; subestimados: number }> = {};
  for (const f of filas) {
    porTipo[f.tipo] ??= { n: 0, subestimados: 0 };
    porTipo[f.tipo].n++;
    if (f.resultado === 'subestimado') porTipo[f.tipo].subestimados++;
  }
  const porReglaBase = {
    conRegla: { n: filas.filter((f) => f.reglaBase).length, subestimados: filas.filter((f) => f.reglaBase && f.resultado === 'subestimado').length },
    sinRegla: { n: filas.filter((f) => !f.reglaBase).length, subestimados: filas.filter((f) => !f.reglaBase && f.resultado === 'subestimado').length },
  };

  const resumen = {
    fecha: new Date().toISOString(),
    modelo: 'FAST (advisorModelId)',
    n: filas.length,
    evaluados: ok.length,
    errores: errores.length,
    clasificadorNulo: sinClasificador.length,
    subestimados: { n: subs.length, tasaPct: pct(subs.length, filas.length) },
    sobrestimados: { n: sobs.length, tasaPct: pct(sobs.length, filas.length) },
    exactos: { n: exactos.length, tasaPct: pct(exactos.length, filas.length) },
    aceptacionSubestimacionOk: pct(subs.length, filas.length) !== null && (subs.length / filas.length) <= 0.02,
    idsSubestimados: subs.map((f) => ({ id: f.id, gold: f.gold, decidido: f.decidido })),
    porTipo,
    porReglaBase,
    tokens: tot,
    ms,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ resumen, filas }, null, 2));

  // Resumen en consola: sin texto de preguntas.
  console.log(JSON.stringify({ ...resumen, idsSubestimados: undefined }, null, 2));
  console.log('subestimados (id gold→decidido):', subs.map((f) => `${f.id} ${f.gold}→${f.decidido}`).join(', ') || 'ninguno');
  console.log('informe:', REPORT_PATH);
}

main().catch((e) => {
  console.error('fallo de la evaluación:', e instanceof Error ? e.name : 'desconocido');
  process.exit(1);
});
