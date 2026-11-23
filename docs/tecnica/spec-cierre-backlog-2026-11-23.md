# Spec · Cierre de backlog, tramo 24-nov a 4-dic-2026

Versión 0.1 · 23-nov-2026 · Borrador para visto bueno. Nada de este documento está implementado.

Fuentes del corte: `~/Downloads/Backlog Echo.xlsx` (hoja Backlog, guardado el 18-nov), proyecto ECHO en Asana (68 tareas, leído el 23-nov), `origin/main` (último commit 9ee0cdb, 18-nov) y consultas de solo lectura a producción el 23-nov a las 16:54 UTC.

## 1. Dónde estamos

### 1.1 El backlog

48 ítems. Ninguno cerrado.

| Estado | Ítems | Cuáles |
|---|---|---|
| En curso | 14 | ING-01 (90 %), INT-01 (90 %), INT-02 (70 %), PRD-02 (30 %), MET-02 (60 %), AI-01 (60 %), ASE-01 (75 %), BIQ-02 (30 %), OPS-04 (40 %), ASE-02, DSH-01, MET-04, DAT-07 |
| Diseñado | 6 | IDX-01 a IDX-05, CLP-01 |
| Sin iniciar | 11 | PRD-03, COR-01, COR-02, COR-04, DAT-02, COR-07, COR-08, LEG-01, POD-01, DAT-04, PLT-02 |
| Por decidir | 7 | DAT-01, PLT-01, BIQ-01, MET-03, NAR-01, DAT-05, DSH-02 |
| Bloqueado por tercero | 3 | COR-03, DAT-03, DAT-06 |
| Idea | 8 | COR-05, COR-06, IDEA-01 a IDEA-06 |

Con fecha de fin ya vencida al 23-nov: ING-01, DAT-01, IDX-02, COR-03, MET-02, AI-01, DAT-02, DAT-03, PLT-01 (todos al 16 o 20-nov). Vencen esta semana: COR-02 (24), INT-01 (25), INT-02, PRD-03, IDX-01, COR-04, BIQ-02, OPS-04 (27).

No ha entrado código a `main` desde el 18-nov. PRs abiertos que tocan el backlog: #179 (reparto de cuota, espera a BrandIQ), #182 (documentación de la caída de Brandwatch), #158 (asesor fase 2), #163 (arnés de calidad).

### 1.2 Lo que cambió desde el corte del 18-nov (medido hoy)

1. **INT-01: la racha de 7 días se rompió.** Del 18 al 21-nov los correos salieron limpios (incluido el Semanal del 20). El 22-nov el Diario de Gobernadora y el 23-nov el Diario de DF salieron con una variación sin su nivel (`direccion_sin_nivel`) que el corrector no arregló. Racha actual: 0. Con el criterio como está escrito, la fecha más temprana de cierre pasa al 30-nov.
2. **ING-01: la cuenta nueva va bien.** Del 19 al 22-nov, cuatro días completos sin avisos de 429 y con 10 min como máximo sin sondeo. Si sigue así, los 7 días se cumplen el 25-nov y se leen el 26. El 18-nov no cumple por la caída de Brandwatch (108 min).
3. **Alarma encendida sin atender:** `eco-dlq-ingestion-messages` está en ALARM (hay mensajes en la cola de fallidos de ingesta). No está en el backlog.
4. **AAA sigue sin menciones desde el 22-oct.** DDEC, DF y Gobernadora reciben menciones con normalidad (604, 835 y 1,120 en 7 días).
5. **Asesor de crisis:** 8 consultas en total, la última el 17-nov. Sigue sin uso real.
6. **OPS-04 está desactualizado en la hoja:** dice que hay 12 alarmas y que falta borrar las dos manuales. Hoy hay 10 y las manuales ya se borraron el 17-nov.

### 1.3 Asana contra la hoja

