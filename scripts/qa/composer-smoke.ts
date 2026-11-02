/**
 * Humo del motor de redacción (WP-3) con Bedrock REAL sobre UNA ventana del
 * laboratorio. No envía correos ni escribe en la base de datos (dryRun).
 *
 *   set -a && source .env && set +a
 *   node_modules/.bin/tsx scripts/qa/composer-smoke.ts <ventana.json> \
 *     [--samples <out_*\/samples.json>] [--facts <out_*\/facts.json>] \
 *     [--profile daily] [--out <dir>] [--sonnet-only]
 *
 * <ventana.json> es la salida de repro.ts (totals, dailySeries, topics,
 * samples, todaySamples, aggregates). `--samples` usa las muestras anotadas
 * del prototipo (con padre y fecha del padre, que repro.ts no trae); sin él se
 * anotan desde la ventana y los comentarios quedan con fecha de padre
 * desconocida. `--facts` toma de ahí la composición de comentarios
 * (comment_share_week / _prev_week), que tampoco viene en la ventana.
 *
 * Los fixtures con texto de usuarios NO van al repo (WP-11 los pseudonimiza).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  annotateSamples,
  capAndNumber,
  compose,
  COMPOSER_MODEL_SONNET,
  KIND_LABELS,
  type AnnotatedSample,
  type AnnotatedSampleSet,
  type ComposerInput,
  type ComposerProfileId,
  type MentionKind,
  type RawComposerSample,
  type SampleGroup,
} from '../../packages/shared/src/composer';
import { createBedrockComposerLlm } from '../../packages/shared/src/composer/bedrock-llm';

// ------------------------------------------------------------------ adaptadores de ventana (los reutiliza el arnés de paridad)

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «lunes 26 de octubre» + año de referencia → YYYY-MM-DD (ajusta dic/ene). */
export function parseLongDay(label: string, refYmd: string): string | null {
  const m = /(\d{1,2}) de (\p{L}+)/u.exec(label ?? '');
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  let y = Number(refYmd.slice(0, 4));
  if (mi === 11 && refYmd.slice(5, 7) === '01') y -= 1;
  return `${y}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

const KIND_BY_LABEL: Record<string, MentionKind> = Object.fromEntries(
  Object.entries(KIND_LABELS).map(([k, v]) => [v, k as MentionKind]),
);

/** Muestras anotadas del prototipo (out_*\/samples.json) → conjunto del motor, con el tope por hilo. */
export function prototypeSamplesToSet(proto: Json[], maxPerThread = 3): AnnotatedSampleSet {
  const groupOf: Record<string, SampleGroup> = { D: 'today', N: 'negative', E: 'neutral', P: 'positive' };
  const groups: Record<SampleGroup, AnnotatedSample[]> = { today: [], negative: [], neutral: [], positive: [] };
  for (const a of proto) {
    const g = groupOf[String(a.sid)[0]];
    const kind = KIND_BY_LABEL[a.kind] ?? (a.comment ? 'comment' : 'social_post');
    const createdYmd = String(a.created).slice(0, 10);
    const dayYmd = parseLongDay(a.day, createdYmd) ?? createdYmd;
    const pDay = a.comment && a.parent_day ? parseLongDay(a.parent_day, dayYmd) : null;
    groups[g].push({
      sid: '', id: a.id, group: g, kind, kindLabel: KIND_LABELS[kind], isComment: !!a.comment,
      author: a.author ?? null, source: a.source ?? null, sentiment: a.sentiment ?? null, topic: a.topic ?? null,
      createdAt: a.created, dayYmd, dayLabel: a.day, text: a.text ?? '',
      parent: a.comment && (a.parent_day || a.parent_text || a.parent_author)
        ? {
            key: `${a.parent_day ?? '?'}|${String(a.parent_text ?? '').slice(0, 80)}|${a.parent_author ?? ''}`,
            text: a.parent_text || null, author: a.parent_author ?? null, publishedAt: null,
            dayYmd: pDay, dayLabel: a.parent_day ?? null, ageDays: a.age_days ?? null,
          }
        : null,
      lateReaction: !!(a.comment && a.age_days !== null && a.age_days !== undefined && a.age_days > 2),
    });
  }
  return capAndNumber(groups, maxPerThread);
}

/** Muestras de repro.ts sin contexto de BD (padre desconocido). */
export function windowSamplesToSet(win: Json, maxPerThread = 3): AnnotatedSampleSet {
  const raw = (s: Json): RawComposerSample => ({
    id: s.id, createdAt: s.createdAt, text: s.text, sentiment: s.sentiment, topic: s.topic, author: s.author ?? null,
    source: s.source ?? null, url: s._url ?? s.url ?? null, pageType: s._pageType ?? s.pageType ?? null,
    pubType: s._pubType ?? null, title: s._title ?? null, snippet: s._snippet ?? null, engagement: s._engagement ?? s.engagement ?? null,
  });
  return annotateSamples({
    today: (win.todaySamples ?? []).map(raw),
    negative: (win.samples?.negative ?? []).map(raw),
    neutral: (win.samples?.neutral ?? []).map(raw),
    positive: (win.samples?.positive ?? []).map(raw),
  }, {}, { maxPerThread });
}

/** «… (535 de 647)» en la etiqueta de un hecho del prototipo → conteos. */
function countsFromLabel(label: string | undefined): { total: number; comments: number } | null {
  const m = /\((\d+) de (\d+)\)/.exec(label ?? '');
  return m ? { comments: Number(m[1]), total: Number(m[2]) } : null;
}

export function windowToComposerInput(win: Json, opts: { samples: AnnotatedSampleSet; protoFacts?: Json }): ComposerInput {
  const ag = win.aggregates ?? {};
  const f = opts.protoFacts ?? {};
  const week = countsFromLabel(f.comment_share_week?.[2]);
  const prevWeek = countsFromLabel(f.comment_share_prev_week?.[2]);
  return {
    agency: { id: win.agency?.id, name: win.agency?.name ?? ag.agencyName, shortName: ag.agencyShortName ?? null },
    window: {
      startYmd: win.window.startYmd, endYmd: win.window.endYmd,
      prevStartYmd: win.window.prevStart, prevEndYmd: win.window.prevEnd, timeZone: 'America/Puerto_Rico',
    },
    totals: win.totals,
    deltaVsPrev: win.deltaVsPrev ?? ag.deltaVsPrevWeek ?? null,
    dailySeries: (win.dailySeries ?? []).map((d: Json) => ({ date: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive })),
    topics: (ag.byTopic ?? []).map((t: Json) => ({ topic: t.topic, total: t.total, negative: t.negative, neutral: t.neutral, positive: t.positive })),
    sources: ag.topSources ?? [],
    municipalities: ag.byMunicipality ?? [],
    emotions: ag.topEmotions ?? [],
    composition: week ? { week, prevWeek } : null,
    samples: opts.samples,
  };
}

// ------------------------------------------------------------------ main

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const winPath = process.argv[2];
  if (!winPath || winPath.startsWith('--')) {
    console.error('uso: composer-smoke.ts <ventana.json> [--samples s.json] [--facts f.json] [--profile daily] [--out dir] [--sonnet-only]');
    process.exit(2);
  }
  const win = JSON.parse(fs.readFileSync(winPath, 'utf8'));
  const samplesPath = arg('--samples');
  const factsPath = arg('--facts');
  const samples = samplesPath ? prototypeSamplesToSet(JSON.parse(fs.readFileSync(samplesPath, 'utf8'))) : windowSamplesToSet(win);
  const protoFacts = factsPath ? JSON.parse(fs.readFileSync(factsPath, 'utf8')) : undefined;
  const input = windowToComposerInput(win, { samples, protoFacts });
  const profile = (arg('--profile') ?? 'daily') as ComposerProfileId;

  const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  const llm = createBedrockComposerLlm(client);
  const sonnetOnly = process.argv.includes('--sonnet-only');
  const models = sonnetOnly ? { analyst: COMPOSER_MODEL_SONNET, writer: COMPOSER_MODEL_SONNET, corrector: COMPOSER_MODEL_SONNET } : undefined;

  const r = await compose(profile, input, { llm, models, dryRun: true, log: (m) => console.error(m) });
  const c = r.composition;
  console.log(JSON.stringify({
    ok: r.ok,
    degraded: r.degraded,
    subject: r.subject,
    headline: r.headline,
    qa_agent_defects: c.qa.agent.length,
    code_defects: c.qa.code.length,
    corrector_ran: c.correctorRan,
    safety_net: c.safetyNetLog.map((l) => `${l.action}: ${l.text.slice(0, 80)}`),
    residual: c.residualCodeProblems,
    warnings: c.warnings,
    stage_seconds: c.stageSeconds,
    models: c.models,
    errors: c.errors,
  }, null, 1));
  const out = arg('--out');
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'composition.json'), JSON.stringify(c, null, 1));
    console.error(`composición en ${path.join(out, 'composition.json')}`);
  }
}

if (process.argv[1] && /composer-smoke\.ts$/.test(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
