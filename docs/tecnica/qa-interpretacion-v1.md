# Arnés de calidad de la interpretación de ECO (v1)

Guía de uso del arnés que vive en `scripts/qa/`. Cubre el spec de interpretación (`spec-interpretacion-eco-v1.md`, secciones 6.4
y 13.1 a 13.5) y el paquete de trabajo WP-11 del plan. El README de `scripts/qa/` es la referencia rápida de comandos; este
documento explica **qué mide cada cosa, cómo leerla y dónde se equivoca**.

## 1. Para qué sirve

Antes de dar por buena la rúbrica v2 (clasificación) y el motor de redacción del correo, hay que poder repetir la medición del
laboratorio de octubre-noviembre 2026 con un solo comando, sobre los mismos conjuntos de oro, y obtener la misma tabla de
umbrales. El arnés hace tres cosas:

1. **Reproduce la tabla 6.4** del spec (producción vs rúbrica v2) clasificando de nuevo los conjuntos de oro con Bedrock.
2. **Evalúa las compuertas 13.2** (12 umbrales) y las imprime como `PASA`, `FALLA` o `N/D`.
3. **Prepara la revisión humana a ciegas** (13.5): la hoja de 48 menciones, la de 12 textos de correo y el cálculo de κ.

No es una prueba de CI: cuesta dinero (Bedrock) y, en dos pasos opcionales, lee producción. Se corre a mano antes de activar una
agencia, tras tocar un prompt o el motor, y de noche durante la sombra (WP-12).

## 2. Cómo correrlo

```bash
bash scripts/qa/run-all.sh --dry-run            # lista los pasos y el costo previsto; no llama a Bedrock ni a la base
bash scripts/qa/run-all.sh                      # perfil rápido, Sonnet: 184 llamadas, ~1.05 M tokens de entrada (~USD 4)
bash scripts/qa/run-all.sh --only ddec-classify --limit 20     # un subconjunto pequeño
bash scripts/qa/run-all.sh --cached             # cero costo: re-evalúa las corridas de referencia del 2-nov
bash scripts/qa/run-all.sh --full --with-db     # conjuntos completos + lecturas a producción (~1,700 llamadas, ~9.6 M tokens)
bash scripts/qa/run-all.sh --full --opus        # igual que el laboratorio original en DDEC y DF-162, varias veces más caro
bash scripts/qa/run-all.sh --human-labels mi-hoja.md   # con la hoja humana rellenada
```

Credenciales: `REPO_ENV=/ruta/al/.env` (también se busca `<repo>/.env` y, en un worktree, el `.env` del checkout principal).
Semilla de los muestreos: `--seed` (20261102). Tope duro de llamadas: `--max-calls` (700 rápido, 6000 completo).

Salida: `scripts/qa/out/run-<fecha>/` (ignorado por git) con `tabla-6.4.md`, `gates.*.json`, `runs/<conjunto>.json` (etiquetas por
mención, con un `.meta.json` que dice el modelo y la semilla) y `verdicts/` (veredicto del juez por texto).
El código de salida es 1 si alguna compuerta `FALLA`.

### Un paso a la vez

| Quiero… | Comando |
|---|---|
| clasificar un conjunto | `python3 scripts/qa/classify-lab.py --set ddec208 --out out/runs/ddec208.json [--limit 40] [--model opus]` |
| evaluar las corridas de un directorio | `python3 scripts/qa/eval-classification.py --runs out/runs` |
| evaluar las referencias del 2-nov | `python3 scripts/qa/eval-classification.py --cached` |
| juzgar los textos del correo | `python3 scripts/qa/compose-judge.py [--windows ddecpr_20261101] [--model opus] [--cached]` |
| juzgar un motor nuevo | `python3 scripts/qa/compose-judge.py --candidates dir:/ruta/a/salidas,base` |
| calibrar al juez | `python3 scripts/qa/compose-judge.py --ledger` |
| κ con la hoja humana | `python3 scripts/qa/human-kappa.py --sheet hoja.md` (o `--csv`) |
| resolución de padres | `python3 scripts/qa/parents.py` |
| rehacer el correo de cualquier día | `npx tsx scripts/qa/repro.ts --slug ddecpr --end 2026-10-31 [--llm]` |
| validar que `repro.ts` aún cuadra | `python3 scripts/qa/repro-check.py --window ddecpr_20261031` |

