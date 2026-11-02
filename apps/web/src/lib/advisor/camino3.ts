// Camino 3 · lado web (spec §4, §8.3). La ronda 0 (analista con herramientas) corre en el proceso de
// Node de ECS porque las herramientas importan alias `@/lib/...` que el esbuild de `infra` no
// resuelve. En paralelo corre la contención (ronda C). Cuando la hoja de hechos está lista se
// guarda en la corrida y se invoca `eco-advisor` (Event) para las rondas 1 a 5 y la revisión.

import { TokenLedger, type AdvisorLLM } from '@eco/shared/src/advisor/llm';
import { isCancelRequested, appendEvent, saveStep, setRunStatus, queueRounds, type Pool } from './runs';
import { runFactSheetRound, type PanelSignals } from './council';
import { runContention, type HoldingResult } from './contention';
import { withInjectionFilter } from './injection-tools';
import type { Camino1Tool } from './camino1';

/** Costo esperado de la ronda 0 con herramientas y filtro (Sonnet + Haiku). */
export const ROUND0_EXPECTED_COST_USD = 0.4;
export const CONTENTION_EXPECTED_COST_USD = 0.1;

export interface Camino3FrontDeps {
  llm: AdvisorLLM;
  tools: Camino1Tool;
  pool: Pool;
  runId: string;
  models: { fast: string; main: string; deep: string };
  dateLabel: string;
  agency: { slug: string; name: string };
  signals: PanelSignals;
  question: string;
  /** `situacion_actual` ya parseada por el triaje (la contención no vuelve a consultarla). */
  situacion: Record<string, unknown> | null;
  /** Entrega la corrida a eco-advisor (InvocationType Event). */
  invokeAdvisor: (runId: string) => Promise<void>;
}

export interface Camino3FrontOutcome {
  status: 'queued' | 'cancelled';
  round0Ms: number;
  contentionMs: number | null;
}

export async function runCamino3Front(d: Camino3FrontDeps): Promise<Camino3FrontOutcome> {
  const ledger0 = new TokenLedger(ROUND0_EXPECTED_COST_USD);
  const ledgerC = new TokenLedger(CONTENTION_EXPECTED_COST_USD);
  const cancelled = () => isCancelRequested(d.pool, d.runId);
  const filtered = withInjectionFilter(d.tools, { llm: d.llm, fastModel: d.models.fast, ledger: ledger0 });

  // Ronda C: arranca ya, con la hoja preliminar. Un fallo aquí no tumba el consejo.
  const contention: Promise<HoldingResult | null> = runContention(
    { llm: d.llm, model: d.models.main, ledger: ledgerC, esFamilia: d.agency.slug === 'df' },
    {
      pregunta: d.question, agencia: d.agency.name, fecha: d.dateLabel, guiaProbable: d.signals.guiaProbable,
      vedaActiva: d.signals.vedaActiva, riesgoPersonas: d.signals.riesgoPersonas, situacion: d.situacion,
    },
  )
    .then(async (r) => {
      await saveStep(d.pool, d.runId, 'C.contencion', { ...r, preliminar: true });
      await appendEvent(d.pool, d.runId, 'holding_statement', { holding: r.holding, plantilla: r.plantilla, revision: r.revision, borrador: true, ms: r.ms });
      return r;
    })
    .catch(async () => {
      await appendEvent(d.pool, d.runId, 'status', { texto: 'No se pudo preparar el borrador de contención; el consejo sigue.' }).catch(() => undefined);
      return null;
    });

  if (await cancelled()) {
    await contention;
    return { status: 'cancelled', round0Ms: 0, contentionMs: null };
  }

  const r0Start = Date.now();
  const { factSheet, seen } = await runFactSheetRound(
    { llm: d.llm, tools: filtered.tools, pool: d.pool, runId: d.runId, models: d.models, dateLabel: d.dateLabel, agency: d.agency, signals: d.signals, question: d.question },
    ledger0,
  );
  const round0Ms = Date.now() - r0Start;
  // Un solo escritor a la vez al entregar: la contención termina antes que la ronda 0, pero se espera.
  const held = await contention;

  if (await cancelled()) return { status: 'cancelled', round0Ms, contentionMs: held?.ms ?? null };

  const s0 = ledger0.snapshot();
  const sC = ledgerC.snapshot();
  await setRunStatus(d.pool, d.runId, 'r0_running', {
    usage: { round0: { usage: s0.usage, costUsd: s0.costUsd, ms: round0Ms }, contencion: { usage: sC.usage, costUsd: sC.costUsd, ms: held?.ms ?? null }, injection: { modeloOk: filtered.modeloOk() } },
  });
  await queueRounds(d.pool, d.runId, {
    factSheet,
    seenIds: [...seen],
    injection: filtered.flags(),
    context: { dateLabel: d.dateLabel, vedaActiva: d.signals.vedaActiva, guiaProbable: d.signals.guiaProbable, riesgoPersonas: d.signals.riesgoPersonas },
  });
  const marcadas = filtered.flags();
  if (marcadas.length) {
    // La mención no se borra: se muestra como «intento de manipulación» y se avisa (spec §12.2).
    await appendEvent(d.pool, d.runId, 'status', {
      texto: `${marcadas.length} mención(es) marcadas como «intento de manipulación» (${marcadas.map((m) => m.id).join(', ')}); se tratan como hallazgo, no como instrucción.`,
    });
  }
  await appendEvent(d.pool, d.runId, 'status', { texto: 'Hechos listos. El consejo está deliberando.' });
  await d.invokeAdvisor(d.runId);
  return { status: 'queued', round0Ms, contentionMs: held?.ms ?? null };
}
