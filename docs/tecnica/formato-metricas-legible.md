# Formato legible de métricas (capa `@eco/shared/format`)

> Cómo las métricas se presentan al público: **palabra cualitativa protagonista
> + número de apoyo** (%, escala /10, número con signo), en vez de valores
> crudos `0.X`. Incluye la velocidad redefinida y el tratamiento de "sin cambio".

## Por qué existe

Muchas métricas se calculan en rango `0–1` (Crisis, BHI) o como z-scores que el
público no interpreta (`0.59`, `1.732`). Antes cada superficie (dashboard SPA,
web app, correo, prompts IA) las formateaba por su cuenta, con escalas y bandas
**duplicadas y a veces contradictorias** — el BHI salía `6.3` en una tarjeta y
`0.59` en el chart de al lado.

Ahora hay **una sola fuente de verdad**: `packages/shared/src/format/metrics-display.ts`.

## Qué expone

| Función | Entrada | Devuelve |
|---|---|---|
| `formatMetric(key, raw)` | `key` = `crisis\|bhi\|polarization\|nss\|engagementRate\|amplificationRate`; `raw` = valor crudo de `calculateMetrics` | `MetricDisplay` `{ word, value, short, raw, band, tone, color }` |
| `formatVelocity(curPM, prevPM)` | engagement-por-mención actual vs anterior | `MetricDisplay` con palabra `Acelerada/Estable/Desacelerada` y `value` `+18%` |
| `formatDelta(cur, prev, opts)` | dos valores + `{kind, decimals, suffix, invert}` | `DeltaDisplay` `{ word, direction, arrow, value, magnitude, hasBaseline, tone }` |
| `metricBand`, `crisisBand`, `bhiBand10`, `toBhi10`, `polarizationBand`, `nssBand`, `bandTone`, `bandColor` | — | helpers de banda/escala/color |

**Convención clave:** el `raw` de entrada es SIEMPRE el valor que produce
`calculateMetrics` (crisis/bhi `0–1`, polarization `0–100`, nss `−100..100`).
Toda conversión de escala (p.ej. BHI `0–1 → 1–10`) vive dentro del módulo.

## Mapa de presentación

| Métrica | Palabra | Apoyo | Bandas (sobre el crudo) |
|---|---|---|---|
| Crisis | Normal/Elevado/Alerta/Crisis | `59%` de riesgo | `<0.25 / <0.40 / <0.60 / ≥0.60` |
| BHI | Crítico/Débil/Sano/Fuerte | `6.3 / 10` | `4.6/6.4/8.2` en 1–10 ≡ `0.40/0.60/0.80` en 0–1 |
| Polarización | Apática/Moderada/Alta/Extrema | `59%` | `30/50/75` |
| NSS | Muy neg…Muy pos | `−47` (1 decimal, con signo) | `−20/−5/5/20` |
| Engagement/Amplif. | (el % es la palabra) | `2.4%` | — |
| Velocidad | Desacelerada/Estable/Acelerada | `+18% vs período ant.` | `±15%` (`VELOCITY_STABLE_PCT`) |

## Velocidad redefinida

El z-score de `engagement_velocity` (rango ≈ −3..3, 3 decimales) **nunca se
mostraba** y tenía 3 definiciones distintas en el repo. Se reemplaza, **sin
tocar el schema ni hacer backfill**, por el cambio % del engagement-por-mención
del período actual vs el anterior de igual duración (se calcula en la API desde
las dos ventanas que ya carga). Resuelve el caso "igual que el período anterior":

- sin cambio → `Estable · +0%`
- sin período previo con datos → `Sin base de comparación`

## "Sin cambio" vs "sin base"

`formatDelta` distingue **estable** (cambio real ≈ 0) de **sin base** (falta
período de comparación). Antes ambos colapsaban a `0`. La palabra se deriva del
valor **redondeado** (no del float crudo), eliminando el bug `0% sube`.

## Dónde se consume

- **`/api/eco-data`** y **`/api/overview`** adjuntan `CURRENT_METRICS.display.*`
  y `CURRENT_METRICS.deltaDisplay.*` (objetos ya formateados). El crudo numérico
  se conserva para los ejes de los charts.
- **`/api/ai/metric-insight`** adjunta `valueDisplay` + `deltaDisplay` al payload
  del drawer.
- **Dashboard SPA** (`public/eco-prototype`): `KpiCard` (modo palabra), el drawer
  (`MetricInsightModal`) y las cards de Overview/Sentimiento/Menciones renderizan
  esos campos. **No** importan el módulo TS (bundle estático): reciben los strings
  ya formateados desde la API. El único formateo escalar por-punto que vive
  espejado allí es `charts.js:fmtVal` (hover del chart), marcado como espejo.
- **Correo semanal** (`render-weekly-report.ts`): `deltaWord` usa el mismo
  vocabulario (`sube/baja/estable`) y redondea para no contradecir a `signedPct`.

## Tests

`packages/shared/src/format/metrics-display.test.ts` (19 casos):

```bash
node_modules/.bin/tsx --test packages/shared/src/format/metrics-display.test.ts
```

## Verificación visual sin DB/auth

El prototipo es estático (`compile-prototype.js` → `dist/`, sin bundling). Para
ver el render con datos realistas sin levantar la base ni Cognito:

```bash
python3 -m http.server 8901 --directory apps/web/public/eco-prototype
# abrir http://localhost:8901/dist/_verify.html
```

`dist/_verify.html` (gitignoreado) inyecta un `window.ECO_DATA_REMOTE` de ejemplo
y carga el bundle compilado. Hay una config `eco-verify` equivalente en
`.claude/launch.json`.

## Pendientes conocidos (fuera de alcance de esta iteración)

- **NSS geográfico** (`/api/eco-data`): se sirve en escala `−10..10` bajo el
  mismo campo `nss` que el titular `−100..100`. No es un leak `0.X`, pero la
  colisión de escala conviene normalizarla.
- **Umbral del editor de alertas de crisis** (`screens.js`): muestra el knob de
  configuración como `0–1`; es un input de config, no una métrica mostrada.
- **`prompts/metric-insight-cached.ts`**: tiene bandas de BHI en una escala
  distinta, pero `buildCachedMetricInsightPrompt` **no tiene llamadores** hoy
  (código muerto); reconciliar si/cuando se cablee. El prompt vivo
  (`/api/ai/metric-insight`) ya recibe la banda canónica del route.
