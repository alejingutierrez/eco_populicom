# Sesión de consultores · protocolo (spec §13.3)

**Estado: preparada, no ejecutada.** Objetivo: que consultores de Populicom comparen, **a ciegas y por pares**,
memorandos de las variantes para decidir (1) si el consejo (c) supera a (a′) por 15 puntos o más y (2) si el
panel (b) supera a (a) por 10 o más. Estos son los pasos humanos de §13.3 y §15 (fase 2, punto 4).

## Qué se entrega y qué no

**Se entrega** (generado con `run.ts export-packet`):
- `paquete/P001.md … Pnnn.md`: la pregunta del caso y dos memorandos, A y B, en el mismo formato.
- `hoja-de-calificacion.csv`: una fila por par.

**No se entrega, ni se menciona:** la clave (`CLAVE-no-entregar.json`), los nombres de las variantes, los
modelos, el costo, la latencia, la deliberación (posiciones, ataques, réplicas), cuántas llamadas hubo, ni los
resultados del juez o del código. El orden de los pares y cuál variante es A o B salen de una semilla
guardada por quien organiza; los consultores no la conocen. Si algún texto delata la variante (p. ej. «el
consejo de seis asientos» dentro de un memorando), se anota y se reemplaza el par, y se cuenta como defecto del
render canónico.

## Participantes y tiempos

| Rol | Quién | Qué hace |
|---|---|---|
| Consultores | mínimo 3 de Populicom, sin haber participado en el diseño del asesor | califican de forma independiente, sin hablar entre ellos durante la calificación |
| Facilitador | una persona que no califica | reparte el paquete, controla el tiempo, **no** responde preguntas sobre qué variante es cuál |
| Custodio de la clave | ingeniería | guarda `CLAVE-no-entregar.json` y la semilla hasta cerrar las hojas |

Duración orientativa: 30 min de calibración + ~8 min por par. Con 24 pares (3 repeticiones del mismo caso no se
muestran juntas: un par por caso y repetición) conviene repartirlo en dos bloques de ~90 min con descanso, y
repartir los pares entre consultores de modo que **cada par lo califiquen al menos 2** (idealmente 3), para poder
calcular el acuerdo entre humanos.

## 1 · Calibración previa (para el kappa)

Antes de calificar de verdad:
1. Los consultores leen la rúbrica (abajo) y califican **juntos** 3 pares de práctica que **no** entran al estudio.
2. Se discute dónde difieren y se acuerda qué es «empate» (no hay diferencia clara, no «no sé»).
3. Se califican en solitario otros 4 pares de práctica y se calcula el kappa entre ellos
   (`cohenKappa` en `packages/shared/src/advisor/eval/stats.ts`). Si es menor de 0,4 se repite la calibración con otros pares.
   El kappa que se reporta en el informe es el de los pares reales; el de práctica solo decide si se empieza.

## 2 · Rúbrica (cuatro criterios + preferencia general)

Para cada par y cada criterio escriba **A**, **B** o **empate**:

| Criterio | Pregunta |
|---|---|
| Utilidad | ¿Cuál ayuda más a decidir hoy qué hacer? |
| Realismo de las opciones | ¿Cuál presenta caminos que la agencia puede ejecutar y que de verdad difieren entre sí? |
| Disenso bien recogido | ¿Cuál muestra el desacuerdo y las objeciones reales sin suavizarlos? |
| Claridad | ¿Cuál se entiende mejor y más rápido? |
| **Preferencia** | En general, ¿cuál preferiría recibir si usted fuera el director de comunicaciones? |

Reglas: no premiar la longitud; no premiar que coincida con lo que usted habría recomendado (se juzga la
calidad del análisis, no si «acierta»); un borrador que cruza una línea roja (L-1 a L-10) **descalifica** ese
memorando en «utilidad» y se anota en el comentario; si un par se puede identificar (delata la variante), se
marca en «comentario» y se sigue calificando.

## 3 · Calificación a ciegas

- Cada consultor recibe su lote en orden distinto y llena su hoja con su `rater` (iniciales).
- Sin consultar entre ellos, sin buscar el caso en internet y sin usar herramientas de IA para calificar.
- Una fila sin `preferencia` se considera no calificada.
- Los empates se registran como `empate`, no se fuerzan. En el cálculo, un empate vale medio punto para cada lado.

## 4 · Después de la sesión

1. El custodio recibe las hojas y corre `decide` con la clave (`scripts/advisor-eval/README.md`, paso 5).
2. Se calcula el kappa entre humanos y después el del juez DEEP con el consenso de los humanos. Si el juez no
   alcanza un acuerdo razonable con ellos, **no se usa** para decidir; el informe lo dice.
3. Los pares donde el juez cambia de veredicto al invertir el orden cuentan como empate del juez.
4. La decisión la escribe el dueño del producto en `informe-evaluacion.md` aplicando la regla tal como está en §13.3.

## Qué hacer con los empates y el desacuerdo

- Empate de un consultor: cuenta como empate (medio punto).
- Par calificado por varios: la preferencia del par es el promedio de sus consultores (un voto 1-0-0,5 por persona).
- Par sin ninguna calificación: se excluye y se cuenta cuántos se excluyeron.
- No se «resuelve» un desacuerdo conversando después: se reporta el kappa.

## Riesgos de sesgo (y qué se hace)

| Riesgo | Mitigación |
|---|---|
| Orden o lado (preferir A) | orientación y orden aleatorios por semilla; el juez evalúa los dos órdenes; revisar la tasa de preferencia por lado |
| La longitud gana | formato canónico igual para todos; los consultores no premian longitud; reportar longitud media por variante |
| Los consultores reconocen la variante por estilo | pares anónimos, mismo render; preguntar al final «¿pudo adivinar la variante?» y reportarlo |
| Contaminación del modelo (conoce el caso real) | preferir episodios de baja cobertura nacional y revisar el control con nombres sustituidos; las predicciones de métricas de ECO no se memorizan |
| Repeticiones del mismo caso inflan la muestra | error estándar agrupado por episodio; no tratar 3 repeticiones como 3 crisis |
| Los consultores conocen a los autores del asesor | consultores que no participaron en el diseño; no ven resultados parciales |
| Presión de plazos para «terminar» | reportar cuántos pares se calificaron y con qué kappa; sin kappa aceptable no hay decisión |

## Qué debe aportar Populicom

- Los episodios elegidos y sus preguntas (paso 1 del README de esta carpeta).
- Mínimo 3 consultores con ~6 horas cada uno, un facilitador y la custodia de la clave.
- La aprobación de gasto para las corridas reales y, si existe, el precio verificado de Opus 5.5.
- La confirmación de la unidad de «15 puntos» (README de `scripts/advisor-eval`).
