# Ingesta de Brandwatch ante rachas de 429

> Cómo `eco-ingestion` se comporta cuando Brandwatch responde 429, por qué, y
> cómo compartir el limitador con `biq-ingestion` (diseño, **no implementado**).

## Por qué existe

La cuota de la API de Brandwatch es de ~30 requests cada 10 minutos **por
cuenta**. La comparten `eco-ingestion`, `biq-ingestion` (BrandIQ usa el mismo
token) y cualquier llamada manual a la API. Los 429 **también consumen cupo**:
reintentar rápido, o durante mucho rato, dentro de una racha la prolonga.

Hasta el 28-oct-2026 cada request reintentaba hasta 11 veces con esperas de
hasta 45 s (≈5 min de esperas por query) y, cuando una query agotaba los
reintentos, la corrida seguía con las demás, que repetían la escalera. Con el
lambda en concurrencia reservada 1 y un cron cada 5 minutos, una racha de 429
produjo corridas de 676 s y 759 s: Gobernadora y DF estuvieron sin ingesta de
15:00 a ~15:45Z. Los crons que caían durante una corrida larga se descartaban
(invoke-config asíncrono: 0 reintentos, edad máxima 120 s).

## Qué hace ahora

El **modo** de la corrida decide su plan (`infra/lambda/ingestion/run-guard.ts`,
`planRun`):

| Modo | Cuándo | Intentos por request | Presupuesto de reloj | Pacing | Tope de requests |
|---|---|---|---|---|---|
| `incremental` | cron de 5 min (sin parámetros) | 3 (esperas 15 s y 30 s) | 3 min | ninguno | ninguno |
| `refresh` | cron diario de 07:00Z (`refreshLastHours` ≤ 72; hoy 48) | 3 (esperas 15 s y 30 s) | 12 min | 1 request cada 30 s | 24 |
| `backfill` | ventana explícita (`backfillStartDate`) o `refreshLastHours` > 72 | 11 (2 s·2ⁿ, tope 45 s: la escalera histórica) | 14 min | ninguno | ninguno |

Todos los presupuestos se recortan además a lo que le queda al lambda menos 60 s
(`context.getRemainingTimeInMillis()`), de modo que una corrida termina con
resumen en vez de morir por timeout.

Detalle de los reintentos (`packages/brandwatch/src/resilience.ts`,
`decideRetry`):

- Un 429 espera `Retry-After` si viene (segundos o fecha HTTP; antes una fecha
  daba `NaN` y reintentaba al instante), si no 15 s · 2ⁿ⁻¹ con tope de 30 s.
- Un `Retry-After` mayor que el tope **no se trunca** en las políticas acotadas:
  esperar menos de lo que Brandwatch pide solo gasta otro request en un 429
  seguro. Se abandona en el acto. (La política larga sí trunca, como antes.)
- No se duerme una espera que no deje tiempo para el request siguiente dentro
  del presupuesto.
- 5xx: 2 s · 2ⁿ⁻¹ dentro del mismo límite de intentos. 401/403: sin reintento.

### Cortacircuitos

`RunBreaker` (`run-guard.ts`) se abre con el **primer** fallo que implica que
ningún request más va a pasar:

- una query agotó sus reintentos por 429 (`BrandwatchRateLimitError`, con
  `reason`: `attempts-exhausted`, `retry-after-too-long` o `budget-exhausted`);
- se agotó el presupuesto de la corrida (`BrandwatchBudgetError`: `deadline` o
  `request-cap`).

Abierto, el handler **no sondea** las queries que faltan (sus cursores quedan
intactos y la próxima corrida las retoma) y las lista en el resumen. Los demás
errores (5xx de una query, DB, SQS) siguen sin abrirlo: afectan solo a esa
query, como antes. El lambda responde 200 aunque aborte; la señal está en el
log.

### Cursor ante un fallo a media paginación

Con reintentos acotados un 429 a mitad de una query pasa más a menudo que antes
(la escalera larga a veces "esperaba" la ventana de cuota y terminaba). Para que
eso no impida avanzar a un backlog grande, el handler **compromete el cursor con
lo ya encolado** cuando la query falla en la página N (`cursorToCommit` con
`partial: true`): el cursor solo refleja páginas completas y encoladas, así que
es un punto de reanudación válido. Con fallos de encolado nunca avanza; en
backfill nunca se toca.

### Refresh diario de 07:00Z

