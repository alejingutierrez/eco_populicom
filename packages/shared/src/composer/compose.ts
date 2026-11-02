/**
 * Orquestación del motor (spec 10.1): hechos (código) → analista → redactor →
 * QA código + QA agente → corrector (solo si hay defectos) → red de seguridad
 * → archivo. Port de `run` del prototipo (agents.py).
 *
 * `compose` NUNCA lanza: ante cualquier fallo devuelve un texto (en el peor
 * caso, titular y párrafo deterministas) y el registro del error.
 */
import { composeSubject, toSendLogArchive, type ComposerArchiveSink, type Composition } from './archive';
import { buildPromptContext } from './context';
import { buildFactPackage, type FactPackage } from './facts';
import { buildLintContext, codeLint, fillDraft, hardDefects, headlineLengthDefects, lintDraft, type LintContext } from './lint';
import { getProfile, type ComposerProfile, type ComposerProfileId } from './profiles';
import { COMPOSER_PROMPT_VERSION, COMPOSER_VERSION } from './prompts';
import type { RoleCallRecord, RoleRuntime } from './roles/call';
import { runAnalyst } from './roles/analyst';
import { runCorrector } from './roles/corrector';
import { runQa } from './roles/qa';
import { runWriter } from './roles/writer';
import { deterministicHeadline, deterministicParagraph, safetyNet, type SafetyNetLogEntry } from './safety-net';
import type { CodeDefect, ComposerInput, ComposerLlm, Draft, Findings, QaDefect, RoleModels } from './types';
import { VETOED_VERSION } from './vetoed';

export const COMPOSER_MODEL_OPUS = 'us.anthropic.claude-opus-4-6-v1';
export const COMPOSER_MODEL_SONNET = 'us.anthropic.claude-sonnet-4-6';

/** Opus para analista, redactor y corrector; Sonnet para el QA (otra familia de jueces). */
export const DEFAULT_ROLE_MODELS: RoleModels = {
  analyst: COMPOSER_MODEL_OPUS,
  writer: COMPOSER_MODEL_OPUS,
  qa: COMPOSER_MODEL_SONNET,
  corrector: COMPOSER_MODEL_OPUS,
};

export interface ComposeOptions {
  /** Cliente LLM inyectado. Sin él, el motor devuelve el texto determinista (degradado). */
  llm?: ComposerLlm | null;
  models?: Partial<RoleModels>;
  /** Intentos por rol (default 3). */
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** No escribe el archivo aunque haya sink; devuelve la composición completa. */
  dryRun?: boolean;
  archive?: ComposerArchiveSink | null;
  /** Sustituye la base del system prompt del perfil (constitución + rol). */
  systemBase?: string;
  minBase?: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface ComposeResult {
  final: Draft;
  headline: string;
  subject: string | null;
  composition: Composition;
  /** true si no hubo errores en ninguna etapa. */
  ok: boolean;
  degraded: boolean;
  archived: boolean;
}

function emptyDraft(profile: ComposerProfile, headline: string, paragraph: string): Draft {
  const d: Draft = { headline, paragraph, highlights: [] };
  if (profile.shape.insights) d.insights = { negative: [], neutral: [], positive: [] };
  if (profile.shape.comparison) d.comparison = [];
  if (profile.shape.sections?.length) d.sections = Object.fromEntries(profile.shape.sections.map((k) => [k, { narrative: '', points: [] }]));
  return d;
}

const secs = (t0: number) => Math.round((Date.now() - t0) / 100) / 10;

export async function compose(
  profileRef: ComposerProfileId | ComposerProfile,
  input: ComposerInput,
  options: ComposeOptions = {},
): Promise<ComposeResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const tAll = Date.now();
  const errors: string[] = [];
  const calls: RoleCallRecord[] = [];
  const stageSeconds: Record<string, number> = {};
  const models: RoleModels = { ...DEFAULT_ROLE_MODELS, ...(options.models ?? {}) };
  const profile = getProfile(profileRef);
  const dryRun = !!options.dryRun;

  let pkg: FactPackage | null = null;
  let findings: Findings | null = null;
  let draft1Raw: Draft | null = null;
  let draft1: Draft | null = null;
  let draft2Raw: Draft | null = null;
  let draft2: Draft | null = null;
  let qaAgent: QaDefect[] = [];
  let qaAgentRan = false;
  let codeProbs: CodeDefect[] = [];
  let correctorRan = false;
  let final: Draft;
  let netLog: SafetyNetLogEntry[] = [];
  let residual: CodeDefect[] = [];
  let warnings: CodeDefect[] = [];
  let degraded = false;

