/**
 * Arnés de evaluación del asesor (spec §13). Subcomandos:
 *
 *   run            corre las variantes (a, a2, b, c) sobre los casos de episodes.json
 *   grade          califica por código (citas, formato, líneas rojas, predicciones, costo, latencia)
 *   export-packet  paquete ciego para los consultores (orden aleatorio por semilla) + hoja + clave
 *   judge          juez DEEP sobre los mismos pares, en los dos órdenes
 *   decide         aplica la regla de decisión §13.3
 *   safety         set de seguridad (safety-set.json): lado mecánico, sin modelo; lista lo que requiere modelo real
 *
 * NUNCA llama a Bedrock por defecto. `run` y `judge` exigen una de dos cosas:
 *   --dry-run                        LLM simulado, cero costo (prueba el flujo de punta a punta)
 *   --confirm-spend --max-usd N      ejecución real con tope duro (USD sobre llamadas con precio conocido
 *                                    y --max-calls, por defecto 300; Opus no tiene precio verificado y solo
 *                                    lo cubre el tope de llamadas, o --opus-usd-per-mtok in,out si se conoce)
 *
 * Uso: npx tsx scripts/advisor-eval/run.ts <subcomando> [opciones]   (ver README.md de esta carpeta)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fakeCouncilLLM, resp } from '../../packages/shared/src/advisor/fake-llm';
import { RuntimeLLM, type AdvisorLLM } from '../../packages/shared/src/advisor/llm';
import { advisorModelId } from '../../packages/shared/src/advisor/models';
import { expandCases, validateEpisodes } from '../../packages/shared/src/advisor/eval/episodes';
import { parseSheet, type BlindKeyRow } from '../../packages/shared/src/advisor/eval/pairwise';
import { VARIANT_IDS, type RunRecord, type VariantId } from '../../packages/shared/src/advisor/eval/types';
import type { Caps, PriceRow } from '../../packages/shared/src/advisor/eval/metered';
import { runSafetyMechanical, type SafetySet } from './safety';
import {
  buildPacket, controlCases, decideFromResults, dirFactSheets, dryRunFactSheets, gradeAll, judgeAll, recordKey, runEvaluation,
  type JudgeRow,
} from './harness';

export interface Args {
  cmd: string;
  flags: Record<string, string | true>;
}

const BOOL = new Set(['dry-run', 'confirm-spend', 'with-control', 'allow-partial', 'help']);

export function parseArgs(argv: string[]): Args {
  const [cmd = 'help', ...rest] = argv;
  const flags: Args['flags'] = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`argumento inesperado «${a}»`);
    const name = a.slice(2);
    if (BOOL.has(name)) flags[name] = true;
    else {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`falta el valor de --${name}`);
      flags[name] = v;
    }
  }
  return { cmd, flags };
}

const str = (a: Args, k: string): string | undefined => (typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined);
const need = (a: Args, k: string): string => {
  const v = str(a, k);
  if (!v) throw new Error(`falta --${k}`);
  return v;
};
const readJson = <T>(p: string): T => JSON.parse(readFileSync(resolve(p), 'utf8')) as T;
const readJsonl = <T>(p: string): T[] => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const write = (p: string, content: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); };

export interface Spend {
  mode: 'dry' | 'real';
  caps: Caps | null;
  prices: Record<string, PriceRow>;
}

/** Decide si hay permiso de gastar. Sin una de las dos opciones explícitas, no se hace nada. */
export function resolveSpend(a: Args): Spend {
  const dry = a.flags['dry-run'] === true;
  const confirm = a.flags['confirm-spend'] === true;
  if (dry && confirm) throw new Error('--dry-run y --confirm-spend son excluyentes');
  if (dry) return { mode: 'dry', caps: null, prices: {} };
  if (!confirm) throw new Error('no se corre nada sin permiso: usa --dry-run (cero costo) o --confirm-spend --max-usd N (llama a Bedrock)');
  const maxUsd = Number(str(a, 'max-usd'));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error('--confirm-spend exige --max-usd N (tope duro en USD, mayor que 0)');
  const maxCalls = str(a, 'max-calls') ? Number(str(a, 'max-calls')) : 300;
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new Error('--max-calls debe ser un entero positivo');
  const prices: Record<string, PriceRow> = {};
  const opus = str(a, 'opus-usd-per-mtok');
  if (opus) {
    const [i, o] = opus.split(',').map(Number);
    if (!(i > 0) || !(o > 0)) throw new Error('--opus-usd-per-mtok espera «entrada,salida» con precios verificados (USD por millón de tokens)');
    // Lectura de caché y escritura derivadas de la regla publicada (0.1× y 1.25× / 2× de la entrada): confirmar contra la tabla de precios.
    prices[advisorModelId('DEEP')] = { input: i, output: o, cacheRead: i * 0.1, cacheWrite5m: i * 1.25, cacheWrite1h: i * 2 };
  }
  return { mode: 'real', caps: { maxUsd, maxCalls }, prices };
}

