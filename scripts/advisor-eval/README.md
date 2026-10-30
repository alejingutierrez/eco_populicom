# Arnés de evaluación del asesor (spec §13)

Compara las cuatro variantes de §13.2 y aplica la regla de decisión de §13.3.
**Nada de esto corre Bedrock por defecto.** Los pasos humanos (elegir episodios, hojas de hechos
reales, sesión con consultores, decisión) están en `docs/manejo-de-crisis/evaluacion/`.

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Lógica pura (estadística, regla de decisión, líneas rojas, predicciones, pareada, juez, render) | `packages/shared/src/advisor/eval/` |
| Variantes (a), (a′), (b), (c), orquestación, CLI, set de seguridad | `scripts/advisor-eval/` |
| Tests | `apps/web/src/lib/advisor/eval/` y `scripts/advisor-eval/*.test.ts` (`jest.config.js` incluye esta carpeta en `roots`) |
| Protocolo humano, hoja e informe | `docs/manejo-de-crisis/evaluacion/` |

## Decisión de diseño: una misma hoja de hechos por caso

La ronda 0 (analista con herramientas) se hace **una vez por caso** y las cuatro variantes parten de esa
hoja. Se compara la estructura de la deliberación (un agente, un agente ×3 + síntesis, panel, consejo), no
la suerte de qué datos consultó cada una; además se ahorra repetir la ronda 0 cuatro veces. Límite: no mide
el efecto de la ronda 0 misma.

- (a) un agente (Sonnet, *effort* `medium`) con el manual escribe él solo caminos, premortem y señales.
- (a′) (a) tres veces independientes + una síntesis (DEEP) que agrupa y conserva el premortem.
- (b) panel: `runPanel` de la web con un pool falso y la ronda 0 precargada (`preloadedRound0`).
- (c) consejo: `runCouncil` de shared con un `CouncilStore` en memoria.

## Uso

```bash
# 0 · prueba de punta a punta sin costo (LLM simulado, episodios de ejemplo)
npx tsx scripts/advisor-eval/run.ts run --episodes scripts/advisor-eval/episodes.example.json --allow-partial --dry-run --reps 1 --out /tmp/eval

# 1 · ejecución real (solo con permiso explícito y tope duro)
npx tsx scripts/advisor-eval/run.ts run --episodes episodes.json --fact-sheets fact-sheets/ \
  --variants a,a2,b,c --reps 3 --confirm-spend --max-usd 150 --max-calls 2500 --with-control

# 2 · calificación por código
npx tsx scripts/advisor-eval/run.ts grade --episodes episodes.json --records <out>/records.jsonl [--observed observados.json]

# 3 · paquete ciego para los consultores (entregar paquete/ y la hoja; NO la clave)
npx tsx scripts/advisor-eval/run.ts export-packet --records <out>/records.jsonl --episodes episodes.json --seed <semilla>

# 4 · juez (los dos órdenes) — también exige --dry-run o --confirm-spend --max-usd
npx tsx scripts/advisor-eval/run.ts judge --episodes episodes.json --records <out>/records.jsonl --confirm-spend --max-usd 30

# 5 · decisión §13.3 (la preferencia que decide es la de los consultores)
npx tsx scripts/advisor-eval/run.ts decide --summary <out>/summary.json --key <out>/CLAVE-no-entregar.json --sheets hoja-ana.csv,hoja-luis.csv [--judge <out>/judge.jsonl]

# set de seguridad, lado mecánico (sin modelo)
npx tsx scripts/advisor-eval/run.ts safety
```

### Topes de gasto

`--confirm-spend` exige `--max-usd N` y aplica además `--max-calls` (300 por defecto). El tope de USD cuenta
solo las llamadas con precio conocido: **Opus 5.5 no tiene precio verificado** (`models.ts`), así que sus
llamadas no suman al USD y las cubre el tope de llamadas. Quien conozca el precio verificado puede pasarlo
con `--opus-usd-per-mtok entrada,salida`. El costo de una corrida es `null` si alguna llamada no tiene
precio: no se estima. Las llamadas en vuelo cuentan contra el tope de llamadas; el USD puede pasarse por lo
que cuesten las llamadas en paralelo en ese instante. La ejecución es reanudable: `records.jsonl` se
escribe por corrida y lo ya hecho se salta.

## Formatos

- `episodes.json`: arreglo de episodios (ver `episodes.example.json`). El set completo exige 20–30
  episodios, 2–3 preguntas de tipos distintos por episodio, `snapshotsV5: true` y los episodios obligatorios
  del spec (`renuncia-ddec-2026-05`, `familia-2026-10`; `apagon-2025-04` solo si hay cobertura).
