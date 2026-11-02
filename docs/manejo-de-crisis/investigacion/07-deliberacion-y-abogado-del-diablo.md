# 07 · Deliberación estructurada y abogado del diablo (humanos y LLMs)

Investigación para el **consejo asesor de crisis** del asistente de ECO
(23-oct-2026). Pregunta: ¿cómo se hace bien una deliberación entre varias
miradas, con un abogado del diablo, que termine en 1–2 caminos de acción
bien explicados? Se cubre (A) la evidencia en humanos, (B) la evidencia en
debate multiagente con LLMs, y (C) el protocolo concreto que propongo para ECO.

**Convenciones**

- Licencia de cada fuente: **[dominio público]**, **[acceso abierto]**
  (se puede leer libre; la licencia de reutilización varía, aquí solo se
  resume), **[copyright — solo resumir]**.
- Tipo de afirmación: **(E)** evidencia experimental o empírica, **(H)**
  evidencia histórica o de casos, **(O)** opinión o práctica profesional,
  **(I)** inferencia mía para ECO.
- Todo está resumido con mis palabras; como máximo una cita corta por fuente.
- Lo que no pude verificar contra el texto original está marcado
  *«sin verificar en el original»*.

---

## Resumen ejecutivo: lo que cambia el diseño

1. **El conflicto estructurado supera al consenso, pero cuesta aceptación.**
   En laboratorio, los grupos que usan abogado del diablo (DA) o indagación
   dialéctica (DI) toman decisiones de más calidad que los grupos que buscan
   consenso; entre DA y DI no hay diferencia clara (Schweiger et al. 1986 y
   1989; Schwenk 1990). (E)
2. **El disenso asignado vale menos que el auténtico.** Nemeth muestra que
   el DA que «hace el papel» estimula menos pensamiento original que una
   persona que de verdad discrepa; a veces solo refuerza la postura inicial.
   Un DA hecho con un LLM es, por definición, asignado: hay que anclar su
   disenso en datos y en fallas concretas, no en la retórica. (E → I)
3. **Un DA ignorado es peor que ningún DA**: da falsa confianza en un plan
   «ya probado» (Red Teaming Handbook del MoD británico). (O)
4. **El debate multiagente con LLMs no es una mejora gratuita.** Hay
   ganancias reales en algunos montajes (Du et al. 2023; Liang et al. 2023;
   Khan et al. 2024), pero varios estudios de 2024–2025 encuentran que un
   solo agente bien instruido o un simple voto mayoritario logran casi lo
   mismo (Smit et al. 2024; Wang et al. 2024; Choi et al. 2025), y que el
   debate puede **empeorar** las respuestas por conformidad y
   complacencia (*sycophancy*) (Wynn et al. 2025; Yao et al. 2025). (E)
5. **Lo que sí funciona en LLMs:** posiciones independientes antes de ver
   las de otros; diversidad real (distintos modelos o distinta evidencia,
   no solo distinto nombre de rol); pocas rondas; cambiar de postura solo
   ante evidencia nueva; agregar sin promediar; un juez que no tenga sesgo
   de posición ni de longitud. (E + I)
6. **Las personas simuladas no son la ciudadanía.** Los LLMs aplanan y
   caricaturizan a los grupos de identidad (Wang, Morgenstern y Dickerson
   2025). La «voz ciudadana» del consejo debe hablar **solo con menciones
   reales de ECO**, nunca inventar lo que «piensa la gente». (E → I)
7. **Información distribuida = fallo colectivo.** Los grupos de LLMs con
   información repartida aciertan el 30% de tareas *hidden profile*, frente
   al 81% de un solo agente con todo (HiddenBench 2025). Toda la evidencia
   debe ir a una **hoja de hechos común**, no repartida entre roles. (E → I)
8. **Al decisor se le presentan opciones reales y probabilidades
   explícitas**, con qué se sabe, qué no está claro y qué se presume
   (Neustadt y May), y con señales observables que indican si el camino va
   bien (indicadores del *Tradecraft Primer*; Tetlock). (O + E)
9. **El cierre del ciclo es lo que distingue un consejo de un oráculo:**
   cada predicción del consejo debe guardarse con probabilidad y horizonte
   y puntuarse a las 24/72 h con las métricas de ECO (puntuación de Brier
   por rol y por moderador). (I, apoyado en Tetlock)
10. **Coste:** los sistemas multiagente gastan unas 15 veces los tokens de
    un chat (Anthropic 2025). Hace falta un modo rápido y uno completo. (E)

---

## A. Deliberación estructurada en humanos

### A1. Abogado del diablo vs indagación dialéctica vs consenso

**Qué son.**
- *Indagación dialéctica (DI)*: Mason (1969) propone exponer los supuestos
  del plan propuesto y construir un **contraplán** con supuestos opuestos
  y plausibles; el debate entre ambos produce una síntesis. (O, con un
  estudio de campo)
- *Abogado del diablo (DA)*: alguien critica el plan y sus supuestos **sin
  la obligación de proponer una alternativa**.
- *Consenso*: el grupo discute buscando acuerdo, sin conflicto
  estructurado.

**Evidencia.**
- Schweiger, Sandberg y Ragan (1986), experimento de laboratorio con casos
  de estrategia: DI y DA producen recomendaciones de más calidad y
  supuestos mejor examinados que el consenso. Según resúmenes posteriores,
  los grupos de consenso reportaron **más satisfacción y más ganas de
  seguir trabajando juntos**: el conflicto mejora la decisión pero desgasta
  al grupo. (E; la parte de satisfacción *sin verificar en el original*)
- Schweiger, Sandberg y Rechner (1989), con equipos de directivos: DI y DA
  superan al consenso en calidad; no hay diferencias entre DI y DA. (E)
- Schwenk (1990), metaanálisis: ambos superan al enfoque de «un experto
  recomienda»; en los experimentos el DA rinde al menos tan bien como la DI.
  Un estudio previo suyo (1984) encontró que el DA escrito generaba más
  alternativas y reducía el peso de un «informe experto» sobre la decisión
  final. (E; conclusión del metaanálisis *sin verificar en el original*,
  es como suele citarse)
- Fjermestad (2019) revisa 52 estudios desde Mason: los estudios de caso
  apoyan la DI; los experimentos favorecen el DA. (E, revisión)

**Para ECO (I).** El DA es más barato que la DI y rinde igual: el consejo
usa un DA explícito. Pero tomamos de la DI una regla: **si todos los roles
convergen en un solo camino, el moderador está obligado a construir el
contraplán** más fuerte posible (la mejor alternativa con supuestos
opuestos). Así el usuario siempre ve dos opciones reales cuando existen.

### A2. Disenso auténtico vs rol asignado (Nemeth)

