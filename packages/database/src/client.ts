import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export type Db = ReturnType<typeof getDb>;

/**
 * Set RLS context for the current transaction.
 * Must be called within a transaction before any tenant-scoped queries.
 */
export async function setAgencyContext(db: Db, agencyId: string): Promise<void> {
  await db.execute(
    `SET LOCAL app.current_agency_id = '${agencyId}'`,
  );
}

export { schema };
