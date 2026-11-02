# Diseño del asesor de crisis de ECO

**Versión 0.1 · 23 de octubre de 2026 · propuesta para decidir antes de construir**

> **Superado en parte por `spec-asesor-eco.md` (28-oct-2026).** El spec manda
> donde discrepan; ver su sección 0.3.

Este documento describe cómo el asistente de ECO pasa de describir a
aconsejar. Hay un agente de triaje que reparte cada consulta por tres caminos
según la gravedad. El camino más grave convoca a un consejo de varias miradas
con abogado del diablo, que entrega uno o dos caminos de acción con sus
efectos.

Se apoya en:

- `manual-eco.md`: la base de conocimiento, con reglas M-xx, guías G-x y
  líneas rojas L-x.
- `investigacion/06-asistente-actual.md`: lo que existe hoy en el código.
- `investigacion/07-deliberacion-y-abogado-del-diablo.md`: la evidencia
  sobre deliberación con humanos y con modelos de lenguaje.

---

## 1. Qué cambia para el usuario

Hoy el chat de ECO solo puede describir lo que hay en la pantalla abierta.
No consulta datos por su cuenta y tiene prohibido recomendar (ley 07 de la
constitución editorial).

Con el asesor:

1. **Consulta los datos por su cuenta.** Busca menciones, narrativas, quién
   amplifica, municipios, la historia de crisis anteriores de la agencia, y lo
   que haga falta.
2. **Aconseja con un manual detrás.** Cita las reglas que aplica y dice si la
   evidencia es sólida o es oficio.
3. **Ajusta el esfuerzo a la gravedad.** Una pregunta informativa se contesta
   en segundos. Una decisión de crisis convoca al consejo.
4. **Muestra la deliberación.** Entrega un memorando claro, con el debate
   completo desplegable para quien quiera leerlo.
5. **Rinde cuentas de sus predicciones.** Lo que dijo que pasaría se compara
   después con lo que pasó.

---

## 2. Arquitectura

```
                 Pregunta del usuario + agencia + vista actual
                                   │
                                   ▼
                    ┌────────────────────────────┐
                    │  TRIAJE                     │
                    │  1. Reglas fijas con datos  │
                    │     de ECO (piso)           │
                    │  2. Clasificador rápido     │
                    │     (Haiku)                 │
                    │  3. Override del usuario    │
                    └────────────┬───────────────┘
              ┌──────────────────┼──────────────────────┐
              ▼                  ▼                      ▼
     CAMINO 1 · Directo   CAMINO 2 · Panel     CAMINO 3 · Consejo
     un agente con        hoja de hechos +     contención inmediata
     herramientas +       3 asientos + DA,     + 6 rondas, 9 asientos
     manual               una ronda            (secciones 6 y 7)
     segundos             ~30-45 s             1-3 min (asíncrono)
              │                  │                      │
              └──────────────────┴──────────┬───────────┘
                                            ▼
                      Respuesta / memorando + trazas + predicciones
                                            │
                                            ▼
                     Calibración a 24/48/72 h con métricas de ECO
```

---

## 3. El triaje

### 3.1 Capa 1: reglas fijas con datos de ECO (el piso)

No dependen del modelo. Fijan el **camino mínimo** al que tiene que ir la
consulta.

| Condición | Camino mínimo |
|---|---|
| Índice de crisis V5 de la agencia en ALERTA (≥ 0.40) o CRISIS (≥ 0.60) | 2 |
| Lo anterior, y además la pregunta pide una decisión | 3 |
| Alerta de crisis disparada en las últimas 12 h sobre ese tema | Sube un nivel |
| Hay riesgo para la gente (salud, seguridad, servicio) según el clasificador | 2 como mínimo |
| Periodo de veda electoral (desde el 1 de enero de 2028) y la pregunta pide una pieza de comunicación | Sube un nivel y activa el asiento legal |

El triaje puede **subir** por encima del piso, pero nunca **bajar** de él.

### 3.2 Capa 2: clasificador rápido

Es una llamada a Haiku con tool-use forzado. Devuelve:

```json
{
  "tipo_pregunta": "descriptiva | decision | redaccion | revision_borrador",
  "reversible": true,
  "quien_da_la_cara": "nadie | tecnico | secretario | gobernadora",
  "presion_tiempo": "baja | horas | minutos",
  "riesgo_personas": false,
  "situacion": "conflicto | riesgo | paracrisis | crisis | no_aplica",
  "guia_probable": "G-1..G-9 | ninguna",
  "camino_sugerido": 1,
  "motivo": "una línea"
}
```