- `fact-sheets/<caso>.json`: `{ "factSheet": {…FactSheet…}, "seenIds": ["M-48213", …] }`; el nombre del
  archivo es el `caseId` (`episodio:pregunta`) con los caracteres no alfanuméricos cambiados por `__`. Salen de
  correr la ronda 0 con las herramientas **en modo congelado** (`ctx.asOf` = `asOf` del episodio); hoy no hay
  subcomando que las genere porque necesita acceso a la base: ver «Pendiente» abajo.
- `observados.json`: `{ "<caseId>": { "crisis_index@24": 0.41, "crisis_index@48": …, "nss@72": … } }`, de
  los snapshots de los días `asOf+1`, `+2` y `+3` (la unidad de ECO es el día cerrado en hora de Puerto Rico,
  no la hora). Solo snapshots con `computed_at` de V5.

### SQL de candidatos a episodios (solo documentado; elegir es un paso humano)

Se parte de `historial_agencia` (episodios del índice V5 ≥ 0.40). Para listar candidatos por agencia:

```sql
-- Días con score V5 ≥ 0.40, solo snapshots calculados con la fórmula V5 (computed_at ≥ 2026-10-09 o recalculados).
SELECT a.slug, s.date, s.crisis_risk_score, s.total_mentions, s.computed_at
  FROM daily_metric_snapshots s JOIN agencies a ON a.id = s.agency_id
 WHERE a.slug IN ('ddecpr','gobernadora','df')
   AND s.crisis_risk_score >= 0.40
   AND s.computed_at >= '2026-10-09'   -- V5_TRUST_FROM_YMD en history.ts
 ORDER BY a.slug, s.date;

-- Valores observados para un episodio con asOf = D (días cerrados D+1, D+2, D+3):
SELECT date, crisis_risk_score AS crisis_index, nss
  FROM daily_metric_snapshots
 WHERE agency_id = (SELECT id FROM agencies WHERE slug = 'ddecpr')
   AND date IN (DATE 'AAAA-MM-DD' + 1, DATE 'AAAA-MM-DD' + 2, DATE 'AAAA-MM-DD' + 3);
```

Ojo: antes del 9-oct-2026 los snapshots no son de V5 salvo backfill (`computed_at`). Un episodio de mayo de
2026 (la renuncia en el DDEC) solo es usable si sus snapshots se recalcularon con V5; verificarlo antes.
Las preguntas de cada episodio y qué episodios entran son decisión de Populicom.

## Qué califica el código y qué no

| Califica | Cómo | Límite |
|---|---|---|
| Citas válidas | `checkCitations` contra los IDs que consultó la ronda 0 y la versión del conocimiento | Valida que la cita **exista**, no que respalde la afirmación |
| Formato | `validateMemo` + objeciones del DA y vetos del legal presentes (el consejo cita vetos por id V/W) | No juzga si la objeción se trató bien |
| Líneas rojas | detector por patrones L-1…L-10 (`redlines.ts`) | Ver su cabecera: no ve paráfrasis, ni si el hecho es cierto (L-1, L-6), ni si una cifra va a subir (L-10) |
| Predicciones | cobertura y ancho de los rangos; «Brier del intervalo» con nivel nominal 80 % | **Los rangos no son probabilidades.** El Brier del intervalo mide si la afirmación implícita del 80 % está calibrada. Solo vale si el prompt pidió rangos al 80 % (ver nota para la sesión principal en el informe de esta tarea) |
| Costo, latencia, turnos | de las respuestas del modelo | Costo `null` si falta precio verificado |
| Utilidad, realismo, disenso, claridad | **solo consultores** (y el juez calibrado contra ellos) | — |

## Interpretación de «15 puntos» (confirmar antes de correr)

La regla §13.3 dice «por 15 puntos o más» sin definir la unidad. Se implementa como **diferencia de
preferencia en puntos porcentuales**: % de pares que prefieren X menos % que prefieren Y, con el empate como
medio punto para cada uno (15 puntos = 57,5 % a 42,5 %). Si se quiso decir 65 % frente a 35 % (30 puntos de
diferencia) o «15 puntos sobre el 50 %», hay que decirlo **antes** de correr y cambiar solo la constante
`COUNCIL_MARGIN_POINTS` / `PANEL_MARGIN_POINTS` en `eval/decision.ts`. La regla se escribe antes de ver
resultados y no se ajusta después.

## Pendiente

- Subcomando `facts` que genere las hojas de hechos en modo congelado: necesita acceso a la base (las
  herramientas importan alias `@/lib/...` y `ctx.pool`) y no está probado, así que no se incluyó.
- Corridas reales (a), (a′), (b), (c) y juez: bloqueadas por episodios elegidos, hojas de hechos y aprobación de gasto.
- Parte de conducta del set de seguridad con modelo real (ver `safety-set.json`, campo `cubre`).
