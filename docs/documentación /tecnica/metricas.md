# Métricas

Definiciones **exactas** de las métricas compuestas de ECO: fórmula, código,
rango y ventana de cálculo. Para la lectura conceptual ver
[Metodología de métricas](../fundamentos/metodologia-metricas.md), que enlaza a
este archivo para las fórmulas.

## Single source of truth

Todas las fórmulas viven en una sola función:
`calculateMetrics(agg, history)` en
**`packages/shared/src/metrics.ts:119-267`**.

La consumen tres lugares con la misma implementación:

- **`eco-metrics-calculator`** — snapshot diario por agencia, sobre el día
  calendario AST (`metrics-calculator/index.ts:143-200`).
- **`/api/eco-data`** y **`/api/ai/metric-insight`** — sobre la ventana arbitraria
  del periodo del usuario, vía `loadMetricsForWindow`
  (`metrics.ts:389-410`, `eco-data/route.ts:349-353`).

`calculateMetrics` recibe:
- `agg: DailyAggregates` — conteos y sumas brutas de la ventana
  (`metrics.ts:27-39`).
- `history: HistoricalSnapshot[]` — hasta 30 snapshots **previos** ordenados
  desc por fecha, para las estadísticas rolling (`metrics.ts:42-50`).

Si `totalMentions === 0`, todas las métricas devuelven `null`
(`metrics.ts:126-144`). Helpers: `average`, `sum`, `stddev` (poblacional, divide
por N), `round` (`metrics.ts:75-94`).

Las columnas destino están en `daily_metric_snapshots`
(`packages/database/src/schema/daily-metric-snapshots.ts`).

---

## NSS — Net Sentiment Score

```ts
// metrics.ts:147
const nss = ((positiveCount - negativeCount) / totalMentions) * 100;
```

- **Rango**: −100 a +100. Redondeado a 2 decimales (`metrics.ts:251`).
- `positiveCount`/`negativeCount` se cuentan con
  `COALESCE(nlp_sentiment, bw_sentiment)` mapeando `positivo|positive` y
  `negativo|negative` (`metrics.ts:300-302`).

### NSS 7d / 30d

```ts
// metrics.ts:149-155
const nssValues = history.filter(h => h.nss != null).map(h => h.nss!);
const nss7d  = average(nssValues.slice(0, min(7,  len)));
const nss30d = average(nssValues.slice(0, min(30, len)));
```

Promedio simple del NSS de los últimos 7 / 30 snapshots diarios previos. `null`
si no hay historia.

---

## Reputation Momentum

```ts
// metrics.ts:158-161
const nss7dAgo = nssValues.length >= 7 ? nssValues[6]
               : (len > 0 ? nssValues[len-1] : null);
const reputationMomentum = nss7dAgo != null ? nss - nss7dAgo : null;
```

Diferencia entre el NSS actual y el NSS de hace 7 días (`nssValues[6]`, índice 6 =
séptimo snapshot previo). Rango efectivo −200 a +200.

---

## Engagement Rate

```ts
// metrics.ts:164-167
const totalInteractions = totalLikes + totalComments + totalShares;
const engagementRate = totalReach > 0
  ? (totalInteractions / totalReach) * 100 : null;
```

Interacciones sobre alcance, en %. `null` si reach 0.

## Amplification Rate

```ts
// metrics.ts:170-172
const amplificationRate = totalInteractions > 0
  ? (totalShares / totalInteractions) * 100 : null;
```

Proporción de las interacciones que son shares (viralidad), en %.

---

## Engagement Velocity (z-score)

```ts
// metrics.ts:175-185
const avgEngToday = totalEngagementScore / totalMentions;
const engPerMentionHistory = history
  .filter(h => h.totalMentions > 0).slice(0, 30)
  .map(h => h.totalEngagementScore / h.totalMentions);
if (engPerMentionHistory.length >= 7) {
  const m = average(...); const s = stddev(...);
  engagementVelocity = s > 0 ? (avgEngToday - m) / s : 0;
}
```

