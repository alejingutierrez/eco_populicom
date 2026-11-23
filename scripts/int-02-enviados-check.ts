/**
 * INT-02 — comprobación sobre los correos REALMENTE enviados. SOLO LECTURA.
 *
 * Lee de `report_send_log` (vía eco-migration, solo SELECT) el texto final y
 * el registro de cada Diario y Semanal programado y cuenta, por día:
 * palabras vetadas, afirmaciones de dirección que contradicen su cifra,
 * variaciones sin nivel, defectos duros que quedaron y correcciones sin el
 * antes y el después archivados. Los cinco deben dar cero. Informa aparte los
 * signos dobles («bajó -18 %»).
 *
 * Uso:
 *   set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
 *   node_modules/.bin/tsx scripts/int-02-enviados-check.ts                    # últimos 7 días
 *   node_modules/.bin/tsx scripts/int-02-enviados-check.ts --from=2026-11-04 --to=2026-11-23
 *   node_modules/.bin/tsx scripts/int-02-enviados-check.ts --json
 *
 * Sale con código 1 si algún correo rompe un criterio.
 */
import { createEcoMigrationClient } from './lib/eco-migration-client.ts';
import { judgeSent, type SentRow, type SentVerdict } from './lib/int-02-enviados.ts';

const TZ_OFFSET_H = 4; // Puerto Rico (AST, sin horario de verano)
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const addDays = (ymd: string, k: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const todayPr = () => new Date(Date.now() - TZ_OFFSET_H * 3_600_000).toISOString().slice(0, 10);
const KIND: Record<string, string> = { 'daily-sentiment-summary': 'Diario', 'weekly-comparison-v1': 'Semanal' };

/** Un día por consulta: la respuesta del lambda tiene tope de tamaño. */
async function loadDay(client: ReturnType<typeof createEcoMigrationClient>, day: string): Promise<SentRow[]> {
  const r = await client.query<any>(
    `SELECT a.slug, l.template_key, l.sent_at,
            l.composition->'final' AS final,
            l.composition->'warnings' AS warnings,
            l.composition->'residualCodeProblems' AS residual,
            l.composition->'safetyNetLog' AS net,
            l.composition->'correctorRan' AS corrector_ran,
            l.composition->'errors' AS errors,
            (jsonb_typeof(l.composition->'draft1Raw') = 'object') AS has_d1,
            (jsonb_typeof(l.composition->'draft2Raw') = 'object') AS has_d2
       FROM report_send_log l JOIN agencies a ON a.id = l.agency_id
      WHERE l.trigger = 'scheduled' AND l.status = 'sent' AND l.composition IS NOT NULL
        AND l.template_key IN ('daily-sentiment-summary', 'weekly-comparison-v1')
        AND l.sent_at >= $1 AND l.sent_at < $2
      ORDER BY l.sent_at`,
    [`${day}T0${TZ_OFFSET_H}:00:00Z`, `${addDays(day, 1)}T0${TZ_OFFSET_H}:00:00Z`]);
  return r.rows.map((x) => ({
    slug: x.slug, templateKey: x.template_key, sentAt: x.sent_at, final: x.final ?? null,
    warnings: x.warnings ?? [], residual: x.residual ?? [], safetyNetLog: x.net ?? [],
    correctorRan: x.corrector_ran === true, hasDraft1: x.has_d1 === true, hasDraft2: x.has_d2 === true,
    errors: Array.isArray(x.errors) ? x.errors : [],
  }));
}

async function main() {
  const to = arg('to') ?? todayPr();
  const from = arg('from') ?? addDays(to, -6);
  const client = createEcoMigrationClient();
  const days: Array<{ day: string; sends: Array<SentRow & SentVerdict> }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rows = await loadDay(client, d);
    days.push({ day: d, sends: rows.map((r) => ({ ...r, ...judgeSent(r) })) });
  }
  const all = days.flatMap((d) => d.sends);
  const sum = (k: keyof SentVerdict) => all.reduce((n, s) => n + (s[k] as string[]).length, 0);
  const totals = {
    correos: all.length,
    conDefecto: all.filter((s) => !s.ok).length,
    vetadas: sum('vetoed'), contradicciones: sum('contradictions'), sinNivel: sum('levelWarnings'),
    durosResiduales: sum('residual'), sinArchivo: sum('unarchived'),
    signoDoble: sum('doubleSigns'), correosConSignoDoble: all.filter((s) => s.doubleSigns.length).length,
  };
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ from, to, totals, days: days.map((d) => ({ day: d.day, sends: d.sends.map(({ final, ...rest }) => rest) })) }, null, 2));
  } else {
    console.log(`INT-02 · correos programados enviados del ${from} al ${to} (días de Puerto Rico)\n`);
    for (const d of days) {
      if (!d.sends.length) { console.log(`${d.day}  sin envíos con archivo`); continue; }
      console.log(`${d.day}  ${d.sends.every((s) => s.ok) ? 'OK' : 'FALLA'}`);
      for (const s of d.sends) {
        const bad = [
          ...s.vetoed.map((x) => `vetada ${x}`), ...s.contradictions.map((x) => `contradice ${x}`),
          ...s.levelWarnings.map((x) => `nivel ${x}`), ...s.residual.map((x) => `residual ${x}`), ...s.unarchived.map((x) => `archivo: ${x}`),
        ];
        const extra = s.doubleSigns.length ? ` · signo doble: ${s.doubleSigns.join(', ')}` : '';
        console.log(`    ${s.ok ? 'OK   ' : 'FALLA'} ${(KIND[s.templateKey] ?? s.templateKey).padEnd(7)} ${s.slug.padEnd(12)} ${bad.join(' | ') || 'sin defectos'}${extra}`);
      }
    }
    console.log(`\nTotales: ${totals.correos} correos · ${totals.conDefecto} con defecto de criterio`);
    console.log(`  palabras vetadas ${totals.vetadas} · dirección contra cifra ${totals.contradicciones} · variación sin nivel ${totals.sinNivel} · duros residuales ${totals.durosResiduales} · correcciones sin archivo ${totals.sinArchivo}`);
    console.log(`  signo doble (informativo): ${totals.signoDoble} en ${totals.correosConSignoDoble} correos`);
  }
  process.exit(totals.conDefecto ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