- Nemeth, Brown y Rogers (2001) comparan un DA que interpreta un papel con
  alguien que discrepa de verdad. El disenso auténtico produce más
  pensamiento original, más consideración de la postura contraria y más
  cambio de actitud; el DA asignado tiende a que el grupo **refuerce** su
  postura inicial (busca argumentos para defenderla) en vez de pensar
  distinto. (E)
- Su línea de investigación concluye que el juego de roles no iguala al
  disenso genuino en calidad de soluciones (Nemeth, perfil académico de
  Berkeley). (E, resumen de la autora)

**Para ECO (I).** Un LLM que hace de DA siempre es «asignado». Para que su
crítica funcione como disenso auténtico tiene que: (a) basarse en
**evidencia concreta** (una mención, una cifra, un precedente, un artículo
del manual), no en contrarianismo genérico; (b) poder **conceder** cuando
una opción resiste el ataque (un DA que lo critica todo por igual no
informa); (c) proponer qué observación lo haría cambiar de opinión. Y el
moderador debe tratar sus objeciones como hipótesis a contestar, no como
trámite.

### A3. Pensamiento de grupo: Bahía de Cochinos vs crisis de los misiles

- Janis acuñó *groupthink* estudiando Bahía de Cochinos (1961): presión por
  el acuerdo, autocensura, ilusión de unanimidad, «guardianes» que
  filtran la información incómoda. (H)
- Tras ese fracaso Kennedy cambió el procedimiento para la crisis de los
  misiles (ExComm, 1962): se ausentaba de reuniones iniciales para que no
  anclaran su opinión; dividió al grupo en subgrupos que desarrollaron
  opciones distintas (bloqueo vs ataque aéreo); pidió a cada uno actuar
  como generalista escéptico y no como delegado de su departamento; trajo
  voces de fuera. (H, fuentes secundarias)
- **Matiz importante:** Kramer (1998) revisó documentos desclasificados y
  sostiene que ambas decisiones se explican más por cálculo político y
  riesgo reputacional del presidente que por dinámica de grupo pequeño.
  Las recetas anti-groupthink siguen siendo útiles, pero el diagnóstico
  original está discutido. (H, revisión crítica)

**Para ECO (I).** Tres recetas pasan directo al diseño: (1) **el «jefe» no
habla primero**: el usuario de la agencia no debe sembrar su preferencia
antes de la ronda 1, o el consejo la complacerá (ver B2, *sycophancy*);
(2) **subgrupos que desarrollan opciones distintas** en vez de una sola
discusión; (3) cada rol razona sobre **el problema entero**, no solo desde
su parcela. Y Kramer recuerda que en gobierno la variable política es real:
el estratega político debe estar en la mesa, no ser tratado como sesgo.

### A4. Red teaming

**US Army, UFMCS (Fort Leavenworth).** *Red Team Handbook* (v9, 2019) y *The
Applied Critical Thinking Handbook* (v7–v8.1). Recogen técnicas para
contrarrestar sesgos y pensamiento de grupo en planificación (premortem,
análisis de supuestos, «cuatro maneras de ver», técnicas de participación
anónima y por turnos para que hablen todos). El propio manual aclara que no
es doctrina oficial. (O, práctica profesional) **Licencia:** obra del
gobierno federal de EE.UU. → **[dominio público]** por 17 U.S.C. §105; no
pude abrir el PDF para confirmar la declaración de distribución.

**UK MoD, DCDC, *Red Teaming Handbook* 3.ª ed. (junio 2021).** Leído
directamente. Define el red teaming como la aplicación **independiente** de
técnicas de pensamiento estructurado, creativo y crítico para que el
usuario final decida mejor. Distingue *red team* (critica el plan) de *red
cell* (adopta la mirada del adversario o de un actor). Sobre el DA: mejor
alguien que no participó en el plan; rotar el papel; tono no personal; y
advierte que si se le hace caso solo de palabra el proceso defectuoso
«can instil more confidence in the plan». Principios: objetivo claro,
espacio seguro, cultura de desafío, flexibilidad, humildad ante el usuario.
Contra el groupthink: que el líder no asista a ciertas sesiones, DA rotativo
o externo, expertos de fuera. (O) **Licencia:** Crown copyright, **no** está
bajo la Open Government Licence; reproducción solo para uso del gobierno
británico salvo autorización → **[copyright — solo resumir]**.

**Israel, Aman, tras 1973.** La Comisión Agranat atribuyó parte del fallo de
Yom Kipur a «la concepción» (la premisa de que Egipto no iría a una guerra
total). De sus recomendaciones nació una unidad de control crítico
(*Ifcha Mistabra*, «al contrario») que revisa supuestos y productos del
Departamento de Investigación, examina escenarios poco probables y
**reporta directamente al jefe de inteligencia, no al departamento que
critica**. La «décima persona» (si nueve coinciden, el décimo está obligado
a discrepar) es la versión divulgativa de la idea. (H, fuentes secundarias;
la «décima persona» es periodística, no doctrina verificada) Hay historiadores
que discuten si «la concepción» fue un invento de la propia comisión. (H)

**Contraejemplo: Team B (1976).** La CIA permitió que un equipo externo
(Pipes, Nitze, Wolfowitz) reanalizara la amenaza soviética. Concluyó que la
CIA la subestimaba; revisiones posteriores encontraron que Team B se
equivocó en casi todo y que su composición tenía un sesgo político
deliberado (Comité de Inteligencia del Senado, 1978). Lección: un equipo
rojo con agenda propia no corrige sesgos, los sustituye. (H)

**Para ECO (I).**
- El DA del consejo es **independiente**: no recomienda ningún camino
  propio, no vota y no lo sintetiza el mismo agente que construyó las
  opciones (como Aman: el crítico no depende de quien es criticado).
- El rol «oposición» es una *red cell* (mirada del adversario) y **no** es
  el DA; mezclarlos convierte la crítica en partidismo (lección Team B).
- Su crítica debe tener respuesta explícita en la síntesis.

### A5. Análisis de hipótesis en competencia y técnicas estructuradas

- **Heuer, *Psychology of Intelligence Analysis* (CIA, 1999), cap. 8: ACH.**
  En vez de buscar la hipótesis que mejor encaja, se construye una matriz
  de hipótesis × evidencia y se busca la evidencia que **descarta**
  hipótesis; gana la que tiene menos evidencia en contra. Se identifican
  los datos más «diagnósticos» (los que distinguen entre hipótesis) y se
  terminan con indicadores a vigilar. (O, con base en psicología cognitiva)
  **[dominio público]** (obra de la CIA).