Z-score del engagement por mención de hoy contra la media de los últimos 30 días.
Requiere ≥7 días de historia. Redondeado a **3 decimales** (`metrics.ts:256`).
Rango típico ≈ −3 a +3.

---

## BHI — Brand Health Index (V2, mayo 2026)

```ts
// metrics.ts:187-206
const effectiveNss30d = nss30d ?? nss;
const nssNormalized   = (effectiveNss30d + 100) / 200;          // 0..1
const engRate30d      = average(history[0..30].engagementRate);  // o engagementRate actual
const engNormalized   = engRate30d != null ? min(engRate30d / 5.0, 1.0) : 0;
const reach30d        = sum(history[0..30].totalReach) || totalReach;
const reachLog        = reach30d > 0 ? log10(reach30d) : 0;
const reachNormalized = max(0, min(nssSign(nss) * reachLog / 7 + 0.5, 1.0));
const pertinenceRatio = highPertinenceCount / totalMentions;

const brandHealthIndex = nssNormalized   * 0.40
                       + engNormalized   * 0.25
                       + reachNormalized * 0.20
                       + pertinenceRatio * 0.15;
```

- **Rango**: 0 a 1 (2 decimales). Ponderación: NSS 30d **0.40**, engagement
  **0.25**, alcance **0.20**, pertinencia **0.15**.
- `nssSign(nss)` (`metrics.ts:102-107`): devuelve `+1` si NSS>0, `−1` si NSS<−20,
  `0` en el rango intermedio. **El alcance con sentimiento negativo resta** al
  índice (difundir lo negativo no es salud). Decisión del backtest V1c: usar el
  NSS reactivo del periodo, no el lento `nss_30d`, para que capture crisis del
  mismo día.
- `engNormalized` se satura a 1.0 cuando el engagement rate 30d llega a 5%.
- `reachNormalized` usa `log10` para comprimir el alcance.

---

## Crisis Risk — V3 (mayo 2026, post-QA)

```ts
// metrics.ts:237-245
const negShare  = negativeCount / totalMentions;
const pertShare = highPertinenceCount / totalMentions;
const crisisSeverity   = min(negShare / 0.7, 1.0);
const volZ             = volumeAnomalyZscore ?? 0;
const crisisVelocity   = max(0, min(volZ / 3, 1.0));
const crisisRelevance  = min(pertShare / 0.5, 1.0);
const crisisConfidence = totalMentions > 1 ? min(log10(totalMentions) / 2, 1.0) : 0;
const rawCrisis        = crisisSeverity*0.5 + crisisVelocity*0.3 + crisisRelevance*0.2;
const crisisRiskScore  = rawCrisis * crisisConfidence;
```

- **Rango**: 0 a 1 (3 decimales, `metrics.ts:257`). Los cuatro subcomponentes se
  persisten para auditoría (`crisis_severity/velocity/relevance/confidence`).
- **Subcomponentes**:
  - **Severity** = `negShare / 0.7` saturado a 1 → llega al máximo con 70% de
    menciones negativas.
  - **Velocity** = `volumeAnomalyZscore / 3` recortado a [0,1] → máximo con z=3.
  - **Relevance** = `pertShare / 0.5` saturado a 1 → máximo con 50% de alta
    pertinencia.
  - **Confidence** = `log10(total) / 2` saturado a 1 → amortigua volúmenes bajos
    (3 menciones con 1 negativa no debe "gritar crisis"). Con `total<=1` es 0.
- **Ponderación**: severidad 0.5, velocidad 0.3, relevancia 0.2; todo multiplicado
  por confidence.
- **Diseño V3**: la versión anterior tenía un *gate* binario
  (`(negShare>0.30 && total>=20) || negativeCount>=30`) que dejaba el score pegado
  a 0 la mayoría de los días. V3 elimina el gate y calcula la combinación
  ponderada SIEMPRE, para que la métrica fluctúe de forma visible
  (`metrics.ts:217-236`). Backtest de 482 días: F1 se mantiene >0.75.

### Bandas de Crisis Risk

Los umbrales se aplican en el lambda de crisis al generar la alerta
(`metrics-calculator/index.ts:630-631`):