  try {
    // 0. Hechos y contexto (código).
    let t = Date.now();
    pkg = buildFactPackage(input, { minBase: options.minBase });
    const lintCtx: LintContext = buildLintContext(pkg, input.samples, input.nameWhitelist ?? []);
    const ctx = buildPromptContext(profile, input, pkg, input.samples);
    stageSeconds.facts = secs(t);

    const fallback = () => emptyDraft(profile, deterministicHeadline(pkg!, profile.scope), deterministicParagraph(pkg!, profile.scope));
    const llm = options.llm ?? null;
    if (!llm) {
      errors.push('sin cliente LLM: texto determinista');
      degraded = true;
      final = fallback();
    } else {
      const rt: RoleRuntime = {
        llm,
        retries: options.retries ?? 3,
        backoffMs: options.backoffMs ?? 3000,
        sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        log: options.log,
      };

      // 1. Analista.
      if (profile.stages.analyst) {
        t = Date.now();
        const r = await runAnalyst(rt, profile, ctx, models.analyst, options.systemBase);
        calls.push(r.record);
        stageSeconds.analyst = secs(t);
        findings = r.value;
        if (!r.value) { degraded = true; errors.push(`analista: ${r.record.errors.at(-1) ?? 'falló'}`); }
      }

      // 2. Redactor.
      t = Date.now();
      const w = await runWriter(rt, profile, ctx, findings, models.writer, options.systemBase);
      calls.push(w.record);
      stageSeconds.writer = secs(t);
      if (!w.value) {
        degraded = true;
        errors.push(`redactor: ${w.record.errors.at(-1) ?? 'falló'}`);
        final = fallback();
      } else {
        draft1Raw = w.value;
        // 3a. QA código.
        t = Date.now();
        const f1 = fillDraft(draft1Raw, pkg.facts);
        draft1 = f1.filled;
        codeProbs = [...f1.problems, ...lintDraft(draft1, lintCtx)];
        stageSeconds.qa_code = secs(t);

        // 3b. QA agente.
        if (profile.stages.qaAgent) {
          t = Date.now();
          const q = await runQa(rt, profile, ctx, draft1, models.qa);
          calls.push(q.record);
          stageSeconds.qa_agent = secs(t);
          if (q.value) { qaAgent = q.value; qaAgentRan = true; } else { degraded = true; errors.push(`qa: ${q.record.errors.at(-1) ?? 'falló'}`); }
        }

        // 4. Corrector: solo si hay defectos (una vuelta).
        let chosenRaw = draft1Raw;
        if (profile.stages.corrector && (qaAgent.length > 0 || codeProbs.length > 0)) {
          t = Date.now();
          const c = await runCorrector(rt, profile, ctx, findings, draft1Raw, qaAgent, codeProbs, models.corrector, options.systemBase);
          calls.push(c.record);
          stageSeconds.corrector = secs(t);
          correctorRan = true;
          if (c.value) { draft2Raw = c.value; chosenRaw = c.value; } else { degraded = true; errors.push(`corrector: ${c.record.errors.at(-1) ?? 'falló'}`); }
        }

        // 5. Red de seguridad (nunca bloquea).
        t = Date.now();
        const reverted: SafetyNetLogEntry[] = [];
        if (draft2Raw) {
          draft2 = fillDraft(draft2Raw, pkg.facts).filled;
          // El corrector a veces alarga un titular que nadie señaló: si el corregido
          // rompe el largo y el del redactor estaba limpio y sin defectos del QA, se conserva este.
          const h2Long = headlineLengthDefects(draft2.headline, lintCtx);
          const h1Clean = codeLint(draft1.headline, 'titular', lintCtx).length === 0
            && headlineLengthDefects(draft1.headline, lintCtx).length === 0
            && !qaAgent.some((d) => /titular/i.test(d.where));
          if (h2Long.length && h1Clean && draft1.headline.trim()) {
            reverted.push({ action: 'titular_revertido', where: 'titular', text: draft2.headline, reasons: h2Long });
            chosenRaw = { ...chosenRaw, headline: draft1Raw.headline };
          }
        }
        const f2 = fillDraft(chosenRaw, pkg.facts, { keepInvalid: true });
        const net = safetyNet(f2.filled, pkg, lintCtx, profile.scope);
        final = net.draft;
        netLog = [...reverted, ...net.log];
        stageSeconds.safety_net = secs(t);
      }
    }

    const lintFinal = lintDraft(final, lintCtx);
    residual = hardDefects(lintFinal);
    warnings = lintFinal.filter((d) => d.severity === 'soft');
  } catch (err) {
    // Último recurso: algo inesperado (datos malformados). Texto determinista mínimo.
    degraded = true;
    errors.push(`inesperado: ${(err as Error)?.message ?? String(err)}`);
    try {
      final = pkg
        ? emptyDraft(profile, deterministicHeadline(pkg, profile.scope), deterministicParagraph(pkg, profile.scope))
        : emptyDraft(profile, `${input?.agency?.name ?? 'La agencia'}: resumen no disponible`, '');
    } catch {
      final = emptyDraft(profile, 'Resumen no disponible', '');
    }
  }

  const subject = composeSubject(profile.subjectTag, input?.agency?.shortName, final.headline);
  stageSeconds.total = secs(tAll);
  const composition: Composition = {
    composerVersion: COMPOSER_VERSION,
    promptVersion: COMPOSER_PROMPT_VERSION,
    vetoedVersion: VETOED_VERSION,
    profile: profile.id,
    dryRun,
    agency: input?.agency,
    window: input?.window,
    startedAt,
    finishedAt: now().toISOString(),
    facts: pkg?.facts ?? {},
    prevTotalsSource: pkg?.prevTotalsSource ?? null,
    samples: input?.samples ?? null,
    findings,
    draft1Raw,
    draft1,
    qa: { agentRan: qaAgentRan, agent: qaAgent, code: codeProbs },
    correctorRan,
    draft2Raw,
    draft2,
    final,
    safetyNetLog: netLog,
    residualCodeProblems: residual,
    warnings,
    models: {
      ...(profile.stages.analyst ? { analyst: models.analyst } : {}),
      writer: models.writer,
      ...(profile.stages.qaAgent ? { qa: models.qa } : {}),
      ...(correctorRan ? { corrector: models.corrector } : {}),
    },
    calls,
    stageSeconds,
    degraded,
    errors,
  };

  let archived = false;
  if (!dryRun && options.archive) {
    const t = Date.now();
    try {
      await options.archive.write(toSendLogArchive(subject, composition));
      archived = true;
    } catch (err) {
      composition.errors.push(`archivo: ${(err as Error)?.message ?? String(err)}`);
    }
    composition.stageSeconds.archive = secs(t);
  }

  return { final, headline: final.headline, subject, composition, ok: composition.errors.length === 0, degraded, archived };
}