## 3. Qué mide cada script

### 3.1 `classify-lab.py` y `eval-classification.py` (clasificación)

`classify-lab.py` toma una mención de un conjunto de oro, arma el prompt de clasificación **de producción de esa fecha** (con la
sección de reglas de sentimiento sustituida por la rúbrica v2: postura hacia la agencia, `adverse_fact`, pertinencia de
comentarios; spec 6 y anexo A), lo manda a Bedrock con la herramienta `classify_mention` y guarda `sentiment`, `adverse_fact`,
`pertinence`, tópicos, emociones y municipios. Los prompts se verificaron idénticos, carácter por carácter, al laboratorio en las
1,479 menciones (208 + 867 + 404). La pista de Brandwatch se quita del prompt (la rúbrica v2 dice «decide solo por el texto»).

`eval-classification.py` compara esas etiquetas con los jueces y con las de producción. Definiciones:

| Medida | Cómo se calcula |
|---|---|
| Acuerdo con el juez (DF) | % de menciones donde `sentiment` = `sentimiento_hacia_df` del juez (postura del autor hacia el DF) |
| Precisión de negativos (DF) | de lo que el sistema marca `negativo`, % que el juez también ve negativo |
| NSS | (positivos − negativos) / total × 100 sobre el universo indicado; en DDEC-867 solo pertinencia alta o media |
| Acuerdo por tono (DDEC) | `sentiment` = `tone` del juez Opus; un «mixto» del juez cuenta como desacuerdo |
| «Positivos que el juez no ve positivos» | de las menciones que el sistema marca positivo, cuántas el juez no ve positivas por tono |
| Hecho adverso (DF) | acuerdo booleano de `adverse_fact` con `hecho_malo_para_df` del juez |
| Estabilidad | % de ids con la misma etiqueta en dos corridas con la misma configuración (sentimiento y pertinencia por separado; la compuerta usa el peor de los dos) |

Los umbrales del spec se calcularon sobre los conjuntos completos. Un `--limit` pequeño da cifras con ruido de varios puntos: se
marcan con `*` y no deben leerse como falla real (ver 5).

### 3.2 `compose-judge.py` (textos del correo)

Para cada una de las 6 ventanas (`fixtures/windows/`) un juez independiente y ciego recibe los **datos reales** de la ventana
(lista de hechos, muestras con fecha, y para cada comentario la fecha y el autor de su publicación original) y el texto del correo
(titular, párrafo, viñetas, insights). Descompone el texto en afirmaciones atómicas y marca cada una: `verdadera`,
`verdadera_pero_enganosa`, `exagerada`, `falsa`, `sin_respaldo` o `mal_fechada`. Además mide:

- **Dramatismo del titular** (0 = literal, 5 = tabloide) y **post viejo presentado como noticia del día** (sí/no).
- **Contradicciones entre bloques**.
- **Lint de código** (sin modelo): verbos y figuras de fuerza prohibidos (`aprieta`, `acorrala`, `se deslinda`, `bajo la lupa`…) y cifras
  que no salen de la lista de hechos de la ventana. «0 residuos» significa que no queda ninguno en el texto final.

Definiciones de las compuertas de textos: **con defecto** = cualquier veredicto distinto de `verdadera`; **graves** = `falsa`,
`sin_respaldo` o `mal_fechada`; los porcentajes se calculan sobre el total de afirmaciones de las ventanas evaluadas.

Candidatos: `team` (prototipo de equipo de agentes del 2-nov: analista → redactor → QA → corrector → red de seguridad), `base`
(modelo único de producción: **línea base, no tiene compuerta; sirve para comprobar que el juez discrimina**: en las 6 ventanas
el texto base saca 34 % con defecto, 6 falsas, 2 «post viejo» y el equipo 9.7 %, 0 y 0) y `dir:RUTA` para conectar el motor real
de WP-3 a WP-6 cuando exista.