Reglas para decidir el camino:

- **Camino 1:** la pregunta es descriptiva o es redactar algo de rutina.
- **Camino 2:** hay una decisión reversible, o un comunicado de un técnico o
  un secretario sin crisis activa.
- **Camino 3:** hay una decisión irreversible, o da la cara la gobernadora o
  un secretario en crisis, o hay riesgo para personas con crisis activa, o
  aplica la guía G-3 o G-4 (integridad o renuncia).

### 3.3 Capa 3: el usuario

- Siempre se muestra el motivo. Por ejemplo: «Consejo completo: el índice
  está en ALERTA (0.52) y la pregunta implica una declaración pública de la
  gobernadora».
- Un botón **«Convocar al consejo»** fuerza el camino 3 en cualquier
  pregunta.
- Un botón **«Respuesta rápida»** baja al camino 1, pero solo si el piso lo
  permite. Si no, el sistema explica por qué no se puede.

### 3.4 Registro

Cada decisión del triaje se guarda en `advisor_runs` (sección 10). Si una
consulta del camino 1 o 2 termina en una crisis que sube de nivel en las 72 h
siguientes, eso se marca como **triaje subestimado** y sirve para ajustar los
umbrales.

---

## 4. Las herramientas del agente

Las herramientas se llaman en proceso: llaman directamente las funciones de
`lib/*/payload.ts`, sin pasar por HTTP. Todas pasan por `resolveAgencyId`
para respetar los permisos de agencia, y ninguna escribe nada.

| Herramienta | Sale de | Para qué |
|---|---|---|
| `foto_situacion` | `/api/overview` + `/api/scorecard` | Índices, NSS, volumen contra lo usual, polarización, 12 semanas |
| `indice_crisis` | `metrics.ts` V5 | Índice con sus componentes (severidad, velocidad, confianza) y su banda |
| `buscar_menciones` | `eco-mentions` | Feed filtrado por sentimiento, fuente, emoción, texto y fechas |
| `menciones_similares` | `eco-mentions?similar_to` (pgvector) | Evidencia parecida a una mención |
| `narrativas` | `narrative/overview` | Historias, ciclo de vida y etapa |
| `narrativa_detalle` | `narrative/[id]` + `/propagation` + `/edges` | Quién la inició, cómo viajó, qué canales usó, quién amplifica |
| `como_viajo` | `mentions/analysis` | Mapa de atención, historias, lenguaje que sube y baja |
| `quien_movio_nss` | `sentiment/analysis` | Qué narrativas movieron el sentimiento; emociones de 12 semanas |
| `municipios` | `geo/analysis` | Municipios contra lo usual y por habitante |
| `terminos` | `eco-terms` | Lenguaje distintivo (para medir qué marco gana) |
| `alertas_previas` | `alerts/history` | Alertas recientes de la agencia |
| `crisis_anteriores` | **nueva**: picos del índice V5 en el histórico | Clase de referencia: qué pasó en crisis parecidas de esta agencia |
| `manual` | **nueva**: lectura del manual por ID o por guía | Cuando el manual completo no esté en el contexto |
| `calendario_legal` | **nueva**: veda, emergencia declarada | Banderas legales |

Hay tres herramientas nuevas que todavía no existen:

- `crisis_anteriores`: una consulta sobre `metric_snapshots` que encuentra
  picos del índice de crisis y su resolución.
- `manual`: lee secciones del manual.
- `calendario_legal`: una tabla pequeña con la veda y las emergencias
  declaradas.

---

## 5. La base de conocimiento

### 5.1 Primero contexto completo, no RAG

El manual mide unas 9,000 palabras, alrededor de 15,000 tokens. Cabe entero
en el contexto de cada llamada y se puede cachear (prompt caching), así que
**no hace falta un sistema de recuperación (RAG) para empezar**. Esto evita:

- dar permiso al task role de ECS para invocar Titan y generar embeddings de
  cada consulta;
- el riesgo de que la recuperación no traiga la regla que hacía falta.

