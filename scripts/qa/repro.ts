/**
 * repro.ts — «máquina del tiempo» del correo DIARIO de eco-weekly-report (arnés de calidad, scripts/qa).
 *
 * Reproduce las ENTRADAS (conteos, serie diaria, tópicos, muestras) y los PROMPTS exactos que el lambda
 * le da a Claude, para CUALQUIER día pasado, leyendo la base de producción (SOLO SELECT) a través del
 * lambda eco-migration (scripts/qa/lib/q.py). Usa el código REAL de @eco/shared de ESTE checkout
 * (packages/shared/src: buildSentimentReport, buildDailySummaryPrompt, buildSentimentInsightsPrompt) para los
 * conteos y los prompts; las queries de muestras/agregados son copia literal de
 * infra/lambda/weekly-report/index.ts (buildAggregates, loadSamples, loadTodaySamples) al 2-nov-2026.
 * Si esas funciones cambian en el lambda, hay que actualizar la copia (ver README, «mantenimiento»).
 *
 * USO (desde la raíz del repo; necesita tsx: node_modules/.bin/tsx o `npx tsx`):
 *   npx tsx scripts/qa/repro.ts --slug ddecpr --end 2026-10-31 [--llm] [--day-mode utc|pr]
 *        [--out archivo.json] [--model us.anthropic.claude-opus-4-6-v1] [--quiet]
 *
 *   --end        ÚLTIMO día CERRADO (hora PR) de la ventana de 7 días. El correo del 1-nov 6 AM = --end 2026-10-31.
 *   --day-mode   utc (default) = SEMÁNTICA REAL DEL LAMBDA: las muestras usan `published_at >= $2::date`
 *                (día UTC), mientras los conteos usan día PR. pr = variante corregida (día PR) para comparar.
 *   --llm        además llama a Bedrock (mismo modelo, temperature 0, mismos tool schemas) y guarda la salida.
 *   --out        JSON completo con ventana, totales, serie diaria, tópicos, agregados, muestras, prompts y LLM.
 * Salida por stdout: resumen legible (ventana, totales, serie, muestras del día y, con --llm, el lede generado).
 *
 * Variables: REPO_ENV (ruta del .env con credenciales AWS), ECO_SHARED_SRC (otra copia de packages/shared/src,
 * p. ej. un snapshot, para reproducir el código de una fecha), ECO_QA_PYTHON (intérprete; default python3).
 *
 * SOLO LECTURA: no escribe en la base, no envía correos, no llama a Brandwatch.
 * Notas de fidelidad: los datos son los de HOY (pueden haber cambiado desde el envío: llegadas tardías,
 * reclasificación). No incluye foto de portada ni métricas compuestas (no afectan titular/insights).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(resolve(process.argv[1]));                    // scripts/qa
const REPO = resolve(HERE, '..', '..');
const SH = process.env.ECO_SHARED_SRC ? resolve(process.env.ECO_SHARED_SRC) : join(REPO, 'packages', 'shared', 'src');
const QPY = join(HERE, 'lib', 'q.py');
const PYTHON = process.env.ECO_QA_PYTHON ?? 'python3';

// ---------- credenciales AWS del .env (nunca se imprimen) ----------
// El .env se busca en REPO_ENV, en <repo>/.env y, en un worktree, en el checkout principal (git common dir).
function envCandidates(): string[] {
  const c: string[] = [];
  if (process.env.REPO_ENV) c.push(process.env.REPO_ENV);
  c.push(join(REPO, '.env'));
  try {
    const common = execFileSync('git', ['-C', REPO, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    if (common) c.push(join(dirname(resolve(REPO, common)), '.env'));
  } catch { /* sin git */ }
  return c;
}
const envFile = envCandidates().find((p) => existsSync(p));
if (!envFile) { console.error('No encontré .env: define REPO_ENV=/ruta/al/.env'); process.exit(2); }
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
process.env.AWS_REGION ??= 'us-east-1';
process.env.AWS_DEFAULT_REGION ??= process.env.AWS_REGION;

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = (name: string, dflt?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name: string) => argv.includes(`--${name}`);
const slug = opt('slug')!;
const endYmd = opt('end')!;
const dayMode = (opt('day-mode', 'utc') as 'utc' | 'pr');
const outFile = opt('out');
const wantLlm = flag('llm');
const quiet = flag('quiet');
const MODEL = opt('model', 'us.anthropic.claude-opus-4-6-v1')!;
const FALLBACK = 'us.anthropic.claude-sonnet-4-6';
if (!slug || !endYmd) {
  console.error('uso: npx tsx repro.ts --slug ddecpr --end 2026-10-31 [--llm] [--day-mode utc|pr] [--out f.json]');
  process.exit(2);
}

