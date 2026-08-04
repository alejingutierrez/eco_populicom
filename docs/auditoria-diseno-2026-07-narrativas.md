# Narrativas — detección, novedad y experiencia

Apéndice de [`auditoria-diseno-2026-07.md`](auditoria-diseno-2026-07.md). Tres especificaciones. **Las dos primeras midieron contra la base de datos de producción** y corrigieron el diagnóstico que traía el informe: ver §5.

---

# Pipeline de detección de narrativas (eco-narrative-cluster)

## Resumen

La detección no está congelada: está degradada ~40× y detecta con 1–7 días de retraso. Medido hoy (3-ago) contra prod: 1,291 narrativas, la última creada el 2026-08-03 07:15; la crisis de Domenech SÍ parió narrativa ("Salida de Domenech e Itza García", 62 menciones, born 2026-07-21, created 2026-07-23). Lo que colapsó es el ritmo (gobernadora pasó de 457 narrativas/semana a ~10) y la frescura: muchas nacen con born_at de 2025 y el mismo run las marca dormant. La causa dominante no es eps: es la ventana del pool. El DBSCAN de gobernadora recibe siempre exactamente 12,000 candidatos ordenados por created_at ASC, de los cuales 9,801 (81.7%) son publicaciones de 2025 y sólo 68 (0.57%) de los últimos 7 días — las menciones de hoy nunca entran al muestreo. Prueba directa: sobre una ventana de 72h del pool actual, gobernadora tiene 29 core points a eps=0.19/minPts=7 (47 a 0.30); sobre el pool oldest-first, 0 clusters en las 96 corridas de las últimas 48h. El dedup no explica nada: los duplicados son 0.9–4.4% de las menciones de 30 días y no se borran, sólo se marcan. La fase de asignación está muerta por otra razón: assigned=0 en todas las corridas porque el umbral 0.78 vive muy por encima de la similitud real (máx-sim promedio 0.44–0.51) y porque 1,273 de 1,291 narrativas (98.6%) son dormant e invisibles. El precio de todo esto es 700 s de cómputo × 48 corridas/día (~$34/mes) para producir cero clusters, con riesgo de timeout en cuanto aaa y sgpr lleguen al cap. El arreglo P0 es ventana temporal por published_at (mismo predicado en poda y en pool), eps por percentil de la k-distancia en vez de constante mágica, y purga one-shot de 77,897 candidatos.

## 0. Método y evidencia

Todo lo numérico de abajo se midió el 2026-08-03/04 contra **prod** vía `eco-migration` acción `custom-query` y CloudWatch Logs de `/aws/lambda/eco-narrative-cluster`. Nota operativa: `custom-query` **rechaza `WITH`** (`{"error":"Only SELECT queries allowed"}`), así que todo el SQL de diagnóstico está escrito con subqueries en `FROM` y empieza literalmente por `SELECT`.

Estado de prod (`get-function-configuration`, LastModified **2026-07-01T03:22:52Z**): `NARRATIVE_DBSCAN_EPS=0.19`, `NARRATIVE_MIN_MENTIONS_BIRTH=7`, `NARRATIVE_THRESHOLD=0.78`, `NARRATIVE_PER_AGENCY_LIMIT=5000`, `NARRATIVE_MAX_NEW_PER_RUN=20`, timeout 900 s, mem 2048, reserved concurrency 1. **No existe `NARRATIVE_CANDIDATE_POOL_LIMIT`** en el env.

| Medición | Valor |
|---|---|
| Pool `narrative_candidates` | gobernadora 58,264 · ddecpr 11,981 · sgpr 4,123 · aaa 3,529 = **77,897** (tabla 465 MB) |
| Ventana que ve el DBSCAN de gobernadora (12,000 oldest-first) | `published_at` de **2025-01-02** a **2026-07-29**; **9,801 (81.7%) de 2025**; **68 (0.57%)** de los últimos 7 días |
| Clusters producidos | **0** en las 96 corridas × 4 agencias de las últimas 48 h (`DBSCAN: … → 0 clusters (eps=0.19, minPts=7)`) |
| Menciones asignadas a narrativa existente | **`assigned:0`** en todas las corridas |
| Duración por corrida | 595–737 s de 900 s. Desglose (23:15 UTC): aaa 3,530 pts→18 s · ddecpr 11,976→**303 s** · gobernadora 12,000→**304 s** · sgpr 4,122→29 s |
| Narrativas | 1,291 total · **1,273 dormant (98.6%)** · gobernadora 939/946 dormant · última creada **2026-08-03 07:15** |
| Ritmo de nacimiento | gobernadora: 457 (semana 6/29) → 246 (6/22) → 9 (7/6) → 10 (7/20) → ~1–2/semana |
| Latencia born→created | 1–7 días; casos con `born_at` 2025-09-24 / 2025-12-07 creados el 7/23 → **dormant al nacer** |
| Duplicados (30 d) | aaa 0.9% · ddecpr 2.7% · gobernadora 4.4% · sgpr 1.3% |
| `revived` histórico | **0**. `peaked_at` no nulo: 30/1,291. `drift_score>0`: 44; `≥0.25`: **0**; renombradas: **0** |
| Edges | author_overlap **122,690** · semantic 996 · co_occurrence 38 |
| pgvector | **0.8.0** (HNSW disponible). `mentions` 115,425 filas, 115,356 con embedding |

---

## 1. Veredicto sobre las ocho causas

| # | Causa del brief | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Contradicción eps-dedup: el dedup por `text_hash` borró los casi-duplicados que eps 0.19 exige | **REFUTADA en el mecanismo, CONFIRMADA en el efecto** | El dedup **no borra nada**: `processor/index.ts:176-181` calcula el hash y `:266` persiste `is_duplicate=true` con `duplicate_of_id`; las filas siguen ahí. Lo que las excluye es el filtro `m.is_duplicate = false` (cluster `index.ts:200` y `:353`) — reversible sin re-ingesta. Y la magnitud no alcanza para explicar nada: 0.9–4.4% de las menciones de 30 días. eps=0.19 sí es demasiado estrecho, pero por **geometría del embedding**, no por el dedup: en la ventana Domenech (685 menciones, 20–24 jul) la 6-NN mediana es **0.414** y sólo el p12 cae bajo 0.19. Además `index.ts:353` es **redundante**: `is_duplicate` se fija en el INSERT, así que un duplicado nunca pudo entrar al pool por `:200`. |
| 2 | Pool envenenado + ventana oldest-first (`:356-357`) | **CONFIRMADA — es la causa dominante** | Los 12,000 de gobernadora son 81.7% publicaciones de 2025 y 0.57% de los últimos 7 días. El log dice `12000 candidates` en **todas** las corridas: el cap está saturado y el ORDER BY `nc.created_at ASC` garantiza que lo fresco nunca entre. Contraprueba: sobre ventana de 72 h del mismo pool, gobernadora tiene **29 core points** a eps=0.19/minPts=7. |
| 3 | Bucle poda↔reencolado | **CONFIRMADA como bug latente, NO activo hoy** | La asimetría existe: la poda exige `nc.created_at < NOW()-7d AND m.published_at < NOW()-30d` (`:339-340`) y el query de no-asignadas (`:194-206`) no tiene filtro de fecha → cualquier fila podada vuelve con `created_at` fresco. Hoy `prune_eligible_now` = 4 (gobernadora) y 0 en el resto, así que el bucle no está girando. **Pero va a girar**: 53,225 candidatos de gobernadora se crearon el 7/29 (17,384) y 7/30 (35,841) con `published_at` de 2025; cruzan los 7 días de `created_at` el **5–6 de agosto** y entonces la poda los borra y el query de no-asignadas los reencola a 5,000/corrida (11 corridas ≈ 5,5 h). Predicción falsable. |
| 4 | La asignación excluye dormant (`:218`) y ~98% son dormant | **CONFIRMADA, pero no es la causa de la no-detección** | 1,273/1,291 dormant; gobernadora busca entre ~7 centroides vivos. Medido: de 642 menciones de gobernadora en el pool con `published_at ≥ NOW()-7d`, matchean ≥0.78 **19** incluyendo dormant vs **1** excluyéndolas (19×) — pero eso es 3% del flujo. El bloqueo real de la asignación es el **umbral**: la máx-similitud promedio contra cualquier centroide es 0.44–0.51 (máx 0.86–0.998) frente a `THRESHOLD=0.78`. Con o sin dormant, `assigned≈0`. |
| 5 | `revived` estructuralmente inalcanzable | **CONFIRMADA** | `narratives-math.ts:231` exige `prevStatus==='dormant' && velocity24h>0`; una dormant es invisible en `:218`, nunca recibe menciones. Empírico: `status='revived'` = **0** filas. Añado un segundo defecto: el docstring de `:208` promete "sticky 7 días via caller" y **el caller no lo implementa** — `updateLifecycleStates` (`:553-585`) no persiste ninguna marca temporal, así que aun alcanzándolo duraría una corrida. |
| 6 | `emerging` es proxy de tamaño/edad | **CONFIRMADA** | `narratives-math.ts:250`: `mentionCount < 50 && ageDays < 7`. Peor: `index.ts:462` inserta `'emerging'` hardcoded y el **mismo run** (paso 4, `:311-313`) recalcula el estado; con `born_at = first.published_at` (`:480`) de 2025 sale `daysSinceLast>14` → dormant. Confirmado en datos: "Averías de tuberías AAA en Ponce" born 2026-02-24 / created 2026-07-31 / status `declining`. |
| 7 | `drift_score` es la única señal real de "cambió el tema", semanal, sólo para renombrar, nunca mostrada | **CONFIRMADA y agravada** | `narrative-drift/index.ts:124` la calcula, `:127-130` la persiste, `:132` la usa sólo como gate de rename. Además `:112` filtra `status != 'dormant'`, así que **el 98.6% de las narrativas nunca recibe cálculo de drift**. Empírico: 44 con `drift_score>0`, **0** sobre 0.25, **0** renombradas jamás. |
| 8 | Los edges no son genealogía | **CONFIRMADA** | `narrative-edges/index.ts:1-21` y `schema/narratives.ts:97-103`: sólo `co_occurrence`, `author_overlap`, `semantic`. En DB: author_overlap 122,690 (ruido: es un grafo de co-autoría, no de linaje), semantic 996, co_occurrence 38. Sin `split`/`merge`/`spawn`. |

### Causas adicionales no listadas (todas verificadas)

| # | Hallazgo | Ubicación / evidencia |
|---|---|---|
| 9 | **`THRESHOLD=0.78` y `eps=0.19` son ambos puertas de casi-duplicado, y son incoherentes entre sí**: entrar a una narrativa existente pide sim ≥0.78 (dist ≤0.22) pero nacer pide dist ≤0.19 entre pares. Resultado: nada se asigna y nada nace. | `index.ts:53`, `:56`, `:227`; máx-sim real 0.44–0.51 |
| 10 | **Quema de cómputo**: 700 s × 48 corridas/día × 2 GB ≈ 67,200 GB-s/día (~$34/mes) para 0 clusters. `dbscan` recomputa cada distancia ~2n veces (`narratives-math.ts:167-175` no cachea) y se re-parsean 12,000×1024 floats por agencia por corrida. | REPORT logs; `narratives-math.ts:122-176` |
| 11 | **Timeout inminente y hambruna de sgpr**: ddecpr ya está en 11,976/12,000. Cuando aaa y sgpr lleguen al cap, 4×~305 s = 1,220 s > 900 s de timeout; el orden es `ORDER BY slug` (`:659`) → aaa, ddecpr, gobernadora, **sgpr se queda sin procesar**. | timing por agencia arriba |
| 12 | **`updateLifecycleStates` es O(N) round-trips**: 2 subqueries correlacionadas + 1 UPDATE por narrativa, sin filtro (`:548`). Gobernadora: 946×3 ≈ 2,838 round-trips × 48 corridas/día ≈ 136k escrituras/día casi todas no-op sobre filas dormant inmutables. | `index.ts:530-585` |
| 13 | **`dryRun` no puede validar clustering**: los pasos 3–5 están tras `if (!event.dryRun)` (`:299`, `:311`, `:316`). Hoy no existe forma de probar eps/minPts sin escribir en prod. | `index.ts:299` |
| 14 | **`idx_narratives_centroid` es ivfflat `lists=10`** sobre 1,291 filas con `ivfflat.probes=1` por defecto → riesgo de perder el vecino real. **Medido: 0 discrepancias en 400/400** comparando `MAX()` exacto vs `ORDER BY … LIMIT 1` → el planner hoy usa seq scan. **Riesgo latente**, no bug actual. `idx_mentions_embedding` es ivfflat `lists=100` con 115,356 vectores (recomendado ≈ √N = 340). | `pg_indexes` |

---

## 2. Barrido diagnóstico ANTES de tocar prod

### 2.1 Distribución de la k-distancia (elegir eps, no adivinarlo)

`k = minPts − 1`, porque `regionQuery` incluye el propio punto (`narratives-math.ts:174` hace `out.push(idx)`) y el test es `neighbors.length < minPts` (`:135`): un core point necesita **minPts−1 vecinos ajenos**.

```sql
SELECT nn.k,
  ROUND(MIN(nn.d)::numeric,3) AS dmin,
  ROUND(percentile_cont(0.05) WITHIN GROUP (ORDER BY nn.d)::numeric,3) AS p05,
  ROUND(percentile_cont(0.10) WITHIN GROUP (ORDER BY nn.d)::numeric,3) AS p10,
  ROUND(percentile_cont(0.20) WITHIN GROUP (ORDER BY nn.d)::numeric,3) AS p20,
  ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY nn.d)::numeric,3) AS p25,
  ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY nn.d)::numeric,3) AS p50
FROM (
  SELECT s.id, x.d, row_number() OVER (PARTITION BY s.id ORDER BY x.d) AS k
  FROM (
    SELECT m.id, m.embedding FROM mentions m JOIN agencies a ON a.id=m.agency_id
    WHERE a.slug='gobernadora' AND m.is_duplicate=false AND m.embedding IS NOT NULL
      AND m.published_at >= '2026-07-20' AND m.published_at < '2026-07-25'
  ) s
  CROSS JOIN LATERAL (
    SELECT (s.embedding <=> s2.embedding)::float8 AS d
    FROM (
      SELECT m2.id, m2.embedding FROM mentions m2 JOIN agencies a2 ON a2.id=m2.agency_id
      WHERE a2.slug='gobernadora' AND m2.is_duplicate=false AND m2.embedding IS NOT NULL
        AND m2.published_at >= '2026-07-20' AND m2.published_at < '2026-07-25'
    ) s2
    WHERE s2.id <> s.id ORDER BY s.embedding <=> s2.embedding LIMIT 9
  ) x
) nn
GROUP BY nn.k ORDER BY nn.k
```

Resultado real (evento Domenech, 685 puntos, 5 días):

| k | dmin | p05 | p10 | p20 | p25 | p50 |
|---|---|---|---|---|---|---|
| 4 | 0.006 | 0.087 | 0.134 | — | 0.239 | 0.370 |
| **6** | 0.006 | **0.122** | **0.165** | ~0.26 | **0.300** | **0.414** |
| 9 | 0.008 | 0.136 | 0.203 | — | 0.348 | 0.481 |

### 2.2 Core points por (eps, minPts)

Mismo bloque `nn`, y encima:

```sql
JOIN (SELECT generate_series(5,10) AS minpts) mp ON nn.k = mp.minpts - 1
CROSS JOIN (SELECT unnest(ARRAY[0.19,0.22,0.26,0.30,0.34,0.38]) AS eps) e
WHERE nn.d <= e.eps
GROUP BY mp.minpts, e.eps ORDER BY mp.minpts, e.eps
```

Core points, ventana Domenech (n=685):

| minPts \ eps | 0.19 | 0.22 | 0.26 | 0.30 | 0.34 | 0.38 |
|---|---|---|---|---|---|---|
| 5 | 114 | 154 | 195 | 243 | 307 | 353 |
| **7** | **81** | 105 | 135 | **168** | 238 | 297 |
| 10 | 67 | 80 | 99 | 132 | 162 | 211 |

Mismo barrido pero sobre el **pool real en ventana de 72 h** (lo que alimentaría el arreglo) — sustituir el filtro por `JOIN narrative_candidates nc ON nc.mention_id=m.id AND m.published_at >= NOW() - INTERVAL '72 hours'`:

| agencia (n) | minPts | 0.19 | 0.26 | 0.30 | 0.34 | 0.38 |
|---|---|---|---|---|---|---|
| gobernadora (213) | 7 | **29** | 38 | 47 | 52 | 61 |
| gobernadora (213) | 5 | 42 | 51 | 55 | 64 | 71 |
| aaa (64) | 7 | **0** | 0 | 5 | 9 | 9 |
| aaa (64) | 5 | 1 | 3 | 8 | 10 | 19 |

**Lectura del k-distance plot.** Se ordenan ascendentemente las n distancias k-ésimas; x = rank/n, y = distancia. Los puntos densos forman una meseta y el ruido una pared; la rodilla es la transición y eps se toma como la última distancia de la meseta. Numéricamente: derivada por diferencias finitas en ventanas del 5% de rank; la rodilla es el primer percentil donde la pendiente supera 3× la pendiente mediana del tramo [p05, p50].

**Aplicado a nuestros datos NO hay rodilla.** Pendientes para k=6: p05→p10 = 0.86, p10→p25 = 0.90, p25→p50 = 0.456 — la curva es suave y hasta se aplana. Conclusión honesta y consecuente: los embeddings Titan v2 de snippets cortos en español **no tienen brecha de densidad**, así que cualquier eps global es una **decisión de política**, no un descubrimiento. Por eso:

1. eps se fija por **percentil explícito** de la k-distancia de la ventana, no por constante mágica: `eps := clamp(p25(kdist_{minPts-1}), 0.22, 0.34)`. Sobre la ventana Domenech eso da **0.30**; el 0.19 de prod está en el p12 → recorta al 12% más denso.
2. La respuesta de fondo es un algoritmo que no necesita eps global (§4: HDBSCAN).

### 2.3 Modo diagnóstico en el lambda (obligatorio antes de mover el env)

Añadir a `ClusterEvent` (`index.ts:82-89`) y ejecutar la fase 3 en seco:

```ts
interface ClusterEvent {
  agencySlug?: string; dryRun?: boolean; skipNaming?: boolean; maxNewNarratives?: number;
  /** Corre SOLO el DBSCAN y logea histograma de tamaños. No escribe nada. */
  clusterOnly?: boolean;
  epsOverride?: number; minPtsOverride?: number; windowDays?: number;
}
```

`aws lambda invoke --function-name eco-narrative-cluster --payload '{"agencySlug":"gobernadora","clusterOnly":true,"windowDays":10,"epsOverride":0.30,"minPtsOverride":6}' …`
Log esperado: `[gobernadora] clusterOnly n=912 eps=0.300 minPts=6 → clusters=[41,22,14,11,9,7,7,6] noise=795 (87%)`.

### 2.4 Criterios de aceptación (rechazar la configuración si falla alguno)

| Criterio | Umbral |
|---|---|
| Cobertura | 5% ≤ (puntos en cluster / n de la ventana) ≤ 25% |
| Cluster gigante | El mayor cluster ≤ 35% de la ventana (detecta encadenamiento) |
| Volumen | 1 ≤ clusters/día/agencia ≤ `MAX_NEW_PER_RUN` (20) |
| Frescura | p50 de `NOW() − max(published_at del cluster)` ≤ 24 h; p90 ≤ 48 h |
| Coherencia editorial | 8 de 10 nombres generados juzgados "un solo evento" por el analista (revisión manual obligatoria, `skipNaming:false` en una corrida de sombra) |
| No regresión | Ninguna narrativa nace con `born_at < NOW() − windowDays − 1` |