- **CIA, *A Tradecraft Primer* (2009).** Agrupa técnicas en diagnósticas
  (revisión de supuestos clave, calidad de la información, indicadores o
  señales de cambio, ACH), contrarias (DA, Team A/Team B, análisis de alto
  impacto y baja probabilidad, análisis «¿y si…?») e imaginativas
  (lluvia de ideas, análisis desde el exterior, análisis del equipo rojo,
  futuros alternativos). (O) **[dominio público]**.

**Para ECO (I).** Tres piezas directas:
1. **Hipótesis en competencia sobre la crisis** antes de recomendar nada:
   ¿es una historia que viaja sola, una campaña coordinada, un error
   factual de la agencia, un ataque de la oposición? La recomendación
   depende de cuál sea, y ECO tiene datos para discriminar (quién amplifica,
   propagación de narrativas, geografía, fuentes).
2. **Revisión de supuestos clave**: cada camino lista los supuestos de los
   que depende («los medios publicarán la corrección», «el alcalde no se
   sumará»).
3. **Indicadores** = las «señales a 24–72 h» del formato de salida.

### A6. Premortem, Delphi, escenarios, *steelmanning*, pronóstico calibrado

- **Premortem (Klein, HBR 2007).** Antes de decidir, el equipo imagina que el
  plan ya fracasó y cada uno escribe por qué. Se basa en Mitchell, Russo y
  Pennington (1989): imaginar que un hecho ya ocurrió (*prospective
  hindsight*) aumenta en torno al 30% la capacidad de identificar razones
  de un resultado. Ojo: muchas fuentes lo exageran como «30% más riesgos».
  (E para la base; O para el método)
- **Delphi (RAND; Dalkey y Helmer 1963).** Rondas de juicios **anónimos e
  independientes** con retroalimentación controlada (se devuelve el
  resumen, no quién dijo qué), diseñado para neutralizar al individuo
  dominante y la presión de conformidad. (E/O)
- **Escenarios de Shell (Wack, HBR 1985).** No predicen: preparan para
  discontinuidades que un pronóstico central no ve (la preparación de Shell
  para el choque petrolero de 1973 es el caso clásico). (H/O)
- ***Steelmanning*.** Reconstruir la versión más fuerte de la postura
  contraria antes de criticarla. Es práctica recomendada, no tiene una
  base experimental propia que yo haya encontrado. (O)
- **Pronóstico calibrado (Tetlock).** En el torneo de IARPA, el *Good
  Judgment Project* mejoró la precisión con entrenamiento en probabilidad
  (clases de referencia, promediar estimaciones), trabajo en equipo y
  selección de los mejores; los «superpronosticadores» dan probabilidades
  explícitas y las actualizan en pasos pequeños (Mellers et al. 2014). (E)
  Un reanálisis de 2024 en *Psychological Science* matiza cuánto aportan
  equipos y entrenamiento una vez controlada la habilidad latente. (E)
- **LLMs como pronosticadores.** Un conjunto de 12 LLMs igualó a una
  multitud de 925 humanos en 31 preguntas binarias, pero con **sesgo de
  aquiescencia** (predicciones medias muy por encima del 50%); mostrarles
  la mediana humana mejoró a GPT-4 y Claude 2 entre 17 y 28%, aunque
  promediar humano + máquina fue aún mejor (Schoenegger et al. 2024). (E)

**Para ECO (I).** Premortem por cada camino (ronda 3); juicios
independientes estilo Delphi (ronda 1); un escenario de discontinuidad
(«qué tendría que pasar para que esto escale a otra cosa»); probabilidades
explícitas con **clase de referencia** sacada del histórico de ECO (crisis
anteriores de la misma agencia o tipo); y desconfiar de probabilidades
altas por defecto (aquiescencia).

### A7. Perfiles ocultos

Stasser y Titus (1985): los grupos discuten sobre todo la información que
todos ya comparten y pierden la información que solo tiene uno, aunque sea
la decisiva. (E) Ver HiddenBench en B2: los LLMs repiten el fallo.

**Para ECO (I).** Nada de «el periodista sabe X y el legal sabe Y»: los
datos de ECO van a **una hoja de hechos común** que todos leen; lo que
cambia entre roles es la lente y el sesgo declarado, no la evidencia. Si un
rol trae conocimiento propio (p. ej., el legal cita una ley), está obligado a
publicarlo en la ronda 1 para que los demás lo vean.

### A8. Cómo presentar opciones a un decisor

- **Neustadt y May, *Thinking in Time* (1986).** Separar lo **sabido**, lo
  **no claro** y lo **presumido** antes de decidir; buscar analogías
  históricas y revisar en qué se parecen y en qué no; y la «pregunta de
  Alexander» (del caso de la vacuna de la gripe porcina de 1976): **¿qué
  hecho nuevo, y cuándo, nos haría cambiar de rumbo?** (O, casos)
  **[copyright — solo resumir]**.
- **Memorando de opciones.** La práctica de los consejos de seguridad
  nacional es presentar 2–3 opciones **reales y viables**, cada una con
  objetivo, costes, riesgos y quién la defiende, más la recomendación del
  equipo **separada** de la descripción. El vicio conocido es la opción
  «buena» entre dos de paja (una extrema y otra inviable). (O; no
  encontré un estándar público verificable del formato del NSC, se describe
  como práctica)

**Para ECO (I).** Cada camino debe ser algo que una agencia razonable
**podría elegir**; si el segundo es de paja, mejor entregar uno solo y
decirlo. La recomendación del moderador va después y separada de la
descripción neutral de los caminos.

---

## B. Debate multiagente con LLMs (2023–2026)

### B1. Trabajos que encuentran ganancias

