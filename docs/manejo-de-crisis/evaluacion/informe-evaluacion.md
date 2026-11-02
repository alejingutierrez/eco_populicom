# Informe de evaluación del asesor · fase 2 (spec §13, §15)

**Estado: PLANTILLA. Nada de lo de abajo está medido.** No rellenar con estimaciones: cada campo se llena con el
resultado de los subcomandos de `scripts/advisor-eval/` y se deja vacío si no se midió.

- Fecha de las corridas: _______
- Versión del conocimiento (hashes de manual, reglas legales y plantillas): _______
- Commit del código evaluado: _______
- Modelos (FAST / MAIN / DEEP) y *effort*: _______
- Episodios: ___ (del 20 al 30) · casos: ___ · repeticiones: 3 · control de nombres sustituidos: sí / no
- Hojas de hechos: generadas en modo congelado el _______ (una por caso, compartidas por las cuatro variantes)

## 1 · Resultados por código (`grade`)

| Variante | Corridas completas | Citas válidas | Formato ok | Corridas con línea roja | Cobertura 80 % | Brier del intervalo | Costo medio (USD) | Corridas sin precio | Latencia p50 | Turnos medios |
|---|---|---|---|---|---|---|---|---|---|---|
| (a) | | | | | | | | | | |
| (a′) | | | | | | | | | | |
| (b) | | | | | | | | | | |
| (c) | | | | | | | | | | |

Notas: el costo es `n/d` donde faltó un precio verificado (Opus 5.5); no se estima. El Brier del intervalo solo
es válido si el prompt pidió rangos al 80 %: ¿se pidió? sí / no.

## 2 · Set de seguridad (§12.6 y §15: cero fallos)

- Lado mecánico (`run.ts safety`): ___ / ___ sin fallos.
- Con modelo real (`--confirm-spend`): casos ejecutados ___ de ___ · fallos ___.
- Casos que solo juzga un modelo y no se ejecutaron: ___ (cobertura **no** cumplida mientras no se corran).

## 3 · Preferencia pareada de los consultores

| Comparación | Pares | Episodios | X gana | Empates | Y gana | Margen (puntos) | SE agrupado | IC95 % |
|---|---|---|---|---|---|---|---|---|
| (c) vs (a′) | | | | | | | | |
| (b) vs (a) | | | | | | | | |

- Consultores: ___ · pares calificados por al menos 2: ___ · pares excluidos por no calificados: ___
- Kappa entre humanos: ___ (banda: ___) · Kappa del juez vs consenso humano: ___ (banda: ___)
- Pares donde el juez cambió de veredicto con el orden (empate): ___ / ___
- ¿Pudieron adivinar la variante? ___ · preferencia por lado A: ___ %
- Unidad de «puntos» usada (diferencia de % de preferencia con empate = ½): confirmada por _______ el _______

## 4 · Decisión según §13.3 (la regla, tal como está escrita)

> **El consejo (c) se queda** si gana a (a′) en preferencia pareada de los consultores por 15 puntos o más y no
> empeora el Brier ni la tasa de citas válidas. **Si (c) no gana a (a′)**, el camino 3 pasa a ser (a′) con
> premortem, y el consejo se guarda solo como modo «deliberación visible» opcional. **El panel (b) se queda** si
> gana a (a) por 10 puntos o más; si no, el camino 2 pasa a ser (a).

Salida de `decide` (`decision.json`): consejo = ____________ · panel = ____________

**Decisión del camino 3:** ______________________________________________

**Decisión del camino 2:** ______________________________________________

¿El intervalo del 95 % del margen cruza el umbral (decisión frágil)? consejo: sí / no · panel: sí / no

Quién decide y fecha: _______________________

## 5 · Límites y lo que no se pudo calificar

(Escribir aquí lo que el código no ve: líneas rojas por paráfrasis, utilidad real para la agencia, efecto de la
ronda 0 compartida, contaminación del modelo, etc.)

## 6 · Siguiente paso según la decisión

(Fase 3: calibración y señales baratas, o rediseño del camino 3 como (a′) con premortem.)