---

## 3. Arreglos estructurales

### (a) Filtro de fecha sobre `published_at`, nunca sobre `created_at`

Regla del proyecto (memoria `feedback_backfill_dates.md`): **usar la fecha de la mención (`published_at`), NUNCA la de ingesta**. Aquí es literal: `narrative_candidates.created_at` es fecha de **encolado**, y (i) un backfill la pone "hoy" para menciones de 2025 — 53,225 candidatos de gobernadora se crearon el 29–30 de julio con `published_at` de 2025 —, y (ii) la re-encolada la **resetea**, así que no es monótona ni identifica la fila. `published_at` es la única clave temporal estable y es la que define "actualidad" para el producto.

Nueva constante (junto a `index.ts:53-65`):

```ts
/** Ventana de detección en días sobre published_at. ÚNICA fuente de verdad
 *  temporal: la usan el query de no-asignadas, la poda y el fetch del pool. */
const DETECTION_WINDOW_DAYS = Number(process.env.NARRATIVE_DETECTION_WINDOW_DAYS ?? 10);
```

Diff en el query de no-asignadas (`index.ts:194-206`):

```diff
   WHERE m.agency_id = $1
     AND m.is_duplicate = false
     AND m.embedding IS NOT NULL
+    AND m.published_at >= NOW() - ($3 || ' days')::interval
     AND NOT EXISTS (SELECT 1 FROM narrative_mentions nm WHERE nm.mention_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM narrative_candidates nc WHERE nc.mention_id = m.id)
-  ORDER BY m.published_at ASC
+  ORDER BY m.published_at DESC
   LIMIT $2`,
- [agency.id, PER_AGENCY_LIMIT],
+ [agency.id, PER_AGENCY_LIMIT, DETECTION_WINDOW_DAYS],
```

`DESC` importa cuando el límite de 5,000 muerda (backfill): hoy `ASC` sirve primero las de 2025.

### (b) Romper el bucle poda↔reencolado: mismo predicado en ambos lados

La poda pierde por completo la condición sobre `created_at` (que es la que crea la asimetría) y pasa a usar el mismo predicado que la admisión (`index.ts:334-342`):

```diff
-      WHERE m.id = nc.mention_id
-        AND nc.agency_id = $1
-        AND nc.created_at < NOW() - INTERVAL '7 days'
-        AND m.published_at < NOW() - INTERVAL '30 days'`,
-    [agency.id],
+      WHERE m.id = nc.mention_id
+        AND nc.agency_id = $1
+        AND m.published_at < NOW() - ($2 || ' days')::interval`,
+    [agency.id, DETECTION_WINDOW_DAYS],
```

Invariante resultante: *una mención está en el pool ⟺ `published_at ≥ NOW() − W`*. La poda es monótona (nada vuelve, porque `published_at` no cambia) y el pool queda acotado por el volumen de W días: gobernadora ~900, ddecpr ~120, aaa ~300, sgpr ~245 → **~1,565 filas en total** frente a 77,897.

### (c) Orden del pool: **particionar por ventana**, no reordenar

Recomendación: **partición temporal**, y `ORDER BY … DESC` sólo como válvula de seguridad. Argumentos:

1. **Semántico**: DBSCAN es un criterio de densidad *relativa al muestreo*. Con 20 meses mezclados la densidad global no significa nada: un tema recurrente 200 veces a lo largo de un año produce densidad sin evento, y a la vez la masa de un evento real (68 puntos en 7 días dentro de 12,000) queda diluida bajo minPts. Reordenar DESC arregla el sesgo pero deja el muestreo incoherente y deja eps comparando poblaciones distintas cada corrida.
2. **Cuantitativo**: n baja de 12,000 a ~200–900 → O(n²) pasa de 1.44e8 a ~8.1e5 pares (**~180× menos**); el tiempo por agencia cae de ~304 s a ~1–2 s y la corrida completa de ~700 s a <15 s. Desaparecen el timeout y la hambruna de sgpr (causa #11).
3. **De producto**: los clusters nacen con `born_at` dentro de la ventana → `emerging` real en vez de dormant al nacer (causa #6).

Diff (`index.ts:344-357`):

```diff
        FROM narrative_candidates nc
        JOIN mentions m ON m.id = nc.mention_id
       WHERE nc.agency_id = $1
-       AND m.is_duplicate = false
-       ORDER BY nc.created_at ASC
+         AND m.published_at >= NOW() - ($3 || ' days')::interval
+       ORDER BY m.published_at DESC
        LIMIT $2`,
-    [agency.id, CANDIDATE_POOL_LIMIT],
+    [agency.id, CANDIDATE_POOL_LIMIT, DETECTION_WINDOW_DAYS],
```