| Trabajo | Qué hacen | Qué encuentran | Licencia |
|---|---|---|---|
| Du et al. 2023 (ICML 2024) | Varias instancias del mismo modelo responden, leen las otras respuestas y revisan, varias rondas («Society of Mind») | Mejora en razonamiento aritmético y en factualidad (biografías, MMLU) frente a un solo modelo (E) | [acceso abierto] |
| Liang et al. 2023 | Dos debatientes «tit for tat» + un juez | Identifican la **degeneración del pensamiento**: un modelo confiado en su respuesta no genera ideas nuevas al autorreflexionar. El debate ayuda en tareas contraintuitivas; necesita **desacuerdo moderado** y **parar a tiempo**; avisan que el juez puede no ser justo si los agentes son de otro modelo (E) | [acceso abierto] |
| Chan et al., ChatEval (ICLR 2024) | Equipo de evaluadores LLM que debaten | **Roles diversos son esenciales**: usar la misma descripción de rol para todos degrada el resultado (E) | [acceso abierto] |
| Khan et al. 2024 (ICML 2024, mejor artículo) | Dos expertos con acceso a un texto defienden respuestas opuestas; un juez sin acceso decide | Jueces humanos 88% y LLM 76% con debate, frente a 60% y 48% sin él; optimizar a los debatientes por persuasión mejora la verdad que encuentra el juez. **Ojo:** funciona por asimetría de información con un texto verificable (E) | [acceso abierto] |
| Chen, Saha y Bansal, ReConcile (ACL 2024) | Mesa redonda de **modelos distintos**, voto ponderado por confianza | Supera a variantes de un solo modelo; la diversidad de modelos es lo que más aporta (E) | [acceso abierto] |
| Hegazy 2024 | Debate entre modelos medianos distintos | Tres modelos distintos superan a tres copias del mismo (91% vs 82% en GSM-8K) (E, autor único) | [acceso abierto] |
| Chiang et al. 2024 (IUI) | Un DA hecho con LLM dentro de grupos **humanos** que deciden con ayuda de IA | Puede mejorar el uso que el grupo hace de la IA y la percepción del proceso, según las condiciones (E; resultados *sin verificar en el original*) | [acceso abierto vía NSF PAR] |

### B2. Trabajos que encuentran que no ayuda o que colapsa

| Trabajo | Qué encuentran | Licencia |
|---|---|---|
| Smit et al., «Should we be going MAD?» (ICML 2024) | En su forma estándar, el debate multiagente **no supera de forma fiable** a la autoconsistencia (muestrear varias veces y votar) y cuesta más; es muy sensible a hiperparámetros; ajustar el **nivel de acuerdo** entre agentes es lo que más mueve el resultado (E) | [acceso abierto, CC BY 4.0 en v1] |
| Wang et al., ACL 2024 | Un solo LLM con un prompt fuerte (con ejemplos) iguala casi al mejor método de discusión; la discusión solo gana cuando no hay ejemplos en el prompt (E) | [acceso abierto] |
| Choi, Zhu y Li, «Debate or Vote» (NeurIPS 2025) | El **voto mayoritario** explica casi toda la ganancia atribuida al debate; modelan el debate como una martingala: por sí solo no aumenta la corrección esperada; mejora si se empujan las actualizaciones hacia la corrección (E + teoría) | [acceso abierto] |
| Wynn, Satija y Hadfield 2025 | El debate ingenuo puede **degradar** el rendimiento: agentes correctos se dejan convencer por razonamientos persuasivos pero erróneos (E) | [acceso abierto] |
| Yao et al. 2025, «Peacemaker or Troublemaker» | La complacencia colapsa el debate en **consenso prematuro**, con menos precisión que un solo agente; la complacencia viene tanto de los debatientes como del juez (E) | [acceso abierto] |
| Choi et al. 2025, conformidad (2.500 debates) | Los agentes se alinean con el bando numéricamente mayor; un solo agente de modelo grande influye más que varios pequeños (E) | [acceso abierto] |
| arXiv 2604.02668 (2026) | Cuando el **usuario** respalda una respuesta errónea, los agentes lo siguen y el error se propaga; dar «priors» de complacencia de los pares mejora la precisión final en 10,5 puntos (E; *sin verificar en el original*) | [acceso abierto] |
| Li, Naito y Shirado, HiddenBench (2025) | Con información distribuida, los grupos de LLMs aciertan el 30,1%; un solo agente con toda la información, el 80,7%; convergen prematuramente sobre la evidencia compartida (E) | [acceso abierto] |
| Zheng et al. 2024 (Findings EMNLP) | Poner personas («eres un experto en…») en el system prompt **no mejora** el rendimiento en preguntas objetivas; a veces empeora. La versión de 2023 decía lo contrario; la conclusión cambió al ampliar a más familias de modelos (E) | [acceso abierto] |
| Wang, Morgenstern y Dickerson 2025 (*Nature Machine Intelligence*) | Los LLMs que sustituyen a participantes humanos **malrepresentan y aplanan** a los grupos de identidad (E) | [copyright — solo resumir]; preprint [acceso abierto] |
| Zheng et al. 2023, LLM-as-a-judge (NeurIPS 2023) | Los jueces LLM tienen **sesgo de posición** (favorecen la primera opción), **de longitud** (favorecen lo más largo) y **de autopreferencia**; con mitigaciones, GPT-4 coincide con humanos más del 80% (E) | [acceso abierto] |
| Xiong et al. 2024 (ICLR) | La confianza que el LLM **verbaliza** suele estar mal calibrada; muestrear varias respuestas y medir consistencia ayuda; todo empeora en tareas de conocimiento profesional (E) | [acceso abierto] |
| Anthropic 2025, sistema de investigación multiagente | Los sistemas multiagente usan unas **15 veces** los tokens de un chat (4 veces un agente solo); solo se justifican en tareas de alto valor y paralelizables (E, interno) | [copyright — solo resumir] |

### B3. Síntesis: qué hacer y qué no (I, apoyado en lo anterior)

1. **Independencia antes de interacción.** Cada rol produce su posición sin
   ver a los demás (Delphi; Du; «Debate or Vote»: lo que más aporta es la
   diversidad de respuestas independientes). El usuario tampoco siembra su
   preferencia antes (efecto de complacencia, arXiv 2604.02668).
2. **Diversidad real, no de etiqueta.** El nombre del rol solo no basta
   (Zheng 2024). Lo que diversifica: **modelos distintos** (ReConcile,
   Hegazy), **objetivos y criterios de éxito distintos** por rol (lo que
   cada uno optimiza), **herramientas distintas** sobre la misma evidencia
   y **sesgos declarados** que obligan a mirar riesgos distintos. En ECO,
   Bedrock solo permite modelos `anthropic.claude-*` (ver doc 06): la
   diversidad de modelos se limita a mezclar Opus/Sonnet/Haiku; la
   diversidad principal tiene que venir de objetivos y lentes.
3. **Pocas rondas.** La ganancia del debate se satura rápido y cada ronda
   aumenta conformidad y coste (Smit; Choi 2025; Liang: parar a tiempo).
   Una ronda de posiciones + una de crítica + una de réplica es el máximo
   razonable.
4. **Cambiar de postura solo con evidencia nueva.** Regla explícita: un rol
   solo puede moverse si cita qué dato o argumento nuevo lo movió; «el
   grupo piensa otra cosa» no es razón (contra Wynn, Yao, Choi).
5. **Preservar el disenso.** La síntesis no promedia: agrupa en caminos y
   conserva la minoría con su argumento. Agregar votos sin borrar las
   razones (ReConcile pondera por confianza; aquí además se guarda el
   porqué).