Cuando el manual crezca (más guías, casos completos, plantillas), se
fragmenta por regla y por guía en una tabla `playbook_chunks` con pgvector,
que ya existe en la base. La recuperación se hace primero por etiquetas
(guía, fase, tipo) y después por similitud.

**Verificar:** que el prompt caching esté disponible en Bedrock para los
modelos que se elijan. Hoy `packages/shared/src/bedrock.ts` no lo usa.

### 5.2 Mantenimiento

- El manual vive en `docs/manejo-de-crisis/manual-eco.md`.
- Un script lo convierte en un módulo de `packages/shared/src/advisor/manual.ts`
  con un hash de versión, y cada corrida guarda con qué versión del manual se
  hizo.
- Los casos 2025–2026 de clientes (DDEC, SGPR, Familia) se citan solo como
  patrón, nunca como acusación, y se revisan antes de cada versión del manual.

---

## 6. La constitución del asesor

La ley 07 de la constitución editorial («se describe, no se recomienda»)
sigue vigente para los 14 textos descriptivos: correos, briefings, PDF y el
chat en modo descriptivo. El asesor tiene **su propia constitución**, en
`packages/shared/src/prompts/advisor-constitution.ts`. Conserva las leyes 1 a
6 (lenguaje claro, sin maquinaria, fechas en palabras, no conjeturar) y
cambia la 7 por estas:

- **A-1. Se recomienda con caminos, no con órdenes.** Cada recomendación dice
  qué hacer, por qué, qué se espera que pase y qué podría salir mal. Decide la
  agencia.
- **A-2. Se separa la descripción de la recomendación.** Primero lo que se
  sabe, después las opciones en términos neutrales y al final la
  recomendación del consejo.
- **A-3. Toda afirmación lleva su base.** Un dato de ECO (con ID de mención o
  métrica), una regla del manual (M-xx) o la marca de «supuesto».
- **A-4. Se dice la fuerza de la evidencia.** No es lo mismo «la evidencia
  muestra» que «los manuales recomiendan».
- **A-5. Las líneas rojas no se cruzan** (L-1 a L-10). Si la pregunta empuja
  hacia una, el asesor lo dice y ofrece la alternativa legítima.
- **A-6. Neutralidad partidista.** Se analiza la comunicación, nunca la
  ideología.
- **A-7. Se dicen los puntos ciegos.** WhatsApp, la televisión y la radio sin
  transcribir, y los datos internos de la agencia.
- **A-8. Probabilidades en rangos y con clase de referencia.** Nada de
  precisión falsa.

---

## 7. Los tres caminos en detalle

### 7.1 Camino 1 · Directo

- Un solo agente (Sonnet) con las herramientas de la sección 4, el manual
  cacheado y la constitución del asesor.
- Es un loop de tool-use con un máximo de 6 llamadas a herramientas, y
  responde en streaming.
- Si la pregunta pide una opinión, el agente puede recomendar en formato
  corto: qué haría y por qué, citando las reglas.
- Si durante el loop el agente descubre algo que cambia la gravedad (un pico
  del índice, un medio nacional), lo dice y ofrece convocar al consejo.

### 7.2 Camino 2 · Panel

1. **Hoja de hechos:** el analista, con herramientas, arma lo que se sabe, lo
   que no está claro y lo que se presume, más la línea base sin acción.
2. **Tres asientos en paralelo, a ciegas:**
   - el **vocero**, siempre;
   - el **estratega**, siempre;
   - un **asiento rotativo** que elige el triaje: legal si hay temas de
     integridad o de veda, voz ciudadana si hay afectados, oposición si hay un
     tema político.
3. **Abogado del diablo:** hace un premortem de la posición dominante.
4. **Síntesis:** un camino recomendado, su riesgo principal, las señales a
   24 h y la objeción del abogado del diablo marcada como resuelta, mitigada o
   aceptada.

Son 6 llamadas en total y unas 3 en serie: entre 30 y 45 segundos.

### 7.3 Camino 3 · Consejo

**Mensaje de contención inmediato.** Lo primero que ve el usuario, en
segundos, es un borrador de declaración de contención (M-21), generado con la
hoja de hechos preliminar. Así hay algo que decir mientras el consejo
delibera. Va marcado como **«borrador de primeros minutos; la estrategia viene
en camino»**.

**Asientos.** Son los nueve definidos en la investigación 07 (sección C2):