(Se elimina `m.is_duplicate = false` por redundante — causa #1.) Opcional recomendado: dos pasadas por agencia, **caliente 72 h con minPts=5** (detección temprana) y **templada W=10 d con minPts=7** (narrativas de combustión lenta), dedupeando por `mention_id` ya consumido. Con los números de §2.2 la pasada caliente de gobernadora ya produce clusters hoy.

### (d) Dormant y `revived` alcanzable

Dos etapas en la asignación, para no dejar que 1,273 centroides viejos se coman el flujo (`index.ts:214-227`):

```ts
// Etapa 1: narrativas vivas, umbral normal.
const live = await client.query(
  `SELECT id, (1 - (centroid <=> $1::vector)) AS similarity
     FROM narratives
    WHERE agency_id = $2 AND status <> 'dormant' AND centroid IS NOT NULL
    ORDER BY centroid <=> $1::vector LIMIT $3`,
  [mention.embedding, agency.id, TOP_N_MATCHES]);
let matches = live.rows.map(r => ({id:r.id, similarity:Number(r.similarity)}))
                       .filter(r => r.similarity >= THRESHOLD);
// Etapa 2 (sólo si no hubo match): revival de dormant recientes, umbral MÁS ALTO.
if (matches.length === 0) {
  const rev = await client.query(
    `SELECT id, (1 - (centroid <=> $1::vector)) AS similarity
       FROM narratives
      WHERE agency_id = $2 AND status = 'dormant' AND centroid IS NOT NULL
        AND last_mention_at >= NOW() - ($4 || ' days')::interval
      ORDER BY centroid <=> $1::vector LIMIT 1`,
    [mention.embedding, agency.id, TOP_N_MATCHES, REVIVE_MAX_AGE_DAYS /* 120 */]);
  matches = rev.rows.map(r => ({id:r.id, similarity:Number(r.similarity)}))
                    .filter(r => r.similarity >= REVIVE_THRESHOLD /* 0.82 */);
}
```

Impacto medido: pasa de 1 a **19** menciones asignables de las 642 de gobernadora en ventana de 7 días. Y hace `revived` alcanzable por primera vez (`narratives-math.ts:231` ya lo contempla).

Para que `revived` **dure**, cumplir el contrato del docstring (`:208`): columna nueva y guarda de stickiness.

```sql
ALTER TABLE narratives ADD COLUMN IF NOT EXISTS revived_at timestamptz;
```

```diff
-  if (prevStatus === 'dormant' && velocity24h > 0) {
+  if (prevStatus === 'dormant' && velocity24h > 0) {
     return { status: 'revived', enteredPeaking: false };
   }
+  // Sticky: se mantiene 'revived' 7 días desde revivedAt (el caller lo sella).
+  if (prevStatus === 'revived' && revivedDaysAgo != null && revivedDaysAgo < 7) {
+    return { status: 'revived', enteredPeaking: false };
+  }
```
(añadir `revivedDaysAgo?: number | null` a `LifecycleInput`; el caller lo trae con `EXTRACT(EPOCH FROM (NOW()-n.revived_at))/86400.0` en el SELECT de `:530-548` y hace `SET revived_at = NOW()` cuando la transición entra a `revived`.)

### (e) Purga one-shot del pool vía `exec-write`

**Orden obligatorio: primero desplegar (a)+(b)+(c), después purgar.** Al revés, la siguiente corrida reencola todo (el query de no-asignadas sin filtro de fecha admite 5,000/corrida).

Una sentencia por agencia (`exec-write` acepta una sola y devuelve `rowCount`):

```bash
aws lambda invoke --function-name eco-migration --cli-binary-format raw-in-base64-out \
 --payload '{"action":"exec-write","query":"DELETE FROM narrative_candidates nc USING mentions m, agencies a WHERE m.id = nc.mention_id AND a.id = nc.agency_id AND a.slug = '"'"'gobernadora'"'"' AND m.published_at < NOW() - INTERVAL '"'"'10 days'"'"'"}' /tmp/p1.json
```
Repetir con `ddecpr`, `sgpr`, `aaa`. `rowCount` esperado (medido hoy): gobernadora **55,910**, ddecpr **11,367**, sgpr **2,860**, aaa **2,631** → total **72,768**; quedan ~5,100 y tras la primera corrida con ventana ~1,565.

Verificación posterior (custom-query):

```sql
SELECT a.slug, COUNT(*) AS pool,
       MIN(m.published_at)::date AS oldest_pub,
       COUNT(*) FILTER (WHERE m.published_at < NOW() - INTERVAL '10 days') AS fuera_de_ventana
FROM narrative_candidates nc JOIN agencies a ON a.id=nc.agency_id JOIN mentions m ON m.id=nc.mention_id
GROUP BY a.slug ORDER BY pool DESC
```
Aceptación: `fuera_de_ventana = 0` en las 4 filas y `pool` total < 3,000. `narrative_candidates` mide **465 MB**; tras el DELETE el espacio queda para autovacuum (no se puede `VACUUM` desde `exec-write`) — si el bloat molesta, añadir acción dedicada `vacuum-narrative-candidates` al lambda de migración.

**Trampa conocida** (memoria `feedback_migration_exec_write.md`): una acción desconocida responde `"completed successfully"` sin hacer nada. Validar siempre con el SELECT de arriba, no con la respuesta del invoke.

---

## 4. La contradicción eps-dedup: comparación de salidas

| Opción | Veredicto | Razón con números |
|---|---|---|
| **A. Subir eps global** | Parcial, necesaria pero insuficiente | 0.19 recorta al p12 de la 6-NN; 0.30 (p25) triplica los core points en aaa (0→5) y sube 62% en gobernadora (29→47). Pero un eps único para ventanas de 64 (aaa) y 900 (gobernadora) puntos es incorrecto, y a 0.38 aparece riesgo de encadenamiento (61/213 core points en 72 h). **Adoptar como eps por percentil, no como constante.** |
| **B. Dejar entrar duplicados con peso** | **Rechazada como fuente de densidad** | Son 0.9–4.4% de las menciones; no mueven la densidad. Y donde sí abundan (sindicación de comunicados) producen exactamente el detector de sindicación que ya tenemos: el único nacimiento diario observado es aaa 07:15 con 7–8 menciones de comunicados de sequía. **Sí usarlos como amplificación**: contar `COUNT(*) FROM mentions WHERE duplicate_of_id = m.id` como peso de engagement de la mención representativa, no como puntos extra del DBSCAN. |
| **C. Otro espacio: sólo título** | Rechazada | Menos texto ⇒ más varianza y más colisiones triviales; el embedding actual ya es `title + "\n\n" + snippet` (`lib/embeddings.ts:20-25`). |
| **C'. Embeddings de `nlp_summary` (+ topics)** | **Recomendada como experimento P1** | El resumen de Claude normaliza estilo y ruido de plataforma, que es justo lo que infla la distancia intra-evento. Coste del re-embedding: 115,356 menciones × ~150 tokens ≈ 17M tokens con Titan v2 ≈ **$0.35**. Medición de aceptación: repetir §2.1 y exigir que el p25 de la 6-NN baje de 0.300 a **≤0.26**. Barato y falsable. |
| **D. HDBSCAN** | **Recomendada como respuesta de fondo (P2)** | El barrido demuestra que **no hay rodilla**: sin brecha de densidad, ningún eps global es correcto y HDBSCAN elimina el parámetro (sólo `min_cluster_size`), tolera densidad variable entre agencias (aaa 64 pts vs gobernadora 900) y su árbol condensado entrega **jerarquía padre/hijo**, que es la materia prima que falta para split/merge/spawn (causa #8). Coste: no hay librería JS confiable; son ~350–500 líneas (reachability mutua → MST de Prim → árbol condensado → extracción EOM). Con la ventana de §3(c) (n≤900) el O(n²) del MST es trivial (~1 s), así que **la ventana es prerrequisito de HDBSCAN, no alternativa**. Nota: el lambda sí puede usar npm (la prohibición de bundler aplica sólo a la SPA); aun así recomiendo implementarlo en `packages/shared` para tenerlo unit-testable como el resto de `narratives-math.ts`. |
| **E. Leader clustering incremental** | Rechazada como reemplazo | Es lo que ya hace la fase de asignación (centroide + umbral) y también necesita radio. Lo que sí procede es **alinear su umbral con la distribución real**: `THRESHOLD` 0.78 → **0.70** (la máx-sim promedio es 0.44–0.51; 0.78 está en la cola). Validar con el mismo criterio de coherencia editorial: si baja de 8/10, subir a 0.72. |
| **F. Pre-agrupar por tópico+ventana** | Rechazada como primaria, opcional como refinamiento | Bajaría n a decenas y haría la densidad local por construcción, pero parte los eventos multi-tópico: "Salida de Domenech e Itza García" (62 menciones) cruza corrupción + gobierno. Y el techo de calidad pasa a ser la asignación de tópicos. Con la ventana ya no hace falta para el coste. |

**Recomendación en orden.** P0: ventana temporal + eps por percentil con clamp `[0.22, 0.34]` + `minPts` escalado (`minPts = clamp(5 + floor(n/400), 5, 8)`: aaa 64→5, gobernadora 900→7). P1: `THRESHOLD` 0.70, revival de dormant, experimento `nlp_summary`. P2: HDBSCAN + genealogía desde el árbol condensado.

Firma del helper nuevo (`packages/shared/src/narratives-math.ts`), reutilizando la matriz para eps y para el DBSCAN — elimina la recomputación de causa #10:

```ts
/** Matriz triangular de distancias, indexada [i*(i-1)/2 + j] con j < i. */
export function pairwiseDistances<T>(pts: T[], d: (a:T,b:T)=>number): Float32Array;

/** eps por percentil de la k-distancia (k = minPts-1), con clamp de política. */
export function autoEps(
  m: Float32Array, n: number, minPts: number,
  opts?: { percentile?: number; min?: number; max?: number }, // default 0.25 / 0.22 / 0.34
): { eps: number; kdistP25: number; clamped: boolean };

/** DBSCAN sobre matriz precomputada. Misma semántica que dbscan(). */
export function dbscanPrecomputed(m: Float32Array, n: number, eps: number, minPts: number): DbscanResult<number>;
```

---

## 5. Escalabilidad

Con la ventana, el cap de 12,000 deja de ser el límite operativo (n real 64–900). Aun así:

1. **Matriz precomputada** (`Float32Array`, n(n−1)/2): n=900 → 405k floats = 1.6 MB; n=3,000 → 4.5M = 18 MB. Cabe de sobra en 2048 MB (uso actual 550–643 MB) y elimina las ~2n recomputaciones por punto de `narratives-math.ts:167-175`.
2. **Si alguna ventana supera ~3,000 puntos**, construir el grafo de vecindad en SQL con kNN + filtro por eps (O(n·k) en vez de O(n²)) y correr DBSCAN sobre listas de adyacencia. DDL (pgvector 0.8.0 confirmado):

```sql
CREATE INDEX IF NOT EXISTS idx_narrative_candidates_embedding_hnsw
  ON narrative_candidates USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```
Tras la purga la tabla queda en ~1,500–5,000 filas ⇒ el build es instantáneo (no hace falta `CONCURRENTLY`). Consulta de vecindad por candidato (`SET LOCAL hnsw.ef_search = 64`, y `hnsw.iterative_scan = relaxed_order` si se filtra por agencia):

```sql
SELECT c2.mention_id, (c1.embedding <=> c2.embedding) AS d
  FROM narrative_candidates c1
  JOIN narrative_candidates c2 ON c2.agency_id = c1.agency_id AND c2.id <> c1.id
 WHERE c1.id = $1 ORDER BY c1.embedding <=> c2.embedding LIMIT 32
```
(HNSW no hace range query nativo: se piden k=32 y se filtra `d <= eps`; con minPts ≤ 8, k=32 da margen suficiente.)

3. **`mentions.embedding`**: ivfflat `lists=100` con 115,356 vectores está sub-provisionado (√N ≈ 340). Cambiar a HNSW en una **acción dedicada de `eco-migration`** (no `exec-write`: el build necesita `SET maintenance_work_mem` en la misma sesión y tarda minutos):

```sql
SET maintenance_work_mem = '2GB';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mentions_embedding_hnsw
  ON mentions USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
DROP INDEX IF EXISTS idx_mentions_embedding;
```
4. **`narratives.centroid`**: 1,291 filas con ivfflat `lists=10` y `probes=1`. Medido 0/400 discrepancias (el planner usa seq scan hoy), pero para blindarlo cuando gobernadora pase de 939: `DROP INDEX idx_narratives_centroid` (a esta escala el seq scan exacto es más rápido y **siempre correcto**) o migrar a HNSW. No dejar ivfflat probes=1 gobernando una decisión de asignación.
5. **Lifecycle en un solo statement** (causa #12): sustituir el bucle de `:553-585` por un `UPDATE … FROM (SELECT … GROUP BY narrative_id) v` y acotar el universo con `WHERE n.agency_id=$1 AND (n.status <> 'dormant' OR n.last_mention_at >= NOW() - INTERVAL '20 days')`. Ahorra ~136k escrituras/día.
6. **Muestreo**: innecesario con ventana; si alguna vez hace falta, muestrear **estratificado por día** (no aleatorio uniforme), porque el objetivo es preservar picos diarios.

---

## 6. Observabilidad

Emitir métricas EMF desde el lambda (namespace `ECO/Narratives`, dimensión `Agency`) al final de `clusterForAgency`, con `console.log(JSON.stringify({_aws:{CloudWatchMetrics:[…]}, …}))` — sin dependencias nuevas.

| Métrica | Unidad | Alarma | Umbral | ¿Habría cazado el congelamiento? |
|---|---|---|---|---|
| `NarrativesBorn` | Count | Sum 24 h, 1 datapoint | **< 1** (todas las agencias agregadas) | **Sí** — habría disparado el ~7 jul |
| `DbscanClusters` | Count | Average 6 h | **< 0.05** con `DbscanWindowSize > 50` (alarma compuesta) | **Sí** — 0 clusters en 96 corridas |
| `AssignmentRate` = assigned/(assigned+queued) | None | Average 24 h | **< 0.02** | **Sí** — `assigned:0` siempre |
| `CandidatePoolSize` | Count | Maximum 1 h | **> 5,000** por agencia | **Sí** — 58,264 |
| `PoolOldestPublishedAgeDays` | Count | Maximum 1 h | **> W + 2** (12 con W=10) | **Sí** — 580 días |
| `DetectionLagHours` = NOW() − max(published_at) del cluster nacido | Seconds | p90 24 h | **> 48 h** | Sí — nacimientos con born_at de 2025 |
| `NewestNarrativeAgeHours` = NOW() − max(born_at) | Seconds | Maximum, 1 datapoint de 6 h | **> 96 h** | Sí, y es la señal más simple de "se congeló" |
| `DbscanWindowSize`, `EffectiveEps`, `EffectiveMinPts` | Count/None | sin alarma (contexto del dashboard) | — | Documenta qué configuración corrió |
| Lambda `Duration` | ms | Maximum 30 min | **> 600,000** (67% del timeout) | Sí — 700 s sostenidos |
| Lambda `Errors`, `Throttles` | Count | Sum 15 min ≥ 1 | — | — |

`treatMissingData: breaching` en `NarrativesBorn` y `NewestNarrativeAgeHours` (si el lambda no corre, es alarma). Todo al stack `EcoMonitoring`, con un widget por agencia de `CandidatePoolSize` + `DbscanClusters` + `NarrativesBorn`. Regla de oro que faltaba: **el log ya decía `→ 0 clusters` 192 veces al día y nadie lo leía**; la alarma convierte eso en detección en <24 h.

---

## 7. Saneamiento del drift de configuración

**Refutación**: no hay drift eps/minPts. `workers-stack.ts:425-426` dice `NARRATIVE_MIN_MENTIONS_BIRTH: '7'` y `NARRATIVE_DBSCAN_EPS: '0.19'`, **idéntico** al env de prod. El drift real es otro:

| Drift | Ubicación | Acción |
|---|---|---|
| Defaults del código ≠ stack (10 / 0.22 vs 7 / 0.19) | `index.ts:55-56` y JSDoc `:27-28` | Igualar defaults a los valores de política y logear la config efectiva al arrancar; mejor aún, `requireNum()` que lance si falta el env (nada de defaults silenciosos en parámetros de detección) |
| `NARRATIVE_CANDIDATE_POOL_LIMIT` **no existe** en el env de prod | `get-function-configuration`; el 12,000 viene de `index.ts:64` | Declararlo explícito en `workers-stack.ts:414-431`, junto al nuevo `NARRATIVE_DETECTION_WINDOW_DAYS` |
| CLAUDE.md afirma "corre con env `NARRATIVE_CANDIDATE_POOL_LIMIT=12000`" | `CLAUDE.md`, sección "Comportamientos confirmados" | Corregir: es el default del código |
| **Nombre de la regla EventBridge**: prod tiene `eco-narrative-cluster-hourly` con `cron(15,45 * * * ? *)`; el stack declara `ruleName: 'eco-narrative-cluster-30min'` (`:453`) | `workers-stack.ts:452-458` | Un `cdk deploy EcoWorkers` **reemplaza** el recurso (borra `-hourly`, crea `-30min`). Es aceptable pero hay que leer el `cdk diff`; documentarlo antes de deployar |
| Comentarios obsoletos | `workers-stack.ts:383` ("Cada hora"), `:387` ("≥10 menciones"), `index.ts:60-64` (describe la estrategia oldest-first que se elimina), `narratives-math.ts:118-120` ("rara vez supera unos cientos") | Reescribir con la política nueva |
| Bundle vs git | Lambda LastModified **2026-07-01**; último commit que toca `narrative-cluster/` es `018d4d1` (2026-06-30) | Riesgo de drift bajo, pero cumplir el ritual: descargar el bundle (`Code.Location`) y diffear antes de redeployar |
| Memoria del proyecto dice "narrativas CONGELADAS, cero desde ~6 jul" | `project_narratives_feature.md` | Corregir con el diagnóstico real (degradación 40× + latencia 1–7 d + nacimientos dormant), o la próxima sesión repite el error de partida |

**Despliegue** (monorepo principal sucio ⇒ esbuild + `update-function-code`, no `cdk deploy`): bundlear desde rutas ABSOLUTAS del worktree con `--alias:@eco/shared=<WT>/packages/shared/src/index.ts` y `--alias:@eco/database=<WT>/packages/database/src/index.ts`. Secuencia: (1) `clusterOnly` en sombra con el código nuevo apuntando a prod y sin escribir; (2) desplegar código; (3) purgar con `exec-write`; (4) primera corrida con `MAX_NEW_PER_RUN=5` para limitar el gasto de Bedrock si el barrido subestimó; (5) revisión editorial de los 10 primeros nombres; (6) subir a 20.


## Decisiones

**El arreglo de primer orden es particionar el pool por ventana temporal sobre published_at, no subir eps**

- *Por qué:* El DBSCAN de gobernadora recibe 12,000 candidatos de los cuales 9,801 (81.7%) son publicaciones de 2025 y sólo 68 (0.57%) de los últimos 7 días. Sobre una ventana de 72h del mismo pool hay 29 core points a eps=0.19/minPts=7 (47 a 0.30): con muestreo coherente el eps actual ya pare narrativas en la agencia de alto volumen. Además baja n de 12,000 a 200-900, lo que reduce el O(n²) ~180x y elimina el riesgo de timeout.
- *Alternativas descartadas:* Sólo cambiar ORDER BY created_at ASC por DESC: corrige el sesgo pero deja la ventana incoherente (densidad global sin sentido) y deja eps comparando poblaciones distintas en cada corrida.

**eps se fija por percentil de la k-distancia de la ventana (p25, clamp [0.22,0.34]), no como constante**

- *Por qué:* El barrido k-NN sobre la ventana Domenech (685 puntos) muestra que NO hay rodilla: pendientes p05→p10=0.86, p10→p25=0.90, p25→p50=0.456 (la curva se aplana). Sin brecha de densidad, cualquier eps global es política, no descubrimiento. p25 de la 6-NN = 0.300 (el 0.19 de prod está en el p12).
- *Alternativas descartadas:* Constante global 0.30: rompe en agencias de bajo volumen (aaa, 64 candidatos en 72h, 5 core points a 0.30 vs 0 a 0.19) y no se adapta al volumen de la ventana.

**El filtro temporal va sobre published_at y el mismo predicado se usa en la poda y en la admisión**

- *Por qué:* created_at es fecha de encolado: un backfill la pone 'hoy' para menciones de 2025 (53,225 candidatos de gobernadora creados el 29-30 jul con published_at de 2025) y la re-encolada la resetea, así que no es monótona. Usando published_at en ambos lados el invariante 'está en el pool ⟺ published_at ≥ NOW()−W' hace la poda irreversible y mata el bucle poda↔reencolado.
- *Alternativas descartadas:* Mantener la doble condición created_at<7d AND published_at<30d: es exactamente la asimetría que crea el bucle, y va a disparar el 5-6 de agosto sobre 53,225 filas.

**Rechazar 'dejar entrar duplicados con peso' como fuente de densidad; usarlos sólo como amplificación**

- *Por qué:* Los duplicados son 0.9%-4.4% de las menciones de 30 días y no se borran (processor/index.ts:266 los persiste con is_duplicate=true). Añadirlos como puntos no mueve la densidad y donde sí abundan (comunicados sindicados) produce el detector de sindicación que ya tenemos: el único nacimiento diario observado es aaa 07:15 con 7-8 comunicados de sequía.
- *Alternativas descartadas:* Incluirlos como puntos del DBSCAN con peso: inflaría densidad artificial en sindicación y produciría narrativas que son la misma nota de prensa replicada.

**HDBSCAN es la respuesta de fondo (P2), pero la ventana es su prerrequisito, no su alternativa**

- *Por qué:* HDBSCAN elimina el eps global (que el barrido demuestra indefendible), tolera densidad variable entre agencias (aaa 64 vs gobernadora 900 puntos por ventana) y su árbol condensado da la jerarquía padre/hijo que falta para split/merge (causa 8). Su MST es O(n²), viable sólo con n≤~900, es decir con la ventana ya implantada. Implementarlo en packages/shared (~350-500 líneas) para mantenerlo unit-testable.
- *Alternativas descartadas:* Librería npm de HDBSCAN: no hay implementación JS confiable; y meterla en el lambda rompe el patrón de tener toda la matemática en @eco/shared con tests.

**Reactivar la asignación bajando THRESHOLD 0.78→0.70 y añadiendo una segunda etapa de revival de dormant con umbral 0.82**

- *Por qué:* assigned=0 en todas las corridas. La máx-similitud promedio de una mención contra cualquier centroide es 0.44-0.51, así que 0.78 vive en la cola. Incluir dormant recientes sube de 1 a 19 los matches de 642 menciones de gobernadora (7 días) y es la única forma de hacer alcanzable 'revived' (0 filas jamás).
- *Alternativas descartadas:* Quitar del todo el filtro status!='dormant' con el mismo umbral: 1,273 centroides viejos compitiendo con ~18 vivos absorberían el flujo hacia narrativas muertas en vez de crear las nuevas.

**Añadir un modo clusterOnly al lambda y prohibir tocar el env sin barrido previo**

- *Por qué:* dryRun no sirve para validar clustering: los pasos 3-5 están tras if (!event.dryRun) (index.ts:299,311,316). Hoy no existe forma de probar eps/minPts sin escribir en prod, y así se llegó al cambio manual del 30 jun (eps 0.22→0.19) que nadie pudo validar.
- *Alternativas descartadas:* Seguir validando en prod con skipNaming: evita el coste de Bedrock pero escribe narrativas reales que luego hay que limpiar (precedente: 877 duplicados el 2026-05-25).

**La purga de 72,768 candidatos va DESPUÉS del deploy del filtro de ventana, y por agencia**

- *Por qué:* exec-write acepta una sola sentencia; cuatro llamadas acotan el blast radius y dan rowCount verificable por agencia (gobernadora 55,910 / ddecpr 11,367 / sgpr 2,860 / aaa 2,631). Si se purga antes del deploy, el query de no-asignadas sin filtro de fecha reencola todo a 5,000 por corrida en ~5,5 horas.
- *Alternativas descartadas:* Un único DELETE global: mismo efecto pero sin verificación por agencia y con un rowCount que no distingue si una agencia quedó fuera.

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-N1` | P0 | S | Ventana temporal por published_at (admisión, poda, pool) | `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/infra/lambda/narrative-cluster/index.ts (53-` | — |
| `WS-N2` | P0 | M | eps auto-calibrado + matriz de distancias precomputada | `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/packages/shared/src/narratives-math.ts (122-` | N1 |
| `WS-N3` | P0 | S | Modo diagnóstico clusterOnly + barrido SQL reproducible | `narrative-cluster/index.ts (82-89, 299-318) + script de barrido en scratchpad` | N2 |
| `WS-N4` | P0 | XS | Purga one-shot del pool (72,768 filas) vía exec-write | `invocaciones aws lambda a eco-migration (sin cambios de repo)` | N1 |
| `WS-N5` | P1 | M | Reactivar la asignación: THRESHOLD 0.70 + revival de dormant en 2 etapas | `narrative-cluster/index.ts (53, 214-227)` | N1 |
| `WS-N6` | P1 | M | revived alcanzable y sticky + lifecycle en un solo statement | `packages/shared/src/narratives-math.ts (215-256), narrative-cluster/index.ts (516-587), packages/database/src/` | N5 |
| `WS-N7` | P1 | M | Observabilidad EMF + alarmas CloudWatch | `narrative-cluster/index.ts (176-322) + /Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/infra` | N2 |
| `WS-N8` | P1 | S | Sanear drift de configuración y documentación | `narrative-cluster/index.ts (24-33, 53-65), infra/lib/workers-stack.ts (383-431, 452-458), /Users/alegut/MyApps` | — |
| `WS-N9` | P2 | M | Índices vectoriales: HNSW en candidates y mentions, decidir sobre narratives.centroid | `packages/database/src/migrations/0007_narrative_vector_indexes.sql + acción nueva en el lambda eco-migration` | N4 |
| `WS-N10` | P2 | L | Experimento: embeddings sobre nlp_summary + topics | `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/infra/lambda/lib/embeddings.ts (20-25) + acc` | N2 |
| `WS-N11` | P2 | XL | HDBSCAN + jerarquía para genealogía de narrativas | `packages/shared/src/narratives-math.ts (nuevo bloque) + narrative-cluster/index.ts (369-378)` | N2 |

## Riesgos

- El bucle poda↔reencolado dispara solo el 5-6 de agosto: 53,225 candidatos de gobernadora creados el 29-30 jul con published_at de 2025 cruzan el umbral created_at<7d y se vuelven prune-eligible. Si el fix (b) no está desplegado antes, el pool se vacía y se rellena a 5,000/corrida durante ~5,5 h, con escritura masiva sobre una tabla de 465 MB.
- Timeout inminente: ddecpr ya está en 11,976/12,000 candidatos y cada agencia al cap cuesta ~305 s. Con las cuatro al cap serían ~1,220 s > 900 s de timeout, y por ORDER BY slug (index.ts:659) sgpr se queda sin procesar de forma permanente y silenciosa.
- Bajar THRESHOLD a 0.70 y admitir dormant puede producir asignaciones erróneas que contaminen centroides vía EWMA (index.ts:256): un match malo mueve el centroide y arrastra a los siguientes. Mitigación: alpha 0.05 ya es conservador, pero hay que revisar manualmente las primeras 50 asignaciones y tener listo un rollback del env.
- Subir eps hacia 0.34-0.38 arriesga encadenamiento (un cluster gigante que se traga la ventana). Por eso el criterio de aceptación 'mayor cluster ≤ 35% de la ventana' es bloqueante, no informativo.
- MAX_NEW_PER_RUN=20 con 48 corridas/día permite hasta 960 llamadas de naming a Claude Opus por día si el arreglo sobre-genera. Arrancar en 5 y subir sólo tras la revisión editorial.
- La purga borra 72,768 filas de una tabla de 465 MB sin poder correr VACUUM desde exec-write; el bloat de índices persiste hasta que autovacuum lo recupere. En RDS pequeño puede afectar el plan de otros queries durante horas.
- El experimento de re-embedding con nlp_summary invalida todos los centroides existentes (quedan en el espacio viejo): no se puede mezclar. Requiere re-embedding completo (115,356 menciones, ~$0.35) y recomputar centroid y centroid_at_naming de las 1,291 narrativas, o aceptar un corte generacional.
- cdk deploy EcoWorkers reemplaza la regla EventBridge (prod eco-narrative-cluster-hourly vs stack eco-narrative-cluster-30min) y, según la memoria del proyecto, arrastra otros drifts (DASHBOARD_BASE_URL a mano en tres lambdas). Para este cambio usar esbuild + update-function-code y tocar el env con update-function-configuration.


---

# Señales de NOVEDAD dentro de las narrativas (sub-temas, actores, migración, genealogía, estados y alertas)

## Resumen

Verifiqué las ocho causas raíz leyendo el código: siete se confirman literalmente; la octava (drift env 0.22/10 vs prod 0.19/7) NO existe — `workers-stack.ts:425-426` ya dice `NARRATIVE_MIN_MENTIONS_BIRTH: '7'` y `NARRATIVE_DBSCAN_EPS: '0.19'`; el drift es de comentarios y defaults del código (`narrative-cluster/index.ts:55-56`, comentario `workers-stack.ts:387-388`). Encontré además tres causas nuevas: (N1) `born_at` se fija con `first.published_at` (index.ts:418-421, 480), la mención MÁS VIEJA del cluster, y como el pool es oldest-first las narrativas nacen con `ageDays` grande — nacen ya `declining`/`dormant` y jamás pasan por `emerging`; (N2) toda la velocidad se mide con `m.published_at` (index.ts:540,545), no con `nm.assigned_at`, así que una narrativa detectada hoy sobre menciones de hace 5 días tiene velocity24h=0 — el sistema no tiene noción de "acabo de verlo"; (N3) `drift_score` existe pero se calcula solo para `status != 'dormant'` (narrative-drift/index.ts:112), se sobrescribe sin historia y aparece en CERO archivos de `apps/web` (grep vacío). El diagnóstico de fondo: el sistema tiene UNA dimensión ("status") que mezcla volumen, edad y recencia, y CERO representación de "qué hay dentro de la narrativa". La propuesta separa tres ejes ortogonales (actividad / tendencia / novedad como array de flags), introduce la tabla `narrative_facets` con un detector de sub-temas calibrado POR narrativa (umbral de outlier derivado del IQR de la propia narrativa, no global), añade genealogía real (`spawn`/`split`/`merge_candidate` con evidencia de menciones), y emite las alertas reusando `alert_rules`/`alert_history`/`renderSimpleAlertHtml` exactamente con el patrón de `metrics-calculator/index.ts:553-645` en vez de inventar otro mecanismo. Todo mantiene la columna `status` como vista derivada para no romper la SPA sin bundler.

**Rutas base**: `WT = /Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit`

## §0. Verificación de las 8 causas (leídas, no asumidas) + 3 nuevas

| # | Veredicto | Evidencia exacta |
|---|---|---|
| 1 eps vs dedup | **Confirmada** | Pool y DBSCAN filtran `m.is_duplicate = false` (`WT/infra/lambda/narrative-cluster/index.ts:200`, `:353`); eps prod 0.19 (`WT/infra/lib/workers-stack.ts:426`) exige casi-dupe |
| 2 pool envenenado | **Confirmada** | `ORDER BY nc.created_at ASC LIMIT $2` (`index.ts:354-356`) con `CANDIDATE_POOL_LIMIT=12000` (`:64`) |
| 3 poda-reencolado | **Confirmada** | Poda exige `nc.created_at < NOW()-7d AND m.published_at < NOW()-30d` (`:334-341`); el SELECT de no-asignadas (`:194-206`) no filtra fecha y re-inserta con `created_at` default `NOW()` |
| 4 dormant excluidas | **Confirmada** | `AND status != 'dormant'` (`:218`) |
| 5 revived inalcanzable | **Confirmada** | `prevStatus === 'dormant' && velocity24h > 0` (`WT/packages/shared/src/narratives-math.ts:231`); una dormant nunca recibe mención (`:218`) ⇒ `last_mention_at` congelado ⇒ `daysSinceLast>14` ⇒ regresa a dormant en la línea 226 antes de llegar a 231 |
| 6 emerging = tamaño/edad | **Confirmada** | `mentionCount < 50 && ageDays < 7` (`narratives-math.ts:250`) |
| 7 drift invisible | **Confirmada y peor** | Solo `status != 'dormant'` (`narrative-drift/index.ts:112`), semanal (`workers-stack.ts:543`), sin historia; `grep -rn "drift_score\|driftScore" apps/web/src apps/web/public/eco-prototype/*.js` ⇒ **0 resultados** |
| 8 edges sin genealogía | **Confirmada** | Solo `co_occurrence`/`author_overlap`/`semantic`, todos *undirected* (`narrative-edges/index.ts:84-147`) |
| **8-bis drift de env** | **FALSA** | `workers-stack.ts:425-426` ya dice `'7'` / `'0.19'`. El drift real es documental: `index.ts:55-56` defaults 10/0.22 y el comentario `workers-stack.ts:387-388` ("≥10 menciones") |

**Nuevas (bloquean cualquier señal de novedad):**

- **N1 — la narrativa nace vieja.** `sorted[0]` es la mención más antigua (`index.ts:418-421`) y se persiste como `born_at` (`:480`). Con el pool oldest-first, `ageDays` al nacer puede ser >30 ⇒ `computeLifecycleState` nunca da `emerging` y a menudo da `dormant` en el paso 4 de la MISMA corrida (`:311-313`). *No existe columna de "cuándo lo vimos".*
- **N2 — velocidad ciega a la ingesta.** `velocity_24h` y `avg_velocity_7d` usan `m.published_at >= NOW() - INTERVAL '24 hours'` (`:540`, `:545`). Con backfill BW de 12h y cursores atrasados (ver CLAUDE.md), la novedad operativa es invisible.
- **N3 — sin serie temporal por narrativa.** No hay tabla equivalente a `daily_metric_snapshots` para narrativas ⇒ imposible calcular derivada segunda, z-score o Δdrift sin crearla o sin reconstruir por buckets en SQL.

---

## §1. Taxonomía de "elemento nuevo"

`v0 = [now-24h, now)`, `v1 = [now-48h, now-24h)`, `v2 = [now-72h, now-48h)`; `base7d` = media diaria de los 7 días previos **excluyendo** v0; `z = (v0 - base7d) / max(stdev7d, 1)`.

| # | Tipo | Definición operativa | Señal matemática | Datos | Acción |
|---|---|---|---|---|---|
| 1 | `narrative_born` | cluster nuevo visto por primera vez | `detected_at >= NOW()-48h` (col. nueva) | falta `detected_at` (N1) | flag `new_born` 48h + digest |
| 2 | `surging` (acelera) | crece y crece cada vez más rápido | `accel = v0 - 2·v1 + v2 > 0` **y** `z ≥ 2.5` **y** `v0 ≥ 5` | sí, un solo SELECT con 3 buckets | alerta inmediata |
| 3 | **`facet_new`** (sub-tema) | sub-cluster denso, lejano al centroide, reciente | §2 | embeddings sí; tabla nueva | alerta/digest + card "Nuevo dentro de esta narrativa" |
| 4 | `new_actors` | voces nunca vistas en ESTA narrativa | `newAuthorShare24h ≥ 0.4` con ≥3 autores nuevos, o 1 autor nuevo con `reach_estimate ≥ p90` de la narrativa | `mentions.author`, `reach_estimate` sí | flag + fila en la alerta |
| 5 | `platform_shift` | salta de red social a prensa | `JS(P24h, P7d) ≥ 0.25` sobre `page_type`, **y** `news` pasa de 0 a ≥1 mención | `mentions.page_type` NOT NULL sí | alerta si el destino es `news` (cambia el significado) |
| 6 | `geo_shift` | migra de municipios | ≥3 municipios nuevos en 24h, o `JS ≥ 0.30` sobre `mention_municipalities` | `mention_municipalities` sí (`source` = brandwatch\|nlp) | flag + mapa del detalle |
| 7 | `tone_shift` | empeora sin crecer | `|v0/base7d - 1| < 0.25` **y** `ΔNSS = NSS24h - NSS7d ≤ -15` pts, con ≥10 menciones en 24h | `COALESCE(nlp_sentiment, bw_sentiment)` sí | alerta (hoy 100% invisible) |
| 8 | `spawn` / `split` | un sub-tema se desprende | §4 | facets + `narrative_lineage` (nuevas) | alerta + arista dirigida |
| 9 | `merge_candidate` | dos narrativas son la misma | §4 | sí + tabla | candidato, sin alerta (destructivo) |
| 10 | `revived` | archivada vuelve a la vida | `prevActivity ∈ {quiet, archived}` y `activity = live` | requiere quitar el filtro `:218` | alerta |
| 11 | `reframed` (léxico) | mismo tema, otro encuadre | `driftΔ7d ≥ 0.12` **o** `jaccard(keywords_hoy, keywords_hace_7d) < 0.5` | `drift_score` existe, sin historia (N3) | badge "cambió el encuadre" + keywords antes/después |

---

## §2. La métrica de sub-tema nuevo (`narrative_facets`) — el corazón

**Ubicación**: matemática pura en `WT/packages/shared/src/narratives-facets.ts` (testeable, patrón `narratives-math.ts`); orquestación en `WT/infra/lambda/narrative-facets/index.ts` + `naming-facet.ts`.

### 2.1 Ventana y muestras
- **Ventana de detección** `W = 72h` sobre `nm.is_primary = true`. 72h y no 24h porque DDEC produce ~50-150 menciones/día repartidas entre decenas de narrativas: a 24h una narrativa mediana aporta <10 menciones y nada supera `minPts`.
- **Precondición**: `|window| ≥ FACET_MIN_WINDOW = 15`. Debajo de eso no se evalúa (garantía anti-ruido nº1).
- **Referencia histórica** `c_ref`: `vectorMean` de hasta 300 menciones primarias con `published_at < NOW()-72h` (las más recientes de ese conjunto). **No se usa `n.centroid`** porque el EWMA `alpha=0.05` (`workers-stack.ts:420`) ya absorbió parcialmente el sub-tema y porque `centroid_at_naming` puede tener meses. Fallback a `n.centroid` si el pre-ventana tiene <20 menciones.
- Caps: `window ≤ 800`, `preWindow ≤ 300` (coste de parseo de vectores, §5).

### 2.2 Umbral de outlier — calibrado POR narrativa
```
d_pre[i] = cosineDistance(e_i, c_ref)   para las menciones del pre-ventana
tau_out  = max(ABS_FLOOR, q75(d_pre) + 1.5 * IQR(d_pre))
ABS_FLOOR = 0.30
```
Esto es la decisión central: el umbral *no es global*. Una narrativa de prensa (titulares casi idénticos) tiene `IQR≈0.04` y `tau_out≈0.30`; una de X (heterogénea) `IQR≈0.15` y `tau_out≈0.55`. Un umbral global produciría 100% ruido en la segunda y 0% detección en la primera. `ABS_FLOOR = 0.30` está anclado en la medición del brief (14 core points a eps 0.30 sobre las 229 menciones de la crisis Domenech ⇒ a 0.30 hay estructura real; a 0.19 no hay ninguna).

### 2.3 Sub-clustering local
`O = { i ∈ window : d_i ≥ tau_out }`; si `|O| < 2·minPts` ⇒ sin facets.
```ts
const { clusters } = dbscan(O, (a,b) => cosineDistance(a.vec, b.vec), FACET_EPS, FACET_MIN_PTS);
// FACET_EPS = 0.28, FACET_MIN_PTS = 4
```
**Por qué DBSCAN local y no k-means**: (a) reusa `dbscan()` de `@eco/shared` (`narratives-math.ts:122-176`) — cero algoritmo nuevo; (b) no exige elegir `k`; (c) **declara ruido**, y aquí ~70-80% de los outliers son tuits sueltos sin relación — k-means los repartiría a la fuerza y todo sub-tema saldría contaminado. `|O|` son decenas ⇒ el `O(n²)` es irrelevante. `FACET_EPS = 0.28 > 0.19` global porque agrupamos puntos ya emparentados por la narrativa madre.

### 2.4 Filtros de "significativo"
Para cada sub-cluster `S`:

| Métrica | Fórmula | Umbral |
|---|---|---|
| `centroid_S` | `vectorMean(S)` | — |
| `separation` | `cosineDistance(centroid_S, c_ref)` | `≥ 0.32` |
| `cohesion` | `1 - mean_{i∈S} cosineDistance(e_i, centroid_S)` | `≥ 0.80` |
| `recencyFrac` | `|{i ∈ S : published_at ≥ NOW()-24h}| / |S|` | `≥ 0.50` |
| `size` | `|S|` | `≥ 4` |
| `share` | `|S| / |window|` | se reporta, no filtra |
| `facet_score` | `separation · √size · cohesion · (1 + recencyFrac)` | ranking; alerta si `≥ 1.0` |

**Deduplicación (evita repetir la misma alerta):** si existe facet `F` de la misma narrativa con `cosineDistance(centroid_S, F.centroid) < 0.15` ⇒ es la misma: `UPDATE` (`mention_count`, `last_seen_at`, `centroid` con `ewmaUpdate(F.centroid, centroid_S, 0.2)`) y **no** se alerta. Si no ⇒ `INSERT` + evento `facet_new`.

### 2.5 Calibración (procedimiento ejecutable)
1. Script `WT/scripts/backtest-facets.ts` (patrón de los `preview-*.ts`): 60 días de DDEC + SGPR, `dryRun`.
2. Grid: `ABS_FLOOR ∈ {0.28, 0.30, 0.33}` × `FACET_EPS ∈ {0.24, 0.28, 0.32}` × `FACET_MIN_PTS ∈ {3,4,6}` (27 corridas, sin Bedrock: `skipNaming`).
3. **Criterio de tasa** (barato, automático): entre **0.5 y 3.0 facets nuevas por narrativa live por semana**. <0.5 ⇒ ciego; >3 ⇒ ruido.
4. **Criterio de precisión** (humano): 30 facets muestreadas al azar; ≥70% deben ser juzgadas "algo distinto de la narrativa madre".
5. **Caso semilla obligatorio**: las 229 menciones de la crisis Domenech deben producir ≥1 facet con `facet_score ≥ 1.0`. Si la config no lo logra, se rechaza.

### 2.6 Naming (Bedrock tool-use)
`primaryModel: 'us.anthropic.claude-sonnet-4-6'`, `fallbackModel: 'us.anthropic.claude-opus-4-6-v1'` — invertido respecto a `naming.ts` porque etiquetar un sub-cluster con el nombre de la madre delante es una tarea corta.

```ts
const FACET_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    label:   { type: 'string', maxLength: 60,
      description: 'Etiqueta de 2-5 palabras del ELEMENTO NUEVO. No repitas el nombre de la narrativa madre.' },
    slug:    { type: 'string', pattern: '^[a-z0-9-]+$', maxLength: 60 },
    what_is_new: { type: 'string', maxLength: 200,
      description: 'Una oración: qué distingue estas menciones del tema madre. Empieza con un verbo o un sustantivo concreto.' },
    keywords: { type: 'array', items: { type: 'string', maxLength: 40 }, minItems: 3, maxItems: 8 },
    relation: { type: 'string',
      enum: ['sub_theme','new_actor','new_location','new_frame','off_topic'],
      description: 'sub_theme = ángulo nuevo del mismo tema; off_topic = no pertenece a la narrativa madre.' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['label','slug','what_is_new','keywords','relation','confidence'],
  additionalProperties: false,
};
```
`userPrompt`: nombre + summary + keywords de la madre, luego **4 muestras de contraste** de la madre (pre-ventana, top engagement) y **8 muestras del sub-cluster** (vía `pickRepresentativeSamples`, `naming.ts:145`). `validate`: `relation` en el enum, `label` no `includes()` el nombre de la madre (case/acentos normalizados), `confidence ≥ 0.5` o se descarta la facet sin persistirla. `relation === 'off_topic'` ⇒ `is_promotable = true` y **no** se alerta como sub-tema (entra a §4 como `spawn`).

### 2.7 DDL
```sql
CREATE TABLE IF NOT EXISTS narrative_facets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  narrative_id    UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  agency_id       UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  label           VARCHAR(80)  NOT NULL,
  slug            VARCHAR(80)  NOT NULL,
  what_is_new     TEXT,
  keywords        JSONB NOT NULL DEFAULT '[]'::jsonb,
  relation        VARCHAR(16)  NOT NULL DEFAULT 'sub_theme',
  confidence      DOUBLE PRECISION NOT NULL DEFAULT 0,
  centroid        vector(1024) NOT NULL,
  separation      DOUBLE PRECISION NOT NULL,
  cohesion        DOUBLE PRECISION NOT NULL,
  facet_score     DOUBLE PRECISION NOT NULL,
  mention_count   INTEGER NOT NULL DEFAULT 0,
  share           DOUBLE PRECISION NOT NULL DEFAULT 0,
  first_seen_at   TIMESTAMPTZ NOT NULL,
  last_seen_at    TIMESTAMPTZ NOT NULL,
  is_promotable   BOOLEAN NOT NULL DEFAULT false,
  promoted_narrative_id UUID REFERENCES narratives(id) ON DELETE SET NULL,
  alerted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_narrative_facets_slug UNIQUE (narrative_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_facets_narrative_score ON narrative_facets(narrative_id, facet_score DESC);
CREATE INDEX IF NOT EXISTS idx_facets_agency_seen     ON narrative_facets(agency_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS narrative_facet_mentions (
  facet_id    UUID NOT NULL REFERENCES narrative_facets(id) ON DELETE CASCADE,
  mention_id  UUID NOT NULL REFERENCES mentions(id) ON DELETE CASCADE,
  distance    DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (facet_id, mention_id)
);

ALTER TABLE narratives
  ADD COLUMN IF NOT EXISTS detected_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_facet_scan_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activity            VARCHAR(12),
  ADD COLUMN IF NOT EXISTS trend               VARCHAR(12),
  ADD COLUMN IF NOT EXISTS novelty_flags       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS acceleration_24h    DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS velocity_z          DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revived_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into_id      UUID REFERENCES narratives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prev_drift_score    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS drift_checked_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prev_keywords       JSONB;
UPDATE narratives SET detected_at = created_at WHERE detected_at IS NULL;  -- backfill idempotente
```
Aplicar con el **self-heal pattern** de CLAUDE.md (`ensureNarrativeFacetsSchema()` al inicio del lambda de facets; todo `IF NOT EXISTS` ⇒ no-op tras la primera corrida). No usar `eco-migration`: `exec-write` acepta una sola sentencia.

### 2.8 Firma pura
```ts
export interface FacetPoint { mentionId: string; vec: number[]; publishedAt: Date; author: string|null; pageType: string|null; }
export interface FacetCandidate {
  members: FacetPoint[]; centroid: number[];
  separation: number; cohesion: number; recencyFrac: number;
  size: number; share: number; score: number;
  firstSeenAt: Date; lastSeenAt: Date;
}
export function detectFacets(opts: {
  windowPoints: FacetPoint[];
  refCentroid: number[];
  preWindowDistances: number[];
  now: Date;
  absoluteFloor?: number;   // 0.30
  eps?: number;             // 0.28
  minPts?: number;          // 4
  minSeparation?: number;   // 0.32
  minCohesion?: number;     // 0.80
  minRecencyFrac?: number;  // 0.50
  minWindow?: number;       // 15
}): FacetCandidate[];        // ordenado por score DESC
export function quantile(sorted: number[], q: number): number;
```

---

## §3. Rediseño de la máquina de estados: tres ejes

`status` **se conserva** como columna derivada (la SPA sin bundler colorea por `NARRATIVE_STATUS_COLORS`, `screens.js:4903`, y `/api/narrative/route.ts:80-90` filtra por ella). Los ejes nuevos son columnas adicionales.

| Eje | Valores | Regla exacta |
|---|---|---|
| `activity` (¿está viva?) | `live` / `quiet` / `archived` | `live: daysSinceLast ≤ 3`; `quiet: ≤ 21`; `archived: > 21`. **Solo recencia** — ni volumen ni edad |
| `trend` (¿hacia dónde va?) | `surging` / `rising` / `steady` / `cooling` / `falling` | `surging: z ≥ 2.5 && v0 ≥ 5 && accel > 0`; `rising: z ≥ 1.0 && v0 ≥ 3`; `falling: z ≤ -1.5 && base7d ≥ 2`; `cooling: v0 < 0.5·base7d && base7d ≥ 1`; resto `steady` |
| `novelty` (¿qué hay nuevo?) | **array** de flags | `new_born` (`detected_at ≥ NOW()-48h`), `new_facet` (facet con `first_seen_at ≥ NOW()-72h`), `new_actors`, `platform_shift`, `geo_shift`, `tone_shift`, `reframed`, `split_parent`, `merged` |

**`emerging` se elimina como estado** (causa 6): pasa a ser el flag `new_born`, medido con `detected_at` (NOW() en el INSERT) y no con `born_at` (resuelve N1; `born_at` sigue siendo la fecha de la primera mención, que es lo correcto para el timeline).

**`revived` deja de ser estado** y pasa a `revived_at` + flag. Para que sea alcanzable hay **dos cambios obligatorios**:
1. `narrative-cluster/index.ts:214-222`: sustituir `AND status != 'dormant'` por `AND (last_mention_at IS NULL OR last_mention_at >= NOW() - INTERVAL '120 days')`, y aplicar **umbral doble**: `THRESHOLD_LIVE = 0.78` para `activity ∈ {live, quiet}`, `THRESHOLD_ARCHIVED = 0.86` para `archived` (no se resucita por casualidad). El `SELECT` trae `activity` y el filtro se aplica en JS tras el `ORDER BY centroid <=> $1`, subiendo `LIMIT` a `TOP_N_MATCHES + 2`.
2. `revived = prevActivity ∈ {quiet, archived} && activity === 'live'`. Ya no depende de `velocity24h > 0` sobre un estado invisible.

**Corrección de N2**: en el SELECT de `updateLifecycleStates` cambiar el criterio de ventana a
`GREATEST(m.published_at, nm.assigned_at) >= NOW() - INTERVAL '24 hours'` para los buckets de velocidad. Una mención publicada hace 4 días pero asignada hace 1 hora **cuenta como novedad**, que es lo que el analista percibe. `narrative_mentions.assigned_at` ya existe (`narratives.ts:88`).

### 3.1 Firma
```ts
export type ActivityState = 'live' | 'quiet' | 'archived';
export type TrendState    = 'surging' | 'rising' | 'steady' | 'cooling' | 'falling';
export type NoveltyFlag   = 'new_born' | 'new_facet' | 'new_actors' | 'platform_shift'
                          | 'geo_shift' | 'tone_shift' | 'reframed' | 'split_parent' | 'merged';

export interface NarrativeStateInput {
  v0: number; v1: number; v2: number;        // buckets 24h / 24-48h / 48-72h
  base7d: number; stdev7d: number;
  daysSinceLast: number;
  detectedHoursAgo: number;
  prevActivity: ActivityState | null;
  facetOpenedWithin72h: boolean;
  newAuthorShare24h: number;   authors24h: number;   newAuthors24h: number;
  platformJs: number;          reachedPress: boolean;
  geoJs: number;               newMunicipalities24h: number;
  volumeRatio: number;         nssDelta: number;     mentions24h: number;
  driftDelta7d: number;        keywordJaccard7d: number;
  lineageEvent: 'split' | 'merge' | null;
}
export interface NarrativeStateResult {
  activity: ActivityState; trend: TrendState;
  acceleration: number; zScore: number;
  novelty: NoveltyFlag[]; revived: boolean; enteredSurge: boolean;
  legacyStatus: NarrativeStatus;   // compat SPA
}
export function computeNarrativeState(i: NarrativeStateInput): NarrativeStateResult;
```
`acceleration = i.v0 - 2*i.v1 + i.v2`; `zScore = (i.v0 - i.base7d) / Math.max(i.stdev7d, 1)`.

**Mapa a `legacyStatus`** (orden de evaluación): `archived → 'dormant'`; `revived_at ≤ 7d → 'revived'`; `trend==='surging' → 'peaking'`; `novelty.includes('new_born') → 'emerging'`; `activity==='quiet' || trend∈{cooling,falling} → 'declining'`; resto `'active'`.

### 3.2 Tests que debe cubrir (`WT/packages/shared/src/__tests__/narrative-state.test.ts`)
| # | Entrada | Esperado |
|---|---|---|
| 1 | `daysSinceLast=0.5` | `activity='live'` |
| 2 | `daysSinceLast=10` | `activity='quiet'`, `legacyStatus='declining'` |
| 3 | `daysSinceLast=30` | `activity='archived'`, `legacyStatus='dormant'` |
| 4 | `mentionCount=5000, ageDays=400, daysSinceLast=0` | `activity='live'` (volumen y edad NO afectan el eje) |
| 5 | `v0=12,v1=6,v2=5, base7d=4, stdev7d=2` | `accel=+5`, `z=4`, `trend='surging'`, `enteredSurge=true` |
| 6 | `v0=12,v1=14,v2=4` | `accel=-6`, `trend='rising'` (crece pero desacelera; **no** surging) |
| 7 | `v0=0, base7d=6, stdev7d=1` | `trend='falling'` |
| 8 | `stdev7d=0, v0=3, base7d=0` | sin división por cero, `z=3` |
| 9 | `prevActivity='archived', daysSinceLast=0` | `revived=true`, flag y `legacyStatus='revived'` |
| 10 | `prevActivity='archived', daysSinceLast=25` | `revived=false` |
| 11 | `detectedHoursAgo=3, mentionCount=900` | `novelty` incluye `new_born` (tamaño irrelevante) |
| 12 | `detectedHoursAgo=200, ageDays=1` | **no** `new_born` (regresión de N1) |
| 13 | `facetOpenedWithin72h=true` | `novelty` incluye `new_facet` |
| 14 | `volumeRatio=1.05, nssDelta=-22, mentions24h=18` | `tone_shift` |
| 15 | `volumeRatio=1.9, nssDelta=-30` | **no** `tone_shift` (es crecimiento, no giro de tono) |
| 16 | `platformJs=0.4, reachedPress=true` | `platform_shift` |
| 17 | `driftDelta7d=0.2` o `keywordJaccard7d=0.3` | `reframed` |
| 18 | tres novedades a la vez | `novelty.length===3`, orden estable (para que el badge no baile) |
| 19 | `activity='archived'` + `trend='surging'` (imposible físico) | `legacyStatus='dormant'` (precedencia definida) |

---

## §4. Genealogía: `spawn` / `split` / `merge`

### 4.1 `spawn` (desprendimiento) — se apoya en las facets
Condición de promoción de facet `F` de la madre `P`:
`F.mention_count ≥ 12` **y** `F.separation ≥ 0.38` **y** `≥8` menciones de `F` con `published_at ≥ NOW()-7d` **y** `F.relation ∈ ('sub_theme','off_topic','new_frame')` **y** `F.confidence ≥ 0.6`.

```sql
BEGIN;
INSERT INTO narratives (agency_id, name, slug, summary, keywords, centroid, centroid_at_naming,
                        status, activity, trend, mention_count, born_at, detected_at, last_mention_at)
SELECT f.agency_id, f.label, f.slug || '-' || substr(f.id::text,1,4), f.what_is_new, f.keywords,
       f.centroid, f.centroid, 'emerging', 'live', 'rising', f.mention_count,
       (SELECT MIN(m.published_at) FROM narrative_facet_mentions fm JOIN mentions m ON m.id=fm.mention_id WHERE fm.facet_id=f.id),
       NOW(),
       (SELECT MAX(m.published_at) FROM narrative_facet_mentions fm JOIN mentions m ON m.id=fm.mention_id WHERE fm.facet_id=f.id)
  FROM narrative_facets f WHERE f.id = $1
RETURNING id;                                        -- := $child

INSERT INTO narrative_mentions (narrative_id, mention_id, similarity, is_primary)
SELECT $child, fm.mention_id, 1 - fm.distance, true
  FROM narrative_facet_mentions fm WHERE fm.facet_id = $1
ON CONFLICT (narrative_id, mention_id) DO NOTHING;

-- la madre CONSERVA la mención pero deja de contarla como primaria (historia intacta)
UPDATE narrative_mentions nm SET is_primary = false
 WHERE nm.narrative_id = $parent
   AND nm.mention_id IN (SELECT mention_id FROM narrative_facet_mentions WHERE facet_id = $1);

INSERT INTO narrative_lineage (agency_id, parent_id, child_id, event, strength, facet_id, evidence)
VALUES ($agency, $parent, $child, 'spawn', (SELECT separation FROM narrative_facets WHERE id=$1), $1,
        jsonb_build_object('sharedMentions',(SELECT COUNT(*) FROM narrative_facet_mentions WHERE facet_id=$1)));

UPDATE narrative_facets SET promoted_narrative_id = $child, updated_at = NOW() WHERE id = $1;
UPDATE narratives SET mention_count = (SELECT COUNT(*) FROM narrative_mentions WHERE narrative_id=$parent AND is_primary),
                      novelty_flags = array_append(novelty_flags,'split_parent') WHERE id = $parent;
COMMIT;
```
Esto es literalmente *"Ventanilla digital de OGPe se desprendió de Demoras del permiso único"*: `narrative_lineage(parent='demoras-permiso-unico', child='ventanilla-digital-ogpe', event='spawn')`.

```sql
CREATE TABLE IF NOT EXISTS narrative_lineage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  child_id  UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  event     VARCHAR(16) NOT NULL,              -- spawn | split | merge | merge_candidate
  strength  DOUBLE PRECISION NOT NULL,
  facet_id  UUID REFERENCES narrative_facets(id) ON DELETE SET NULL,
  evidence  JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmations INTEGER NOT NULL DEFAULT 1,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at  TIMESTAMPTZ,
  CONSTRAINT uq_lineage UNIQUE (parent_id, child_id, event)
);
CREATE INDEX IF NOT EXISTS idx_lineage_agency ON narrative_lineage(agency_id, detected_at DESC);
```
Es una tabla **dirigida** y aparte de `narrative_edges` (cuya PK `(source,target,edge_type)` y convención `source < target` — `narrative-edges/index.ts:96` — impiden expresar dirección).

### 4.2 `split`
Dos facets hermanas de `P` promovibles en la misma corrida **y** la masa restante de `P` en 7d (`is_primary` fuera de F1∪F2) `< 30%` del total 7d ⇒ dos filas `event='split'` en vez de `'spawn'` y `novelty_flags += 'split_parent'`.

### 4.3 `merge_candidate` (nunca automático)
```sql
WITH live AS (
  SELECT id, centroid, mention_count FROM narratives
   WHERE agency_id = $1 AND centroid IS NOT NULL AND merged_into_id IS NULL
     AND last_mention_at >= NOW() - INTERVAL '3 days'
), pairs AS (
  SELECT a.id a_id, b.id b_id, (a.centroid <=> b.centroid) dist
    FROM live a JOIN live b ON b.id > a.id
   WHERE (a.centroid <=> b.centroid) <= 0.12
), au AS (
  SELECT nm.narrative_id nid, m.author
    FROM narrative_mentions nm JOIN mentions m ON m.id = nm.mention_id
   WHERE nm.is_primary AND m.author IS NOT NULL AND m.published_at >= NOW() - INTERVAL '7 days'
   GROUP BY 1,2
), ov AS (
  SELECT p.a_id, p.b_id,
         COUNT(*)::float / NULLIF(LEAST(
           (SELECT COUNT(*) FROM au WHERE nid = p.a_id),
           (SELECT COUNT(*) FROM au WHERE nid = p.b_id)), 0) AS author_overlap
    FROM pairs p JOIN au x ON x.nid = p.a_id JOIN au y ON y.nid = p.b_id AND y.author = x.author
   GROUP BY p.a_id, p.b_id
), sh AS (
  SELECT n1.narrative_id a_id, n2.narrative_id b_id, COUNT(*)::int shared
    FROM narrative_mentions n1 JOIN narrative_mentions n2
      ON n2.mention_id = n1.mention_id AND n2.narrative_id > n1.narrative_id
   GROUP BY 1,2
)
INSERT INTO narrative_lineage (agency_id, parent_id, child_id, event, strength, evidence)
SELECT $1, p.a_id, p.b_id, 'merge_candidate', 1 - p.dist,
       jsonb_build_object('centroidSim', 1 - p.dist, 'authorOverlap', ov.author_overlap, 'sharedMentions', COALESCE(sh.shared,0))
  FROM pairs p JOIN ov ON ov.a_id = p.a_id AND ov.b_id = p.b_id
       LEFT JOIN sh ON sh.a_id = p.a_id AND sh.b_id = p.b_id
 WHERE ov.author_overlap >= 0.4 AND COALESCE(sh.shared,0) >= 5
ON CONFLICT (parent_id, child_id, event)
DO UPDATE SET confirmations = narrative_lineage.confirmations + 1,
              strength = EXCLUDED.strength, evidence = EXCLUDED.evidence;
```
Fusión real solo con `confirmations ≥ 3` (3 días consecutivos) **y** invocación explícita `{action:'merge', keep, absorb}`: mover `narrative_mentions`, sumar contadores, `centroid` = media ponderada por `mention_count`, `UPDATE absorbido SET merged_into_id, activity='archived'`, `INSERT lineage(event='merge')`.

---

## §5. Cadencia y coste

| Señal | Hoy | Propuesta | Dónde | Razón |
|---|---|---|---|---|
| nacimiento (DBSCAN) | 30 min (`workers-stack.ts:456`) | 30 min | cluster | sin cambio |
| activity/trend/accel/z | horario, 1 sola dimensión | 30 min, mismo SELECT con 3 buckets | cluster paso 4 | coste marginal cero |
| new_actors / platform / geo / tone | inexistente | 30 min (SQL agregado, sin Bedrock) | cluster paso 4 | 4 queries agregadas por narrativa live |
| **facets** | inexistente | **cada 3 h** (`cron(20 */3 * * ? *)`) + disparo inmediato cuando `z ≥ 2.5` | nuevo `eco-narrative-facets` | la novedad caduca en horas, pero el escaneo es el paso caro |
| spawn/split | inexistente | con facets (3 h) | facets | la hija debe nacer mientras es noticia |
| merge_candidate | inexistente | diario 07:00 UTC | **`eco-narrative-edges`** (ya hace SQL de pares de centroides, `:136-147`) | reuso, no lambda nueva |
| drift/reframe | semanal lunes (`:543`) | **diario 08:00 UTC**, guardando `prev_drift_score`/`prev_keywords` antes del UPDATE | drift | hoy la señal más honesta de "cambió el tema" se muestrea 1×/semana y se pierde |

**Selección de narrativas a escanear** (clave del coste): solo `activity='live'` **y** (`last_facet_scan_at IS NULL` **o** existen menciones con `assigned_at > last_facet_scan_at`) **y** `mention_count ≥ 15`. En DDEC eso son ~10-15 narrativas por corrida, no las ~150 totales.

| Recurso | Cálculo | Estimado |
|---|---|---|
| DB por narrativa | 800 (ventana) + 300 (pre-ventana) filas × 1024 float4 ≈ 4 KB/fila | ~4.4 MB |
| DB por corrida | 15 narrativas × 4 agencias | ~264 MB intra-VPC (sin coste de transferencia; RDS misma AZ) |
| CPU Lambda | parseVectorLiteral: 1.1 M floats/narrativa ≈ 50 ms; DBSCAN sobre ≤200 outliers: <20 ms | 2-4 min/corrida @1024 MB ⇒ ~0.004 USD |
| Corridas/día | 8 (cada 3 h) + ~3 disparos por z | ~0.05 USD/día de Lambda |
| Bedrock | facets nuevas × (~1.6 k tokens in / ~250 out) con Sonnet 4.6 primario; cap `FACET_MAX_NEW_PER_RUN = 8`/agencia/corrida | tasa esperada tras calibración: 15-30 facets/día en las 4 agencias ⇒ ~50 k in / 8 k out tokens/día — **un orden de magnitud menos** que un solo `eco-weekly-report` diario |
| Memoria | `memorySize: 1536`, `timeout: 600 s`, `reservedConcurrentExecutions: 1` (mismo argumento de estado compartido que `workers-stack.ts:405`) | — |

---

## §6. Alertas de narrativa — reusando el mecanismo existente

**Reuso, no invención.** `eco-alerts` es SQS **por mención** (`alerts/index.ts:43-62`): no sirve para eventos batch. El patrón correcto es el de `eco-metrics-calculator` (`metrics-calculator/index.ts:553-645`): leer `alert_rules` filtrando por `config->>'type'`, cooldown desde `alert_history`, `renderSimpleAlertHtml` + `buildSubject('Alerta', SIGLAS, …)`, envío **individual por destinatario** (SES sandbox) y `INSERT alert_history` siempre. El lambda de facets emite las alertas directamente con ese mismo código.

### 6.1 Config nueva en `WT/packages/shared/src/types.ts` (junto a la unión de la línea 121)
```ts
export interface NarrativeNoveltyConfig {
  type: 'narrative_novelty';
  events: Array<'narrative_born'|'narrative_surging'|'facet_new'|'narrative_spawn'
               |'narrative_revived'|'platform_shift'|'tone_shift'>;
  min_mentions: number;     // default 8   — menciones de la narrativa en 24h
  min_facet_score: number;  // default 1.0
  min_z: number;            // default 2.5
  cooldown_hours: number;   // default 6, por (regla, narrativa, evento)
  digest: boolean;          // true = acumula al correo Diario en vez de mail inmediato
}
export type AlertConfig = VolumeSpikeConfig | NegativeSentimentConfig
  | KeywordConfig | CrisisThresholdConfig | NarrativeNoveltyConfig;
```

### 6.2 Umbrales y ruta por evento
| Evento | Umbral | Modo |
|---|---|---|
| `narrative_surging` | `z ≥ 2.5` **y** `v0 ≥ 8` **y** `accel > 0` | inmediato |
| `narrative_spawn` | facet promovida (§4.1) | inmediato |
| `narrative_revived` | `prevActivity='archived' → live` con `v0 ≥ 5` | inmediato |
| `platform_shift` | `platformJs ≥ 0.25` **y** `reachedPress` | inmediato |
| `tone_shift` | `|volumeRatio-1| < 0.25` **y** `nssDelta ≤ -15` **y** `mentions24h ≥ 10` | inmediato |
| `facet_new` | `facet_score ≥ 1.0` **y** `size ≥ 6` **y** `confidence ≥ 0.6` | **digest** (default) |
| `narrative_born` | `mention_count ≥ min_mentions` | **digest** |
Digest = fila en `alert_history` con `notification_sent=false` y `details->>'digest'='pending'`; el correo Diario de `eco-weekly-report` (6:00 AM PR) recoge las pendientes de las últimas 24 h en un bloque "Nuevo en las narrativas" y las marca enviadas. Evita el fatigue: los dos eventos frecuentes no generan mail suelto.

### 6.3 Cooldown por narrativa (no por regla)
El cooldown actual es por regla (`metrics-calculator:577`) — con narrativas eso silenciaría todas tras la primera. Usar `details`:
```sql
SELECT triggered_at FROM alert_history
 WHERE alert_rule_id = $1 AND notification_sent = true
   AND details->>'narrativeId' = $2 AND details->>'event' = $3
 ORDER BY triggered_at DESC LIMIT 1;
CREATE INDEX IF NOT EXISTS idx_alert_history_narrative
  ON alert_history ((details->>'narrativeId'), triggered_at DESC);
```

### 6.4 Destinatarios y seed
Reusar `alert_rules.notify_emails` (jsonb) — cero UI nueva. Seed con el `NOT EXISTS` de `metrics-calculator:326-350`, tomando `notify_emails` de `report_configs.recipients` de la agencia y `is_active = false` salvo `ddecpr` (misma política que las reglas de crisis; ver CLAUDE.md "aaa y gobernadora notifican solo a agutierrez@").

### 6.5 Contenido del correo
`subject = buildSubject('Alerta', agencyShortName(slug), 'Nuevo sub-tema · <label>')`. `facts`:
| Fila | Valor |
|---|---|
| Narrativa madre | `n.name` |
| Elemento nuevo | `facet.label` |
| Qué cambió | `facet.what_is_new` |
| Menciones del sub-tema | `size` (24h / total) |
| Distancia al tema madre | `separation` a 2 decimales (`0.41`) |
| Voces nuevas | hasta 3 autores con más reach |
| Plataformas | distribución `page_type` del sub-tema |
`mention` card = mención del facet con mayor `engagement_score` (misma forma que `alerts/index.ts:228-233`). Números siempre, nunca niveles verbales (política de CLAUDE.md).

**Deep link — deuda a resolver**: `dashboardUrl` debería ser `${DASHBOARD_BASE_URL}/dashboard?agency=<slug>&screen=narrative&narrative=<id>`, pero hoy `NarrativeScreen` guarda `focusedId` en estado local (`screens.js:4803-4875`) y no lee el query string. Sin ese parse (≈10 líneas en `app.js`), el CTA cae en la lista general.

---

## §7. Contrato de API y UI (mínimo para que la señal se vea)
- `/api/narrative/route.ts:47-58` y `[id]/route.ts:47-56` **no exponen** `drift_score`, ni activity/trend/novelty/facets. Añadir al SELECT: `n.activity`, `n.trend`, `n.novelty_flags`, `n.acceleration_24h`, `n.velocity_z`, `n.detected_at`, `n.drift_score`, y en el detalle un array `facets` (`label`, `what_is_new`, `size`, `separation`, `firstSeenAt`, `promotedNarrativeId`) + `lineage` (parents/children con `event`).
- SPA: la card de detalle necesita un bloque **"Nuevo dentro de esta narrativa"** con las facets ordenadas por `facet_score` y la fecha de aparición; el badge de status pasa a dos piezas (actividad + tendencia) más chips de novedad. `novelty_flags` es un array ⇒ el orden debe ser estable (test 18) para que los chips no salten entre renders.



## Decisiones

**El umbral de "outlier" para detectar sub-temas se calibra POR narrativa (q75 + 1.5·IQR de las distancias del pre-ventana, con piso absoluto 0.30), no con una constante global**

- *Por qué:* La dispersión intrínseca varía por naturaleza de la fuente: una narrativa de prensa tiene IQR≈0.04 y una de X ≈0.15. Un umbral global produce 100% ruido en la segunda y 0% detección en la primera. El piso 0.30 está anclado en la medición del brief (14 core points a eps 0.30 en la crisis Domenech, 0 a 0.19)
- *Alternativas descartadas:* Umbral global fijo (mismo error que el eps 0.19 del clustering); percentil fijo del ranking (siempre reporta algo, incluso sin novedad)

**Sub-clustering con DBSCAN local (eps 0.28, minPts 4) sobre el conjunto de outliers, reusando dbscan() de @eco/shared**

- *Por qué:* Declara ruido explícitamente — el 70-80% de los outliers son menciones sueltas sin relación; no exige elegir k; reusa código ya testeado (narratives-math.ts:122-176); |O| son decenas, el O(n²) es irrelevante
- *Alternativas descartadas:* k-means con k pequeño: asigna TODOS los outliers a algún cluster, así que todo sub-tema saldría contaminado de ruido y siempre habría k "sub-temas" aunque no exista ninguno. HDBSCAN: no hay implementación sin dependencias y habría que escribirla

**La distancia se mide contra un centroide de referencia recalculado del pre-ventana (menciones anteriores a 72h), no contra narratives.centroid**

- *Por qué:* El centroide EWMA (alpha=0.05) ya absorbió parcialmente el sub-tema que queremos detectar, y centroid_at_naming puede tener meses de antigüedad. El pre-ventana es literalmente "el tema antes de que esto pasara"
- *Alternativas descartadas:* Usar n.centroid (auto-cancelación de la señal); usar centroid_at_naming (mide drift acumulado, no novedad reciente)

**La máquina de estados se parte en tres ejes ortogonales (activity / trend / novelty[]) y se conserva `status` como columna DERIVADA**

- *Por qué:* La SPA no tiene bundler y colorea por NARRATIVE_STATUS_COLORS (screens.js:4903) mientras /api/narrative filtra por status; derivar status permite añadir los ejes sin romper nada y migrar la UI después
- *Alternativas descartadas:* Reemplazar status por los ejes de una vez (rompe API + SPA + filtros de estado en una sola entrega); añadir más valores al enum de status (mantiene la mezcla de volumen, edad y recencia en una dimensión)

**`emerging` se elimina como estado y se sustituye por el flag new_born medido con una columna nueva `detected_at` (NOW() al insertar); `revived` deja de ser estado y pasa a `revived_at`**

- *Por qué:* emerging hoy es proxy de tamaño/edad (narratives-math.ts:250) y además inalcanzable porque born_at toma la mención más VIEJA del cluster (index.ts:418-421,480 — hallazgo N1). revived es estructuralmente inalcanzable porque la asignación excluye dormant (index.ts:218)
- *Alternativas descartadas:* Ajustar los umbrales de emerging (no arregla que born_at sea la fecha de la mención más vieja); hacer sticky el revived (no se alcanza nunca, no hay nada que hacer sticky)

**La velocidad se mide con GREATEST(m.published_at, nm.assigned_at) en vez de solo m.published_at**

- *Por qué:* Hallazgo N2: con backfill BW de 12h y cursores atrasados, una narrativa detectada ahora sobre menciones de hace 5 días tiene velocity24h = 0. El analista percibe como novedad lo que el sistema acaba de ver, no solo lo recién publicado
- *Alternativas descartadas:* Dejar published_at (la novedad operativa queda invisible); usar solo assigned_at (un backfill masivo dispararía surging falso en decenas de narrativas)

**Genealogía en una tabla nueva narrative_lineage (dirigida, con evidencia y contador de confirmaciones), no en narrative_edges**

- *Por qué:* narrative_edges es undirected por diseño (PK (source,target,edge_type) + convención source<target, narrative-edges/index.ts:96) — no puede expresar padre→hijo ni sostener el ciclo candidato→confirmado→aplicado
- *Alternativas descartadas:* Añadir edge_type='spawn' a narrative_edges (la dirección se perdería y el truncate+reinsert diario de :80 borraría la historia genealógica en cada corrida)

**Las alertas de narrativa se emiten desde el lambda de facets reusando alert_rules/alert_history/renderSimpleAlertHtml (patrón metrics-calculator:553-645), con cooldown por (regla, narrativa, evento) vía details->>'narrativeId', y digest diario para facet_new/narrative_born**

- *Por qué:* eco-alerts es SQS por mención y no sirve para eventos batch; el patrón de metrics-calculator ya resuelve cooldown, SES por destinatario y auditoría. El cooldown por regla silenciaría todas las narrativas tras la primera alerta
- *Alternativas descartadas:* Nueva tabla narrative_alerts y nuevo mecanismo de envío (duplica SES, cooldown y auditoría); todo inmediato sin digest (facet_new y narrative_born son frecuentes: alert fatigue garantizado)

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-N-0` | P0 | S | Instrumentación: detected_at, assigned_at en velocidad y 3 buckets | `WT/infra/lambda/narrative-cluster/index.ts:453-483 (INSERT: añadir detected_at=NOW()), :516-587 (SELECT de lif` | — |
| `WS-N-1` | P0 | M | computeNarrativeState: tres ejes + status derivado + tests | `WT/packages/shared/src/narratives-math.ts (nuevo export, computeLifecycleState se conserva como deprecated), W` | N-0 |
| `WS-N-2` | P0 | S | Desbloquear revived: quitar el filtro de dormant con umbral doble 0.78/0.86 | `WT/infra/lambda/narrative-cluster/index.ts:214-227 (WHERE por recencia de last_mention_at + activity en el SEL` | N-1 |
| `WS-N-3` | P0 | M | narratives-facets.ts: detectFacets() + quantile() puros con tests | `WT/packages/shared/src/narratives-facets.ts (nuevo), WT/packages/shared/src/__tests__/narratives-facets.test.t` | — |
| `WS-N-4` | P0 | S | DDL narrative_facets / narrative_facet_mentions / narrative_lineage + ALTER narratives (self-heal idempotente) | `WT/packages/database/src/schema/narratives.ts (tablas Drizzle nuevas), WT/infra/lambda/narrative-facets/schema` | N-3 |
| `WS-N-5` | P1 | L | Lambda eco-narrative-facets: escaneo, naming Bedrock, persistencia | `WT/infra/lambda/narrative-facets/index.ts (nuevo), WT/infra/lambda/narrative-facets/naming-facet.ts (FACET_TOO` | N-4 |
| `WS-N-6` | P1 | M | Backtest y calibración del grid de umbrales (27 configuraciones, 60 días) | `WT/scripts/backtest-facets.ts (nuevo, patrón de WT/scripts/preview-*.ts), salida CSV al scratchpad` | N-5 |
| `WS-N-7` | P1 | M | Señales agregadas baratas: new_actors, platform_shift, geo_shift, tone_shift | `WT/infra/lambda/narrative-cluster/index.ts (paso 4: 4 queries agregadas por narrativa live sobre mentions.auth` | N-1 |
| `WS-N-8` | P1 | L | Genealogía: spawn/split desde facets promovibles + merge_candidate diario | `WT/infra/lambda/narrative-facets/lineage.ts (transacción de §4.1 y regla de split), WT/infra/lambda/narrative-` | N-5 |
| `WS-N-9` | P2 | L | Alertas narrative_novelty reusando alert_rules/alert_history + digest en el correo Diario | `WT/packages/shared/src/types.ts:121 (NarrativeNoveltyConfig en la unión), WT/infra/lambda/narrative-facets/ale` | N-6 |
| `WS-N-10` | P2 | S | Drift diario con historia (prev_drift_score/prev_keywords) y flag reframed | `WT/infra/lambda/narrative-drift/index.ts:103-134 (guardar prev antes del UPDATE, calcular driftDelta7d y keywo` | N-1 |
| `WS-N-11` | P2 | L | Exponer los ejes, facets y lineage en la API y la SPA (bloque 'Nuevo dentro de esta narrativa') | `WT/apps/web/src/app/api/narrative/route.ts:47-58, WT/apps/web/src/app/api/narrative/[id]/route.ts:47-56 (+ arr` | N-9 |

## Riesgos

- El detector de facets vive sobre el clustering: si el otro agente no arregla el eps/pool, habrá pocas narrativas live que escanear y las facets tampoco aparecerán. Dependencia dura, no paralelizable en el orden inverso.
- Sin la corrección del filtro `status != 'dormant'` (index.ts:218) más el umbral doble 0.78/0.86, quitar ese filtro puede pegar menciones a narrativas viejas y crear falsos revived en masa. Hay que medir en dryRun cuántas asignaciones cruzan 0.86 antes de deployar.
- Coste de lectura de vectores: 4 KB por fila × 1.100 filas por narrativa. Si el filtro de selección (activity='live' + menciones nuevas + mention_count≥15) falla y escanea las ~150 narrativas de una agencia, la corrida se va a >10 min y toca el timeout. Poner cap duro de narrativas por corrida (FACET_MAX_NARRATIVES_PER_RUN=25) y ordenar por velocity_z DESC.
- Los umbrales de facet (0.32 separación, 0.80 cohesión, 0.30 piso) son estimaciones derivadas de UNA medición (229 menciones de la crisis Domenech). Sin correr el backtest de §2.5 sobre 60 días pueden estar fuera por un factor de 1.5 en cualquier dirección. No deployar alertas antes de la calibración.
- narrative_facets guarda un vector(1024) por facet; con 150 narrativas × 3-8 facets por agencia son ~4 k vectores nuevos ≈ 16 MB por agencia. Aceptable, pero conviene una poda: borrar facets con last_seen_at < NOW()-90d y sin promoted_narrative_id.
- El deep link del correo (`&narrative=<id>`) no funciona hoy: NarrativeScreen guarda focusedId en estado local (screens.js:4803-4875) y no lee el query string. Si se envían alertas antes de añadir ese parse, el CTA aterriza en la lista general y el analista no encuentra el sub-tema.
- El self-heal que crea las tablas (ensureNarrativeFacetsSchema) corre cada 3 h: si una sentencia falla a medias (p.ej. la extensión vector no está en el search_path del rol del lambda) el lambda entra en bucle de error sin crear nada. Verificar con custom-query que las 3 tablas existen tras la primera corrida en vez de confiar en el log.
- La columna status derivada tiene una precedencia arbitraria (archived antes que surging). Cualquier consumidor que hoy asuma que 'peaking' implica volumen alto puede leer mal el mapeo; conviene documentar el mapa en el mismo archivo que computeNarrativeState y exponer los ejes nuevos en la API en la misma entrega.


---

# Rediseño de la experiencia de Narrativas (SPA)

## Resumen

Narrativas es un enclave: es la única pantalla sin `.card`, sin `ecoCols`, con breakpoint propio (980px) y con paleta importada de Ant Design. Sobre esa base comete el error más caro para un cliente de gobierno: afirma cosas que no puede sostener — la píldora dice "Pico" junto a "VEL. 24H 0.0", el resumen dice "Volumen estable" a 40 px de "Sin datos temporales todavía", y tres de ocho narrativas (las dos más grandes del cliente) se renderizan en inglés crudo, sin punto de color y sin que ningún chip las cuente. Todo eso sale de una grieta: el vocabulario de estados no tiene dueño y los estados que se muestran están congelados desde el 6 de julio. Hay además dos implementaciones rivales de la misma pantalla y dos APIs rivales; la de Next.js está huérfana (nadie la enlaza), es de tema claro dentro de un producto oscuro y **no compila en runtime** (`<Link><a>` con Next 15). Decisión: la SPA sobrevive, la de Next.js se borra completa junto a `react-force-graph-2d` y al trío `/api/narratives/*`; se migran de ella tres cosas concretas (contrato de nulos `fmtNum`, copia del vacío, enum a módulo compartido). El rediseño reordena la pantalla alrededor de tres preguntas en secuencia — ¿qué hay nuevo? ¿qué está creciendo? ¿de qué va y de dónde viene? — con un riel de novedades de máximo 5 tarjetas y presupuesto de señal, una lista maestra agrupada y ordenada por aceleración, y un detalle con eje Y desde cero más cinta de hitos numerados. El streamgraph se retira (centro móvil, sin eje, con suavizado que inventa días); el force-graph se retira en las dos implementaciones (posición sin significado, layout dependiente del orden del array) y se reemplaza por un diagrama de arcos sobre eje de tiempo más un árbol de genealogía de 3 niveles en el detalle. Se fecha el estado ("En pico · al 6 jul") para que la pantalla no vuelva a mentir cuando la detección se congele.

> Nota de rutas: los cinco archivos Next.js de Narrativas **no existen en la rama `design-system-audit`**. Viven en el working tree del monorepo principal: `/Users/alegut/MyApps/eco_populicom/apps/web/src/app/narratives/page.tsx` y `/Users/alegut/MyApps/eco_populicom/apps/web/src/components/narratives/{NarrativeDetail,NarrativeGraph,NarrativeStatusBadge,TimelineSlider}.tsx` (mtime 7 jul 17:35). Las rutas API sí están en el worktree. Todas las citas `screens.js:` / `index.html:` son del worktree `design-audit`.

## 1 · Decisión: sobrevive la SPA. Se borra `/narratives` (Next.js)

| Eje | SPA `NarrativeScreen` (`screens.js:4597-5468`) | Next.js `/narratives` |
|---|---|---|
| Alcanzable | Sí: `shell.js:93` (nav, atajo `N`), `app.js:93/109/357` | **No.** Ningún enlace en `shell.js`/`app.js`; los únicos `iframe` del SPA son `settings/reports` (`screens.js:2938`, `3060`) |
| Renderiza | Sí | **No.** `page.tsx:170` usa `<Link href="/overview"><a>…</a></Link>`, patrón Next 12; con `next ^15.3.0` (`package.json:28`) lanza *Invalid `<Link>` with `<a>` child* |
| Tema | `mando` dark (`app.js:150`) | Claro hardcodeado: `background:'white'` (168), `#fafafa` (244 y `NarrativeGraph.tsx:66`), `#0A7EA4` (170/189/281), `#262626` (`NarrativeGraph.tsx:89`) |
| Serie temporal | Streamgraph con sentimiento apilado + drawer por día (`/api/narrative/[id]/day`) | `BarChart` recharts sin eje visible, sin sentimiento, sin drilldown |
| Lista maestra | Sí (búsqueda + chips + sparkline) | **No existe**: solo el grafo; el detalle se abre desde un nodo |
| Filtro | Chips de estado | `Select mode="multiple"` (177-186) + `TimelineSlider` sobre `bornAt` |
| Dependencias | 0 | `antd ^6.3.5`, `@ant-design/icons`, `@tanstack/react-query`, `recharts`, `react-force-graph-2d ^1.29.1` |
| API | `/api/narrative/*` (incluye `/[id]/day`) | `/api/narratives/*` (sin `day`) |

**Decisión.** Sobrevive la SPA. Se borran los 5 `.tsx` y las 3 rutas `/api/narratives/{route,edges,[id]}` (el singular es superconjunto: tiene `day`). Se elimina `react-force-graph-2d` de `apps/web/package.json:29` — no queda ningún consumidor.

**Lo que se migra desde Next.js (3 cosas, todo lo demás se descarta):**
1. **Contrato de nulos.** `NarrativeDetail.tsx:52-55` `fmtNum(n){ if (n == null) return '—' }` y `fmtDate` idéntico. Es la única implementación correcta del contrato en toda la feature; pasa a `window.ecoFmtNum`/`ecoFmtDate` y reemplaza los `Number(x || 0)` de `screens.js:5063`, `5067`, `5178`.
2. **Copia del vacío** (`page.tsx:211`), corrigiendo el dato: dice "cada hora", el cron es cada 30 min (`workers-stack.ts:453` `eco-narrative-cluster-30min`).
3. **El enum**, hoy triplicado (`screens.js:4600-4616`, `NarrativeStatusBadge.tsx:5-29`, prompts del lambda) → `packages/shared/src/narratives-status.ts`, consumido por `/api/narrative/route.ts` y expuesto al SPA vía `window.ECO_NARR_STATUS` inyectado en `index.html`.

**Coste**: borrar 5 archivos (~700 líneas) + 3 rutas; 1 dep menos; 4 fetch del SPA quedan intactos (`screens.js:4821`, `4822`, `4993`, `5405`). Riesgo residual: si alguien tenía `/narratives` en un marcador, hoy ya recibe un error de render, así que no hay regresión.

## 2 · Auditoría de la pantalla actual

### 2.1 · 1440 × 900

- **Jerarquía invertida.** Lo primero que se lee es una píldora naranja saturada, no el nombre: `screens.js:5041-5046` pone `.narrative-status-pill` **antes** del `<h2>`. Y `--narr-peaking: #FF6A3D` (`tokens.css:321`) es **idéntico** a `--accent: #FF6A3D` (`tokens.css:196`): el estado más común de la marca y el estado "pico" son el mismo píxel. Sumado a `--accent-fill` para fila seleccionada, `--accent` para el pico del gráfico (`5356`), para el día seleccionado (`5346`) y para los enlaces, la pantalla usa un naranja para seis significados distintos.
- **Métricas sin ventana ni unidad.** `.narrative-metric-label` es 9.5 px (`index.html:894-899`), bajo el piso de 12 px y bajo la excepción de 11 px para eyebrows (`tokens.css:61-63`). "VEL. 24H 0.0" junto a la píldora "Pico" es una contradicción directa: `computeLifecycleState` exige `velocity24h >= 5` para `peaking` (`narratives-math.ts:236`). No es un bug de render: el `status` de la fila lleva congelado desde el 6 jul y nadie lo fecha.
- **Maestro-detalle roto en el orden.** `screens.js:4867-4872` re-ordena por `RANK[status] ?? 9` y luego por menciones, deshaciendo el `ORDER BY n.mention_count DESC` que la API ya calculó (`api/narrative/route.ts:104`). Los estados desconocidos caen a `9` → las dos narrativas más grandes del cliente (214 y 168 menciones) quedan en las posiciones 6 y 7, debajo de una dormida de 44.
- **F7, la grieta.** `NARRATIVE_STATUS_ORDER` (`4600`) gobierna los chips (`4893-4907`), pero los conteos vienen de `statusCounts` (`4849-4853`), que se llena con las claves **reales**. Un estado fuera del enum: (a) `NARRATIVE_STATUS_COLORS[n.status]` → `undefined` → `.narrative-dot` sin `background` (punto invisible, `4919`); (b) etiqueta en inglés crudo (`4925`, `5043`); (c) ningún chip lo cuenta → "Todas (8)" con chips que suman 5; (d) `statusFilter` nunca puede seleccionarlo → 3 narrativas **inalcanzables por filtro**.
- **F8, `· nan%`.** `screens.js:5226` hace `(r.strength * 100).toFixed(0)` sin guarda; con `strength` ausente da `"NaN"`, y `.narrative-related-meta { text-transform: lowercase }` (`index.html:1157-1161`) lo imprime como `nan%`. Dos defectos en una línea: sin contrato de nulos y con un `text-transform` que destruye acrónimos.
- **Chips.** `.btn-chip` (`index.html:702-720`) es el chip privado de la pantalla: 10.5 px, `padding:3px 8px` → ~21 px de alto. A 12 px del canvas convive el chip **del sistema** (`className="chip"`, `screens.js:4947`). Dos componentes con el mismo nombre semántico y distinta apariencia en el mismo viewport. Los chips con `count === 0` quedan `disabled` con `opacity:.4` (`723-726`): con 8 narrativas suelen quedar 4 de 7 chips muertos ocupando media fila.
- **Vacíos invertidos.** Los cinco paneles que casi siempre están vacíos se renderizan **sin condición** (`5079-5190`: Sentimiento, Top voces, Plataformas, Primera mención, Voz influyente), mientras los dos que suelen tener contenido son condicionales (`recent.length > 0 &&` en `5192`, `related.length > 0 &&` en `5212`). Resultado: el muro de cajas. Y siete redacciones distintas del vacío: `Cargando…` (4941/5097/5115/5139/5428), `Sin datos` (5099/5117/5141/5166), `Aún sin datos (requiere ≥24h)` (5187), `Sin datos temporales todavía.` (5246), `Sin resultados` (4934), `Sin narrativas suficientes para graficar.` (4735), `Selecciona una narrativa del menú…` (4958). `.narrative-empty-small` las pone en *itálica* (`index.html:813-820`), tipografía de disculpa.
- **Zona muerta.** `.narrative-screen{min-height:calc(100vh - 140px)}` (`index.html:667`) y `.narrative-canvas{overflow:auto}` (`799-804`) sin `min-height` ni centrado. Con timeline vacío el contenido mide ~470 px contra 900 de viewport → **~310-430 px de `--canvas` vacío al fondo**. Además el canvas es su **propio scroller**, así que en escritorio hay dos scrollers anidados (menú + canvas) y la restauración de scroll del navegador no funciona.
- **Streamgraph.** `viewBox` fijo `0 0 1080 240` con `preserveAspectRatio="xMidYMid meet"` (`5312`) → toda la tipografía escala con el contenedor. A 1440 se ve ~1:1; en 1920 los `fontSize={10}` (`5357`, `5370`, `5380`) se renderizan a ~13 px (más grandes que el cuerpo de 14 px del resto); en tablet a ~8.6 px. `charts.js:75` ya tiene `useChartWidth` y esta pantalla no lo usa.
- **A11y.** 0 `aria-label` en la pantalla; el input de búsqueda (`4880-4885`) no tiene etiqueta ni `<label>`; las filas de la lista son `<li onClick>` sin `role="option"` ni foco de teclado; el único `<title>` de SVG es el del nodo del grafo (`4784`) y el del día (`5349`).

### 2.2 · 390 × 844

`@media (max-width:980px)` (`index.html:1287-1293`) es el único ajuste, y crea tres defectos nuevos:

| # | Defecto | Medida |
|---|---|---|
| M-1 | `.narrative-menu{max-height:400px}` (`1290`) come el 47% del viewport; el detalle nace bajo el pliegue y nada indica que exista | 400 de 844 px |
| M-2 | La fila de chips envuelve en 4 líneas (7 chips ×~92 px / 366 usables) ≈128 px; con búsqueda (34) y contador (16) el cromo consume 178 de los 400 px → la lista queda con ~220 px = **3.9 filas** de 180 | 178/400 |
| M-3 | El streamgraph escala 1080→~350 px (**0.324×**): los meses de `fontSize={10}` salen a **3.2 px**, igual el marcador "▸ inicio" | ilegible |
| M-4 | `.btn-chip` ~21 px de alto, `.narrative-day-close` 30×30 (`index.html:1221-1232`) | 8 objetivos <44 px |
| M-5 | `.narrative-day-panel{width:min(540px,92vw)}` (`1176-1195`) → a 390 px el overlay para cerrar mide 31 px de ancho | 31 px |

La pantalla no participó del PR #87: **0 usos** de `ecoCols`/`useBreakpoint` (`shell.js:13-52`) y 0 de `useChartWidth`.

## 3 · La pantalla rediseñada

Tres preguntas **en secuencia**, una por zona. Nada se muestra en dos zonas.

### 3.1 · Zona A — ¿Qué hay nuevo? Riel de novedades

Máximo **5 tarjetas**, ordenadas por prioridad, con "ver N más" si sobran. Cada tarjeta es **una instancia de señal**, no una métrica: `marca de señal` + nombre de la narrativa + magnitud con unidad + fecha + acción.

```
┌ ACELERA ───────────────────┐   marca: barra 3px a la izquierda, color de señal
│ Apagones y confianza en LUMA│  título 15px (--fs-body-lg), 2 líneas máx
│ +182% vs los 7 días previos │  magnitud SIEMPRE con base de comparación
│ 12 ago · 214 menciones      │  fecha + tamaño
│ Ver trayectoria →           │  acción única: enfoca y hace scroll al hito
└─────────────────────────────┘
```

Si no hay señales: **una sola línea**, no un riel vacío — `Sin señales nuevas en los últimos 7 días · última corrida del detector: 12 ago 14:20`. Si el detector no ha creado narrativas en >14 días, la línea lo dice: `El detector no ha creado narrativas desde el 6 de julio.` Honestidad antes que cosmética.

**Presupuesto de señal (la regla anti-árbol-de-navidad):**
1. Máximo 5 tarjetas y **máximo 2 del mismo tipo** de señal.
2. **Una sola marca de señal por fila** de la lista maestra: la de mayor prioridad. Las demás solo existen en el detalle.
3. Si en 24 h disparan >12 señales, el riel colapsa a **una** tarjeta: `18 señales en 24 h · revisar` → abre la lista filtrada. Una tormenta no puede convertirse en 18 tarjetas.
4. Presupuesto de color: la pantalla usa como máximo **3 matices saturados a la vez** — estado (solo en el punto/píldora), sentimiento (solo dentro del gráfico), señal (solo en riel y cinta de hitos). La selección **no es un matiz**: es borde izquierdo de 2 px + `--canvas-2`.

**Las seis señales, cómo se ven** (la detección la especifica otro agente; aquí solo el encoding):

| Señal | Etiqueta | Color | Magnitud que se muestra | Dónde vive además del riel |
|---|---|---|---|---|
| nacimiento | `NUEVA` | `--narr-emerging` | `34 menciones en 3 días` | hito ① del gráfico; grupo "Nuevas (7d)" |
| aceleración | `ACELERA` | `--warn` | `+182% vs los 7 días previos` | columna Δ de la lista; hito |
| sub-tema nuevo | `SUB-TEMA` | `--info` | `nuevo eje: "ventanilla digital" · 18 menc` | bloque Identidad + hito |
| actores nuevos | `VOCES NUEVAS` | `--cat-1` | `6 voces que no habían participado` | bloque Quién habla |
| cambio de plataforma | `SALTA A <PLATAFORMA>` | `--cat-4` | `47% en Instagram (era 8%)` | barras de Plataformas, con la barra previa en fantasma |
| split / merge | `SE DIVIDIÓ` / `SE FUSIONÓ` | `--narr-revived` | `derivó "Ventanilla OGPe"` | árbol de Procedencia + hito |

**Prioridad** (una sola fórmula, documentada en el tooltip del riel):
`prioridad = peso × log10(1 + menciones_afectadas) × recencia`, `recencia = 0.5^(horas/48)`; pesos: split/merge **5**, nueva **4**, acelera **4**, sub-tema **3**, voces nuevas **3**, salto de plataforma **2**. Empate → más menciones. Determinista y explicable: si el cliente pregunta por qué una tarjeta está arriba, la respuesta es aritmética.

### 3.2 · Zona B — ¿Qué está creciendo? Lista maestra

Deja de ser un menú alfabético-por-estado y pasa a ser una **tabla ordenada por aceleración**, agrupada, con la magnitud de crecimiento visible en la fila:

```
[⌕ buscar]            orden: Aceleración ▾   (Aceleración · Volumen · Reciente · Antigüedad)
─ NUEVAS (7 días) · 2 ────────────────────────────────────────
▌ Ventanilla digital de OGPe      34   +34    ▁▂▅█   NUEVA
─ ACELERANDO · 4 ─────────────────────────────────────────────
▌ Apagones y confianza en LUMA   214  +182%   ▁▃█▆   ACELERA
▌ Demoras del permiso único      168   +41%   ▂▄▆█
─ EN CURSO · 6 ───────────────────────────────────────────────
─ ENFRIÁNDOSE · 3 ▸ (colapsado) ──────────────────────────────
─ DORMIDAS · 165 ▸ (colapsado) ───────────────────────────────
escala compartida · máx 214 menc/día        2 sin clasificar ⚠
```

Reglas duras:
- **Una sola regla de orden, elegible y visible.** El re-sort de `4867-4872` desaparece; el orden por defecto es Δ7d descendente (que es la pregunta B), y el grupo es una **sección**, no un criterio de orden.
- **Sparkline con escala compartida.** Hoy `NarrativeSparkline` normaliza por fila (`4666` `Math.max(...data,1)`): una narrativa de 3 menciones/día se dibuja igual de alta que una de 214. La escala pasa a ser la máxima de las filas **visibles**, y se rotula una vez al pie ("máx 214 menc/día"). Normalización sin eje = prohibida (doctrina §7); un rótulo compartido es el eje mínimo aceptable.
- **Δ numérico y con signo**, nunca color solo. `+182%` con `--pos`/`--neg` **más** el signo.
- **Chips fuera.** Los 7 chips de estado se reemplazan por las secciones (que ya llevan conteo) + el selector de orden. Los chips solo reaparecen si `narratives.length >= 40`, y entonces son un `<select>` multiestado, no 7 píldoras de 21 px.
- **Fila** = 56 px mínimo en móvil, `role="option"` dentro de `role="listbox"`, navegable con ↑/↓ y Enter.
- **Aviso de integridad**: si hay estados desconocidos, pie de lista `2 sin clasificar ⚠` que **filtra** (ver §4).

### 3.3 · Zona C — ¿De qué va y de dónde viene? Detalle

Tres bloques en este orden, y **los paneles vacíos no se renderizan**:

**C1 · Identidad** — píldora de estado **fechada** + `<h1>` del nombre primero, resumen, keywords, y una línea nueva: *No confundir con:* las 3 narrativas más parecidas pero distintas (de los edges `semantic`), que es lo que responde "de qué NO va".

**C2 · Trayectoria** — un gráfico de columnas apiladas desde cero (§5) con **cinta de hitos numerados** encima y la **lista textual de hitos** debajo:
```
① 14 jul  nace · primera mención: @autor (Facebook)
② 22 jul  pico · 38 menciones en un día
③ 29 jul  renombrada (el tema se desplazó 0.31)   ← drift_score, hoy nunca se muestra
④ 02 ago  salta a Instagram (47%, era 8%)
```
La lista textual es lo que hace el hito accesible, imprimible y citable en un correo; la cinta solo la ancla en el tiempo.

**C3 · Procedencia** — árbol determinista de 3 niveles (§6) + *Quién la empezó* / *Quién la amplificó* como **una** tarjeta de dos columnas, no dos paneles (hoy `5146-5190`).

Sentimiento y Plataformas bajan al final, en acordeón, y solo si tienen datos. Cuando **ningún** bloque secundario tiene datos, se sustituyen por **una** línea: `Sin desglose de sentimiento ni plataforma para esta narrativa (0 de 44 menciones clasificadas).` Una frase con el numerador, en vez de seis cajas que dicen "Sin datos".

### 3.4 · Esquema 1440

```
┌ NARRATIVAS ·  clusters emergentes ────────── [7D 30D 90D Todo] ⟳ al 12 ago 14:20 ┐
│ A · NOVEDADES                                                    ver 9 más →     │
│ ┌NUEVA──────────┐ ┌ACELERA────────┐ ┌SE DIVIDIÓ─────┐                            │
├──────── 320px ─────────┬──────────────────── 1fr ──────────────────────────────── ┤
│ B · [⌕]  orden: Acel.▾ │ C1 · En pico · al 12 ago              [Exportar]        │
│ ─NUEVAS·2──            │      Apagones y confianza en LUMA                        │
│ ▌Ventanilla OGPe  +34  │      resumen · 6 keywords · No confundir con: …          │
│ ─ACELERANDO·4──        │ C2 · ┌ menciones/día ─────────── eje Y 0/20/40 ──────┐  │
│ ▌Apagones LUMA  +182%  │      │ ①      ②        ③   ④   ← cinta de hitos      │  │
│ ─EN CURSO·6──           │      │ ▁▃█▆▄▂ ░░░hueco░░░ ▂▅█                        │  │
│ ─ENFRIÁNDOSE·3 ▸       │      └───────────────────────────────────────────────┘  │
│ ─DORMIDAS·165 ▸        │      ① 14 jul nace · @autor (Facebook)  …               │
│ máx 214/día · 2 s/clas │ C3 · ┌ Procedencia ────────┐┌ Quién empezó / amplificó ┐│
└────────────────────────┴──────┴─────────────────────┴┴─────────────────────────┴─┘
                                 ▸ Sentimiento   ▸ Plataformas   (acordeón)
```
Grid: `window.ecoCols('minmax(300px,340px) 1fr', '1fr', '280px 1fr')`. Fuera `min-height:calc(100vh-140px)` y fuera `overflow:auto` del canvas: un solo scroller, el de la página. Cada bloque es `.card` del sistema (`card`, `card-hd`, `card-hd-title`, `card-hd-sub`), no `.narrative-panel`.

### 3.5 · Esquema 390 — dos rutas, no dos paneles

```
/narrative                                  /narrative/:id
┌ Narrativas   [7D▾]  ⟳ al 12 ago ┐        ┌ ← Volver a la lista ─────────┐
│ NOVEDADES · 3   ▸ scroll-x snap │        │ En pico · al 12 ago       ⓘ   │
│ ┌NUEVA─┐┌ACELERA┐┌VOCES─┐       │        │ Apagones y confianza en LUMA  │
│ 180 narrativas · 12 activas 7d  │        │ resumen · keywords            │
│ [Acelerando ▾]          [⌕]     │        │ ┌ gráfico alto 200, ejes 12px ┐│
│ ▌Apagones LUMA  214 +182% ▁▃█▆  │        │ │ ①  ②    ③                  ││
│ ▌Permiso único  168  +41% ▂▄▆█  │        │ └────────────────────────────┘│
│ ▌Ventanilla OGPe 34   NUEVA     │        │ Hitos (lista)                 │
│ … lista completa, sin altura fija        │ Procedencia (lista, no árbol) │
└─────────────────────────────────┘        │ ▸ Sentimiento ▸ Plataformas   │
```
- Muere `max-height:400px`. La lista es la página; el detalle es **otra ruta** (`app.js:93` gana `'/narrative/:id'`) y el "Volver" es el back del navegador.
- El gráfico usa `useChartWidth` (`charts.js:75`) y **tipografía en px absolutos** (12 px mínimo), nunca unidades de `viewBox`.
- Riel: `overflow-x:auto` + `scroll-snap-type:x mandatory`, tarjetas de `min-width:78vw`.
- Objetivos táctiles ≥44 px: filas, selector de orden, cerrar del drawer (30→44 px), y el drawer del día pasa a hoja inferior a `100vw` con `max-height:88vh`.

## 4 · Vocabulario en español, definitivo

| clave API | etiqueta | token de color | tooltip (texto exacto, se muestra al usuario) |
|---|---|---|---|
| `emerging` | **Naciente** | `--narr-emerging` | "Detectada hace menos de 7 días y todavía con menos de 50 menciones. Puede desaparecer sola." |
| `active` | **En curso** | `--narr-active` | "Recibe menciones de forma sostenida. Nada fuera de lo normal en las últimas 24 horas." |
| `peaking` | **En pico** | `--narr-peaking` (ver nota) | "En las últimas 24 horas recibió más del doble de menciones que su promedio de la semana, con un mínimo de 5." |
| `declining` | **Enfriándose** | `--narr-declining` | "Cayó más de 70% respecto de su promedio semanal, o lleva más de 7 días sin menciones nuevas." |
| `dormant` | **Dormida** | `--narr-dormant` | "Sin menciones nuevas por más de 14 días. Se conserva para poder compararla si vuelve." |
| `revived` | **Reactivada** | `--narr-revived` | "Estaba dormida y volvió a recibir menciones en las últimas 24 horas." |
| *(cualquier otra)* | **Sin clasificar** | `--narr-unknown` | "El detector devolvió un estado que esta versión del tablero no reconoce (`escalating`). El resto de los datos de la narrativa es válido." |

Cambios de nombre y por qué: *Pico→**En pico*** y *Activa→**En curso*** convierten dos etiquetas que parecían de categorías distintas en un mismo eje de intensidad; *Emergente→**Naciente*** evita el falso positivo de "emergente = importante" cuando la regla real es tamaño+edad (`narratives-math.ts:250`); *Revivida→**Reactivada*** (revivida se lee como resucitada); *Decae→**Enfriándose*** porque "decae" describe una curva y "enfriándose" describe qué hacer (nada).

**El estado se fecha, siempre.** La API añade `statusAt` (= `narratives.updated_at`). La píldora renderiza `En pico · al 12 ago` cuando `statusAt` tiene más de 48 h; con más de **7 días** el estado se degrada a `Sin actualizar` en `--narr-unknown`, con tooltip "El detector no ha recalculado esta narrativa desde el 6 jul." Esto elimina de raíz la contradicción "PICO / VEL. 24H 0.0" sin esperar el arreglo de la detección.

**Colisión de color a corregir**: `--narr-peaking: #FF6A3D` == `--accent: #FF6A3D` (`tokens.css:321` y `196`). Propuesta: `--narr-peaking: #F2542D` (dark) / `#B7331A` (light), separados del acento por claridad además de matiz, y el acento queda reservado para marca e interacción — nunca para significar estado.

**Regla de robustez (código):**
```js
// packages/shared/src/narratives-status.ts  → window.ECO_NARR_STATUS
export const NARRATIVE_STATUS = {
  emerging:  { label: 'Naciente',    color: 'var(--narr-emerging)',  order: 1, group: 'nuevas' },
  peaking:   { label: 'En pico',     color: 'var(--narr-peaking)',   order: 2, group: 'acelerando' },
  active:    { label: 'En curso',    color: 'var(--narr-active)',    order: 3, group: 'encurso' },
  declining: { label: 'Enfriándose', color: 'var(--narr-declining)', order: 4, group: 'enfriando' },
  revived:   { label: 'Reactivada',  color: 'var(--narr-revived)',   order: 5, group: 'acelerando' },
  dormant:   { label: 'Dormida',     color: 'var(--narr-dormant)',   order: 6, group: 'dormidas' },
};
export function narrStatus(raw) {
  const k = String(raw ?? '').toLowerCase();
  return NARRATIVE_STATUS[k] || {
    label: 'Sin clasificar', color: 'var(--narr-unknown)', order: 7,
    group: 'sinclasificar', unknown: true, raw: k || '(vacío)',
  };
}
```
Cuatro invariantes que el rediseño debe cumplir:
1. **Nunca `background: undefined`**: `narrStatus()` siempre devuelve color → el punto siempre existe.
2. **Los grupos siempre suman el total.** El grupo `sinclasificar` **aparece solo si tiene filas** y lleva el conteo; `Σ grupos === narratives.length` es un `console.assert` en desarrollo.
3. **Filtrable**: el estado desconocido es un valor de filtro legítimo (`Sin clasificar (2)`), nunca un estado inalcanzable.
4. **Trazable**: el tooltip muestra la clave cruda entre backticks; nunca se traduce ni se oculta. Y `/api/narrative/route.ts` devuelve `status` (normalizado si coincide) **y** `statusRaw` sin tocar.

Aplica igual a **plataformas** y **tipos de arista**: `platformLabel` (`4627-4633`) y `edgeTypeLabel` (`4639-4641`) ya tienen fallback, pero `edgeTypeLabel` devuelve `''` con `key` nulo → la línea queda `· 42%` sin sujeto; debe devolver `'Relación sin tipo'`.

Y el formateador que produce `nan%`:
```js
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
```
más: quitar `text-transform: lowercase` de `.narrative-related-meta` (`index.html:1157-1161`).

## 5 · Visualización en el tiempo

**El streamgraph se retira.** Cuatro razones, todas medibles:

| # | Defecto | Línea |
|---|---|---|
| S-1 | **Sin eje Y y con línea base móvil**: `baseline = -total/2` (`5262`), `yScale` (`5257`), y el único trazo horizontal es un `--hairline` al 50% de opacidad (`5316`). La magnitud se codifica como grosor alrededor de un centro que se mueve: la percepción de grosor es mucho peor que la de longitud desde una base común | `5255-5275` |
| S-2 | **Suavizado que inventa días**: Catmull-Rom (`smoothPath`, `4644-4660`) sobre conteos diarios; con días en cero sobre-oscila y dibuja volumen donde hubo silencio | `5280` |
| S-3 | **Hueco ≠ cero, sin contrato**: el SQL agrupa solo días con filas (`api/narrative/[id]/route.ts:66-79`), y `xScale` es temporal (`5253`), así que 3 meses de silencio se interpolan como una cinta recta | `5253` |
| S-4 | **Anotaciones que colisionan con los datos**: pico en `--accent` (`5356-5359`), nacimiento en `--pos` (`5368-5371`) — y `--pos` es exactamente la capa "positivo" del propio gráfico | `5286-5288` |

| Alternativa | Veredicto |
|---|---|
| **Columnas/área apiladas desde cero + eje Y** | **Adoptar.** Base común, magnitud comparable entre narrativas y entre días, y admite el hueco explícito |
| **Cinta de hitos con anotaciones** | **Adoptar**, encima del gráfico y con lista textual numerada debajo. Es lo que responde "de dónde viene" |
| **Small multiples** | **Adoptar solo en la lista maestra** (el sparkline) y **con escala compartida** rotulada |
| Streamgraph | Rechazar (S-1…S-4) |
| Ridgeline / horizon | Rechazar: coste de aprendizaje alto para un lector de gobierno; no resuelve el hueco |

**Especificación del gráfico C2:**
- Base en cero, 3 marcas de eje Y (`0`, `max/2`, `max`) con `--chart-grid`; `--chart-axis` para la línea.
- Cubetas por ventana: **≤45 días → columna diaria**; 46-180 → **semanal ISO**; >180 → **mensual**, con subtítulo `agrupado por mes` en `card-hd-sub`. Nunca se agrupa sin decirlo.
- **Huecos explícitos**: la API debe emitir la serie **densa**; los días sin dato se pintan con `--chart-void` (`tokens.css:349`, ya existe y documenta "hueco de datos ≠ cero real"), y un día con 0 menciones se pinta como columna de altura 0 con la marca del eje. Son dos cosas distintas y se ven distintas.
```sql
-- reemplaza el timeline de api/narrative/[id]/route.ts:66-79
WITH dias AS (
  SELECT generate_series(
    date_trunc('day', $2::timestamptz AT TIME ZONE 'America/Puerto_Rico'),
    date_trunc('day', NOW() AT TIME ZONE 'America/Puerto_Rico'),
    INTERVAL '1 day')::date AS d)
SELECT to_char(dias.d,'YYYY-MM-DD') AS day,
       COUNT(m.id)::int AS mentions,
       COUNT(m.id) FILTER (WHERE m.nlp_sentiment IN ('positivo','positive'))::int AS positive,
       COUNT(m.id) FILTER (WHERE m.nlp_sentiment IN ('neutral','neutro'))::int   AS neutral,
       COUNT(m.id) FILTER (WHERE m.nlp_sentiment IN ('negativo','negative'))::int AS negative,
       COUNT(m.id) FILTER (WHERE m.nlp_sentiment IS NULL)::int AS unclassified
  FROM dias
  LEFT JOIN narrative_mentions nm ON nm.narrative_id = $1 AND nm.is_primary = true
  LEFT JOIN mentions m ON m.id = nm.mention_id AND m.is_duplicate = false
       AND date_trunc('day', m.published_at AT TIME ZONE 'America/Puerto_Rico')::date = dias.d
 GROUP BY 1 ORDER BY 1 ASC
```
`$2` = `born_at`. Añade `unclassified` como **cuarta capa** en `--chart-void`: hoy `positive+neutral+negative` puede ser menor que `mentions` y la diferencia se pierde en silencio (los tres `FILTER` de `[id]/route.ts:68-70` no cubren `NULL`), lo que hace que las tres capas apiladas no sumen el total que dice la métrica de cabecera. Es la versión local de F9.
- Firma: `NarrativeTrajectory({ series, bucket, milestones, selectedDay, onSelectDay, width })`, dentro de `charts.js` y consumiendo `--chart-*`. Tipografía de eje: 12 px absolutos.

## 6 · El grafo

**No sobrevive, en ninguna de las dos implementaciones.** Razones con líneas:

| # | Defecto | Línea |
|---|---|---|
| G-1 | **La posición no significa nada** y cambia entre cargas de datos: la semilla es circular por índice del array (`4697-4700`) y el array viene de `ORDER BY n.mention_count DESC, n.born_at DESC` (`api/narrative/route.ts:104`) → una mención nueva reordena el mapa completo |
| G-2 | **El conjunto de nodos es arbitrario**: si hay <40 conectados se rellena con los de más menciones **sin conexiones** (`4686-4692`), y nada distingue visualmente a un nodo relleno de uno conectado |
| G-3 | **Los edges no son genealogía**: solo `co_occurrence`, `author_overlap`, `semantic` (`packages/database/src/schema/narratives.ts:96-99`), los tres mezclados en el mismo trazo, diferenciados solo por grosor (`4770`) |
| G-4 | O(n²)×220 iteraciones en el render (`4702-4727`) con tope 80 nodos, en el hilo principal |
| G-5 | La versión Next.js añade `react-force-graph-2d` + canvas para el mismo resultado, sobre `#fafafa` |

**Reemplazo, dos vistas:**

**(a) Línea de vida de narrativas** (sustituye "Mapa de conexiones" en la vista general): **diagrama de arcos con eje de tiempo**. `x = born_at` (eje datado, real), `y = rango por menciones` (fila 1 = la más grande). Las relaciones son arcos por encima del eje; **una faceta por tipo de arista** (3 tiras apiladas), porque "comparten autores" y "se parecen" no son la misma afirmación. Determinista por construcción (no hay simulación), sin librería, y responde algo que el force-graph no podía: **cuándo** nació cada cosa y qué narrativas viejas siguen enganchadas a las nuevas. Tope duro **40 nodos** con rótulo explícito `mostrando 40 de 180 por menciones`; el resto se alcanza por la lista.

**(b) Procedencia** (en el detalle, C3): árbol de 3 niveles `antecesora → esta → derivadas`, orden determinista `born_at ASC, name ASC`, `x = tiempo`, `y = ranura`. Requiere tipos de arista `split`/`merge`/`spawn` que hoy **no existen**; hasta que existan, el bloque no simula genealogía: renderiza `Todavía no hay derivaciones registradas: el sistema conoce parecidos, no derivaciones.` y muestra la lista de parecidos con su tipo y fuerza. En móvil el árbol es una lista indentada, no un SVG.

Si alguien exige nodos-y-enlaces: las restricciones son **layout determinista** (misma entrada → mismos píxeles), **posición con significado** (x = tiempo, y = rango), **tope 40 nodos declarado**, y **una faceta por tipo de arista**. Un force-graph que cumpla las cuatro ya es un diagrama de arcos.

## 7 · Vacíos y primer uso

| Escenario | Qué se ve |
|---|---|
| **0 narrativas** | **Sin cromo de maestro-detalle** (hoy se pinta el esqueleto y el usuario ve un menú vacío al lado de un canvas vacío). Un solo bloque centrado: título `Aún no hay narrativas para esta agencia`; párrafo `Se generan automáticamente cada 30 minutos a partir de menciones con embedding.`; línea de estado real `Última corrida del detector: 12 ago 14:20 · 0 narrativas creadas en los últimos 14 días`; y si eso último es cierto, la nota honesta `El detector está bajo revisión: el umbral de agrupación no está produciendo narrativas nuevas.`; CTA `Ver Tópicos →`. Nunca "cargando" perpetuo |
| **3 narrativas** | Sin chips (7 chips para 3 filas es ruido) y **sin secciones** (`narratives.length < 8` → lista plana por aceleración). Se enfoca la primera automáticamente. El riel muestra señales reales o **una** línea `Sin señales nuevas en 7 días`. El detalle colapsa todo panel sin datos y sustituye el conjunto por una frase con numerador |
| **180 narrativas** | Tira de universo: `180 narrativas · 12 con actividad en 7 días · 154 dormidas`. Lista **agrupada en 5 secciones**; `Enfriándose` y `Dormidas` **colapsadas por defecto** (eso saca 168 filas del scroll de entrada, hoy son 180 filas de ~50 px = ~9,000 px de scroll continuo); dentro de cada grupo, tope 25 filas + `ver 25 más`; búsqueda y orden **sticky**; el grupo abierto por defecto es `Acelerando`, no "todas". Sin virtualización: con los grupos colapsados el DOM inicial son ~20 filas |

Copia de vacío unificada — **tres redacciones, no siete**: `Cargando…` (solo con skeleton, nunca en itálica), `Sin datos de <cosa> para esta narrativa`, y `Requiere 24 h de historia`. Se elimina `.narrative-empty-small{font-style:italic}` (`index.html:813-820`).

## 8 · Verificación

Dentro del marco real de la App (tema `mando`, `NarrativeScreen` montado por `app.js:357`), nunca el componente aislado. Cuatro fixtures obligatorias para `/api/narrative`:
1. `status:'escalating'` + `status:'sustained'` (F7) → los grupos deben sumar el total y el filtro `Sin clasificar` debe existir.
2. `strength: null` en un edge (F8) → `—`, jamás `nan%`.
3. `timeline` con 3 meses de hueco + un día en `0` → hueco en `--chart-void`, cero como columna de altura 0.
4. `statusAt` de hace 30 días con `velocity24h: 0` y `status:'peaking'` → la píldora debe decir `Sin actualizar`, no `En pico`.
Medir en 1440×900 y 390×844: 0 desbordes horizontales, 0 tipografía <12 px, 0 objetivos táctiles <44 px, y **0 px de zona muerta** al fondo del canvas.

## Decisiones

**Sobrevive la SPA (`screens.js:4597-5468`); se borran los 5 archivos Next.js de Narrativas, el trío `/api/narratives/*` y la dependencia `react-force-graph-2d`**

- *Por qué:* La página Next.js está huérfana (nadie la enlaza: `shell.js:93` y `app.js:93/109/357` solo conocen el SPA; los únicos iframes son settings/reports), es de tema claro dentro de un producto oscuro, y no renderiza: `page.tsx:170` usa `<Link href="/overview"><a>` con `next ^15.3.0`, patrón eliminado en Next 13. La SPA además tiene más features (streamgraph, drawer por día, lista maestra) y `/api/narrative/*` es superconjunto de `/api/narratives/*` (tiene `/[id]/day`)
- *Alternativas descartadas:* Migrar el SPA a Next.js: obligaría a reconstruir el tema mando en Ant Design y a arrastrar antd+recharts+force-graph. Mantener las dos: duplica el enum de estados por tercera vez y el drift ya produjo dos APIs divergentes

**Migrar exactamente 3 cosas desde Next.js: el contrato de nulos `fmtNum/fmtDate` (`NarrativeDetail.tsx:52-55`), la copia del empty state (`page.tsx:211`, corrigiendo 'cada hora'→'cada 30 minutos') y el enum de estados a `packages/shared/src/narratives-status.ts`**

- *Por qué:* `if (n == null) return '—'` es la única implementación correcta del contrato de nulos en toda la feature y es la cura de F8 y de los `Number(x || 0)` de `screens.js:5063/5067/5178`. El enum está triplicado (SPA, badge, prompts del lambda) y de esa grieta sale F7 completo
- *Alternativas descartadas:* Reescribir el contrato de nulos desde cero en el SPA: mismo coste, sin la garantía de que ya funciona en producción

**Fechar el estado: la API añade `statusAt` (= `narratives.updated_at`); la píldora renderiza 'En pico · al 12 ago' sobre 48 h y degrada a 'Sin actualizar' sobre 7 días**

- *Por qué:* Cura de raíz la contradicción 'PICO / VEL. 24H 0.0' sin esperar el arreglo de la detección. `computeLifecycleState` exige `velocity24h >= 5` para `peaking` (`narratives-math.ts:236`), así que la píldora actual es una etiqueta de hace 5 semanas presentada como presente
- *Alternativas descartadas:* Recalcular el estado en el cliente desde el timeline: duplicaría la máquina de estados en un cuarto lugar. Ocultar la píldora cuando velocity=0: esconde el problema en vez de datarlo

**Retirar el streamgraph y reemplazarlo por columnas apiladas desde cero con eje Y, huecos explícitos en `--chart-void` y cinta de hitos numerados con lista textual**

- *Por qué:* El streamgraph no tiene eje Y y su línea base se mueve (`baseline = -total/2`, `screens.js:5262`); el suavizado Catmull-Rom (`4644-4660`) inventa volumen en días de silencio; y el SQL solo emite días con filas (`api/narrative/[id]/route.ts:66-79`) así que un hueco de 3 meses se interpola como cinta recta. La doctrina prohíbe normalizar sin eje
- *Alternativas descartadas:* Ridgeline/horizon: coste de aprendizaje alto para un lector de gobierno y no resuelve el hueco. Mantener el streamgraph con eje añadido: el centro móvil sigue midiendo peor que la longitud desde base común

**Retirar el force-graph en ambas implementaciones; reemplazar por diagrama de arcos sobre eje de tiempo (x = born_at, y = rango por menciones, una faceta por tipo de arista, tope 40 nodos declarado) y árbol de genealogía de 3 niveles en el detalle**

- *Por qué:* La semilla del layout es circular por índice de array (`screens.js:4697-4700`) y el array viene de `ORDER BY mention_count DESC` (`api/narrative/route.ts:104`): una mención nueva reordena el mapa entero. Además el conjunto de nodos se rellena con nodos sin conexiones (`4686-4692`) sin distinguirlos, y los edges no son genealogía (solo co_occurrence/author_overlap/semantic, `schema/narratives.ts:96-99`)
- *Alternativas descartadas:* Force-graph con semilla fija: sigue sin dar significado a la posición y mantiene O(n²)×220 en el hilo principal. Matriz de vecindad ordenada: más honesta pero menos legible para el cliente; queda como opción si piden comparación par a par

**Presupuesto de señal: máximo 5 tarjetas en el riel, máximo 2 del mismo tipo, una sola marca de señal por fila de lista, colapso a una tarjeta si disparan >12 señales en 24 h, y máximo 3 matices saturados simultáneos con la selección expresada como borde+superficie (no como matiz)**

- *Por qué:* Hay 6 señales de novedad y 6 estados; sin presupuesto la pantalla se convierte en un árbol de navidad la primera vez que la detección funcione. Hoy el problema es el inverso pero el mismo: el naranja `#FF6A3D` significa marca, acento, pico, fila seleccionada, pico del gráfico y día seleccionado a la vez
- *Alternativas descartadas:* Mostrar todas las señales con iconografía: el color solo ya falla a11y y multiplicar iconos no crea jerarquía

**Sustituir los 7 chips de estado por secciones agrupadas en la lista maestra, con orden por defecto = aceleración (Δ7d) y selector de orden visible**

- *Por qué:* `screens.js:4867-4872` re-ordena por `RANK[status] ?? 9`, deshaciendo el orden por volumen que la API ya calculó y enterrando las dos narrativas más grandes del cliente (214 y 168 menciones) en las posiciones 6 y 7. Los chips son 10.5px/21px de alto (`index.html:702-720`), envuelven en 4 filas a 390px y 4 de 7 suelen estar deshabilitados
- *Alternativas descartadas:* Arreglar los chips manteniéndolos: seguirían consumiendo 128 px de los 400 disponibles en móvil sin responder ninguna de las tres preguntas

**Renombrar el vocabulario: Naciente / En curso / En pico / Enfriándose / Dormida / Reactivada, cada uno con tooltip cuantitativo, más 'Sin clasificar' con la clave cruda visible; `narrStatus()` como único acceso**

- *Por qué:* 'Pico/Activa/Emergente' se leen como categorías inconexas cuando en realidad son un eje de intensidad; 'Emergente' sugiere importancia mientras la regla real es tamaño+edad (`narratives-math.ts:250`). El fallback obligatorio elimina de un golpe los 4 síntomas de F7 (punto sin color, inglés crudo, conteo que no suma, estado no filtrable)
- *Alternativas descartadas:* Cerrar el enum en la API y rechazar lo desconocido: dejaría 3 de 8 narrativas fuera de la respuesta, empeorando el problema

## Workstreams

| id | fase | tam | Qué | Archivos | Depende de |
|---|---|---|---|---|---|
| `WS-N-A` | P0 | M | Vocabulario de estados como contrato compartido | `packages/shared/src/narratives-status.ts (nuevo); apps/web/src/app/api/narrative/route.ts:19-34,104-120; apps/` | — |
| `WS-N-B` | P0 | S | Contrato de nulos y limpieza de formateo | `apps/web/public/eco-prototype/screens.js:5063,5067,5178,5226,5090-5092; apps/web/public/eco-prototype/index.ht` | — |
| `WS-N-C` | P0 | S | Píldora de estado fechada y cabecera de detalle reordenada | `apps/web/public/eco-prototype/screens.js:5039-5070; apps/web/public/eco-prototype/index.html:823-908; apps/web` | N-A, N-B |
| `WS-N-D` | P0 | L | Lista maestra: secciones, orden por aceleración, sparkline con escala compartida | `apps/web/public/eco-prototype/screens.js:4855-4936,4662-4674; apps/web/public/eco-prototype/index.html:665-798` | N-A |
| `WS-N-E` | P0 | M | Serie temporal densa en la API (huecos y no clasificados) | `apps/web/src/app/api/narrative/[id]/route.ts:64-79` | — |
| `WS-N-F` | P1 | XL | NarrativeTrajectory: columnas apiladas desde cero + cinta de hitos | `apps/web/public/eco-prototype/charts.js (nuevo componente, junto a useChartWidth:75); apps/web/public/eco-prot` | N-E |
| `WS-N-G` | P1 | L | Riel de novedades con presupuesto de señal | `apps/web/public/eco-prototype/screens.js:4877-4949 (zona A nueva); apps/web/public/eco-prototype/tokens.css (t` | N-A, N-D |
| `WS-N-H` | P1 | XL | Retirar el force-graph y construir Línea de vida + Procedencia | `apps/web/public/eco-prototype/screens.js:4676-4801 (borrar NarrativeGraph),4946-4956,5005-5017,5212-5232` | N-A |
| `WS-N-I` | P1 | M | Colapso de vacíos y unificación de copia | `apps/web/public/eco-prototype/screens.js:5079-5190,4934,4941,4958,5244-5247,5428-5430; apps/web/public/eco-pro` | — |
| `WS-N-J` | P1 | L | Móvil: detalle como ruta propia y drawer como hoja inferior | `apps/web/public/eco-prototype/app.js:93,109,336,357; apps/web/public/eco-prototype/screens.js:4974-4981,5391-5` | N-D |
| `WS-N-K` | P2 | S | Borrar la implementación Next.js y las rutas duplicadas | `/Users/alegut/MyApps/eco_populicom/apps/web/src/app/narratives/page.tsx; /Users/alegut/MyApps/eco_populicom/ap` | N-A, N-B, N-L |
| `WS-N-L` | P2 | M | Empty states de 0, 3 y 180 narrativas | `apps/web/public/eco-prototype/screens.js:4877-4984,4933-4935` | N-D |

## Riesgos

- El rediseño de Narrativas depende de la taxonomía de señales que especifica otro agente. Si esa detección no llega, el riel de novedades queda permanentemente en su estado honesto ('Sin señales nuevas en 7 días' / 'El detector no ha creado narrativas desde el 6 de julio'). Eso es aceptable y honesto, pero deja la pregunta 1 sin respuesta útil: el valor de la pantalla rediseñada está acotado por el arreglo del clustering.
- La cinta de hitos incluye split/merge, que hoy no existen como `edge_type` (`schema/narratives.ts:96-99`: solo co_occurrence, author_overlap, semantic). Hasta que existan, el bloque Procedencia y 2 de las 6 señales renderizan su estado vacío. No se debe simular genealogía a partir de similitud semántica: sería inventar causalidad.
- Fechar el estado ('Sin actualizar' sobre 7 días) va a marcar como no actualizadas prácticamente todas las narrativas de todas las agencias el día que se despliegue, porque el detector está congelado desde el 6 de julio. Es la verdad, pero es una regresión visual severa que hay que anunciar al cliente antes del deploy, no después.
- La serie densa con `generate_series` desde `born_at` puede devolver >700 filas por narrativa (born_at de 2024 + ventana Max) y el SQL propuesto hace un LEFT JOIN de tres tablas por día. Hay que medir el plan en la RDS real antes de shippearlo; si duele, la mitigación es acotar la serie a la ventana del selector de periodo en vez de a toda la vida de la narrativa.
- Añadir la cuarta capa `unclassified` al gráfico va a mostrar por primera vez que las tres capas de sentimiento no suman el total de menciones (los tres FILTER de `api/narrative/[id]/route.ts:68-70` no cubren NULL). Es la versión local de F9 y probablemente revele huecos de clasificación grandes en algunas narrativas. Prepararse para esa conversación.
- Convertir el detalle móvil en una ruta propia (`/narrative/:id`) toca el router del SPA (`app.js:93`, `109`), que hoy asume una pantalla por ruta sin parámetros. Es la parte con más riesgo de regresión del rediseño: afecta deep links, el atajo `N` (`app.js:336`) y la restauración de scroll.
- Borrar `react-force-graph-2d` de `apps/web/package.json:29` cambia el lockfile y la imagen de ECS. El web app se despliega por push a main (deploy.yml→ECR→ECS), así que el borrado y el rediseño del SPA deben ir en el mismo PR para no dejar main en un estado donde el dist referencie algo inexistente.
- El diagrama de arcos con tope de 40 nodos deja 140 de 180 narrativas fuera de la vista general para una agencia madura. El rótulo 'mostrando 40 de 180 por menciones' es obligatorio; sin él se repite el pecado del force-graph actual, que mezcla nodos conectados y de relleno sin decirlo (`screens.js:4686-4692`).


---