| Banda | Score | |
|---|---|---|
| **NORMAL** | < 0.25 | sin señales |
| **ELEVADO** | 0.25 – 0.40 | vigilar |
| **ALERTA** | 0.40 – 0.60 | requiere atención |
| **CRISIS** | ≥ 0.60 | riesgo alto |

El umbral por defecto para **disparar correo** es `crisis_min = 0.40` con
`severity_min = 0.50` y `cooldown_hours = 12` (regla seedeada,
`metrics-calculator/index.ts:299-320`).

---

## Volume Anomaly (z-score)

```ts
// metrics.ts:208-215
const volumeHistory = history.map(h => h.totalMentions);
if (volumeHistory.length >= 7) {
  const avgVol = average(volumeHistory); const stdVol = stddev(volumeHistory);
  volumeAnomalyZscore = stdVol > 0 ? (totalMentions - avgVol) / stdVol : 0;
}
```

Z-score del volumen de hoy contra la media de la historia (hasta 30 días).
Requiere ≥7 días. Alimenta `crisisVelocity`. Redondeado a 2 decimales. Rango
típico ≈ −3 a +3.

---

## Polarization Index

```ts
// metrics.ts:248
const polarizationIndex = ((positiveCount + negativeCount) / totalMentions) * 100;
```

Porcentaje de menciones con carga (positivas + negativas) frente al total, en %.
Distingue una audiencia **dividida** (NSS≈0, polarización alta) de una **apática**
(NSS≈0, polarización baja).

---

## Tabla resumen

| Métrica | Columna | Rango | Ventana | `metrics.ts` |
|---|---|---|---|---|
| NSS | `nss` | −100..100 | periodo | 147 |
| NSS 7d / 30d | `nss_7d` / `nss_30d` | −100..100 | 7 / 30 snaps prev. | 150-155 |
| Reputation Momentum | `reputation_momentum` | −200..200 | hoy vs hace 7d | 158-161 |
| Engagement Rate | `engagement_rate` | 0..100%+ | periodo | 164-167 |
| Amplification Rate | `amplification_rate` | 0..100% | periodo | 170-172 |
| Engagement Velocity | `engagement_velocity` | ≈−3..3 | hoy vs 30d | 175-185 |
| BHI | `brand_health_index` | 0..1 | periodo + 30d | 187-206 |
| Volume Anomaly z | `volume_anomaly_zscore` | ≈−3..3 | hoy vs ≤30d | 208-215 |
| Crisis Risk | `crisis_risk_score` | 0..1 | periodo + z | 237-245 |
| · Severity | `crisis_severity` | 0..1 | 239 |
| · Velocity | `crisis_velocity` | 0..1 | 241 |
| · Relevance | `crisis_relevance` | 0..1 | 242 |
| · Confidence | `crisis_confidence` | 0..1 | 243 |
| Polarization | `polarization_index` | 0..100% | periodo | 248 |

---

## Notas de cálculo

- **Ventana del dashboard**: rolante, termina HOY (día en curso AST). El snapshot
  diario del lambda usa el día calendario. El correo semanal usa una ventana
  **cerrada** que termina ayer. Ver `packages/shared/src/dates.ts`
  (`closedWindowYmdInTZ` vs `rollingWindowYmdInTZ`) y
  [Pipeline de datos](pipeline-datos.md).
- **Deduplicación**: `loadAggregatesForWindow` filtra `is_duplicate = false`
  (`metrics.ts:312`); el snapshot diario del lambda **no** lo filtra
  explícitamente en su agregación (`metrics-calculator/index.ts:202-219`) — punto
  a revisar para paridad exacta.
- **Sentimiento**: el lambda diario cuenta solo `nlp_sentiment`
  (`metrics-calculator/index.ts:206-209`), mientras la ventana del dashboard usa
  `COALESCE(nlp_sentiment, bw_sentiment)` (`metrics.ts:300-302`). Pequeña
  divergencia de fuente entre snapshot histórico y vista en vivo.
- Cualquier cambio en `metrics.ts` exige **re-ejecutar el backtest** (snapshot de
  482 días) — está documentado en el comentario de la función
  (`metrics.ts:116-118`).
