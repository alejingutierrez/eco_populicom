# Propuesta · Reparto de la cuota de Brandwatch entre ECO y BrandIQ

**17 de noviembre de 2026 · de ECO para el equipo de BrandIQ · estado: propuesta, sin aplicar**

ECO y BrandIQ usan la misma cuenta de Brandwatch: 30 peticiones cada 10
minutos para los dos, más cualquier llamada hecha a mano. Cuando la suma se
pasa, Brandwatch responde 429 a los dos productos, y cada 429 también gasta
cupo. Así se detuvo la ingesta de ECO del 24 al 26 de octubre.

Hoy cada producto se cuida por su lado y funciona (ECO lleva 0 avisos 429 al
día desde el 14-nov), pero no hay nada escrito: ninguno sabe cuánto puede
gastar el otro. Esta propuesta lo deja escrito y pide dos cambios pequeños en
cada producto.

Contexto completo: `docs/tecnica/spec-ing-01-ingesta-limites-brandwatch.md`
(WP-4 y WP-5) y `docs/tecnica/ingesta-brandwatch-429.md`.

---

## 1. El reparto

Por ventana de 10 minutos, sobre 30 peticiones:

| Quién | Cupo | Gasto medido |
|---|---|---|
| ECO en vivo | 14 | 12 normal; 14 en horas de mucho volumen (ECO, 14 a 17-nov) |
| BrandIQ en vivo | 10 | ~6 (cifra de BrandIQ del 2-nov; **por confirmar**) |
| Reserva: tropiezos y llamadas a mano | 6 | n/a |

Reglas que salen de la tabla:

1. **Cada producto cuenta lo suyo.** ECO no pasa de 7 peticiones por corrida
   de 5 min (14 por ventana); BrandIQ no pasa de 5 (10 por ventana). Lo que no
   cabe espera a la corrida siguiente.
2. **Los dos ceden en 24.** Si la cabecera `x-rate-limit-used` de Brandwatch
   marca 24 o más, la corrida deja de pedir. ECO ya lo hace desde el 13-nov;
   BrandIQ hoy cede en 28.
3. **Llamadas a mano:** hasta 5 por ventana sin pausar nada. Para más: pausar
   las dos ingestas (concurrencia 0) y esperar 11 minutos antes de empezar.
4. **Una query nueva es una decisión de cuota.** Cada query activa cuesta 2
   peticiones por ventana. ECO tiene 6 queries (12 de 14): le cabe una más.
5. **Trabajo de fondo** (refresh, conciliación, reseñas, rellenos) en horas
   separadas, como hoy: ECO 07:00 UTC; BrandIQ 09:30, 12:00 y 12:15 UTC. Fuera
   de las 22–07 UTC cuando se pueda.
6. **Cambiar el reparto** lo deciden Alejandro y quien lleve BrandIQ, y se
   cambia en los dos repos a la vez.

### Por qué hace falta la regla 1 además de la 2

El plan original era repartir solo con la cabecera (regla 2). Los datos de ECO
dicen que no basta: en 861 corridas del 14 al 16-nov la cabecera marcó 8 en 781
y nunca pasó de 12, aunque ECO sola hace 12 peticiones cada 10 minutos. Si
contara los 10 minutos de la cuenta entera, lo normal sería 12 más lo de
BrandIQ. Parece contar una ventana más corta que 5 minutos, así que puede no
llegar a 24 antes del 429. La regla 1 no depende de la cabecera.

**Pregunta para BrandIQ:** ¿qué valores de `x-rate-limit-used` ven ustedes en
una corrida normal, y qué vieron en las pruebas del 2-nov?

---

## 2. Crons escalonados

Hoy los dos crons de 5 minutos son `rate(5 minutes)`: la hora exacta depende de
cuándo se creó cada regla. ECO corre a los `:00:15` y BrandIQ a los `:04:27`,
con 48 segundos entre uno y otro. Si alguien recrea una regla, pueden caer
juntos.

| Regla | Hoy | Propuesto | Corre en los minutos |
|---|---|---|---|
| `EcoWorkers-IngestionSchedule…` | `rate(5 minutes)` | `cron(0/5 * * * ? *)` | 0, 5, 10… |
| `BiqWorkers-IngestionSchedule…` | `rate(5 minutes)` | `cron(2/5 * * * ? *)` | 2, 7, 12… |