`--ledger` mide al propio juez: le pasa las 127 afirmaciones del libro (verificadas a mano contra la base) y compara
(sección 5, límite 3).

### 3.3 `parents.py` (resolución del post padre)

Dos SELECT acotados por agencia y fecha (comentarios de FB e IG de la ventana, y posts candidatos de los 120 días anteriores)
y el cruce en Python con la regla del spec sección 7: en Facebook el padre es la mención de la misma agencia cuyo `bw_guid`
termina en `_<postId>`; en Instagram, la mención con `bw_guid = <shortcode>`. LinkedIn queda fuera (`parent_unknown`). Mientras
WP-1 no agregue `mentions.parent_mention_id`, mide si el comentario **es resoluble** por la regla; cuando la columna exista,
reporta además la tasa real. Medición del 2-nov para DDEC (26-oct a 1-nov): FB 500 de 501 (99.8 %), IG 179 de 179. El DF no tiene
comentarios en redes en esa ventana: la compuerta se mide solo con DDEC.

### 3.4 `repro.ts` y `repro-check.py` (máquina del tiempo)

`repro.ts` reconstruye, para cualquier día pasado, las entradas del correo diario (conteos con el `buildSentimentReport` real de
`@eco/shared`, serie diaria, tópicos, agregados y muestras con las consultas copiadas del lambda) y los **prompts exactos** que
recibe Claude (`buildDailySummaryPrompt`, `buildSentimentInsightsPrompt`). Con `--llm` llama a Bedrock con el modelo, la
temperatura y los esquemas de herramienta del lambda. Es de solo lectura (SELECT vía `eco-migration`). `repro-check.py` lo corre
sin LLM y compara contra el fixture: el 2-nov-2026, `ddecpr_20261031` reproduce 56/456/135/647 y la serie diaria 13, 100, 155,
167, 148, 36, 28 exactamente.

## 4. Las compuertas (spec 13.2) y qué las mide

| Compuerta | Umbral | Quién la mide | Resultado de referencia (2-nov, `--cached`) |
|---|---|---|---|
| Sentimiento DF, acuerdo con juez | ≥ 75 % | `eval-classification` (`df397`) | 78.8 % (n=397, Sonnet) |
| Sentimiento DF, precisión de negativos | ≥ 85 % | ídem | 94.4 % (34 de 36) |
| Sentimiento DDEC, acuerdo por tono | ≥ 75 % | `eval-classification` (`ddec208`) | 75.5 % (157 de 208, Opus); 77.4 % con Sonnet en la corrida completa del 2-nov |
| Estabilidad entre corridas | ≥ 95 % | `eval-classification` (`ddec208` y `.b`) | 100 % y 100 % |
| Hecho adverso, acuerdo con juez | ≥ 85 % | `eval-classification` | 91.7 % |
| Resolución de padres FB e IG | ≥ 90 % | `parents.py` (requiere `--with-db`) | FB 99.8 %, IG 100 % (DDEC) |
| Textos del equipo, afirmaciones con defecto | ≤ 10 % | `compose-judge` | 9.7 % (17 de 175, juez Opus) |
| Textos del equipo, graves / falsas / mal fechadas | ≤ 5 %; 0; 0 | ídem | 4.6 %; 0; 0 |
| «Post viejo como noticia del día» | 0 en 6 ventanas | ídem | 0 |
| Dramatismo del titular | mediana ≤ 1, máx ≤ 2 | ídem | mediana 1, máx 2 |
| Lint de código sobre el texto final | 0 residuos | ídem (sin modelo) | 0 |
| Revisión humana a ciegas | κ ≥ 0.6 | `human-kappa.py` | **N/D: nadie ha rellenado la hoja** |