Era el disparador habitual de la espiral: ~19 requests en 20 s. Ahora va a un
request cada 30 s (≤ 20 req/10 min, deja ~10 de cuota a `biq-ingestion`) y con
techo de 24 requests, que se alcanza dentro de su presupuesto (23 × 30 s <
12 min). El de hoy (~19) cabe holgado; el refresh dura ≈ 9–10 min y, como tiene
concurrencia 1, el cron de 5 min de esas horas (03:00 en Puerto Rico) se descarta
solo, como ya ocurría con cualquier corrida larga.

Como el refresh repite cada día la misma ventana de 48 h, abandonarlo a medias
(429, tope, presupuesto) no pierde menciones: mañana vuelve a cubrirlas.

## Cómo verlo en producción

Líneas de log (CloudWatch, grupo `/aws/lambda/eco-ingestion`):

| Línea | Significa |
|---|---|
| `Run plan: mode=… maxAttempts=… budget=…s pacing=…ms maxRequests=…` | plan con el que arrancó la corrida |
| `Rate limited. Waiting …ms before retry n/m` | un 429 con reintento |
| `Rate limited: giving up (reason) after n/m attempts` | una query agotó sus reintentos |
| `ABORTED por cortacircuitos (…); N queries sin sondear: …` | el cortacircuitos se abrió; lista lo que no se sondeó |
| `[run] mode=… requests=N elapsed=Ns` | cierre de cada corrida |
| `cursor avanzado a … con las N páginas encoladas antes del fallo` | avance parcial tras un fallo a media paginación |

Para contar corridas abortadas (Logs Insights):

```
fields @timestamp, @message
| filter @message like /ABORTED por cortacircuitos/
| sort @timestamp desc
```

## Dónde está cada cosa y cómo se prueba

| Qué | Dónde |
|---|---|
| Política de reintentos, `Retry-After`, pacing, `RunBudget`, errores tipados | `packages/brandwatch/src/resilience.ts` |
| Cliente (usa lo anterior; `fetch` inyectable para pruebas) | `packages/brandwatch/src/client.ts` |
| Modo y plan de la corrida, deadline, cortacircuitos | `infra/lambda/ingestion/run-guard.ts` |
| Cursor (incluye `cursorToCommit`) | `infra/lambda/ingestion/cursor.ts` |
| Orquestación | `infra/lambda/ingestion/index.ts` |
| Pruebas puras y del cliente (reloj y `fetch` falsos) | `infra/test/ingestion-resilience.test.ts` |
| Pruebas del handler completo (AWS, `pg`, `fetch` y reloj simulados) | `infra/test/ingestion-handler.test.ts` |

```bash
cd infra && npx jest test/ingestion
```

Ninguna prueba llama a Brandwatch (consumiría la cuota de producción).

Para ajustar un parámetro (intentos, esperas, presupuesto, pacing, tope) se
edita la constante correspondiente (`BOUNDED_RETRY` / `LONG_RETRY` en
`resilience.ts`; `PLANS` en `run-guard.ts`) y se redespliega el lambda con
esbuild + `update-function-code` (ver `CLAUDE.md`). No hay variables de entorno
ni cambios de CDK.

## Limitador compartido con `biq-ingestion` (diseño; NO implementado)

### Problema

Cada lambda mide solo su propio tráfico. `eco-ingestion` ya no gasta cupo a lo
tonto, pero no puede saber cuánto gasta `biq-ingestion` ni al revés, y la racha
del 24–28-oct afectó a ambos a la vez (BrandIQ, con tres intentos y abandono,
registró miles de avisos 429 en 72 h). Tampoco ve las llamadas manuales: el
28-oct la racha empezó con ~16 llamadas a la API a mano, sobre una ingesta sana.

Lo que se sabe: mismo token y misma cuota (~30/10 min por cuenta); BrandIQ tiene
su propio manejo (3 intentos y abandona). **No está en este repo**: antes de
implementar hay que confirmar dónde vive su código y su stack, cuántos requests
hace por 10 min, y el calendario de su cron.

### El punto de enganche

Todo request de `eco-ingestion` pasa por `RunBudget.acquire()` (pacing, tope y
hora límite). Un limitador compartido es una implementación más de esa misma
interfaz (`acquire(): Promise<void>`, que espera o lanza
`BrandwatchBudgetError`) que se pasa por `BrandwatchConfig.budget`; el cliente no
cambia. En `biq-ingestion` habría que adoptar el mismo contrato (≈60 líneas, o
compartir el paquete si el código se puede traer a este monorepo).

### Opciones, de menos a más estado

