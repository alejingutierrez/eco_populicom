# 11 · Detectar, medir y predecir: la ciencia detrás de las señales del asesor de crisis

**Frente de investigación:** qué dice la literatura científica para que el asesor de crisis de ECO **detecte** a tiempo, **mida** bien y **prediga** con probabilidades honestas, usando solo los datos que ECO tiene hoy (o puede tener con poco esfuerzo).

**Fecha:** 28-oct-2026 · **Estado:** investigación documental + propuesta de especificación. No es código ni está desplegado.

**Lee antes:** `05-narrativa-digital-y-tiempos.md` (§1.5 umbrales, §2 señales, §6 medición, §8 tabla señal→acción, §10 diseño, §11 pendientes). Este documento cierra los pendientes científicos de §11 y convierte las "señales que faltan" de §10 en definiciones calculables.

## Convenciones de lectura

Las mismas de `05`:

- **Evidencia:** [EVIDENCIA-EXP] experimento o metaanálisis · [EVIDENCIA-OBS] estudio observacional con datos · [MÉTODO] técnica validada en su fuente, sin prueba en nuestro dominio · [PRÁCTICA] oficio · [OPINIÓN] argumento · [INFERENCIA ECO] aplicación propia, no viene de la fuente.
- **Licencias:** [acceso abierto] (con la licencia CC cuando se conoce) · [copyright — solo resumir].
- Todo resumido en palabras propias; como máximo una cita textual corta (menos de 15 palabras) por fuente.
- **⚠ sin verificar** = no se pudo leer la fuente primaria en esta sesión; el dato viene de un resumen secundario.

---

## Resumen ejecutivo

1. **Las cifras clásicas se confirman, con matices que importan.**
   - Vosoughi et al. (2018): a la verdad le tomó **unas 6 veces más** llegar a 1,500 personas; lo falso tuvo **70 % más** probabilidad de retuit. Pero Juul y Ugander (2021) muestran que casi todas las diferencias *estructurales* se explican porque las cascadas falsas son más grandes.
   - Lorenz-Spreen et al. (2019): un hashtag duraba en el top-50 **17.5 h en 2013 y 11.9 h en 2016**. Confirmado.
   - Leskovec et al. (2009): el 3.5 % de las historias que van de blogs a medios es una estimación heurística, no un conteo.
   - Brady (2017): el "~12 %" que `05` atribuía a un reanálisis es en realidad el metaanálisis de los propios autores (2025). La crítica fuerte es otra: Burton et al. (2021).
2. **"Cruce de comunidades" sí es calculable en ECO, pero no como en el paper.** Weng et al. (2013) usaron el grafo de seguidores. ECO no lo tiene. **Propuesta:** detectar comunidades de autores con Leiden sobre la red de co-participación en narrativas (autor × narrativa, ponderado TF-IDF como en Pacheco et al. 2021) y medir, por narrativa, **cuántas comunidades alcanza, con qué entropía y qué parte de sus autores recientes está fuera de su comunidad de origen**. La *structural virality* de Goel et al. (2016) **no** se puede calcular: ECO no ve árboles de retuit.
3. **La adopción del marco se mide en tres capas.**
   - Reutilización literal (7-gramas, Nicholls 2019).
   - Frases-marco distintivas (log-odds con prior de Dirichlet, Monroe et al. 2008).
   - Cercanía semántica contrastiva: más cerca de nuestro comunicado que del marco adversario (embeddings Titan v2).
   - Para titulares, un LLM juez **validado con ≥ 250 etiquetas humanas** (Pangakis et al. 2023).
   - Requiere un insumo nuevo: registrar los comunicados de la agencia.
4. **Coordinación: umbral prudente = mismo texto entre cuentas distintas en ≤ 60 s, repetido.** Schoch et al. (2022) prefieren 1 minuto, con alrededor de 1 % de falsos positivos en usuarios comunes. La salida siempre dice "patrón coordinado", nunca "bots". Pacheco et al. priorizan precisión sobre cobertura y exigen revisión manual de cada clúster.
5. **Predicción realista: "¿se duplicará en 24 h?", no "¿cuánto llegará?".**
   - Cheng et al. (2014): con 5 reacciones observadas, acertaron 79.5 % (AUC 0.877) si una cascada se duplicaría. Los rasgos **temporales** (ritmo, tiempo hasta la k-ésima) son los que más predicen.
   - El tamaño exacto no se puede predecir bien: las distribuciones tienen colas pesadas.
   - Horizonte útil: 24 h para crecimiento; 72 h para persistencia o entrada en medios.
6. **Las probabilidades no las debe inventar el LLM.**
   - Los LLM pronosticadores mejoran, pero siguen detrás de humanos expertos. Halawi et al. (2024): Brier 0.179 frente a 0.149 de la multitud; ForecastBench (oct-2025): 0.101 frente a 0.081 de los superpronosticadores.
   - Tienden a cubrirse hacia el 50 %. En Schoenegger et al. (2024) mostraron sesgo hacia el "sí".
   - **Propuesta:** la probabilidad sale de un modelo estadístico calibrado (isotónica) sobre el historial de ECO; el LLM explica y aporta la **clase de referencia** (outside view).
7. **Atribución de responsabilidad (SCCT) y factores de indignación de Sandman: no hay clasificador validado.**
   - El marco de "atribución de responsabilidad" es justo el que peor detectan los LLM: GPT-3.5 acertó **0 de 231** en un estudio de 2024.
   - Hay que construirlo con codebook + 2 codificadores humanos (α de Krippendorff ≥ 0.667) + validación del LLM por clase, y usarlo solo en **proporciones agregadas y corregidas**, nunca para etiquetar a una persona.
8. **Contrafactuales.** Solo observamos el camino elegido. La forma honesta de evaluarlo:
   - **pronóstico prerregistrado de "sin acción"** antes de actuar;
   - BSTS/CausalImpact con series de control no afectadas;
   - control sintético entre agencias, con las advertencias de Abadie;
   - comparación con narrativas similares **emparejadas por tamaño** (lección de Juul y Ugander).

---

## 1. Verificación de pendientes de `05` §11