6. **Juez/moderador con controles.** Aleatorizar el orden en que se le
   presentan las posiciones, pedirle que juzgue por evidencia citada y no
   por longitud, y que el moderador sea un modelo distinto del de los
   debatientes cuando se pueda (Zheng 2023; Liang). El moderador **no
   añade una opinión propia nueva** en la síntesis.
7. **Todo con evidencia.** Cada afirmación factual cita un ID de mención,
   una métrica o un fragmento del manual; el debate funciona mejor cuando
   hay un texto verificable (Khan). Afirmaciones sin cita se marcan como
   supuestos.
8. **Probabilidades con clase de referencia y desconfianza de la alta
   confianza verbal** (Xiong; Schoenegger): rangos, no puntos; la línea
   base sale del histórico de ECO.
9. **Medir que el consejo gana a un solo agente.** No darlo por hecho
   (Wang 2024; Smit 2024): evaluación offline sobre crisis pasadas (ver C7).

---

## C. Protocolo propuesto para ECO

> Contexto de implementación (doc 06): el chat actual no es agéntico y la
> constitución editorial (Ley 07) **prohíbe recomendar**. El consejo
> necesita un modo propio con su propia ley («se recomienda con caminos,
> efectos y probabilidades; se separa la descripción de la recomendación»),
> sin tocar los 14 prompts descriptivos. Capacidad nueva (`advise`) gateada
> en SPA y endpoint.

### C1. Principios

1. Hechos comunes, lentes distintas (A7).
2. Posiciones independientes primero (A6, B3.1).
3. El DA es independiente, no vota ni propone camino propio (A4).
4. Máximo dos caminos, ambos reales; si no hay segundo real, se dice (A8).
5. Toda predicción lleva probabilidad, horizonte y métrica de ECO, y se
   puntúa después (A6, C7).
6. La «voz ciudadana» y la «oposición» hablan con datos reales, no con
   imaginación (B2, Wang 2025).
7. El consejo **aconseja**; decide la agencia. Siempre se dice qué no sabe.

### C2. Roles

Cada rol recibe la **misma hoja de hechos** (C3, ronda 0). Lo que cambia es
qué optimiza, qué teme y qué herramienta prioriza. El sesgo se declara
para que el moderador lo descuente.

| Rol | Conocimiento y herramientas | Optimiza | Sesgo declarado | Debe entregar |
|---|---|---|---|---|
| **Analista de datos** (abre el consejo) | Todas las herramientas de ECO: scorecard, índice de crisis V5, NSS, velocidad de negativas, polarización, narrativas y propagación, quién amplifica, geo, términos, menciones similares; histórico de crisis de la agencia | Precisión del diagnóstico | Sobrevalora lo medible; infravalora lo que no está en redes (TV, radio, conversaciones privadas) | Hoja de hechos: sabido / no claro / presumido; hipótesis en competencia con la evidencia que las distingue; **línea base sin acción** (qué pasa si no se hace nada, según crisis parecidas) |
| **Estratega político** | Hoja de hechos + calendario político, actores (alcaldes, legislatura, oposición), ciclo electoral | Capital político del jefe de agencia y de la gobernación | Prioriza la imagen del gobierno sobre la transparencia; tiende a la acción visible | Camino propuesto, a quién beneficia y perjudica, coste político |
| **Vocero institucional** | Hoja de hechos + manual de comunicación de crisis (RAG, cuando exista), comunicados previos de la agencia | Credibilidad y coherencia del mensaje a largo plazo | Prefiere control del mensaje y lentitud («hablar cuando sepamos todo») | Mensaje clave, portavoz, canal, momento; qué **no** decir |
| **Legal y cumplimiento** | Hoja de hechos + marco aplicable en PR (acceso a la información pública, ética gubernamental, restricciones de publicidad gubernamental en periodo electoral, privacidad); *el inventario exacto lo debe fijar el frente legal* | Minimizar exposición jurídica | Aconseja decir poco y tarde; puede bloquear lo útil | Límites duros (qué no se puede decir/hacer), riesgos legales de cada camino |
| **Voz ciudadana** | **Solo menciones reales** de ECO: emociones, lenguaje que sube, municipios afectados, comentarios en canales propios; muestra de citas con ID | Que la respuesta atienda lo que la gente reclama de verdad | Sobrerrepresenta a los que más hablan en redes (no a toda la ciudadanía) | Qué reclama la gente (con citas), qué percibiría como evasión, qué la calmaría |
| **Periodista** | Hoja de hechos + menciones de medios (`news`), quién publicó primero, cómo viajó la historia | Anticipar la próxima nota y la próxima pregunta | Favorece lo noticioso; asume lo peor de la fuente oficial | Las 3 preguntas que hará la prensa, el titular probable de cada camino, qué dato nuevo publicarían |
| **Oposición** (*red cell*) | Hoja de hechos + menciones de actores opositores, narrativas críticas | Cómo un adversario explota cada camino | Partidista por diseño | Cómo atacaría cada camino y con qué |
| **Abogado del diablo** (independiente) | Todo lo anterior, después de la ronda 1 | Encontrar por qué fracasará cada camino | Pesimista por diseño; **no propone camino propio** | Premortem por camino; supuestos más frágiles; qué evidencia lo haría ceder |
| **Moderador** (sintetiza) | Todo | Una decisión clara para el usuario | Puede alisar el disenso; vigilado por regla C4 | Memorando de salida (C5) |

**Modelos (I):** debatientes en Sonnet; DA y moderador en Opus (y, si se
puede, distinto del que usaron los debatientes en esa corrida); el analista
de datos usa el modelo que mejor ejecute herramientas. Probar en la
evaluación (C7) si mezclar Haiku en algún rol añade diversidad útil.

### C3. Rondas

**Modo completo** (crisis en ALERTA/CRISIS del índice V5, o a petición):

| Ronda | Quién | Qué ve | Salida |
|---|---|---|---|
| **0 · Hechos** | Analista de datos (con herramientas) | Datos de ECO | Hoja de hechos con citas; hipótesis en competencia; clase de referencia; línea base sin acción con rangos |
| **1 · Posiciones independientes** (en paralelo) | Estratega, vocero, legal, voz ciudadana, periodista, oposición | Solo la hoja de hechos y la pregunta del usuario (sin la preferencia del usuario) | Cada uno: acción propuesta; mecanismo (por qué funcionaría); efecto esperado en 2–3 métricas con rango y probabilidad; supuestos; evidencia citada; **«qué me haría cambiar de opinión»**; confianza |
| **2 · Agrupación** | Moderador | Las 6 posiciones, en orden aleatorio y sin nombre de rol | 2 caminos candidatos distintos (o 3 si hay empate real); quién apoya cada uno. **Si todos convergen, construye el contraplán** (DI) |
| **3 · Ataque** | DA (premortem de cada camino) + oposición y periodista (cómo se explota / cómo se publica) | Los caminos candidatos | Por camino: 3 formas de fracasar, con la señal temprana de cada una; supuestos más frágiles; qué concede el DA |
| **4 · Réplica única** | Los 6 roles | Caminos + ataques | Cada rol: mantiene o cambia, y si cambia **cita qué evidencia o argumento nuevo lo movió**; ajusta probabilidades |
| **5 · Síntesis** | Moderador | Todo | Memorando de salida (C5) |

