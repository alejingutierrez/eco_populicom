/**
 * INT-01 · Asuntos abiertos y nivel sostenido contra la base de producción.
 * SOLO LECTURA: corre las mismas funciones que usarán el correo y el Overview
 * (`loadOpenIssues`, `buildSustainedLevel`) a través del lambda eco-migration
 * (custom-query, solo SELECT), porque la base está en una VPC privada.
 *
 * Uso:
 *   set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
 *   node_modules/.bin/tsx scripts/int-01-open-issues-live.ts df 2026-10-23
 *   node_modules/.bin/tsx scripts/int-01-open-issues-live.ts gobernadora 2026-11-15 --json
 *
 * Argumentos: slug de la agencia y último día cerrado (YYYY-MM-DD, día de
 * Puerto Rico). `--json` imprime el resultado completo en vez del resumen.
 *
 * Los parámetros se incrustan en el SQL como literales (custom-query no
 * acepta parámetros): solo se aceptan textos y listas de textos, y los
 * valores salen de este script, nunca de un usuario.
 */
import { writeFileSync } from 'node:fs';
import { createEcoMigrationClient } from './lib/eco-migration-client.ts';
import { loadDailySentimentSeries } from '../packages/shared/src/aggregations/sentiment-report.ts';
import { buildOpenIssues, loadOpenIssuesInput, type OpenIssue } from '../packages/shared/src/narratives/open-issues.ts';
import { buildSustainedLevel, sustainedSeriesStart, type SustainedWindow } from '../packages/shared/src/narratives/sustained-level.ts';

const client = createEcoMigrationClient();

const STAGE: Record<OpenIssue['stage'], string> = { new: 'nuevo', rising: 'sube', falling: 'baja', steady: 'se mantiene' };

function voiceText(i: OpenIssue): string {
  if (!i.voice) return `sin voz dominante (${i.voices} voces)`;
  const what = i.voice.basis === 'interactions' ? 'de las interacciones' : 'de las menciones';
  return `${i.voice.label}, ${i.voice.sharePct} % ${what} (${i.voices} voces)`;
}

function levelText(w: SustainedWindow): string {
  if (!w.enoughBase) return `${w.days} días: base insuficiente (${w.total} menciones)`;
  return `${w.days} días: ${w.negPct} % negativo, NSS ${w.nss} (${w.total} menciones)`;
}

async function main() {
  const [slug, endYmd] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const asJson = process.argv.includes('--json');
  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd ?? '')) {
    console.error('Uso: tsx scripts/int-01-open-issues-live.ts <slug> <YYYY-MM-DD> [--json]');
    process.exit(2);
  }
  const ag = await client.query<{ id: string }>('SELECT id FROM agencies WHERE slug = $1', [slug]);
  const agencyId = ag.rows[0]?.id;
  if (!agencyId) throw new Error(`Agencia desconocida: ${slug}`);

  // Universo del correo (MAIL_UNIVERSE = histórico): sin opciones.
  const [issuesInput, series] = await Promise.all([
    loadOpenIssuesInput(client, agencyId, endYmd),
    loadDailySentimentSeries(client, agencyId, sustainedSeriesStart(endYmd), endYmd),
  ]);
  // `--dump-input=<ruta>`: guarda la entrada cruda (con texto de menciones) para
  // calibrar sin volver a consultar. NO versionar ese archivo.
  const dump = process.argv.find((a) => a.startsWith('--dump-input='));
  if (dump) writeFileSync(dump.slice('--dump-input='.length), JSON.stringify(issuesInput));
  const issues = buildOpenIssues(issuesInput);
  const level = buildSustainedLevel(series, endYmd);

  if (asJson) {
    console.log(JSON.stringify({ issues, level }, null, 2));
    return;
  }
  console.log(`\n${slug} · al ${endYmd}`);
  console.log(`Asuntos abiertos: ${issues.openCount} (se muestran ${issues.issues.length})`);
  for (const i of issues.issues) {
    console.log(`  · ${i.name}${i.lead ? ` (lo más activo esta semana: ${i.lead.name}, ${i.lead.week})` : ''}`);
    console.log(`      ${STAGE[i.stage]}: ${i.week} menciones esta semana, ${i.prevWeek} la previa · ${i.negPct} % negativas`);
    console.log(`      ${i.daysOpen} días abierto (desde ${i.openSince}${i.reopened ? `, reabierto; primera mención ${i.firstEverDay}` : ''}) · ${i.narrativeIds.length} narrativa(s)`);
    console.log(`      voz: ${voiceText(i)}`);
  }
  const c = issues.coverage;
  console.log(`Cobertura: ${c.inIssues} de ${c.weekTotal} menciones de la semana están en un asunto (${c.pct ?? '—'} %)`);
  console.log(`Nivel · ${levelText(level.d14)} · ${levelText(level.d28)} · umbral ${level.thresholds.negPct} % y NSS ${level.thresholds.nss}`);
  console.log(`Sostenido: ${level.sustained === null ? 'sin base' : level.sustained ? 'sí' : 'no'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
