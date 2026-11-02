// Acceso al asesor de crisis (spec §0.4 D1 y D2, §9). Defaults del spec: solo staff de
// Populicom hasta pasar la evaluación, y solo las agencias ddecpr, gobernadora y df.

/** Dominio del staff de Populicom (mismo criterio que lib/agency.ts). */
export const STAFF_EMAIL_DOMAIN = '@populicom.com';

const DEFAULT_AGENCIES = ['ddecpr', 'gobernadora', 'df'];

type Env = Record<string, string | undefined>;

/** `ADVISOR_STAFF_ONLY`: true por defecto. Solo `false` (literal) abre el asesor a más usuarios. */
export function advisorStaffOnly(env: Env = process.env): boolean {
  return (env.ADVISOR_STAFF_ONLY ?? 'true').trim().toLowerCase() !== 'false';
}

/** `ADVISOR_AGENCIES`: lista separada por comas de slugs. Sin variable, usa el default del spec. */
export function advisorAgencies(env: Env = process.env): string[] {
  const raw = env.ADVISOR_AGENCIES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_AGENCIES;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAdvisorStaff(user: { email?: string | null }): boolean {
  return (user.email ?? '').trim().toLowerCase().endsWith(STAFF_EMAIL_DOMAIN);
}

/**
 * ¿Puede este usuario usar el asesor con esta agencia? La capacidad `advise` se exige aparte
 * (requireCapability). Aquí van el filtro de staff y la lista de agencias.
 */
export function advisorAllowed(
  user: { email?: string | null },
  agencySlug: string,
  env: Env = process.env,
): { ok: true } | { ok: false; reason: 'staff_only' | 'agency_not_enabled' } {
  if (advisorStaffOnly(env) && !isAdvisorStaff(user)) return { ok: false, reason: 'staff_only' };
  if (!advisorAgencies(env).includes(agencySlug.toLowerCase())) return { ok: false, reason: 'agency_not_enabled' };
  return { ok: true };
}
