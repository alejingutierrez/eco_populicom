# 13 · Prueba de humo de la capa LLM (fase 0)

Fecha: 28-oct-2026. Cuenta: `agutierrez@populicom.com`, región `us-east-1`.
Credenciales: las de `.env` del monorepo principal, usadas en el shell sin
imprimirlas. Los scripts viven en el scratchpad de la sesión, no en el repo.
Cada llamada fue mínima (16 tokens de salida) salvo las pruebas de caché,
latencia y conteo.

## Decisión

**`ADVISOR_LLM_BACKEND=runtime`** (plan B de spec §5.1).

Motivo: Mantle sirve **Opus 5.5** y el alias **Sonnet 5** (sin «-5»), pero no
sirve `anthropic.claude-sonnet-5-5` ni `anthropic.claude-haiku-5-5` con ninguno
de los nombres probados. `bedrock-runtime` con los perfiles `us.anthropic.claude-*-5-5`
funciona para los tres modelos. El camino 1 usa Sonnet 5.5 como modelo
principal, así que Mantle no basta por sí solo.

## Resultados por verificación (spec §16)

| # | Resultado | Evidencia |
|---|---|---|
| **V1** | **Parcial.** Las llamadas a Mantle con estas credenciales no dieron 403. No probé una política restringida, así que no sé si la acción está exactamente en el permiso mínimo. Documentación: la acción existe en el servicio `bedrock-mantle` (AWS Service Authorization Reference). No pude confirmar en la tabla las claves de condición de `CreateInference`. | Sonda `v2-access`; búsqueda en documentación de AWS. Pendiente: política de prueba con solo `bedrock-mantle:CreateInference`. |
| **V2** | **Mantle: parcial.** Opus 5.5 responde (`anthropic.claude-opus-5-5`). Sonnet 5.5 y Haiku 5.5 devuelven 404 `does not exist` con `anthropic.*`, `claude-*`, `us.*`. **Runtime: OK** para los tres con `us.anthropic.claude-{haiku,sonnet,opus}-5-5`. | `v2-access`, `v2b`, `v2c`, `v2d`; `invoke-model` por CLI. |
| **V3** | **No medido.** Endpoint global frente a regional y precio efectivo requieren la documentación de precios y Cost Explorer a 24 h. | Pendiente. |
| **V4** | **Parcial, con cambios.** `thinking.display: "updates"` **no es válido** en la forma del spec: sin el beta, ambas rutas responden 400 (`Input should be 'summarized', 'omitted'`). Con el beta, la respuesta llega sin texto de thinking (0 caracteres, también en streaming). `display: "summarized"` sí devuelve resúmenes (≈270–360 caracteres en Opus). Mensaje `role: "system"` a mitad de conversación: **aceptado** en runtime y en Mantle. Caché con TTL 1 h: **funciona** en ambas rutas (escritura 26 239 tokens, lectura 26 239 en la segunda llamada). | `v4`, `v4b`, `v4c`. |
| **V5** | **OK.** Con un mock que devuelve `stop_reason: "refusal"` y `content: []`, el SDK no lanza excepción y el código puede leer `stop_reason` antes que `content`. | `v5-v9`. |
| **V6** | Ver sección de latencia abajo. | `v6.mjs`. |
| **V7** | **Medido.** Manual **26 244** tokens (59 854 caracteres), **no** los 15–20 k que estimaba el spec. LC (09 §C): **3 373**. Plantillas (10 anexo A): **9 676**. Total de conocimiento ≈ **39.3 k** tokens. Constitución del asesor: pendiente de escribir. | `count_tokens` por Mantle (Opus 5.5), `v7.mjs`. Coincide con la escritura de caché de V4 (26 239). |
| **V8** | **Fuentes secundarias.** Fecha de corte de los tres 5.5: **junio de 2026** (centro de ayuda de Anthropic, citado por búsqueda). No hubo acceso a la página de modelos del proveedor. | Búsqueda web. |
| **V9** | **OK, sin verificación de firma.** Un bloque de thinking editado (texto alterado y reenviado en el historial) **no fue rechazado** por Mantle/Opus. Por tanto no hay verificación obligatoria de *preserved thinking* en esta cuenta, al menos para este caso. | `v5-v9`. |
| **V10** | **Medido.** `agencies`: `ddecpr`, `gobernadora`, `sgpr`, `aaa`, `df` — todas `is_active = true`. Con proyecto BW: `ddecpr` (4 queries), `gobernadora` (1), `df` (2). `sgpr` y `aaa` sin proyecto BW. | `eco-migration` `custom-query` (solo SELECT). |
| **L1** | No aplica a la prueba técnica (asesoría legal). | — |