- Los 48 ítems están en Asana con el mismo estado y avance que la hoja al 18-nov (la descripción de cada tarea lo dice). Asana es un espejo; la hoja sigue siendo la fuente.
- Ninguna de las dos refleja los puntos 1 a 6 de arriba.
- En Asana hay 20 tareas que no están en la hoja, casi todas creadas por Carla el 23-nov tras la reunión de feedback. Las que tocan producto:

| Tarea en Asana | Qué propongo |
|---|---|
| Prompt · La lectura del periodo (texto de 230 palabras reescrito a 62, con reglas) | Entra a este tramo como paquete B4, dentro de INT-02 |
| Verificar la barra del timeline en Narrativas y Scorecard | Entra como paquete G1 (revisión corta) |
| Otro nombre para «Piezas que movieron la ventana» | Decisión de equipo; el cambio es de una línea (G2) |
| Conectar TMO a BW (venció el 19-nov) | Chocó con PLT-01: Brandwatch está en 5 de 5 monitores. Decisión D4 |
| Update Notion doc con los cambios recientes (27-nov) | Paquete G3 |
| Overview inicial, seis puntos (pedido de Willie) | Es texto de presentación comercial, no cambio de producto. Fuera de este spec |
| Identidad visual del cliente en el Diario | Idea nueva; anotar en la hoja como idea, sin fecha |
| Estructura dual PR / marketing con métricas | Decisión de producto previa a cualquier desarrollo; va con BIQ-01 |
| Capacitación y onboarding como parte de la oferta | Comercial. Fuera |
| Presentaciones (T-Mobile, Popular, Manny Vidal, asociación de relacionistas), minutas | Comercial y de cuenta. Fuera |

- «Prueba de sincronización Claude» (sección Test) es una tarea de prueba; se puede borrar.

## 2. Objetivo del tramo

Al 4-dic:

- Cerrados al 100 %: **INT-01, INT-02, ING-01, OPS-04, COR-02**.
- Avanzados hasta donde dependen de una persona o un tercero: **MET-02** (en sombra, hoja de revisión entregada), **DAT-02** (hueco rellenado), **COR-04**.
- Las siete decisiones de la sección 5 tomadas o con dueño y fecha.

No entra en este tramo: Issue Tree (IDX-01 a 05, bloqueado por las enmiendas sin firmar y por PRD-03), COR-01, CLP-01, ASE-02, todo P2 y P3.

## 3. Paquetes de trabajo

Cada paquete es un PR. Orden sugerido en la sección 6.

### A · INT-01: que una variación sin nivel no pueda salir

Hoy el chequeo avisa y el corrector intenta arreglar; si no lo logra, el correo sale igual. Por eso dos correos fallaron en seis días.

- **A1. Diagnóstico.** Leer en `report_compositions` las dos composiciones que fallaron (Gobernadora 22-nov, párrafo; DF 23-nov, viñeta 2): qué frase disparó el aviso, qué devolvió el corrector y si el aviso es correcto o un falso positivo del chequeo.
- **A2. Red de seguridad por código.** Si tras el corrector queda `direccion_sin_nivel` o `mejora_con_nivel_sostenido`, el código lo resuelve antes de enviar: añade el nivel a 14 y 28 días a la frase desde los hechos calculados o, si no puede, quita la frase. Queda archivado el antes y el después. Vive en `packages/shared/src/composer` (junto a `safety-net`).
- **A3. Si A1 muestra un falso positivo,** se corrige la regla del chequeo y se añade el caso a los tests.
- **A4. Cierre.** Informe contra los cuatro criterios, con la salida de `scripts/int-01-wp6-check.ts`.

**Resultado de A1 a A3 (23-nov, en el PR de este paquete; sin desplegar).**

