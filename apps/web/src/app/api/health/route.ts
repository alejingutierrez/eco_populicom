import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { sql } from 'drizzle-orm';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: 'ok',
      service: 'eco-web',
      database: 'reachable',
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    log.error('health', 'db probe failed', { err: (err as Error).message });
    return NextResponse.json({
      status: 'degraded',
      service: 'eco-web',
      database: 'unreachable',
      error: (err as Error).message,
      latencyMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
