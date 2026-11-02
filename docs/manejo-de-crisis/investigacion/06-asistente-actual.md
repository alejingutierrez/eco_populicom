# 06 · El asistente de ECO hoy (origin/main a7800a1, 23-oct-2026)

Mapa de lo que existe para diseñar el agente de crisis. Leído de `origin/main`
(el checkout local del monorepo está muy atrás: no usarlo como referencia).

## Hallazgos que condicionan el diseño

1. **El chat no es agéntico.** `apps/web/src/app/api/chat/stream/route.ts`
   lo dice en el header. Sin tool-use, sin loop; solo responde sobre lo que el
   navegador le manda de la vista actual (`buildViewContext()` en
   `chat-drawer.js:42-66`: métricas, sentimiento, tópicos, fuentes, municipios,
   emociones, 50 menciones).
2. **La constitución editorial prohíbe recomendar.** Ley 07 de
   `packages/shared/src/prompts/constitution.ts:103-110` ("se describe, no se
   recomienda"; veta "se debería", "recomendamos", "urge", tomar partido). El
   correo de crisis también lo prohíbe (`crisis-editorial.ts:73-77, 98`).
   → El asesor necesita un **modo propio** con su propia ley de recomendación,
   sin romper los 14 prompts descriptivos.
3. **No hay ningún manual/playbook/RAG** en el repo.
4. **pgvector ya existe** (migración 0004: `mentions.embedding vector(1024)`,
   Titan v2, ivfflat cosine; también `narratives.centroid`). Una tabla
   `playbook_chunks` con el mismo modelo es trivial.
   ⚠️ El task role de ECS solo puede invocar `anthropic.claude-*`: para
   embeber la consulta del usuario en el web hay que añadir Titan al IAM, o
   recuperar por etiquetas (fase/tipo de crisis) sin embeddings.

## Piezas reutilizables

| Pieza | Dónde | Nota |
|---|---|---|
| Streaming NDJSON (meta/delta/done/error) | chat/stream/route.ts:10-14 | Añadir eventos `tool_call` / `tool_result` para mostrar "consultando narrativas…" |
| Historial | `chat_conversations`, `chat_messages.content_json` | Guardar trazas de herramientas en content_json |
| Bedrock helper | `packages/shared/src/bedrock.ts` | `invokeClaudeWithTool` = un solo tool forzado; `invokeClaudeStream` solo texto. Falta un loop tool-use multi-turno con streaming. Sin prompt caching (útil para el manual). |
| Modelos | Opus 4.6 primario / Sonnet 4.6 fallback | Evaluar modelo más reciente para el agente |
| Índice de crisis V5 | `packages/shared/src/metrics.ts:248-288` | Bandas NORMAL <0.25 · ELEVADO <0.40 · ALERTA <0.60 · CRISIS — mapean a fases del manual |
| Alerta de crisis | metrics-calculator `fireCrisisAlert` :789, editorial :1240 | Hoy sin "qué hacer"; candidato a llevar recomendación del asesor |
| Briefings | eco-ai-tasks (signal/emerging/crisis) cada 6 h | Candidato a "parte de situación" proactivo |

## Endpoints → herramientas del agente

Mejor llamar las funciones de `lib/*/payload.ts` directamente que HTTP.

- `eco-mentions` (feed con filtros + `similar_to` pgvector) → buscar menciones / evidencia
- `mentions/analysis` → cómo viajó la historia, lenguaje que sube/baja
- `narrative/overview`, `narrative/[id]`, `/propagation`, `/edges` → narrativas, ciclo de vida, quién amplifica
- `sentiment/analysis` → quién movió el NSS, emociones 12 semanas
- `scorecard` → índices y 12 semanas contra lo usual
- `geo/analysis` → municipios contra lo usual
- `eco-terms` → términos distintivos
- `alerts/history` → alertas previas (restringido por lista de correos)
- `overview` → foto de la ventana cerrada vs previa

## Auth

- Middleware: `PROTECTED_PATHS` **y** `config.matcher` (si cuelga de
  `/api/chat/*` ya está cubierto).
- Capacidades en `lib/auth/roles.ts:19-35`; "usar el asesor" sería una
  capacidad nueva (`advise`?) gateada en SPA y endpoint.
- Toda herramienta debe pasar por `resolveAgencyId` (tenancy).
