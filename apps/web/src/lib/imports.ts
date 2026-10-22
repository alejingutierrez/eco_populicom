/**
 * Importación de exportes de menciones desde Configuración → Importar
 * menciones. El web solo sube el archivo a S3 y le habla a eco-mention-import
 * (que hace el ETL completo y guarda el avance en `mention_import_jobs`); aquí
 * viven el gate, la lista de agencias que aceptan importaciones y la forma
 * JSON de una importación, compartidos por las dos rutas.
 */
import { NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getDb } from '@eco/database';
import { sql } from 'drizzle-orm';
import { isImportQueryId } from '@eco/shared';
import { requireCapability } from '@/lib/auth/require-admin';
import { filterAgenciesForCaller, resolveAllowedAgencySlugs } from '@/lib/agency';

const lambda = new LambdaClient({});
export const IMPORT_FUNCTION = process.env.MENTION_IMPORT_FUNCTION ?? 'eco-mention-import';
export const RAW_BUCKET = process.env.RAW_BUCKET ?? 'eco-raw-863956448838';

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] })?.rows ?? []) as T[];
}

export interface ImportableAgency { slug: string; name: string }

/** Agencias activas con un query de importación (negativo) que el llamante puede ver. */
export async function listImportableAgencies(): Promise<ImportableAgency[]> {
  const rows = rowsOf<{ slug: string; name: string; brandwatch_query_ids: number[] | null }>(await getDb().execute(sql`
    SELECT slug, name, brandwatch_query_ids FROM agencies WHERE is_active = true ORDER BY name
  `));
  const importable = rows
    .filter((a) => (a.brandwatch_query_ids ?? []).map(Number).some(isImportQueryId))
    .map((a) => ({ slug: a.slug, name: a.name }));
  const allowed = await resolveAllowedAgencySlugs();
  const scoped = allowed === null ? importable : importable.filter((a) => allowed.includes(a.slug));
  return filterAgenciesForCaller(scoped);
}

/**
 * Gate de las rutas: capacidad `import_mentions` (solo admin) y, si se pasa
 * agencia, que sea una importable que el llamante ve.
 */
export async function gateImports(agencySlug?: string | null) {
  const auth = await requireCapability('import_mentions');
  if (!auth.ok) return auth;
  if (agencySlug) {
    const agencies = await listImportableAgencies();
    if (!agencies.some((a) => a.slug === agencySlug)) {
      return { ok: false as const, response: NextResponse.json({ error: 'Esa agencia no recibe importaciones o no la puedes ver.' }, { status: 403 }) };
    }
  }
  return auth;
}

/** La tabla la crea el lambda en su primer arranque: antes de eso, no hay historial. */
export async function tableExists(): Promise<boolean> {
  const rows = rowsOf<{ t: string | null }>(await getDb().execute(sql`SELECT to_regclass('public.mention_import_jobs')::text AS t`));
  return Boolean(rows[0]?.t);
}

export interface ImportJson {
  id: string;
  agencySlug: string;
  fileName: string;
  uploadedBy: string | null;
  status: string;
  summary: Record<string, unknown> | null;
  detail: Record<string, unknown>;
  total: number;
  enqueued: number;
  processed: number;
  dateFrom: string | null;
  dateTo: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export function importToJson(r: Record<string, unknown>): ImportJson {
  return {
    id: String(r.id),
    agencySlug: String(r.agency_slug),
    fileName: String(r.file_name),
    uploadedBy: (r.uploaded_by as string | null) ?? null,
    status: String(r.status),
    summary: (r.summary as Record<string, unknown> | null) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    total: Number(r.total ?? 0),
    enqueued: Number(r.enqueued ?? 0),
    processed: Number(r.processed ?? 0),
    dateFrom: iso(r.date_from),
    dateTo: iso(r.date_to),
    error: (r.error as string | null) ?? null,
    createdAt: iso(r.created_at)!,
    startedAt: iso(r.started_at),
    updatedAt: iso(r.updated_at)!,
    finishedAt: iso(r.finished_at),
  };
}

export async function getImportRow(id: string): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await tableExists())) return null;
  return rowsOf<Record<string, unknown>>(await getDb().execute(sql`SELECT * FROM mention_import_jobs WHERE id = ${id}::uuid`))[0] ?? null;
}

/** Invocación síncrona de eco-mention-import. Errores del ETL vuelven como `{ error }`. */
export async function invokeImport(payload: Record<string, unknown>): Promise<{ import?: Record<string, unknown>; error?: string }> {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: IMPORT_FUNCTION,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const out = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString('utf8')) : null;
  if (res.FunctionError) return { error: out?.errorMessage ?? 'El lambda de importación falló' };
  return out ?? { error: 'Sin respuesta del lambda de importación' };
}