async function makeLLM(spend: Spend, dryLLM: () => AdvisorLLM): Promise<AdvisorLLM> {
  if (spend.mode === 'dry') return dryLLM();
  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  return new RuntimeLLM(new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' }));
}

/** Juez simulado del --dry-run: empata siempre. */
const dryJudge = (): AdvisorLLM => ({
  stream: async () => { throw new Error('no usado'); },
  create: async () => resp({ utilidad: 'empate', realismo_opciones: 'empate', disenso_bien_recogido: 'empate', claridad: 'empate', preferencia: 'empate', razon: 'simulado' }),
});

function loadEpisodes(a: Args) {
  const v = validateEpisodes(readJson(need(a, 'episodes')), { full: a.flags['allow-partial'] !== true });
  if (!v.ok) throw new Error(`episodes.json inválido:\n - ${v.errors.join('\n - ')}`);
  return v;
}

export async function main(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const a = parseArgs(argv);
  const outDir = resolve(str(a, 'out') ?? join(__dirname, 'out', new Date().toISOString().replace(/[:.]/g, '-')));

  switch (a.cmd) {
    case 'run': {
      const spend = resolveSpend(a);
      const ep = loadEpisodes(a);
      for (const w of ep.warnings) log(`aviso: ${w}`);
      const variants = (str(a, 'variants') ?? 'a,a2,b,c').split(',') as VariantId[];
      for (const v of variants) if (!VARIANT_IDS.includes(v)) throw new Error(`variante desconocida «${v}» (a, a2, b, c)`);
      const reps = Number(str(a, 'reps') ?? 3);
      let cases = expandCases(ep.episodes);
      if (a.flags['with-control']) cases = [...cases, ...controlCases(cases)];
      if (str(a, 'limit')) cases = cases.slice(0, Number(str(a, 'limit')));
      const facts = spend.mode === 'dry' ? dryRunFactSheets() : dirFactSheets(need(a, 'fact-sheets'));
      const file = join(outDir, 'records.jsonl');
      const done = new Set(readJsonl<RunRecord>(file).map(recordKey));
      mkdirSync(outDir, { recursive: true });
      const llm = await makeLLM(spend, () => fakeCouncilLLM().llm);
      const sum = await runEvaluation({
        cases, variants, reps, llm, caps: spend.caps, prices: spend.prices, facts, skip: done, concurrency: Number(str(a, 'concurrency') ?? 1),
        models: { fast: advisorModelId('FAST'), main: advisorModelId('MAIN'), deep: advisorModelId('DEEP') },
        retryBaseMs: spend.mode === 'dry' ? 0 : 1500,
        onRecord: (r) => appendFileSync(file, JSON.stringify(r) + '\n'),
      });
      log(`corridas nuevas: ${sum.records.length} (ya existían ${done.size}) · llamadas: ${sum.calls} · gasto con precio conocido: ${sum.spentUsd} USD · llamadas sin precio: ${sum.unpricedCalls}`);
      if (sum.unpricedCalls > 0) log('aviso: hay llamadas sin precio verificado (Opus 5.5): su costo NO está en el total ni se estima.');
      if (sum.stoppedByCap) log(`ALTO por tope: ${sum.stoppedByCap}`);
      log(`salida: ${file}`);
      return sum.stoppedByCap ? 3 : 0;
    }
    case 'grade': {
      const ep = loadEpisodes(a);
      const records = readJsonl<RunRecord>(need(a, 'records'));
      const observed = str(a, 'observed') ? readJson<Record<string, Record<string, number>>>(need(a, 'observed')) : {};
      const { grades, summary } = gradeAll(records, ep.episodes, observed);
      write(join(outDir, 'grades.jsonl'), grades.map((g) => JSON.stringify(g)).join('\n') + '\n');
      write(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
      for (const s of summary) log(`${s.variant}: ${s.completed}/${s.runs} completas · citas válidas ${s.citeValidRate === null ? 'n/d' : (s.citeValidRate * 100).toFixed(1) + ' %'} · formato ok ${s.formatOkRate === null ? 'n/d' : (s.formatOkRate * 100).toFixed(0) + ' %'} · corridas con línea roja ${s.redLineRuns} · cobertura ${s.coverage === null ? 'n/d' : (s.coverage * 100).toFixed(0) + ' %'} · costo medio ${s.meanCostUsd === null ? 'n/d' : s.meanCostUsd.toFixed(3)} (${s.unpricedRuns} sin precio)`);
      log(`salida: ${outDir}`);
      return 0;
    }
    case 'export-packet': {
      const records = readJsonl<RunRecord>(need(a, 'records'));
      const p = buildPacket(records, need(a, 'seed'), str(a, 'episodes') ? loadEpisodes(a).episodes : []);
      for (const [name, content] of Object.entries(p.files)) write(join(outDir, name), content);
      log(`${p.pairs} pares → ${outDir}\nENTREGAR: paquete/ y hoja-de-calificacion.csv. NO entregar CLAVE-no-entregar.json.`);
      return 0;
    }
    case 'judge': {
      const spend = resolveSpend(a);
      const ep = loadEpisodes(a);
      const records = readJsonl<RunRecord>(need(a, 'records'));
      const llm = await makeLLM(spend, dryJudge);
      const file = join(outDir, 'judge.jsonl');
      mkdirSync(outDir, { recursive: true });
      const r = await judgeAll(records, ep.episodes, { llm, model: advisorModelId('DEEP'), caps: spend.caps, prices: spend.prices }, (row) => appendFileSync(file, JSON.stringify(row) + '\n'));
      log(`${r.rows.length} pares juzgados · empates por cambio de orden: ${r.rows.filter((x) => x.flipped).length} · gasto con precio conocido: ${r.spentUsd} USD`);
      if (r.stoppedByCap) log(`ALTO por tope: ${r.stoppedByCap}`);
      return r.stoppedByCap ? 3 : 0;
    }
    case 'decide': {
      const summary = readJson<ReturnType<typeof gradeAll>['summary']>(need(a, 'summary'));
      const key = readJson<BlindKeyRow[]>(need(a, 'key'));
      const sheets = (str(a, 'sheets') ?? '').split(',').filter(Boolean);
      const verdicts = sheets.flatMap((s) => {
        const r = parseSheet(readFileSync(resolve(s), 'utf8'), key);
        for (const e of r.errors) log(`aviso (${s}): ${e}`);
        return r.verdicts;
      });
      const judge = str(a, 'judge') ? readJsonl<JudgeRow>(need(a, 'judge')) : undefined;
      const report = decideFromResults({ summary, verdicts, key, judge });
      write(join(outDir, 'decision.json'), JSON.stringify(report, null, 2));
      log(`Consejo: ${report.decision.council}\nPanel: ${report.decision.panel}\n${report.decision.reasons.map((x) => `- ${x}`).join('\n')}`);
      log(`kappa entre humanos: ${report.kappa.interHuman ?? 'n/d'} · juez vs humanos: ${report.kappa.judgeVsHumans ?? 'n/d'}`);
      return 0;
    }
    case 'safety': {
      const set = readJson<SafetySet>(str(a, 'set') ?? join(__dirname, 'safety-set.json'));
      const r = runSafetyMechanical(set);
      log(`seguridad (mecánico): ${r.mecanicos - r.failures.length}/${r.mecanicos} sin fallos · casos que requieren modelo real y NO se ejecutaron: ${r.requierenModelo}`);
      for (const f of r.failures) log(`FALLA ${f.id}: ${f.motivo}`);
      return r.failures.length ? 1 : 0;
    }
    default:
      log('Subcomandos: run | grade | export-packet | judge | decide | safety. Ver scripts/advisor-eval/README.md');
      return a.cmd === 'help' ? 0 : 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(String((e as Error).message ?? e)); process.exit(2); });
}