## Latencia (V6)

Prefijo: manual completo (26 239 tokens) cacheado con TTL 1 h, pregunta corta,
`max_tokens` 400. 20 corridas por combinación (la primera se descarta como
arranque en frío). Todas las corridas leyeron los 26 239 tokens de caché. Cero errores.

| Modelo · ruta | effort | TTFT p50 | TTFT p90 | Total p50 | Total p90 | Tokens/s p50 | Sin texto (TTFT nulo) |
|---|---|---|---|---|---|---|---|
| Sonnet 5.5 · runtime | low | 1 061 ms | 1 297 ms | 2 358 ms | 2 578 ms | 157 | 0 / 20 |
| Sonnet 5.5 · runtime | medium | 1 097 ms | 1 951 ms | 2 500 ms | 3 480 ms | 158 | 0 / 20 |
| Opus 5.5 · Mantle | low | 3 334 ms | 4 894 ms | 4 740 ms | 5 440 ms | 198 | 2 / 20 |
| Opus 5.5 · Mantle | medium | 4 844 ms | 5 376 ms | 4 959 ms | 5 597 ms | 86 | **14 / 20** |

Lectura para el diseño:

- **Sonnet en runtime es la ruta rápida**: primer token en ~1 s y el camino 1 de
  un prefijo de 26 k cabe holgado en el 60 s del ALB.
- **Opus con `effort: medium` y `max_tokens` 400 casi no emite texto**: 14 de
  20 corridas agotaron los 400 tokens en thinking. El spec da 8 k al camino 1 y 5 k
  al abogado del diablo; con esos topes hay que volver a medir antes de prometer
  latencias del camino 3 (spec §17). Esta prueba no lo valida.
- Las latencias de Opus son de Mantle; la primera llamada de cada sesión tardó
  60–85 s (arranque en frío, ver hallazgos).

## Hallazgos adicionales que afectan al diseño

1. **Arranque en frío de Mantle.** La primera llamada a un modelo tardó entre
   60 y 85 s (timeout del cliente en el primer intento con Opus; `opus-5` tardó
   85 s la primera vez). Las llamadas siguientes tardan 1–2 s. El ALB corta a
   60 s: el camino 1 necesita el `ping` de 15 s del spec y el backend debe
   reintentar o mantener la conexión en el primer uso.
2. **Caché por backend, no compartida (sin medir).** Las escrituras y lecturas de
   caché de 1 h se confirmaron dentro de cada ruta (runtime con Sonnet, Mantle
   con Opus). No probé si una escritura hecha en una ruta se lee en la otra.
   `output_config.effort` se acepta en runtime (`effort: "low"` en T1).
3. **Progreso del camino 1.** Como `display: "updates"` no entrega texto, las
   notas de progreso entre herramientas salen de eventos `tool_call` del propio
   loop (fallback de spec §5.4), no de thinking.
4. **Manual más grande de lo previsto.** 26 k tokens del manual más plantillas
   y LC suman ~39 k en el prefijo cacheado de la familia B, por encima de lo que
   suponía el spec. Mantenerlo dentro de 1 h de caché es viable (la lectura
   se confirmó en V4/V6), pero el costo por llamada de escritura cuenta; se
   vigila en el libro de tokens.

## Desviaciones del plan y pendientes

- **V6 con menos corridas que las 20 previstas** — si la corrida completa no termina en el tiempo de la sesión, se documenta el N real.
- **V1 y V3 incompletos** (ver tabla).
- **Mantle no se cablea en fase 0.** Como `ADVISOR_LLM_BACKEND=runtime`, no se añade la dependencia `@anthropic-ai/bedrock-sdk` al monorepo. Si se quiere Opus por Mantle más adelante, es un cambio aislado en `llm.ts`.
- **Nombre de la migración.** `0011` ya existe en `main` (`0011_mention_import_jobs.sql`), así que la migración del asesor es `0012_advisor.sql` en vez de `0011_advisor.sql` del spec.
- **Fecha de corte** de los modelos (V8) viene de fuentes secundarias; no se usa para ningún cálculo de la evaluación todavía.
