# Motor de narrativas

Las **narrativas** son clusters emergentes de menciones que comparten un eje
conversacional, detectados por similitud semántica. Para la versión conceptual ver
[Conceptos · Narrativas](../fundamentos/conceptos.md#narrativas).

La matemática pura vive en `packages/shared/src/narratives-math.ts` (sin
dependencias, unit-testable). La orquestación en tres Lambdas:
`eco-narrative-cluster` (+ su `naming.ts`), `eco-narrative-edges`,
`eco-narrative-drift`. Las tablas en
[Modelo de datos](modelo-de-datos.md#narrativas-pgvector).

---

## Embeddings (pgvector, 1024 dims)

- Modelo: **Amazon Titan Embed Text v2** (`amazon.titan-embed-text-v2:0`),
  `dimensions: 1024`, `normalize: true` (`infra/lambda/lib/embeddings.ts:15-42`).
- Input: `title + "\n\n" + snippet`, recortado a 8000 chars
  (`embeddings.ts:20-25`).
- Se almacenan en `mentions.embedding vector(1024)` y en
  `narrative_candidates.embedding`. Índice ivfflat con `lists=100` (mentions) y
  `lists=10` (narratives.centroid).
- **Generación**: vía la acción `backfill-embeddings` de `eco-migration`
  (`migration/index.ts:403-471`), en lotes de hasta 5000, concurrencia 5,
  idempotente (`WHERE embedding IS NULL`). El comentario del helper afirma que el
  processor también los genera, pero en el código actual del processor no hay
  llamada a `embedText` — los embeddings se pueblan por backfill.

Como los vectores de Titan vienen normalizados, la similitud coseno equivale al
producto punto, pero `cosineSimilarity` calcula las normas explícitamente igual
(`narratives-math.ts:27-41`).

---

## Asignación a centroides — `eco-narrative-cluster`

Código: `infra/lambda/narrative-cluster/index.ts`. Por cada mención no asignada
con embedding (`index.ts:189-201`):

1. **Vecindad por coseno** sobre `narratives` activas (status ≠ dormant) con
   pgvector: `1 - (centroid <=> $embedding)` ordenado por distancia, top-3
   (`index.ts:208-217`).
2. Filtra los matches con `similarity >= THRESHOLD` (default **0.78**, env
   `NARRATIVE_THRESHOLD`, `index.ts:53`).
3. Si hay matches: inserta hasta 3 filas en `narrative_mentions` (top-1
   `is_primary=true`) y actualiza el centroide del top-1 con **EWMA**
   (`index.ts:229-268`). También suma `mention_count`, `total_engagement`,
   `total_reach` y avanza `last_mention_at`.
4. Si no: encola la mención en `narrative_candidates`.

Tunables (env, defaults en `index.ts:53-60`): `NARRATIVE_TOP_N_MATCHES` 3,
`NARRATIVE_PER_AGENCY_LIMIT` 5000 menciones/corrida, `NARRATIVE_MAX_NEW_PER_RUN`
20 narrativas nuevas/corrida.

### EWMA del centroide

```ts
// narratives-math.ts:89-101
centroid' = normalize( (1 - alpha) * centroid + alpha * newPoint )
```

`alpha` default **0.05** (`NARRATIVE_EWMA_ALPHA`). Con alpha pequeño el centroide
se mueve lentamente: preserva la identidad de la narrativa pero deriva con el
tiempo. El resultado se renormaliza a longitud unitaria.

---

## Nacimiento por DBSCAN

Sobre el pool `narrative_candidates`, si hay ≥ `MIN_MENTIONS_BIRTH` (default
**10**), corre DBSCAN (`spawnNarrativesFromCandidates`, `index.ts:316-487`):

```ts
// index.ts:345-350
dbscan(points, (a,b) => cosineDistance(a.vec, b.vec), DBSCAN_EPS, MIN_MENTIONS_BIRTH)
```

- **eps** = `NARRATIVE_DBSCAN_EPS` default **0.22** (≈ 1 − 0.78, consistente con el
  threshold de asignación).
- **minPts** = `MIN_MENTIONS_BIRTH` = 10.
- Implementación DBSCAN clásica O(N²) en JS (`narratives-math.ts:122-176`); el pool
  rara vez supera unos cientos de puntos. Recupera puntos de ruido como bordes de
  clusters.

Por cada cluster denso (hasta `MAX_NEW_PER_RUN`):

1. Elige ≤10 muestras representativas (`pickRepresentativeSamples`: mayor
   engagement+reach, con diversidad temporal — `naming.ts:145-172`).
2. **Nombra con Bedrock tool-use** (`nameNarrative`, ver abajo).
3. Calcula el centroide inicial como `vectorMean` del cluster (normalizado,
   `narratives-math.ts:68-78`).
4. INSERT en `narratives` con `status='emerging'`, `centroid = centroid_at_naming`,
   `initiator_first` (la mención cronológicamente más antigua), totales del cluster
   (`index.ts:426-457`).
5. Inserta `narrative_mentions` (todas `is_primary=true`, similarity = coseno al
   centroide) y borra esos candidatos del pool (`index.ts:461-476`).

### Naming (Bedrock tool-use)

`infra/lambda/narrative-cluster/naming.ts`. Usa `invokeClaudeWithTool` de
`@eco/shared/src/bedrock` con un `input_schema` que fuerza la salida estructurada:
`name` (3-5 palabras), `slug` (kebab-case, regex `^[a-z0-9-]+$`), `summary` (≤220
chars), `keywords` (4-8) (`naming.ts:45-74`). Valida el resultado y exige slug
válido + ≥3 keywords (`naming.ts:119-134`). El slug se hace único por agencia
(sufijo aleatorio si colisiona, `index.ts:408-415`).

---

## Ciclo de vida (máquina de estados)

`computeLifecycleState(input)` en `narratives-math.ts:215-256`, recalculada cada
corrida por `updateLifecycleStates` (`index.ts:489-560`). Reglas **en orden**:

| Orden | Estado | Condición |
|---|---|---|
| 1 | `dormant` | `daysSinceLast > 14` |
| 2 | `revived` | `prevStatus == 'dormant'` y `velocity24h > 0` |
| 3 | `peaking` | `velocity24h >= 5` y `velocity24h > avgVelocity7d * 2` |
| 4 | `declining` | (`velocity24h < avgVelocity7d * 0.3` y `daysSinceLast > 3`) **o** `daysSinceLast > 7` |
| 5 | `emerging` | `mentionCount < 50` y `ageDays < 7` |
| 6 | `active` | resto (default) |

Entradas calculadas en SQL (`index.ts:503-519`):
- `velocity24h`: menciones primarias en las últimas 24h.
- `avgVelocity7d`: menciones primarias últimos 7 días / 7.
- `daysSinceLast`, `ageDays`: desde `last_mention_at` / `born_at`.

Cuando entra a `peaking` por primera vez, el caller fija `peaked_at`
(`enteredPeaking`, `index.ts:537-553`).

---

## Iniciadores

- **`initiator_first`**: la mención cronológicamente más antigua del cluster, se
  fija al nacer la narrativa (`index.ts:400-406`).
- **`initiator_influencer`**: se calcula para narrativas con ≥
  `INFLUENCE_WINDOW_HOURS` (default **24**) horas de antigüedad
  (`computeInfluencersForRecentNarratives`, `index.ts:562-618`). Es el autor con
  mayor `reach × (1 + likes + comments + shares)` dentro de las primeras 24h.

Los strings se pasan por `sanitizeUnicode` (quita surrogates UTF-16 sueltos que
romperían el jsonb, `index.ts:68-75`).

---

## Edges — `eco-narrative-edges`

Código: `infra/lambda/narrative-edges/index.ts`. Trigger diario 06:00 UTC.
Estrategia: **truncate + reinsert por agencia** (idempotente). Tres tipos
(`narrative-edges/index.ts:75-164`):

| Tipo | Condición | strength |
|---|---|---|
| `co_occurrence` | ≥ `CO_OCCURRENCE_MIN_SHARED` (5) menciones compartidas | Jaccard de menciones primarias |
| `author_overlap` | ≥ `AUTHOR_OVERLAP_MIN_SHARED` (3) autores en común | `|A∩B| / min(|A|,|B|)` (solapamiento) |
| `semantic` | coseno entre centroides > `SEMANTIC_THRESHOLD` (0.6) | coseno directo |

Todos undirected (`source < target` por orden UUID). Al final hace prune de
`strength < NARRATIVE_EDGE_MIN_STRENGTH` (default **0.15**,
`narrative-edges/index.ts:149-153`). No usa Bedrock; solo SQL agregaciones (el
`semantic` usa pgvector `<=>` directo, `narrative-edges/index.ts:136-146`).

---

## Drift y renombrado — `eco-narrative-drift`

Código: `infra/lambda/narrative-drift/index.ts`. Trigger semanal, lunes 08:00 UTC.
Por cada narrativa activa con centroide y `centroid_at_naming`
(`narrative-drift/index.ts:103-116`):

```ts
// narrative-drift/index.ts:124
drift = 1 - cosineSimilarity(centroid_actual, centroid_at_naming)
```

- `drift_score` se actualiza **siempre** (audit, barato).
- Si `drift >= DRIFT_THRESHOLD` (default **0.25**), se renombra: toma las 10
  menciones primarias más recientes, llama `nameNarrative`, y actualiza
  `name/slug/summary/keywords`, fija `centroid_at_naming = centroid_actual` y
  `last_renamed_at` (`narrative-drift/index.ts:132-204`).
- Cap `MAX_RENAMES_PER_RUN` (default **15**) evita un blast de Bedrock si muchas
  narrativas derivan a la vez.

---

## Parámetros (resumen)

| Parámetro | Env | Default | Lambda |
|---|---|---|---|
| Umbral de asignación coseno | `NARRATIVE_THRESHOLD` | 0.78 | cluster |
| EWMA alpha | `NARRATIVE_EWMA_ALPHA` | 0.05 | cluster |
| DBSCAN minPts | `NARRATIVE_MIN_MENTIONS_BIRTH` | 10 | cluster |
| DBSCAN eps | `NARRATIVE_DBSCAN_EPS` | 0.22 | cluster |
| Top-N matches por mención | `NARRATIVE_TOP_N_MATCHES` | 3 | cluster |
| Ventana de influencia (h) | `NARRATIVE_INFLUENCE_WINDOW_HOURS` | 24 | cluster |
| Límite menciones/agencia/corrida | `NARRATIVE_PER_AGENCY_LIMIT` | 5000 | cluster |
| Máx. narrativas nuevas/corrida | `NARRATIVE_MAX_NEW_PER_RUN` | 20 | cluster |
| Strength mínima de edge | `NARRATIVE_EDGE_MIN_STRENGTH` | 0.15 | edges |
| Umbral semántico de edge | `NARRATIVE_SEMANTIC_THRESHOLD` | 0.6 | edges |
| Co-ocurrencia mín. compartida | `NARRATIVE_CO_OCCURRENCE_MIN_SHARED` | 5 | edges |
| Author overlap mín. compartido | `NARRATIVE_AUTHOR_OVERLAP_MIN_SHARED` | 3 | edges |
| Umbral de drift | `NARRATIVE_DRIFT_THRESHOLD` | 0.25 | drift |
| Máx. renombrados/corrida | `NARRATIVE_MAX_RENAMES_PER_RUN` | 15 | drift |

Valores configurados en CDK: `workers-stack.ts:386-394` (cluster), `437-443`
(edges), `479-484` (drift).

---

## Estado en producción

Según las notas del proyecto, el feature está vivo para DDEC con 90+ narrativas y
~193 edges. El consumo desde la UI (grafo de fuerza, detalle, timeline) está en
[Frontend](frontend.md) y los endpoints en [API interna](api-interna.md).
