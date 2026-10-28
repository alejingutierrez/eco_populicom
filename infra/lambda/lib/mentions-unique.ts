/**
 * Cambia la unicidad de `mentions` de `bw_resource_id` (global) a
 * (agency_id, bw_resource_id). Motivo y contexto: lib/mention-keys.ts y la
 * migración 0012. Lo invoca la acción `mentions-unique-per-agency` de
 * eco-migration; vive aquí, sin dependencias, para poder probarlo contra un
 * Postgres real.
 *
 * TRES pasos y el ORDEN importa — el processor nuevo necesita el índice nuevo
 * (ON CONFLICT lo infiere) y el viejo necesita el global; el global solo se
 * suelta DESPUÉS de desplegar el processor:
 *   1) phase 'add'   → crea el índice por agencia (inofensivo, reversible)
 *   2) (desplegar eco-processor)
 *   3) phase 'drop'  → suelta el UNIQUE global y su duplicado parcial
 * `status` (default) no escribe nada: lista los índices y cuenta choques.
 */

export interface Queryable {
  query(sql: string): Promise<{ rows: any[] }>;
}

export const AGENCY_RESOURCE_INDEX = 'mentions_agency_bw_resource_uq';

export async function mentionsUniquePerAgency(
  client: Queryable,
  phase: string,
): Promise<{ statusCode: number; body: string }> {
  const respond = (statusCode: number, payload: Record<string, unknown>) =>
    ({ statusCode, body: JSON.stringify(payload, null, 2) });

  const listIndexes = async () => (await client.query(
    `SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'mentions'::regclass AND i.indisunique
      ORDER BY c.relname`,
  )).rows;
  const listConstraints = async () => (await client.query(
    `SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'mentions'::regclass AND contype = 'u' ORDER BY conname`,
  )).rows;

  const out: Record<string, unknown> = { phase };

  if (phase === 'add') {
    // Choques (agencia, resourceId): deben ser 0 o el índice no se crea. Con el
    // UNIQUE global vigente siempre lo son.
    const clash = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM mentions WHERE bw_resource_id IS NOT NULL
          GROUP BY agency_id, bw_resource_id HAVING count(*) > 1) x`,
    );
    out.clashes = clash.rows[0].n;
    if (clash.rows[0].n > 0) {
      return respond(409, { ...out, error: 'hay (agency_id, bw_resource_id) repetidos; no se crea el índice' });
    }
    await client.query(`SET lock_timeout = '10s'`);
    // No CONCURRENTLY (no corre dentro de una transacción y mentions tiene
    // ~140k filas: el SHARE lock dura menos de un segundo).
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${AGENCY_RESOURCE_INDEX} ON mentions (agency_id, bw_resource_id)`);
  } else if (phase === 'drop') {
    // Guarda: no soltar el global si el nuevo no existe o quedó inválido.
    const ok = (await listIndexes()).find((r) => r.name === AGENCY_RESOURCE_INDEX && r.valid);
    if (!ok) {
      return respond(409, { ...out, error: `falta el índice ${AGENCY_RESOURCE_INDEX} (corre phase 'add' primero)` });
    }
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      // El constraint arrastra su índice de respaldo; el parcial es un duplicado
      // exacto que dejó un intento anterior.
      await client.query(`ALTER TABLE mentions DROP CONSTRAINT IF EXISTS mentions_bw_resource_id_key`);
      await client.query(`DROP INDEX IF EXISTS mentions_bw_resource_id_partial_unique`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } else if (phase !== 'status') {
    return respond(400, { ...out, error: "phase debe ser 'status' | 'add' | 'drop'" });
  }

  // Estado final SIEMPRE: eco-migration responde "success" a acciones
  // desconocidas, así que lo que prueba el cambio es esta lista, no el statusCode.
  out.uniqueIndexes = await listIndexes();
  out.uniqueConstraints = await listConstraints();
  return respond(200, out);
}