| Fuente | Qué se verificó | Matiz o corrección | Licencia |
|---|---|---|---|
| **Vosoughi, Roy y Aral (2018), *Science* 359:1146** | [EVIDENCIA-OBS] ~126 mil cascadas de rumores en Twitter (2006–2017), ~3 millones de personas, más de 4.5 millones de retuits. Lo falso llegó a 1,500 personas **unas 6 veces más rápido**; a profundidad 10, **unas 20 veces más rápido**; lo falso alcanzó profundidad 19 casi 10 veces más rápido que lo verdadero profundidad 10. El 1 % superior de cascadas falsas llegó a **1,000–100,000** personas; lo verdadero rara vez pasó de 1,000. Lo falso tuvo **70 % más** probabilidad de retuit, controlando por rasgos de la cuenta. Respuestas a lo falso: miedo, asco, sorpresa; a lo verdadero: anticipación, tristeza, alegría, confianza. Los bots aceleraron por igual lo falso y lo verdadero. | La cifra de "6 veces" **es del paper**, no solo de prensa. Juul y Ugander (2021, PNAS) muestran que las diferencias **estructurales** entre cascadas falsas y verdaderas se explican casi por completo por el **tamaño**: lo falso es más infeccioso, no tiene otra forma de propagarse. | Paper: [copia del MIT](https://politics.media.mit.edu/papers/Vosoughi_Science.pdf) [copyright — solo resumir]. Juul y Ugander: [PMC8609637](https://pmc.ncbi.nlm.nih.gov/articles/PMC8609637/) [acceso abierto] |
| **Lorenz-Spreen, Mønsted, Hövel y Lehmann (2019), *Nat. Commun.* 10:1759** | [EVIDENCIA-OBS] Tiempo medio en el top-50 de hashtags: **17.5 h (2013) → 11.9 h (2016)**. Mismo patrón en libros, Google, cine, Reddit, citas y Wikipedia: picos de altura similar, pero subidas y caídas más empinadas. Un modelo de competencia por atención lo atribuye al aumento en producción y consumo de contenido. | Confirmado. Se elimina la marca ⚠ de `05` §1.3. | [PMC6465266](https://pmc.ncbi.nlm.nih.gov/articles/PMC6465266) [acceso abierto, CC BY 4.0] |
| **Pfeffer, Zorbach y Carley (2014), *J. Marketing Communications* 20(1-2)** | [OPINIÓN/teoría con casos] Definición confirmada: descarga súbita de grandes cantidades de mensajes con boca a boca negativo y quejas contra una persona, empresa o grupo. Según fuentes secundarias, los factores de proliferación son: (a) **volumen y velocidad**: en clústeres densos el intervalo hasta el siguiente mensaje es muy corto; (b) **redes muy agrupadas**; (c) mensajes de **opinión más que de hechos**, más agresivos que un rumor; (d) **interacción con los medios tradicionales**, que amplifica. | ⚠ Los factores vienen de [Drasch et al. 2015](https://fim-rc.de/Paperbibliothek/Veroeffentlicht/455/wi-455.pdf) y de una [tesis de U. Twente](https://essay.utwente.nl/79702/1/Wekwerth_MA_BMS-faculty.pdf). No se leyó el texto primario. | [TUM](https://portal.fis.tum.de/en/publications/understanding-online-firestorms-negative-word-of-mouth-dynamics-i/) [copyright — solo resumir] |
| **Drasch, Huber, Panz y Probst (ICIS 2015)** | [MÉTODO, un caso] Algoritmo de Farrington mejorado por Noufaily: GLM cuasi-Poisson con tendencia sobre los últimos *n* periodos; el umbral es un cuantil superior con error α. Valores por defecto: **Δt = 5 min** (expertos: 7 min hasta poder actuar), **n = 30**, **α = 0.05**. Si menos del 25 % de los periodos tiene actividad, usa umbrales por defecto. **Alarma solo si el total y el negativo superan su umbral a la vez.** Caso: Coca-Cola en Facebook, anuncio del Super Bowl, febrero de 2014. Detectó el firestorm a los **46–79 s**, con **1–17 falsas alarmas en 3 meses** (1 con la configuración por defecto). Las variantes que solo miran el volumen total dieron cientos de falsas alarmas (hasta 673). | Confirmado. Un solo caso: la validez externa es limitada. | [acceso abierto, working paper] |
| **Leskovec, Backstrom y Kleinberg (KDD 2009)** | [EVIDENCIA-OBS] 90 millones de artículos de 1.6 millones de sitios en 3 meses (2008). El pico en blogs llega **unas 2.5 h después** del pico en medios; el traspaso termina en 6–9 h. El 3.5 % sale de una **heurística**: frases cuyo volumen en blogs, más de una semana antes del pico mediático, es entre el 15 % y el 50 % del total. De 16,000 frases, 760 pasaron el filtro. | Era pre-Twitter y pre-Facebook masivo, y el número es heurístico. La dirección "medios → redes como norma" sigue siendo plausible, pero **en ECO hay que medir la tasa base propia** (S4, §8). | [copia del autor](https://www.cs.cornell.edu/home/kleinber/kdd09-quotes.pdf) [acceso abierto, copia de autor] |
| **Brady et al. (2017), *PNAS* 114(28)** | [EVIDENCIA-OBS] 563,312 mensajes sobre 3 temas morales y políticos. Cada palabra **moral-emocional** se asoció con **~20 %** más difusión, y más dentro de cada bando que entre bandos. Replicación prerregistrada y metaanálisis de los mismos autores (2025, *PNAS Nexus*): IRR 1.15 en la réplica y **1.12 combinado en 27 estudios**. | **Corrección a `05` §2.2:** el ~12 % es del metaanálisis de 2025, no de un "reanálisis" externo. La crítica externa es Burton, Cruz y Hahn (2021, *Nat. Hum. Behav.*): fuera de muestra, el modelo de "contagio moral" no predice mejor que un modelo absurdo de control. Conclusión: el efecto existe, pero es pequeño y frágil como predictor individual. | [PMC5514704](https://pmc.ncbi.nlm.nih.gov/articles/PMC5514704) [acceso abierto]; [Kellogg, 2025](https://www.kellogg.northwestern.edu/academics-research/research/detail/2025/estimating-the-effect-size-of-moral-contagion-in-online/); [Burton et al.](https://research.cbs.dk/en/publications/reconsidering-evidence-of-moral-contagion-in-online-social-networ/) [copyright — solo resumir] |
| **Rathje, Van Bavel y van der Linden (2021), *PNAS* 118(26)** | [EVIDENCIA-OBS] 2,730,215 publicaciones de medios y congresistas de EE. UU. en Facebook y Twitter. Cada término sobre el **exogrupo político** aumentó en **67 % las *odds*** de ser compartido. Fue el predictor más fuerte, por encima del lenguaje negativo y del moral-emocional. | El 67 % es un cociente de *odds*, no "67 % más shares". | [PMC8256037](https://pmc.ncbi.nlm.nih.gov/articles/PMC8256037/) [acceso abierto] |
| **Chesney y Citron (2019), *California Law Review* 107:1753** | [OPINIÓN/análisis jurídico] "Dividendo del mentiroso": cuanto más sabe el público que existen los deepfakes, más fácil le resulta a quien fue grabado de verdad negar la evidencia auténtica. Citado: público "primed to doubt the authenticity of real audio and video evidence". Los tribunales de EE. UU. han rechazado defensas de "es un deepfake" sin prueba (caso Tesla/Musk). | ⚠ Verificado por fuentes secundarias ([LBJ School](https://lbj.utexas.edu/how-deepfakes-will-make-us-question-everything-2020), [KUOW](https://www.kuow.org/stories/people-are-trying-to-claim-real-videos-are-deepfakes-the-courts-are-not-amused)), no en el texto primario. | [SSRN 3213954](https://papers.ssrn.com/abstract=3213954) [copyright — solo resumir] |

**[INFERENCIA ECO] Qué cambia para el asesor.**

- "Lo falso viaja más rápido" se mantiene como regla de **urgencia**. Pero no autoriza a inferir que una historia es falsa porque se propaga rápido: la velocidad viene del tamaño y de la infecciosidad, no de la verdad.
- Con una vida media de horas (Lorenz-Spreen), el **horizonte de predicción útil es de 24 h** para el crecimiento.
- El lenguaje moral-emocional es una **covariable** (efecto pequeño, ~12 % por palabra), no una alarma. El exogrupo pesa más (Rathje).

---

## 2. "Cruce de comunidades" operativo

### 2.1 Lo que dice la ciencia

- **Weng, Menczer y Ahn (2013), *Scientific Reports* 3:2522.** [EVIDENCIA-OBS]
  - Comunidades: Infomap sobre la red de seguimiento **recíproco** de 595,460 usuarios. En el material suplementario también probaron las redes de retuit y de mención.
  - Rasgos, todos medidos en los **primeros 50 tuits** de cada hashtag:
    - número de comunidades "infectadas";
    - entropía de uso y de adopción entre comunidades;
    - fracción de interacciones dentro de la misma comunidad;
    - número de adoptantes tempranos y sus vecinos no infectados.
  - Clasificador: random forest, con validación cruzada de 10 particiones.
  - Para el 10 % más viral, los rasgos de comunidad dieron **unas 7 veces** la precisión del azar y **más de 3 veces** la del mismo modelo sin ellos.
  - Mecanismo: la mayoría de memes se queda atrapada en su comunidad, como un contagio complejo; los virales cruzan muchas, como un contagio simple.
  - [PMC3755286](https://pmc.ncbi.nlm.nih.gov/articles/PMC3755286) [acceso abierto, CC BY-NC-SA 3.0].
- **Goel, Anderson, Hofman y Watts (2016), *Management Science* 62(1).** [EVIDENCIA-OBS]
  - *Structural virality* = distancia media entre todos los pares de nodos del **árbol de difusión** (índice de Wiener).
  - Con mil millones de eventos de difusión en Twitter, la viralidad estructural suele ser baja con independencia del tamaño: la popularidad la explica sobre todo **la mayor emisión única**, una cuenta grande.
  - [PDF del autor](https://www.5harad.com/papers/twiral.pdf) [copyright — solo resumir].
- **Traag, Waltman y van Eck (2019), *Scientific Reports* 9:5233.** [MÉTODO]
  - Louvain puede producir comunidades mal conectadas: hasta el 25 % mal conectadas y hasta el 16 % desconectadas.
  - **Leiden** garantiza comunidades conectadas, es más rápido y da mejores particiones.
  - [arXiv 1810.08473](https://arxiv.org/abs/1810.08473) [acceso abierto, CC BY 4.0].
- **Pacheco et al. (2021, ICWSM).** [MÉTODO] Red bipartita cuenta × rasgo compartido, ponderada con TF-IDF para que los rasgos populares pesen menos, y proyección a cuentas por coseno. Sirve igual para construir **comunidades de co-participación** (ver §4). — [arXiv 2001.05658](https://arxiv.org/abs/2001.05658) [acceso abierto].

### 2.2 Qué tiene ECO y qué no

[INFERENCIA ECO, verificado contra `packages/database/src/schema/` e `infra/lambda/narrative-edges/index.ts`]

- **Tiene:**
  - `mentions.author`, `page_type`, `content_source`, `pub_type`, `domain`, `published_at`, `reach_estimate`, `potential_audience`, `embedding`;
  - `narrative_mentions`, que liga menciones con narrativas;
  - `narrative_edges`, que son **narrativa ↔ narrativa**, no autor ↔ autor:
    - `author_overlap`: ≥ 3 autores compartidos, con coeficiente de solapamiento;
    - `co_occurrence`: ≥ 5 menciones compartidas, con Jaccard;
    - `semantic`: coseno entre centroides > 0.6.
- **No tiene:** grafo de seguidores, árbol de retuits o respuestas, ni identidad del mismo autor entre plataformas.
- **Consecuencia:**
  - **Structural virality (Goel) no es calculable.**
  - Las comunidades de Weng (seguidores) tampoco.
  - Lo más cercano y defendible es la **co-participación**: dos autores pertenecen a la misma comunidad si suelen hablar de las mismas narrativas. Es una proxy de **audiencia temática**, no de red social.
  - Brandwatch solo entrega menciones que cumplen la query, así que la red está **muestreada por tema**.

### 2.3 Indicador propuesto: Penetración de Comunidades (PC)

[INFERENCIA ECO; los componentes vienen de Weng 2013, Pacheco 2021 y Traag 2019]

**Paso A: mapa de comunidades de autores.** Recalcular cada semana y por agencia.

1. Red bipartita autor × narrativa, con las menciones de los últimos 90 días.
   - Excluir `is_duplicate`, los autores vacíos y el ruido conocido de Brandwatch (por ejemplo "2 minutes" en `author`).
   - Excluir cuentas oficiales de la propia agencia.
2. Peso TF-IDF: `w(a,n) = tf(a,n) · log(N_narr / df(n))`. Las narrativas enormes pesan menos.
3. Proyección a autores por coseno.
   - Solo autores con ≥ 3 narrativas distintas (filtro de soporte, como en Pacheco).
   - Conservar las aristas con coseno ≥ percentil 95 o con ≥ 2 narrativas compartidas.
4. **Leiden** (modularidad; resolución por defecto 1.0, ajustable). Las comunidades con menos de 5 autores van a "periferia".
5. Etiquetar cada comunidad (dominios y autores más frecuentes, tópicos dominantes) con un LLM, **solo para lectura humana**.
6. Añadir una dimensión fija de **ecosistema**: prensa, X, Facebook, Instagram, TikTok, YouTube, foros, blogs. Sale de `page_type` y `content_source`; es barata y robusta.

**Paso B: medidas por narrativa *n* en una ventana *W*.** Las primeras 24 h desde `born_at` sirven para predecir; las 24 h móviles, para vigilar.

| Medida | Definición |
|---|---|
| `PC_k(n,W)` | Número de comunidades con ≥ 2 autores de *n* en *W* |
| `PC_H(n,W)` | Entropía de Shannon de la distribución de autores de *n* entre comunidades, normalizada por log(K). Es la "adoption entropy" de Weng |
| `PC_out(n,W)` | Fracción de autores de *n* en *W* que **no** pertenecen a la comunidad de origen. Comunidad de origen = la moda entre los primeros 10 autores |
| `PC_eco(n,W)` | Número de ecosistemas con ≥ 2 menciones |
| `PC_nuevos(n,W)` | Fracción de autores sin historial (fuera del mapa). Si es alta, entra gente nueva: posible salto, o un problema de cobertura |

**Paso C: evento "cruce de comunidades".** Para los niveles de `05` §1.5.

- Se dispara si `PC_k` sube ≥ 2 en 24 h **y** `PC_out` ≥ 0.5, **o** si entra un ecosistema nuevo de tipo prensa (S4).
- **Umbral inicial relativo:** percentil 90 de las narrativas de la misma agencia **a la misma edad y con el mismo número de menciones**. Hay que condicionar por tamaño (lecciones de Cheng 2014 y de Juul y Ugander 2021): una narrativa grande siempre toca más comunidades.

**Validación.**

1. Backtest con las narrativas históricas (DDEC tiene más de 480 días de datos).
2. ¿`PC_k` y `PC_H` en las primeras 20 menciones predicen que la narrativa llegue al decil superior de tamaño, o que entre en medios?
3. Comparar el AUC del modelo **con y sin** rasgos de comunidad. Es la prueba de Weng.
4. Si no hay mejora, el indicador no entra en las reglas de escalada.

**Coste.**

- Leiden semanal en Python (`leidenalg`/igraph) sobre ~10⁴–10⁵ autores: segundos o pocos minutos en una Lambda.
- Las medidas por narrativa son SQL agregadas cada hora: coste bajo.

---

## 3. "Adopción del marco" (frame adoption)

### 3.1 Lo que dice la ciencia

- **Reutilización textual (Nicholls 2019, *International Journal of Communication* 13).** [MÉTODO + EVIDENCIA-OBS]
  - Shingling de n-gramas sobre 163 mil artículos de EE. UU. y el Reino Unido, más cables de agencia y comunicados de PR Newswire.
  - Recomendaciones:
    - usar **7-gramas**, más precisos; los 5-gramas son más sensibles pero más ruidosos;
    - tratar como **original** un artículo con ≤ 5 % de 7-gramas compartidos;
    - descartar los 7-gramas que aparecen ≥ 50 veces en el corpus: son frases hechas.
  - Halló **menos** copia de comunicados de lo que decían estudios previos, y lo atribuye en parte a los límites del método: la paráfrasis no se detecta.
  - [IJoC](https://ijoc.org/index.php/ijoc/article/view/9904) [acceso abierto].
- **Atribución de fuente sin el comunicado (MacLaughlin et al., ICWSM 2020).** [MÉTODO]
  - 64,784 noticias de salud y 23,068 comunicados.
  - Un modelo BERT puntúa qué oraciones derivan del comunicado: ρ de Spearman 0.49.
  - Le cuesta distinguir la paráfrasis libre del texto original.
  - [AAAI](https://ojs.aaai.org/index.php/ICWSM/article/view/7312) [acceso abierto].
- **Eco semántico de comunicados (Cann et al., arXiv 2023).** [MÉTODO]
  - Embeddings y similitud semántica entre comunicados de organizaciones ambientales y tuits, comparando antes y después de cada publicación.
  - La respuesta tiene **cola pesada**: pocos comunicados mueven la conversación.
  - ⚠ El umbral de coseno 0.7 que cita un resumen no se confirmó en el texto, y en todo caso depende del modelo de embeddings.
  - [arXiv 2303.16694](https://arxiv.org/abs/2303.16694) [acceso abierto].
- **Palabras distintivas entre bandos (Monroe, Colaresi y Quinn 2008, *Political Analysis* 16(4)).** [MÉTODO] Log-odds con prior de Dirichlet informativo: identifica las palabras que separan dos corpus sin sobrevalorar las raras. Es el estándar para extraer el "vocabulario del marco". — [Cambridge](https://www.cambridge.org/core/journals/political-analysis/article/fightin-words-lexical-feature-selection-and-evaluation-for-identifying-the-content-of-political-conflict/81B3703230D21620B81EB6E2266C7A66) [copyright — solo resumir].
- **Clasificadores de marco.**
  - Card et al. (ACL 2015): *Media Frames Corpus*, 15 dimensiones genéricas de encuadre (economía, moralidad, legalidad, seguridad, etc.) sobre miles de noticias. — [ACL Anthology P15-2072](https://aclanthology.org/P15-2072/) [acceso abierto].
  - LLM como clasificadores de marco: [EVIDENCIA-EXP pequeña]
    - Gilardi et al. (2023, *PNAS*): ChatGPT en zero-shot superó a trabajadores de crowdsourcing en unos 25 puntos de exactitud en tareas que incluyen detección de marcos. — [arXiv 2303.15056](https://arxiv.org/abs/2303.15056) [acceso abierto].
    - Pastorino et al. (2024): GPT-4 mejora con pocos ejemplos, pero **confunde lenguaje emocional con encuadre**. — [arXiv 2402.11621](https://arxiv.org/abs/2402.11621) [acceso abierto].
    - Alonso del Barrio et al. (2024): GPT-3.5 con los 5 marcos de Semetko y Valkenburg sobre TV neerlandesa tuvo un acuerdo global de 39–48 % y **0 aciertos en "atribución de responsabilidad"** (0/231 y 0/244). Un solo anotador humano. — [arXiv 2409.12561](https://arxiv.org/html/2409.12561v1) [acceso abierto].
    - Pangakis et al. (2023): en 27 tareas de ciencias sociales, GPT-4 tuvo una F1 **mediana de 0.71, con mínimo de 0.06**. El rendimiento varía tanto que **hay que validar cada tarea** contra 250–1,250 etiquetas humanas. Las etiquetas consistentes en varias corridas fueron 19 puntos más exactas. — [arXiv 2306.00176](https://arxiv.org/abs/2306.00176) [acceso abierto].

### 3.2 Métrica propuesta: Adopción del Marco (AM)

[INFERENCIA ECO]

**Insumo nuevo (imprescindible).**

- Tabla `agency_statements`: texto del comunicado, fecha y hora, canal y "frases-marco" opcionales que la agencia quiere instalar.
- Opcionalmente, `adversary_claims`: 1–5 formulaciones del marco contrario, escritas por el analista **o** extraídas de las menciones representativas de la narrativa (centroide).

**Universo.**

- Menciones de **prensa** (`page_type` de noticias; mejor con texto completo de `eco-article-fetch` cuando exista).
- Por separado, menciones sociales de la narrativa o el tópico ligado al comunicado.
- Ventana de 72 h después del comunicado, comparada con las 72 h anteriores.

| Capa | Cálculo | Qué detecta | Fuente |
|---|---|---|---|
| **AM-literal** | Contención de 7-gramas: \|G7(mención) ∩ G7(comunicado)\| / \|G7(mención)\|, sin 7-gramas con ≥ 50 usos en el corpus de la agencia. "Reutiliza" si es > 5 % | Copia o "churnalism" | Nicholls 2019 |
| **AM-frases** | Top 10–20 frases distintivas del comunicado frente al corpus de la agencia (log-odds con prior de Dirichlet), y lo mismo para el marco adversario. Proporción de menciones con ≥ 1 frase propia frente a ≥ 1 frase adversaria | El **vocabulario** del marco se impone | Monroe 2008 |
| **AM-semántica** | Con Titan v2 (1024 dim): `s_prop = max cos(mención, afirmaciones del comunicado)`, `s_adv = max cos(mención, afirmaciones adversarias)`. La mención "adopta" si `s_prop − s_adv ≥ δ` **y** `s_prop ≥ τ` | Paráfrasis del **marco** sin copiar palabras | Cann 2023 (idea); τ y δ se calibran en ECO, no se copian |
| **AM-titular (LLM)** | Para titulares de prensa (pocos por día), un LLM con codebook: {marco propio, marco adversario, mixto o neutral}, con justificación, 3 corridas y voto mayoritario | Lo que más importa: **el titular** | Pangakis 2023; Gilardi 2023 |

**Indicadores derivados.**

- **Cuota de marco** = `AM_prop / (AM_prop + AM_adv)`, en prensa y en redes por separado.
- **ΔAM** = la cuota en las 72 h posteriores menos la cuota en las 72 h anteriores.
- `AM-literal` alto con `AM-titular` adverso = "copian el dato, pero titulan con el marco ajeno". Es una lectura útil para el asesor.

**Validación.**

1. Codificar a mano 300 menciones de prensa estratificadas: comunicados reales, 3–5 agencias, varios meses. Dos codificadores; **α de Krippendorff ≥ 0.667** antes de usar el gold (≥ 0.80 si se va a reportar al cliente; umbrales de Krippendorff, [ATLAS.ti](https://doc.atlasti.com/ManualWin/ICA/ICASampleSizeAndDecisionRules.html) [copyright — solo resumir]).
2. Elegir τ y δ con la curva precisión-cobertura, **priorizando precisión ≥ 0.8**: es peor decir "adoptaron nuestro marco" cuando no lo hicieron.
3. Reportar F1 por clase del LLM juez. Si la F1 de "marco adversario" es menor de 0.7, el juez no se usa para esa clase.
4. Recalibrar cada trimestre o al cambiar de modelo.

**Coste.**

- 7-gramas y frases: SQL o Python baratos.
- Semántica: los embeddings ya existen; solo se comparan con pocas afirmaciones (k ≤ 10).
- LLM: solo titulares de prensa, decenas al día por agencia.

---

## 4. Comportamiento coordinado

### 4.1 Lo que dice la ciencia

- **Pacheco et al. (2021, ICWSM).** [MÉTODO]
  - Pasos: trazas compartidas → red bipartita cuenta × rasgo (TF-IDF) → proyección por coseno → poda de aristas → componentes conectados.
  - Umbrales de sus casos:
    - co-retuit: ≥ 10 retuits por cuenta y conservar el **0.5 % superior** de aristas;
    - acciones sincronizadas: franjas de 30 min, ≥ 8 tuits, 0.5 % superior.
  - **Priorizan minimizar los falsos positivos sobre la cobertura.** Advierten que lo orgánico puede parecer coordinado (por ejemplo, botones de "compartir" de un medio).
  - Coordinación ≠ inautenticidad, y la mayoría de cuentas coordinadas no parecía bot.
  - Recomiendan revisar a mano cada clúster. Proponen un modelo nulo por permutación, sin implementarlo.
  - [arXiv 2001.05658](https://arxiv.org/abs/2001.05658) [acceso abierto].
- **Schoch, Keller, Stier y Yang (2022), *Scientific Reports* 12:4572.** [EVIDENCIA-OBS]
  - En las campañas de astroturfing publicadas por Twitter, en promedio el **74 %** de las cuentas hizo co-tuit o co-retuit.
  - Ventana preferida: **1 minuto**, con **~1 % de falsos positivos** entre usuarios comunes de comparación.
  - Los falsos positivos solo crecen al relajar mucho la ventana; consideran razonable **menos de 8 horas**.
  - Co-tuit + co-retuit detecta mejor que el retuit simple, que da más falsos positivos.
  - **Una campaña genuina de base mostró niveles de coordinación similares a las muestras aleatorias**: es la línea base contra la que comparar.
  - [Nature](https://www.nature.com/articles/s41598-022-08404-9) [acceso abierto, CC BY 4.0].
- **Giglietto, Righetti, Rossi y Marino (2020), CooRnet.** [MÉTODO]
  - "Coordinated link sharing": estima a partir de los datos un **intervalo de coordinación** inusualmente corto para compartir la misma URL, y exige **repetición**.
  - El paquete está archivado porque dependía de CrowdTangle. Alternativas: CooRTweet (R) y coordination-network-toolkit (Python).
  - [GitHub](https://github.com/fabiogiglietto/CooRnet); paper en SMSociety 2020, DOI 10.1145/3400806.3400817 [copyright — solo resumir].
- **Panayiotou, Mannocci y Tesconi (arXiv, sep-2026).** [MÉTODO] La **longitud** de la ventana temporal decide qué patrones de coordinación se ven; el paso de la ventana apenas influye. Elegir la ventana sigue siendo un problema abierto. — [arXiv 2609.21959](https://arxiv.org/abs/2609.21959) [acceso abierto].

### 4.2 Indicador propuesto: Co-publicación Coordinada (CC)

[INFERENCIA ECO]

**Definición.**

1. **Evento de co-publicación:** dos autores **distintos**, de la misma plataforma, publican el mismo `text_hash` o la misma URL normalizada (`original_url`) con |Δt| ≤ **60 s**.
   - Variante semántica: coseno de embeddings ≥ 0.97 para cubrir plantillas con variaciones mínimas.
2. **Excluir:**
   - `page_type` de prensa (la sindicación de cables es legítima);
   - cuentas oficiales de gobierno y medios;
   - los retuits o shares nativos, si `pub_type` los distingue.
3. **Arista** autor–autor = número de eventos distintos en 30 días. Conservar las aristas con **≥ 3 eventos en ≥ 2 días distintos**: la repetición es lo que separa la coordinación de la coincidencia (CooRnet).
4. **Clúster** = componente conectado con ≥ 3 cuentas.
5. Indicador por narrativa: `CC(n)` = fracción de menciones de *n* emitidas por cuentas en clústeres CC.

**Umbral prudente.**

- Línea base = la `CC` de la propia agencia en 90 días: el ~1 % de falsos positivos de Schoch con 1 minuto es el orden esperado.
- Bandera "patrón coordinado" solo si `CC(n)` ≥ 3 veces la línea base **y** el clúster tiene ≥ 5 cuentas **y** un analista lo revisó.
- **Modelo nulo:** barajar las marcas de tiempo dentro de cada autor (permutación, como proponen Pacheco et al.) y exigir que el número observado de eventos supere el percentil 99 del nulo.

**Falsos positivos conocidos en ECO.**

- Botones de compartir de medios (el mismo titular y la misma URL al mismo tiempo).
- Programación de publicaciones de una misma organización con varias cuentas.
- Cadenas de "copia y pega" de ciudadanos indignados: coordinación **orgánica** (Schoch: las campañas genuinas coordinan poco, pero algo).
- Reingestas de Brandwatch con marcas de tiempo truncadas.

**Límite de cobertura.** ECO solo ve lo que cumple la query de Brandwatch, así que la **cobertura** de CC es baja. La ausencia de bandera **no** prueba la ausencia de coordinación.

**Lenguaje obligatorio** (`05` §3.6): "patrón coordinado observado en N cuentas". Nunca "bots", "granja" ni "campaña pagada" sin prueba externa.

**Coste.** Autojoin por `text_hash` y URL dentro de la agencia, en ventana de 60 s: índice por (`agency_id`, `text_hash`, `published_at`). Barato, cada hora.

---

## 5. Predicción temprana de escalada

### 5.1 Lo que dice la ciencia

- **Cheng, Adamic, Dow, Kleinberg y Leskovec (2014, WWW), "Can cascades be predicted?".** [EVIDENCIA-OBS]
  - Reformulan el problema: dado lo observado hasta *k* reacciones, ¿llegará la cascada a la mediana condicional (≈ 2k)? Las clases quedan balanceadas y el azar da 50 %.
  - Con k = 5: **exactitud 0.795, AUC 0.877**.
  - Los rasgos **temporales** son los mejores: ritmo en la segunda mitad de lo observado (0.73 solo) y tiempo hasta la 5.ª reacción (0.72). El estructural "algún adoptante temprano fuera de la red del autor" alcanzó 0.65.
  - La exactitud **sube con *k*** observado.
  - El tamaño exacto no se modela: con colas pesadas, la regresión se vuelve patológica.
  - [arXiv 1403.4608](https://arxiv.org/abs/1403.4608) [acceso abierto].
- **Szabo y Huberman (2010).** [EVIDENCIA-OBS] En escala logarítmica, la popularidad temprana y la tardía están muy correlacionadas.
  - En Digg, 2 h predicen 30 días; en YouTube hacen falta unos 10 días.
  - Se predice mejor cuando la atención decae rápido.
  - **Línea base obligatoria:** extrapolación log-lineal. — [arXiv 0811.0405](https://arxiv.org/abs/0811.0405) [acceso abierto].
- **SEISMIC (Zhao et al., KDD 2015).** [MÉTODO] Proceso de Hawkes autoexcitado. Estima la "infecciosidad" de una publicación con solo marcas de tiempo y grados de seguidores, sin entrenamiento. En ECO solo se puede aproximar, usando `potential_audience` como grado. — [arXiv 1506.02594](https://arxiv.org/abs/1506.02594) [acceso abierto].
- **Crane y Sornette (2008, *PNAS*).** [EVIDENCIA-OBS] En ~5 millones de videos de YouTube, la relajación tras un pico cae en clases distintas según el choque:
  - **exógeno** (noticia externa): subida brusca y decaimiento rápido;
  - **endógeno** (contagio boca a boca): subida y bajada más lentas.
  - [PMC2572957](https://pmc.ncbi.nlm.nih.gov/articles/PMC2572957) [acceso abierto].
- **Weng et al. (2013):** las comunidades tempranas añaden poder predictivo sobre los rasgos básicos (§2.1).
- **Lorenz-Spreen et al. (2019):** los temas viven horas, no días (§1).

### 5.2 Qué predecir en ECO y con qué horizonte

[INFERENCIA ECO]

| Pregunta (binaria, balanceable) | Horizonte | Unidad | Por qué |
|---|---|---|---|
| P1. ¿La narrativa **duplicará** sus menciones acumuladas? | 24 h | narrativa | Formulación de Cheng; la vida típica es de horas |
| P2. ¿La narrativa **entrará en prensa** (primer medio de PR)? | 72 h | narrativa sin prensa todavía | Es el salto que cambia el nivel (`05` §1.5) |
| P3. ¿El índice de crisis V5 de la agencia alcanzará la banda **ALERTA (≥ 0.40)**? | 72 h | agencia-día | Resultado operativo que ya existe |
| P4. ¿Persistirá: menciones de 48–72 h ≥ 30 % de las de 0–24 h? | 72 h | narrativa | Distingue un choque exógeno que se apaga de una conversación que se sostiene (Crane y Sornette) |

**Rasgos** (calculados en el momento *t*, sin mirar al futuro):

- **Temporales:** log del volumen en 1, 6 y 24 h; razón de crecimiento entre las últimas 6 h y las 6 h previas; tiempo hasta la k-ésima mención (k = 5, 10, 20); aceleración de negativas (derivada de la velocidad V5).
- **Composición:** proporción negativa; proporción de **ira**; proporción de referencias al exogrupo (diccionario local de PR: partidos, figuras, "el gobierno anterior"…); densidad de lenguaje moral-emocional.
- **Comunidad:** `PC_k`, `PC_H`, `PC_out`, `PC_eco`, `PC_nuevos` (§2).
- **Amplificación:** fracción del alcance que aporta el autor de mayor alcance ("mayor emisión", Goel); número de autores con alcance en el percentil 99.
- **Otros:** `CC(n)` (§4); novedad = 1 − coseno máximo del centroide contra las narrativas de los 60 días previos (Vosoughi: lo novedoso se comparte más); hora y día de la semana.

**Modelos, de menor a mayor complejidad.**

1. **Clima:** la tasa base de la agencia.
2. **Szabo-Huberman:** regresión de log(volumen final) sobre log(volumen temprano).
3. **Regresión logística** con los rasgos de arriba.
4. Gradient boosting **solo si** mejora el Brier fuera de muestra.

**Validación temporal ("rolling origin"):** entrenar hasta el mes *m*, evaluar en *m+1*, sin barajar. Las menciones de una misma narrativa nunca se reparten entre entrenamiento y prueba.

**Calibración.** Isotónica, o Platt si hay pocos eventos, sobre un bloque de validación posterior al entrenamiento.

- Niculescu-Mizil y Caruana (ICML 2005): los modelos de boosting distorsionan las probabilidades en forma de sigmoide, y estas dos técnicas las corrigen. — [ML Anthology](https://mlanthology.org/icml/2005/niculescumizil2005icml-predicting) [acceso abierto].
- **Expectativa realista** [INFERENCIA ECO]: AUC de 0.75–0.85 para P1, si ECO se parece a Cheng. P2 y P3 serán más difíciles: pocos eventos positivos por agencia y cobertura parcial.

**Coste.** Rasgos por SQL cada hora; el modelo se entrena cada mes en minutos. La inferencia es trivial.

---

## 6. Calibración y evaluación de pronósticos

### 6.1 Reglas de puntuación y diagramas

- **Gneiting y Raftery (2007, *JASA* 102).** [MÉTODO] Marco de reglas de puntuación **estrictamente propias**: las que premian decir la probabilidad que de verdad se cree.
  - El **interval score** evalúa un intervalo por su ancho más una penalización si la observación cae fuera.
  - El **CRPS** generaliza el error absoluto a distribuciones completas.
  - [DTIC](https://apps.dtic.mil/sti/pdfs/ADA454828.pdf) [copyright — solo resumir].
- **Bracher, Ray, Gneiting y Reich (2021).** [MÉTODO] **Weighted interval score (WIS)**: combina varios intervalos o cuantiles, aproxima el CRPS y se descompone en dispersión, sobrepredicción e infrapredicción. Es el estándar de los hubs de pronóstico epidémico. — [arXiv 2005.12881](https://arxiv.org/abs/2005.12881) [acceso abierto].
- **Brier y log score.** [MÉTODO estándar] Brier = media de (p − o)². Log score = −log p(resultado observado); castiga mucho la sobreconfianza.
  - **Ojo:** en eventos raros, el Brier "bueno" no es 0.25 (moneda al aire) sino el de la **climatología**, p·(1−p). Si la tasa base es 10 %, el clima ya da 0.09.
  - Reportar siempre el **Brier skill score** frente al clima y frente a la persistencia.
- **Diagrama de fiabilidad.** Agrupar los pronósticos en bins de probabilidad y comparar la frecuencia observada con la media pronosticada. [INFERENCIA ECO] Con menos de ~100 pronósticos resueltos, los bins son ruido: leer la tendencia, no cada punto.

### 6.2 Clase de referencia ("outside view")

- **Lovallo y Kahneman (2003, *HBR*):** los ejecutivos sobrestiman beneficios y subestiman costos porque razonan "desde dentro" del caso. El remedio es anclarse primero en la distribución de casos similares, la **clase de referencia**, y ajustar después.
  - Flyvbjerg añadió que también hay sesgo **deliberado** en los pronósticos.
  - [arXiv, comentario de Flyvbjerg](https://arxiv.org/abs/1305.0741) [acceso abierto]; [McKinsey, entrevista a Lovallo](https://www.mckinsey.com.br/capabilities/strategy-and-corporate-finance/our-insights/how-to-take-the-outside-view) [copyright — solo resumir].
- **[INFERENCIA ECO] En ECO**, la clase de referencia es concreta y calculable:
  - Recuperar las *k* = 20–50 narrativas históricas más parecidas: coseno de centroide, misma agencia o agencias afines, tamaño y edad similares, mismos `PC_k` y proporción de ira.
  - Reportar su desenlace. Ejemplo: "de 31 narrativas similares, 6 entraron en prensa en 72 h y 2 llegaron a ALERTA".
  - El asesor debe **empezar por ese número**.

### 6.3 LLM como pronosticadores

- **Halawi, Zhang, Yueh-Han y Steinhardt (2024).** [EVIDENCIA-EXP]
  - Sistema con recuperación de noticias, fine-tuning y conjunto de 66 pronósticos agregados con **media recortada**.
  - En 914 preguntas posteriores al corte del modelo: **Brier 0.179** frente a **0.149** de la multitud humana. GPT-4 sin ayuda: 0.208.
  - Promediado con la multitud (4:1 a favor de la multitud): 0.146.
  - Solo superó a la multitud cuando esta dudaba (0.3–0.7) y había ≥ 5 artículos relevantes.
  - **Se cubre hacia probabilidades medias** incluso cuando la evidencia ya es decisiva, algo que los autores atribuyen al entrenamiento de seguridad.
  - Los modelos base estaban mal calibrados; la recalibración isotónica no le ayudó al sistema final.
  - [arXiv 2402.18563](https://arxiv.org/abs/2402.18563) [acceso abierto].
- **Schoenegger, Tuminauskaite, Park y Tetlock (2024, *Science Advances*).** [EVIDENCIA-EXP]
  - Un conjunto de 12 LLM en 31 preguntas binarias no difirió estadísticamente de 925 pronosticadores humanos.
  - Las predicciones medias de los modelos fueron **significativamente mayores al 50 %** aunque los resultados se repartieron casi a mitades: **sesgo de aquiescencia**.
  - Ver la mediana humana mejoró a los modelos entre 17 y 28 %, pero menos que promediar humano y máquina.
  - [arXiv 2402.19379](https://arxiv.org/abs/2402.19379) [acceso abierto, CC BY-NC].
- **Matiz: la dirección del sesgo depende del contexto.** Braun (EMNLP Findings 2025): en tareas de respuesta en inglés, varios LLM se inclinaron hacia el "no". Conclusión: **medir el sesgo en nuestro propio historial**, no suponer su dirección. — [arXiv 2509.08480](https://arxiv.org/abs/2509.08480) [acceso abierto].
- **ForecastBench (Karger et al., ICLR 2025).** [EVIDENCIA-OBS] Benchmark dinámico de preguntas sin respuesta conocida.
  - En octubre de 2025, superpronosticadores **0.081** frente al mejor LLM, **0.101** (Brier ajustado por dificultad).
  - El instituto proyectaba paridad hacia noviembre de 2026 (IC 95 %: dic-2025 a ene-2028).
  - Advirtió que un modelo copiaba los precios de mercado incluidos en su prompt.
  - ⚠ No se verificó si la paridad ocurrió.
  - [ICLR](https://proceedings.iclr.cc/paper_files/paper/2025/hash/ea74e45a229dac70b5b63b28d8934db6-Abstract-Conference.html) [acceso abierto]; [FRI, 8-oct-2025](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark) [copyright — solo resumir].

**[INFERENCIA ECO] Consecuencias de diseño.**

1. La probabilidad numérica de escalada sale del **modelo estadístico calibrado** (§5), no del LLM.
2. Si en algún punto el LLM debe dar una probabilidad (por ejemplo, de que la Legislatura cite al secretario):
   - ≥ 5 muestras con temperatura > 0 y **media recortada**;
   - preguntar en las **dos polaridades** ("¿escalará?" / "¿se apagará?") y promediar p con 1 − p′ para neutralizar la aquiescencia;
   - recalibrar con el historial.
3. El LLM **sí** aporta: la clase de referencia (§6.2), la lectura cualitativa y los escenarios. Siempre muestra el número del modelo junto a su razonamiento, nunca lo sustituye.

### 6.4 Contrafactuales: evaluar cuando solo vemos el camino elegido

- **CausalImpact / BSTS (Brodersen et al. 2015, *Annals of Applied Statistics* 9(1)).** [MÉTODO] Un modelo de series de tiempo bayesiano estructural construye el "qué habría pasado" con covariables **no afectadas** por la intervención, y estima el efecto a lo largo del tiempo con intervalos creíbles. — [arXiv 1506.00356](https://arxiv.org/abs/1506.00356) [acceso abierto].
- **Control sintético (Abadie 2021, *J. Economic Literature* 59(2)).** [MÉTODO] Es fiable con un periodo previo largo, buen ajuste previo, unidades donantes sin contagio y sin choques concurrentes. Aplicado sin mirar el contexto, engaña. — [NBER PDF](https://conference.nber.org/confer/2021/SI2021/Abadie_2021.pdf) [copyright — solo resumir].
- **Emparejar por tamaño (Juul y Ugander 2021).** [MÉTODO] Comparar cascadas de distinto tamaño produce diferencias espurias; hay que emparejar por tamaño antes de comparar mecanismos (§1).

**[INFERENCIA ECO] Protocolo de evaluación contrafactual, de más barato a más caro:**

1. **Pronóstico "sin acción" prerregistrado.** Antes de responder, el asesor guarda la predicción del modelo (§5) de la trayectoria de negativas en 24 y 72 h, con su intervalo del 80 %. Después se compara lo observado con ese intervalo. "Efecto" = observado − predicho. Si lo observado cae **dentro** del intervalo, no hay evidencia de efecto: decirlo así.
2. **BSTS con controles:** como covariables, las negativas de agencias no involucradas y el volumen total de la conversación pública de PR (para absorber el ciclo de noticias del día).
3. **Control sintético entre agencias:** con 13 agencias previstas hay un pool de donantes, pero hay contagio (la gobernadora y las agencias comparten conversación). Usarlo solo para crisis **específicas** de una agencia, con ≥ 8 semanas de periodo previo.
4. **Diferencias en diferencias ligeras entre narrativas:** comparar narrativas respondidas con no respondidas **emparejadas** por edad, tamaño, `PC_k` y proporción de ira en el momento de la decisión. Sesgo inevitable: se responde a las peores. Reportarlo como asociación, no como causa.
5. **Clase de referencia** (§6.2): "en crisis similares en que no se respondió, la mediana de duración fue X h".

---

## 7. Clasificación de atribución de responsabilidad y de "outrage"

### 7.1 Estado del arte

- **No se encontró ningún clasificador validado que mapee texto de redes a los clústeres de la SCCT** (víctima / accidental / prevenible) ni a los factores de indignación de Sandman. [Hallazgo de esta búsqueda; ausencia de evidencia, no prueba de ausencia]
- **Lo más cercano:**
  - "Atribución" como tarea de PLN: un estudio sobre la crisis del agua de Chennai (EMNLP 2020) etiquetó a quién culpan 72,098 comentarios de YouTube, con ~87 % de exactitud en detección. Es otro idioma y otra crisis, pero demuestra que la tarea se puede aprender. — [ACL Anthology 2020.emnlp-main.109](https://preview.aclanthology.org/setup/2020.emnlp-main.109) [acceso abierto].
  - El **marco de atribución de responsabilidad** (Semetko y Valkenburg) en noticias: hay codebooks con preguntas binarias y modelos BERT entrenados ([arXiv 2409.00272](https://arxiv.org/abs/2409.00272) [acceso abierto]). Pero GPT-3.5 en zero-shot **falló por completo** en esta clase (§3.1, Alonso del Barrio 2024).
  - **Indignación moral:** Brady, McLoughlin, Doan y Crockett (2021, *Science Advances*) entrenaron un clasificador de moral outrage y lo aplicaron a 12.7 millones de tuits. La retroalimentación social (likes, retuits) aumenta la expresión futura de indignación. — [PMC8363141](https://pmc.ncbi.nlm.nih.gov/articles/PMC8363141) [acceso abierto].
  - **Sandman:** "riesgo = peligro + indignación". Lista de más de 20 factores de indignación: voluntariedad, control, justicia, confianza, apertura o secretismo, memorabilidad, etc. Según su sitio, la correlación entre peligro técnico e indignación es de solo ~0.2. No hay operacionalización computacional. — [psandman.com](https://psandman.com/articles/risk.htm) [copyright — solo resumir].

### 7.2 Cómo construirlo con LLM y validación humana

[INFERENCIA ECO apoyada en Pangakis 2023, Krippendorff y Geiß 2021]

1. **Codebook** (una página por variable, con ejemplos de PR):
   - **A. Blanco de la culpa:** {agencia monitoreada, otro gobierno (federal o municipal), empresa o contratista, naturaleza/azar, el propio ciudadano, nadie o no aplica}.
   - **B. Clúster SCCT percibido** (solo si A = agencia): {víctima, accidental, prevenible}.
   - **C. Factores de Sandman presentes** (multi-etiqueta, los 6 más observables en texto): {impuesto / no voluntario, fuera de control del ciudadano, injusto o desigual, desconfianza en la institución, secretismo o falta de información, memorable o simbólico}.
   - **D. Indignación moral** (sí/no), con la definición de Brady 2021.
2. **Muestra gold:**
   - **400 menciones** estratificadas por agencia, plataforma y sentimiento, sobremuestreando las negativas. Pangakis recomienda 250–1,250; con clases raras (< 5 %) se necesita más para estimar su F1.
   - **Dos codificadores** independientes. Calcular α de Krippendorff por variable: **≥ 0.667 para usarla, ≥ 0.80 para reportarla al cliente**.
   - Si la α humana no alcanza, la variable está mal definida: rehacer el codebook **antes** de culpar al modelo.
   - Geiß (2021, *Computational Communication Research*) muestra con simulación que esos umbrales sirven en los casos comunes, pero que muestras pequeñas o efectos pequeños exigen más acuerdo. — [CCR 3(1)](https://aup-online.com/content/journals/10.5117/CCR2021.1.003.GEIS) [acceso abierto].
3. **LLM:**
   - Bedrock con tool-use y `input_schema` (regla del repo: nada de JSON en texto libre).
   - Temperatura 0.6, **3 corridas** y voto mayoritario; guardar la consistencia, porque las etiquetas consistentes son ~19 puntos más exactas (Pangakis).
   - Ajustar el codebook una sola vez con la mitad del gold; evaluar con la otra mitad.
4. **Criterio de uso:**
   - F1 por clase ≥ 0.70 → usar en agregados.
   - F1 entre 0.5 y 0.7 → solo como indicio con advertencia.
   - F1 < 0.5 → no usar.
5. **Usar proporciones corregidas, no conteos crudos** [MÉTODO estándar de "cuantificación"]: `p_corr = (p_obs − FPR) / (TPR − FPR)`, con TPR y FPR del gold. Así una proporción "40 % culpa a la agencia" no hereda el sesgo del clasificador.
6. **Recalibrar** cada trimestre, y siempre que cambie el modelo o entre una agencia nueva (20–30 menciones gold de esa agencia como verificación de deriva).

**Coste.** Etiquetado humano único: unas 8–12 horas-persona por cada 400 menciones y 2 codificadores. LLM: solo menciones negativas y pertinentes de narrativas activas, del orden de cientos al día por agencia, con modelo ligero.

---

## 8. Especificación de señales nuevas para ECO

[INFERENCIA ECO salvo la columna "Fuente". Los umbrales son **iniciales**: se recalibran con el backtest antes de entrar en las reglas de escalada.]

| # | Señal | Definición operativa con datos de ECO | Fuente científica | Umbral inicial sugerido | Cómo validarla | Coste |
|---|---|---|---|---|---|---|
| S1 | **Alarma de coincidencia total + negativo** | Por agencia y por narrativa, conteos horarios de menciones pertinentes no duplicadas (total y negativas). Umbral superior por Farrington-Noufaily (GLM cuasi-Poisson con tendencia, últimos n periodos comparables). Alarma = total > T_all **y** negativo > T_neg | Drasch et al. 2015; Pfeffer et al. 2014 | Δt = 1 h (los volúmenes de PR son bajos), n = 30, α = 0.05; probar α = 0.01 | Backtest de más de 480 días en DDEC: falsas alarmas por mes (meta ≤ 2) y adelanto frente al índice V5 en incidentes etiquetados | Bajo (SQL + GLM pequeño por hora) |
| S2 | **Fase de la curva** | Pendiente de log(negativas) en las últimas 6 h frente a las 6 h previas; clases: ascenso / meseta / descenso. Opcional: razón tiempo de subida / tiempo de bajada tras el pico | Lorenz-Spreen 2019; Crane y Sornette 2008; MDPI 2025 (`05` §1.2) | Ascenso si la pendiente > 0 con IC 80 % fuera de 0 | Concordancia con la etiqueta humana de fase en 100 episodios | Muy bajo |
| S3 | **Penetración de comunidades** (`PC_k`, `PC_H`, `PC_out`, `PC_eco`, `PC_nuevos`) | §2.3: Leiden semanal sobre la proyección TF-IDF autor × narrativa (90 días); medidas por narrativa en 24 h | Weng et al. 2013; Pacheco et al. 2021; Traag et al. 2019 | "Cruce": `PC_k` +2 en 24 h y `PC_out` ≥ 0.5, por encima del p90 de narrativas de igual edad y tamaño | AUC con y sin estos rasgos para P1 y P2 (§5) | Medio: Leiden semanal en Python; métricas horarias en SQL |
| S4 | **Salto a prensa** | Primera mención de un dominio de la lista curada de medios de PR en una narrativa nacida en redes. Origen social si la fracción de volumen social > 24 h antes de la mediana del volumen de prensa está entre 0.15 y 0.5 | Leskovec et al. 2009; Pfeffer et al. 2014 (interacción entre medios) | Cualquier salto = señal; ≥ 2 medios en 24 h = señal fuerte | Medir la tasa base propia de saltos; revisar 50 casos a mano | Muy bajo |
| S5 | **Ira e indignación** | Proporción de `ira` en `nlp_emotions` entre las negativas y su cambio en 24 h. Opcional: clasificador de indignación moral (§7) | Fan et al. 2014 (`05`); Brady 2017/2021; Herhausen 2019 | Ira ≥ 1.5 veces su línea base de 30 días **y** ≥ 30 % de las negativas | Gold de 400 menciones (§7); F1 de "ira" ≥ 0.7 | Bajo (ya existe); medio si se añade el clasificador |
| S6 | **Exogrupo político** | Proporción de menciones con referencia a un adversario político (diccionario de PR: partidos, figuras, "gobierno anterior", "colonialismo", etc., revisado cada trimestre) | Rathje et al. 2021 | ≥ 2 veces la línea base | Precisión del diccionario en 200 menciones ≥ 0.8 | Muy bajo |
| S7 | **Co-publicación coordinada** (`CC`) | §4.2: mismo `text_hash` o URL entre autores distintos en ≤ 60 s, ≥ 3 eventos en ≥ 2 días; clústeres ≥ 3 cuentas; prensa excluida | Schoch et al. 2022; Pacheco et al. 2021; Giglietto et al. 2020 | `CC(n)` ≥ 3 veces la línea base, clúster ≥ 5 cuentas, nulo por permutación < p99, **revisión humana** | Precisión estimada por revisión de cada clúster; meta ≥ 0.8 | Bajo |
| S8 | **Concentración de la amplificación** | Fracción del alcance (`reach_estimate`) que aporta el autor n.º 1 de la narrativa; número de autores en el p99 de alcance | Goel et al. 2016 (la mayor emisión explica la popularidad) | > 0.5 = "depende de un actor" (respuesta dirigida); < 0.2 con volumen alto = "difusa" | Correlación con P1 en el backtest | Muy bajo |
| S9 | **Novedad de la narrativa** | 1 − coseno máximo del centroide frente a las narrativas de los 60 días previos | Vosoughi et al. 2018 (novedad) | > p80 de la agencia = "tema nuevo" | Aporte al AUC de P1 | Muy bajo (pgvector) |
| S10 | **Adopción del marco** (`AM-literal`, `AM-frases`, `AM-semántica`, `AM-titular`, cuota de marco, ΔAM) | §3.2; requiere la tabla de comunicados y, opcionalmente, las afirmaciones adversarias | Nicholls 2019; Monroe et al. 2008; Cann et al. 2023; Pangakis 2023 | Literal > 5 % de 7-gramas; τ y δ calibrados para precisión ≥ 0.8; ΔAM ≥ +10 pp = "el marco entra" | 300 menciones de prensa codificadas, α ≥ 0.667, F1 por clase | Bajo a medio (LLM solo para titulares) |
| S11 | **Atribución y factores de indignación** | §7.2: blanco de la culpa, clúster SCCT, factores de Sandman; proporciones corregidas | SCCT (Coombs, ver `01`); Sandman; Pangakis 2023; trabajo de atribución de EMNLP 2020 | Culpa a la agencia ≥ 40 % y "prevenible" ≥ 50 % de esa culpa → recomendar postura de reconstrucción (SCCT) | Gold de 400, α ≥ 0.667, F1 ≥ 0.7 por clase | Medio (LLM sobre negativas pertinentes) |
| S12 | **Probabilidad de escalada** (P1–P4) | §5.2: logística calibrada (isotónica) con S1–S9 como rasgos; clase de referencia (k vecinos) como contexto | Cheng et al. 2014; Szabo y Huberman 2010; Weng 2013; Niculescu-Mizil y Caruana 2005 | Mostrar siempre p y la tasa base; "alta" si p ≥ 2 veces la tasa base y p ≥ 0.3 | Brier skill score > 0 frente a clima y frente a Szabo-Huberman; fiabilidad (§9) | Bajo (entrenamiento mensual) |

**Regla de transición queja → crisis, operativa** (de `05` §2.2): S1 activa **y** al menos dos de {S3 cruce, S4 salto a prensa, S5 ira} **y** S2 en ascenso → nivel 2. A partir de ahí, S12 informa la urgencia y S7 y S11 informan el tipo de respuesta.

**Lo que ECO no puede medir** (declararlo siempre):

- Viralidad estructural, por la falta de árboles de difusión.
- Comunidades por grafo social real.
- WhatsApp, radio y TV no transcritas.
- Coordinación fuera de la query de Brandwatch.

---

## 9. Métricas y protocolo de calibración del asesor

[INFERENCIA ECO sobre los métodos de §6]

### 9.1 Qué pronostica el asesor, siempre de forma verificable

| Tipo | Ejemplo | Formato obligatorio | Regla de puntuación |
|---|---|---|---|
| Binario | "¿La narrativa X entrará en prensa en 72 h?" | Probabilidad (2–98 %) + tasa base de la clase de referencia | Brier y log score; BSS frente al clima |
| Nivel | "Nivel en 24 h: 0/1/2/3" | Distribución sobre los 4 niveles | Ranked probability score (RPS, la versión ordinal del Brier) |
| Cantidad | "Negativas en las próximas 72 h" | Mediana + intervalos del 50 % y del 80 % | Interval score / WIS; cobertura empírica |
| Contrafactual | "Sin respuesta, las negativas seguirían entre A y B" | Intervalo del 80 % guardado **antes** de actuar | Cobertura; efecto = observado − predicho (§6.4) |

**Criterio de resolución escrito de antemano** en cada pronóstico: fuente, ventana y umbral exactos. Si no se puede resolver, no es un pronóstico.

### 9.2 Registro de pronósticos (ledger)

- Tabla `advisor_forecasts`: `id`, `agency_id`, `narrative_id`, `created_at`, `question`, `resolution_rule`, `horizon_h`, `p` o `quantiles`, `reference_class_rate`, `model_version`, `llm_version`, `features_snapshot` (jsonb), `resolved_at`, `outcome`.
- **Inmutable** tras crearse. Las revisiones son pronósticos nuevos que enlazan al anterior.
- La resolución es automática siempre que sea posible (S4 y V5 son medibles); si no, la marca un analista con justificación.

### 9.3 Métricas del tablero de calidad del asesor

1. **Brier skill score** frente a (a) el clima de la agencia y (b) la persistencia ("lo que pasa ahora seguirá"). Meta inicial: BSS > 0 en ambos.
2. **Diagrama de fiabilidad** con 5 bins (0–20 %, …, 80–100 %) y el número de casos por bin. Solo se interpreta con ≥ 100 pronósticos resueltos; antes, reportar la **calibración en grande**: media pronosticada frente a frecuencia observada.
3. **Sesgo de aquiescencia:** media de p frente a la tasa observada, para los pronósticos que generó el LLM. Si la diferencia es > 5 pp, aplicar la doble polaridad (§6.3) y recalibrar.
4. **Cobertura de intervalos:** el 80 % debe contener la observación en 75–85 % de los casos. Por debajo = sobreconfianza; por encima = intervalos inútiles por anchos.
5. **Discriminación:** AUC para P1–P4. Por debajo de 0.65, el pronóstico no se muestra al cliente.
6. **Tasa de falsas alarmas** de S1 y del nivel 2+: por mes y por agencia. Es la métrica que más erosiona la confianza (Drasch).
7. **Adelanto:** horas entre la primera alarma y el primer medio de PR o el pico del V5, en los incidentes reales.

### 9.4 Protocolo

1. **Fase 0, backtest** (antes de mostrar nada): reconstruir rasgos y pronósticos con datos históricos de DDEC y de las agencias con más de 6 meses, sin mirar al futuro. Reportar BSS, AUC, cobertura y falsas alarmas.
2. **Fase 1, sombra** (8–12 semanas): el asesor pronostica y registra, pero los pronósticos **no** se muestran al cliente. Revisión quincenal.
3. **Fase 2, visible con etiqueta**: mostrar la probabilidad junto a la tasa base y la etiqueta "pronóstico experimental", solo para preguntas con AUC ≥ 0.65 y BSS > 0 en sombra.
4. **Recalibración** mensual (isotónica sobre los últimos 6 meses) y revisión trimestral del codebook y los umbrales.
5. **Reglas de humildad**, en todas las salidas:
   - empezar por la clase de referencia;
   - dar un rango, no un punto;
   - nombrar los puntos ciegos (§8);
   - no presentar como causal el efecto de una respuesta sin el contrafactual prerregistrado (§6.4).
6. **Separar la calidad de la decisión de la del resultado.** Una buena recomendación puede salir mal por azar. La evaluación de recomendaciones mira si siguieron las reglas y la evidencia vigentes (`05` §9), y la de pronósticos mira la calibración. No mezclarlas.

---

## 10. Lagunas y verificación pendiente

- Los **factores de Pfeffer et al. (2014)** se verificaron solo por fuentes secundarias.
- **Chesney y Citron:** no se leyó el texto primario.
- **ForecastBench:** se desconoce si la paridad LLM-superpronosticadores proyectada para nov-2026 ocurrió.
- **Cann et al. 2023:** el umbral 0.7 y el modelo de embeddings no se confirmaron en el texto.
- No se halló un **clasificador validado de la SCCT ni de los factores de Sandman**. La propuesta de §7 es diseño propio.
- **CooRnet:** no se confirmaron los valores por defecto de su intervalo de coordinación (archivo de código no leído).
- No se encontró evidencia sobre el **rendimiento de la detección de comunidades por co-participación temática** como sustituto del grafo de seguidores. La prueba propuesta en §2.3 (AUC con y sin) es la que lo decidirá.
- Todo lo marcado [INFERENCIA ECO] necesita el **backtest** de §9.4 antes de usarse en recomendaciones reales.

---

## 11. Fuentes

1. Vosoughi, Roy y Aral (2018). *Science* 359:1146. https://politics.media.mit.edu/papers/Vosoughi_Science.pdf [copyright — solo resumir]
2. Juul y Ugander (2021). *PNAS* 118(46). https://pmc.ncbi.nlm.nih.gov/articles/PMC8609637/ [acceso abierto]
3. Lorenz-Spreen et al. (2019). *Nature Communications* 10:1759. https://pmc.ncbi.nlm.nih.gov/articles/PMC6465266 [acceso abierto, CC BY 4.0]
4. Pfeffer, Zorbach y Carley (2014). *J. Marketing Communications* 20(1-2). https://portal.fis.tum.de/en/publications/understanding-online-firestorms-negative-word-of-mouth-dynamics-i/ [copyright — solo resumir]
5. Drasch, Huber, Panz y Probst (2015). ICIS. https://fim-rc.de/Paperbibliothek/Veroeffentlicht/455/wi-455.pdf [acceso abierto]
6. Wekwerth (tesis, U. Twente). https://essay.utwente.nl/79702/1/Wekwerth_MA_BMS-faculty.pdf [acceso abierto]
7. Leskovec, Backstrom y Kleinberg (2009). KDD. https://www.cs.cornell.edu/home/kleinber/kdd09-quotes.pdf [acceso abierto, copia de autor]
8. Brady et al. (2017). *PNAS* 114(28). https://pmc.ncbi.nlm.nih.gov/articles/PMC5514704 [acceso abierto]
9. Brady et al. (2025), replicación y metaanálisis (resumen institucional). https://www.kellogg.northwestern.edu/academics-research/research/detail/2025/estimating-the-effect-size-of-moral-contagion-in-online/ [copyright — solo resumir]
10. Burton, Cruz y Hahn (2021). *Nature Human Behaviour*. https://research.cbs.dk/en/publications/reconsidering-evidence-of-moral-contagion-in-online-social-networ/ [copyright — solo resumir]
11. Rathje, Van Bavel y van der Linden (2021). *PNAS* 118(26). https://pmc.ncbi.nlm.nih.gov/articles/PMC8256037/ [acceso abierto]
12. Chesney y Citron (2019). *California Law Review* 107:1753. https://papers.ssrn.com/abstract=3213954 [copyright — solo resumir]
13. Weng, Menczer y Ahn (2013). *Scientific Reports* 3:2522. https://pmc.ncbi.nlm.nih.gov/articles/PMC3755286 [acceso abierto, CC BY-NC-SA 3.0]
14. Goel, Anderson, Hofman y Watts (2016). *Management Science* 62(1). https://www.5harad.com/papers/twiral.pdf [copyright — solo resumir]
15. Traag, Waltman y van Eck (2019). *Scientific Reports* 9:5233. https://arxiv.org/abs/1810.08473 [acceso abierto, CC BY 4.0]
16. Pacheco et al. (2021). ICWSM. https://arxiv.org/abs/2001.05658 [acceso abierto]
17. Schoch, Keller, Stier y Yang (2022). *Scientific Reports* 12:4572. https://www.nature.com/articles/s41598-022-08404-9 [acceso abierto, CC BY 4.0]
18. Giglietto et al. (2020), CooRnet. https://github.com/fabiogiglietto/CooRnet [paper: copyright — solo resumir]
19. Panayiotou, Mannocci y Tesconi (2026). https://arxiv.org/abs/2609.21959 [acceso abierto]
20. Nicholls (2019). *International Journal of Communication* 13. https://ijoc.org/index.php/ijoc/article/view/9904 [acceso abierto]
21. MacLaughlin et al. (2020). ICWSM. https://ojs.aaai.org/index.php/ICWSM/article/view/7312 [acceso abierto]
22. Cann et al. (2023). https://arxiv.org/abs/2303.16694 [acceso abierto]
23. Monroe, Colaresi y Quinn (2008). *Political Analysis* 16(4). https://www.cambridge.org/core/journals/political-analysis/article/fightin-words-lexical-feature-selection-and-evaluation-for-identifying-the-content-of-political-conflict/81B3703230D21620B81EB6E2266C7A66 [copyright — solo resumir]
24. Card et al. (2015). ACL. https://aclanthology.org/P15-2072/ [acceso abierto]
25. Gilardi, Alizadeh y Kubli (2023). *PNAS*. https://arxiv.org/abs/2303.15056 [acceso abierto]
26. Pastorino, Sivakumar y Moosavi (2024). https://arxiv.org/abs/2402.11621 [acceso abierto]
27. Alonso del Barrio, Tiel y Gatica-Perez (2024). IMX. https://arxiv.org/html/2409.12561v1 [acceso abierto]
28. Jumle et al. (2024). https://arxiv.org/abs/2409.00272 [acceso abierto]
29. Pangakis, Wolken y Fasching (2023). https://arxiv.org/abs/2306.00176 [acceso abierto]
30. Cheng, Adamic, Dow, Kleinberg y Leskovec (2014). WWW. https://arxiv.org/abs/1403.4608 [acceso abierto]
31. Szabo y Huberman (2010). https://arxiv.org/abs/0811.0405 [acceso abierto]
32. Zhao et al. (2015), SEISMIC. KDD. https://arxiv.org/abs/1506.02594 [acceso abierto]
33. Crane y Sornette (2008). *PNAS* 105(41). https://pmc.ncbi.nlm.nih.gov/articles/PMC2572957 [acceso abierto]
34. Niculescu-Mizil y Caruana (2005). ICML. https://mlanthology.org/icml/2005/niculescumizil2005icml-predicting [acceso abierto]
35. Gneiting y Raftery (2007). *JASA* 102. https://apps.dtic.mil/sti/pdfs/ADA454828.pdf [copyright — solo resumir]
36. Bracher, Ray, Gneiting y Reich (2021). https://arxiv.org/abs/2005.12881 [acceso abierto]
37. Lovallo y Kahneman (2003), *HBR*; comentario de Flyvbjerg. https://arxiv.org/abs/1305.0741 [acceso abierto]; entrevista a Lovallo: https://www.mckinsey.com.br/capabilities/strategy-and-corporate-finance/our-insights/how-to-take-the-outside-view [copyright — solo resumir]
38. Halawi et al. (2024). https://arxiv.org/abs/2402.18563 [acceso abierto]
39. Schoenegger, Tuminauskaite, Park y Tetlock (2024). *Science Advances*. https://arxiv.org/abs/2402.19379 [acceso abierto, CC BY-NC]
40. Braun (2025). EMNLP Findings. https://arxiv.org/abs/2509.08480 [acceso abierto]
41. Karger et al. (2025), ForecastBench. ICLR. https://proceedings.iclr.cc/paper_files/paper/2025/hash/ea74e45a229dac70b5b63b28d8934db6-Abstract-Conference.html [acceso abierto]; FRI: https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark [copyright — solo resumir]
42. Brodersen et al. (2015). *Annals of Applied Statistics* 9(1). https://arxiv.org/abs/1506.00356 [acceso abierto]
43. Abadie (2021). *Journal of Economic Literature* 59(2). https://conference.nber.org/confer/2021/SI2021/Abadie_2021.pdf [copyright — solo resumir]
44. Brady, McLoughlin, Doan y Crockett (2021). *Science Advances* 7. https://pmc.ncbi.nlm.nih.gov/articles/PMC8363141 [acceso abierto]
45. "Social Media Attributions in the Context of Water Crisis" (EMNLP 2020). https://preview.aclanthology.org/setup/2020.emnlp-main.109 [acceso abierto]
46. Sandman, "Risk = Hazard + Outrage". https://psandman.com/articles/risk.htm [copyright — solo resumir]
47. Krippendorff, umbrales de α (documentación de ATLAS.ti). https://doc.atlasti.com/ManualWin/ICA/ICASampleSizeAndDecisionRules.html [copyright — solo resumir]
48. Geiß (2021). *Computational Communication Research* 3(1). https://aup-online.com/content/journals/10.5117/CCR2021.1.003.GEIS [acceso abierto]
49. LBJ School, sobre el dividendo del mentiroso. https://lbj.utexas.edu/how-deepfakes-will-make-us-question-everything-2020 [copyright — solo resumir]; KUOW: https://www.kuow.org/stories/people-are-trying-to-claim-real-videos-are-deepfakes-the-courts-are-not-amused [copyright — solo resumir]
