import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function buildConnectionString(): string {
  // Option 1: Direct DATABASE_URL
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Option 2: Build from DB_SECRET (ECS injects Secrets Manager JSON)
  if (process.env.DB_SECRET) {
    const secret = JSON.parse(process.env.DB_SECRET);
    return `postgresql://${secret.username}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.dbname}`;
  }

  throw new Error('DATABASE_URL or DB_SECRET environment variable is required');
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: buildConnectionString(),
      ssl: { rejectUnauthorized: false },
      max: 15,
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
 */
export async function setAgencyContext(db: Db, agencyId: string): Promise<void> {
  await db.execute(
    `SET LOCAL app.current_agency_id = '${agencyId}'`,
  );
}

export { schema };
