/**
 * INT-01 · Vista previa del Diario con asuntos abiertos y nivel sostenido,
 * SIN desplegar el lambda y SIN enviar nada.
 *
 * Corre en local el mismo camino del lambda de correos (`buildDailyComposerInput`
 * → `compose('daily')` → `renderDailyReportHtml`) con datos reales leídos por
 * eco-migration (custom-query, solo SELECT) y con Bedrock. Sirve para ver el
 * correo de una fecha pasada (el caso de DF del 24-oct) y para repetirlo varias
 * veces y medir qué dice el texto.
 *
 * Uso (desde la raíz del repo):
 *   set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
 *   node_modules/.bin/tsx scripts/int-01-preview-daily.ts df 2026-10-23 --runs=5 --out=<carpeta>
 *
 * En un worktree, `node_modules/@eco/*` apunta a OTRO checkout y el script
 * correría con su código. Ahí hay que pasar `--tsconfig` con un tsconfig local
 * (p. ej. `scripts/tsconfig.worktree.json`, que está en `.git/info/exclude`)
 * cuyo `paths` lleve `@eco/shared`, `@eco/shared/src/*` y `@eco/database` a
 * `packages/<paquete>/src` de ese árbol.
 *
 * Argumentos: slug, último día cerrado del correo (el que se envió al día
 * siguiente), `--runs` corridas del motor (default 1), `--out` carpeta donde
 * deja `<slug>-<día>-rN.html` y `.json` (composición completa; lleva texto de
 * menciones: no versionar).
 *
 * Diferencias con el correo real: no lleva la foto de la nota ni pasa por la
 * composición guardada, y los indicadores son solo Riesgo de crisis y
 * Sentimiento neto.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import {
  AGENCY_SHORT_LABEL, addDaysYmd, buildDailyMethodologyNote, buildSentimentReport, compose, directionLevelDefects, enforceLevelRules,
  FACT_MIN_DELTA_BASE, findCalming, formatDelta, formatLongDay, formatMetric, formatPeriodLabel, formatShortDay,
  loadMetricsForWindow, renderDailyReportHtml, type DailyReportRenderData,
} from '@eco/shared';
import { createBedrockComposerLlm } from '@eco/shared/src/composer/bedrock-llm';
import { buildDailyComposerInput, draftToDailyText } from '../infra/lambda/weekly-report/daily-composer';
import { createEcoMigrationClient } from './lib/eco-migration-client';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function minBaseDelta(cur: number, prev: number) {
  return prev >= FACT_MIN_DELTA_BASE
    ? formatDelta(cur, prev, { kind: 'percent', decimals: 0 })
    : formatDelta(cur, prev, { kind: 'absolute', decimals: 0 });
}

async function main() {
  const [slug, endYmd] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd ?? '')) {
    console.error('Uso: tsx scripts/int-01-preview-daily.ts <slug> <YYYY-MM-DD> [--runs=N] [--out=carpeta]');
    process.exit(2);
  }
  const runs = Math.max(1, Number(arg('runs') ?? 1));
  const out = arg('out');
  if (out) mkdirSync(out, { recursive: true });

  const client = createEcoMigrationClient();
  const ag = (await client.query<{ id: string; slug: string; name: string }>('SELECT id, slug, name FROM agencies WHERE slug = $1', [slug])).rows[0];
  if (!ag) throw new Error(`Agencia desconocida: ${slug}`);
  const short = AGENCY_SHORT_LABEL[slug] ?? slug.toUpperCase();
  const agency = { id: ag.id, slug: ag.slug, name: ag.name, shortName: short };
  const w = { startYmd: addDaysYmd(endYmd, -6), endYmd, prevStartYmd: addDaysYmd(endYmd, -13), prevEndYmd: addDaysYmd(endYmd, -7) };

  const [report, winCur, winPrev] = await Promise.all([
    buildSentimentReport(client, agency.id, w.startYmd, w.endYmd, w.prevStartYmd, w.prevEndYmd),
    loadMetricsForWindow(client, agency.id, w.startYmd, w.endYmd),
    loadMetricsForWindow(client, agency.id, w.prevStartYmd, w.prevEndYmd),
  ]);
  const fresh = await buildDailyComposerInput(client as any, agency, w, report);
  const it = fresh.interpretation;
  console.log(`\n${slug} · correo del ${addDaysYmd(endYmd, 1)} (ventana ${w.startYmd} a ${endYmd}) · ${client.count()} consultas`);
  if (it.errors.length) console.log('  cargas fallidas:', it.errors);
  const lv = it.sustainedLevel;
  if (lv) console.log(`  nivel: 14 d ${lv.d14.negPct}% neg, NSS ${lv.d14.nss} · 28 d ${lv.d28.negPct}% neg, NSS ${lv.d28.nss} · sostenido: ${lv.sustained}`);
  for (const i of it.openIssues?.issues ?? []) {
    console.log(`  asunto: ${i.name} · ${i.daysOpen} días · ${i.stage} ${i.week}/${i.prevWeek} · ${i.negPct}% neg · ${i.voice ? `${i.voice.label} ${i.voice.sharePct}%` : 'sin voz dominante'}`);
  }

  const llm = createBedrockComposerLlm(new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' }));
  const summary: Array<Record<string, unknown>> = [];
  for (let r = 1; r <= runs; r++) {
    const res = await compose('daily', fresh.input, { llm, dryRun: true });
    const c = res.composition;
    const text = draftToDailyText(res.final);
    const levelCtx = { facts: c.facts, sustained: lv?.sustained };
    const chosenRaw = (c.draft2Raw ?? c.draft1Raw) as any;
    // Lo enviado es el borrador elegido tras la red de nivel (como en `compose`).
    const sentRaw = chosenRaw ? enforceLevelRules(chosenRaw, levelCtx).draft : null;
    const left = sentRaw ? directionLevelDefects(sentRaw, levelCtx) : [];
    const all = [text.headline, text.paragraph, ...text.highlights, ...text.insights.negative, ...text.insights.neutral, ...text.insights.positive].join(' \n ');
    const row = {
      corrida: r,
      degradado: c.degraded,
      segundos: c.stageSeconds?.total,
      corrector: c.correctorRan,
      'avisos de nivel (1er borrador)': (c.qa?.code ?? []).filter((d: any) => /nivel/.test(d.type)).length,
      'avisos de nivel (enviado)': left.length,
      'frases de calma': findCalming(all).join(', ') || '—',
      'cita el nivel': /\b(14|28) días\b/.test(all),
      'cita días abierto': sentRaw ? /issue_\d_days_open/.test(JSON.stringify(sentRaw)) : false,
      'red de seguridad': (c.safetyNetLog ?? []).length,
    };
    summary.push(row);
    console.log(`\n— corrida ${r} —`);
    console.log('TITULAR:', text.headline);
    console.log('PÁRRAFO:', text.paragraph);
    for (const h of text.highlights) console.log('  ·', h);
    if (left.length) console.log('  avisos de nivel sin resolver:', JSON.stringify(left));

    if (out) {
      const renderData: DailyReportRenderData = {
        agencyName: agency.name, agencyShortName: short, agencyKicker: `${short} · ${agency.name}`,
        periodLabel: formatPeriodLabel(w.startYmd, endYmd),
        updatedAtLabel: `${formatShortDay(addDaysYmd(endYmd, 1))}, vista previa`,
        totals: report.totals, deltaVsPrev: report.deltaVsPrev,
        deltaDisplay: {
          negative: minBaseDelta(winCur.totals.negative, winPrev.totals.negative),
          neutral: minBaseDelta(winCur.totals.neutral, winPrev.totals.neutral),
          positive: minBaseDelta(winCur.totals.positive, winPrev.totals.positive),
        },
        dailySeries: report.dailySeries, topicsTable: report.topicsTable,
        insights: text.insights,
        dailySummary: { label: `Resumen del día · ${formatShortDay(endYmd)}`, headline: text.headline, paragraph: text.paragraph, highlights: text.highlights },
        metrics: {
          crisis: {
            display: formatMetric('crisis', winCur.crisisRiskScore),
            delta: formatDelta(winCur.crisisRiskScore != null ? winCur.crisisRiskScore * 100 : null, winPrev.crisisRiskScore != null ? winPrev.crisisRiskScore * 100 : null, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }),
          },
          bhi: { display: formatMetric('bhi', winCur.brandHealthIndex) },
          nss: { display: formatMetric('nss', winCur.nss), delta: formatDelta(winCur.nss, winPrev.nss, { kind: 'absolute', decimals: 1 }) },
        },
        overviewUrl: `https://citizenecho.com/overview?agency=${slug}`,
        interpretation: {
          insightsWindowLabel: 'últimos 7 días',
          methodologyNote: buildDailyMethodologyNote({ periodLabel: formatPeriodLabel(w.startYmd, endYmd), dayLabel: formatLongDay(endYmd), minDeltaBase: FACT_MIN_DELTA_BASE }),
          sustainedLevel: it.sustainedLevel,
          openIssues: it.openIssues,
        },
      };
      const base = join(out, `${slug}-${endYmd}-r${r}`);
      writeFileSync(`${base}.html`, renderDailyReportHtml(renderData));
      writeFileSync(`${base}.json`, JSON.stringify(c, null, 1));
    }
  }
  console.log('\nResumen');
  console.table(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