La columna de referencia sale de `bash scripts/qa/run-all.sh --cached` (10 PASA, 0 FALLA, 2 N/D con `--with-db` ausente y hoja
vacía). Con `--with-db` la de padres también pasa. La compuerta humana es previa a la activación (spec 13.5) y sigue abierta.

## 5. Cómo interpretar un resultado y sus límites

1. **n pequeño = ruido grande.** Con `--limit 60`, el acuerdo del DDEC tiene un intervalo de confianza de aproximadamente ±11 puntos;
   con n=208, ±6; con n=397 (DF), ±4; con 48 ítems, κ tiene un intervalo de ±0.2 o más. En una corrida rápida del 2-nov (n=60) el
   DDEC dio 72 % y la precisión de negativos del DF 83 % (5 de 6): ambas `FALLA*`, pero con los conjuntos completos son 77 % y
   94 %. Un `FALLA*` pide correr `--full` antes de concluir nada; un `PASA*` tampoco prueba nada. El `*` marca todo subconjunto.
2. **Los jueces son de la misma familia que el sistema** (riesgo R1 del spec): el juez de clasificación es Opus o Sonnet, y los
   textos del equipo los generó Opus. El juez comparte sesgos con lo que juzga. Por eso existe la revisión humana (sección 6) y por
   eso un resultado favorable del arnés **no sustituye** a esa compuerta.
3. **El juez de textos no alcanza todo el defecto.** Calibrado contra las 127 afirmaciones del libro (verificadas a mano con
   consultas a la base), el juez Sonnet marca con defecto 23 de los 52 defectos humanos (44 %), 14 de los 19 graves (74 %), y marca
   con defecto 16 de las 75 afirmaciones que los humanos dieron por verdaderas. El juez solo ve la ventana de muestras, no la base:
   cifras como «171 de 521 comentarios» no las puede comprobar. Conclusión: un 9.7 % de defecto «según el juez» **subestima** el
   defecto real; el arnés sirve para comparar versiones (base 34 % vs equipo 9.7 %) y detectar regresiones, no para certificar
   cero defectos.
4. **Las compuertas de textos se calibraron con juez Opus.** Sonnet es más estricto: sobre las mismas dos ventanas el equipo sacó
   15.4 % con defecto con Sonnet (umbral 10 %) y 11.5 % con el veredicto en caché del juez Opus (7 de 61). Para un resultado comparable con el spec usa
   `--judge opus` (12 llamadas largas; unos USD 3 a 4).
5. **El modelo no es determinista**, ni siquiera con temperatura baja. Entre dos corridas de Sonnet con la misma configuración
   hubo 98 % y 97 % de coincidencia en sentimiento y pertinencia (n=60); en Opus fue 100 % con n=208. La compuerta de estabilidad
   toma el peor de los dos. No se probó la estabilidad con el modelo del processor bajo carga de producción.
6. **`ddec208` es estratificado**, no representativo: sirve para comparar sistemas, no para estimar el NSS del DDEC. La estimación
   poblacional es `ddec867`. La corrida de semana completa del laboratorio usó Sonnet; el 208 usó Opus.
7. **Son fotos del 2-nov.** Las ventanas y las etiquetas de producción no se actualizan; `repro-check.py` dice cuánto cambió la
   base desde entonces.
8. **Solo DDEC y DF.** Gobernadora y AAA no están medidas (F-04 del spec): replicar el laboratorio antes de activarlas.
9. **`parents.py` mide resolubilidad por GUID**, no la columna `parent_mention_id` (todavía no existe). Un comentario cuyo post
   salió hace más de 120 días cuenta como no resuelto.
10. **El prompt es una réplica congelada.** `lib/lab_prompts.py` reproduce el prompt del processor al 3e5cfaa con la rúbrica v2 del
    spec. Cuando WP-1/WP-2 lleven la rúbrica al processor real, la fuente de verdad pasa a ser ese código: hay que re-sincronizar la
    réplica o el arnés estará midiendo un prompt que ya no corre en producción.
