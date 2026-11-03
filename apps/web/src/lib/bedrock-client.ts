/**
 * Cliente singleton de Bedrock Runtime para los endpoints AI del scorecard
 * (`/api/ai/*`). Las credenciales vienen del task role de ECS en producción
 * o de `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` en dev local.
 *
 * El módulo se importa con `await import(...)` desde el endpoint para que
 * el bundler de Next.js NO traiga `@aws-sdk/client-bedrock-runtime` al
 * grafo de páginas (es de uso server-only). Por la misma razón
 * `packages/shared/src/index.ts` no re-exporta bedrock.ts.
 *
 * Desde WP-8 (nov-2026) también trae lo que el motor de redacción necesita en
 * las rutas web (cliente LLM y capa de datos de las muestras), por la misma
 * razón: el adaptador del motor arrastra el SDK de Bedrock.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockComposerLlm } from '@eco/shared/src/composer/bedrock-llm';
import type { ComposerDataAccess, ComposerLlm, RawComposerSample, SampleContext } from '@eco/shared';

let cached: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (!cached) {
    cached = new BedrockRuntimeClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
  }
  return cached;
}

// ============================================================
// Motor de redacción (WP-8): cliente LLM y capa de datos de las muestras
// ============================================================
//
// Solo se cargan desde el camino con motor (`await import('@/lib/bedrock-client')`
// dentro de la rama de `COMPOSER_WEB_AGENCIES`): con la bandera vacía ninguna
// ruta toca este código.


/** Cliente del motor sobre el mismo BedrockRuntimeClient singleton. */
export function getComposerLlm(): ComposerLlm {
  return createBedrockComposerLlm(getBedrockClient());
}

/**
 * Contexto de las muestras en UNA consulta (espejo de SAMPLE_CONTEXT_SQL de
 * infra/lambda/ai-tasks/composer-surfaces.ts): tipo, GUID/URL y, para
 * comentarios, la publicación original — por `parent_mention_id` (WP-2) o,
 * si aún no está poblado, por las reglas de lib/parent-resolver.ts (FB:
 * GUID `<page>_<post>`; IG: GUID `<shortcode>`), dentro de la agencia y 60
 * días antes del comentario. Solo lee filas por id: no cuenta menciones.
 */
export const SAMPLE_CONTEXT_SQL = `
SELECT m.id, m.bw_guid, m.url, m.pub_type, m.page_type, m.author, m.title, m.snippet,
       m.mention_kind, m.parent_mention_id, m.parent_published_at,
       p.id AS p_id, p.published_at AS p_published_at, p.author AS p_author,
       COALESCE(NULLIF(p.title, ''), p.snippet) AS p_text
  FROM mentions m
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN strpos(COALESCE(m.url, ''), '#channels_comment') > 0
           THEN COALESCE(substring(m.bw_guid from '^(\\d+)_\\d+$'),
                         substring(m.url from 'facebook\\.com/(\\d+)#channels_comment_\\d+'))
      END AS fb_post,
      CASE WHEN upper(COALESCE(m.pub_type, '')) = 'INSTAGRAM_GRAPH_BUSINESS'
                AND strpos(COALESCE(m.bw_guid, ''), '#') > 0
           THEN split_part(m.bw_guid, '#', 1)
      END AS ig_code
  ) k
  LEFT JOIN LATERAL (
    SELECT q.id, q.published_at, q.author, q.title, q.snippet FROM (
      SELECT pm.id, pm.published_at, pm.author, pm.title, pm.snippet, 1 AS prio
        FROM mentions pm
       WHERE m.parent_mention_id IS NOT NULL AND pm.id = m.parent_mention_id
      UNION ALL
      SELECT pm.id, pm.published_at, pm.author, pm.title, pm.snippet, 2 AS prio
        FROM mentions pm
       WHERE m.parent_mention_id IS NULL AND k.fb_post IS NOT NULL
         AND pm.agency_id = m.agency_id
         AND pm.bw_guid LIKE '%\\_' || k.fb_post
         AND (pm.url IS NULL OR pm.url NOT LIKE '%#channels\\_comment%')
         AND pm.published_at BETWEEN m.published_at - INTERVAL '60 days' AND m.published_at + INTERVAL '1 day'
      UNION ALL
      SELECT pm.id, pm.published_at, pm.author, pm.title, pm.snippet, 3 AS prio
        FROM mentions pm
       WHERE m.parent_mention_id IS NULL AND k.ig_code IS NOT NULL
         AND pm.agency_id = m.agency_id
         AND pm.bw_guid = k.ig_code
         AND pm.published_at BETWEEN m.published_at - INTERVAL '60 days' AND m.published_at + INTERVAL '1 day'
    ) q
    ORDER BY q.prio, q.published_at DESC
    LIMIT 1
  ) p ON true
 WHERE m.agency_id = $1 AND m.id = ANY($2::uuid[])`;

const isoOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Fila de SAMPLE_CONTEXT_SQL → contexto del motor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sampleContextFromRow(r: any): SampleContext {
  return {
    bwGuid: r.bw_guid ?? null,
    url: r.url ?? null,
    pubType: r.pub_type ?? null,
    pageType: r.page_type ?? null,
    author: r.author ?? null,
    title: r.title ?? null,
    snippet: r.snippet ?? null,
    mentionKind: r.mention_kind ?? null,
    parentMentionId: r.parent_mention_id ?? r.p_id ?? null,
    parentPublishedAt: isoOrNull(r.parent_published_at) ?? isoOrNull(r.p_published_at),
    parentAuthor: r.p_author ?? null,
    parentText: r.p_text ? String(r.p_text).replace(/\s+/g, ' ').trim() : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export function createComposerDataAccess(pool: Queryable, agencyId: string): ComposerDataAccess {
  return {
    async loadSampleContext(ids: string[]) {
      if (ids.length === 0) return {};
      const { rows } = await pool.query(SAMPLE_CONTEXT_SQL, [agencyId, ids]);
      const out: Record<string, SampleContext> = {};
      for (const r of rows) out[String(r.id)] = sampleContextFromRow(r);
      return out;
    },
  };
}

/** Fila de muestra de las rutas (id, fecha, texto, sentimiento…) → muestra cruda del motor. */
export function toRawComposerSample(s: {
  id: string; createdAt: string; text: string; sentiment?: string | null; topic?: string | null;
  author?: string | null; source?: string | null; engagement?: number | null;
}): RawComposerSample {
  return {
    id: s.id, createdAt: s.createdAt, text: s.text, sentiment: s.sentiment ?? null, topic: s.topic ?? null,
    author: s.author ?? null, source: s.source ?? null, engagement: s.engagement ?? null,
  };
}