// ---------- pg proxy sobre eco-migration (SELECT-only) ----------
function lit(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(',')}]`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const tmp = mkdtempSync(join(tmpdir(), 'repro-'));
let nq = 0;
const client = {
  async query(text: string, params: unknown[] = []): Promise<{ rows: any[] }> {
    let sql = text.replace(/\$(\d+)/g, (_m, n) => lit(params[Number(n) - 1]));
    // el validador de eco-migration exige que la query EMPIECE con SELECT: un CTE se envuelve
    if (!/^\s*select\b/i.test(sql)) sql = `SELECT * FROM ( ${sql} ) z`;
    const out = join(tmp, `q${nq++}.json`);
    execFileSync(PYTHON, [QPY, '-', '--out', out, '--max', '1'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    const rows = JSON.parse(readFileSync(out, 'utf8'), (_k, val) => (typeof val === 'string' && ISO.test(val) ? new Date(val) : val));
    return { rows };
  },
};

// ---------- helpers copiados del lambda ----------
function agencyShortName(s: string): string {
  const map: Record<string, string> = { aaa: 'AAA', ddecpr: 'DDEC' };
  return map[s] ?? s.toUpperCase();
}
function normalizeSentiment(s: string | null): 'negative' | 'neutral' | 'positive' | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}
function coerceBulletList(raw: unknown, max = 4): string[] {
  const clean = (arr: unknown[]) => arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()).slice(0, max);
  if (Array.isArray(raw)) return clean(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith('[')) { try { const p = JSON.parse(t); if (Array.isArray(p)) return clean(p); } catch { /* suelto */ } }
    return [t].slice(0, max);
  }
  return [];
}

/** Rango de fechas de las muestras: utc = literal del lambda; pr = día calendario PR. */
function rangeSql(alias: string, startP: string, endP: string): string {
  return dayMode === 'utc'
    ? `${alias}.published_at >= (${startP}::date) AND ${alias}.published_at < ((${endP}::date) + INTERVAL '1 day')`
    : `(${alias}.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= ${startP}::date AND (${alias}.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= ${endP}::date`;
}

async function buildAggregates(agency: any, startDate: string, endDate: string, sentimentReport: any) {
  const byTopic = sentimentReport.topicsTable
    .filter((t: any) => !t.isOther && !t.isUnclassified)
    .slice(0, 10)
    .map((t: any) => ({ topic: t.topic, subtopics: t.subtopics ? t.subtopics.split(' · ') : [], total: t.total, negative: t.negative, neutral: t.neutral, positive: t.positive }));
  const byMuni = await client.query(
    `SELECT mu.name AS municipality, COUNT(DISTINCT m.id)::int AS total,
            COUNT(DISTINCT m.id) FILTER (WHERE COALESCE(m.nlp_sentiment, m.bw_sentiment) = 'negativo')::int AS negative
       FROM mentions m JOIN mention_municipalities mm ON mm.mention_id = m.id JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1 AND m.is_duplicate = false AND ${rangeSql('m', '$2', '$3')}
      GROUP BY mu.id, mu.name ORDER BY negative DESC, total DESC LIMIT 10`, [agency.id, startDate, endDate]);
  const topAuthors = await client.query(
    `SELECT author, COUNT(*)::int AS mentions,
            (SELECT COALESCE(m2.nlp_sentiment, m2.bw_sentiment) FROM mentions m2
              WHERE m2.agency_id = $1 AND m2.author = m.author AND m2.is_duplicate = false AND ${rangeSql('m2', '$2', '$3')}
              GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1) AS dominant_sentiment
       FROM mentions m
      WHERE agency_id = $1 AND is_duplicate = false AND author IS NOT NULL AND author <> '' AND ${rangeSql('m', '$2', '$3')}
      GROUP BY author ORDER BY mentions DESC LIMIT 8`, [agency.id, startDate, endDate]);
  const topSources = await client.query(
    `SELECT COALESCE(content_source_name, domain) AS source, COUNT(*)::int AS mentions FROM mentions m
      WHERE agency_id = $1 AND is_duplicate = false AND ${rangeSql('m', '$2', '$3')} AND COALESCE(content_source_name, domain) IS NOT NULL
      GROUP BY source ORDER BY mentions DESC LIMIT 8`, [agency.id, startDate, endDate]);
  const emotions = await client.query(
    `SELECT emo::text AS emotion, COUNT(*)::int AS cnt FROM mentions m, jsonb_array_elements_text(COALESCE(m.nlp_emotions, '[]'::jsonb)) AS emo
      WHERE m.agency_id = $1 AND m.is_duplicate = false AND ${rangeSql('m', '$2', '$3')}
      GROUP BY emo ORDER BY cnt DESC LIMIT 6`, [agency.id, startDate, endDate]);
  return {
    periodStart: startDate, periodEnd: endDate, agencyName: agency.name, agencyShortName: agencyShortName(agency.slug),
    totals: sentimentReport.totals, deltaVsPrevWeek: sentimentReport.deltaVsPrev,
    dailySeries: sentimentReport.dailySeries.map((d: any) => ({ date: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive })),
    byTopic,
    byMunicipality: byMuni.rows.map((r: any) => ({ municipality: r.municipality, total: r.total, negative: r.negative })),
    topAuthors: topAuthors.rows.map((r: any) => ({ author: r.author, mentions: r.mentions, sentiment: normalizeSentiment(r.dominant_sentiment) ?? 'neutral' })),
    topSources: topSources.rows.map((r: any) => ({ source: r.source, mentions: r.mentions })),
    topEmotions: emotions.rows.map((r: any) => ({ emotion: String(r.emotion).replace(/^"|"$/g, ''), count: r.cnt })),
  };
}

async function loadSamples(agencyId: string, startDate: string, endDate: string) {
  const result: Record<string, any[]> = { negative: [], neutral: [], positive: [] };
  const map: Record<string, string> = { negative: 'negativo', neutral: 'neutral', positive: 'positivo' };
  for (const key of Object.keys(result)) {
    const r = await client.query(
      `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name, m.url,
              m.page_type, m.engagement_score, m.nlp_pertinence, m.nlp_emotions,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment, t.name AS topic, s.name AS subtopic, mu.name AS municipality
         FROM mentions m
         LEFT JOIN LATERAL (SELECT topic_id, subtopic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1) mt ON true
         LEFT JOIN topics t ON t.id = mt.topic_id
         LEFT JOIN subtopics s ON s.id = mt.subtopic_id
         LEFT JOIN LATERAL (SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1) mm ON true
         LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
        WHERE m.agency_id = $1 AND m.is_duplicate = false AND ${rangeSql('m', '$2', '$3')}
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = $4 AND m.nlp_pertinence IN ('alta','media')
        ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC LIMIT 20`,
      [agencyId, startDate, endDate, map[key]]);
    result[key] = r.rows.map((row: any) => ({
      id: row.id, createdAt: (row.published_at as Date).toISOString(),
      text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
      sentiment: key, topic: row.topic, subtopic: row.subtopic, municipality: row.municipality, author: row.author,
      source: row.content_source_name, url: row.url, pageType: row.page_type,
      engagement: row.engagement_score != null ? Number(row.engagement_score) : null,
      pertinence: row.nlp_pertinence ?? null, emotions: Array.isArray(row.nlp_emotions) ? row.nlp_emotions : [],
    }));
  }
  return result;
}

async function loadTodaySamples(agencyId: string, todayYmd: string) {
  const r = await client.query(
    `SELECT m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name, m.url, m.page_type, m.pub_type, m.engagement_score,
            COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment, t.name AS topic, mu.name AS municipality
       FROM mentions m
       LEFT JOIN LATERAL (SELECT topic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1) mt ON true
       LEFT JOIN topics t ON t.id = mt.topic_id
       LEFT JOIN LATERAL (SELECT municipality_id FROM mention_municipalities WHERE mention_id = m.id LIMIT 1) mm ON true
       LEFT JOIN municipalities mu ON mu.id = mm.municipality_id
      WHERE m.agency_id = $1 AND m.is_duplicate = false AND m.nlp_pertinence IN ('alta','media') AND ${rangeSql('m', '$2', '$2')}
      ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC LIMIT 20`, [agencyId, todayYmd]);
  return r.rows.map((row: any) => ({
    id: row.id, createdAt: (row.published_at as Date).toISOString(),
    text: `${row.title ? row.title + ' — ' : ''}${row.snippet ?? ''}`.trim(),
    sentiment: row.sentiment === 'negativo' ? 'negative' : row.sentiment === 'positivo' ? 'positive' : 'neutral',
    topic: row.topic, municipality: row.municipality, source: row.content_source_name,
    // campos extra SOLO para diagnóstico (el lambda NO los manda al modelo):
    _pubType: row.pub_type, _pageType: row.page_type, _url: row.url, _engagement: row.engagement_score, _title: row.title, _snippet: row.snippet,
  }));
}

// ---------- Bedrock (CLI) con los mismos tool schemas del lambda ----------
const TOOLS: Record<string, any> = {
  daily: {
    name: 'submit_daily_summary',
    description: 'Entrega el lede del correo diario: titular, párrafo que explica, y viñetas que también explican.',
    input_schema: { type: 'object', properties: {
      headline: { type: 'string', description: 'Titular de 8 a 16 palabras, con sujeto y verbo, sin cifras y sin punto final.' },
      paragraph: { type: 'string', description: 'De 3 a 4 oraciones (60–90 palabras) explicando qué pasó, a raíz de qué y quién lo dice. Máximo dos cifras.' },
      highlights: { type: 'array', items: { type: 'string' }, description: '2 a 4 viñetas; cada una cuenta un hecho con su cifra de apoyo, nunca una cifra con etiqueta.' },
    }, required: ['headline', 'paragraph', 'highlights'], additionalProperties: false },
  },
  insights: {
    name: 'submit_weekly_insights',
    description: 'Entrega los insights por sentimiento como tres arrays de cadenas.',
    input_schema: { type: 'object', properties: {
      negative: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque negativo.' },
      neutral: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque neutral.' },
      positive: { type: 'array', items: { type: 'string' }, description: '0–2 insights del bloque positivo.' },
    }, required: ['negative', 'neutral', 'positive'], additionalProperties: false },
  },
};
function sleep(ms: number) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function invokeTool(system: string, user: string, tool: any, modelId: string, maxTokens = 1500): any {
  const body = join(tmp, `body-${Math.random().toString(36).slice(2)}.json`);
  const out = body.replace('body-', 'out-');
  writeFileSync(body, JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], temperature: 0, tools: [tool], tool_choice: { type: 'tool', name: tool.name } }));
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      execFileSync('aws', ['bedrock-runtime', 'invoke-model', '--model-id', modelId, '--content-type', 'application/json', '--accept', 'application/json', '--cli-binary-format', 'raw-in-base64-out', '--cli-read-timeout', '300', '--body', `fileb://${body}`, out], { stdio: ['ignore', 'pipe', 'pipe'] });
      const resp = JSON.parse(readFileSync(out, 'utf8'));
      const tu = (resp.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === tool.name);
      if (!tu) throw new Error('sin tool_use');
      return tu.input;
    } catch (e: any) {
      lastErr = String(e?.stderr ?? e?.message ?? e).slice(0, 300);
      if (/Throttl|TooMany|ServiceUnavailable/i.test(lastErr)) { sleep(4000 * (attempt + 1)); continue; }
      break;
    }
  }
  throw new Error(`Bedrock falló (${modelId}): ${lastErr}`);
}
function llm(system: string, user: string, tool: any): any {
  try { return invokeTool(system, user, tool, MODEL); } catch (e) {
    console.error(String(e)); return invokeTool(system, user, tool, FALLBACK);
  }
}

