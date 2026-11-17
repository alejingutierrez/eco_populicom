/**
 * INT-01 · WP-6 — comprobación diaria de los correos REALES. SOLO LECTURA.
 *
 * Para cada día desde el despliegue (17-nov-2026) mira los envíos programados
 * del Diario y del Semanal en `report_send_log` (vía eco-migration, solo
 * SELECT) y dice si salieron con el motor, con el nivel a 14 y 28 días y los
 * asuntos abiertos, y sin los avisos `direccion_sin_nivel` ni
 * `mejora_con_nivel_sostenido` después del corrector. Además busca en los
 * logs del lambda `eco-weekly-report` los fallos que dejan un envío sin
 * archivo. El criterio de cierre pide 7 días seguidos en OK.
 *
 * Uso:
 *   set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
 *   node_modules/.bin/tsx scripts/int-01-wp6-check.ts                 # del 17-nov a hoy
 *   node_modules/.bin/tsx scripts/int-01-wp6-check.ts --from=2026-11-17 --to=2026-11-24
 *   node_modules/.bin/tsx scripts/int-01-wp6-check.ts --json
 *   node_modules/.bin/tsx scripts/int-01-wp6-check.ts --no-logs       # sin CloudWatch
 *
 * Sale con código 1 si algún día está en FALLA.
 */
import { execFileSync } from 'node:child_process';
import { createEcoMigrationClient } from './lib/eco-migration-client.ts';
import { judgeDay, streak, type DayVerdict, type SendRow } from './lib/int-01-wp6.ts';

