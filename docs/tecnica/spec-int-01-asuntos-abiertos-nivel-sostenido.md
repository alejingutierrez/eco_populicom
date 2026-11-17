# Spec · INT-01 · Asuntos abiertos y nivel sostenido en los correos

**Versión 0.4 · 17 de noviembre de 2026 · cierre previsto 25 de noviembre**

Decisiones 1 a 7 aprobadas por Alejandro el 16-nov. WP-1 y WP-2 mergeados
(#176). WP-3 y WP-4 mergeados (#178) y `eco-weekly-report` desplegado el
17-nov a las 03:46 UTC, con el visto bueno de Alejandro a las vistas previas
(ver su estado en la sección 3). Los cambios respecto a la versión 0.1 están marcados como «Ajuste
al implementar» en las secciones 2.1, 2.5, 2.7 y 2.8. WP-5 (Overview) está en
un PR abierto, verificado en local con datos reales y sin mergear. WP-6: las
corridas de octubre sobre el lambda están hechas y la comprobación diaria de
los correos reales corre desde el 17-nov (sección 3, WP-6): **el ítem no
cierra hasta juntar 7 días seguidos en OK**, y el primer día no cuenta porque
el Diario de DDEC no dejó archivo.

Este spec cubre lo que le falta a INT-01. Lo ya hecho (motor de redacción
«Interpretación v1», PRs #159–#169) no se repite aquí. Las rutas de código son
de `origin/main` (a6233fe). Las cifras de producción se midieron el 16-nov
entre las 23:20 y las 00:30 UTC con `eco-migration` (solo lectura) y con un
`dryRun` de `eco-weekly-report`. Nada se desplegó ni se envió.

---

## 0. Resumen

### 0.1 Qué falta construir

| # | Paquete | Qué entrega | Dónde |
|---|---|---|---|
| WP-1 | Cálculo compartido de asuntos abiertos | Una función en `@eco/shared` que devuelve los asuntos abiertos de una agencia a una fecha, con días abierto, etapa y voz principal | `packages/shared`, `apps/web` |
| WP-2 | Cálculo del nivel sostenido | % negativo y NSS a 14 y 28 días contra el umbral fijo, en el mismo universo del correo | `packages/shared` |
| WP-3 | Hechos nuevos para el redactor | El paquete de hechos lleva los asuntos y los niveles; reglas nuevas para analista, redactor y QA; detector de «variación sin nivel» | `packages/shared/src/composer`, `infra/lambda/weekly-report` |
| WP-4 | Bloques en el Diario y el Semanal | Bloque «Asuntos abiertos» y línea de nivel junto a cada variación, pintados por código | `packages/shared/src/email`, `infra/lambda/weekly-report` |
| WP-5 | El mismo bloque en el Overview | Endpoint y bloque en el SPA con la misma función de WP-1 y WP-2 | `apps/web` |
| WP-6 | Caso del 24-oct y cierre | Regeneración repetida del Diario de DF del 24-oct, vistas previas de las tres agencias, informe contra los criterios | `docs/tecnica` |

### 0.2 Qué no se construye en este spec

- **El verificador que impide enviar una dirección contradictoria** (INT-02).
  Aquí el detector de «variación sin nivel» manda la frase al corrector y deja
  aviso; convertirlo en regla dura y archivar el antes y el después es INT-02.
- **Encender el motor de redacción en los textos del Overview.** Hoy el lede
  del Overview sigue saliendo del prompt anterior (sección 1.2, punto 6). El
  bloque nuevo se pinta por código y no depende de eso.
- **Arreglar la fragmentación del agrupador de narrativas.** El spec la rodea
  agrupando narrativas en historias (sección 2.1), no la corrige.
- **Subir la cobertura de narrativas** (hoy 42–56 % de las menciones). Se
  informa en el bloque; mejorarla es otro ítem.
- **La autopsia T0 formal y las pruebas T1 y T2** (PRD-02). WP-6 deja el
  material listo para T0.

---

## 1. Estado medido el 16-nov

### 1.1 Lo que ya está

| Hecho | Valor | Fuente |
|---|---|---|
| Modo del motor | `agentic` en las 5 filas de `report_configs` (3 activas: DDEC, DF, Gobernadora) | `report_configs` |
| Composiciones archivadas | 36 diarias (del 3 al 15-nov) y 6 semanales (5 y 12-nov), todas `complete` | `report_compositions` |
| Lo que recibe el redactor | 76 hechos en el Diario de DF: totales de 7 días y previos, día contra día anterior, serie, tópicos, fuentes, municipios, emociones, composición de comentarios | `composition.facts` del `dryRun` |
| Lo que **no** recibe | Ningún hecho de historias ni de niveles a más de 7 días. `grep` de narrativa, 14 o 28 días en `packages/shared/src/composer`: cero resultados | código |

**Regeneración del Diario de DF del 24-oct con el motor de hoy** (`dryRun`,
`asOf` 24-oct 10:00 UTC, ventana 17 al 23-oct, 90 s, no se envió):

- No dice «va bajando». Dice: «el volumen del día bajó -47 % respecto al
  jueves, pero 75 de 110 menciones fueron negativas».
- No da ningún nivel a más de 7 días ni dice desde cuándo está abierto el
  asunto.
- Es una sola corrida: nada en el código obliga a ese «pero». El analista lo
  escribió por su cuenta.
- Defectos que se ven en esa corrida y que son de INT-02: signo doble
  («bajó -47 %»); la red de seguridad quitó dos frases por las cifras «$2.5
  millones» y «$38 millones» (vienen de las muestras, no de los hechos) y dejó
  el párrafo empezando con una frase cortada en «Christian W.»; el titular del
  redactor se cambió por el determinista.

El texto original del correo del 24-oct no existe: `report_send_log` tiene la
fila (24-oct 10:01 UTC, `sent`) con `subject`, `headline` y `composition`
vacíos. Los correos se archivan desde el 3-nov.

### 1.2 Lo que no está bien

1. **El asunto de DF está partido en muchas narrativas.** Del 17 al 23-oct,
   DF tuvo 33 narrativas con menciones; 21 de ellas son el mismo asunto (la
   secretaria Suzanne Roig: contratos, demandas, renuncia, Senado). Juntas
   suman 305 de las 423 menciones en narrativas (72 %), 71 % negativas, y la
   primera mención es del 28-sep: 26 días abierto. Vista narrativa por
   narrativa, la mayor tiene 124 menciones y las siguientes dicen «4 días»,
   «2 días». Un bloque hecho con narrativas sueltas mostraría tres pedazos del
   mismo asunto, cada uno con pocos días.
   (Agrupación aproximada con las reglas de #131: coseno ≥ 0.65, o ≥ 0.44 con
   una palabra del nombre en común.)
2. **El asunto sigue igual al 15-nov.** Mismo grupo: 11 narrativas activas,
   121 menciones en 7 días, 75 % negativas, 49 días abierto. El volumen cayó
   60 % contra el 23-oct y la proporción negativa subió 4 puntos.
3. **El estado guardado de la narrativa no sirve para una fecha pasada.**
   `narratives.status` es el de hoy. `/api/narrative/overview?to=` ya lo
   advierte en su comentario. La etapa del bloque tiene que salir de los
   conteos a la fecha, no de esa columna.
4. **La voz con más menciones casi nunca domina.** En el asunto Roig, 17 al
   23-oct: 265 menciones de 96 voces; la primera por menciones es Telemundo PR
   con 24 (9 %), y 48 voces tienen una sola. Por interacciones sí hay una voz
   clara: Jay Fonseca con 14,190 de 38,158 (37 %, sumando sus dos cuentas),
   Telemundo PR 23 %, Jugando Pelota Dura 15 %.
5. **Las narrativas no cubren toda la conversación.** Menciones de 7 días que
   están en una narrativa:

   | Agencia | Al 23-oct | Al 15-nov | Negativas en narrativa al 15-nov |
   |---|---|---|---|
   | DF | 423 de 1,045 (40 %) | 163 de 387 (42 %) | 98 de 231 (42 %) |
   | DDEC | 92 de 163 (56 %) | 63 de 131 (48 %) | 1 de 6 |
   | Gobernadora | 318 de 617 (52 %) | 328 de 624 (53 %) | 30 de 139 (22 %) |

6. **El Overview no usa el motor nuevo.** `eco-ai-tasks` se modificó por
   última vez el 8-oct (antes de #169, del 3-nov) y no tiene la variable
   `COMPOSER_WEB_AGENCIES`. El lede del Overview sale del prompt anterior y el
   bundle vivo no contiene `composer-surfaces.ts`.
7. **Las reglas de historias viven solo en la web.** `groupStories`,
   `cajonStats`, `processRows` y `findDuplicates` están en
   `apps/web/src/lib/narrative/overview.ts`. El lambda de correos no puede
   importarlas.
8. **Hay narrativas que son un cajón de cuentas propias.** «Publicaciones
   oficiales Jenniffer González Facebook»: 1,370 menciones, 683 días, 30 en la
   última semana (la primera de Gobernadora por volumen). «Publicaciones DDEC
   en redes sociales»: 449 menciones, 657 días. La regla de cajón de #131 las
   detecta; el bloque tiene que aplicarla.

### 1.3 Niveles medidos (universo del correo, días de Puerto Rico)

DF, ventanas que terminan el día indicado:

| Termina | Día | 7 días | 14 días | 28 días |
|---|---|---|---|---|
| 16-oct | 235 menciones, 58 % neg | 565 · 59 % · NSS −57 | 2,380 · 64 % · −63 | 3,685 · 61 % · −60 |
| 23-oct | 110 · 68 % | 1,045 · 65 % · −65 | 1,610 · 63 % · −62 | 4,433 · 65 % · −65 |
| 30-oct | 70 · 46 % | 327 · 53 % · −53 | 1,372 · 62 % · −62 | 3,752 · 63 % · −62 |
| 8-nov | 6 · 33 % | 382 · 53 % · −51 | 759 · 54 % · −53 | 2,346 · 60 % · −59 |
| 15-nov | 17 · 65 % | 387 · 60 % · −59 | 769 · 57 % · −55 | 2,074 · 61 % · −60 |

Del 23 al 30-oct el volumen de 7 días bajó 69 % (1,045 → 327) y el nivel a
14 días pasó de 63 % a 62 % negativo. Ese es el caso que el correo tiene que
contar bien.

Distribución histórica del % negativo a 28 días (cada día desde que hay 28 días
de datos, base mínima 30 menciones):

| Agencia | Días medidos | p10 | Mediana | p90 | Máximo | Días con 14 y 28 días ≥ 30 % | Días con NSS a 28 días ≤ −20 |
|---|---|---|---|---|---|---|---|
| DF | 97 | 22 % | 32 % | 64 % | 66 % | 49 % | 93 % |
| DDEC | 173 | 7 % | 17 % | 45 % | 49 % | 36 % | 44 % |
| Gobernadora | 173 | 15 % | 19 % | 25 % | 30 % | 0 % | 36 % |

Días en que el volumen de 7 días cayó 30 % o más contra los 7 previos: DF 24,
DDEC 55, Gobernadora 32. De esos, con el nivel a 28 días en 30 % negativo o
más: DF 16, DDEC 29, Gobernadora 0. Son los días en que hoy el correo puede
leer una baja de volumen como mejora.

---

## 2. Decisiones del spec

### 2.1 Qué es un «asunto»

Un asunto es un **grupo de narrativas del mismo caso**, o una narrativa suelta
si no agrupa con ninguna. Quedan fuera los cajones (`cajonStats`) y las
narrativas fusionadas; un duplicado (`findDuplicates`) se suma a la mayor.

Por qué grupo y no narrativa: sección 1.2, punto 1.

**Ajuste al implementar.** La regla que decide si dos narrativas son del mismo
caso es la de #131 (`isStoryEdge`: coseno ≥ 0.65, o ≥ 0.44 con un término
distintivo en común, vidas a 21 días o menos y picos a 60 o menos). Lo que
cambia es cómo se arma el grupo. `groupStories` une todo lo que esté
encadenado, y con narrativas pequeñas en juego la cadena junta casos
distintos: en Gobernadora al 15-nov el asunto Roig salía unido a la reforma
judicial y a la de permisos (17 narrativas) a través de las que nombran a
Rivera Schatz. `groupIssues` arma el grupo alrededor de la narrativa mayor:

1. entran las que tienen arista directa con la mayor;
2. después, las que tienen arista con 2 o más narrativas ya dentro;
3. al final, un grupo menor se une a uno mayor si al menos la mitad de sus
   narrativas tiene arista con él (y hay 2 aristas o más).

Medido con las tres agencias al 23-oct y al 15-nov:

| Caso | Con la cadena de #131 | Con `groupIssues` |
|---|---|---|
| DF, 23-oct | Roig: 30 narrativas, 294 menciones | Roig: 27 narrativas, 290 menciones |
| DF, 15-nov | Roig: 33 narrativas, 121 menciones | Roig: 29 narrativas, 121 menciones |
| Gobernadora, 15-nov | Roig + reforma judicial + reforma de permisos: 17 narrativas | Roig solo: 7 narrativas, 46 menciones |
| Gobernadora, 15-nov | Gas natural + energía solar + leyes eléctricas: 11 narrativas | Gas natural y energía: 9 narrativas |
| DDEC, 23-oct | «Semana en Desarrollo» + misiones + rutas: 12 narrativas | Igual: 12 narrativas |

En DDEC las misiones comerciales siguen unidas al resumen «Semana en
Desarrollo», que las reseña. Es contenido propio y se dejó así. Sin el paso 3,
DF mostraba «Coccoloba desmiente a Suzanne Roig» como segundo asunto.

La página Narrativas no cambia: sigue usando `groupStories`.

Nombre del asunto: el de la narrativa mayor de toda la vida, para que no
cambie de un día a otro. Si la narrativa con más menciones de la semana es
otra, va en `lead` («lo más activo esta semana»). No lo escribe el redactor.

### 2.2 Cuándo está «abierto»

Abierto a la fecha F (último día cerrado del correo) si cumple las dos:

- 5 o más menciones en los 7 días que terminan en F;
- al menos una mención en los últimos 3 días.

Con el umbral de 5, narrativas que califican antes de agrupar: DF 20 (23-oct)
y 10 (15-nov); DDEC 8 y 6; Gobernadora 18 y 20. Siempre hay de dónde sacar 3.
Si califican menos de 3, el bloque muestra los que haya; si no califica
ninguno, el bloque dice «Sin asuntos abiertos esta semana» y no se omite.

### 2.3 «Días abierto»

Días naturales desde la primera mención del **tramo actual** hasta F, contando
los dos extremos. El tramo actual empieza después del último hueco de más de
14 días sin menciones en ninguna narrativa del asunto. Se usa la regla de
«solo fecha» de `mentionWhen`.

Por qué tramo y no vida entera: «González rechaza aumento tarifario LUMA»
nació el 22-may-2025 (520 días al 23-oct) y su actividad actual llevaba 5
días. «Jiménez Colón comisionado del NMEAD»: 627 días de vida, 5 de tramo.
Con la vida entera, un tema que vuelve parecería abierto dos años.

Cuando el tramo no es el primero, el bloque dice «reabierto» y la fecha de la
primera mención histórica queda en el dato (no en el correo).

### 2.4 «Etapa»

La calcula el código a la fecha F, sin leer `narratives.status`:

| Etapa | Condición |
|---|---|
| Nuevo | el tramo tiene 3 días o menos |
| Sube | menciones de 7 días ≥ 1.25 × las de los 7 previos, y al menos 5 más |
| Baja | menciones de 7 días ≤ 0.75 × las de los 7 previos, y al menos 5 menos |
| Se mantiene | el resto |

La etapa siempre va con sus dos cifras («121 esta semana, 9 la previa») y con
el % negativo del asunto. «Baja» habla de volumen; el % negativo al lado es lo
que impide leerla como mejora.

### 2.5 «Voz principal»

La voz ajena a la agencia (`isOwnVoice` fuera) con más **interacciones** en
las menciones del asunto de los últimos 7 días, con su porcentaje sobre las
interacciones del asunto. Voces unificadas con `voiceKey` y nombradas con
`VOICE_LABELS`.

- **Ajuste al implementar.** Una voz se elige por interacciones solo si tiene
  10 o más y al menos 10 % de las del asunto. En DDEC al 15-nov una persona
  con 1 interacción salía con «100 % de las interacciones», y otra con 1 de
  14.
- Si no hay una voz así (solo prensa sin métricas, o interacciones mínimas),
  la voz con más menciones, con su número de menciones.
- **Ajuste al implementar (WP-4).** Solo se nombra un medio (nota de prensa o
  cuenta de un medio) o una cuenta con 100 interacciones o más en la semana.
  Una persona particular que comenta varias veces en una publicación de la
  agencia no sale con nombre: el bloque dice «sin voz dominante» y cuenta las
  voces. En DDEC al 23-oct salía una persona por 4 comentarios.
- Si la primera voz tiene menos de 3 menciones y no hay interacciones: «sin
  voz dominante» y el número de voces.
- Siempre se muestra además cuántas voces distintas hablaron.

Por qué interacciones: sección 1.2, punto 4. «La que más la empuja» por
menciones daría Telemundo PR con 9 %; por interacciones da Jay Fonseca con
37 %.

Los alias que aparecieron al medir (`jayfonsecapr`, `radioisla1320`,
`metropuertorico`, `elvocerodepuertorico`) ya están en `VOICE_ALIASES`. WP-1
revisa las 30 voces con más interacciones de cada agencia por si falta alguno.

### 2.6 Cuáles 3 se muestran

Orden: menciones de 7 días más negativas de 7 días (una negativa cuenta
doble); desempate por días abierto. Se muestran hasta 3.

Con solo menciones, Gobernadora al 15-nov mostraría «Levantamiento congelación
precios», «Jiménez Colón comisionado» y «PR-114 Piculín Ortiz», los tres sin
negativas, y dejaría fuera «Vacaciones indefinidas de Suzanne Roig» (18
menciones, 8 negativas) y «Fortaleza niega presión judicial caso LUMA» (18 y
4). Con la regla propuesta entra el de Roig.

Es una decisión de producto: sección 6, punto 2.

### 2.7 Nivel sostenido

Dos ventanas de días cerrados que terminan en F: 14 y 28 días. En cada una,
% negativo (negativas ÷ total) y NSS ((positivas − negativas) ÷ total × 100,
la fórmula de `metrics.ts`), sobre el mismo universo del correo
(`MAIL_UNIVERSE`) y en días de Puerto Rico.

**Umbral fijo, igual para todas las agencias: 30 % negativo y NSS −20.**

- 30 % es la regla de «negativo» que ya usa Narrativas
  (`NARRATIVE_NEG_RULE.share`). −20 es el borde de la banda más baja del NSS
  (`nssBand`). No se inventa un número nuevo.
- Con ese umbral, 14 y 28 días a la vez por encima: DF 49 % de los días,
  DDEC 36 %, Gobernadora 0 % (sección 1.3). Distingue.
- Base mínima 30 menciones en la ventana (`FACT_MIN_DELTA_BASE`). Por debajo,
  el nivel no se muestra y el correo dice «base insuficiente». En la medición
  ninguna agencia bajó de 30 en 14 días.

«Sostenido» se define así: el **% negativo** pasa el umbral a 14 **y** a 28
días.

**Ajuste al implementar.** El NSS de cada ventana se informa contra su umbral
(−20), pero no decide «sostenido». La versión 0.1 no decía cuál de los dos
mandaba; las cifras de la sección 1.3 (49 %, 36 % y 0 %) son del % negativo.
Con el NSS, Gobernadora quedaría en «sostenido» el 36 % de los días. El
umbral se compara sin redondear: 29.6 % se muestra «30 %» y no lo pasa.

En el correo siempre va con sus números, nunca como etiqueta sola:
«14 días: 63 % negativo, NSS −62 · 28 días: 65 %, −65 · umbral 30 % y −20».

Umbral fijo contra «lo usual» de cada agencia: sección 6, punto 3.

### 2.8 Qué cuenta como «variación» y cómo se le pega el nivel

Variaciones que pinta el código (fichas de variación del Diario y del Semanal,
tabla de comparación del Semanal): debajo de cada grupo de fichas va la línea
de nivel de 2.7. Es determinista y se prueba con pruebas de render.

Variaciones en la prosa del modelo (titular, párrafo, viñetas, insights,
comparación):

- Regla nueva para redactor y corrector: una oración que diga que el volumen
  o las negativas suben o bajan lleva en la misma oración, o en la siguiente,
  los marcadores de nivel a 14 y 28 días.
- Regla nueva: si el nivel es sostenido, el texto no dice que la conversación
  mejora, se calma, cede o va bajando; puede decir que el volumen bajó, con
  el nivel al lado.
- Detector por código (`direccion_sin_nivel`, severidad `soft`): oración con
  un marcador de variación (`*_delta_*`, `topic_up_*`, `topic_down_*`) o un
  verbo de dirección de una lista fija, sin marcador `level_*` en esa oración
  ni en la siguiente. Va al corrector y queda en `residualCodeProblems` si
  persiste.

INT-02 lo vuelve `hard` y añade la contradicción con un asunto abierto.

**Ajuste al implementar (WP-3).** Tres precisiones:

- **Qué es una variación para la prosa:** los marcadores del volumen, de un
  sentimiento o de un indicador (`day_delta_*`, `week_*_delta_*`,
  `ind_*_delta`), o un verbo de dirección aplicado al volumen, las menciones
  o el sentimiento. Los movimientos de tópicos (`topic_up_*`, `topic_down_*`)
  no piden nivel: no hablan de la negatividad de la conversación, y pedirlo
  llenaba el Semanal de niveles repetidos.
- **Dónde va el nivel:** en el mismo bloque (párrafo, viñeta, insight o ítem
  de comparación) que la variación, no «en la misma oración o la siguiente».
  El titular no lleva cifras y no se le pide.
- **Un segundo detector, `mejora_con_nivel_sostenido`:** con nivel sostenido,
  cualquier bloque, también el titular, que diga «va bajando», «se calma»,
  «pierde fuerza», «mejora» y similares. Es el caso exacto del 24-oct.

Los dos detectores leen el borrador con marcadores, van al corrector y, si no
se resuelven, quedan en `composition.warnings`.

### 2.9 Un solo cálculo para correo y Overview

`@eco/shared` gana dos piezas puras y sus cargas SQL (reciben un cliente pg,
como `loadChannels`):

- `open-issues`: se mudan de `apps/web/src/lib/narrative/overview.ts` las
  funciones de historias, cajón, duplicados y filas; la web las re-exporta
  desde el mismo archivo para que Narrativas no cambie. Encima,
  `buildOpenIssues(input, endYmd)`.
- `sustained-level`: `buildSustainedLevel(dailySeries28, endYmd)`.

El lambda de correos y la web llaman a lo mismo con la misma fecha F (ayer en
Puerto Rico). «El mismo bloque» del criterio 4 se cumple por construcción y se
comprueba comparando el JSON del endpoint con los hechos de la composición del
día.

### 2.10 El bloque lo pinta el código; el redactor lo recibe como hechos

Los nombres, días, etapa, voz y niveles salen en una tabla que arma el render.
El redactor los recibe como hechos (`issue_N_*`, `level_*`) y como contexto,
y los usa en el párrafo; no puede cambiar lo que dice la tabla. Así el bloque
no depende de que el modelo lo escriba bien, que es lo que pide el backlog:
cambiar qué recibe, no solo cómo redacta.

### 2.11 Regenerar una fecha pasada

`asOf` ya existe en `dryRun`. Los asuntos se calculan cortando por fecha de
publicación de la mención, así que una fecha pasada da los conteos de esa
fecha. Dos límites que se documentan y no se arreglan: la asignación de
menciones a narrativas y las fusiones son las de hoy, y las menciones que
llegaron tarde (importaciones de DF del 16 y 22-oct) hacen que las cifras no
sean idénticas a las del correo enviado.

---

## 3. Paquetes de trabajo

### WP-1 · Cálculo compartido de asuntos abiertos

1. Mudar a `packages/shared/src/narratives/` las funciones puras de
   `apps/web/src/lib/narrative/overview.ts` que hacen falta (`processRows`,
   `firstMention`, `cajonStats`, `peak14`, `groupStories`,
   `distinctiveTerms`, `findDuplicates`, constantes). `overview.ts` las
   re-exporta. Las pruebas de `overview.test.ts` pasan sin tocarse.
2. `loadOpenIssueRows(client, agencyId, endYmd, universe)`: narrativas con
   mención en los 7 días que terminan en F, sus menciones de toda la vida
   (con `likes + comments + shares`), y los pares de centroides ≥ 0.44 entre
   ellas y las narrativas con las que podrían agrupar (última mención en los
   21 días previos).
3. `buildOpenIssues(...)` devuelve, por asunto: id, nombre, narrativas
   miembro, menciones y negativas de 7 días y de los 7 previos, % negativo,
   primer día del tramo, días abierto, si es reabierto, etapa, voz principal
   (nombre, base y porcentaje), número de voces, y la cobertura (menciones de
   7 días en narrativa ÷ total).
4. Pruebas con filas sintéticas: agrupación, tramo con hueco de 15 días,
   cada etapa, voz por interacciones, voz sin interacciones, voz propia
   excluida, cajón excluido, menos de 3 asuntos, ninguno.
5. Prueba de calibración con datos reales anonimizados solo en estructura
   (ids y fechas, sin texto): DF al 23-oct da un primer asunto con 20 o más
   narrativas, 26 días abierto y más de 65 % negativo.

**Hecho cuando:** las pruebas pasan, Narrativas en producción muestra lo
mismo que antes (comparación del JSON de `/api/narrative/overview` antes y
después para las 3 agencias), y un script de solo lectura imprime los asuntos
de DF al 23-oct y al 15-nov con las cifras de la sección 1.2.

**Estado 16-nov: mergeado (#176).** Archivos:
`packages/shared/src/narratives/story-rules.ts` (reglas mudadas sin cambios,
más `isStoryEdge` extraída de `groupStories`), `open-issues.ts`
(`buildOpenIssues`, `groupIssues`, `loadOpenIssuesInput`) y
`scripts/int-01-open-issues-live.ts`. Pruebas: 34 nuevas en
`apps/web/src/lib/narrative/open-issues.test.ts`; las 31 de Narrativas pasan
sin tocarse.

Resultado del script contra producción (solo lectura):

| Agencia y fecha | Asuntos abiertos | Los que muestra el bloque |
|---|---|---|
| DF, 23-oct | 8 | Roig: sube, 290 esta semana y 89 la previa, 73 % negativas, 26 días, Jay Fonseca 39 % de las interacciones · Bebé con costillas fracturadas: nuevo, 24, 29 %, 2 días · Inglés obligatorio en Head Start: baja, 20 y 66, 5 %, 23 días |
| DF, 15-nov | 2 | Roig: sube, 121 y 57, 75 %, 49 días, Jay Fonseca 33 % · Trump cancela aumento salarial Head Start: nuevo, 14, 50 %, 3 días |
| DDEC, 15-nov | 4 | Cierre KFC Taco Bell: baja, 18 y 57, 0 %, 14 días · El Horno de Pane: baja, 11 y 43, 0 %, 46 días, sin voz dominante · Informes anuales negocios exentos: nuevo, 8, 0 %, 3 días |
| Gobernadora, 15-nov | 10 | Roig: sube, 46 y 18, 48 %, 46 días · Gas natural NFE: sube, 36 y 14, 0 %, 49 días · Jiménez Colón al NMEAD: sube, 25 y 0, 4 %, 4 días (reabierto) |

Lo que no se hizo como decía la versión 0.1:

- **La prueba de calibración con datos reales (punto 5) no se versionó.** El
  repositorio es público y la prueba necesita los nombres y palabras clave de
  todas las narrativas de la agencia. La sustituyen las pruebas sintéticas y
  el script, cuyo resultado queda en la tabla de arriba.
- **La comparación del JSON de Narrativas antes y después** se hace al
  desplegar la web (el merge la despliega). Hasta entonces la cubren las 31
  pruebas existentes.

Dos cosas que se ven en los datos y quedan para decidir en WP-4:

- **El lunes el bloque se queda corto.** DF al domingo 15-nov tiene 2 asuntos
  abiertos, no 3: «ASUME y pensiones» (10 menciones) y «Menor desaparecida en
  Canóvanas» (8) no tuvieron menciones de viernes a domingo y la regla de los
  últimos 3 días los saca.
- **La voz principal podía ser una persona particular.** Resuelto en WP-4:
  solo se nombran medios y cuentas con alcance (sección 2.5).

### WP-2 · Nivel sostenido

1. `loadSentimentDaily(client, agencyId, startYmd, endYmd, universe)` para 28
   días (el `SentimentReport` del correo solo trae 7 y los 7 previos).
2. `buildSustainedLevel(...)` devuelve por ventana: total, negativas,
   positivas, % negativo, NSS, si pasa cada umbral, y `sustained`.
3. Constantes `SUSTAINED_NEG_PCT = 30`, `SUSTAINED_NSS = -20`,
   `SUSTAINED_MIN_BASE = 30` en un solo sitio.
4. Pruebas: ventana con base insuficiente, borde exacto del umbral, serie con
   días sin menciones.

**Hecho cuando:** para DF al 23-oct el script de WP-1 imprime 14 días 63 % y
−62, 28 días 65 % y −65, `sustained = true`; para Gobernadora al 15-nov,
`sustained = false`.

**Estado 16-nov: mergeado (#176).**
`packages/shared/src/narratives/sustained-level.ts` (`buildSustainedLevel`).
No hizo falta un cargador nuevo: `loadDailySentimentSeries` ya da la serie
del mismo universo para cualquier rango. Resultado del script:

| Agencia y fecha | 14 días | 28 días | Sostenido |
|---|---|---|---|
| DF, 23-oct | 63 % negativo, NSS −62 (1,610 menciones) | 65 %, −65 (4,433) | sí |
| DF, 15-nov | 57 %, −55 (769) | 61 %, −60 (2,074) | sí |
| DDEC, 23-oct | 15 %, −9 (267) | 13 %, −6 (520) | no |
| DDEC, 15-nov | 18 %, −13 (436) | 12 %, +2 (1,303) | no |
| Gobernadora, 23-oct | 21 %, −19 (1,148) | 20 %, −17 (2,273) | no |
| Gobernadora, 15-nov | 29 %, −27 (1,326) | 26 %, −25 (2,596) | no |

Gobernadora al 15-nov está a un punto del umbral a 14 días y su NSS ya pasó
el −20 en las dos ventanas.

### WP-3 · Hechos nuevos para el redactor

1. `ComposerInput` gana `openIssues` y `sustainedLevel` (opcionales: sin
   ellos el motor se comporta como hoy, y las pruebas existentes pasan sin
   cambios).
2. `buildFactPackage` añade:
   - `level_14_neg_pct`, `level_14_nss`, `level_14_total`, y los mismos de 28;
   - `level_threshold_neg_pct`, `level_threshold_nss`;
   - por asunto (1 a 3): `issue_N_days_open`, `issue_N_week`, `issue_N_prev`,
     `issue_N_neg_pct`, `issue_N_voices`, `issue_N_voice_share`.
   Las etiquetas llevan el nombre del asunto y la voz, como ya hacen los
   tópicos. El NSS va sin signo en `display` y con el sentido en la etiqueta,
   como las variaciones del Semanal, para no repetir el signo doble.
3. Un bloque de contexto «ASUNTOS ABIERTOS» y otro «NIVEL SOSTENIDO» en el
   prompt de analista, redactor y QA, con una línea en palabras que dice si
   el nivel es sostenido.
4. Reglas de 2.8 en `profiles.ts` (redactor, corrector, QA) para `daily`,
   `weekly` y `overview`.
5. Detector `direccion_sin_nivel` en `lint.ts` con su lista de verbos.
6. `evaluateStoredComposition`: los hechos nuevos entran en la comparación
   que ya existe (valor y etiqueta). Un asunto que cambia de nombre o de
   puesto cambia la etiqueta y obliga a recomponer.
7. `COMPOSER_VERSION` sube a 1.1.0.
8. `buildDailyComposerInput` y el equivalente semanal cargan WP-1 y WP-2. Si
   la carga falla, el correo sale sin el bloque y con aviso en `delivery`
   (nunca se retiene).

**Hecho cuando:** las pruebas del composer pasan; un `dryRun` de las tres
agencias muestra los hechos nuevos en `composition.facts`; y en 5 corridas
del caso del 24-oct ninguna oración con variación queda sin nivel después del
corrector.

**Estado 17-nov: mergeado (#178) y desplegado (03:46 UTC).** Archivos:
`packages/shared/src/composer/interpretation.ts` (hechos, bloque de contexto
y detectores), y cambios en `facts.ts`, `context.ts`, `compose.ts`,
`profiles.ts`, `lint.ts` («14» y «28» dejan de ser cifras sin fuente),
`prompts.ts` (motor 1.1.0, prompts v1.2) y en los dos armadores del lambda
(`daily-composer.ts`, `weekly-composer.ts`), que cargan nivel y asuntos con
`loadInterpretationData`. Sin nivel ni asuntos en la entrada, el paquete de
hechos y los prompts de los perfiles que no llevan la regla quedan iguales.
`evaluateStoredComposition` no necesitó cambios: los hechos nuevos entran en
el mismo paquete que ya compara.

Las corridas del caso del 24-oct están en WP-6.

### WP-4 · Bloques en el Diario y el Semanal

1. `DailyReportRenderData` y `WeeklySummaryRenderData` ganan `openIssues` y
   `sustainedLevel`.
2. Bloque «Asuntos abiertos» después del resumen: hasta 3 filas con nombre,
   etapa con sus dos cifras, días abierto, % negativo, voz principal con su
   porcentaje y número de voces. Pie: «N de cada 100 menciones de la semana
   pertenecen a un asunto identificado».
3. Línea de nivel bajo las fichas de variación del Diario y bajo la tabla de
   comparación del Semanal, con el formato de 2.7.
4. Nota de metodología: una oración sobre qué es un asunto abierto y cuál es
   el umbral.
5. Cromo «Instrumento» existente (`instrument.ts`); todo numérico, sin
   niveles verbales; prueba de render a 500 px de ancho.
6. Con `composer_mode = legacy` no se pinta nada nuevo.
7. Vistas previas: `scripts/preview-*.ts` con datos de ejemplo y `dryRun` real
   de las 3 agencias, revisadas en Chrome headless.

**Hecho cuando:** las pruebas de render pasan y Alejandro aprueba las vistas
previas de DF, DDEC y Gobernadora (Diario y Semanal). El despliegue del lambda
va después de ese visto bueno, por esbuild y `update-function-code`, con el
bundle vivo comparado antes contra `main`.

**Estado 17-nov: mergeado (#178) y desplegado (03:46 UTC).**
`packages/shared/src/email/interpretation-blocks.ts` pinta la caja de nivel y
la sección de asuntos; los dos renders los colocan así:

- Diario: nivel entre las lecturas y el reparto (los dos grupos de
  variaciones); «Asuntos abiertos» como sección 02, tras el resumen del día.
- Semanal: nivel bajo las lecturas y bajo la tabla «Semana vs semana»;
  «Asuntos abiertos» como sección 02, tras el vistazo.

Sin `interpretation` (correo legacy) el HTML es el de antes: la huella del
Diario legacy de `render-daily-report.test.ts` no cambió.

Vistas previas: `scripts/int-01-preview-daily.ts` corre en local el mismo
camino del lambda (datos reales por `eco-migration`, motor con Bedrock y
render) sin desplegar ni enviar. El Semanal con datos reales necesita el
`dryRun` del lambda y se hace después del despliegue; hasta entonces lo cubren
las pruebas de render.

El «bloque del lunes» de WP-1 no pide cambio: del 1 al 15-nov, DDEC y
Gobernadora tuvieron 3 asuntos abiertos o más todos los días, y DF tuvo 2 en
tres días (13, 14 y 15-nov) porque el asunto Roig agrupa casi toda su
conversación, no por el fin de semana.

### WP-5 · El mismo bloque en el Overview

1. `GET /api/overview/open-issues?agency=`: mismas funciones, misma fecha F,
   caché de 10 minutos por agencia y día como `/api/narrative/overview`.
   Protegido en las dos listas del middleware.
2. Bloque en el Overview del SPA, entre «Resumen del periodo» y «Tendencia»:
   las mismas filas y la misma línea de nivel. Ventanas fijas que terminan
   ayer; el selector de periodo no lo cambia y el bloque lo dice.
3. Cada asunto enlaza a su historia en Narrativas.
4. `?v=prodcNN` nuevo.

**Hecho cuando:** para las 3 agencias, el JSON del endpoint coincide campo a
campo con los hechos `issue_*` y `level_*` de la composición del Diario del
mismo día, y una captura del Overview dentro del marco del dashboard muestra
el bloque.

**Estado 17-nov: en PR, sin mergear (el merge despliega la web).** Archivos:
`apps/web/src/lib/overview/open-issues.ts` (carga y respuesta),
`apps/web/src/app/api/overview/open-issues/route.ts` y el bloque
`OverviewAsuntos` en `apps/web/public/eco-prototype/screens.js` (bundle
`prodc105`). Pruebas: 13 en `apps/web/src/lib/overview/open-issues.test.ts`.

Cómo quedó:

- **Un solo cálculo.** El endpoint llama a `loadOpenIssues` y
  `buildSustainedLevel` con la fecha del correo (el último día cerrado) y con
  el universo del correo, no con el de la bandera `UNIVERSE_STRICT_AGENCIES`
  del resto del dashboard. Los textos de cada fila («sube · 255 en 7 días…»,
  la voz, la línea de nivel) los escriben las mismas funciones que pintan el
  correo; la SPA no redacta nada.
- **Dónde va.** Bloque «04 · Asuntos abiertos», entre el Resumen y la
  Tendencia, con el nivel a 14 y 28 días a la derecha. Tendencia, Insights y
  Tópicos pasan a 05, 06 y 07.
- **Ventanas fijas.** El 7D del Overview hoy incluye el día en curso; el
  bloque termina ayer, como el correo, y lo dice en su subtítulo («no cambia
  con el selector de periodo»).
- **Enlace.** Cada asunto abre Narrativas con su narrativa más activa ya
  elegida (`localStorage eco.narrative.focus`).
- **Sesión.** `/api/overview/*` ya estaba en las dos listas del middleware; la
  ruta lleva además `requireAuth`. Caché de 10 minutos por agencia y día; una
  carga fallida no se guarda.

Decisión que el spec dejaba abierta: el endpoint devuelve también los hechos
`level_*` e `issue_*` tal como entran al paquete del redactor (`facts`), para
que la comparación con el correo sea mecánica.

Comparación del 17-nov (`scripts/int-01-overview-vs-mail.ts`, solo lectura),
Overview contra un `dryRun` del Diario hecho en el mismo momento:

| Agencia | Hechos de nivel y de asuntos | Iguales | Distintos |
|---|---|---|---|
| DF | 26 | 26 | 0 |
| DDEC | 23 | 23 | 0 |
| Gobernadora | 26 | 26 | 0 |

Contra el Diario enviado a las 6 a. m. sí hay diferencias, y son esperadas: el
Overview se recalcula cada 10 minutos y el correo es una foto de la mañana. El
17-nov a las 2 p. m., DF tenía 7 hechos distintos de 26 (el asunto Roig, 241
menciones en el correo y 255 en el Overview; el nivel a 14 días, 58 % y 59 %)
y Gobernadora 3. En Gobernadora uno es grande: las menciones de los 7 días
previos del primer asunto pasaron de 15 a 100, porque el agrupador de
narrativas movió narrativas entre la mañana y la tarde y el asunto quedó
armado con otras. No es un error del bloque; es el límite que ya describe la
sección 2.11 (la asignación de narrativas es la del momento).

Verificación visual: la SPA completa servida en local, con `/api/overview`,
`/api/overview/open-issues` y `/api/narrative/overview` corriendo el código
real contra producción en solo lectura (a través de `eco-migration`). Se
revisó en escritorio y a 375 px, para DF, DDEC y Gobernadora, y el salto a
Narrativas. En esa prueba el texto del Resumen es el último guardado y las
«piezas que movieron la ventana» salen vacías: el arnés no los genera.

Lo que se vio al verificar y no es de este paquete:

- En DF, «Renuncia de Suzanne Roig por corrupción» (nueva el 16-nov, 19
  menciones) salió como tercer asunto, separada del asunto Roig: nació de una
  nota de agencia en inglés y no agrupó. Es el riesgo 1 de la sección 7.
- La voz principal de ese asunto es «Danica Coto» (periodista de AP, cuenta
  como medio) con 79 % de las menciones.
- En Narrativas, si la propagación de una narrativa falla siempre, la pantalla
  la vuelve a pedir sin parar. Ya pasaba antes de este cambio.

### WP-6 · Caso del 24-oct y cierre

1. 5 corridas `dryRun` del Diario de DF con `asOf` 24-oct 10:00 UTC y 5 del
   Semanal de DF con `asOf` del viernes 23-oct. Se guardan las composiciones.
2. Tabla por corrida: frases con dirección, si llevan nivel, y lo que dice el
   bloque de asuntos.
3. La regeneración de hoy (sección 1.1) queda como el «antes».
4. Informe en este documento contra la sección 4 y nota para la T0 de PRD-02.

**Hecho cuando:** el informe está en el doc y INT-01 pasa a 100 % en el
backlog o lista lo que no se cumplió.

**Avance 16-nov (antes de desplegar).** Con `scripts/int-01-preview-daily.ts`,
en local y sin enviar:

| Corrida del Diario de DF del 24-oct | Frases de calma | Da el nivel a 14 y 28 días | Dice los días abierto | Avisos de nivel tras el corrector |
|---|---|---|---|---|
| 1 | ninguna | sí (63 % y 65 %) | sí (26) | 0 |
| 2 | ninguna | sí | sí | 0 |
| 3 | ninguna | sí | sí | 0 |
| 4 | ninguna | sí | sí | 0 |
| 5 | ninguna | sí | sí | 0 |

Ejemplo (corrida 3): «El caso de los contratos de ADSEF lleva 26 días abierto
y acumuló 290 menciones en la semana, con 73 % de negativas. El volumen del
viernes bajó a 110 menciones frente a las 207 del jueves; la negatividad se
mantiene en nivel alto: 63 % a 14 días y 65 % a 28 días.»

En 2 de las 5 corridas el primer borrador traía una variación sin nivel (1 y
3 avisos) y el corrector la resolvió. Cada corrida tardó entre 118 y 126 s
(el `dryRun` anterior, sin los hechos nuevos, 90 s).

Otras vistas previas, una corrida cada una: DF del 31-oct (volumen de 7 días
327 contra 1,045; el párrafo da 62 % y 63 %), DDEC del 16-nov (nivel 18 % y
12 %, no sostenido) y Gobernadora del 16-nov (29 % y 26 %; el texto dice que
las negativas bajaron en número y que el nivel se mantiene).

**Después de desplegar (17-nov, 03:50 UTC).** `dryRun` del lambda para las
tres agencias, Diario y Semanal (ventana 9–15 nov), sin envío (0 filas en
`report_send_log` y 0 en la métrica `Send` de SES):

| Correo | Bloques de nivel y asuntos | El texto da 14 y 28 días | Días abierto en el texto | Avisos de nivel: 1er borrador → enviado | Segundos |
|---|---|---|---|---|---|
| Diario DF | sí | sí (57 % y 61 %) | sí (49) | 1 → 0 | 82 |
| Diario DDEC | sí | sí (18 % y 12 %) | sí | 1 → 0 | 82 |
| Diario Gobernadora | sí | sí (29 % y 26 %) | sí (46) | 0 → 0 | 89 |
| Semanal DF | sí | sí (57 % y 61 %) | sí (49) | 6 → 0 | 115 |
| Semanal DDEC | sí | sí | sí (14) | 4 → 0 | 92 |
| Semanal Gobernadora | sí | sí | sí (46) | 5 → 0 | 125 |

Ninguno salió degradado ni con frases de calma. El Semanal es donde más
trabaja el corrector (4 a 6 avisos en el primer borrador). Quedan por hacer las
corridas con `asOf` del 23 y 24-oct sobre el lambda y los 7 días en producción.

Lo que se ve en las vistas previas y no es de este ítem:

- En 4 de las 5 corridas de DF el titular del redactor se cambió por el
  determinista y la red de seguridad quitó frases, porque citan «$2.5
  millones» y «$38 millones», que vienen de las muestras y no de los hechos.
  Es de INT-02.
- La red cortaba la oración en «Christian W.». Corregido aquí
  (`splitSentences` ya no parte tras una inicial o un tratamiento).
- Siguen saliendo signos dobles («un aumento de +85 %», «-78 menos»). INT-02.
- El párrafo del Diario se alarga con el nivel y el asunto (hasta 8 oraciones
  en Gobernadora; la tarea pide de 2 a 4).

**Corridas de octubre sobre el lambda (17-nov, 18:19–18:27 UTC).** `dryRun`
de `eco-weekly-report` para DF, una corrida por caso, sin envío ni guardado:

| Corrida | Ventana | Nivel 14 y 28 días | Asunto Roig | Frases de calma | El texto da el nivel | El texto da los días abierto | Avisos de nivel enviados | Segundos |
|---|---|---|---|---|---|---|---|---|
| Diario, `asOf` 24-oct 10:00 UTC | 17–23 oct | 63 % y 65 % (NSS −62 y −65) | 26 días · 290 esta semana, 89 la previa · 73 % negativas | ninguna | sí | sí | 0 | 119 |
| Diario, `asOf` 23-oct 10:00 UTC | 16–22 oct | 64 % y 65 % (NSS −63 y −64) | 25 días · 298 y 48 · 73 % | ninguna | sí | sí | 0 | 99 |
| Semanal, `asOf` 23-oct 19:00 UTC | 16–22 oct | 64 % y 65 % | 25 días · 298 y 48 · 73 % | ninguna | sí | sí | 0 | 115 |
| Semanal, `asOf` 24-oct 19:00 UTC | 17–23 oct | 63 % y 65 % | 26 días · 290 y 89 · 73 % | ninguna | sí | sí | 0 | 132 |

Los cuatro HTML llevan la sección «Asuntos abiertos» y la caja de nivel.
Diario del 24-oct: «El volumen del viernes bajó a 110 menciones frente a las
207 del jueves, pero la negatividad se mantiene alta: a 14 días el porcentaje
de negativas es 63 % y a 28 días es 65 %, ambos por encima del umbral.» Con
las 5 corridas locales del 16-nov, el caso del 24-oct suma 6 de 6 sin frases
de calma. No se hicieron las 5 corridas del Semanal que pedía el punto 1: hay
2, las dos limpias.

**Comprobación diaria de los correos reales.** `scripts/int-01-wp6-check.ts`
(solo lectura: `report_send_log` por `eco-migration` y los logs del lambda con
el CLI de AWS). Por cada envío programado dice si salió con el motor 1.1.0,
con el nivel a 14 y 28 días y los asuntos en los hechos archivados, y sin
`direccion_sin_nivel` ni `mejora_con_nivel_sostenido` después del corrector.
Un día cuenta solo si todos sus envíos están en OK.

```bash
set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
node_modules/.bin/tsx scripts/int-01-wp6-check.ts
```

Primer resultado (17-nov):

| Día | Correo | Resultado |
|---|---|---|
| 17-nov | Diario Gobernadora | OK: motor 1.1.0, nivel y asuntos, 0 avisos de nivel |
| 17-nov | Diario DF | OK: motor 1.1.0, nivel y asuntos, 0 avisos de nivel |
| 17-nov | Diario DDEC | Sin evidencia: el correo salió (9 destinatarios, compuesto por el motor en el momento) pero no dejó archivo |

**El 17-nov no cuenta para los 7 días.** El Diario de DDEC no se pudo
archivar: la base rechazó la composición («invalid input syntax for type
json») tres veces, al guardarla 2 horas antes del envío (08:02 UTC), al
componerla de nuevo en el envío (10:02) y al escribir `report_send_log`. La
causa, confirmada con un `dryRun` del mismo día: una muestra recortada a 420
caracteres termina en medio emoji, y PostgreSQL no acepta eso en una columna
`jsonb`. El correo en sí salió bien; lo que falta es la prueba. Mientras esa
mención siga entre las muestras de la semana (hasta el 22-nov), el Diario de
DDEC seguirá sin archivo.

Corrección en el mismo PR (`infra/lambda/lib/pg-json.ts` y
`clipSampleText`): el recorte ya no parte un emoji y lo que se guarda en la
base se sanea antes. **Necesita redesplegar `eco-weekly-report`.** Si el
lambda queda desplegado antes de las 08:00 UTC del 18-nov (cuando se compone
el Diario), los 7 días van del 18 al 24-nov, con el Semanal del viernes 20
dentro. Cada día de retraso corre esa fecha un día.

Falta: desplegar la corrección, los 7 días seguidos en OK y el informe de
cierre contra la sección 4.

---

## 4. Criterios de aceptación

| Backlog | Cómo se mide en este spec | Hoy |
|---|---|---|
| El Diario y el Semanal muestran hasta 3 asuntos abiertos con días abiertos y voz principal | Prueba de render y `dryRun` de las 3 agencias: el bloque existe, con 0 a 3 filas, cada una con días abierto y voz (o «sin voz dominante» con su número de voces) | No existe |
| Cada variación va acompañada del nivel a 14 y 28 días | Fichas y tabla: prueba de render. Prosa: 0 oraciones con variación y sin nivel después del corrector en las 10 corridas de WP-6 y en los correos de 7 días seguidos en producción (`residualCodeProblems` sin `direccion_sin_nivel`) | No existe; el paquete no trae niveles |
| Regenerar el correo de DF del 24-oct ya no produce «va bajando» | En 5 de 5 corridas: ninguna frase dice que la conversación baja, mejora o se calma; el correo muestra 14 días 63 % y 28 días 65 % con el umbral, y el asunto Roig con 26 días abierto | 1 de 1 corrida sin «va bajando», pero sin nivel ni días abierto y sin nada que lo garantice |
| El Overview muestra el mismo bloque que el correo | JSON del endpoint igual a los hechos de la composición del mismo día en las 3 agencias; captura del bloque | No existe |

Estado al 17-nov contra cada criterio:

| Criterio | Estado |
|---|---|
| Hasta 3 asuntos abiertos con días y voz en el Diario y el Semanal | Cumplido: en producción desde el 17-nov (`dryRun` de los 6 correos y Diarios reales de DF y Gobernadora) |
| Cada variación con su nivel a 14 y 28 días | Fichas y tabla: cumplido. Prosa: 0 avisos en 10 corridas de octubre (6 del Diario, 2 del Semanal y las 2 del 23-oct) y en los 2 Diarios reales archivados; faltan los 7 días seguidos |
| El correo de DF del 24-oct ya no dice «va bajando» | Cumplido: 6 de 6 corridas del Diario, con 63 % y 65 % y 26 días abierto |
| El Overview muestra el mismo bloque | Hecho y verificado (0 diferencias en las 3 agencias); falta mergear el PR |

---

## 5. Orden y dependencias

| Día | Qué | Depende de |
|---|---|---|
| 17–18 nov | WP-1 y WP-2 (un PR, sin despliegue de lambdas; el merge despliega la web con Narrativas sin cambios visibles) | Aprobación de las decisiones 1 a 3 |
| 18–20 nov | WP-3 y WP-4 (un PR); vistas previas | WP-1, WP-2 |
| 20 nov | Visto bueno de las vistas previas y despliegue de `eco-weekly-report` | Alejandro |
| 20–23 nov | WP-5 (un PR; se despliega al mergear) | WP-1, WP-2 |
| 23–25 nov | WP-6 y primeros días en producción | WP-3, WP-4 |

El primer Diario con el bloque saldría el 21-nov y el primer Semanal ese mismo
viernes a las 3 PM. Los 7 días seguidos del criterio 2 terminan el 28-nov,
después de la fecha del backlog.

Rollback del lambda: el zip vivo anterior, guardado antes de desplegar. Rollback
del texto sin redesplegar: `composer_mode = 'legacy'` (el bloque nuevo no se
pinta en legacy).

---

## 6. Decisiones pendientes

1. **Asunto = historia (grupo de narrativas), no narrativa suelta** (2.1).
   Recomendado: aceptar. Sin esto el bloque de DF muestra tres pedazos del
   mismo caso.
2. **Qué 3 se muestran** (2.6). Recomendado: menciones más negativas (una
   negativa cuenta doble). Alternativa: solo menciones, que es la lectura
   literal de «las más activas».
3. **Umbral fijo de 30 % negativo y NSS −20 para todas las agencias** (2.7).
   Recomendado: aceptar. Alternativa: «lo usual» de cada agencia (V5.3), que
   para DF absorbería la crisis de octubre y es justo lo que el backlog quiere
   evitar.
4. **Voz principal por interacciones** (2.5). Recomendado: aceptar.
5. **Días abierto por tramo, con corte a los 14 días sin menciones** (2.3).
   Recomendado: aceptar.
6. **Los asuntos positivos y neutrales también son «asuntos abiertos»** (el
   bloque de DDEC al 15-nov sería «DDEC apoya trabajadores cierre KFC Taco
   Bell», «El Horno de Pane», «Informes anuales negocios exentos», los tres
   con 0 % negativo). Recomendado: sí, con el % negativo a la vista. Alternativa:
   llamar al bloque «Asuntos de la semana» cuando ninguno pasa de 30 % negativo.
7. **Mostrar la cobertura en el pie del bloque** («42 de cada 100 menciones
   pertenecen a un asunto identificado»). Recomendado: sí.
8. **Encender el motor en los textos del Overview** (`COMPOSER_WEB_AGENCIES` y
   redespliegue de `eco-ai-tasks`). Fuera de este spec; recomendado tratarlo
   como ítem aparte después de INT-02.

## 7. Riesgos

- **La agrupación en historias falla en un caso nuevo** (une dos asuntos o
  parte uno). Los umbrales de #131 tienen poco margen (0.44 contra 0.47). La
  prueba de calibración de WP-1 cubre DF; las vistas previas de WP-4 cubren
  las otras dos agencias. Un asunto mal agrupado se ve en el nombre.
- **El asunto que más duele no está en ninguna narrativa.** En Gobernadora
  solo 22 % de las negativas de la semana están en una narrativa. El nivel
  sostenido no depende de narrativas y sí lo recoge; el bloque informa la
  cobertura.
- **Más hechos, más errores de marcador.** El Semanal de DF ya tenía 20 % de
  defectos por marcadores mal usados. Los hechos nuevos son pocos (hasta 26)
  y llevan el sentido en la etiqueta; el resto es de INT-02.
- **Tiempo de composición.** Hoy 90 s para el Diario de DF; las cargas nuevas
  son dos consultas y no añaden llamadas al modelo.
- **`eco-weekly-report` vivo distinto de `main`.** Se desplegó el 3-nov; antes
  de desplegar se compara el fuente del bundle vivo con `main`.
- **El 24-oct no se puede reproducir idéntico** (2.11). El criterio 3 se mide
  sobre los datos de hoy para esa ventana.