**Modo rápido** (primeras horas, ELEVADO, o pregunta táctica): ronda 0 +
ronda 1 con 3 roles (estratega, vocero, voz ciudadana) + DA + síntesis. Sin
réplica.

**Coste orientativo (I):** el modo completo son unas 15 llamadas al modelo
con contexto de varios miles de tokens (la hoja de hechos se pasa a todos:
usar **prompt caching** para ella, que hoy no existe en
`packages/shared/src/bedrock.ts`). Las rondas 1 y 3 van en paralelo, así que
la latencia es de unas 5 llamadas en serie. Mostrar el avance en streaming
(«el consejo está deliberando: ronda 2 de 5»), con eventos nuevos en el NDJSON.

### C4. Reglas del abogado del diablo

1. **Independiente:** no participa en la ronda 1, no propone camino, no vota.
2. **Ataca todos los caminos**, incluido el que parezca favorito, con la
   misma exigencia.
3. **Crítica con evidencia:** cada objeción cita una mención, una métrica,
   un precedente de crisis anterior o un artículo del manual; si es
   especulativa, lo dice y le pone probabilidad.
4. **Formato premortem:** «Es [fecha + 72 h] y este camino falló. Esto es lo
   que pasó», con la señal que lo habría anunciado temprano.
5. **Ataca supuestos, no personas ni roles:** identifica los 2–3 supuestos
   de los que depende cada camino y cuál es el más frágil.
6. **Puede conceder** («este camino resiste mi ataque en X»): sin
   concesiones, su crítica no distingue entre caminos.
7. **Dice qué lo haría ceder:** qué dato, si apareciera, invalidaría su
   objeción.
8. **No es la oposición:** el DA busca fallas del plan; la oposición busca
   cómo explotarlas políticamente.
9. **Obligación de respuesta:** cada objeción del DA aparece en la síntesis
   con una de tres etiquetas: *resuelta* (cómo), *mitigada* (con qué),
   *aceptada como riesgo* (y por qué se acepta). El moderador no puede
   omitirla.
10. **Se puntúa:** sus «formas de fracasar» se comparan con lo que pasó
    (C7); un DA que siempre predice desastre pierde calibración y eso se ve.

### C5. Formato de salida al usuario

Separación estricta entre **descripción de caminos** (neutral) y
**recomendación del consejo** (al final).

```
CONSEJO DE CRISIS · {Agencia} · {fecha y hora PR} · modo {completo|rápido}

1. LO QUE SABEMOS / LO QUE NO ESTÁ CLARO / LO QUE SUPONEMOS
   - Sabido: … (citas: mención #…, índice de crisis 0,47 ALERTA, …)
   - No claro: … (qué dato lo aclararía y cuándo)
   - Supuesto: …
   Hipótesis más probable de lo que está pasando: … (vs alternativa: …)
   Si no se hace nada (línea base): índice de crisis {rango} a 72 h, …

2. CAMINO A · {nombre corto en verbo}
   Qué es: 2–3 líneas (qué, quién lo dice, por qué canal, cuándo).
   Por qué funcionaría: mecanismo.
   Efectos probables (vs línea base):
     · Índice de crisis a 72 h: {rango}  · prob. de volver a ELEVADO o menos: {p}
     · NSS a 72 h: {rango de cambio}
     · Velocidad de negativas a 24 h: {sube/baja, rango}
     · Adopción del marco en medios a 72 h: {% rango}
   Riesgos: los 2–3 del premortem, con su señal temprana.
   Supuestos críticos: …
   Quién lo apoya en el consejo: …

3. CAMINO B · …  (mismo formato; o «No hay un segundo camino real porque …»)

4. SEÑALES PARA SABER SI FUNCIONA (24 / 48 / 72 h)
   · Va bien si: …   · Va mal si: …   · Cambiar de camino si: … (pregunta de Alexander)

5. RECOMENDACIÓN DEL CONSEJO
   Camino {A|B}, con confianza {p}. Por qué, en 3 líneas.

6. NOTA DE DISENSO
   Quién no está de acuerdo, con su argumento más fuerte (sin suavizar).
   Objeciones del abogado del diablo: resuelta / mitigada / aceptada.

7. LÍMITES
   Qué no ve ECO (TV/radio sin clipping, conversaciones privadas, datos internos de la agencia).
   Este consejo aconseja; la decisión es de la agencia. [Revisar con asesoría legal si …]
```

**Métricas observables que puede usar el consejo (I):**

| Métrica | Fuente en ECO | Uso |
|---|---|---|
| Índice de crisis V5 y su banda (NORMAL <0,25 · ELEVADO <0,40 · ALERTA <0,60 · CRISIS) | `metrics.ts`, scorecard | Resultado principal; probabilidad de bajar de banda |
| NSS | sentiment/analysis | Dirección del sentimiento neto; «quién movió el NSS» |
| Velocidad de negativas | componente del índice V5 | Señal temprana (24 h) |
| Volumen y % negativo vs lo usual | scorecard, overview | Contexto y clase de referencia |
| Polarización (2·mín(pos,neg)) | scorecard | Detectar si la respuesta divide en vez de calmar |
| **Adopción del marco en medios** (métrica nueva) | menciones `news` + embeddings | % de notas de medios en 24–72 h cuyo texto usa los términos clave del mensaje de la agencia o tiene similitud de embedding ≥ umbral con el comunicado; complemento: si la narrativa crítica sigue creciendo en `narrative/propagation` |
| Quién amplifica | mentions/analysis, narrative edges | Si actores clave recogen o rechazan el mensaje |
| Geografía | geo/analysis | Si la crisis se contiene o se extiende a municipios nuevos |

### C6. Señales tempranas (indicadores)

Del *Tradecraft Primer* y Neustadt-May: cada camino define de antemano qué
se vería si va bien o mal, para no reinterpretar los datos después.
Ejemplos:

- **24 h:** la velocidad de negativas baja respecto a las 24 h previas; los
  medios que publicaron primero recogen la versión de la agencia; no
  aparecen amplificadores nuevos de la narrativa crítica.
- **48 h:** la adopción del marco supera el umbral fijado; el NSS deja de
  caer; la polarización no sube.
