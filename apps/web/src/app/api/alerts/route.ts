import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { alertRules } from '@eco/database';
import { sql } from 'drizzle-orm';

export async function GET() {
  const db = getDb();

  try {
    const rules = await db
      .select()
      .from(alertRules)
      .orderBy(sql`${alertRules.createdAt} DESC`);

    return NextResponse.json({
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        config: r.config,
        notifyEmails: r.notifyEmails,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error('Alerts API error:', err);
    return NextResponse.json({ rules: [] });
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();

  try {
    const [rule] = await db
      .insert(alertRules)
      .values({
        agencyId: body.agencyId,
        name: body.name,
        description: body.description,
        config: body.config,
        notifyEmails: body.notifyEmails ?? [],
      })
      .returning();

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    console.error('Create alert error:', err);
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