// ---------- main ----------
async function main() {
  const imp = (rel: string) => import(pathToFileURL(join(SH, rel)).href);
  const { addDaysYmd } = await imp('dates.ts');
  const { buildSentimentReport } = await imp('aggregations/sentiment-report.ts');
  const { buildSentimentInsightsPrompt, buildDailySummaryPrompt, INSIGHTS_SYSTEM_PROMPT } = await imp('prompts/weekly-report-insights.ts');
  const { formatPromptDayOfInstant } = await imp('format-period.ts');

  const ag = (await client.query(`SELECT id, slug, name FROM agencies WHERE slug = $1`, [slug])).rows[0];
  if (!ag) throw new Error(`agencia ${slug} no existe`);
  const startYmd = addDaysYmd(endYmd, -6);
  const prevEnd = addDaysYmd(startYmd, -1);
  const prevStart = addDaysYmd(prevEnd, -6);

  const report = await buildSentimentReport(client, ag.id, startYmd, endYmd, prevStart, prevEnd);
  const aggregates = await buildAggregates(ag, startYmd, endYmd, report);
  const samples = await loadSamples(ag.id, startYmd, endYmd);
  const todaySamples = await loadTodaySamples(ag.id, endYmd);
  // el lambda pasa MentionSample (sin los campos _diagnóstico) al prompt:
  const clean = (s: any) => { const { _pubType, _pageType, _url, _engagement, _title, _snippet, ...rest } = s; return rest; };
  const dailyUser = buildDailySummaryPrompt(aggregates, todaySamples.map(clean), endYmd);
  const insightsUser = buildSentimentInsightsPrompt(aggregates, samples);

  const result: any = {
    agency: ag, mode: { dayMode, model: MODEL }, window: { startYmd, endYmd, prevStart, prevEnd },
    totals: report.totals, deltaVsPrev: report.deltaVsPrev, dailySeries: report.dailySeries,
    topics: report.topicsTable.slice(0, 8), aggregates, samples, todaySamples,
    prompts: { system: INSIGHTS_SYSTEM_PROMPT, dailyUser, insightsUser },
  };

  if (wantLlm) {
    const d = invokeOrNull('daily', INSIGHTS_SYSTEM_PROMPT, dailyUser);
    const i = invokeOrNull('insights', INSIGHTS_SYSTEM_PROMPT, insightsUser);
    result.llm = {
      daily: d ? { headline: String(d.headline ?? '').trim(), paragraph: String(d.paragraph ?? '').trim(), highlights: coerceBulletList(d.highlights, 4) } : null,
      insights: i ? { negative: coerceBulletList(i.negative, 2), neutral: coerceBulletList(i.neutral, 2), positive: coerceBulletList(i.positive, 2) } : null,
    };
  }
  function invokeOrNull(kind: 'daily' | 'insights', sys: string, usr: string) {
    try { return llm(sys, usr, TOOLS[kind]); } catch (e) { console.error(`LLM ${kind}:`, String(e)); return null; }
  }

  if (outFile) writeFileSync(outFile, JSON.stringify(result, null, 1));
  if (quiet) return;
  const p = (s: string) => console.log(s);
  p(`AGENCIA ${slug} · ventana PR ${startYmd} → ${endYmd} (prev ${prevStart} → ${prevEnd}) · day-mode=${dayMode}`);
  p(`TOTALES: neg ${report.totals.negative} · neu ${report.totals.neutral} · pos ${report.totals.positive} · total ${report.totals.total}`);
  p(`SERIE DIARIA: ${report.dailySeries.map((d: any) => `${d.date.slice(5)}=${d.negative + d.neutral + d.positive}(n${d.negative}/p${d.positive})`).join('  ')}`);
  p(`\nMUESTRAS DEL ÚLTIMO DÍA (${endYmd}) que ve el LLM para titular/párrafo/viñetas [${todaySamples.length}]:`);
  todaySamples.forEach((s: any, k: number) => p(`  ${k + 1}. ${formatPromptDayOfInstant(s.createdAt)} ${s.createdAt.slice(11, 16)}Z | ${s._pubType ?? s._pageType} | ${s.sentiment} | eng=${s._engagement ?? 0} | ${s.text.replace(/\s+/g, ' ').slice(0, 150)}`));
  if (result.llm) {
    p(`\nLLM — TITULAR: ${result.llm.daily?.headline}\nPÁRRAFO: ${result.llm.daily?.paragraph}`);
    (result.llm.daily?.highlights ?? []).forEach((h: string, k: number) => p(`  • ${k + 1}. ${h}`));
    p(`INSIGHTS NEG: ${(result.llm.insights?.negative ?? []).join(' || ')}\nINSIGHTS NEU: ${(result.llm.insights?.neutral ?? []).join(' || ')}\nINSIGHTS POS: ${(result.llm.insights?.positive ?? []).join(' || ')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
