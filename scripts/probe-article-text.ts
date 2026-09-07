/**
 * probe-article-text — sonda de la extracción de texto completo contra URLs
 * REALES de la base. No escribe nada: solo mide.
 *
 * Saca las URLs vía `eco-migration custom-query` (solo SELECT) para no exigir
 * acceso directo a la RDS desde la máquina local, corre `fetchArticleText` con
 * concurrencia y reporta por URL + agregado por dominio y por razón de fallo.
 *
 * Uso:
 *   node_modules/.bin/tsx scripts/probe-article-text.ts --limit 10
 *   node_modules/.bin/tsx scripts/probe-article-text.ts --limit 100 --concurrency 8
 *   node_modules/.bin/tsx scripts/probe-article-text.ts --domain elnuevodia.com --limit 20
 *   node_modules/.bin/tsx scripts/probe-article-text.ts --top-domains 30 --per-domain 3
 *
 * `--top-domains N --per-domain K` es el modo importante para entender LÍMITES:
 * toma K URLs de cada uno de los N dominios más frecuentes, de modo que la
 * muestra no quede dominada por metro.pr (6.6% del volumen).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fetchArticleText, createDomainLimiter } from '../packages/shared/src/article-text';

interface Row { id: string; url: string; domain: string; snip_len: number; title: string }

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

/** Invoca eco-migration custom-query y devuelve las filas. Solo SELECT. */
function query(sql: string): Row[] {
  const payload = JSON.stringify({ action: 'custom-query', query: sql });
  const out = execFileSync('aws', [
    'lambda', 'invoke',
    '--function-name', 'eco-migration',
    '--payload', payload,
    '--cli-binary-format', 'raw-in-base64-out',
    '/dev/stdout',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // El CLI escribe el JSON del lambda y luego su propio JSON de status.
  const first = out.slice(0, out.indexOf('}{') > -1 ? out.indexOf('}{') + 1 : undefined);
  const env = JSON.parse(first);
  const body = typeof env.body === 'string' ? JSON.parse(env.body) : env;
  if (body.errorMessage || env.errorMessage) throw new Error(body.errorMessage ?? env.errorMessage);
  return (body.rows ?? body) as Row[];
}

function buildSql(): string {
  const limit = Number(arg('limit', '10'));
  const domain = arg('domain');
  const topDomains = arg('top-domains');
  const perDomain = Number(arg('per-domain', '3'));
  const base = `page_type = 'news' AND is_duplicate = false AND url IS NOT NULL AND url <> ''`;

  if (topDomains) {
    // Muestra estratificada: K por dominio de los N más frecuentes. Sin esto la
    // muestra aleatoria queda sesgada a los 5 dominios grandes.
    return `SELECT * FROM (
      SELECT id::text, url, domain, length(snippet) AS snip_len, left(coalesce(title,''), 70) AS title
        FROM (
          SELECT m.*, row_number() OVER (PARTITION BY m.domain ORDER BY m.published_at DESC) AS rn
            FROM mentions m
            JOIN (SELECT domain FROM mentions WHERE ${base}
                   GROUP BY domain ORDER BY count(*) DESC LIMIT ${Number(topDomains)}) d
              ON d.domain = m.domain
           WHERE ${base}
        ) s
       WHERE rn <= ${perDomain}
    ) z`;
  }
  const domFilter = domain ? ` AND domain = '${domain.replace(/'/g, "''")}'` : '';
  return `SELECT * FROM (
    SELECT id::text, url, domain, length(snippet) AS snip_len, left(coalesce(title,''), 70) AS title
      FROM mentions
     WHERE ${base}${domFilter}
     ORDER BY published_at DESC
     LIMIT ${limit}
  ) z`;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) + '%' : '—');

async function main() {
  const concurrency = Number(arg('concurrency', '5'));
  console.log('Consultando URLs a eco-migration…');
  const rows = query(buildSql());
  console.log(`${rows.length} URLs · concurrencia ${concurrency} · gap/dominio ${arg('gap-ms', '1200')}ms\n`);

  // El limitador serializa por host: la concurrencia se reparte ENTRE dominios,
  // nunca dentro de uno (así se evitaron los 429 de la primera sonda).
  const gapMs = Number(arg('gap-ms', '1200'));
  const limiter = createDomainLimiter(gapMs);

  const t0 = Date.now();
  const results = await mapLimit(rows, concurrency, async (r) => ({
    row: r,
    res: await limiter(r.url, () => fetchArticleText(r.url)),
  }));
  const elapsed = (Date.now() - t0) / 1000;

  // --- detalle por URL ---
  console.log('estado  método      chars  ×snip  ms     dominio                    título');
  console.log('─'.repeat(112));
  for (const { row, res } of results) {
    const flag = res.ok ? ' ok  ' : 'FALLO';
    const mult = res.ok && row.snip_len ? `${(res.chars / row.snip_len).toFixed(1)}×` : '';
    const label = res.ok ? res.method : `${res.reason}${res.status ? ' ' + res.status : ''}`;
    console.log(
      `${flag}  ${label.padEnd(12)}${String(res.chars).padStart(6)}${mult.padStart(7)}` +
      `${String(res.ms).padStart(6)}  ${row.domain.slice(0, 25).padEnd(27)}${(row.title ?? '').slice(0, 40)}`,
    );
  }

  // --- agregados ---
  const okRes = results.filter((r) => r.res.ok);
  console.log('\n' + '═'.repeat(112));
  console.log(`ÉXITO: ${okRes.length}/${results.length} (${pct(okRes.length, results.length)})   ` +
    `wall ${elapsed.toFixed(1)}s   ${(elapsed / results.length).toFixed(2)}s/URL efectivo`);

  if (okRes.length) {
    const chars = okRes.map((r) => r.res.chars).sort((a, b) => a - b);
    const med = chars[Math.floor(chars.length / 2)];
    const ratios = okRes.filter((r) => r.row.snip_len).map((r) => r.res.chars / r.row.snip_len);
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1);
    console.log(`chars: min ${chars[0]} · mediana ${med} · max ${chars[chars.length - 1]}   ` +
      `ganancia media vs snippet: ${avgRatio.toFixed(1)}×`);
    const byMethod = new Map<string, number>();
    for (const r of okRes) byMethod.set(r.res.method, (byMethod.get(r.res.method) ?? 0) + 1);
    console.log('métodos: ' + [...byMethod].map(([k, v]) => `${k}=${v}`).join('  '));
  }

  const byReason = new Map<string, number>();
  for (const r of results) if (!r.res.ok) {
    const k = `${r.res.reason}${r.res.status >= 400 ? ' ' + r.res.status : ''}`;
    byReason.set(k, (byReason.get(k) ?? 0) + 1);
  }
  if (byReason.size) {
    console.log('\nFALLOS por razón:');
    for (const [k, v] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  // --- por dominio (lo que dice dónde SÍ funciona) ---
  const byDom = new Map<string, { ok: number; n: number; chars: number[]; reasons: string[] }>();
  for (const { row, res } of results) {
    const d = byDom.get(row.domain) ?? { ok: 0, n: 0, chars: [], reasons: [] };
    d.n++;
    if (res.ok) { d.ok++; d.chars.push(res.chars); } else d.reasons.push(String(res.reason));
    byDom.set(row.domain, d);
  }
  if (byDom.size > 1) {
    console.log('\nPOR DOMINIO:');
    console.log('  éxito   mediana  dominio                          razón de fallo');
    for (const [dom, d] of [...byDom].sort((a, b) => (a[1].ok / a[1].n) - (b[1].ok / b[1].n))) {
      const cs = d.chars.sort((a, b) => a - b);
      const med = cs.length ? cs[Math.floor(cs.length / 2)] : 0;
      const rs = [...new Set(d.reasons)].join(',');
      console.log(`  ${`${d.ok}/${d.n}`.padEnd(8)}${String(med || '—').padStart(7)}  ${dom.slice(0, 32).padEnd(33)}${rs}`);
    }
  }

  const outFile = arg('out');
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(results.map(({ row, res }) => ({
      id: row.id, url: row.url, domain: row.domain, snip_len: row.snip_len,
      ok: res.ok, reason: res.reason, status: res.status, method: res.method,
      chars: res.chars, words: res.words, ms: res.ms, bytes: res.bytes,
      text: res.text?.slice(0, 500) ?? null,
    })), null, 2));
    console.log(`\n→ detalle en ${outFile}`);
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
