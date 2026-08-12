-- Migración 0004: embeddings vectoriales para "menciones similares".
--
-- Hasta ahora el drawer mostraba "Relacionadas" filtrando por mismo topic o
-- municipio, lo que produce resultados pobres cuando una mención toca varios
-- temas o cuando el topic asignado es genérico. Con esta migración la
-- similitud se calcula sobre el contenido (title + snippet) usando Amazon
-- Titan Embed Text v2 (1024 dims) vía Bedrock, y el endpoint sirve los
-- vecinos coseno-más-cercanos.
--
-- Idempotente: IF NOT EXISTS en extensión, columnas e índice.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

ALTER TABLE "mentions" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--> statement-breakpoint

ALTER TABLE "mentions" ADD COLUMN IF NOT EXISTS "embedded_at" timestamp with time zone;
--> statement-breakpoint

-- ivfflat con 100 lists: balance razonable para tablas en el orden de 100K-1M
-- filas. Si la tabla crece más allá, considerar reindex con lists=sqrt(N) o
-- migrar a HNSW (requiere pgvector >= 0.5).
CREATE INDEX IF NOT EXISTS "idx_mentions_embedding"
  ON "mentions" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