Quedan 2 minutos entre ECO y BrandIQ y 3 al revés. Una corrida normal de ECO
dura 5–20 segundos (máximo 83 s del 14 al 17-nov).

---

## 3. Qué cambia en cada producto

### ECO (preparado en la rama `feat/ing-01-reparto-cuota-crons`, sin desplegar)

| Qué | Dónde | Antes | Después |
|---|---|---|---|
| Tope propio por corrida incremental | `infra/lambda/ingestion/run-guard.ts` | sin tope | 7 peticiones (`ECO_QUOTA_SHARE = 14` entre 2 corridas por ventana) |
| Techo de cesión por cabecera | mismo archivo | 24 | 24 (sin cambio) |
| Horario del cron | `infra/lib/ingestion-schedule.ts`, usado por `infra/lib/workers-stack.ts` | `rate(5 minutes)` | `cron(0/5 * * * ? *)` |
| Texto del reparto | `docs/tecnica/ingesta-brandwatch-429.md` y `CLAUDE.md` | no existe | sección «Reparto de la cuota de Brandwatch» |

Efecto esperado del tope en ECO: casi ninguno. Del 14 al 17-nov, de más de
1,000 corridas incrementales solo una pidió 8 peticiones; con el tope, esa
octava petición habría salido 5 minutos después. La query que se queda a
medias guarda su avance y va primera en la corrida siguiente.

Cómo se aplica en ECO (cada paso con el visto bueno de Alejandro):

1. Mergear el PR. No dispara ningún despliegue (no toca `apps/web` ni
   `packages`).
2. Lambda: bajar el bundle vivo, compararlo con `main`, y desplegar con esbuild
   + `update-function-code`. Nunca `cdk deploy EcoWorkers`.
3. Cron: `aws events put-rule` sobre la regla viva con la expresión nueva
   (misma regla, mismo destino). Rollback: el mismo comando con
   `rate(5 minutes)`.

### BrandIQ (lo que se les pide)

| Qué | Hoy | Propuesto |
|---|---|---|
| Techo de cesión (`cesion.ts`) | cede con `used ≥ 28` | ceder con `used ≥ 24` |
| Tope propio por corrida de 5 min | por confirmar | 5 peticiones (10 por ventana) |
| Horario del cron de 5 min | `rate(5 minutes)` | `cron(2/5 * * * ? *)` |
| Texto del reparto | no existe | la sección 1 de este documento en `docs/COLA-BRANDWATCH.md` y nota en su `CLAUDE.md` |
| Su conteo de 429 al día | sin compartir | compartir 7 días (el criterio de ING-01 es menos de 10 al día en cada producto) |

Si a BrandIQ no le alcanzan 10 por ventana, se dice antes de aplicar y se
ajusta la tabla: la suma de los dos cupos no debe pasar de 24.

---

## 4. Cómo se verifica

Durante las 24 horas siguientes a aplicar los dos cambios:

| Qué se mira | Dónde | Debe dar |
|---|---|---|
| ECO arranca en los minutos 0 y 5 | log de `eco-ingestion` | todas las corridas |
| BrandIQ arranca en los minutos 2 y 7 | log de `biq-ingestion` | todas las corridas |
| Peticiones de ECO por corrida incremental | `ECO/Ingesta` → `Peticiones` (máximo) | 7 o menos |
| Avisos 429 | ECO: `ECO/Ingesta` → `Avisos429`; BrandIQ: su log | menos de 10 al día en cada uno |
| Ninguna query de ECO más de 1 h sin sondeo | `python3 scripts/ing-01-informe-frescura.py` | «cumple» |
| Corridas cortadas por el tope | `ECO/Ingesta` → `CorridaAbortada` | 0 o esporádico; si es habitual, el cupo de 14 se quedó corto |
| Valor normal de la cabecera | `ECO/Ingesta` → `CuotaUsadaMax` | si baja de 8 a 6, confirma que la cabecera cuenta menos de 2 minutos |

---

## 5. Lo que se le pide a BrandIQ que conteste

1. ¿Aceptan 14 / 10 / 6?
2. ¿Cuántas peticiones gastan hoy por corrida y por ventana, y cuántos 429 al
   día?
3. ¿Qué ven en `x-rate-limit-used`?
4. ¿Qué día cambian el cron y el techo? ECO aplica lo suyo el mismo día.

Fuera de esta propuesta, y recomendado en paralelo: pedir a Brandwatch más
cuota o un segundo usuario de API. Es lo único que separa las dos cuotas de
verdad.