| Asiento | Optimiza | Sesgo declarado |
|---|---|---|
| Analista de datos | Precisión del diagnóstico | Sobrevalora lo medible |
| Estratega político | Capital político | La imagen antes que la transparencia |
| Vocero institucional | Credibilidad del mensaje a largo plazo | El control y la lentitud |
| Legal y cumplimiento (con veto sobre las líneas rojas) | Mínima exposición jurídica | Decir poco y tarde |
| Voz ciudadana (solo con menciones reales) | Que se atienda lo que la gente reclama | Sobrerrepresenta a los que más hablan |
| Periodista | Anticipar la próxima nota | Asume lo peor de la fuente oficial |
| Oposición (la mirada del adversario) | Cómo se explota cada camino | Partidista por diseño |
| Abogado del diablo (independiente; no vota ni propone) | Encontrar por qué fracasará cada camino | Pesimista por diseño |
| Moderador | Una decisión clara | Puede suavizar el disenso; vigilado |

**Rondas:**

| Ronda | Quién | Salida |
|---|---|---|
| 0 · Hechos | Analista, con herramientas | Hoja de hechos con citas; hipótesis en competencia; clase de referencia; línea base sin acción |
| 1 · Posiciones a ciegas (en paralelo) | Los 6 asientos, sin ver a los otros ni la preferencia del usuario | Acción, mecanismo, efecto en métricas con rango y probabilidad, supuestos, evidencia, qué los haría cambiar de opinión |
| 2 · Agrupación | Moderador, que ve las posiciones en orden aleatorio y sin el nombre del rol | 2 caminos candidatos. Si todos convergen, está **obligado** a construir el mejor contraplán |
| 3 · Ataque (en paralelo) | Abogado del diablo (premortem), periodista (titular de mañana) y oposición (cómo lo usaría) | Tres formas de fracasar por camino, con su señal temprana |
| 4 · Réplica única | Los 6 asientos | Mantener o cambiar; si se cambia, citar qué evidencia lo movió |
| 5 · Síntesis | Moderador | Memorando (sección 8) |

**Reglas que vienen de la evidencia** (investigación 07):

- **Hechos comunes, lentes distintas.** Toda la evidencia va a la hoja de
  hechos; ningún asiento tiene datos que los demás no ven.
- **El usuario no siembra su preferencia antes de la ronda 1.** Si la dijo,
  se muestra solo en la síntesis, contrastada.
- **Para cambiar de postura hay que citar evidencia nueva.** «El grupo piensa
  otra cosa» no cuenta.
- **El moderador no suaviza el disenso:** cada objeción del abogado del
  diablo aparece en el memorando como resuelta, mitigada o aceptada.
- **No hay camino de paja.** Si no hay un segundo camino real, se dice.
- **El asiento legal tiene veto sobre las líneas rojas.** El veto se ve en el
  memorando, con su motivo.

**Modelos.** Los asientos van en Sonnet y el abogado del diablo y el
moderador en Opus, para que no sea el mismo modelo el que construye y el que
critica. Bedrock solo ofrece modelos Claude, así que la diversidad tiene que
venir sobre todo de los objetivos de cada asiento. La evaluación (sección 11)
dice si mezclar Haiku en algún asiento aporta.

**Costo y tiempo** (orden de magnitud, por confirmar con mediciones):

- Unas 16 llamadas, con la hoja de hechos y el manual cacheados.
- Unas 5 llamadas en serie: entre 1 y 3 minutos.
- El costo por corrida es de unas 15 veces una respuesta de chat. Por eso
  existe el triaje.

---

## 8. El memorando que ve el usuario