- **72 h:** el índice de crisis baja al menos una banda o queda dentro del
  rango predicho.
- **Disparador de cambio de camino:** p. ej., «si aparece un documento
  nuevo que contradiga la versión oficial, o si un alcalde se suma a la
  crítica, pasar al camino B».

### C7. Cerrar el ciclo: calibración y evaluación

**Guardar las predicciones (I).** Tabla nueva, p. ej.
`crisis_council_runs` (agencia, pregunta, modo, hoja de hechos, caminos,
recomendación, camino elegido por el usuario, coste) y
`crisis_council_predictions` (run, rol, camino, métrica, horizonte 24/48/72 h,
rango predicho, probabilidad, línea base). El usuario marca qué camino tomó
(o «ninguno», o «otro»).

**Puntuar (I).** Un job (p. ej. dentro de `eco-metrics-calculator`, que ya
evalúa a diario) lee las métricas al vencer cada horizonte y calcula:
- acierto del rango y **puntuación de Brier** de cada probabilidad;
- **por rol** y **por moderador**, acumulado por agencia y tipo de crisis;
- curva de fiabilidad (cuando dijimos 70%, ¿pasó el 70% de las veces?);
- qué «formas de fracasar» del DA ocurrieron.

**El problema del contrafactual.** Solo se observa el camino elegido. Por
eso la línea base sin acción del analista de datos es clave: permite medir
si el camino elegido mejoró respecto a lo esperado sin acción, y puntuar
también la línea base. Las predicciones sobre el camino no elegido no se
pueden puntuar; se guardan solo como registro.

**Aprender (I).** En cada corrida nueva, la ronda 1 recibe el histórico de
calibración del rol («en esta agencia, cuando dijiste 70%, ocurrió el 45%»)
y la ronda 0 recibe las crisis pasadas parecidas con su resultado real. Es
la versión de ECO de *tracking* de Tetlock.

**¿El consejo gana a un solo agente? (I)** Antes de lanzarlo:
1. **Repetición histórica:** tomar 15–30 crisis pasadas en la base de ECO
   (picos del índice V5), congelar los datos a la hora t₀, correr (a) un
   solo agente con buen prompt y las mismas herramientas, (b) el modo
   rápido y (c) el modo completo; comparar sus predicciones con lo que pasó
   (Brier, acierto de rango). Cuidado con la fuga de información: el modelo
   puede conocer el desenlace de crisis muy mediáticas.
2. **Evaluación ciega por consultores de Populicom** de los memorandos
   (claridad, si las opciones son reales, si el disenso está bien
   recogido, utilidad), sin saber qué sistema los produjo; aleatorizar el
   orden (sesgo de posición).
3. **Coste y latencia** por modo. Si (a) empata con (c), quedarse con el
   más barato, como sugieren Smit, Wang y Choi.

### C8. Anti-patrones a vigilar

- **Consenso de fachada:** todos los roles terminan diciendo lo mismo en la
  ronda 4. Métrica de alarma: porcentaje de roles que cambian de postura
  sin citar evidencia nueva.
- **Complacencia con el usuario:** el usuario escribe «creo que deberíamos
  callar» y el consejo lo confirma. Mitigación: no pasar su preferencia a
  la ronda 1; mostrarla solo en la síntesis, contrastada.
- **Ciudadanía inventada:** la voz ciudadana «cree» cosas sin citas. Regla:
  ninguna afirmación sobre la gente sin ID de mención.
- **DA decorativo:** objeciones genéricas, sin cita, o que no aparecen en la
  síntesis.
- **Opción de paja:** el camino B existe solo para que A parezca bueno.
- **Falsa precisión:** probabilidades de un decimal sin clase de
  referencia; preferir rangos.
- **Memorando largo:** el sesgo de longitud premia lo extenso; el usuario
  necesita una pantalla. Límite de palabras por sección.

### C9. Preguntas abiertas

1. ¿Qué umbral del índice V5 dispara el modo completo de forma proactiva
   (p. ej., junto al correo de crisis)?
2. Inventario legal concreto para PR: lo debe fijar el frente legal; aquí
   solo se dejó el rol preparado.
3. Definición operativa y validación de «adopción del marco en medios»
   (umbral de similitud, ventana, qué medios cuentan).
4. ¿El usuario debe poder ver la deliberación completa (rondas) o solo el
   memorando? Propuesta: memorando por defecto, rondas desplegables.
5. ¿Se puede ampliar el IAM de Bedrock a modelos no Anthropic para ganar
   diversidad real de modelos? (Hoy no; ver doc 06.)

---

## Fuentes

