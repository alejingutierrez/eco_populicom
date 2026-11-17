/**
 * INT-01 · WP-5 — ¿el Overview muestra el mismo bloque que el correo? SOLO LECTURA.
 *
 * Calcula la respuesta de `/api/overview/open-issues` con la MISMA función del
 * endpoint (`computeOverviewOpenIssues`) contra producción, a través del
 * lambda eco-migration (solo SELECT), y compara campo a campo sus hechos
 * `level_*` e `issue_*` con los de una composición del Diario:
 *
 *   - por defecto, la del último Diario programado de la agencia archivado en
 *     `report_send_log`;
 *   - con `--composition=<archivo>`, la de un `dryRun` del lambda
 *     `eco-weekly-report` (el JSON de respuesta tal cual).
 *
 * Uso:
 *   set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
 *   node_modules/.bin/tsx scripts/int-01-overview-vs-mail.ts df
 *   node_modules/.bin/tsx scripts/int-01-overview-vs-mail.ts ddecpr --composition=/ruta/dry.json
 *   node_modules/.bin/tsx scripts/int-01-overview-vs-mail.ts df --payload   # imprime la respuesta del endpoint
 *
 * El correo de las 6 a. m. se armó con las menciones que había a esa hora; las
 * que llegan después (ingesta tardía, importaciones) mueven los conteos del
 * día. Por eso contra el envío archivado puede haber diferencias pequeñas, y
 * el script las lista; contra un `dryRun` hecho en el momento deben ser cero.
 *
 * Sale con código 1 si hay diferencias.
 */
import { readFileSync } from 'node:fs';
import { createEcoMigrationClient } from './lib/eco-migration-client.ts';
import { computeOverviewOpenIssues } from '../apps/web/src/lib/overview/open-issues.ts';

type FactMap = Record<string, number>;

const isBlockFact = (id: string) => /^(level|issue)_/.test(id);

function factsOf(composition: any): FactMap {
  const f = composition?.facts ?? {};
  const list: Array<{ id: string; value: number }> = Array.isArray(f) ? f : Object.values(f);
  return Object.fromEntries(list.filter((x) => isBlockFact(x.id)).map((x) => [x.id, Number(x.value)]));
}

async function main() {
  const [slug] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const file = process.argv.find((a) => a.startsWith('--composition='))?.slice('--composition='.length);
  if (!slug) {
    console.error('Uso: tsx scripts/int-01-overview-vs-mail.ts <slug> [--composition=<dryRun.json>] [--payload]');
    process.exit(2);
  }
  const client = createEcoMigrationClient();
  const ag = await client.query<{ id: string }>('SELECT id FROM agencies WHERE slug = $1', [slug]);
  const agencyId = ag.rows[0]?.id;
  if (!agencyId) throw new Error(`Agencia desconocida: ${slug}`);

  let mail: FactMap;
  let endYmd: string;
  let source: string;
  if (file) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const body = typeof raw.body === 'string' ? JSON.parse(raw.body) : (raw.body ?? raw);
    const comp = body.composition ?? body.results?.[0]?.composition ?? body;
    mail = factsOf(comp);
    endYmd = comp.window?.endYmd;
    source = `dryRun ${file}`;
  } else {
    const r = await client.query<any>(
      `SELECT l.sent_at, l.composition->'window'->>'endYmd' AS end_ymd,
              (SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('id', k, 'value', v->'value')), '{}'::jsonb)
                 FROM jsonb_each(l.composition->'facts') AS f(k, v)
                WHERE k LIKE 'level_%' OR k LIKE 'issue_%') AS facts
         FROM report_send_log l
        WHERE l.agency_id = $1 AND l.trigger = 'scheduled' AND l.template_key = 'daily-sentiment-summary'
          AND l.composition IS NOT NULL AND jsonb_typeof(l.composition->'facts') = 'object'
        ORDER BY l.sent_at DESC LIMIT 1`, [agencyId]);
    const row = r.rows[0];
    if (!row) throw new Error(`Sin Diario archivado para ${slug}`);
    mail = factsOf({ facts: row.facts });
    endYmd = row.end_ymd;
    source = `Diario enviado el ${row.sent_at}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endYmd ?? '')) throw new Error('La composición no trae el último día de la ventana');

  const payload = await computeOverviewOpenIssues(client, agencyId, endYmd);
  if (process.argv.includes('--payload')) console.log(JSON.stringify(payload, null, 2));
  const web: FactMap = Object.fromEntries(payload.facts.map((f) => [f.id, f.value]));

  const ids = [...new Set([...Object.keys(mail), ...Object.keys(web)])].sort();
  const diffs = ids.filter((id) => mail[id] !== web[id]);
  console.log(`\n${slug} · último día cerrado ${endYmd} · correo: ${source}`);
  console.log(`Hechos de nivel y de asuntos: ${ids.length} · iguales: ${ids.length - diffs.length} · distintos: ${diffs.length}`);
  for (const id of diffs) {
    console.log(`  ${id.padEnd(26)} correo ${mail[id] ?? '—'} · Overview ${web[id] ?? '—'}`);
  }
  if (payload.errors.length) console.log(`Cargas fallidas en el Overview: ${payload.errors.join('; ')}`);
  for (const [k, i] of payload.issues.entries()) console.log(`  ${k + 1}. ${i.name} · ${i.daysOpen} días · ${i.stageText} · ${i.negPct}% negativas · ${i.voiceText}`);
  if (payload.level) console.log(`  ${payload.level.text}`);
  if (diffs.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