```
CONSEJO DE CRISIS · DDEC · jueves 23 de octubre, 4:10 PM · consejo completo
Por qué el consejo: índice en ALERTA (0.52) y se pide una declaración pública.

1. LO QUE SABEMOS · LO QUE NO ESTÁ CLARO · LO QUE SUPONEMOS
   Sabido: … (con citas de menciones y métricas)
   No claro: … (qué dato lo aclararía y cuándo)
   Supuesto: …
   Lo más probable que está pasando: …   Alternativa: …
   Si no se hace nada: índice entre 0.48 y 0.60 a 72 h (en crisis parecidas
   de esta agencia, 3 de cada 5 subieron una banda).

2. CAMINO A · Adelantarse con la auditoría hoy
   Qué es · quién lo dice · por qué canal · cuándo
   Por qué funcionaría (reglas M-62, M-54)
   Efectos esperados: índice a 72 h …, velocidad de negativas a 24 h …,
   adopción de nuestro marco en medios …
   Riesgos (del abogado del diablo) con su señal temprana
   Supuestos críticos
   Quién lo apoya en el consejo

3. CAMINO B · …  (o: «No hay un segundo camino real porque…»)

4. SEÑALES PARA SABER SI FUNCIONA · 24 / 48 / 72 h
   Va bien si … · Va mal si … · Cambiar de camino si …

5. RECOMENDACIÓN DEL CONSEJO
   Camino A, con confianza moderada (60–70%). Por qué, en tres líneas.

6. DISENSO
   El periodista y la oposición prefieren B porque … (sin suavizar)
   Objeciones del abogado del diablo: 2 mitigadas, 1 aceptada como riesgo.

7. BORRADORES
   Declaración (caja de mensaje 27/9/3) · pieza para WhatsApp · guion de radio
   Revisión automática: sin no-disculpas, en usted, cifras con método.

8. LÍMITES
   Lo que ECO no ve. Este consejo aconseja; la decisión es de la agencia.

[ Ver la deliberación completa ▸ ]    [ Elegimos: A · B · otro · ninguno ]
```

El botón **«Elegimos»** es lo que permite calibrar: sin saber qué camino se
tomó, no se puede comparar la predicción con lo que pasó.

---

## 9. Interfaz y transporte

- **Dónde vive:** en el mismo chat drawer, con un modo «Asesor» junto al modo
  descriptivo actual, o como pestaña dentro de la vista de crisis. Está
  pendiente de decidir.
- **Eventos nuevos en el NDJSON:**
  - `triage` (camino y motivo)
  - `tool_call` y `tool_result` («consultando narrativas…»)
  - `council_round` (ronda N de 5)
  - `holding_statement`
  - `memo`
- **El camino 3 corre en segundo plano.** El consejo tarda más que el
  `maxDuration=60` del chat actual y que el tiempo de espera del balanceador.
  Por eso corre en un lambda nuevo (`eco-advisor`, con un timeout de 5
  minutos) y va escribiendo su avance en la base. El frontend pregunta por el
  estado o recibe eventos. Si el usuario cierra el drawer, el consejo termina
  igual y el memorando queda en el historial.
- **Caminos 1 y 2:** se quedan en la ruta del web, en streaming.

---

## 10. Datos

Son tablas nuevas, creadas con el patrón de self-heal idempotente que ya usa
el chat (`ensureChatSchema`).

```
advisor_runs
  id, agency_id, user_sub, conversation_id, pregunta,
  triage_json (capas 1-3, piso, camino final, motivo),
  camino (1|2|3), manual_version, estado (running|done|error),
  hoja_hechos_json, memo_json, deliberacion_json (todas las rondas),
  camino_elegido (A|B|otro|ninguno|null), elegido_at,
  tokens_in, tokens_out, costo_usd, duracion_ms, created_at

advisor_predictions
  id, run_id, autor (asiento o moderador o linea_base), camino (A|B|base),
  metrica (crisis_index|nss|neg_velocity|polarization|frame_adoption),
  horizonte_h (24|48|72), rango_min, rango_max, probabilidad,
  observado, acierto_rango, brier, evaluado_at
```

---

## 11. Calibración y evaluación

### 11.1 Calibración en producción

- Cada hora, un job (dentro de `eco-metrics-calculator`, que ya evalúa
  métricas) puntúa las predicciones vencidas. Calcula si la observación cayó
  dentro del rango y el Brier de la probabilidad, por asiento, por moderador y
  por la línea base.
- Solo se puede puntuar el camino elegido. La línea base sin acción permite
  medir si el camino elegido mejoró respecto a no hacer nada.
- En cada corrida nueva, cada asiento recibe su historial de calibración
  («cuando dijiste 70%, pasó el 45%») y la ronda 0 recibe las crisis pasadas
  parecidas con su resultado real.

### 11.2 Evaluación antes de lanzar

La investigación es clara: un debate entre modelos **no siempre** supera a un
solo agente bien instruido. Antes de abrirlo a clientes:

1. **Repetición histórica.** Se toman entre 15 y 30 crisis pasadas de ECO,
   por ejemplo la renuncia en el DDEC de mayo de 2026, los picos de la
   Gobernadora y el apagón de abril de 2025. Se congelan los datos en el
   minuto en que empezó la crisis y se corren tres variantes:
   - (a) un solo agente con buen prompt y las mismas herramientas;
   - (b) el panel;
   - (c) el consejo.

   Después se comparan sus predicciones con lo que pasó. Hay que cuidarse de
   que el modelo ya conozca el desenlace de crisis muy mediáticas.
2. **Evaluación a ciegas por consultores de Populicom.** Juzgan los
   memorandos sin saber qué variante los produjo, en orden aleatorio. Los
   criterios son claridad, si las opciones son reales, si el disenso está bien
   recogido y utilidad.
3. **Decisión.** Si (a) empata con (c), el camino 3 se simplifica.

### 11.3 Alarmas de calidad

- **Consenso de fachada:** porcentaje de asientos que cambian de postura en
  la ronda 4 sin citar evidencia nueva.
- **Abogado del diablo decorativo:** objeciones sin cita o que no aparecen en
  el memorando.
- **Ciudadanía inventada:** afirmaciones de la voz ciudadana sin ID de
  mención.
- **Complacencia:** la recomendación coincide con la preferencia del usuario
  mucho más a menudo de lo que dirían los datos.

---

## 12. Seguridad y permisos

- **Capacidad nueva `advise`** en `lib/auth/roles.ts`. Se exige en el endpoint
  con `requireCapability` y se ofrece en la SPA con `ecoHasCap`, siguiendo la
  regla de gatear en los dos lados. Propuesta: admin y editor; analyst a
  decidir.
- **Rutas:** colgar las rutas de `/api/chat/advisor/*`, que ya está en
  `PROTECTED_PATHS` y en el matcher del middleware.
- **Permisos de agencia:** toda herramienta pasa por `resolveAgencyId`. Un
  consejo nunca ve datos de otra agencia, salvo staff en la vista
  multiagencia, si se decide.
- **Límites de uso:** cuántos consejos por usuario al día y un tope de costo
  mensual por agencia, con aviso.
- **Auditoría:** `advisor_runs` guarda todo, incluida la deliberación.
- **Nada sale solo:** el asesor no publica, no envía correos y no toca redes.

---

## 13. Fases

| Fase | Qué | Sale con |
|---|---|---|
| **0 · Base** | Loop de tool-use multi-turno con streaming en `bedrock.ts`; prompt caching; herramientas de la sección 4; constitución del asesor; manual en un módulo | Camino 1 detrás de una bandera, solo para staff de Populicom |
| **1 · Triaje + panel** | Clasificador, piso de reglas, camino 2, `advisor_runs`, eventos nuevos en el drawer | Uso interno con DDEC como agencia de prueba |
| **2 · Consejo** | Lambda `eco-advisor`, las 6 rondas, contención inmediata, memorando, deliberación desplegable, botón «Elegimos» | Repetición histórica y evaluación a ciegas (11.2) |
| **3 · Calibración** | `advisor_predictions`, job de puntuación, historial de calibración en el prompt | Panel interno de calibración |
| **4 · Proactivo** (opcional) | Cuando se dispara una alerta de crisis, el consejo corre solo y el correo de crisis lleva un enlace al memorando | Decisión de producto pendiente |

---

## 14. Decisiones que necesito de ti

1. **¿Quién puede usarlo?** Mi propuesta: solo staff de Populicom durante las
   fases 0 a 2, y abrirlo a clientes según cómo salga la evaluación.
2. **¿Dónde vive?** Un modo «Asesor» en el chat drawer, o una pestaña en la
   vista de crisis.
3. **¿El modo proactivo** (fase 4) entra en el alcance, o lo dejamos para
   después?
4. **¿Límites de costo?** Un tope mensual por agencia para el camino 3.
5. **¿Revisión legal del manual?** Antes de usarlo con clientes, sobre todo la
   sección 8 (veda) y las licencias de las fuentes.
6. **¿Segunda ronda de investigación?** Hay huecos marcados: autores
   latinoamericanos sin cubrir a fondo, protocolos de CENAPRED y UNGRD, el
   plan de comunicación del NMEAD, y las penalidades de la Ley 154-2026.