**C. Reparto estático (sin infraestructura nueva).** Acordar presupuestos
fijos por llamador, p. ej. eco ≤ 14 requests/10 min, biq ≤ 10 y 6 reservados
para operadores, y que cada lambda los aplique con su propio pacing. Es lo único
que se puede hacer hoy sin tocar AWS. No reacciona a rachas ni a uso manual, y
hay que estimar bien el consumo real de ambos.

**A. Cool-down compartido (recomendada como primer paso con estado).** Un solo
ítem que dice "no llamar a Brandwatch hasta T":

- Tabla DynamoDB on-demand `bw-rate-limit`, ítem `scope = "brandwatch-account"`
  con `blockedUntil` (epoch s).
- Escritura: cuando un lambda agota sus reintentos por 429 (hoy el
  `BrandwatchRateLimitError`) hace `UpdateItem SET blockedUntil = :t` con
  condición `attribute_not_exists(blockedUntil) OR blockedUntil < :t`, con
  `:t = ahora + max(Retry-After, 11 min)`. Los 11 min son la ventana de 10 más
  1 de margen: es lo que midió la recuperación manual del 28-oct (11 min de
  silencio desde el último evento de cualquiera de los dos).
- Lectura: al inicio de cada corrida (una lectura fuertemente consistente) y, si
  se quiere, en cada `acquire()`. Con `blockedUntil` en el futuro la corrida
  termina sin hacer ningún request.
- Efecto sobre lo que implementa este PR: hoy, durante una racha larga, cada
  corrida de 5 min gasta 3 requests (que cuentan como 429) para descubrir que
  sigue bloqueado. Con el cool-down gastaría 0, y biq también se frena en cuanto
  eco lo detecta.

**B. Cupo compartido con ventana (limitador completo).** Cada request hace
`UpdateItem ADD used :1` sobre el ítem de la ventana de 10 min
(`window#<floor(epoch/600)>`, con TTL) con la condición `used < :cap`
(p. ej. 24, no 30: se desconoce si la ventana de Brandwatch es fija o
deslizante). Atributos por llamador (`eco`, `biq`) permiten reservar cupo a
cada uno y dejar un remanente común. Si la condición falla: esperar a la
siguiente ventana o rendirse según el presupuesto del llamador. Costo: una
escritura DynamoDB por request (~6 mil/día, centavos). Un limitador de ventana
fija deja pasar ráfagas en el cambio de ventana; el pacing local sigue siendo
necesario.

**D. Un solo punto de salida.** Una cola SQS FIFO con un único consumidor que
hace todas las llamadas a Brandwatch. Es la más sólida, pero obliga a reescribir
a los dos productores; no se justifica mientras A o B alcancen.

### Recomendación y orden

1. **C ya**: fijar y documentar el reparto con el equipo de BrandIQ (cero
   infraestructura).
2. **A** cuando haya sitio para tocar AWS en ambos stacks: tabla + permiso
   `dynamodb:GetItem/UpdateItem` a los dos roles + una clase de ~50 líneas.
3. **B** solo si, con A, siguen apareciendo choques fuera de las rachas de 429.

Reglas para cualquiera de las opciones:

- **Fallar abierto**: si DynamoDB no responde, loguear y seguir sin limitador;
  la ingesta no debe depender de un servicio auxiliar.
- Las llamadas manuales a la API deben pasar por el mismo limitador (un script
  que use `RunBudget`/el limitador), no por `curl`.
- Mantener el pacing y los topes locales de este PR: el limitador compartido los
  complementa, no los reemplaza.

## Seguimiento (fuera de este cambio)

- **Orden de queries**: el loop recorre agencias y queries en orden fijo, sin
  `ORDER BY`. Con presupuesto o tope, la cola siempre es la misma y es la que se
  queda sin sondear. Propuesta: ordenar por cursor más viejo primero
  (`last_run_at` ascendente) y rotar el orden del refresh.
- **Timeout del lambda** (CDK): 15 min → 3–4 min para el cron incremental
  (hoy el presupuesto de 3 min lo hace cumplir en código; el timeout es la red
  de seguridad) y alarma de "ingesta callada" (BrandIQ ya la tiene).
- **Timeout por request** (`fetch` sin `AbortSignal`): un request colgado
  consume el presupuesto entero.
- **Métrica propia**: el lambda devuelve 200 aunque aborte; si se quiere alarma
  por cortacircuitos, un filtro de métrica sobre `ABORTED por cortacircuitos`.