const DEPLOYED = '2026-11-17';
const TZ_OFFSET_H = 4; // Puerto Rico (AST, sin horario de verano)
const LOG_GROUP = '/aws/lambda/eco-weekly-report';
const LOG_PATTERNS = [
  'no se pudo guardar la composición',
  'failed to write send log with archive',
  'direccion_sin_nivel',
  'mejora_con_nivel_sostenido',
  'degraded',
];

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const addDays = (ymd: string, k: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const todayPr = () => new Date(Date.now() - TZ_OFFSET_H * 3_600_000).toISOString().slice(0, 10);
/** Día de Puerto Rico de un instante UTC. */
const prDay = (iso: string) => new Date(Date.parse(iso) - TZ_OFFSET_H * 3_600_000).toISOString().slice(0, 10);

async function loadSends(from: string, to: string): Promise<SendRow[]> {
  const client = createEcoMigrationClient();
  const lo = `${from}T0${TZ_OFFSET_H}:00:00Z`;
  const hi = `${addDays(to, 1)}T0${TZ_OFFSET_H}:00:00Z`;
  // Solo lo que hace falta de la composición: los hechos de nivel y de asuntos,
  // los avisos y cómo se entregó (la composición entera pesa cientos de KB).
  const r = await client.query<any>(
    `SELECT a.slug, l.template_key, l.status, l.sent_at, l.composer_version,
            (l.composition IS NOT NULL) AS has_composition,
            (SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('id', k, 'value', v->'value')), '{}'::jsonb)
               FROM jsonb_each(CASE WHEN jsonb_typeof(l.composition->'facts') = 'object' THEN l.composition->'facts' ELSE '{}'::jsonb END) AS f(k, v)
              WHERE k LIKE 'level_%' OR k LIKE 'issue_%') AS facts,
            l.composition->'warnings' AS warnings,
            l.composition->'residualCodeProblems' AS residual,
            l.composition->'degraded' AS degraded,
            l.composition->'delivery' AS delivery
       FROM report_send_log l JOIN agencies a ON a.id = l.agency_id
      WHERE l.trigger = 'scheduled'
        AND l.template_key IN ('daily-sentiment-summary', 'weekly-comparison-v1')
        AND l.sent_at >= $1 AND l.sent_at < $2
      ORDER BY l.sent_at`, [lo, hi]);
  return r.rows.map((x) => ({
    slug: x.slug,
    templateKey: x.template_key,
    status: x.status,
    sentAt: x.sent_at,
    composerVersion: x.composer_version,
    composition: x.has_composition ? {
      facts: x.facts ?? {},
      warnings: x.warnings ?? [],
      residualCodeProblems: x.residual ?? [],
      degraded: x.degraded === true,
      delivery: x.delivery ?? undefined,
    } : null,
  }));
}

/** Líneas de log del lambda por día. Usa el CLI de AWS (el repo no trae el SDK de CloudWatch Logs). */
async function loadLogHits(from: string, to: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const startTime = Date.parse(`${from}T0${TZ_OFFSET_H}:00:00Z`);
  const endTime = Math.min(Date.now(), Date.parse(`${addDays(to, 1)}T0${TZ_OFFSET_H}:00:00Z`));
  for (const pattern of LOG_PATTERNS) {
    const raw = execFileSync('aws', [
      'logs', 'filter-log-events', '--log-group-name', LOG_GROUP,
      '--start-time', String(startTime), '--end-time', String(endTime),
      '--filter-pattern', `"${pattern}"`, '--query', 'events[].[timestamp,message]', '--output', 'json',
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const [ts, message] of JSON.parse(raw || '[]') as Array<[number, string]>) {
      const msg = (message ?? '').trim();
      // «degraded» aparece en el JSON de una composición sana (`degraded: false`): solo cuenta la línea de estado.
      if (pattern === 'degraded' && !/·\s*degraded\s*·/.test(msg)) continue;
      const day = prDay(new Date(ts).toISOString());
      const line = msg.replace(/^\S+\s+\S+\s+(INFO|WARN|ERROR)\s+/, '').split('\n')[0].slice(0, 200);
      const list = out.get(day) ?? [];
      if (!list.includes(line)) list.push(line);
      out.set(day, list);
    }
  }
  return out;
}

const WORD: Record<DayVerdict['verdict'], string> = { ok: 'OK', falla: 'FALLA', sin_evidencia: 'SIN EVIDENCIA', sin_envios: 'SIN ENVÍOS' };
const KIND: Record<string, string> = { 'daily-sentiment-summary': 'Diario', 'weekly-comparison-v1': 'Semanal' };

async function main() {
  const from = arg('from') ?? DEPLOYED;
  const to = arg('to') ?? todayPr();
  const [sends, logHits] = await Promise.all([
    loadSends(from, to),
    process.argv.includes('--no-logs') ? Promise.resolve(new Map<string, string[]>()) : loadLogHits(from, to),
  ]);
  const days: DayVerdict[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(judgeDay(d, sends.filter((s) => prDay(s.sentAt) === d)));
  }
  // El día en curso sin envíos todavía no cuenta ni rompe la racha.
  const judged = days.filter((d) => !(d.day === todayPr() && d.verdict === 'sin_envios'));
  const st = streak(judged);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ from, to, days, logHits: Object.fromEntries(logHits), streak: st }, null, 2));
  } else {
    console.log(`INT-01 · WP-6 · envíos programados del ${from} al ${to} (días de Puerto Rico)\n`);
    for (const d of days) {
      console.log(`${d.day}  ${WORD[d.verdict]}`);
      for (const s of d.sends) {
        const kind = KIND[s.templateKey] ?? s.templateKey;
        const detail = s.verdict === 'ok'
          ? `motor ${s.composerVersion} · nivel sí · ${s.issueFacts ? 'asuntos sí' : 'sin asuntos abiertos'} · 0 avisos de nivel`
          : s.reasons.join('; ');
        console.log(`    ${WORD[s.verdict].padEnd(13)} ${kind.padEnd(7)} ${s.slug.padEnd(12)} ${detail}`);
      }
      for (const line of logHits.get(d.day) ?? []) console.log(`    log: ${line}`);
    }
    console.log(`\nRacha: ${st.run} día(s) seguidos en OK. Faltan ${st.missing} para los 7 del criterio de cierre.`);
    if (st.missing > 0) {
      const next = addDays(judged.length ? judged[judged.length - 1].day : from, 1);
      console.log(`Si todos los días salen en OK desde el ${next}, el criterio se cumple el ${addDays(next, st.missing - 1)}.`);
    }
  }
  if (days.some((d) => d.verdict === 'falla')) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