### Deliberación humana
- Mason, R. O. (1969). A Dialectical Approach to Strategic Planning. *Management Science* 15(8). https://pubsonline.informs.org/doi/10.1287/mnsc.15.8.B403 — [copyright — solo resumir]
- Schweiger, Sandberg y Ragan (1986). Group Approaches for Improving Strategic Decision Making… *Academy of Management Journal* 29(1), 51–71. Sin enlace abierto; artículo hermano de Schweiger y Sandberg (1989, *Strategic Management Journal*) sobre por qué DA y DI funcionan: https://ideas.repec.org/a/bla/stratm/v10y1989i1p31-43.html — [copyright — solo resumir]
- Schweiger, Sandberg y Rechner (1989), *AMJ*; resumen citado en https://arxiv.org/pdf/2503.14263 — [copyright — solo resumir]
- Schwenk, C. R. (1990). Effects of devil's advocacy and dialectical inquiry on decision making: A meta-analysis. *OBHDP* 47(1). https://ideas.repec.org/a/eee/jobhdp/v47y1990i1p161-176.html — [copyright — solo resumir]
- Schwenk (1989), *Strategic Management Journal*. https://ideas.repec.org/a/bla/stratm/v10y1989i3p303-306.html — [copyright — solo resumir]
- Fjermestad, J. (2019). Structured Conflict Approaches… Now Publishers. https://nowpublishers.com/article/Details/ISY-013 — [copyright — solo resumir]
- Nemeth, Brown y Rogers (2001). Devil's advocate vs. authentic dissent. *EJSP* 31. https://doi.org/10.1002/ejsp.58 ; perfil: https://psychology.berkeley.edu/user/111 — [copyright — solo resumir]
- Kramer, R. M. (1998). Revisiting the Bay of Pigs and Vietnam decisions 25 years later. *OBHDP* 73. https://www.gsb.stanford.edu/faculty-research/publications/revisiting-bay-pigs-vietnam-decisions-25-years-later-how-well-has — [copyright — solo resumir]
- EXCOMM (resumen secundario). https://en.wikipedia.org/wiki/EXCOMM — [acceso abierto, CC BY-SA]
- UFMCS, *Red Team Handbook* (US Army). https://home.army.mil/wood/6115/8222/0759/RedTeamHB.pdf ; *Applied Critical Thinking Handbook* 7.0: https://nsiteam.com/social/the-applied-critical-thinking-handbook-7-0/ — [dominio público, obra del gobierno de EE.UU.; declaración de distribución sin verificar]
- UK MoD DCDC, *Red Teaming Handbook* 3.ª ed. (2021). https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1027158/20210625-Red_Teaming_Handbook.pdf ; https://www.gov.uk/government/publications/a-guide-to-red-teaming — [copyright — solo resumir: Crown copyright, uso solo gobierno británico/MOD, no OGL]
- Devil's Advocate Unit (Aman). https://en.wikipedia.org/wiki/Devil%27s_Advocate_Unit ; Research Department (Aman): https://en.wikipedia.org/wiki/Research_Department_(Aman) ; «The Tenth Man»: https://archive.sharedjustice.org/international-justice/2016/4/6/the-tenth-man — [acceso abierto; secundarias]
- Team B. https://en.wikipedia.org/wiki/Team_B ; https://www.americanprogress.org/article/its-time-to-bench-team-b/ — [acceso abierto; la segunda es opinión]
- Heuer, R. J. (1999). *Psychology of Intelligence Analysis*. CIA. https://www.cia.gov/resources/csi/static/Pyschology-of-Intelligence-Analysis.pdf — [dominio público]
- CIA (2009). *A Tradecraft Primer: Structured Analytic Techniques*. https://www.cia.gov/resources/csi/static/955180a45afe3f5013772c313b16face/Tradecraft-Primer-apr09.pdf — [dominio público]
- Klein, G. (2007). Performing a Project Premortem. *HBR*; ficha del método: https://archive.phf.org/resourcestools/Documents/Pre_Mortem_Analysis.pdf — [copyright — solo resumir]
- Mitchell, Russo y Pennington (1989). Back to the Future: Temporal Perspective in the Explanation of Events. *J. Behavioral Decision Making* — [copyright — solo resumir]
- Dalkey y Helmer (1963). An Experimental Application of the DELPHI Method. *Management Science* 9(3). https://ideas.repec.org/a/inm/ormnsc/v9y1963i3p458-467.html — [copyright — solo resumir]
- Wack, P. (1985). Scenarios: Uncharted Waters Ahead. *HBR*. https://en.wikipedia.org/wiki/Pierre_Wack — [copyright — solo resumir]
- Mellers et al. (2014). Psychological Strategies for Winning a Geopolitical Forecasting Tournament. *Psychological Science* 25. https://www.psychologicalscience.org/journals/psychological-science/0956797614524255/ ; reanálisis 2024: https://www.psychologicalscience.org/journals/psychological-science/09567976241266481/ — [copyright — solo resumir]
- Neustadt y May (1986). *Thinking in Time*. Free Press. Reseña: https://smallwarsjournal.com/2023/01/02/book-review-thinking-time-uses-history-decision-makers — [copyright — solo resumir]
- Stasser y Titus (1985), *JPSP* (perfiles ocultos), citado en HiddenBench — [copyright — solo resumir]

### Debate multiagente con LLMs
- Du et al. (2023). Improving Factuality and Reasoning… through Multiagent Debate. https://arxiv.org/abs/2305.14325 — [acceso abierto]
- Liang et al. (2023). Encouraging Divergent Thinking… through Multi-Agent Debate. https://arxiv.org/abs/2305.19118 — [acceso abierto]
- Chan et al. (2023). ChatEval. https://arxiv.org/abs/2308.07201 — [acceso abierto]
- Khan et al. (2024). Debating with More Persuasive LLMs Leads to More Truthful Answers. https://arxiv.org/abs/2402.06782 ; https://proceedings.mlr.press/v235/khan24a.html — [acceso abierto]
- Chen, Saha y Bansal (2024). ReConcile. https://aclanthology.org/2024.acl-long.381 — [acceso abierto]
- Hegazy (2024). Diversity of Thought Elicits Stronger Reasoning… https://arxiv.org/abs/2410.12853 — [acceso abierto]
- Chiang et al. (2024). LLM-Powered Devil's Advocate (IUI '24). https://par.nsf.gov/servlets/purl/10524816 ; seguimiento IUI 2025: https://arxiv.org/html/2502.06251v1 — [acceso abierto]
- Smit et al. (2024). Should we be going MAD? https://proceedings.mlr.press/v235/smit24a.html ; https://arxiv.org/abs/2311.17371 — [acceso abierto]
- Wang et al. (2024). Rethinking the Bounds of LLM Reasoning: Are Multi-Agent Discussions the Key? https://aclanthology.org/2024.acl-long.331 — [acceso abierto]
- Choi, Zhu y Li (2025). Debate or Vote. https://arxiv.org/abs/2508.17536 — [acceso abierto]
- Wynn, Satija y Hadfield (2025). Talk Isn't Always Cheap. https://arxiv.org/abs/2509.05396 — [acceso abierto]
- Yao et al. (2025). Peacemaker or Troublemaker. https://arxiv.org/abs/2509.23055 — [acceso abierto]
- Choi et al. (2025). An Empirical Study of Group Conformity in Multi-Agent Systems. https://arxiv.org/abs/2506.01332 — [acceso abierto]
- arXiv 2604.02668 (2026), complacencia ante el usuario en discusiones multiagente. https://arxiv.org/pdf/2604.02668 — [acceso abierto; sin verificar en el original]
- Li, Naito y Shirado (2025). HiddenBench. https://arxiv.org/abs/2505.11556 — [acceso abierto]
- Zheng et al. (2024). When "A Helpful Assistant" Is Not Really Helpful. https://arxiv.org/abs/2311.10054 — [acceso abierto]
- Wang, Morgenstern y Dickerson (2025). LLMs that replace human participants can harmfully misportray and flatten identity groups. *Nat. Mach. Intell.* 7(3). Preprint: https://arxiv.org/abs/2402.01908 — [copyright — solo resumir; preprint acceso abierto]
- Zheng et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. https://arxiv.org/abs/2306.05685 — [acceso abierto]
- Xiong et al. (2024). Can LLMs Express Their Uncertainty? https://arxiv.org/abs/2306.13063 — [acceso abierto]
- Schoenegger et al. (2024). Wisdom of the Silicon Crowd. https://www.arxiv.org/abs/2402.19379 ; *Science Advances* doi:10.1126/sciadv.adp1528 — [acceso abierto]
- Anthropic (2025). How we built our multi-agent research system. https://www.anthropic.com/engineering/multi-agent-research-system — [copyright — solo resumir]