- Gobernadora, 22-nov: aviso correcto. El redactor no citó la variación; la metió el corrector al atender una observación del revisor («32 menciones frente a las 136 del viernes 20 (-76 %)») y después del corrector nadie volvía a mirar.
- DF, 23-nov: falso positivo. La viñeta nombraba el asunto «Suzanne Roig aumento salarial Assmca» y el chequeo leyó «aumento» como verbo. El correo estaba bien.
- A2: `enforceLevelRules` (en `packages/shared/src/composer/interpretation.ts`) corre después del corrector, en `compose` y en el re-relleno del lambda. Añade el nivel tras la oración que cita la variación o quita la frase de calma; el antes y el después quedan en `safetyNetLog`.
- A3: «bajó» y «aumentó» piden tilde, y un verbo dentro de un nombre entre comillas no cuenta.
- Reproducido sobre los 22 correos enviados del 18 al 23-nov: 1 aviso antes, 0 después; la red solo cambia el correo de Gobernadora del 22-nov.

Aceptación: los dos casos reales, reproducidos con `asOf`, salen sin aviso; 7 días seguidos en OK después del despliegue; tests de A2 con los dos textos reales.

Despliegue: `eco-weekly-report` por esbuild y `update-function-code`, tras comparar el bundle vivo con 27c7255.

### B · INT-02: revisor de textos

- **B1. Regla de dirección contra el nivel sostenido.** Es A2; se hace una vez y cubre los dos ítems.
- **B2. Defectos del Semanal de DF** (20 % en la prueba): signo doble en variaciones («+85 %» con «sube», «-78 menos»), marcadores mal usados y titular que contradice el párrafo. Cada uno con un chequeo por código y su caso de prueba.
- **B3. Comprobación sobre lo enviado.** Un script de solo lectura, como el de INT-01, que recorra los correos enviados y cuente: palabras vetadas presentes, afirmaciones de dirección que contradicen sus cifras y correcciones sin antes y después archivado. Los tres deben dar cero.
- **B4. La lectura del periodo, más corta.** Llevar al motor las reglas del prompt que Carla probó: titular de hasta 15 palabras, resumen de hasta 3 oraciones, oraciones de hasta 20 palabras, cifras en los datos clave y no en el resumen, cambios con su base («pasó de 500 a 6,000») en vez de porcentaje suelto, sin rayas ni paréntesis, fechas completas. Las que se pueden medir (largo de oración, largo del resumen, porcentaje sin base, raya o paréntesis) van como chequeo por código; el resto, al prompt del redactor. Se prueba con el caso de DF a 90 días que viene en la tarea.
- **B5. Muestra para revisión humana.** 30 correos reales (10 por agencia, Diario y Semanal) en una hoja a ciegas para que una persona de comunicaciones marque defectos. El criterio pide menos de 10 %.

**Resultado de B2 y B3 (23-nov, en el PR de este paquete; sin desplegar).**

- Medido sobre los 64 correos programados enviados del 5 al 23-nov: 17 signos dobles en 15 correos (todos Diarios; el Semanal ya escribe sus variaciones sin signo), 2 bloques con «% %», 0 palabras vetadas, 0 afirmaciones de dirección contra su cifra, 0 defectos duros residuales y 0 correcciones sin archivo.
- B2: el relleno de cifras (`fillPlaceholders`) escribe la variación sin signo cuando el texto ya dice el sentido («bajó 18 %», «62 % más»), quita el «%» repetido y, si el texto dice lo contrario de la cifra, lo marca como defecto duro `direccion_contradice_cifra`: va al corrector y, si sobrevive, la red de seguridad quita la oración.
- B3: `scripts/int-02-enviados-check.ts` recorre lo enviado y cuenta los cinco indicadores por día.
- «Titular que contradice el párrafo» no tiene chequeo por código: sigue a cargo del revisor por modelo.
- B4: el texto de la tarea de Carla tiene la forma del lede del Overview (titular, párrafo, puntos numerados y foto). Ese bloque lo escribe `eco-ai-tasks`, cuyo código en producción es del 8-oct y no usa el motor nuevo (`COMPOSER_WEB_AGENCIES` sin definir). Aplicar sus reglas pide primero llevar el motor nuevo al Overview; queda como decisión aparte.

