/**
 * Panel de calidad de la interpretación (WP-9b, spec interpretación v1 11.7):
 * lo que ya se puede medir HOY con la tabla `mentions` y el archivo de envíos
 * (`report_send_log`), por agencia y ventana:
 *
 *   - pertinencia (alta / media / baja / pendiente): cuántas quedan fuera del
 *     universo estricto por no estar clasificadas;
 *   - versión de la rúbrica (`nlp_prompt_version`): cuántas menciones ya tienen
 *     la rúbrica nueva;
 *   - resolución de padres: comentarios cuya publicación original está guardada
 *     (`parent_mention_id`), por plataforma;
 *   - cobertura de texto completo de las notas (`full_text`);
 *   - defectos de QA, frases removidas por la red de seguridad y archivo de
 *     cada envío, leídos de `report_send_log.composition` (los escribe el motor
 *     de redacción: vacíos hasta que el lambda lo use).
 *
 * Cada bloque son filas `{ label, value, detail? }`. `null` = el bloque no se
 * pudo medir (error de consulta, columna ausente); `[]` = se midió y no hay nada.
 * Los constructores de filas son puros para probarlos sin base de datos.
 */
import { prWindowSql, type PgClientLike } from '@eco/shared';
import { kindExprForPool } from '@/lib/mentions/composition';
import type { MentionKindAgency } from '@/lib/mentions/kind';
import { log } from '@/lib/log';

export const QUALITY_KEYS = [
  'nullPertinence', 'promptVersions', 'parentResolution', 'fullTextCoverage', 'qaDefects', 'safetyNet', 'composerArchive',
] as const;
export type QualityKey = (typeof QUALITY_KEYS)[number];

export interface QualityRow { label: string; value: number | string; detail?: string }

export interface QualityPayload {
  window: { startYmd: string; endYmd: string };
  /** Menciones no duplicadas de la ventana (la base de las distribuciones). */
  mentionsInWindow: number;
  blocks: Record<QualityKey, QualityRow[] | null>;
}

