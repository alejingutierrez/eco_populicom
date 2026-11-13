# Spec · ING-01 · Ingesta que aguante los límites de Brandwatch

**Versión 1.0 · 13 de noviembre de 2026 · cierre previsto 20 de noviembre**

Este spec cubre el 15 % que le falta a ING-01. Lo ya hecho (#147, #150, #152,
#155) está descrito en `docs/tecnica/ingesta-brandwatch-429.md` y no se repite
aquí. Las rutas de código son de `origin/main` (636f76b) y de la rama
`fix/ingesta-pagina-500` (0855bc9). Las cifras de producción se midieron el
13-nov entre las 17:00 y las 17:40 UTC.

---

## 0. Resumen

### 0.1 Qué falta construir

| # | Paquete | Qué entrega | Repo |
|---|---|---|---|
| WP-1 | Mergear las 500 por página | PR #170 en `main`, con el bundle vivo comprobado contra la rama | ECO |
| WP-2 | Señal de salud y alarmas | La ingesta publica métricas propias; tres alarmas en CDK; la de «ingesta callada» avisa en menos de 15 min | ECO |
| WP-3 | Ceder con la cuota vista | La ingesta lee `x-rate-limit-used` y deja de pedir antes de llegar al 429; cada petición tiene tiempo máximo | ECO |
| WP-4 | Crons escalonados | Los dos crons de 5 min pasan de `rate` a `cron` con minutos fijos y distintos | ECO y BrandIQ |
| WP-5 | Reparto de cuota escrito | Una misma tabla de reparto en los dos repos, con las reglas para llamadas a mano | ECO y BrandIQ |
| WP-6 | Medición de frescura y cierre | Informe de 7 días contra los criterios de aceptación | ECO |

### 0.2 Qué no se construye en este spec

- **Pasar los crons en vivo de ECO por el planificador de BrandIQ** (fase 5 de
  `docs/COLA-BRANDWATCH.md` de BrandIQ). El planificador sigue en modo sombra
  y su fase 3b no está activa. Queda como ítem aparte.
- **Una tabla DynamoDB de cupo compartido** (opciones A y B del doc técnico).
  La sustituye WP-3, ver sección 2.3.
- **Filtrar los shells de X en la petición** (`pageType`). Con 500 por página
  ya no cuestan peticiones.
- **Bajar el timeout del lambda de 15 min.** El refresh y el backfill corren en
  el mismo lambda y necesitan 12–14 min. El presupuesto de 180 s se hace
  cumplir en código (y WP-3 cierra el hueco que tenía).
- **Pedir a Brandwatch más cuota o un segundo usuario de API.** No es código.
  Se recomienda pedirlo en paralelo: es lo único que separa las cuotas de
  verdad.

---

## 1. Estado medido el 13-nov

### 1.1 Lo que está bien

| Indicador | Valor | Fuente |
|---|---|---|
| Peticiones por corrida incremental | 6.0 de media desde el 5-nov (antes 7.0–8.1) | log `[run] mode=incremental` |
| Consumo de ECO | 12 de 30 por ventana de 10 min | 6 peticiones × 2 corridas |
| Refresh de 07:00 UTC | 6–8 peticiones en 2.5–3.5 min desde el 5-nov (antes 14–24 en 6.5–11.5 min) | log `[run] mode=refresh` |
| Avisos «Rate limited» de ECO | 0 al día desde el 5-nov, salvo 2 el 11-nov | log |
| Corridas abortadas por el cortacircuitos | 0 desde el 5-nov, salvo 2 el 11-nov | log `ABORTED` |
| Cursores | Las 6 queries activas sondeadas a las 17:25 UTC | `ingestion_cursors.last_run_at` |

Por día, avisos «Rate limited» de ECO en los últimos 14 días: 2-nov 86,
3-nov 9, 4-nov 7, 11-nov 2 y el resto 0. El 2-nov coincide con las pruebas
manuales de BrandIQ contra la API.

### 1.2 Lo que no está bien

1. **PR #170 sigue abierto.** Está desplegado desde el 4-nov 14:34 UTC
   (CodeSha256 vivo `5ZSnM4CW…`), mergeable y limpio. `main` no refleja lo que
   corre en producción: un deploy desde `main` devolvería la ingesta a 100 por
   página.
2. **La alarma que existe tarda 30 minutos y mide otra cosa.**
   `eco-ingestion-not-running` salta con menos de 1 invocación en 3 periodos de
   10 min. Mide que el lambda se invoque, no que traiga datos: el lambda
   responde 200 aunque el cortacircuitos aborte la corrida o fallen todas las
   queries. Del 24 al 26-oct habría seguido en OK.
3. **Las alarmas de ingesta no están en git.** `eco-ingestion-not-running` y
   `eco-ingestion-errors-sustained` se crearon a mano. `monitoring-stack.ts`
   solo tiene `eco-lambda-ingestion-errors` y la de la DLQ. No hay ningún
   filtro de métrica sobre el log.
4. **Los dos crons de 5 min se disparan con 48 segundos de diferencia.** ECO
   corre a los `:00:15` y BrandIQ a los `:04:27`. Los dos son `rate(5 minutes)`,
   así que la fase depende de cuándo se creó cada regla y cambia si se recrea.
5. **Una petición colgada se salta el presupuesto.** El 1-nov 03:15 UTC una
   corrida incremental duró 302 s con presupuesto de 180 s (`fetch failed`). El
   `fetch` del cliente no tiene tiempo máximo.
6. **ECO no mira la cuota antes de pedir.** La API devuelve en cada respuesta
   `x-rate-limit-used` con lo gastado por la cuenta entera. BrandIQ ya lo lee y
   cede (`cesion.ts`). El cliente de ECO solo lee `Retry-After`.
7. **El reparto de cuota no está escrito en ninguna parte.** El doc técnico de
   ECO propone 14 / 10 / 6 como opción; el de BrandIQ usa una reserva de 6. No
   hay acuerdo firmado ni aplicado.

### 1.3 Frescura, línea base (6 a 13-nov, ingestas `brandwatch`)

Horas entre la publicación y la entrada a ECO, por día de ingesta:

| Agencia | Mediana (rango diario) | p90 (rango diario) | % que entra en la hora 07 UTC |
|---|---|---|---|
| DDEC | 0.6–3.2 h | 5.6–30.9 h | 0–22 % |
| DF | 2.9–7.7 h | 6.0–34.7 h | 0–38 % |
| Gobernadora | 2.2–6.4 h | 5.8–31.1 h | 0–33 % |

El piso es el rezago de Brandwatch al indexar (mediana 2.5–3 h en web). Los p90
de ~31 h son artículos con fecha sin hora (00:00), que solo recoge el refresh.
El 7 y 8-nov salen peor en las tres agencias (20–38 % en la hora 07); no se
investigó la causa.

---

## 2. Decisiones del spec

### 2.1 El criterio «1 hora sin menciones nuevas» se reescribe (aceptado 13-nov)

Tal como está en el backlog no se puede cumplir ni medir. Con la ingesta sana y
cero avisos de límite, en los últimos 7 días hubo huecos de más de 1 hora entre
menciones ingeridas: 59 en DDEC, 42 en DF y 35 en Gobernadora (máximos de 5.6,
9.2 y 4.9 h). Son las madrugadas y los ratos sin conversación, no fallos.

Lo que el criterio quiere proteger es que ninguna agencia se quede sin
**sondear**. Queda así:

> Siete días seguidos sin que ninguna query activa pase más de 1 hora sin un
> sondeo completado.

Se mide con `ingestion_cursors.last_run_at`, que ya sube en cada sondeo, con o
sin menciones (`touchCursor`, #152).

### 2.2 La alarma mide datos, no invocaciones

La señal es «al menos una query completó su sondeo en los últimos 10 min». Si el
lambda no corre, aborta todo o la base falla, la métrica falta y la alarma salta.

### 2.3 El «limitador compartido» es la cabecera de Brandwatch

El backlog pide un limitador de ~25 consultas cada 10 min compartido entre los
dos productos. `x-rate-limit-used` ya es ese contador: lo lleva Brandwatch,
cuenta a los dos productos y a las llamadas a mano, y llega gratis en cada
respuesta. Si cada ingesta lo lee y deja de pedir al acercarse al techo, el
efecto es el de un limitador compartido sin infraestructura ni dependencia
entre productos. BrandIQ ya lo hace; falta ECO (WP-3).

Esto sustituye a las opciones A y B del doc técnico. Al implementar WP-3 se
actualiza esa sección del doc.

**Sin verificar por ECO:** el comportamiento de la cabecera está tomado de
`docs/COLA-BRANDWATCH.md` de BrandIQ (medido el 2-nov). El primer paso de WP-3
es registrarla en el log de ECO y confirmar que llega en todas las respuestas,
sin hacer llamadas extra.

### 2.4 Reparto propuesto

Por ventana de 10 minutos, sobre 30:

| Quién | Cupo | Consumo medido hoy |
|---|---|---|
| ECO en vivo | 14 | 12 |
| BrandIQ en vivo | 10 | ~6 (cifra de BrandIQ, 2-nov) |
| Reserva: tropiezos y llamadas a mano | 6 | n/a |

Consecuencias:

- **Techo de cesión: 24.** Con `used ≥ 24`, ninguna ingesta pide más en esa
  corrida.
- **A ECO le cabe una query más.** Cada query activa cuesta 2 peticiones por
  ventana. Con 6 queries gasta 12; la séptima lo lleva a 14 y la octava se sale
  del cupo. Dar de alta una agencia con query propia pasa a ser una decisión de
  cuota.
- **Llamadas a mano:** hasta 5 por ventana sin pausar nada. Para más, el
  procedimiento de pausa (concurrencia 0 en las dos ingestas, 11 min de
  silencio).
- **Trabajo de fondo** (refresh, conciliación, reseñas, rellenos): fuera de las
  22–07 UTC cuando se pueda. Hoy ya están separados: ECO 07:00, BrandIQ 09:30,
  12:00 y 12:15 UTC.

El reparto depende del acuerdo con BrandIQ (columna «Depende de» del backlog).

---

## 3. Paquetes de trabajo

### WP-1 · Mergear las 500 por página

1. Descargar el bundle vivo de `eco-ingestion` y comparar el fuente embebido en
   su `.map` contra `origin/fix/ingesta-pagina-500` (`index.ts`, `cursor.ts`,
   `query-order.ts`, `run-guard.ts`, `client.ts`, `resilience.ts`).
2. Si es idéntico, mergear #170 con squash. Si difiere, parar y reportar la
   diferencia.

**Hecho cuando:** `main` contiene `PAGE_SIZE = 500` y el fuente vivo coincide
con `main`.

**Hecho el 13-nov.** Los 6 archivos con fuente del bundle vivo (`5ZSnM4CW…`)
eran idénticos a la rama; #170 mergeado con squash (`e344e58`). El merge no
tocó `apps/web` ni `packages`, así que no disparó deploy de la web. Tras el
merge, el fuente vivo coincide con `main` en los 6 archivos.

### WP-2 · Señal de salud y alarmas

**Métricas.** El handler escribe una línea EMF al cierre de cada corrida
(namespace `ECO/Ingesta`, sin permisos nuevos ni cambios de CDK en el lambda):

| Métrica | Valor | Dimensión |
|---|---|---|
| `QueriesSondeadas` | queries que completaron su sondeo | `Modo` |
| `QueriesFallidas` | queries con error o sin sondear | `Modo` |
| `CorridaAbortada` | 1 si se abrió el cortacircuitos | `Modo` |
| `Avisos429` | respuestas 429 recibidas | `Modo` |
| `Peticiones` | peticiones hechas a Brandwatch | `Modo` |
| `CuotaUsadaMax` | el `x-rate-limit-used` más alto visto (WP-3) | ninguna |
| `MinutosSinSondeoMax` | antigüedad del `last_run_at` más viejo entre las queries activas, leído al empezar | ninguna |

`MinutosSinSondeoMax` sale de la lectura de `ingestion_cursors` que la corrida
ya hace para ordenar las queries. Una query sin fila de cursor no cuenta.

Cada métrica con dimensión `Modo` se publica también sin dimensión (dos
conjuntos de dimensiones en la misma línea EMF). Las alarmas usan la versión
sin dimensión, así un refresh o un backfill que completan queries también
cuentan como señal de vida. Un backfill manual de más de 10 min publica su
línea solo al terminar y puede disparar `eco-ingesta-callada`: es esperado y
se anota en el procedimiento de backfill.

**Alarmas** (en `infra/lib/monitoring-stack.ts`, acción SNS `eco-alerts-ops`):

| Alarma | Condición | Datos faltantes | Tiempo hasta avisar |
|---|---|---|---|
| `eco-ingesta-callada` | `Sum(QueriesSondeadas) < 1` en 2 periodos de 5 min | cuentan como fallo | 10–13 min |
| `eco-ingesta-query-desatendida` | `Max(MinutosSinSondeoMax) > 60` en 1 periodo de 5 min | no cuentan | n/a |
| `eco-ingesta-429-dia` | `Sum(Avisos429) ≥ 10` en 1 periodo de 24 h | no cuentan | n/a |

La primera cubre el criterio de los 15 minutos. La segunda cubre el caso del
24–26-oct: el lambda corre y alguna query se sondea, pero otras nunca llegan.

**Alarmas viejas.** Cuando las nuevas lleven 24 h en OK se borran las dos
manuales (`eco-ingestion-not-running`, `eco-ingestion-errors-sustained`).
`eco-lambda-ingestion-errors` se queda.

**Despliegue.** Lambda por esbuild + `update-function-code`. Alarmas con
`cdk deploy EcoMonitoring`, con `cdk diff` antes: el stack no debe tocar nada
más que las tres alarmas nuevas. Si el diff trae otra cosa, se crean con
`put-metric-alarm` idénticas al código y se deja el deploy de CDK para después.

**Simulacro.** Poner `eco-ingestion` en concurrencia 0 durante 15 min en una
hora tranquila y cronometrar hasta que llegue el correo. Es una acción sobre
producción y necesita el visto bueno de Alejandro antes de hacerla.

**Pruebas:** unitarias de la línea EMF (corrida normal, abortada, sin
menciones, con la lectura de cursores fallida).

**Hecho cuando:** las tres alarmas existen desde CDK, están en OK, y el
simulacro avisó en menos de 15 min.

**Estado 13-nov:** código y pruebas en la rama `feat/ing-01-salud-cuota`, sin
desplegar. La línea EMF va por `process.stdout.write`; hay que confirmar tras
el deploy que las métricas aparecen en `ECO/Ingesta`. Faltan el deploy del
lambda, crear las alarmas, borrar las dos manuales y el simulacro.

### WP-3 · Ceder con la cuota vista

**Cliente** (`packages/brandwatch/src/client.ts`, `resilience.ts`):

- Tras cada respuesta, incluidas las 429, leer `x-rate-limit-used` y pasarlo a
  `RunBudget.observeQuota(used)`. Sin cabecera o con valor no numérico, no se
  observa nada.
- `RunBudget.acquire()` lanza `BrandwatchBudgetError` con razón nueva
  `quota-ceiling` cuando la última lectura es `≥ techo` y tiene menos de 60 s.
  El techo llega por `BrandwatchConfig` (24 en `incremental` y `refresh`; sin
  techo en `backfill`, que es manual y se hace con la ingesta pausada).
- Cada `fetch` lleva `AbortSignal.timeout(45_000)`. Un tiempo agotado se trata
  como un 5xx: reintenta dentro del mismo límite de intentos.

**Handler** (`infra/lambda/ingestion/run-guard.ts`, `index.ts`):

- `quota-ceiling` abre el cortacircuitos como ya lo hace `request-cap`: las
  queries que faltan no se sondean y quedan primeras en la corrida siguiente
  por el orden de antigüedad.
- La primera petición de la corrida siempre sale (no hay lectura todavía).
- Log por corrida: `CUOTA-USADA max=N techo=24`.
- El tope del refresh (`maxRequests`) baja de 24 a 12. Hoy gasta 6–8.

**Fallar abierto:** cualquier problema al leer la cabecera deja la corrida como
hoy.

**Pruebas** (reloj y `fetch` falsos, ninguna llama a Brandwatch):

- con `used = 24` tras la segunda petición, la tercera no sale y la corrida
  termina con resumen;
- la lectura de más de 60 s no bloquea;
- sin cabecera, comportamiento idéntico al actual (las pruebas de ingesta
  existentes pasan sin cambios);
- un `fetch` que no responde se corta a los 45 s y la corrida respeta los 180 s.

**Hecho cuando:** durante 48 h el log muestra `CUOTA-USADA` en todas las
corridas, ninguna corrida incremental pasa de 180 s y las cesiones por techo
(si las hay) no dejan ninguna query más de 1 hora sin sondeo.

**Estado 13-nov:** código y pruebas en la rama `feat/ing-01-salud-cuota`, sin
desplegar. Añadido respecto al plan: un 429 con la cuenta ya en el techo no se
reintenta. Sin verificar todavía que la cabecera llegue en las respuestas a
ECO: se ve en la primera corrida tras el deploy (`CUOTA-USADA` en el log).

### WP-4 · Crons escalonados

| Regla | Hoy | Nuevo |
|---|---|---|
| `EcoWorkers-IngestionSchedule…` | `rate(5 minutes)`, corre a `:00:15` | `cron(0/5 * * * ? *)` |
| `BiqWorkers-IngestionSchedule…` | `rate(5 minutes)`, corre a `:04:27` | `cron(2/5 * * * ? *)` |

Quedan 2 min entre el arranque de ECO y el de BrandIQ, y 3 min al revés. Una
corrida normal de ECO dura 5–20 s.

**Cómo.** El cambio va en `workers-stack.ts` de cada repo y se aplica sobre la
regla viva con `aws events put-rule` (misma regla, nueva expresión).
`cdk deploy EcoWorkers` no se usa: `main` lleva lambdas sin desplegar y las
arrastraría. Al quedar el código igual que lo vivo, no hay drift.

Los crons diarios no se tocan: ya están separados (sección 2.4).

**Hecho cuando:** 24 h de logs muestran a ECO arrancando en los minutos 0 y 5 y
a BrandIQ en los 2 y 7, sin corridas descartadas.

### WP-5 · Reparto de cuota escrito

Una sección «Reparto de la cuota de Brandwatch» con el mismo texto en
`docs/tecnica/ingesta-brandwatch-429.md` (ECO) y `docs/COLA-BRANDWATCH.md`
(BrandIQ), más una nota en el `CLAUDE.md` de cada repo. Contenido:

- la tabla de la sección 2.4 y el techo de cesión;
- el costo de una query nueva y cuántas caben;
- las reglas de llamadas a mano y el procedimiento de pausa;
- las horas de los trabajos de fondo de cada producto;
- quién decide un cambio de reparto.

«Aplicado en los dos productos» significa: ECO cede en 24 (WP-3); BrandIQ
confirma que su `cesion.ts` usa el mismo techo (hoy cede el cron siguiente al
ver `used ≥ 28`) y lo ajusta si hace falta.

**Hecho cuando:** el texto está mergeado en los dos repos y los dos techos
coinciden con él.

### WP-6 · Medición de frescura y cierre

Ventana: 7 días completos desde que WP-2, WP-3 y WP-4 estén en producción.
El informe se añade al doc técnico con:

- la tabla de la sección 1.3 repetida para la ventana nueva;
- los cuatro criterios de la sección 4, cada uno con su número;
- una recomendación sobre el lookback de 8 h. Con 500 por página el lookback ya
  no cuesta peticiones: si el porcentaje que entra en la hora 07 UTC sigue por
  encima del 10 %, se propone volver a 12 h.

**Hecho cuando:** el informe está en el doc y el ítem ING-01 del backlog pasa a
100 % o lista lo que no se cumplió.

---

## 4. Criterios de aceptación

| Backlog | Cómo se mide en este spec | Hoy |
|---|---|---|
| 7 días sin que una agencia activa pase más de 1 hora sin menciones nuevas | 7 días con `Max(MinutosSinSondeoMax) ≤ 60` (reescrito, sección 2.1) | Sin métrica; las 6 queries se sondean cada 5 min |
| Menos de 10 avisos de límite (429) al día | `Sum(Avisos429) < 10` cada día de la ventana, en ECO. BrandIQ reporta el suyo con su propio log | ECO: cumple desde el 5-nov. BrandIQ: sin medir aquí |
| Si la ingesta se detiene, llega una alarma en menos de 15 minutos | Simulacro de WP-2 cronometrado | No cumple: la alarma actual tarda 30 min y no detecta corridas abortadas |
| Reparto de cuota con BrandIQ escrito y aplicado en los dos productos | WP-5 mergeado en los dos repos; techos iguales | No existe |

---

## 5. Orden y dependencias

| Día | Qué | Depende de |
|---|---|---|
| 13–14 nov | WP-1 (merge de #170) | nada |
| 14–17 nov | WP-2 y WP-3 en un solo PR y un solo deploy del lambda | WP-1 |
| 17 nov | Simulacro de la alarma | WP-2; visto bueno de Alejandro |
| 17–18 nov | WP-4 y WP-5 | Acuerdo con BrandIQ |
| 18–20 nov | Primeros días de la ventana de WP-6 | WP-2, WP-3, WP-4 |

La ventana de 7 días de WP-6 termina después del 20-nov. El 20-nov se puede
cerrar el desarrollo; los criterios de 7 días se confirman el 25-nov si todo
entra en producción el 18.

Rollback de cualquier deploy del lambda: el zip vivo anterior, guardado antes
de desplegar (el lambda no tiene versiones publicadas).

---

## 6. Decisiones pendientes

1. ~~Reescritura del criterio de 1 hora~~ (sección 2.1). **Aceptada por
   Alejandro el 13-nov.** Falta cambiar el texto en el backlog.
2. **Reparto 14 / 10 / 6 y techo 24** (sección 2.4). Recomendado: aceptar y
   llevarlo a BrandIQ.
3. **Limitador por cabecera en vez de tabla compartida** (sección 2.3).
   Recomendado: aceptar; el planificador de BrandIQ queda como ítem aparte.
4. **Simulacro de 15 min con la ingesta en pausa** (WP-2). Hace falta el visto
   bueno y la hora.
5. **Pedir a Brandwatch más cuota o un segundo usuario de API.** Fuera del spec,
   recomendado hacerlo ya.

## 7. Riesgos

- **BrandIQ no confirma su consumo ni su techo.** WP-1, WP-2 y WP-3 no dependen
  de eso y cubren tres de los cuatro criterios.
- **La cabecera no llega siempre.** WP-3 falla abierto; se pierde la cesión
  anticipada y queda el cortacircuitos de hoy.
- **`cdk deploy EcoMonitoring` arrastra cambios ajenos.** Se revisa el diff y,
  si no está limpio, las alarmas se crean por CLI.
- **Páginas de 500 con 504.** El 11-nov hubo 15 errores de servidor de
  Brandwatch en una racha. Si se repiten sobre la misma query, `PAGE_SIZE`
  vuelve a 100 con una línea.