Aceptación: los cuatro criterios del ítem; B5 depende de que alguien revise (decisión D6).

Antes de B4 hay que confirmar a qué texto se refiere «La lectura del periodo»: el bloque del Overview (`overview_period_insights`), el del PDF o ambos. Si es más de uno, las reglas van en la pieza compartida.

### C · ING-01: cierre

- **C1. Lectura de los 7 días** (19 a 25-nov) el 26-nov con `scripts/ing-01-informe-frescura.py`. Depende de la decisión D1.
- **C2. Enviar la propuesta de reparto a BrandIQ** (`docs/tecnica/propuesta-reparto-cuota-brandwatch-brandiq.md`). Es el único criterio que no depende de código. Decisión D2.
- **C3. Ajustar el PR #179** antes de aplicarlo: los reintentos de queries caídas no deben consumir el tope de 7 consultas por corrida y dejar sin sondeo a las sanas. Test con el patrón de la caída del 18-nov (196 fallidas en un día).
- **C4. Cola de fallidos de ingesta en ALARM.** Ver qué mensajes hay, de cuándo y por qué; reencolar o descartar con registro.
- **C5. Mergear #182** (solo documentación; ojo: mergear a `main` despliega la web).

Aceptación: los cuatro criterios del ítem. Sin acuerdo con BrandIQ no llega al 100 %.

### D · OPS-04: alarmas que faltan

En `infra/lib/monitoring-stack.ts`, todas al canal `eco-alerts-ops`:

- **D1.** Agencia activa con más de 3 horas sin menciones nuevas. Hoy se mide sondeo, no menciones. Necesita una métrica publicada por agencia y una excepción para la madrugada, cuando es normal que no haya menciones; el umbral nocturno se fija con los datos de los últimos 30 días.
- **D2.** Faltan las métricas del día a las 10:00 UTC.
- **D3.** Alarma de errores para los procesos que no la tienen. Hoy la tienen ingesta, processor y alerts.
- **D4.** Simulacro de una alarma de cada tipo, con correo recibido.
- **D5.** Cubre también el criterio de alarma de BIQ-02.

Despliegue: `cdk diff` primero; solo el stack de monitoreo. No tocar EcoCompute.

### E · COR-02: correo de crisis más completo

Sobre `render-crisis-alert` y `eco-metrics-calculator`:

- **E1.** Imagen cuando exista una nota con foto (solo artículos, con la copia en S3, no la URL de Meta).
- **E2.** Los reavisos dicen desde cuándo está abierto el episodio y qué cambió desde el aviso anterior. Requiere guardar el episodio (inicio, último aviso, valores).
- **E3.** Correo de cierre cuando el índice vuelve bajo el umbral.
- **E4.** El botón lleva a la vista de crisis de esa agencia en citizenecho.com.

Aceptación: los cuatro criterios; vista previa de los tres correos (primer aviso, reaviso, cierre) con `scripts/preview-crisis-alert.ts` y una prueba real a un solo destinatario. Antes de desplegar, comparar el bundle vivo de `eco-metrics-calculator` con `main`.

### F · Avances que no cierran solos

- **F1. MET-02:** encender la rúbrica v2 en sombra en DF y DDEC y entregar la hoja de 48 casos a ciegas. La activación y el reproceso esperan a la revisión humana.
- **F2. DAT-02:** traer Facebook e Instagram de DDEC de julio a septiembre y recalcular las métricas de esos días. Se corre de madrugada y con el freno de cuota, para no repetir los 429 de octubre. Fechas por `publishedAt`.
- **F3. COR-04:** quitar la lista blanca de correos de `/api/alerts/*` y del menú y dejar el permiso por agencia, igual en la aplicación y en el servidor; tabla con activaciones y último disparo reales.