11. **Las cifras de dos de las filas del spec dependen del modelo:** el `df162` de Opus dio 76 % de acuerdo y precisión de 100 % en
    9 de 9 negativos; con Sonnet en 397 fueron 79 % y 94 %. Ambos están en los rangos que el spec reporta.

## 6. Revisión humana a ciegas (spec 13.5)

Es la única compuerta que no depende de ningún modelo y es previa a la activación. Hay dos hojas en `scripts/qa/fixtures/human-review/`.

### 6.1 Hoja de 48 menciones (24 DDEC, 24 DF)

1. Abre `hoja_revision_ciega.md` (o usa `respuestas-plantilla.csv`). **No mires** `fixtures/refs/`, `runs/` ni los jueces: la persona que
   clasifica no debe ver lo que hizo el modelo. La clave (`hoja_clave_ids.json`) solo mapea A1 a B24 con el id de la mención.
2. Para cada ítem, en la línea `S: ____  H: ____  P: ____`, escribe:
   - **S** = postura del AUTOR hacia la agencia: `positivo`, `neutral` o `negativo` (un titular que solo reporta es neutral; un elogio
     corto a una publicación del DDEC cuenta como positivo).
   - **H** = ¿el hecho que se reporta es malo para la agencia?: `si` o `no`.
   - **P** = ¿trata de la agencia?: `alta`, `media` o `baja`.
3. Guarda la hoja (o el CSV con columnas `n,S,H,P`) fuera del repo o en una rama de revisión y corre:

   ```bash
   python3 scripts/qa/human-kappa.py --sheet mi-hoja.md            # o: --csv mis-respuestas.csv
   bash scripts/qa/run-all.sh --only kappa --human-labels mi-hoja.md   # lo mismo, con la tabla de compuertas
   ```

   El script acepta variantes (`pos`/`neg`/`+`/`−`, `si`/`sí`/`s`, mayúsculas y acentos) y avisa de los valores que no entiende.
4. Lectura: calcula el κ de Cohen entre la persona y el sistema (por defecto, la corrida de referencia de la rúbrica v2; pasa
   `--system out/runs/ddec208.json,out/runs/df397.json` para medir otra corrida) y lo imprime para **S** (la compuerta, κ ≥ 0.6),
   **H** y **P** (informativos, con el mismo umbral) más la matriz de confusión del sentimiento. Una hoja vacía o incompleta da
   `N/D`, nunca `PASA`.
5. Si κ < 0.6: mira la matriz. Si el desacuerdo se concentra en neutral vs positivo en reacciones cortas a una publicación de la
   agencia, el problema es la regla («Excelente» = positivo hacia la agencia), no el modelo; llévalo al product owner antes de tocar el
   prompt. Con 48 ítems un κ de 0.55 a 0.65 no distingue entre pasar y fallar: pide una segunda lectora.

La prueba `human-kappa.py --demo` genera etiquetas sintéticas y sirve para comprobar el cálculo; **no cuenta como revisión humana**.

### 6.2 Hoja de 12 textos de correo

`hoja_textos_correo.md` mezcla, con semilla fija, los 12 textos (6 ventanas × modelo único y equipo) sin decir cuál es cuál. Para
cada uno la persona anota cuántas afirmaciones tienen defecto (D), cuántas son graves (G), el dramatismo del titular (0 a 5) y si
presenta un post viejo como noticia del día. La clave (`hoja_textos_clave.json`) dice qué texto es de qué sistema; compara los D/G
humanos con los veredictos de `fixtures/refs/windows/<ventana>/judge_{team,base}.json`. No hay script que calcule esto: son 12 textos y
la conclusión útil es cualitativa (¿ve la persona más defecto que el juez, como en el libro?).

## 7. Datos y privacidad

- Los conjuntos de oro están **pseudonimizados**: autores y cuentas personales → `usuario_<6 hex>` (mismo mapa en todos los archivos);
  se conservan agencias, gobierno, municipios y medios. El texto de las menciones, que es público, se conserva. Correos y teléfonos se
  enmascaran como red de seguridad; las URL de redes se enmascaran salvo las páginas de Facebook con id numérico.
