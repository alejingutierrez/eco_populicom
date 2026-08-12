import type { getPool } from '@eco/database';

/**
 * Self-heal idempotente de las tablas del chat. Igual que
 * ensureTopicDescriptionsCacheSchema en eco-topic-description: crea las tablas
 * y sus índices con IF NOT EXISTS en cada request, así el endpoint funciona en
 * cualquier DB (dev local o prod) sin depender de haber corrido la acción
 * `create-chat-schema` del lambda eco-migration. Tras la primera corrida es
 * un no-op barato.
 */
export async function ensureChatSchema(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "chat_conversations" (
      "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "agency_id"   UUID NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
      "user_sub"    VARCHAR(255) NOT NULL,
      "user_email"  VARCHAR(255),
      "title"       VARCHAR(255) NOT NULL,
      "status"      VARCHAR(32) NOT NULL DEFAULT 'active',
      "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idx_chat_conversations_agency_user"
      ON "chat_conversations" ("agency_id", "user_sub")
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idx_chat_conversations_user_updated"
      ON "chat_conversations" ("user_sub", "updated_at" DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "chat_messages" (
      "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "conversation_id"  UUID NOT NULL REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
      "role"             VARCHAR(16) NOT NULL,
      "content"          TEXT NOT NULL,
      "content_json"     JSONB,
      "model"            VARCHAR(64),
      "tokens_in"        INTEGER,
      "tokens_out"       INTEGER,
      "partial"          BOOLEAN NOT NULL DEFAULT FALSE,
      "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_created"
      ON "chat_messages" ("conversation_id", "created_at")
  `);
}

/** Deriva un título corto desde el primer mensaje del usuario. */
export function deriveConversationTitle(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Nueva conversación';
  if (clean.length <= 48) return clean;
  return clean.slice(0, 47).trimEnd() + '…';
}

/**
 * Normaliza filas de mensajes en turnos alternados (user/assistant) válidos
 * para Anthropic: empieza en `user`, sin dos roles consecutivos iguales
 * (se fusionan), y descarta un `user` final incompleto (sin respuesta) para
 * poder anexar el turno nuevo. Limita al historial reciente.
 */
export function normalizeTurns(
  rows: Array<{ role: string; content: string }>,
  maxTurns = 12,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const r of rows) {
    const role: 'user' | 'assistant' = r.role === 'assistant' ? 'assistant' : 'user';
    const content = (r.content ?? '').trim();
    if (!content) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content += '\n\n' + content;
    } else {
      turns.push({ role, content });
    }
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  while (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  return turns.slice(-maxTurns);
}