### G · Pendientes cortos que salieron de la reunión del 23-nov

- **G1.** Revisar la barra del timeline en Narrativas y Scorecard. Falta saber qué se vio mal (decisión D7).
- **G2.** Renombrar «Piezas que movieron la ventana» cuando el equipo elija el nombre.
- **G3.** Actualizar el documento de Notion con lo publicado desde el 4-nov (motor de redacción, asuntos abiertos, nivel sostenido, alarmas).

## 4. Qué no depende de nosotros

| Ítem | Qué espera | De quién |
|---|---|---|
| COR-03 | Registros DMARC en el DNS de los dos dominios | Quien administra el DNS |
| DAT-03 | Nombre y cuentas del nuevo Secretario | Cliente, vía Armando |
| PRD-03 | Tres conversaciones con clientes | Armando y Carla |
| PRD-02 | Archivo de los 54 eventos; comunicadores para la prueba | Willie |
| ASE-01 | Set de 183 casos etiquetado por una persona de comunicaciones | Por asignar |
| IDX-01 | Firma de las enmiendas al acuerdo del Issue Tree | Willie y Alejandro |
| PLT-01, DAT-06 | Cotización y presupuesto de Brandwatch | Willie y Armando |

Conviene llevar esta tabla a la próxima reunión: cuatro P0 y P1 llevan una semana o más sin movimiento por esto.

## 5. Decisiones que necesito

- **D1. ING-01, ventana de 7 días:** ¿las caídas del propio Brandwatch cuentan contra el criterio? Recomiendo que no cuenten cuando no hubo 429 y la alarma avisó, y dejarlo escrito en el criterio. Con eso se cierra el 26-nov.
- **D2. ING-01:** ¿envío yo la propuesta de reparto a BrandIQ o la llevas tú?
- **D3. INT-01:** ¿la racha vuelve a empezar tras el arreglo A2 (cierre hacia el 2 o 3-dic) o se acepta cerrar con «ningún correo sale con el aviso» garantizado por código más 3 días de comprobación? Recomiendo reiniciar los 7 días: es el criterio que se validó con el cliente.
- **D4. T-Mobile en Brandwatch:** el cupo está en 5 de 5 monitores. ¿Se libera uno (AAA lleva un mes sin menciones y SGPR está archivada) o espera a PLT-01?
- **D5. DAT-01:** importar exportes de X, TikTok y YouTube de DF cada semana, o aceptar el hueco con aviso visible. Lleva una semana vencida y es P0.
- **D6. Revisión humana:** quién revisa la muestra de 30 correos (INT-02) y la hoja de 48 casos (MET-02). Sin esa persona, ninguno de los dos llega al 100 %.
- **D7. Barra del timeline:** qué se vio mal y en qué pantalla.

## 6. Orden

| Cuándo | Qué |
|---|---|
| 24 y 25-nov | A1 a A3 y B1 (mismo PR), C4, C5 |
| 26-nov | C1 (lectura de ING-01), despliegue de A, empieza la racha nueva de INT-01 |
| 26 y 27-nov | B2, B3, C3 |
| 30-nov a 2-dic | E (COR-02), D (OPS-04) |
| 2 a 4-dic | B4, B5, F1, F2, F3, G |
| 3 o 4-dic | A4: cierre de INT-01 si la racha se sostiene |

A y B van primero porque cada día sin el arreglo puede romper otra vez la racha.

## 7. Al terminar cada paquete

1. Actualizar en `Backlog Echo.xlsx` Estado, % de avance, «Qué ya está», «Qué falta» y «Evidencia» (respaldo antes; Excel cerrado).
2. Reflejar lo mismo en la tarea de Asana: mover de sección, actualizar la descripción y marcar completada si cierra.
3. Primera actualización, antes de empezar: llevar a la hoja y a Asana los seis hallazgos de la sección 1.2.