- Verificación (no debe imprimir nada; se corrió el 2-nov-2026 sobre `scripts/qa` y este documento):

  ```bash
  cd scripts/qa
  grep -rEoi '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}' .                                              # correos
  grep -rEo '\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}' fixtures                                           # teléfonos con separadores
  grep -rEo '(^|[^0-9A-Za-z_/=])1?[2-9][0-9]{2}[2-9][0-9]{6}([^0-9A-Za-z_]|$)' .                                                  # teléfonos corridos (10 dígitos)
  grep -rEo 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+|aws_secret|BEGIN [A-Z ]*PRIVATE KEY' .                     # llaves
  ```

- Límites: la sal es pública, es seudonimización y no anonimización; los nombres de terceros dentro del texto de un comentario (una
  etiqueta a un amigo) no se detectan (el repo es público: decide antes de integrar si se seudonimizan las secuencias de 2 a 3 palabras capitalizadas al inicio de los comentarios de Facebook/Instagram); las figuras públicas se pueden reconocer por su seudónimo con un diccionario, y las URL de páginas de Facebook con id numérico se conservan; las notas de prensa del DF mencionan funcionarios públicos por nombre y se conservan.
- Regenerar o ampliar: `python3 scripts/qa/tools/build-fixtures.py --src <directorio del laboratorio>`.
- El arnés nunca imprime ni guarda el `.env`. Las consultas a producción son solo `SELECT` vía `lib/q.py`, que además rechaza palabras
  de escritura. **Acota siempre con `LIMIT` y rango de fechas**: una lectura larga sobre `mentions` bloqueó un `ALTER` en el
  incidente de la investigación (riesgo R5 del spec). `parents.py` y `repro.ts` están diseñados con ventanas de 7 días y se verificaron en ≈ 4 s y ≈ 11 s.

## 8. Qué verificó este paquete (2-nov-2026)

| Prueba | Resultado |
|---|---|
| `run-all.sh --dry-run` (rápido y `--full --opus --with-db`) | lista los pasos y calcula tokens previstos; 0 llamadas |
| `run-all.sh --only ddec-classify --limit 20` con Bedrock real | 20 llamadas, 117 mil tokens de entrada; tabla en formato 6.4; 60 % de tono en n=20 (`FALLA*`, ruido de muestra) |
| Perfil rápido completo con `--with-db` | 184 llamadas, 1.05 M tokens; todos los pasos corren; 6 PASA, 5 FALLA* y 1 N/D (ver 5, punto 1) |
| `classify-lab.py --set ddec208` completo con Sonnet | 208 llamadas; tono 77.4 %; 0 propias positivas de 23 |
| `eval-classification.py --cached` | reproduce el spec 6.4: 53 → 79 %, 34 → 94 %, −55.7 → −8.6, 75 / 75 %, 1 de 67, 3 → 0 de 23, +11.4 → +21.6, 156 → 77, 100 / 100 % |
| `compose-judge.py --cached` | base 34.3 % con defecto y 6 falsas; equipo 9.7 %, 4.6 % graves, 0 falsas, 0 mal fechadas, 0 residuos de lint |
| `compose-judge.py --ledger` | juez Sonnet: 53 % de acuerdo exacto, 44 % de recall de defectos (74 % de los graves) |
| `parents.py`, `repro-check.py` | FB 99.8 % / IG 100 % (DDEC); `ddecpr_20261031` idéntico a la foto |
| `human-kappa.py` con hoja vacía, hoja sintética y `--demo` | `N/D`; el parser entiende mayúsculas y acentos; κ calculado |

Pendiente (honesto): la corrida `--full` con Opus (≈ USD 35 a 40 con Sonnet; varias veces más con Opus) no se ejecutó en este paquete;
las filas Opus del spec se verifican con las referencias en caché. La hoja humana no está rellenada. El motor de redacción real
(WP-3 a WP-6) todavía no existe: los textos `team` son el prototipo del laboratorio y el conector `dir:` espera al motor.
