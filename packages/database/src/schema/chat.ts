import { pgTable, uuid, varchar, text, jsonb, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { agencies } from './agencies';

/**
 * chat_conversations — un hilo de chat contextual por usuario (estilo ChatGPT).
 *
 * El dueño se identifica por su Cognito `sub` (inmutable) en vez de un FK a
 * users.id, para no depender del aprovisionamiento JIT de la fila `users` (que
 * exige role + agencyId NOT NULL). El scope de agencia permite listar solo los
 * hilos de la agencia activa en el switcher.
 */
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agencyId: uuid('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
    /** Cognito `sub` del dueño del hilo. Clave de usuario (no FK a users). */
    userSub: varchar('user_sub', { length: 255 }).notNull(),
    userEmail: varchar('user_email', { length: 255 }),
    title: varchar('title', { length: 255 }).notNull(),
    /** 'active' · 'archived' */
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_chat_conversations_agency_user').on(t.agencyId, t.userSub),
    index('idx_chat_conversations_user_updated').on(t.userSub, t.updatedAt.desc()),
  ],
);

/**
 * chat_messages — mensajes de cada hilo. `content` es el texto plano (pregunta
 * del usuario o respuesta del asistente); `content_json` guarda el snapshot del
 * contexto de la vista que vio el modelo (para mensajes `user`) y metadatos.
 * Borra en cascada con su conversación.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    /** 'user' · 'assistant' */
    role: varchar('role', { length: 16 }).notNull(),
    content: text('content').notNull(),
    contentJson: jsonb('content_json').$type<{
      viewContext?: Record<string, unknown>;
      period?: string;
      screen?: string;
      filters?: Record<string, unknown> | null;
    }>(),
    model: varchar('model', { length: 64 }),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** true si el stream se cortó antes de terminar (cliente desconectado). */
    partial: boolean('partial').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_chat_messages_conversation_created').on(t.conversationId, t.createdAt),
  ],
);