const nf = (n: number) => n.toLocaleString('es-PR');
const pctOf = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toLocaleString('es-PR', { maximumFractionDigits: 1 })} %` : '—');

// ---------------------------------------------------------------- filas (puras)

export function pertinenceRows(rows: Array<{ k: string | null; n: number }>, total: number): QualityRow[] {
  if (total <= 0) return [];
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.k ?? '__null', (by.get(r.k ?? '__null') ?? 0) + r.n);
  const spec: Array<[string, string, string]> = [
    ['alta', 'Alta', 'dentro del universo'],
    ['media', 'Media', 'dentro del universo'],
    ['baja', 'Baja', 'fuera del universo en gráficos, conteos y correos'],
    ['__null', 'Pendiente (sin pertinencia)', 'fuera del universo estricto hasta que el processor las clasifique; el universo histórico las cuenta'],
  ];
  return spec.map(([k, label, note]) => ({ label, value: by.get(k) ?? 0, detail: `${pctOf(by.get(k) ?? 0, total)} · ${note}` }));
}

export function promptVersionRows(rows: Array<{ v: string | null; n: number }>, total: number): QualityRow[] {
  if (total <= 0) return [];
  return [...rows]
    .sort((a, b) => b.n - a.n)
    .map((r) => ({
      label: r.v ?? 'Rúbrica anterior (sin versión)',
      value: r.n,
      detail: `${pctOf(r.n, total)} de las menciones`,
    }));
}

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

export function parentRows(rows: Array<{ platform: string | null; comments: number; resolved: number }>): QualityRow[] {
  const live = rows.filter((r) => r.comments > 0);
  if (live.length === 0) return [];
  const out: QualityRow[] = [...live]
    .sort((a, b) => b.comments - a.comments)
    .map((r) => {
      const p = (r.platform ?? '').toLowerCase();
      return {
        label: PLATFORM_LABEL[p] ?? (p || 'Otra plataforma'),
        value: `${nf(r.resolved)} de ${nf(r.comments)}`,
        detail: `${pctOf(r.resolved, r.comments)} con la publicación original guardada`,
      };
    });
  if (live.length > 1) {
    const c = live.reduce((s, r) => s + r.comments, 0), k = live.reduce((s, r) => s + r.resolved, 0);
    out.push({ label: 'Total', value: `${nf(k)} de ${nf(c)}`, detail: `${pctOf(k, c)} con la publicación original guardada` });
  }
  return out;
}

export function fullTextRows(c: { articles: number; withText: number; failed: number; never: number }): QualityRow[] {
  if (c.articles <= 0) return [];
  return [
    { label: 'Con texto completo', value: c.withText, detail: `${pctOf(c.withText, c.articles)} de ${nf(c.articles)} notas de prensa, blogs y foros` },
    { label: 'Intentadas sin éxito', value: c.failed, detail: `${pctOf(c.failed, c.articles)} · sitio bloqueado, de pago o sin cuerpo extraíble` },
    { label: 'Sin intentar todavía', value: c.never, detail: pctOf(c.never, c.articles) },
  ];
}

export interface SendArchiveRow {
  sentAt: string | Date;
  templateKey: string;
  status: string;
  qaDefects: number;
  removed: number;
  composerVersion: string | null;
  subject: string | null;
  degraded: boolean;
}

/** «2 nov, 6:00 a. m.» en hora de Puerto Rico. */
export function prStamp(at: string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PR', { timeZone: 'America/Puerto_Rico', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).replace('.', '');
}

export function sendRows(rows: SendArchiveRow[]): { qaDefects: QualityRow[]; safetyNet: QualityRow[]; composerArchive: QualityRow[] } {
  const lab = (r: SendArchiveRow) => `${r.templateKey.startsWith('weekly') ? 'Semanal' : 'Diario'} · ${prStamp(r.sentAt)}`;
  return {
    qaDefects: rows.map((r) => ({ label: lab(r), value: r.qaDefects, detail: r.qaDefects === 0 ? 'sin defectos' : 'detectados antes del envío' })),
    safetyNet: rows.map((r) => ({ label: lab(r), value: r.removed, detail: r.removed === 0 ? 'ninguna frase removida' : 'frases que no se pudieron verificar' })),
    composerArchive: rows.map((r) => ({
      label: lab(r),
      value: r.composerVersion ?? '—',
      detail: [r.status, r.degraded ? 'degradado' : null, r.subject].filter(Boolean).join(' · '),
    })),
  };
}

// ---------------------------------------------------------------- consultas

async function safe<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (err) {
    log.warn('quality', 'bloque no medido', { block: name, msg: (err as Error).message });
    return null;
  }
}

const WINDOW = `mentions.agency_id = $1 AND mentions.is_duplicate = false ${prWindowSql('mentions.')}`;
const jlen = (path: string) => `CASE WHEN jsonb_typeof(${path}) = 'array' THEN jsonb_array_length(${path}) ELSE 0 END`;

export async function loadQuality(
  pool: PgClientLike,
  agencyId: string,
  agency: MentionKindAgency | null,
  win: { startYmd: string; endYmd: string },
): Promise<QualityPayload> {
  const p = [agencyId, win.startYmd, win.endYmd];
  const [pert, ver, par, txt, sends] = await Promise.all([
    safe('pertinence', async () => (await pool.query<{ k: string | null; n: number | string }>(
      `SELECT mentions.nlp_pertinence AS k, COUNT(*)::int AS n FROM mentions WHERE ${WINDOW} GROUP BY 1`, p)).rows.map((r) => ({ k: r.k, n: Number(r.n) }))),
    safe('promptVersions', async () => (await pool.query<{ v: string | null; n: number | string }>(
      `SELECT mentions.nlp_prompt_version AS v, COUNT(*)::int AS n FROM mentions WHERE ${WINDOW} GROUP BY 1`, p)).rows.map((r) => ({ v: r.v, n: Number(r.n) }))),
    safe('parentResolution', async () => {
      const k = kindExprForPool(agency, 3);
      const r = await pool.query<{ platform: string | null; comments: number | string; resolved: number | string }>(
        `SELECT lower(mentions.page_type) AS platform, COUNT(*)::int AS comments,
                COUNT(*) FILTER (WHERE mentions.parent_mention_id IS NOT NULL)::int AS resolved
           FROM mentions WHERE ${WINDOW} AND ${k.text} = 'comment' GROUP BY 1`, [...p, ...k.params]);
      return r.rows.map((x) => ({ platform: x.platform, comments: Number(x.comments), resolved: Number(x.resolved) }));
    }),
    safe('fullText', async () => {
      const r = await pool.query<{ articles: number | string; with_text: number | string; failed: number | string; never: number | string }>(
        `SELECT COUNT(*)::int AS articles,
                COUNT(*) FILTER (WHERE mentions.full_text IS NOT NULL)::int AS with_text,
                COUNT(*) FILTER (WHERE mentions.full_text IS NULL AND mentions.full_text_fetched_at IS NOT NULL)::int AS failed,
                COUNT(*) FILTER (WHERE mentions.full_text IS NULL AND mentions.full_text_fetched_at IS NULL)::int AS never
           FROM mentions WHERE ${WINDOW} AND lower(coalesce(mentions.page_type, '')) IN ('news', 'blog', 'forum')`, p);
      const x = r.rows[0];
      return { articles: Number(x?.articles ?? 0), withText: Number(x?.with_text ?? 0), failed: Number(x?.failed ?? 0), never: Number(x?.never ?? 0) };
    }),
    safe('sends', async () => (await pool.query<{
      sent_at: string | Date; template_key: string; status: string; qa_defects: number | string; removed: number | string;
      composer_version: string | null; subject: string | null; degraded: boolean | null;
    }>(
      `SELECT sent_at, template_key, status,
              (${jlen("composition->'qa'->'agent'")}) + (${jlen("composition->'qa'->'code'")}) AS qa_defects,
              (${jlen("composition->'safetyNetLog'")}) AS removed,
              composer_version, subject,
              CASE WHEN composition->>'degraded' = 'true' THEN true ELSE false END AS degraded
         FROM report_send_log
        WHERE agency_id = $1 AND composition IS NOT NULL
        ORDER BY sent_at DESC LIMIT 14`, [agencyId])).rows.map((r) => ({
      sentAt: r.sent_at, templateKey: r.template_key, status: r.status, qaDefects: Number(r.qa_defects), removed: Number(r.removed),
      composerVersion: r.composer_version, subject: r.subject, degraded: !!r.degraded,
    }))),
  ]);

  const total = pert ? pert.reduce((s, r) => s + r.n, 0) : ver ? ver.reduce((s, r) => s + r.n, 0) : 0;
  const send = sends ? sendRows(sends) : null;
  return {
    window: win,
    mentionsInWindow: total,
    blocks: {
      nullPertinence: pert ? pertinenceRows(pert, total) : null,
      promptVersions: ver ? promptVersionRows(ver, total) : null,
      parentResolution: par ? parentRows(par) : null,
      fullTextCoverage: txt ? fullTextRows(txt) : null,
      qaDefects: send ? send.qaDefects : null,
      safetyNet: send ? send.safetyNet : null,
      composerArchive: send ? send.composerArchive : null,
    },
  };
}
