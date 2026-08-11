# Catálogo de hallazgos — auditoría de diseño ECO, julio 2026

Apéndice de [`auditoria-diseno-2026-07.md`](auditoria-diseno-2026-07.md). 337 hallazgos en 13 unidades, sobre `origin/main` `8a996a8`.

`✔︎` pasó refutación adversarial · `·` sin verificar. Los 3 refutados están al final con el motivo.


## Overview

*27 hallazgos*

El Overview es la pantalla que el cliente abre primero y la que va a proyectar en una reunión, y hoy su problema de fondo no es estético: es que **codifica mal la verdad**. Tres de sus cinco bloques dicen algo distinto de lo que dicen sus propios números — la gráfica de tendencia normaliza cada línea a su propio min/max y dibuja "positivo" (el más pequeño) por encima de "negativo" y "neutral"; el gauge de crisis reparte las etiquetas NORMAL/ELEVADO/ALERTA/CRISIS en cuartos iguales aunque los umbrales reales son 0.25/0.40/0.60, así que la palabra "ALERTA" queda impresa sobre la zona de CRISIS y el marcador al 41% parece lejísimos de la alerta mientras el titular grande dice "Alerta"; y la tabla de tópicos cierra con un "TOTAL DEL PERIODO 1.3K" que no es la suma de las filas que tiene encima (1,195 = 91%). El segundo problema es que la pantalla tiene **cinco fuentes de verdad sin reconciliar** para cifras que el ojo compara sin querer: el hero (1,313), el badge del nav (1.3K, congelado en el load y de otro endpoint), el delta del termómetro (vs ventana previa), el delta de la leyenda del chart (vs el día 1 de la ventana, y con el color invertido) y la prosa de IA (+18%, neto −8.4 — una métrica que ya no existe en esta pantalla). El tercero es de jerarquía: 114px de chrome (con el botón de tema solo en su propia línea por un flex-wrap accidental) más 110px de tarjeta para tres números dejan la síntesis accionable ("Lo que vigilaría esta semana") a ~1,000px de scroll, y en móvil/tablet el reflow es correcto pero disuelve la comparación de tres cantidades en tres tarjetas apila…

### P0 (6)

**✔︎ [OV-01] La gráfica de tendencia invierte el orden de los sentimientos: dibuja "positivo" arriba siendo el más bajo** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:220-227 (rama por defecto) y :335; invocación en apps/web/public/eco-prototype/screens.js:4344`
- overview-desktop.png / z-chart-desktop.png: al 27 jul la leyenda dice NEGATIVO 43.0 · NEUTRAL 54.0 · POSITIVO 36.0, pero la línea verde (36.0) termina 80px POR ENCIMA de la naranja (43.0) y por encima de la gris (54.0). Con los datos servidos (fixtures/overview.json) es demostrable: 27 jul negativo=38 y positivo=38 (idénticos) se dibujan a 2.1% y 41.7% de la altura; el 22 jul negativo=181, neutral=109 y positivo=59 se dibujan los tres…
- *Importa porque:* Es la única gráfica de la pantalla de aterrizaje y el espejo del correo diario. Un director de comunicación que la mira tres segundos concluye "el positivo va ganando" cuando el positivo es el 21% del volumen — y lo concluye 400px debajo de una tarjeta que dice NEGATIVO 583 (44%). Si el cliente detecta esto una vez, d…
- *Arreglo:* Pasar `sharedScale` en OverviewTendencia (screens.js:4344) — es una serie de conteos con la misma unidad (menciones/día) y un 0 natural, así que la escala compartida con min=0 es la única honesta. Conservar el gusto del usuario por las curvas suaves manteniendo `smooth`, pero cambiar catmullRomPath por una interpolación monótona (Fritsch–Carlson) para que el suavizado no invente valores fuera del rango observado. Si se quiere además ve…
- *Verificador:* Hallazgo confirmado con dos precisiones de evidencia (no cambian severidad ni arreglo): (1) el archivo `z-chart-desktop.png` no existe en `shots/` — los recortes auxiliares se llaman `zz-*`; la leyenda y los extremos de las líneas se ven en `overview-desktop.png` (región y≈1000-1560 del PNG a 2× DPR). (2) Los valores `43.0/54.0/36.0` citados provienen de la captura (siembra anterior) y NO del `fixtures/overview.json` en disco hoy, que da 38/57/38 para el 27 jul; conviene declarar ambas fuentes por separado en lugar de mezclarlas en una sola frase, porque un revisor que abra el fixture y busque "43.0" no lo encontrará. La patología se demuestra con ambos conjuntos: en la captura el verde (36…

**✔︎ [OV-02] Gridlines sin rótulos y un canal de 44px reservado para un eje Y que nunca se dibuja** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:293-302 (gridlines siempre, labels sólo si sharedScale) y :188 (padding.l = 44)`
- z-chart-desktop.png: se ven 5 líneas horizontales (2 sólidas + 3 punteadas) sin un solo número, y el área de trazado empieza 44px a la derecha del padding de la card, con el hueco vacío. El código dibuja las gridlines incondicionalmente pero los textos del eje sólo cuando `sharedScale` o `yDomain`.
- *Importa porque:* Las gridlines son la señal convencional de "hay una escala común": refuerzan exactamente la lectura falsa de OV-01 en vez de advertirla. El canal vacío de 44px es además una promesa de eje que nunca se cumple, y en móvil se come el 11% del ancho útil.
- *Arreglo:* Acoplar gridlines y rótulos: si no hay escala rotulable, no dibujar gridlines (o dibujar sólo la línea base). Hacer `padding.l` condicional (44 cuando hay eje, 8 cuando no). Con OV-01 resuelto, rotular 3 valores (0 / medio / máx) con el sufijo de unidad en el primero: "0", "90", "180 menc.".
- *Verificador:* Severidad correcta: **P1** (degrada; el componente "engañoso" ya está cobrado en OV-01/F2), con una sub-nota P2 por el canal desperdiciado. Título más preciso: "Gridlines sin rótulos: 5 líneas de referencia (una de ellas sólida, que se lee como cero) sin ninguna escala, y `padding.l = 44` reservado para un eje que no se dibuja". Arreglo corregido: 1. Acoplar gridlines y rótulos en `charts.js:293-302`: si no hay escala rotulable (`!sharedScale && !yDomain`), no dibujar las 3 punteadas intermedias. La línea inferior sólo es legítima si representa el cero real; con normalización por serie NO lo es, así que o se elimina o —mejor, junto con OV-01— se pasa a `sharedScale` con base 0 y entonces sí…

**✔︎ [OV-03] El gauge de crisis reparte NORMAL/ELEVADO/ALERTA/CRISIS en cuartos iguales y deja "ALERTA" impresa sobre la zona de CRISIS** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:4298-4300 (justifyContent: space-between) contra :34 (CRISIS_GRADIENT) y :35-41 (umbrales 0.25/0.40/0.60)`
- Muestreo de píxeles de overview-desktop.png sobre la barra: verde 0→25.3%, amarillo 25.3→40.2%, #E0662E 40.2→60.0%, #FF6A3D 60.0→100%. Las cuatro etiquetas caen en 0/33/66/100% por el space-between, así que "ALERTA" se imprime al 66% (dentro de la banda CRISIS) y "CRISIS" al 100%. El marcador está al 41% — ya dentro de ALERTA — pero visualmente aparece pegado a ELEVADO y a media barra de la palabra ALERTA, mientras el titular a la izqu…
- *Importa porque:* Es el indicador de crisis de un gobierno. Tal como está, la gráfica desmiente al titular: el lector ve el marcador "apenas pasando lo elevado" y deduce que la alerta empieza mucho más adelante. Cualquier decisión sobre activar o no un protocolo se toma con esa lectura, y además hace inauditable el umbral contra el que…
- *Arreglo:* Posicionar las etiquetas en el punto medio real de cada banda (12.5% / 32.5% / 50% / 80%) con `position:absolute; left:X%; transform:translateX(-50%)`, y marcar los cortes con ticks verticales de 1px sobre la barra en 25/40/60. Añadir el valor del umbral bajo cada tick (25 · 40 · 60) para que el 41% sea verificable. Derivar tanto los cortes como el gradiente de una sola constante (los umbrales ya son canónicos en packages/shared/src/fo…
- *Verificador:* El hallazgo es correcto; ajusto tres cosas para el entregable. 1. Cifras exactas medidas (sustituyen los redondeos "0/33/66/100"): centros de rótulo en 1.8% / 34.0% / 66.2% / 98.1%; cortes de banda en 24.97% / 40.02% / 59.98%; marcador en 41.0%. Por casualidad ELEVADO (34.0%) sí cae dentro de su banda (25-40%) y NORMAL/CRISIS también caen dentro de las suyas — el rótulo mal ubicado es exclusivamente ALERTA, y el daño real es doble: ALERTA se imprime sobre CRISIS y la banda ALERTA (40-60%) queda muda. 2. El alcance es mayor que "Overview": el mismo bloque está duplicado literalmente en la KpiCard "Riesgo de crisis" del Scorecard, `screens.js:444-449` (mismo `CRISIS_GRADIENT`, mismo marcador,…

**✔︎ [OV-04] ALERTA y CRISIS son el mismo naranja, y la palabra "Alerta" está pintada con el color de la zona CRISIS** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:34 (#E0662E para ALERTA, var(--neg) para CRISIS), :4288 (word con wordColor del API) y :4296 (knob con bandColor local); package…`
- El gradiente rinde #E0662E (224,102,46) en 40-60% y #FF6A3D (255,106,61) en 60-100% — dos naranjas a ~9 puntos de luminancia que en una barra de 6px se leen como una sola banda (verificado en el muestreo y a ojo en z-crisis-desktop.png y m-chart2.png). Al mismo tiempo, el fixture devuelve display.crisis.color = 'var(--neg)' para la banda ALERTA (porque BAND_TONE mapea ALERTA→neg), así que la palabra "Alerta" se pinta #FF6A3D: exactamen…
- *Importa porque:* Una escala de escalamiento que no escala: el salto de ALERTA a CRISIS —el único salto que obliga a actuar— es invisible, y el color del titular contradice la posición del marcador. En mando el problema se agrava porque --accent === --neg, así que el naranja de la marca es también el de crisis.
- *Arreglo:* Cuatro peldaños con hue y luminancia crecientes y tokens propios: --band-normal (var(--pos)), --band-elevado (var(--warn)), --band-alerta (ámbar-naranja, p.ej. #F08A24), --band-crisis (rojo real, p.ej. #E03131, distinto del accent de marca). Separar en BAND_TONE el tono 'alerta' del tono 'crisis' (hoy ambos 'neg') y hacer que la palabra, el knob y la zona lean del MISMO token. Eliminar el hex suelto #E0662E de screens.js:34.
- *Verificador:* Mantener P0. Dos precisiones sobre la evidencia y una ampliación de alcance: 1. La cifra de luminancia está mal. #E0662E tiene luminancia relativa 0.256 y #FF6A3D 0.319 — ~6.4 puntos, no 9. El dato correcto y más contundente es el **ratio de contraste entre las dos zonas: 1.21:1**, muy por debajo de cualquier umbral de distinguibilidad (3:1 para elementos gráficos no textuales, WCAG 1.4.11). 2. "En una barra de 6px se leen como una sola banda" es una exageración en escritorio: en `z-crisis-desktop.png` la barra mide 2060px y sí existe una costura dura y localizable en x=1709 (60%). La formulación honesta es: **el escalón ALERTA→CRISIS es el único del gradiente sin salto de hue** (verde→ámba…

**✔︎ [OV-05] La leyenda del chart mide el delta contra el día 1 de la ventana y le pone el color al revés: "NEGATIVO ▼8.5%" sale en rojo y "▲0.0%" en verde** · `data-integrity`

- `apps/web/public/eco-prototype/charts.js:263-264 (delta contra s.vals[0]) y :270-272 (color por signo, no por dirección deseable); contrasta con apps/web/public/eco-proto…`
- overview-desktop-fold.png: la leyenda dice "NEGATIVO 43.0 ▼8.5%" con el ▼8.5% en naranja (=malo) y "POSITIVO 36.0 ▲0.0%" con el 0.0% en verde y flecha ascendente. 300px arriba, la misma serie negativa muestra "▲+34%" — porque el termómetro compara contra la ventana previa (deltaVsPrev del API) y la leyenda compara contra el primer día de la ventana. Ninguno de los dos declara su base.
- *Importa porque:* El mismo indicador aparece a la vez como +34% y como −8.5% en una sola pantalla, y el color miente dos veces: que bajen las menciones negativas se marca en rojo, y un cambio de 0.0% se marca como mejora en verde. Es la clase de detalle que un cliente usa para argumentar que los números "no cuadran".
- *Arreglo:* Un solo contrato de delta para toda la pantalla: reutilizar formatDelta/DeltaDisplay de @eco/shared/format (ya distingue 'estable' y 'sin base') y pasar el tono por métrica con invert para las series negativas. Rotular la base en el texto ("vs 7 días previos") en vez de dejarla implícita. Suprimir flecha y color cuando |delta| redondea a 0.
- *Verificador:* Corregir una sola afirmación del hallazgo: "Ninguno de los dos declara su base" es falso para el termómetro. Su eyebrow sí la declara — `screens.js:4196` renderiza "01 · Termómetro · vs ventana previa" y se ve en la captura. El que no declara base es la leyenda del chart (`03 · Tendencia · Día a día`, cuyo subtítulo en `screens.js:4335` solo habla de volumen y TZ). Redacción corregida del hallazgo: "La leyenda de `MultiLineChart` calcula el delta contra el primer día de la ventana (`s.vals[0]`, charts.js:263-264) sin rotular esa base, mientras el termómetro de la misma pantalla usa `deltaVsPrev` del API y sí rotula la suya ('vs ventana previa'). Resultado: la serie NEGATIVO aparece dos vece…

**✔︎ [OV-07] Las etiquetas de último valor quedan recortadas a un dígito: el chart cierra mostrando "3", "5", "4" como si fueran puntuaciones** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:415-417 (translate(innerW+4), rect width=46) contra :188 (padding.r = 20)`
- overview-desktop.png y m-topics2.png (crop móvil): en el borde derecho aparecen tres cuadritos de color con un solo carácter — 3 en verde, 5 en gris, 4 en naranja — en vez de 36.0 / 54.0 / 43.0. Ya lo señaló la auditoría responsive (WS-2.2) y no se corrigió.
- *Importa porque:* No es sólo ilegible: es plausiblemente malinterpretable. Tres cuadros de colores con "3 5 4" al final de una curva se leen como notas o como un índice, y son lo último que ve el ojo al recorrer la gráfica de izquierda a derecha. En el Scorecard la misma etiqueta sale como caja gris vacía.
- *Arreglo:* padding.r ≥ 56 (46 de caja + 4 de gap + 6 de respiro) o, mejor, mover la etiqueta a la IZQUIERDA del último punto (`translate(innerW - 50)`) con anchor al final y anchura calculada del texto en vez de fija en 46. En móvil (innerW < 320) suprimir las etiquetas y dejar solo la leyenda superior, que ya trae los tres valores.
- *Verificador:* Severidad correcta: **P1, no P0**. El criterio del brief reserva P0 para lo que rompe o engaña. Aquí el valor verdadero del último punto está impreso, correcto, más grande y etiquetado, a ~30px por encima del tag recortado: la tira-leyenda de `charts.js:259-275` usa `hoverIdx = hover == null ? data.length - 1 : hover` (`charts.js:229`), o sea que sin hover muestra precisamente el ÚLTIMO punto — el mismo que el tag. Para que el lector se engañe tendría que leer la caja verde con «3» e ignorar el «POSITIVO 36.0» que está justo arriba en la misma card. El daño real es ruido visual + pérdida de una redundancia útil (y una caja de color vacía en los charts de una serie), no una cifra falsa que s…

### P1 (18)

**· [OV-08] En las barras de tópicos, "positivo" es un residuo (100 − neg − neu), no una medición** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:4364 (posPct = Math.max(0, 100 - negPct - neuPct))`
- El segmento verde nunca se calcula desde `pos`: se calcula como lo que sobra. La prop `pos` sólo se usa en el title del tooltip (:4369). Con los datos servidos las tres partes suman el total y el bug es invisible, pero cualquier mención con sentimiento nulo/no clasificado o cualquier desalineación entre row.total y sus componentes se pinta como verde.
- *Importa porque:* Es el peor default posible: los errores de clasificación se convierten silenciosamente en "sentimiento positivo" en la card que resume los tópicos de una agencia de gobierno. El sesgo va siempre en la dirección favorable, que es exactamente la que nadie va a cuestionar.
- *Arreglo:* Calcular los tres anchos desde sus propios valores (posPct = pos/td*100) y renderizar el remanente (td − neg − neu − pos) como un cuarto segmento en var(--text-3) rotulado "sin clasificar" — o normalizar el denominador a neg+neu+pos y declararlo en el pie. Nunca derivar una categoría de datos por sustracción.

**· [OV-09] El badge "Menciones 1.3K" del nav sale de otro endpoint y está congelado desde el load: no cambia al cambiar el periodo** · `data-integrity`

- `apps/web/public/eco-prototype/shell.js:84-85 y :98 (const NAV = getNav(), a nivel de módulo) contra apps/web/public/eco-prototype/screens.js:4180`
- overview-desktop-fold.png muestra simultáneamente "Menciones 1.3K" en el sidebar y "1,313 menciones" en el hero. El badge se calcula una sola vez al evaluar shell.js sumando window.ECO_DATA.TIMELINE (endpoint /api/eco-data, pipeline loadMetricsForWindow); el hero viene de /api/overview (pipeline buildSentimentReport). NAV es un `const` de módulo: ningún cambio de periodo o de agencia lo recalcula.
- *Importa porque:* Dos números que el ojo compara sin querer, con dos formatos (1.3K vs 1,313) y dos orígenes; y uno de ellos se queda mintiendo apenas el usuario toca 30D o cambia de agencia. Es la misma familia del problema de "cinco totales" del Scorecard, aquí en la pantalla de entrada.
- *Arreglo:* Elevar el total del periodo a estado de App (el que ya devuelve /api/overview) y que el badge lo consuma; convertir getNav() en una función llamada en render con ese valor. Un solo formateador para conteos de menciones en todo el producto (miles con separador, sin abreviar por debajo de 10K).

**· [OV-10] "Ingesta en vivo" con punto verde pulsando convive en el mismo viewport con "Datos al cierre de ayer"** · `copy`

- `apps/web/public/eco-prototype/shell.js:290-291 (pulse + var(--pos) + "Ingesta en vivo") contra :417-422 (punto gris estático + "Datos al cierre de ayer")`
- overview-desktop-fold.png: arriba a la izquierda "● DATOS AL CIERRE DE AYER" en gris; abajo a la izquierda "● Ingesta en vivo — hace 6 h" con punto verde animado. El comentario del propio código en shell.js:417-419 explica que "En vivo" engañaba y que por eso la etiqueta del header es honesta "sin pulso ni verde" — la corrección se aplicó en un sitio y no en el otro.
- *Importa porque:* El usuario tiene que elegir cuál de las dos frases creer sobre la frescura del dato justo antes de leer 1,313 menciones. Y la pulsación verde es el único movimiento de la pantalla: atrae el ojo al elemento menos importante y al que además es falso.
- *Arreglo:* Una sola primitiva de frescura, en un solo lugar: "Ventana cerrada · 21–27 jul · última ingesta hace 6 h" en el header, sin animación y sin verde (el verde está reservado a sentimiento positivo). Quitar el bloque del sidebar o dejar sólo el timestamp sin punto ni pulso.

**· [OV-11] La columna "Resumen del periodo" lleva el borde naranja de "Negativos": el resumen neutral queda tipificado como mala noticia** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:4549 (accent: 'var(--accent)') y :4564 (borderTop: 2px solid accent)`
- Muestreo de píxeles en overview-desktop.png y=1551: el borde superior de la tercera card es exactamente (255,106,61) = #FF6A3D, idéntico al de la card "Negativos"; la del medio es (63,212,122) = verde. Causa: en mando --accent === --neg, así que 'var(--accent)' rinde el color de negativo.
- *Importa porque:* El lector recorre tres cards y lee "dos de estas tres son malas noticias" antes de leer una palabra. El tercer bloque es precisamente el que dice "no hay un deterioro general de la reputación" — el color le está diciendo lo contrario.
- *Arreglo:* Usar un token neutral/informativo para la tercera columna (var(--info) o var(--hairline-strong)) y, en general, prohibir 'var(--accent)' como color semántico mientras --accent === --neg. Alternativa mejor: quitarle el borde de color al resumen y darle jerarquía por ancho (ver OV-23).

**· [OV-12] El resumen de IA se renderiza con las frases pegadas: "…Permisos (19%).Si aislaras energía…"** · `copy`

- `apps/web/public/eco-prototype/screens.js:206-209 (sanitizeBriefingHtml elimina toda etiqueta salvo <strong>, sin insertar separación) usado en :4576-4578`
- Visible en overview-desktop.png y en overview-mobile.png: "…y Permisos (19%).Si aislaras energía…" y "…arrastra el promedio.Lo que vigilaría esta semana:". El fixture eco-insights.json trae tres <p> bien formados; el sanitizador los borra sin sustituirlos por espacio ni salto, así que tres párrafos se fusionan en un bloque de 12px.
- *Importa porque:* Es el texto más importante de la pantalla —la recomendación— y se ve como un error de copiado. Para un cliente de gobierno eso no lee como bug: lee como "esto no lo revisó nadie", y contamina la credibilidad del análisis que contiene.
- *Arreglo:* Permitir <p> (y <br>) en la allowlist del sanitizador y estilar `p { margin: 0 0 8px }` en el contenedor; o reemplazar las etiquetas de bloque por '\n\n' y renderizar con white-space: pre-line. Añadir un test de render con el payload real que falle si aparece un `.` seguido de mayúscula sin espacio.

**· [OV-13] El resumen de IA se apoya en métricas que la pantalla no muestra (neto −8.4, +2.1, +18%), sin escala, sin fecha de generación y sin forma de verificarlas** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:4576-4578 y :4459 (OverviewInsights); el payload trae generatedAt sin usar (ver fixtures/eco-insights.json)`
- El texto dice "sentimiento neto en -8.4, cuatro puntos por debajo" y "el neto del periodo sería +2.1" — el NSS se eliminó a propósito del Overview (comentario en screens.js:4245-4249), así que no hay ningún número en pantalla contra el cual contrastarlo. También dice "1,313 menciones (+18%)" mientras el termómetro muestra +34% / +9% / −4% con otra base. El API entrega generatedAt: 2026-07-27T11:00Z y no se renderiza; el único aviso de…
- *Importa porque:* Prosa generada por un modelo, presentada con el mismo lenguaje visual que los datos calculados, citando cifras no auditables en la propia pantalla. En un dashboard de gobierno eso es un riesgo reputacional: si una de esas frases se cita en una reunión y no se puede reconstruir, el problema no es del texto, es del prod…
- *Arreglo:* (1) Marcar el bloque como generado: chip "IA · generado 27 jul 11:00" usando generatedAt, con tono informativo, visible al mismo tamaño que el título de la card. (2) Restituir en la pantalla las métricas que la prosa cita (una línea con NSS del periodo y su escala −100..100) o prohibirle citarlas en el prompt. (3) Hacer las cifras de la prosa enlazables al slice de menciones correspondiente (ya existe MentionsSliceModal), para que cada…

**· [OV-14] El título cuenta los días desde el largo del array y el subtítulo imprime fechas ISO, teniendo el label legible en el payload** · `copy`

- `apps/web/public/eco-prototype/screens.js:4176 (últimos {data.dailySeries.length} días) y :4180 ({periodStart} → {periodEnd}); apps/web/src/app/api/overview/route.ts:174…`
- En pantalla: "Conversación pública de los últimos 7 días" y "1,313 menciones · 2026-07-21 → 2026-07-27". El API ya devuelve periodLabel = "21 – 27 de julio de 2026" y la SPA no lo usa (sólo lo pasa al modal de insights, :4119). Como el conteo viene del array, un periodo de 30D con días sin menciones titula "los últimos 27 días", y 1D titula "los últimos 1 días".
- *Importa porque:* El titular es la afirmación más fuerte de la pantalla y su número no es el periodo seleccionado sino cuántas filas trajo la consulta: cuando falta un día, el título miente sobre la ventana. Y las fechas ISO son la única cadena en formato máquina en una pantalla que en todas las demás partes dice "27 jul".
- *Arreglo:* Derivar el título del periodo pedido (o de periodStart/periodEnd), no de dailySeries.length, y pluralizar ("del último día" / "de los últimos N días"). Sustituir el subtítulo por periodLabel. Un único formateador de fechas para SPA + tooltips (hoy el tooltip del chart imprime 2026-07-21 y el eje 21 jul, charts.js:393 vs :441).

**· [OV-15] La pantalla nunca nombra a la agencia: el sujeto de los datos es un <select> de 12px en el chrome** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:4164-4184 (OverviewHero) y apps/web/public/eco-prototype/shell.js:438-449 (switcher)`
- El hero dice "Conversación pública de los últimos 7 días" sin decir de quién; la única marca de agencia es el desplegable "DDEC" a 12px arriba a la derecha (probe: select de 59×17px). El mismo layout sirve a DDEC, AAA, JGO y SGPR.
- *Importa porque:* Es la pantalla que se proyecta y se captura. Una imagen del Overview no se puede atribuir a un organismo, y con cuatro agencias en un mismo login el riesgo de leer los datos de otra es real. Mientras tanto, el eyebrow "01 · TERMÓMETRO · VS VENTANA PREVIA" ocupa una línea entera para no decir nada nuevo.
- *Arreglo:* Poner la agencia en el hero: "DDEC · Conversación pública · 21–27 de julio de 2026", con la sigla como el fragmento de mayor peso, y dejar el switcher del header como control (no como etiqueta). Recuperar la línea del eyebrow 01 para eso.

**· [OV-16] La numeración 01..05 está escrita a mano sobre secciones condicionales y en dos ubicaciones distintas: deja huecos y rompe el ritmo** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:4196 (01, fuera de card), :4283 (02, dentro de la card), :4334 (03, título de card), :4378 (04, título de card), :4520 (05, fuer…`
- En overview-desktop.png se ve que 01 y 05 son etiquetas de sección sobre el fondo (--bg) y 02/03/04 son títulos dentro de la card (--canvas), con dos tamaños y dos colores para el mismo rol. Y como los literales están hardcodeados: si crisisRiskScore es null la sección 02 desaparece por completo (return null) y quedan 01, 03, 04, 05; si no hay tendencia o tópicos, esas cards se degradan a un recuadro gris sin número.
- *Importa porque:* Una secuencia numerada promete completitud. Un usuario de AAA o JGO —agencias con menos datos— verá 01, 03, 04, 05 y concluirá razonablemente que la herramienta le está escondiendo algo, o que se rompió. Y las dos ubicaciones del mismo device hacen que el ojo no encuentre un patrón de escaneo.
- *Arreglo:* O se elimina la numeración (recomendado: no aporta orden que el layout no comunique ya), o se genera desde un array de secciones que sepa cuáles se renderizaron, con una sola ubicación (siempre eyebrow fuera de la card) y un solo estilo (--fs-overline + --text-2). Las secciones sin datos deben conservar su encabezado y mostrar el estado vacío debajo, nunca desaparecer.

**· [OV-17] En la tabla de tópicos la longitud de barra no codifica nada: 9 barras idénticas donde el volumen debería verse** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:4360-4372 (DistributionBar normaliza a row.total) y :4395/4416-4422 (grid 1.4fr / 110px / 1fr)`
- Muestreo de píxeles: las 9 barras (8 tópicos + total) empiezan y terminan exactamente en los mismos x (983→1395 css) aunque los volúmenes van de 249 a 79. El único encoding de magnitud es un número de 14px alineado a la derecha en una columna de 110px. No hay leyenda de los tres colores en esta card (la de sentimiento está ~800px arriba) y los únicos rótulos de composición son atributos `title`, que no existen en táctil.
- *Importa porque:* Un tercio del ancho de la card —el canal visual más potente— se gasta en información constante, y la comparación que el lector quiere hacer (qué tópico pesa más) queda en el canal más débil. Encima, ocho barras tricolores idénticas leen como "todos los tópicos son iguales", que es lo contrario de lo que dicen los núme…
- *Arreglo:* Dos canales, dos tareas: barra de VOLUMEN proporcional al máximo (249 = 100% del ancho) segmentada por sentimiento — así longitud = volumen y composición = color, sin perder nada. Añadir leyenda de tres swatches en el card-hd y los porcentajes de neg/neu/pos como texto en hover Y en foco (no `title`). Mantener la barra al 100% sólo en la fila TOTAL, marcada como tal.

**· [OV-18] Tres patrones de interacción distintos y dos callejones sin salida para teclado, señalizados por una flecha de 11px a 2.65:1** · `affordance`

- `apps/web/public/eco-prototype/screens.js:4212 (<button> card), :4269 (<button> card), :4391-4400 (<div onClick> sin role ni tabIndex), :4225/:4285 (Icons.ArrowRight size…`
- Termómetro y crisis son <button> reales; las filas de tópicos son <div onClick> con `row-hover` como única señal (no enfocables, no accionables con Enter); el chart es un <svg> con onClick sobre toda su superficie y sin ningún elemento enfocable. La pista de clickeabilidad en las cards es una flecha de 11px en var(--text-3) (contraste 2.65:1 según el probe); en las filas, ninguna hasta el hover; en el chart, sólo la frase del subtítulo.
- *Importa porque:* Sobre esta pantalla se navega a todo lo demás. Si el usuario no descubre que las tarjetas y las filas abren el detalle de menciones, el Overview se queda en póster; y quien navega con teclado (obligación en un entorno público) no puede llegar a la mitad de las acciones.
- *Arreglo:* Una sola primitiva clickeable de card/fila: <button> o role=button + tabIndex=0 + :focus-visible visible, con la flecha a 14px y var(--text-2) y un cambio de borde en hover/focus. Para el chart, añadir un botón enfocable por día (o un <select> de día) además del click en el lienzo, y un resumen tabular accesible (los datos ya están en dailySeries).

**· [OV-19] En tablet (768) y móvil la comparación de tres cantidades se convierte en tres tarjetas apiladas de pantalla completa y deja de ser comparación** · `density`

- `apps/web/public/eco-prototype/screens.js:4197 (ecoCols('repeat(3, 1fr)', '1fr'), sin variante tablet) y apps/web/public/eco-prototype/shell.js:44 (w <= 768 cuenta como '…`
- overview-tablet-fold.png: a 768px las cards NEGATIVO/NEUTRAL/POSITIVO ocupan las tres cuartas partes del primer viewport, ~200px cada una, con el número a 30px alineado a la izquierda y ~85% de la card vacía; el gauge de crisis queda fuera de la vista. En overview-mobile.png el patrón se repite y el contenido total llega a 3,598px de alto. Como el corte es w<=768, un iPad en vertical apila y el mismo iPad en horizontal (1024) muestra l…
- *Importa porque:* El nombre del bloque es "termómetro": su valor es la comparación 583 / 456 / 274 de un vistazo. Apilado, con el mismo tamaño de cifra y el mismo eje x, se convierte en tres hechos aislados y el lector tiene que recordar el anterior mientras hace scroll. El reflow es técnicamente correcto y funcionalmente destructivo.
- *Arreglo:* Nunca romper un conjunto comparativo en columna: a ≤768 colapsar los tres en UNA card con tres filas (etiqueta · número · % · delta) más una barra de composición 100% —el patrón que ya existe en DistributionBar—, o mantener 3 columnas compactas (a 390px tocan ~118px cada una, suficiente para "583 44%" a 22px). Añadir la variante tablet a ecoCols en este grid.

**· [OV-20] En móvil la fila de tópico se parte en tres bloques y la barra se despega de su número: ocho barras idénticas sin dueño** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:4395 (ecoCols('1.4fr 110px 1fr', '1fr')) y :4416-4422`
- overview-mobile.png y m-topics2.png: cada tópico ocupa ~150px en tres bandas — nombre + subtópicos a la izquierda, el conteo (249 / 19%) suelto y alineado a la derecha en su propia línea, y debajo una barra tricolor a todo el ancho. Ocho repeticiones idénticas encadenadas ocupan ~1,300px de los 3,598px del documento.
- *Importa porque:* El número queda flotando sin etiqueta a la derecha (el ojo tiene que volver arriba-izquierda para saber de qué tópico es) y la barra, que a ese ancho es la más llamativa de la fila, no dice ni volumen ni de qué tópico habla. La lista deja de ser tabla y se vuelve un ritmo de bandas sin información.
- *Arreglo:* En móvil: nombre en la primera línea con el conteo en la MISMA línea alineado a la derecha (patrón de lista clásico), subtópicos en la segunda a --fs-caption, y barra de 4px pegada bajo el nombre (no separada por 12px). Con la barra proporcional de OV-17 la lista se vuelve legible sin números.

**· [OV-21] En móvil el chart queda en ~110px de trazado, con canal muerto de 44px y un eje de fechas irregular (21, 23, 24, 26, 27)** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:188 (padding l/r/t/b fijos, height 240 pasado desde screens.js:4344) y :425-443 (maxLabels = innerW/50)`
- m-chart2.png / m-topics2.png: el encabezado de la card ocupa 3 líneas, la leyenda envuelve en 2 filas y al trazado le quedan ~110px de alto; las etiquetas del eje se reducen a 21, 23, 24, 26, 27 jul — huecos de 2, 1, 2 y 1 día — y los tres pares de curvas se superponen casi por completo (el pico del 22 jul, que no está rotulado, es donde las tres se tocan).
- *Importa porque:* Con espaciado irregular y sin rótulo en el pico, el usuario atribuye el evento al día equivocado; el apagón del martes 22 se lee como "entre el 21 y el 23". Y el gutter de 44px reservado para un eje que no existe se lleva el 11% del ancho de un iPhone.
- *Arreglo:* Padding responsivo (l: 8 sin eje, r: 56 con etiquetas, t: 16 en móvil) y altura mínima de trazado de 160px. Para el eje X en móvil: mostrar sólo primer y último día más el máximo, con espaciado uniforme, y anotar el pico con su fecha directamente sobre la curva. Envolver la leyenda en dos líneas ordenadas (una por serie) en vez de flex-wrap arbitrario.

**· [OV-22] 47 instancias de texto bajo el mínimo WCAG en esta pantalla, incluidas todas las cuotas % y todas las etiquetas del gauge de crisis** · `contrast`

- `probe-report.json → key="overview" (idéntico en los 4 viewports); orígenes: apps/web/public/eco-prototype/screens.js:4231, :4298-4300, :4407, :4420, :4433, :4442 y apps/…`
- El probe reporta 47 elementos entre 2.65:1 y 2.89:1 contra el 4.5:1 requerido, todos con color rgb(82,91,104) = --text-3: los "44% / 35% / 21%" del termómetro (12px), las cuatro bandas NORMAL/ELEVADO/ALERTA/CRISIS (9px), los % de cada tópico (10px), los subtópicos y "+N también lo tocan" (11px), "DATOS AL CIERRE DE AYER" (10px), los chips de periodo inactivos (11px) y los dos eyebrows de sección (10px/700).
- *Importa porque:* No es un tema abstracto de accesibilidad: lo que está por debajo del umbral es justamente el contexto que evita malinterpretar los números grandes (la cuota, la banda del gauge, la base de comparación). En una sala con proyector o en un móvil al sol, la pantalla se reduce a las cifras sin su contexto — y las cifras si…
- *Arreglo:* Ya está resuelto a nivel de token en la capa nueva (tokens.css: --text-3 #7C8798 = 5.00:1); lo que falta es que esta pantalla lo consuma. Sustituir los fontSize/color literales por --fs-caption (12px piso) / --fs-overline (11px, sólo eyebrows en mayúsculas) y por var(--text-2) para todo lo que sea contexto de un número. Regla de sistema: ningún dato ni su unidad puede ir en --text-3.

**· [OV-23] 228px antes del primer dato —con el botón de tema solo en su propia línea por un flex-wrap accidental— y la síntesis accionable a ~1,000px de scroll** · `hierarchy`

- `apps/web/public/eco-prototype/shell.js:401 (flexWrap:'wrap' con el toggle de tema como último hijo, :549-551) y apps/web/public/eco-prototype/screens.js:4156-4158 (Insig…`
- Medición sobre overview-desktop-fold.png (1440×900): la hairline inferior del header está en y=114 y la primera card empieza en y=228 — 25% del viewport antes del primer número. De esos 114px, ~46 son una segunda fila del header que contiene únicamente el botón de sol: el header es flex con wrap y el control menos importante es el que envuelve. El bloque "Resumen del periodo" (con "Lo que vigilaría esta semana") queda en y≈1,700 en des…
- *Importa porque:* La conclusión llega última y la decoración primero. Quien abre el Overview por la mañana debería leer en el primer viewport: qué agencia, cuántas menciones, si hay riesgo y qué mirar hoy; hoy lee un botón de tema, un eyebrow numerado y tres cifras sueltas.
- *Arreglo:* (1) Sacar el toggle de tema del header (al menú de usuario o al TweaksPanel) y ordenar los controles por prioridad para que lo que envuelva sea lo accesorio; el header baja a ~68px. (2) Subir el veredicto: hero con agencia + total + banda de crisis en una sola línea de titular, y la frase "Lo que vigilaría" como bloque destacado justo debajo (el orden actual fue una petición del usuario: se puede respetar dejando los tres bloques de IA…

**· [OV-24] Cuatro dialectos de carga/vacío/error en una sola pantalla, y un error crudo sin reintento** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:4049-4062 (error con string crudo + "Cargando…" que reemplaza toda la pantalla), :4323-4328 y :4351-4356 (recuadros grises sin e…`
- En el primer render toda la pantalla es una card centrada con "Cargando…"; luego aparece todo de golpe (salto de layout completo) mientras los insights muestran skeletons y un "GENERANDO…" naranja pulsando; si una sección viene vacía se degrada a un recuadro gris sin título; si /api/overview falla, la pantalla entera se sustituye por "No se pudo cargar el Overview: HTTP 500" sin botón de reintento.
- *Importa porque:* El estado de carga es parte del producto: aquí enseña cuatro gramáticas distintas en 90 segundos y, en el peor caso, le muestra a un usuario de gobierno un código HTTP sin salida. Además el reemplazo total impide anticipar la estructura y produce un salto que descoloca el scroll.
- *Arreglo:* Una sola primitiva de estado por card: skeleton con la MISMA geometría del contenido (nunca reemplazar la pantalla), encabezado siempre presente, y para el vacío una frase que explique la causa ("Sin menciones clasificadas en esta ventana") en --text-2. Para el error: mensaje humano + "Reintentar" + el detalle técnico plegable. Reutilizar la misma primitiva en las cinco secciones y en los insights.

**· [OV-25] Dos porcentajes con denominadores distintos pegados uno debajo del otro y sin base declarada** · `copy`

- `apps/web/public/eco-prototype/screens.js:4231 (pct = value/total) y :4233-4236 (delta vs ventana previa), eyebrow en :4196`
- La card muestra "583" · "44%" en la misma línea base y "▲+34%" 8px debajo, ambos con tipografía de peso 600 y tamaños casi iguales (12 y 11px). El 44% es cuota del total del periodo; el +34% es variación contra la ventana previa. La única pista es el eyebrow "01 · TERMÓMETRO · VS VENTANA PREVIA" a 10px y 2.89:1, que además desaparece del campo visual en móvil.
- *Importa porque:* La lectura errónea más natural ("la cuota negativa subió 34 puntos, del 10% al 44%") es catastróficamente más alarmante que la realidad, y es la que va a repetir quien resuma la pantalla en voz alta.
- *Arreglo:* Rotular cada número con su base junto al valor, no en un eyebrow: "44% del total" y "+34% vs 7 días previos". Diferenciar tipográficamente cuota (peso normal, --text-2) de variación (con flecha y color) y usar el mismo par de etiquetas en el correo diario para que dashboard y correo se lean igual.

### P2 (3)

**· [OV-26] Convenciones numéricas y de idioma mezcladas: "43.0" menciones, "1.3K" vs "1,313", .num aplicado a una palabra, "click un día", dos <h1>** · `consistency`

- `apps/web/public/eco-prototype/charts.js:251 (v.toFixed(1) como fallback) y :245; apps/web/public/eco-prototype/screens.js:132-137 (fmt) vs :4180 (toLocaleString), :4288…`
- La leyenda del chart muestra "43.0 / 54.0 / 36.0" para conteos enteros de menciones (el switch de fmtVal no cubre las claves negative/neutral/positive y cae en toFixed(1)); el mismo 1,313 aparece como "1,313" en el hero y "1.3K" en el total y en el badge; la clase .num (cifras tabulares) se aplica al texto "Alerta"; el subtítulo del chart usa el anglicismo "click"; hay dos <h1> en la página y dos de los nueve ítems de nav están en ingl…
- *Importa porque:* Cada detalle es menor y juntos son la diferencia entre "herramienta de gobierno" y "prototipo": un decimal en un conteo entero sugiere una precisión que no existe, y "Overview"/"click" delatan que la interfaz no se escribió para su lector.
- *Arreglo:* Un módulo único de formato para la SPA con reglas explícitas: conteos sin decimales y con separador de miles (sin abreviar bajo 10K), métricas 0–1 como porcentaje entero, .num sólo en cifras. Renombrar "Overview"→"Resumen" y "Scorecard"→"Indicadores"; "haz clic en un día". Un solo <h1> por página (el del hero) y el del header como <p>/<h2>.

**· [OV-27] El sentimiento neutral usa var(--text-3), la misma tinta que el texto secundario y deshabilitado** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:4191 (accent del card NEUTRAL), :4320 (serie neutral del chart), :4368 (segmento neutral de la barra); tokens.css:207 (--neu: va…`
- El punto del card NEUTRAL, la línea gris del chart y el segmento central de las 9 barras de tópicos son rgb(82,91,104) — exactamente el color de "+105 también lo tocan", de los % de tópico y de los chips de periodo inactivos. La capa de tokens nueva declara --neu pero lo aliasa al mismo valor.
- *Importa porque:* Un tercio de los datos (456 de 1,313 menciones) se pinta con el color que el resto de la interfaz usa para "esto importa menos". El lector descuenta el neutral sin darse cuenta, y en la barra de tópicos no puede distinguir dato de fondo.
- *Arreglo:* Dar a --neu un valor propio, cromático y distinguible del texto (p.ej. un azul-gris desaturado #6E8BA8) y usarlo en las tres apariciones. Regla: los colores de las categorías de datos nunca se aliasan a colores de texto de la interfaz.

**· [OV-28] Los controles que definen el alcance de toda la pantalla miden 22–26px de alto en móvil** · `touch-target`

- `probe-report.json → key="overview", viewport mobile (25 targets <44px); apps/web/public/eco-prototype/shell.js:452-470 (chips de periodo, padding 4px 10px) y :474-487 ("…`
- El probe mide en móvil: 1D/5D/7D 34×22, 30D/Max 41×22, 3M/6M 36×22, "Fechas" 74×26, "⌘K" 24×22, y el select de agencia 59px de ancho. Todos por debajo del mínimo de 44px, y son los controles que cambian el periodo y la agencia — es decir, el significado de los 1,313 y de las cinco secciones.
- *Importa porque:* En un teléfono, tocar 7D y acertar 5D cambia todos los números de la pantalla sin ningún aviso, y no hay forma de saber que se equivocó salvo releer el subtítulo del hero. El error es silencioso y contamina la lectura completa.
- *Arreglo:* En móvil, altura mínima de 44px para chips y botones del header (min-height con padding vertical, no font-size mayor), y agrupar los 8 presets en un desplegable único de periodo con etiquetas largas ("Últimos 7 días") a ≤768. La corrección vive en el shell y beneficia a las 10 pantallas.


## Scorecard táctico

*23 hallazgos*

El Scorecard es la pantalla donde el cliente toma decisiones y hoy es la menos fiable del producto: no porque falten datos, sino porque cada widget resuelve su propia verdad. En una sola vista conviven cinco cifras distintas de "menciones" (4.0K en el KPI, 1.3K en el enlace, 1,024 en el resumen IA, 999 en el heatmap, 4.0K en el badge del rail), una gráfica de 30 días bajo un selector que dice 7D, y tres escalas de banda cuyas etiquetas están colocadas por reparto tipográfico (`space-between`) y no en sus umbrales reales — de modo que un 41% que el sistema clasifica como ALERTA aparece visualmente bajo la palabra ELEVADO. El color, que debería ser el atajo cognitivo, es lo primero que engaña: polarización ALTA se pinta en verde, la banda FUERTE de Brand Health usa el mismo naranja que la banda CRÍTICO, y crecer +42% en volumen es verde mientras crecer +12% un tópico es rojo. La jerarquía está invertida: la palabra cualitativa mide 30px y el dato medible 13px, con cinco gramáticas visuales distintas en cinco tarjetas contiguas; el veredicto del NSS ("Neutral") se pinta con el color terciario del sistema y se lee como deshabilitado. En móvil el reflow "funciona" (cero desbordes de página) pero la jerarquía se pierde: el primer indicador aparece en la segunda pantalla, el titular de cada mención se comprime a 130px mientras engagement y hora quedan fuera del viewport, y el subtítulo de la gráfica cae en una columna de una palabra por línea. Nada de esto es cosmético: es un panel de gobierno que hoy puede hacer que alguien concluya "estamos en ELEVADO" cuando el modelo dice ALE…

### P0 (7)

**✔︎ [SC-01] La barra dice 7D y los datos son de 30 días: el periodo por defecto está partido en dos** · `data-integrity`

- `apps/web/public/eco-prototype/index.html:1356 vs app.js:242 (y shell.js:66)`
- El boot que hace el fetch usa `localStorage.getItem('eco.period') || '1M'`; el estado de React que pinta la barra usa `|| '7D'`. En dashboard-desktop.png el chip 7D está activo mientras el eje X del chart va del 28 jun al 27 jul (30 puntos), 'Fuentes top' dice '30d' y el KPI VOLUMEN suma 4.0K. `getPeriodParams()` en shell.js también arranca en '1M', así que hay tres defaults distintos.
- *Importa porque:* En la primera visita de cualquier usuario (o en ventana privada, o tras limpiar el navegador) TODOS los números, el chart y los deltas del Scorecard corresponden a 30 días mientras la interfaz afirma que son 7. Un usuario de gobierno que reporta 'esta semana cerramos con 4.0K menciones' está citando un mes. Sólo se co…
- *Arreglo:* Un único default en un solo sitio: exportar `ECO_DEFAULT_PERIOD = '7D'` desde shell.js y consumirlo en index.html:1356, app.js:242 y getPeriodParams(). Además, devolver el periodo efectivo en la respuesta de /api/eco-data (`period`, `from`, `to` — ya existe en route.ts:1292) y que la barra pinte el chip a partir de ese valor, no de localStorage; así la UI nunca puede afirmar una ventana distinta a la que se graficó.
- *Verificador:* SC-01 · P0 — "El chip de periodo puede afirmar una ventana distinta a la que se consultó" Evidencia (código, no captura): el boot de `index.html:1356` pide `/api/eco-data?period=1M` (30 días, `apps/web/src/app/api/eco-data/route.ts:29`) cuando `localStorage.eco.period` está vacío, mientras el estado que pinta la barra (`app.js:242`) arranca en `'7D'` y `shell.js:432-470` ilumina el chip a partir de ese estado. Resultado: en el primer render de cada sesión limpia — y `window.ecoSignOut` hace `localStorage.clear()`, así que eso es cada inicio de sesión tras cerrar sesión — la barra dice 7D y el dashboard grafica 30 días. Se corrige solo en la siguiente carga. Defectos gemelos del mismo diseño…

**✔︎ [SC-02] Cinco totales de 'menciones' en una pantalla, y el drill-down contradice la tarjeta que abriste** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:452, 573, 336, 668 y shell.js:84`
- En dashboard-desktop.png: KPI 'VOLUMEN · PERÍODO' 4.0K (screens.js:452 = suma de `D.TIMELINE.totalMentions`, tabla de snapshots), enlace 'Ver todas (1.3K)' (screens.js:573 = `m.totalMentions`, ventana calculada sobre la tabla de menciones), resumen IA '1,024 menciones', heatmap '999 menciones' (screens.js:668 = suma de HOUR_HEATMAP), badge del rail 4.0K (shell.js:84). Y al hacer click en la tarjeta de 4.0K, `openMetric('volume')` pasa…
- *Importa porque:* Es el hallazgo que más daño hace en una demo: el cliente no necesita entender de fuentes de datos para ver que la misma métrica vale 4.0K, 1.3K, 1,024 y 999 en la misma pantalla, y que al hacer click en un número aparece otro. Destruye la confianza en todo lo demás, incluidas las métricas que sí están bien.
- *Arreglo:* Definir 'menciones del período' como un único campo del API (`CURRENT_METRICS.totalMentions`, misma fuente y mismo dedup que usa el resumen IA) y consumirlo en los cinco sitios: KPI, enlace, badge, heatmap y prompt del briefing. Si la suma de snapshots difiere de la ventana viva, no mostrar ambas: exponer una sola y, si hace falta, un tooltip 'según cierre diario' con la diferencia. El heatmap debe rotular su propio alcance ('999 en la…
- *Verificador:* Severidad correcta: P1 (degrada la confianza), no P0. Título corregido: "El KPI de volumen y su propio drill-down se calculan de dos fuentes distintas (snapshots vs ventana viva)". Evidencia corregida: DOS fuentes rivales, no cinco. (a) KPI "Volumen · período" (screens.js:452) y badge de Menciones (shell.js:84-85) = suma de daily_metric_snapshots dentro de la ventana; (b) enlace "Ver todas" (screens.js:573) y el modal que abre la propia tarjeta (screens.js:336) = CURRENT_METRICS.totalMentions, recuento vivo sobre la tabla mentions. Medido en prod: 47 vs 54 (≈13%) — el usuario hace click en una tarjeta y el modal titula otro número. El heatmap comparte baseWhere con la ventana viva, así que…

**✔︎ [SC-03] Las tres escalas de banda colocan sus etiquetas por reparto tipográfico, no en su umbral: el rótulo nombra la zona de color equivocada** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:447-449 (crisis), 470-472 (polarización), 641-643 (Brand Health)`
- Los tres pies de escala usan `display:flex; justifyContent:'space-between'`, así que los rótulos caen en 0/33/66/100% del ancho. Los umbrales reales no están ahí: crisis corta en 25/40/60 (CRISIS_GRADIENT, screens.js:34), BHI en 40/60/80 (segments, screens.js:612-617) y polarización en 30/50/75 (metrics-display.ts:166-171) — con el gradiente además cortando en 30/60 (screens.js:467). En el recorte del gauge de crisis se ve el knob de 4…
- *Importa porque:* El gauge de crisis es el widget con más consecuencia política del producto. Tal como está, un valor dentro de la banda CRISIS aparece entre las palabras ALERTA y CRISIS, y un ALERTA aparece sobre ELEVADO: el error es sistemático y siempre hacia subestimar. Alguien que lea el gráfico en vez del titular reportará una ba…
- *Arreglo:* Reemplazar los pies `space-between` por rótulos posicionados en el umbral: contenedor `position:relative` y cada etiqueta en `left: <umbral>%` con `transform: translateX(-50%)` (los extremos anclados a 0/100% con `translateX(0)`/`(-100%)`), más una marca de tick de 1px sobre la barra en cada corte. Sacar los cortes a una única constante por métrica reutilizada por gradiente, ticks y `metricBand()` para que no puedan divergir. En polari…
- *Verificador:* Rebajar a **P1 (alto)**, no P0, y corregir dos imprecisiones + ampliar el alcance: 1) **Severidad P1.** El hallazgo no produce un veredicto falso: en la misma card, y en tipografía mucho mayor, aparecen la palabra de banda y el número, ambos correctos y calculados desde una única fuente (`crisisBand` en `screens.js:35-41`, `polarizationBand`/`brandHealthBand` en `packages/shared/src/format/metrics-display.ts`). "Alerta · 41%", "Débil · 6.2/10" y "Moderada · 46%" son exactos. La escala de banda es una anotación secundaria: el lector que la interpreta posicionalmente entra en contradicción con el titular de su propia card y la resolverá en favor del titular. Degrada la confianza y obliga a re…

**✔︎ [SC-04] Polarización ALTA se pinta en verde y EXTREMA en amarillo: la escala de color no crece con la gravedad** · `color-semantics`

- `packages/shared/src/format/metrics-display.ts:93-95 (BAND_TONE)`
- `MODERADA: 'warn'`, `ALTA: 'pos'`, `EXTREMA: 'warn'`. La secuencia de color por gravedad creciente queda gris → amarillo → VERDE → amarillo. En dashboard-desktop-fold.png la tarjeta muestra 'Moderada' en amarillo; con un punto más de polarización el veredicto pasaría a verde. El token colisiona porque la tabla es única para 4 métricas y 'ALTA' también significa 'buena' en pertinencia/sentimiento.
- *Importa porque:* La polarización alta es precisamente la señal de crisis emergente que el producto promete detectar (el propio comentario en screens.js:461 lo dice). Mostrarla en verde le dice al usuario 'todo bien' en el momento exacto en que debería alarmarse. Y como esta tabla alimenta también los correos [Diario]/[Semanal], el err…
- *Arreglo:* Dejar de mapear por token de texto y mapear por métrica + índice de banda: `TONE_BY_METRIC = { polarization: ['neutral','warn','neg','neg-strong'], crisis: [...], bhi: [...], nss: [...] }`. Mientras se refactoriza, corrección mínima: `ALTA: 'neg'`, `EXTREMA: 'neg'` con distinción por intensidad (`--neg` vs `--neg` + peso 700). Añadir un test que verifique monotonía: para cada métrica, el índice de tono no puede decrecer al subir de ban…
- *Verificador:* El hallazgo es correcto pero está SUBDESCRITO en tres puntos que lo hacen más fuerte y cambian el arreglo: 1. **La misma tarjeta ya se contradice a sí misma, hoy, con los datos actuales.** No hay que esperar "un punto más". En `dashboard-desktop-fold.png` la tarjeta POLARIZACIÓN pinta la palabra "Moderada" en ÁMBAR sobre una mini-barra de banda cuya escala es `APÁTICA` gris → `MODERADA` ámbar → `ALTA` **morado `#8B5CF6`** → `EXTREMA` morado/rojo (`shell.js:1590` para el drawer; `screens.js:463-468` usa `#8B5CF6` como accent y borde del marcador). O sea: la barra ya codifica ALTA como morado-grave, y la palabra la codificará como verde-sano. Leyenda y veredicto en el mismo componente, discre…

**✔︎ [SC-05] En Brand Health la banda FUERTE (la mejor) se pinta igual que CRÍTICO (la peor)** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:612-617 y packages/shared/src/format/metrics-display.ts:97`
- Los segmentos son `[--neg, --warn, --pos, --accent]` y `FUERTE: 'accent'`. En el tema activo de la captura `--accent` y `--neg` eran literalmente el mismo `#FF6A3D` (index.html@8a996a8:198 y 203), así que el primer y el cuarto segmento salen del mismo color: se ve en el recorte de la tarjeta (marrón rojizo a la izquierda y a la derecha, verde en el tercero). El commit 92e0d4a separó los tokens a `--neg:#FF5470` / `--accent:#FF6A3D`, pe…
- *Importa porque:* La barra es el único elemento que comunica 'cuánto me falta para estar bien'. Con el extremo bueno pintado como el extremo malo, un 9.1/10 y un 2.0/10 producen la misma sensación visual, y el usuario deja de usar la barra (que es la parte cuantitativa) para quedarse con la palabra.
- *Arreglo:* Sacar `--accent` de la escala de bandas: rampa monótona `CRÍTICO → --neg`, `DÉBIL → --warn`, `SANO → --pos` y `FUERTE → --pos` reforzado (p.ej. `color-mix(in oklab, var(--pos) 85%, white)`), y `FUERTE: 'pos'` en BAND_TONE. `--accent` debe quedar reservado a 'interacción/marca', nunca a un nivel de una escala ordinal.
- *Verificador:* El hallazgo es correcto pero está SUB-especificado en dos aspectos; la versión que debe publicarse es: 1. **Alcance: son tres sitios, no dos.** Falta `apps/web/public/eco-prototype/shell.js:1556-1563`, donde el modal de detalle de métrica duplica la tabla a mano (`if (['FUERTE'].includes(b)) return 'var(--accent)'`) y la usa tanto para el texto de la banda (`shell.js:1651`) como para el borde del marcador en la barra gradiente (`shell.js:1680`). Arreglar solo `screens.js` + `metrics-display.ts` deja el modal roto. Además `metrics-display.ts` es paquete compartido: el mismo mapeo alimenta los correos, así que el defecto es multi-superficie (dashboard + modal + correo), y hay un test que lo f…

**✔︎ [SC-06] La gráfica principal no tiene eje Y, normaliza cada serie a su propio min/max y apoya la base en el mínimo — e invita a superponer tres** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:220-227 (normalización), 293-302 (labels sólo si sharedScale) y screens.js:482, 484-503 (chips)`
- En la rama por defecto (la que usa el Scorecard) `min = Math.min(...vals)` y `max = Math.max(...vals)` por serie, y las 5 líneas de rejilla se dibujan pero sólo se rotulan `if (sharedScale)`. En dashboard-desktop.png hay una rejilla de 5 niveles sin un solo número y un pico que ocupa toda la altura; el subtítulo de la tarjeta dice 'Selecciona hasta 3 series'.
- *Importa porque:* Con la base en el mínimo y sin eje, una variación de 120→180 menciones se dibuja igual que una de 0→180: el pico del 22 jul parece salir de cero. Y en cuanto el usuario acepta la invitación y activa 2-3 series, cada línea tiene su propia escala invisible: los cruces entre 'Crisis' y 'Brand Health' no significan nada y…
- *Arreglo:* Rotular siempre el eje: sacar la condición `sharedScale` de charts.js:296 y etiquetar con `fmtVal` de la serie primaria. Para volúmenes forzar `min = 0` (o marcar la base recortada con una banda de corte explícita). Para multi-serie, sustituir la normalización silenciosa por ejes dobles rotulados (izq/der, máximo 2 series) o por índice explícito con la leyenda diciendo 'base 100 = 28 jun'; conservando el suavizado Catmull-Rom, que es l…
- *Verificador:* Dos precisiones sobre la evidencia (no cambian el veredicto ni la severidad): 1. "sin un solo número" es inexacto. La tarjeta SÍ expone valores puntuales por tres vías: el value-strip superior con el valor y el delta vs. el primer punto (`charts.js:259-276`), el tooltip flotante en hover con fecha + valor exacto por serie (`charts.js:388-404`) y el tag del último punto (`charts.js:409-420`). Lo que falta no son valores, es **escala**: ningún tick del eje Y, ninguna indicación de dónde está el cero, ningún aviso de que cada serie corre en su propia escala. Y el hover no existe en táctil, así que en móvil (390) el lector se queda sólo con el tag del último punto — que además sale recortado (F…

**✔︎ [SC-08] 'Tópicos emergentes · Ordenados por crecimiento' está ordenado por volumen, y el signo del crecimiento se colorea al revés que en el KPI de al lado** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:516, 520 y 525`
- El subtítulo dice 'Ordenados por crecimiento' pero la lista es `D.TOPICS.slice(0,5)` sin ordenar: en dashboard-desktop.png sale 253/213/173/159/133 (volumen descendente) con deltas +12%, −8%, +4%, +31%, +6%. El tópico que más crece (+31%, Energía e infraestructura) aparece cuarto. Y el color es `t.delta > 0 ? 'var(--neg)' : 'var(--pos)'`: +12% en rojo, −8% en verde — mientras a 30cm de distancia el KPI VOLUMEN pinta +42% en verde.
- *Importa porque:* El usuario abre esta tarjeta para una sola pregunta —qué está subiendo— y la respuesta que lee es la equivocada. El doble estándar de color agrava el problema: en la misma pantalla el mismo signo significa 'bien' arriba y 'mal' abajo, así que el lector no puede aprender la convención y termina ignorando el color.
- *Arreglo:* Ordenar de verdad por delta (`[...D.TOPICS].sort((a,b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity))`, la misma expresión que ya usa el briefing en route.ts:1168-1169) o cambiar el subtítulo a 'Ordenados por volumen'. Para el color, separar dirección de juicio: el delta de un tópico es neutro (usar `--text-2` con la flecha) y reservar rojo/verde para el sentimiento del tópico, que es lo que sí tiene signo moral. Etiquetar además…
- *Verificador:* Mantengo P0 pero afino la descripción y el arreglo: (a) No es "una lista sin ordenar": el orden por volumen es el contrato explícito del API (`route.ts:542-543 ORDER BY p.primary_count DESC LIMIT 12`). Por eso, si se elige la opción "ordenar de verdad", el sort en el cliente sobre `D.TOPICS.slice(0,5)` NO basta: hay que ordenar por delta ANTES de cortar (`[...D.TOPICS].sort(deltaDesc).slice(0,5)`), porque el API ya truncó a 12 por volumen y el tópico que más crece podría estar fuera de esos 12. Lo más honesto y barato es lo segundo que propone el auditor: cambiar el subtítulo a "Ordenados por volumen · con su crecimiento" y dejar el orden como está; si se quiere de verdad "emergentes", el o…

### P1 (13)

**· [SC-09] Tres afirmaciones de frescura contradictorias en 200px, y la honesta es la más pequeña** · `copy`

- `apps/web/public/eco-prototype/app.js:154, screens.js:411 y 368, shell.js:415-423`
- El eyebrow dice 'Scorecard táctico · TIEMPO REAL' (app.js:154), el rail del hero 'PULSO EN VIVO · últimas menciones' (screens.js:411) y entre ambos, a 10px y en el color terciario, 'DATOS AL CIERRE DE AYER' (shell.js:422, añadido justamente para no engañar). En las capturas el pulso muestra 'hace 4 h' / 'hace 6 h' sobre una ventana que cierra ayer. El badge del resumen dice 'IA · RECIENTE' porque `generatedAtLabel || 'reciente'` (scree…
- *Importa porque:* El cliente ya reportó confusión sobre la frescura de los datos. Aquí la corrección honesta existe pero pierde contra dos afirmaciones falsas mucho más visibles, y 'RECIENTE' sin hora convierte un texto que puede tener 11 horas y describir 'el apagón del martes' en algo incuestionable.
- *Arreglo:* Un solo lugar y un solo lenguaje: quitar 'tiempo real' del eyebrow y renombrar el rail a 'Últimas menciones del período'. Subir 'Datos al cierre de ayer' a 11px con `--text-2` y darle el rango real ('7–27 jul'). En el badge de IA, mostrar siempre la hora de generación ('IA · hace 6 h'), nunca la palabra 'reciente'.

**· [SC-10] El resumen ejecutivo se lee roto: frases pegadas por el sanitizador y un campo del pie vacío** · `copy`

- `apps/web/public/eco-prototype/screens.js:206-209 (sanitizeBriefingHtml) y 386-390 (Señal dominante)`
- `String(html).replace(/<(?!\/?strong\b)[^>]*>/gi, '')` borra los tags de bloque sin dejar espacio: en las cuatro capturas se lee 'tras el apagón del martes.El lado positivo viene de Turismo'. Justo debajo, 'SEÑAL DOMINANTE' muestra un guion solitario (`|| '—'`) al lado de dos campos llenos ('4.8M impresiones', 'Explorar tópicos activos'), porque para los briefings de origen 'ai' el campo `dominant_signal` puede venir vacío mientras la…
- *Importa porque:* Es el texto de 18px que el cliente lee primero y probablemente el que copia a un correo o a una reunión de gabinete. Una frase pegada y una etiqueta con un guion hacen que el producto parezca un borrador, y el efecto es peor precisamente cuando el briefing viene de IA (la parte que se vende como diferencial).
- *Arreglo:* En el sanitizador, sustituir los tags de bloque por un separador antes de borrar el resto: `.replace(/<\/(p|div|li|br)[^>]*>/gi, ' ')` y luego colapsar espacios. En el pie, no renderizar el bloque cuando el valor está vacío (o rellenarlo con `TOPICS[0]` como hace la rama rule-based); nunca mostrar una etiqueta con placeholder en una fila de tres campos.

**· [SC-11] Cinco gramáticas visuales en cinco tarjetas contiguas, con el icono siempre sobre relleno naranja** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:430-474 (fila de KPIs) y 90 (tile del icono)`
- En dashboard-desktop-fold.png: NSS = palabra + delta + número + sparkline con área + pie '7d/30d'; Crisis = palabra + delta + % + gauge de gradiente con 4 rótulos; Volumen = número + delta + sub + sparkline sin escala ni pie; Brand Health = palabra + delta + 'x / 10' + barra de 4 segmentos con 5 ticks numéricos; Polarización = palabra + delta + '% · opinión vs neutral' + área morada + gauge de 3 paradas con 4 rótulos verbales. Además e…
- *Importa porque:* El scorecard existe para comparar de un barrido. Con cinco formatos de valor y cinco tipos de evidencia, el usuario tiene que re-aprender a leer en cada tarjeta, y las alturas internas dispares (el gauge de crisis deja un hueco vertical enorme en tablet) rompen el ritmo de la fila. El tile naranja bajo un icono verde…
- *Arreglo:* Definir DOS variantes de KpiCard y no más: 'banda' (palabra + número + escala con umbrales) y 'contador' (número + delta + sparkline con eje mínimo/máximo rotulado). Volumen usa 'contador'; NSS, Crisis, BHI y Polarización usan 'banda' con el MISMO componente de escala. Igualar la altura con `align-items: stretch` + una zona de evidencia de altura fija, y derivar el tile del icono del `accent` de la tarjeta (`color-mix(in oklab, ${accen…

**· [SC-12] El veredicto del NSS se pinta con el color terciario (parece deshabilitado) y el 64% del texto de la pantalla mide 11px o menos** · `type-scale`

- `apps/web/public/eco-prototype/screens.js:71 (TONE_C.neutral) y 102; censo en probe-report.json (dashboard/desktop → probe.fonts)`
- `TONE_C = { …, neutral: 'var(--text-3)' }` y la banda NEUTRAL del NSS mapea a tono 'neutral' (metrics-display.ts:99), así que la palabra de 30px 'Neutral' se pinta con el color de menor jerarquía del sistema: el probe la mide en 2.65:1 (necesita 3.0 incluso como texto grande) y en la captura se lee gris apagado junto a 'Alerta' naranja vivo. El censo de fuentes del probe: de 240 elementos de texto, 153 (64%) están a ≤11px y 50 a 9px; s…
- *Importa porque:* El único caso en que el sentimiento neto está 'bien' es justo el que se ve como si la tarjeta estuviera apagada o cargando; el usuario aprende a saltárselo. Y el texto que porta la información más consecuente —los umbrales de las escalas de crisis y salud— es el más pequeño y el de menor contraste de toda la pantalla.…
- *Arreglo:* Dejar de usar `--text-3` para valores: el tono 'neutral' de una banda debe ser `--text-2` como mínimo (y la palabra del KPI siempre `--text` con el color reservado a las bandas con juicio). Adoptar una escala de 6 pasos (11 · 13 · 15 · 18 · 24 · 32) y retirar 9px y 10px del sistema: los ticks de escala suben a 11px con `--text-2`, y los eyebrows a 11px con letter-spacing. Es lo que además hará legible el cambio a Krub, cuyo ojo medio e…

**· [SC-13] Dos botones primarios juntos: el selector de modo del briefing usa el mismo naranja que la acción principal** · `affordance`

- `apps/web/public/eco-prototype/index.html:373 y 391 (.chip.active y .btn-primary comparten --accent) y screens.js:400-408`
- En la fila del hero: 'Ver menciones' (`.btn btn-primary`, relleno naranja), un separador de 1px, y luego 'Señal del día' (`.chip active`, también relleno naranja en el tema mando) más dos chips inactivos. Las tres chips son en realidad un conmutador de modo del resumen (`setFocus`), no acciones — pero se ven como tres CTAs de los cuales dos están 'activos'.
- *Importa porque:* El usuario no sabe cuál es la acción y cuál el estado; en las pruebas del propio equipo este patrón ya generó la duda de por qué 'hay dos botones naranjas'. Peor: el conmutador está DEBAJO del texto y de los datos que controla, así que quien cambia de modo no ve que el párrafo de arriba se reescribió.
- *Arreglo:* Separar los roles a nivel de token: `.chip.active` con relleno sutil (`--accent-fill` + borde `--accent` + texto `--accent`) y el relleno saturado reservado a `.btn-primary`. Mover las tres chips arriba a la derecha del bloque, alineadas con el eyebrow 'Resumen ejecutivo', como un segmented control de pestañas; y dejar 'Ver menciones' como única acción al pie.

**· [SC-14] En móvil el titular de cada mención queda en 130px, engagement y hora se van fuera del viewport, y el dominio se corta sin puntos suspensivos** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:584 (grid 20px 2fr 130px 100px 100px, minWidth 560) y 590-592`
- probe-report.json (dashboard/mobile) mide 7 titulares con `clientW:130` y `scrollW` hasta 442, y sitúa `span.num «17.5K»` en x 345-445 y `span «hace 6 h»` en x 457-557 sobre un viewport de 390: fuera de pantalla, en un `.scroll-x` sin ninguna pista visual de que se puede desplazar. En el recorte se lee 'DDEC anuncia inversi…' y, peor, los dominios cortados en seco porque el div de autor/dominio (línea 592) hereda `overflow:hidden` del…
- *Importa porque:* El titular es el contenido; el badge POSITIVO/NEGATIVO es redundante con el color y sin embargo se queda con el ancho. Y un dominio truncado sin elipsis no se lee como 'cortado' sino como OTRO dominio: en una herramienta de monitoreo de gobierno, mostrar 'facebook.cor' como fuente de una mención es un error de credibi…
- *Arreglo:* En móvil abandonar la tabla: `grid-template-areas` de dos filas por mención (fila 1 = icono + titular a 2 líneas con `-webkit-line-clamp:2`; fila 2 = autor · dominio + badge + engagement + hora a 11px), eliminando el `minWidth:560`. Añadir `textOverflow:'ellipsis'; whiteSpace:'nowrap'` al div de autor/dominio (o `direction:rtl` para preservar el TLD). Si en algún breakpoint se conserva el scroll horizontal, marcarlo con una máscara de…

**· [SC-15] El header de tarjeta nunca pasa a columna: en móvil el subtítulo se rompe en una palabra por línea (y pide 'pasar el cursor')** · `layout-rhythm`

- `apps/web/public/eco-prototype/index.html:305-316 (.card-hd) y screens.js:479-505, 668`
- `.card-hd` es `display:flex; justify-content:space-between` sin `flex-wrap`, y sólo el primer hijo tiene `min-width:0; flex:1`; el bloque de la derecha (6 chips de serie, ~300px) no cede. En dashboard-mobile.png y en el recorte, 'Selecciona hasta 3 series · pasa el cursor para ver valores' cae en una columna de ~40px con las palabras 'Selecciona / hasta / 3 / series / · / pasa / el / cursor / para / ver / valores' apiladas al lado de l…
- *Importa porque:* Es el defecto visual más evidente de la versión móvil: la tarjeta más importante después de los KPIs parece maquetada por error. Y el microcopy que sobrevive al reflow instruye a usar un cursor y un atajo de teclado en un teléfono, así que la única pista de que las chips y las celdas son interactivas es una instrucció…
- *Arreglo:* `.card-hd { flex-wrap: wrap }` y `@media (max-width: 768px) { .card-hd { flex-direction: column; align-items: flex-start; gap: 8px } .card-hd > div:last-child { width: 100% } }`. Reescribir el copy en términos neutrales de dispositivo: 'Hasta 3 series · toca un punto para ver el detalle' y 'Toca una franja'. Ocultar la pista '⌘K' cuando no hay teclado (`@media (hover: none)`).

**· [SC-16] 'Fuentes top' pinta seis hues sin paleta, dos de ellos con tokens de sentimiento, y anuncia un periodo escrito a mano** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:540 y 542-546 (colorFn)`
- `{ facebook:'#0A7EA4', twitter:'var(--accent)', news:'var(--pos)', instagram:'#8B5CF6', youtube:'var(--neg)', blog:'var(--warn)' }` con fallback `var(--accent)`. En la captura: Noticias verde, Facebook azul, Instagram morado, X/Twitter naranja, Blogs amarillo y Foros naranja (cae al fallback). El subtítulo dice 'Por volumen · 30d' como texto fijo, sin relación con el periodo activo.
- *Importa porque:* En una pantalla que enseña al usuario 'verde = positivo, naranja = negativo, amarillo = elevado', pintar Noticias en verde y X/Twitter en naranja sugiere una lectura de sentimiento por fuente que no existe. Y el '30d' fijo o miente (cuando el usuario está en 7D) o coincide por accidente con el desajuste de SC-01, que…
- *Arreglo:* Usar la rampa categórica ya definida en tokens.css (`--cat-1..--cat-8`), asignada por orden fijo de fuente y nunca por hash, sin tocar `--pos/--neg/--warn`; o, más simple para una lista ordenada, un solo color neutro con el valor haciendo el trabajo. Sustituir el subtítulo por el periodo efectivo del API ('Por volumen · últimos 7 días').

**· [SC-17] La leyenda del heatmap está en el azul de otro tema mientras las celdas son naranjas** · `iconography`

- `apps/web/public/eco-prototype/screens.js:670-678 (swatches rgba(11,95,128,…)) vs 686-689 (celdas rgba(255,106,61,…))`
- Los cinco swatches de 'menos → más' usan `rgba(11, 95, 128, opacidad)` —el azul del tema costa— y las celdas `rgba(255, 106, 61, 0.08 + intensidad*0.85)`. En el recorte de móvil se ve la leyenda azul turquesa a la derecha del título y la matriz completa en naranja debajo. Los swatches miden 8×8px y el primero (alpha 0.1 de un azul oscuro sobre fondo oscuro) es invisible.
- *Importa porque:* La leyenda es el contrato de lectura del mapa de calor: si su color no aparece en el mapa, el usuario no puede calibrar la intensidad y el widget queda como decoración. Es además el tipo de detalle que un cliente detecta al instante y lee como falta de cuidado en todo el producto.
- *Arreglo:* Una sola rampa secuencial tokenizada, que ya existe en tokens.css (`--seq-0..--seq-5`) y con la advertencia escrita en el propio archivo: `colorFn` del heatmap y los swatches de la leyenda deben leer los mismos tokens. Subir el swatch a 12×12px y quitar el paso más transparente para que el primer nivel se vea.

**· [SC-18] 168 celdas de 14px son el control principal del heatmap, y su única pista de interacción es el hover** · `touch-target`

- `apps/web/public/eco-prototype/screens.js:690 (cellSize 14) y charts.js:696-719 (onCellClick + title + hover scale); shell.js:461-470 (chips de periodo 22px de alto)`
- El probe de móvil registra el objetivo mínimo en 10×14px, y `cellSize=14` es fijo (no responde al breakpoint) para 7×24 celdas clickeables. La única señal de que se puede pulsar es `transform: scale(1.4)` + outline en `onMouseEnter` y el `title` nativo — ambos inexistentes en táctil. En la misma pantalla el probe lista 44 objetivos por debajo de 44px en móvil, entre ellos los 8 chips de periodo (34×22, 41×22, 36×22, 24×22) y las 6 chip…
- *Importa porque:* El heatmap es el único acceso a 'menciones de esta franja horaria' y en un iPad —el dispositivo real de una reunión de gabinete— es imposible acertar sin ampliar. Los chips de periodo son el control más usado de toda la app y también quedan por debajo del mínimo táctil.
- *Arreglo:* `cellSize` derivado del breakpoint (`window.ecoIsMobile() ? 22 : 14`) o, mejor, calculado del ancho disponible con `useChartWidth`. Sustituir la pista de hover por una permanente (borde de 1px en las celdas del top-10% y cursor + `aria-label`), y en táctil abrir el slice al primer toque. Subir los chips a 32px de alto en escritorio y 44px en móvil (`padding: 8px 12px`, `min-height`).

**· [SC-19] El delta de la tira superior del chart se calcula contra el primer día de la ventana, pero se lee como variación diaria** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:263-272`
- `const first = s.vals[0]; const delta = first ? ((v - first) / first) * 100 : 0;` y se pinta junto a la fecha: en la captura '27 JUL — MENCIONES 133 ▲ 5.6%'. Sin hover, `hoverIdx` es el último punto, así que la tira parece un tooltip permanente del último día. Si el primer valor es 0, el delta sale 0 sin avisar.
- *Importa porque:* '27 jul · 133 ▲5.6%' se lee inequívocamente como 'el 27 de julio subió 5.6%', cuando en realidad compara con el 28 de junio. Es una cifra con fecha al lado que no corresponde a esa fecha, y aparece sobre la gráfica que el usuario mira más tiempo.
- *Arreglo:* Rotular explícitamente la base ('vs 28 jun', o 'vs día anterior' si se cambia el cálculo a `s.vals[hoverIdx-1]`) y, si no hay base válida, mostrar '—' en lugar de 0%. Diferenciar visualmente el estado sin hover del estado con hover (p.ej. prefijo 'Último dato:' cuando `hover == null`) para que la tira no se confunda con una lectura puntual.

**· [SC-20] La geometría del chart recorta la etiqueta del último valor (caja gris vacía) y coloca más rótulos de eje X de los que caben** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:188 (padding.r 20) vs 415-417 (tag de 46px en innerW+4); 427-430 (densidad de labels)`
- El tag se dibuja en `translate(innerW + 4, y)` con `width: 46` y el texto centrado en x=23, pero sólo hay 20px de padding derecho: en dashboard-desktop.png se ve una caja gris vacía al final de la línea (el número queda fuera del SVG). En Overview el mismo bug muestra '3' en vez de '43.0'. Ya estaba documentado en la auditoría responsive (WS-2.2, `padding.r ≥ 52`) y sigue sin corregirse. En el eje X, `maxLabels = floor(innerW / 50)` da…
- *Importa porque:* Un rectángulo gris vacío en el extremo de la gráfica principal es lo primero que un cliente señala en una demo, y además esconde justamente el dato más reciente. Las fechas amontonadas impiden atribuir el pico a un día concreto, que es la única razón por la que alguien mira este chart cuando hay una crisis.
- *Arreglo:* `padding.r = 56` (o dibujar el tag hacia dentro con `textAnchor:'end'` en `innerW - 4`) y medir el ancho del texto en vez de fijar 46px. Para el eje: calcular la zancada, no la cantidad — `stride = Math.ceil(50 / step)` y rotular `i % stride === 0`, garantizando siempre el primero y el último; a partir de 20 días, usar formato corto con el mes sólo en el primer día de cada mes.

**· [SC-21] Tres implementaciones distintas de 'fila clickeable' en la misma pantalla; dos no son alcanzables por teclado** · `consistency`

- `apps/web/public/eco-prototype/screens.js:521 (tópicos) y 581 (menciones) vs 74-79 (KpiCard) y charts.js:613-624 (HBarList)`
- Las filas de 'Tópicos emergentes' y de 'Menciones destacadas' son `<div onClick className="row-hover">` sin `role`, sin `tabIndex` y sin `onKeyDown`; KpiCard sí implementa `role='button' + tabIndex + Enter/Space`; HBarList usa un `<button>` real. El probe cuenta 222 elementos clickeables en la pantalla.
- *Importa porque:* Las dos listas con más filas de la pantalla son inaccesibles con teclado y para lectores de pantalla, en un producto de gobierno donde la accesibilidad es exigible. Y para el usuario con ratón el problema es de aprendizaje: tres patrones de hover distintos para la misma acción ('abrir el slice') hacen que no sepa qué…
- *Arreglo:* Extraer un único componente `<Row as='button'>` (o un hook `useRowInteractive()`) que aplique `role='button'`, `tabIndex=0`, `onKeyDown` de Enter/Space, `:focus-visible` y la clase `row-hover`, y usarlo en las cuatro listas del Scorecard. Reemplazar de paso los `div` clickeables por `button` cuando no haya restricción de layout.

### P2 (3)

**· [SC-22] En móvil la quinta tarjeta queda huérfana a media anchura y el rail 'Pulso' conserva el borde de una segunda columna que ya no existe** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:429 (grid de KPIs) y 410 (borderLeft + paddingLeft del rail); shell.js:44 (breakpoint)`
- `window.ecoCols('1.3fr 1.3fr 1fr 1fr 1fr', 'repeat(2, 1fr)', 'repeat(3, 1fr)')` con 5 tarjetas deja POLARIZACIÓN sola en la fila 3 a mitad de ancho, con un hueco vacío a su derecha (visible en dashboard-mobile.png). El rail del pulso mantiene `borderLeft: '1px solid var(--hairline)'` y `paddingLeft: 24` al pasar a una columna: en el recorte se ve una línea vertical suelta a la izquierda de las filas 'hace 6 h'. Y `ecoBp()` clasifica `w…
- *Importa porque:* El hueco de la quinta tarjeta hace que la fila de indicadores parezca incompleta o cargada a medias, y la línea vertical huérfana se lee como un error de render. El límite en 768 inclusive significa que el dispositivo más probable de una presentación de gobierno nunca ve la disposición pensada para él.
- *Arreglo:* Grid auto-ajustable (`repeat(auto-fit, minmax(150px, 1fr))`) o `grid-column: span 2` para la última tarjeta en móvil. Mover `borderLeft`/`paddingLeft` del rail a un objeto condicionado por `window.ecoIsMobile()` (en móvil: `borderTop` + `paddingTop`). Cambiar el corte a `w < 768` para que 768 caiga en 'tablet'.

**· [SC-23] Cuatro errores de consola por render y un `?? 0` que convierte la polarización nula en 'apática'** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:463 (trendData de Polarización) y charts.js:97-105 (Sparkline)`
- probe-report-full.json registra en los cuatro viewports: `Error: <path> attribute d: Expected number, "M 2,NaN C 5.37931034…"` ×4 (dos paths por Sparkline: área y línea). El API declara `polarizationIndex: number | null` (route.ts:76, 263) y la tarjeta lo pasa como `t.polarizationIndex ?? 0`; `smoothLinePath` no tiene guarda de nulos por punto.
- *Importa porque:* El `?? 0` no protege: fabrica. Un día sin polarización calculada se dibuja como el valor mínimo de la escala, que en esta métrica significa 'apática' — la conclusión opuesta a 'no sabemos'. Y los errores de consola son la señal de que cualquier serie con un hueco puede degradar el chart en silencio (o tumbarlo, como y…
- *Arreglo:* Contrato de nulos en las gráficas: `Sparkline`/`MultiLineChart` deben aceptar `null` y romper el path (segmentos discontinuos + punto hueco), y `fmtVal` devolver '—' ante `null`. Quitar el `?? 0` de screens.js:463. Si una serie tiene más del 30% de huecos, mostrar el vacío de la tarjeta en vez de una línea.

**· [SC-24] Etiquetas bilingües, jerga interna del pipeline y un icono con tres significados** · `copy`

- `apps/web/public/eco-prototype/screens.js:430 y 457 (labels), 572 (subtítulo), 95 y 368 (Sparkles), shell.js:541 (Chat), charts.js:691 (negrita de Sáb/Dom)`
- Dos de las cinco tarjetas están en inglés ('Net Sentiment Score', 'Brand Health') junto a tres en español; el subtítulo de la tabla dice 'Más recientes · sin twitter ni baja pertinencia' —regla interna del backend— mientras la tarjeta de fuentes cuenta 'X / Twitter 159'. El icono `Sparkles` significa 'IA' en el badge del briefing, 'Detalles' en las cinco tarjetas y 'Chat' en el header. En el heatmap, `fontWeight: d === 5 || d === 6 ? 7…
- *Importa porque:* El cliente es un gobierno hispanohablante: la mezcla de idiomas en los indicadores obliga a traducir mentalmente y complica citar las métricas en un informe. Exponer el filtro interno hace dudar de si los números incluyen o no Twitter (y la pantalla se contradice a sí misma). Un mismo glifo con tres significados destr…
- *Arreglo:* Glosario único es-PR para las cinco métricas ('Sentimiento neto', 'Salud de marca') con la sigla técnica como apoyo de 11px si hace falta. Reescribir el subtítulo en términos del usuario ('Menciones de mayor pertinencia, sin X/Twitter') y usar el mismo nombre de red en toda la app. Reservar `Sparkles` a 'generado por IA', usar un chevron o `Info` para 'Detalles' y un icono de conversación para el chat. Quitar la negrita de Sáb/Dom o ju…


## Pantalla Menciones

*24 hallazgos*

Menciones es la pantalla donde la promesa del producto ("ver la conversación") choca con una tabla diseñada como rejilla de metadatos: el titular es la ÚNICA columna elástica (2fr) mientras sentimiento/tópico/hora tienen ancho fijo, así que cada píxel que se pierde lo paga el contenido — a 1440px ya se truncan 7 titulares y 5 tópicos, y a 390px el titular se reduce al 19% de su texto (178px visibles de 925px). La fila superior de 5 KPI vive en OTRO universo de datos: sale de /api/eco-data (que no excluye baja pertinencia) mientras la lista sale de /api/eco-mentions (que sí la excluye), de modo que la pantalla afirma dos totales incompatibles a 200px de distancia (TOTAL 1.3K vs "1,024 menciones") y además esos KPI no reaccionan a ningún filtro: puedes filtrar "Negativo" y las cinco cifras siguen siendo las del período completo. La honestidad temporal es el otro agujero: el API entrega la hora SOLO en relativo ("hace 6 h"), no existe fecha absoluta en ninguna superficie del producto, y la misma página muestra "hace 4 h" bajo un sello que dice "DATOS AL CIERRE DE AYER". Tipográficamente todo es metadato: 643 de 676 elementos de texto miden ≤12px y no hay ningún escalón entre 13px y 22px, así que el ojo aterriza primero en la palabra naranja "Acelerada" (30px) y en los pills de sentimiento en mayúsculas, no en los titulares. En móvil el reflow es correcto (0 desbordes horizontales) pero la jerarquía se destruye: la primera pantalla no contiene ni una sola mención, el titular queda ilegible y tópico/hora/chevron salen del área visible dentro de un scroll horizontal sin ninguna…

### P0 (5)

**✔︎ [MEN-01] Dos totales incompatibles a 200px de distancia (TOTAL 1.3K vs "1,024 menciones")** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:949 y :975; /Users/alegut/MyApps/eco_populicom/.claude/worktre…`
- mentions-desktop-fold.png: la barra de filtros dice "1,024 menciones", la tarjeta TOTAL dice "1.3K", el subtítulo de la card dice "Página 1 de 41 · 1,024 en total" y el badge del nav dice "1.3K". Causa raíz en código: la tarjeta usa fmt(D.CURRENT_METRICS.totalMentions) de /api/eco-data, cuyo baseWhere sólo filtra agencia+is_duplicate+fecha (route.ts:207-212); la lista usa /api/eco-mentions, que por defecto excluye pertinencia 'baja' (r…
- *Importa porque:* Un director de agencia que cite "1.3K menciones esta semana" en una reunión y luego abra la lista para respaldarlo encuentra 1,024. La pantalla no da ninguna pista de cuál es la cifra buena, y el mismo dashboard ya arrastra este patrón en Scorecard (F9): repetirlo aquí convierte la duda en desconfianza sobre todo el p…
- *Arreglo:* Una sola fuente para el total de la pantalla: alimentar la tarjeta TOTAL con `data.total` del mismo fetch que la lista, y mostrar debajo la exclusión explícita ("excluye 276 de baja pertinencia") con un toggle que envíe `includeLow=1`. Si se prefiere conservar el agregado global, entonces la tarjeta debe titularse "Total del período (incl. baja pertinencia)" y el badge del nav usar la misma cifra que la lista. Regla de sistema: ninguna…
- *Verificador:* MEN-01 (P0, corregido) — "El total de la card y el de la lista no pueden cuadrar: difieren en pertinencia Y en ventana temporal" Ubicaciones: `apps/web/public/eco-prototype/screens.js:942, 949, 975`; `apps/web/src/app/api/eco-data/route.ts:194-200, 336`; `packages/shared/src/metrics.ts:330-351`; `apps/web/src/app/api/eco-mentions/route.ts:155-159, 190-198`; badge en `apps/web/public/eco-prototype/shell.js:84-85`. Defecto (código, no dato sembrado): la card TOTAL cuenta `COUNT(*)` de menciones no duplicadas en la ventana CERRADA en TZ PR que termina ayer, SIN filtro de pertinencia. La lista (y el "N menciones" de la barra de filtros y el "N en total" del subtítulo) cuenta la ventana ROLANTE…

**✔︎ [MEN-02] Los 5 KPI no responden a los filtros de la propia pantalla** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:948-963 (leen D.CURRENT_METRICS) frente a :818-847 (la lista s…`
- Las cinco QuickMetric se construyen desde D.CURRENT_METRICS (payload global del dashboard, por agencia+período) y no aparecen en ninguna dependencia de los efectos de filtro. Al pulsar "Negativo", "Todas las fuentes → Facebook" o escribir en el buscador de la pantalla, la lista y el contador cambian y TOTAL/ALCANCE/ENGAGEMENT RATE/VELOCIDAD/VIRALES se quedan idénticos. Nada en la UI lo advierte: las 5 tarjetas están dentro del mismo bl…
- *Importa porque:* El patrón universal de un dashboard es "filtro arriba, cifras y lista abajo, todo del mismo subconjunto". Aquí un analista filtra sentimiento negativo, lee "ALCANCE 4.8M" y reporta que las menciones negativas alcanzaron 4.8M personas. Es la lectura natural y es falsa.
- *Arreglo:* Recalcular los KPI desde la respuesta filtrada — /api/eco-mentions ya devuelve `total` y el desglose `sentiment {pos,neu,neg}`, y `minEngagement` permite el conteo de virales sobre los mismos filtros. Mientras eso no exista, sacar las tarjetas del contexto del filtro: moverlas ARRIBA de la barra de filtros y rotularlas "Período completo · sin filtros" en el eyebrow de la fila.
- *Verificador:* Dos precisiones al enunciado y una al arreglo. (1) Geometría: la barra de filtros y la fila de KPI son dos `.card` HERMANOS separados por 16px (gap del contenedor, screens.js:885); los 12px citados son el gap interno del grid de KPI (screens.js:948). No están "dentro del mismo bloque visual". (2) Evidencia más fuerte que la alegada: la contradicción es visible ya en el estado sin filtros — TOTAL "1.3K" (D.CURRENT_METRICS.totalMentions) contra "1,024 menciones" en la misma banda; el filtro solo la agrava. (3) El arreglo propuesto cubre solo 2 de las 5 tarjetas con lo que hoy existe: /api/eco-mentions devuelve `total` (route.ts:538) y `sentiment{pos,neu,neg}` calculado sobre el MISMO whereCla…

**✔︎ [MEN-03] Lo no clasificado se presenta como NEUTRAL (y el estilo para "sin clasificar" es inalcanzable)** · `data-integrity`

- `apps/web/src/app/api/eco-mentions/route.ts:45-49 y :88-89; /Users/alegut/MyApps/eco_populicom/.claude/w…`
- pillFromSentiment(s) devuelve 'neutral' para CUALQUIER valor que no sea positivo/negativo, incluido NULL (route.ts:45-49), y el filtro "Neutral" replica esa lógica ("TODO lo que no es pos/neg (incl. NULL)", route.ts:88-89). El diseño sí tiene un pill para el caso: .pill-unknown con borde discontinuo y trama a 45° (index.html:353-357), y MentionsList lo mapea (screens.js:1132) — pero el API nunca emite un valor que lo active. En mention…
- *Importa porque:* "No medido" se está pintando como "medido y neutro". Infla artificialmente la franja neutral que después sostiene el NSS y los porcentajes de los correos, y elimina la única señal que le diría al cliente que el clasificador se quedó corto en un tema. Para un cliente de gobierno es la diferencia entre "la ciudadanía es…
- *Arreglo:* Propagar el tercer estado: pillFromSentiment debe devolver 'sin_clasificar' cuando nlp_sentiment y bw_sentiment son NULL; la lista lo pinta con .pill-unknown (ya existe) y la barra de filtros gana un cuarto chip "Sin clasificar" con su conteo. El filtro "Neutral" debe dejar de arrastrar NULL. Si el volumen sin clasificar supera ~5%, mostrar una nota en el card-hd ("N sin clasificar").
- *Verificador:* Severidad correcta: **P1** (no P0), con escalada a P0 si se mide volumen sin clasificar >5% en producción — la auditoría no aporta esa medición y el cron `eco-processor-reprocess-unclassified-manual` más el fallback a bw_sentiment reducen el residuo. Redacción corregida: "El API colapsa el sentimiento desconocido (NULL en nlp_sentiment Y bw_sentiment) en la categoría afirmativa NEUTRAL, convirtiendo la ausencia de análisis en un juicio editorial. El defecto es sistémico, no de /mentions: pillFromSentiment está duplicado en apps/web/src/app/api/eco-data/route.ts:117-120 y alimenta el donut y el desglose de sentimiento de Overview, Scorecard, Tópicos y Fuentes, además del filtro 'Neutral' de…

**✔︎ [MEN-04] La fecha absoluta de una mención no existe en ninguna parte del producto, y el relativo contradice el sello del header** · `data-integrity`

- `apps/web/src/app/api/eco-mentions/route.ts:94-103 y :519; screens.js:1150, :1181, :1200 y :1235; /Users…`
- El API serializa `publishedAt: relativeTime(new Date(...))` (route.ts:519), o sea un string "hace 6 h" / "hace 7 días"; el timestamp nunca llega al cliente. La columna de la vista Tabla se titula "Fecha" (screens.js:1200) pero muestra ese relativo, y el drawer lo repite dos veces (shell.js:843 y :861) sin alternativa. En mentions-desktop.png la primera fila dice "hace 4 h" y las últimas "hace 7 días", mientras el header estampa "DATOS…
- *Importa porque:* Un equipo de comunicaciones de gobierno tiene que citar la mención ("publicado el 27 de julio a las 3:14 PM en El Nuevo Día") en un memo, una respuesta a prensa o un expediente. Con "hace 7 días" no se puede citar, no se puede auditar y no se puede reconciliar con el correo diario. Y "hace 4 h" bajo "datos al cierre d…
- *Arreglo:* Devolver `publishedAt` ISO (y opcionalmente `publishedAtLabel` relativo) y formatear en cliente en TZ America/Puerto_Rico: en la lista el relativo con `title`/tooltip absoluto, en la vista Tabla la columna "Fecha" con fecha+hora absolutas (es la vista de exportación), y en el drawer la línea completa "27 jul 2026, 3:14 PM AST · hace 7 días". Recalcular el relativo con un intervalo o al refetch para que no se congele.
- *Verificador:* Tres ajustes a la evidencia. (1) `relativeTime` (`route.ts:94-103`) emite "hace N d", NO "hace 7 días" — corregir el texto citado. (2) La vista Lista titula esa columna "Hora" (`screens.js:1128`), lo cual es honesto; el rótulo engañoso "Fecha" aplica solo a la vista Tabla (`screens.js:1200`). (3) Falta la evidencia más grave, que es la que sostiene el P0: el export CSV (`shell.js:1429-1432`) escribe la cabecera literal `'Fecha'` y como valor `mn.publishedAt`, o sea el relativo — un CSV archivado o reenviado por un funcionario queda con "hace 6 h" en la columna Fecha, sin ancla temporal y sin forma de reconstruirla. El arreglo debe cubrir explícitamente ese camino: devolver `publishedAt` ISO…

**✔︎ [MEN-05] En móvil el titular queda al 19% y la primera pantalla no contiene ni una mención** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:1126 y :1135 (grid '20px 2fr 110px 110px 80px 30px', minWidth…`
- probe-report.json (mentions/mobile): 27 textos truncados; el titular tiene clientW 178px contra scrollW hasta 925px — se lee "DDEC anuncia inversión de $3…". El grid conserva 6 columnas y 620px de minWidth dentro de una card de ~358px, así que TÓPICO, HORA y el chevron quedan fuera del área visible (visible en el recorte aud-m-hd.png: las columnas se cortan contra un borde vertical duro) y el único acceso es un scroll horizontal intern…
- *Importa porque:* En teléfono la tarea es "escanear qué se está diciendo" y el producto entrega 19 caracteres por fila, sin hora y sin tópico. El reflow es técnicamente correcto (0 desbordes de página) y eso oculta el problema en cualquier revisión automatizada: hay que abrir el teléfono para ver que la pantalla dejó de servir. Y exist…
- *Arreglo:* En breakpoint mobile, no renderizar el grid tabular: fila apilada de dos líneas (titular con clamp de 2 líneas a 14px + línea de metadatos "fuente · autor · hace 6 h" con el pill de sentimiento al final) y el tópico como texto secundario, sin scroll horizontal. Vía rápida: `viewMode` por defecto = 'cards' cuando ecoBp()==='mobile' (respetando la elección explícita del usuario) y bajar el minWidth del grid a 0 en móvil. Complemento: cua…
- *Verificador:* El hallazgo es real; corrijo la severidad y una pieza de evidencia. SEVERIDAD: P1, no P0. El brief define P0 como "rompe/engaña". Aquí no se rompe nada ni se falsea ningún dato: `probe.hScroll.overflow === 0` (la página no desborda — la contención de `.scroll-x` funciona como se diseñó en el PR #87), no hay error de consola, las etiquetas de sentimiento que se muestran son las correctas para cada mención, ningún total ni gráfica se lee mal, y el contenido oculto es alcanzable por tres caminos: el scroll horizontal interno, el tap en la fila (que abre el detalle con el titular completo) y el `ViewToggle` a Tarjetas/Tabla. Es una degradación grave de usabilidad y de densidad en el canal móvil…

### P1 (16)

**· [MEN-06] Durante el fetch la lista sigue mostrando las filas del filtro/página anterior** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:992-994 (render sin condicionar a `loading`), :941-943 y :971-…`
- Las tres vistas se renderizan con `{!error && viewMode === '…' && <…>}`, sin depender de `loading`. El estado de carga sólo cambia dos textos de 11px en var(--text-3) ("Cargando…") — dos de los 100 casos de bajo contraste de la pantalla. Con el debounce de 300ms más la latencia del API, la secuencia real es: el usuario pulsa "Negativo" → el chip se pinta naranja → siguen en pantalla filas POSITIVO durante cientos de ms. No hay skeleton…
- *Importa porque:* El chip ya dice "Negativo" y las filas dicen POSITIVO: durante ese lapso la pantalla afirma algo falso, y es exactamente el momento en que alguien hace una captura para un WhatsApp o un correo. Lo mismo al paginar: sin señal de carga ni retorno al tope, pulsar "2" al final de una página de 7,000px parece no hacer nada.
- *Arreglo:* Estado de carga explícito y único para toda la app: mientras `loading`, envolver la lista con `opacity:.45; pointer-events:none` y sobreponer 5 filas skeleton con el shimmer ya definido; al cambiar de página, `scrollIntoView({block:'start'})` sobre la card. El contador de resultados debe ser un `aria-live="polite"` en var(--text-2) 13px, no un susurro de 11px en --text-3.

**· [MEN-07] La tarjeta "Virales" dibuja un 0 silencioso ante cualquier fallo, no tiene denominador y nunca se refresca** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:852-865 y :958-963`
- Es el único fetch de la pantalla que NO usa ecoFetchAuthed (línea 860 usa `fetch` crudo): `r.ok ? r.json() : { total: 0 }` y `.catch(() => setViralCount(0))`. Un 401 por token expirado, un 500 o una red caída se renderizan como "0" naranja de 30px, indistinguible de una medición real, mientras el resto de la pantalla sí redirige a sign-in. Además el efecto declara dependencias `[]` (línea 865) aunque su propio comentario dice "se recal…
- *Importa porque:* Un cero fabricado es peor que un error: el usuario concluye que no hubo contenido viral esa semana y decide no actuar. Y una cifra sin denominador impide detectar el caso contrario (un valor absurdamente alto), que es justo el síntoma de un filtro roto.
- *Arreglo:* Usar ecoFetchAuthed y tres estados distinguibles: cargando ("…"), sin datos ("—" con tooltip "no se pudo calcular") y valor. Mostrar la cifra con su base: "1,024 · 79% del total" o una barra de proporción. Sincronizar el efecto con período/agencia y filtros (`minEngagement` ya viaja como param, así que puede compartir el fetch principal).

**· [MEN-08] El pill de sentimiento grita más que el titular, y NEUTRAL es el más brillante de los tres** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:1144 (titular 12px/500) y :1148 (pill); /Users/alegut/MyApps/e…`
- El titular es 12px peso 500 en --text; el pill es 11px peso 600 EN MAYÚSCULAS con letter-spacing y relleno de color (index.html:333). Y .pill-neu en modo oscuro usa `color: var(--text)` — el color de texto más brillante del tema — más fondo al 22% y borde al 45% (index.html:344-348), mientras .pill-pos/.pill-neg usan tintes al 10%. Verificable en aud-d-bottom.png: los pills NEUTRAL saltan a la vista antes que los POSITIVO/NEGATIVO y an…
- *Importa porque:* En 25 filas la retina construye el resumen de la pantalla con lo que más contrasta, y aquí eso es la etiqueta menos informativa del sistema ("neutral", que además incluye lo no clasificado — ver MEN-03). El contenido — lo único que un analista puede citar o accionar — es el elemento más débil de su propia fila.
- *Arreglo:* Invertir la jerarquía: titular a --fs-body (14px) peso 500-600 en --text; sentimiento como barra de 3px en el borde izquierdo de la fila (o punto de 8px) más texto en --text-2 sin mayúsculas, eliminando la columna de 110px que hoy roba ancho al titular. Si se conservan pills, igualar el peso visual de los tres: mismo alfa de fondo, mismo tratamiento de borde, y bajar el neutral a --text-2.

**· [MEN-09] La velocidad grita cuando sube y susurra cuando baja (acelerar = accent, desacelerar = gris)** · `chart-honesty`

- `packages/shared/src/format/metrics-display.ts:78-84 y :89-100; screens.js:952-957 y :1030`
- BAND_TONE mapea ACELERADA → 'accent' y ESTABLE/DESACELERADA → 'neutral', y TONE_COLOR resuelve 'neutral' a var(--text-3) — el color más apagado del tema (2.65:1 en el render capturado, 5.0:1 tras tokens.css). Resultado: la misma métrica se pinta en el naranja de marca a 30px cuando sube (mentions-desktop-fold.png: "Acelerada" es el elemento más llamativo de todo el pliegue, por encima de TOTAL) y en gris casi ilegible cuando baja. Es t…
- *Importa porque:* Codificar sólo una dirección del cambio sesga la lectura del período: una caída del 40% en volumen — que para una agencia puede ser el dato más importante de la semana — se presenta con menos énfasis que el encabezado de la tarjeta. Y una palabra donde el resto son números rompe la comparabilidad de la fila.
- *Arreglo:* Encoding simétrico y neutral en dirección: valor numérico grande ("+30%") con flecha, color por dirección con la misma saturación en ambos sentidos (--pos / --neg reservados para juicio, o azul/ámbar si el juicio no aplica), y la palabra como etiqueta secundaria. Corregir BAND_TONE para que DESACELERADA tenga tono propio en vez de heredar 'neutral' (= --text-3, que el sistema define para texto deshabilitado/decorativo).

**· [MEN-10] "Velocidad" es literalmente el delta de "Total": dos de cinco tarjetas para un mismo hecho, en dos idiomas** · `hierarchy`

- `apps/web/src/app/api/eco-data/route.ts:366-369; screens.js:949 y :952-957`
- En eco-data, `velocity: formatVelocity(winCur.totals.total, winPrev.totals.total)` — el cambio % del VOLUMEN de menciones, es decir el delta de la misma cifra que muestra la tarjeta TOTAL (y que ya existe como `deltaDisplay.totalMentions`). En pantalla eso se reparte en dos tarjetas separadas por otras dos: "TOTAL 1.3K" sin comparación, y "VELOCIDAD Acelerada / +30% vs período ant.". De las cinco tarjetas, sólo Velocidad tiene línea de…
- *Importa porque:* El lector no puede saber que ese +30% pertenece al 1.3K de dos tarjetas a la izquierda; con "Velocidad" al lado de "Alcance" y "Engagement rate" lo más probable es que lo lea como velocidad de engagement o de propagación. Y ninguna de las otras cifras dice si subió o bajó, que es la única pregunta que se le hace a un…
- *Arreglo:* Fusionar: "TOTAL · 1,024 · ▲ 30% vs. semana anterior" en una sola tarjeta, y darle sub-línea de delta a ALCANCE y ENGAGEMENT RATE (formatDelta ya existe para ambas). Eso deja 4 tarjetas — número redondo para rejillas de 4/2/2 (ver MEN-22) — y elimina de paso la palabra "Acelerada" como elemento dominante del pliegue.

**· [MEN-11] "Virales" está toneada como NEGATIVO — y con los tokens nuevos pasa de naranja de marca a rojo de crisis** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:961 (tone="neg") y :878 (accent: 'var(--neg)' del slice); Quic…`
- La tarjeta pasa `tone="neg"`, que QuickMetric resuelve a var(--neg), y el modal de la porción usa `accent: 'var(--neg)'`. En el render capturado --neg era idéntico a --accent (#FF6A3D), así que "1.0K" se leía como naranja de marca; con tokens.css ya en el árbol --neg pasa a #FF5470 (rojo-magenta, separado del accent a propósito), de modo que la corrección del sistema convierte "Virales" en el único KPI pintado con el color reservado pa…
- *Importa porque:* Alto engagement no es malo: puede ser el anuncio de inversión que funcionó. Pintarlo con el color de crisis le dice al lector que hay un problema donde puede haber un logro — y al revés, cuando de verdad haya una viralización negativa, el color ya no significará nada porque siempre está encendido.
- *Arreglo:* Retonear la tarjeta y el modal a 'accent' (destacado, no juicio) o a --info; reservar --neg exclusivamente para sentimiento negativo, crisis y deltas adversos. Auditar los otros usos de tone/accent que asumían accent===neg antes de que tokens.css los separara.

**· [MEN-12] El mismo sentimiento cambia de color según el modo de vista: neutral es amarillo de advertencia en Cards y gris en Lista/Tabla** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:1167 (`accent = … : 'var(--warn)'`) frente a :1132 y :1215 (pi…`
- MentionsCards calcula el color del borde izquierdo de 3px con positivo→--pos, negativo→--neg y TODO lo demás→--warn (ámbar). Las vistas Lista y Tabla pintan el mismo valor con .pill-neu (gris/--text-2). Así, la misma mención cambia de "advertencia" a "neutra" con un clic en el toggle de vista, sin que nada haya cambiado en el dato.
- *Importa porque:* El color es el contrato de lectura de la herramienta. Si depende del modo de vista, deja de ser información y pasa a ser decoración — y en este caso concreto marca como "ojo, atención" ~40% de las filas (todas las neutrales, incluidas las no clasificadas de MEN-03).
- *Arreglo:* Un solo mapa sentimiento→token, exportado desde un módulo compartido (SENTIMENT_TONE = {positivo:'--pos', negativo:'--neg', neutral:'--neu', sin_clasificar:'--text-3'}) y consumido por las tres vistas, por el drawer (shell.js:837) y por los correos. --neu ya existe en tokens.css:207.

**· [MEN-13] Columnas rígidas y miniatura opcional: el contenido paga toda la reducción de ancho y la columna se desalinea** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:1126 y :1135 (grid), :1138-1141 (miniatura condicional), :1149…`
- El grid es '20px 2fr 110px 110px 80px 30px': 460px de pistas fijas más gaps, y una sola pista elástica. probe-report.json: el titular pasa de 720px (1440) a 560px (1280) a 178px (390) mientras SENTIMIENTO y TÓPICO se quedan clavados en 110px, y el tópico se trunca en TODOS los viewports, incluido 1440 ("Energía e infraestru…", "Empleo y adiestramiento", "Incentivos contributivos", "PyMEs y comercio local", "Transparencia y fondos" — 5…
- *Importa porque:* El taxonomía de tópicos es el eje con el que la agencia organiza su trabajo; truncada a 110px, "Energía e infraestru…" y "Empleo y adiestramiento" son indistinguibles de un vistazo. Y una columna de texto que se mueve fila a fila obliga a re-enfocar en cada renglón: es la causa mecánica de que la lista se sienta "suci…
- *Arreglo:* Grid con pistas elásticas y mínimos: `minmax(0, 3fr)` para el titular, `minmax(96px, 0.9fr)` para tópico (con clamp de 2 líneas en vez de ellipsis), sentimiento fuera del grid como barra/punto (ver MEN-08). Reservar el slot de la miniatura siempre (placeholder con la inicial del dominio) o eliminarla en la vista Lista; en Cards, imagen con `aspect-ratio` fija y placeholder para que la rejilla mantenga ritmo.

**· [MEN-14] Cuatro idiomas de control en una sola barra de filtros, contador exiliado y separador huérfano en móvil** · `consistency`

- `apps/web/public/eco-prototype/screens.js:887-944 (chips :892-898, divider :899, select nativo :900, pop…`
- En una sola fila conviven: chips redondeados para sentimiento, un `<select>` nativo de 160px para fuente, un botón "Más filtros" que abre un popover con dos selects y otra fila de chips para el orden, y un contador de resultados empujado con `flex:1` al extremo derecho — a ~1,200px del buscador que lo modifica, en 11px sobre --text-3 (uno de los 100 casos de bajo contraste). En móvil, el separador vertical de 1px (:899) queda flotando…
- *Importa porque:* Cuatro gramáticas para una misma tarea obligan al usuario a aprender cuatro veces "cómo se filtra aquí", y esconden dos de los cinco filtros dentro de un popover sin resumen visible. El contador es la única confirmación de que el filtro funcionó, y está donde nadie mira, en el color menos legible de la pantalla.
- *Arreglo:* Un único componente FilterBar con una gramática: todos los filtros como chips-menú de la misma altura (44px en táctil), los activos representados como chips removibles ("Negativo ×", "Facebook ×") en una segunda línea, y el contador junto al buscador en --text-2 13px ("1,024 resultados"). Reemplazar el `<div>` divisor por `gap`/`border-left` en el grupo, o marcarlo `.hide-mobile`.

**· [MEN-15] Se puede ordenar por engagement, pero el engagement no se muestra en ninguna vista** · `affordance`

- `apps/web/public/eco-prototype/screens.js:725-729 (SORT_OPTIONS), :1122 y :1198 (comentarios "sin column…`
- El orden ofrece "Engagement" y "Relevancia", y la tarjeta VIRALES define viralidad por engagement ≥5,000 — pero ninguna de las tres vistas muestra el engagement (los comentarios del código confirman que las columnas se quitaron a propósito); sólo aparece en el drawer, tras un clic. "Relevancia" se deshabilita sin query con opacidad 0.45 y la explicación únicamente en el atributo `title` (tooltip que no existe en táctil).
- *Importa porque:* Ordenar por una cantidad invisible produce una lista que parece desordenada: el usuario no puede verificar el criterio ni comparar dos filas, así que deja de confiar en el control. Y un control deshabilitado sin razón visible se lee como una función rota del producto.
- *Arreglo:* Mostrar la cantidad por la que se ordena: columna "Engagement" (numérica, tabular) al menos en la vista Tabla, y en Lista un badge discreto sólo cuando el orden activo es engagement. Sustituir el `title` por texto de ayuda persistente bajo los chips ("Relevancia requiere un término de búsqueda"). Si engagement no debe mostrarse por decisión de producto, retirar la opción de orden.

**· [MEN-16] Dos buscadores idénticos a 190px con ámbitos distintos: uno filtra, el otro te saca de la pantalla** · `consistency`

- `apps/web/public/eco-prototype/shell.js:343-365 (HeaderSearch → /search) frente a screens.js:888-891 (in…`
- En mentions-desktop-fold.png hay dos campos con el mismo estilo .input y la misma lupa: "Buscar menciones, autor, URL… ⌘K" en el header y "Buscar en menciones…" en la card, separados verticalmente por ~190px. El primero, con Enter, navega a /search (otra pantalla, con sus propias facetas y su propio estado) y descarta los filtros de sentimiento/fuente/tópico/región que el usuario tenía puestos; el segundo filtra en sitio con debounce d…
- *Importa porque:* Nada distingue visualmente "buscar aquí" de "buscar en todo". El usuario que ya filtró Negativo+Facebook y escribe en el campo de arriba pierde ese trabajo y aterriza en una pantalla casi idéntica — un salto que parece un fallo. La auditoría previa ya señaló la duplicación arquitectónica Search≈Mentions; esto es su co…
- *Arreglo:* Diferenciar por forma y por copy: el buscador del header como botón-disparador del palette (icono + "Buscar en todo · ⌘K", sin campo de texto) y el de la pantalla como único campo de texto real, con placeholder "Filtrar estas 1,024 menciones…". Alternativa más ambiciosa y recomendada: /search deja de ser pantalla y pasa a ser /mentions con `q` — un solo buscador, un solo estado de filtros.

**· [MEN-17] Tres modos de vista sin criterio: Lista y Tabla son la misma cosa, ninguno se adapta al ancho y Tabla está fuera del patrón** · `consistency`

- `apps/web/public/eco-prototype/screens.js:717-721 y :745-758 (ViewToggle), :1123-1157 (Lista), :1160-119…`
- Lista y Tabla comparten propósito y defectos (una línea por mención, titular truncado con nowrap+ellipsis en :1144 y :1219); Tabla sólo añade Autor/Dominio/Subtópico/Municipio y quita el chevron. Cards es la única que muestra snippet e imagen. Tabla usa `overflow:auto` en vez del contenedor estándar `.scroll-x` (index.html:244), no declara minWidth y no tiene cabecera fija; en Lista la fila de encabezados (:1126) tampoco es sticky, así…
- *Importa porque:* Tres opciones para dos necesidades reales (escanear vs. leer/exportar) obligan a decidir sin información y multiplican por tres el coste de cada mejora futura de la fila. Y como el modo correcto depende del ancho, la persistencia acaba entregando en móvil justo la vista que allí no funciona (MEN-05).
- *Arreglo:* Dos modos: "Compacta" (tabla única, columnas configurables, cabecera sticky, `.scroll-x`) y "Lectura" (cards con snippet). Guardar la preferencia por breakpoint (`eco.viewMode.mobile` / `.desktop`) con default 'cards' en móvil. Unificar Lista y Tabla en un solo componente de fila para que cada corrección (truncado, tiempo absoluto, foco) se haga una vez.

**· [MEN-18] El estado vacío no ofrece salida, y "Más filtros ·N" cuenta el orden como si fuera un filtro** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:987-991 (vacío), :932-936 ("Limpiar filtros" dentro del popove…`
- El vacío es un párrafo centrado de 13px en --text-3: "No se encontraron menciones con los filtros actuales.", sin acción. El único botón de limpiar vive DENTRO del popover "Más filtros" y sólo resetea topic/region/sortBy: no toca sentimiento, fuente ni el texto buscado — precisamente los filtros que sí están a la vista. El contador del botón suma `filters.sortBy !== 'recent'`, así que ordenar por engagement enciende un "·1" que promete…
- *Importa porque:* El vacío es el momento de máxima frustración y aquí es un callejón sin salida: hay que deducir cuál de cinco controles repartidos en tres capas causó el cero. Y un contador que miente sobre cuántos filtros hay activos hace que el usuario busque un filtro que no existe.
- *Arreglo:* Estado vacío con diagnóstico y acción: "Sin resultados para «endoso» · Negativo · Facebook" y botones "Quitar sentimiento", "Quitar fuente", "Limpiar todo". Un único `resetFilters()` accesible desde la barra (no dentro del popover) que limpie también q/sentiment/source. Excluir sortBy del contador de filtros (o renombrarlo "Filtros y orden ·N"). El error usa --warn o un patrón de banner propio, no --neg.

**· [MEN-19] 41 páginas navegadas con botones de 32×29px que se parten en dos líneas y no devuelven al tope** · `touch-target`

- `apps/web/public/eco-prototype/screens.js:1036-1102 (Pagination, btnStyle :1055-1066), :995-999 (uso), :…`
- probe-report.json (mobile): "Anterior" 91×29, páginas 32×29, "Siguiente" 97×29 — todos por debajo de 44px, y el bump táctil de index.html:277 (`.chip{min-height:34px}`) no les aplica porque Pagination no usa .chip. En aud-m-bottom.png la barra se parte: "‹ Anterior 1 2 3 … 41" en una línea y "Siguiente ›" sola en la siguiente. `onChange(setPage)` no hace scroll, así que al pulsar "2" el usuario se queda al final de una página nueva. El…
- *Importa porque:* En un teléfono, un objetivo de 29px de alto junto a otros cuatro iguales produce toques equivocados que además disparan una recarga de datos. Y una paginación numerada de 41 páginas es un modelo de escritorio: nadie audita 41 páginas de menciones a golpe de número.
- *Arreglo:* En móvil: dos botones grandes (44px) "Anteriores / Siguientes" con "Página 3 de 41" en medio, o "Cargar más" incremental; en escritorio conservar la numerada añadiendo salto directo ("Ir a página __") y un selector de tamaño de página (25/50/100). `scrollIntoView` sobre la card al cambiar de página. Estado deshabilitado con --text-disabled + `opacity:.5`.

**· [MEN-20] 100 de 107 fallos de contraste son un solo token, y caen justo sobre la atribución y la hora de cada mención** · `contrast`

- `apps/web/public/eco-prototype/screens.js:1145 (autor · dominio, 10px --text-3), :1150 (hora), :941-943…`
- probe-report.json (mentions/mobile): 107 casos de bajo contraste; agrupados, 100 son rgb(82,91,104) (=#525B68, --text-3 del render capturado) sobre --canvas con ratio 2.65:1 frente a 4.5 requerido — 68 de ellos a 10px. Los elementos afectados son la línea "María Rivera · primerahora.com" de CADA fila, la columna HORA, el contador de resultados y el eyebrow. tokens.css ya corrige el token a #7C8798 (5.0:1) y degrada #525B68 a --text-dis…
- *Importa porque:* Autor, medio y fecha son exactamente los tres campos que se copian a un informe o a una respuesta de prensa; hoy son el texto menos legible de la pantalla, a 10px, y en una tableta al sol son ilegibles. Un cliente de gobierno además tiene obligación de accesibilidad: 100 fallos AA en una sola pantalla es un hallazgo a…
- *Arreglo:* Reasignar por rol, no por tamaño: autor·dominio y hora a --text-2 (7.9:1) con --fs-caption (12px); --text-3 sólo para decorativo (separadores "·", elipsis) y --text-disabled para estados inactivos. Añadir al sistema una regla verificable: ningún texto que porte información puede usar --text-3, y ningún texto informativo baja de 12px.

**· [MEN-21] 643 de 676 elementos de texto miden ≤12px y no hay nada entre 13px y 22px: la pantalla entera es metadato** · `type-scale`

- `apps/web/public/eco-prototype/screens.js:1126 (10px), :1135 (12px), :1145 (10px), :1149-1150 (11px), :1…`
- probe-report.json (censo de fuentes, idéntico en los 4 viewports): 10px×249, 11px×265, 12px×129, 13px×15, 16px×2, 22px×1, 30px×5. Es decir 95% del texto a ≤12px, un salto directo de 13 a 22, y cero adaptación por breakpoint (el mismo 10px en 1440 y en 390). Todos son literales inline: MentionsScreen y sus cuatro subcomponentes no consumen ni un token de tokens.css, que ya define --fs-caption 12px como PISO, --fs-body 14px como texto po…
- *Importa porque:* Sin escalón de 14-16px no hay tier de "contenido": el titular de la mención compite en tamaño con su propia metadata, así que la pantalla se lee como una hoja de cálculo en lugar de como un feed. Los usuarios finales de esta herramienta son directores y jefes de prensa, muchos por encima de los 45 años, leyendo en por…
- *Arreglo:* Migrar la pantalla a los tokens ya existentes, con este mapeo concreto: titular → --fs-body (14px) peso 500; autor·dominio y hora → --fs-caption (12px) en --text-2; encabezados de columna y eyebrows → --fs-overline (11px, mayúsculas, único permitido bajo 12px); etiqueta de KPI → --fs-label; cifra de KPI → --fs-num-xl (30px) con --ff-numeric (ojo: screens.js:1030 sobreescribe la familia con --ff-display en línea, lo que anula el propósi…

### P2 (3)

**· [MEN-22] Cinco tarjetas en una rejilla de dos columnas dejan una huérfana — justo la única clicable** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:948 (`window.ecoCols('repeat(5, 1fr)', 'repeat(2, 1fr)', 'repe…`
- En mentions-mobile-fold.png y mentions-tablet-fold.png (768px entra en el branch 'mobile', shell.js:41-45) las tarjetas quedan 2+2+1: VIRALES ocupa media fila con un hueco vacío al lado, y es precisamente la única tarjeta interactiva (chevron de 10px en --text-3, screens.js:1028) — su affordance de clic es el elemento más débil de la fila mientras su posición sugiere un error de maquetado.
- *Importa porque:* Una rejilla incompleta se lee como "falta algo" o "se rompió", y en la primera pantalla del móvil es lo último que ve el usuario antes de la lista. Además cinco tarjetas del mismo aspecto con una sola clicable convierte la interacción en un descubrimiento por azar.
- *Arreglo:* Reducir a 4 tarjetas fusionando Total+Velocidad (ver MEN-10): rejillas limpias 4/2/2. Diferenciar lo clicable con una señal real (chevron a --text-2 12px, borde en hover ya existente y `cursor:pointer` visible) o convertir el acceso a la porción de virales en un enlace explícito "Ver las 1,024 →" dentro de la tarjeta.

**· [MEN-23] Microcopy que oculta la definición: "Virales (≥ 5K)", "Velocidad", "Menciones" tres veces y un eyebrow que no orienta** · `copy`

- `apps/web/public/eco-prototype/screens.js:705 (VIRAL_THRESHOLD), :959 (label), :953 (label Velocidad), :…`
- "Virales (≥ 5K)" no dice 5K de qué (son 5,000 puntos de engagement, una constante hardcodeada sin base documentada); "Velocidad" no dice velocidad de qué (es el cambio % del volumen, eco-data:366-369); la palabra "Menciones" aparece tres veces en el mismo pliegue (badge del nav con 1.3K, h1 y card-hd) y el eyebrow dice "FLUJO DE CONVERSACIÓN", que no distingue esta pantalla de Sentimiento ni de Tópicos.
- *Importa porque:* En una herramienta de gobierno cada cifra puede acabar en una comunicación pública, así que un umbral sin unidad ni fundamento es indefendible cuando alguien pregunta "¿por qué 5,000?". Y tres repeticiones del mismo rótulo gastan la parte más valiosa de la pantalla sin aportar información.
- *Arreglo:* "Virales · engagement ≥ 5,000" con tooltip que explique el origen del umbral (o derivarlo del percentil 95 del período y decirlo: "top 5% por engagement"); "Velocidad del volumen" con sub "+30% vs. 7 días anteriores"; eliminar el card-hd "Menciones" y usar ese espacio para el estado ("1,024 resultados · página 1 de 41"); eyebrow con la función real de la pantalla ("Explorador de menciones").

**· [MEN-24] Las filas de resultados no son operables por teclado (y la pantalla ya tiene el patrón correcto al lado)** · `affordance`

- `apps/web/public/eco-prototype/screens.js:1134 (div con onClick), :1169 (card con onClick), :1217 (tr co…`
- Las 25 filas de cada página son `<div onClick>` sin `role="button"`, sin `tabIndex`, sin manejo de Enter/Espacio y sin `:focus-visible`; el chevron final es un icono decorativo, no un botón. QuickMetric, en la misma pantalla, sí implementa el patrón accesible completo — la capacidad existe y no se aplicó donde importa. probe-report.json cuenta 42 elementos clicables en la pantalla y ninguna fila está entre ellos.
- *Importa porque:* Un usuario que navega con teclado (o con lector de pantalla) puede filtrar y paginar pero no puede abrir un solo resultado: la tarea principal de la pantalla queda cerrada. Para un contratista de gobierno esto es además un incumplimiento de accesibilidad documentable.
- *Arreglo:* Convertir la fila en un elemento interactivo real: `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter/Espacio) + estilo `:focus-visible` (el outline con --accent ya existe en index.html:191-195), o envolver el titular en un `<a href={url-interno}>` y dejar la fila como zona de clic secundaria. Extraer un componente `MentionRow` compartido por Lista/Cards/Tabla para no repetir el arreglo tres veces.


## Pantalla Sentimiento

*27 hallazgos*

La pantalla está bien compuesta —cuatro tarjetas, un hero, buen reflow sin desbordes— y aun así es la menos confiable que he auditado, porque las tres afirmaciones más grandes que hace son mutuamente incompatibles: el hero dice "Neutral", el donut de al lado dice 44% negativo contra 21% positivo, y el párrafo interpretativo dice "dentro de rango positivo". Ese párrafo está escrito a mano en el JSX (screens.js:1641): no cambia con la agencia, el periodo ni los datos, y sigue narrando una crisis vial incluso cuando la pantalla está vacía. Debajo hay un patrón repetido: cada widget resuelve su propio denominador sin declararlo —910 "menciones clasificadas" que en realidad son etiquetas de emoción multi-label recortadas al top-8, barras normalizadas que dan el mismo peso visual a un canal de 66 menciones y a uno de 446, y un residuo de redondeo que siempre se descarga en el bucket "negativo"—. El color agrava todo: la emoción dominante (Ira) y tres más caen al mismo gris de fallback, que es también el gris del texto terciario y el de la serie Neutral. Lo notable es que el arreglo ya está escrito: tokens.css define --emo-ira, --emo-tristeza, --chart-grid, la escala --fs-* y las clases .t-*, y screens.js consume exactamente cero de ellos (0 ocurrencias de emo-, cat-, chart-grid, fs-, t-display). No es una pantalla que necesite rediseño; es una pantalla que necesita conectarse al sistema que ya se construyó y declarar sus denominadores.

### P0 (5)

**✔︎ [SEN-02] El párrafo interpretativo del hero está escrito a mano en el JSX y contradice los datos de su propia tarjeta** · `copy`

- `apps/web/public/eco-prototype/screens.js:1640-1642`
- Texto literal en el JSX, sin interpolación de ninguna variable: «Sentimiento neto dentro de rango positivo, pero deterioro acelerado por discurso sobre infraestructura vial. Emociones dominantes de las últimas 24 horas: frustración y enojo.» En sentiment-desktop-fold.png ese párrafo convive con NSS −2.4 (negativo, no positivo) y 44% negativo; y las «emociones dominantes» que declara (frustración, enojo) no son las que reporta la tarjet…
- *Importa porque:* Es el bloque de la pantalla que más se parece a un análisis y el único escrito en prosa: exactamente lo que un cliente de gobierno copia y pega en un informe. Cuando descubra que ese párrafo dice lo mismo para la AAA que para la Gobernadora, y que afirma «rango positivo» sobre un número negativo, la credibilidad del r…
- *Arreglo:* Borrar el literal. Dos opciones, en este orden: (a) reemplazarlo por el insight generado que ya existe —hay un endpoint /api/eco-metric-insight y openNssInsight() en screens.js:1529-1541 lo usa para el modal— renderizado con estado de carga y con vacío explícito («Sin lectura para este periodo»); (b) si no se quiere llamada de IA en el primer render, generar la frase por plantilla desde los mismos datos que pinta el donut (banda + delt…
- *Verificador:* Dos precisiones que no alteran el veredicto ni la severidad, pero que conviene ajustar antes de entregar al cliente, porque un lector técnico podría usarlas para desacreditar el hallazgo entero: 1. «sin ninguna fila llamada "enojo"» es literalmente cierto pero semánticamente flojo: en español «Ira» y «enojo» son sinónimos, y la tarjeta EMOCIONES DETECTADAS pone Ira en el podio con 223 (24.5%, marcada como EMOCIÓN DOMINANTE). Un defensor diría que el párrafo acertó una de las dos. La contradicción sólida no es la nomenclatura, es el par: el párrafo declara **frustración y enojo** como las dos dominantes, cuando el ranking real de la propia tarjeta es **Ira 223 (24.5%) y Esperanza 220 (24.2%)…

**✔︎ [SEN-03] Al hacer click en un día se abre un histograma «Volumen por hora» generado con una onda seno sintética** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:1574-1584 (render en .../shell.js:1328-1344)`
- openTimelineDaySlice() construye las 24 barras así: `const base = Math.sin((h - 10) / 24 * Math.PI) * 0.5 + 0.5; return Math.round(base * (total / 24) * 1.6);` y las pasa como `histogram: { label: 'Volumen por hora', values: hours, xLabels: ['00:00' … '23:00'] }`. shell.js:1328-1344 las dibuja como un gráfico de barras real con eje horario. No hay marca de agua, ni nota, ni «ilustrativo». El camino de entrada es la llamada a la acción…
- *Importa porque:* Es dato inventado presentado como medición, en la interacción que la pantalla misma invita a hacer. Un director de comunicaciones que vea «el pico fue a las 2 PM» y monte una respuesta sobre eso está actuando sobre una función trigonométrica. Y como la curva es determinista, siempre pica a la misma hora en todos los d…
- *Arreglo:* Quitar las tres generaciones sintéticas. Si /api/eco-mentions puede agregar por hora para el día seleccionado, pedirlo y renderizarlo; si no puede todavía, no renderizar el bloque `histogram` en ese modal (el modal ya tiene el desglose pos/neu/neg real en screens.js:1583 y el filtro de menciones del día). Regla de sistema: ninguna serie que no venga del API entra al render; si se necesita un placeholder para maquetar, que sea un skelet…
- *Verificador:* Sostener P0. Dos precisiones al hallazgo, no correcciones de fondo: (1) la réplica de Tópicos (`screens.js:2003-2007`) es más engañosa que las otras dos porque añade `jitter` determinista para romper la simetría del seno, y ahí el modal NO tiene desglose de sentimiento real que compense — el histograma sintético es prácticamente el único contenido cuantitativo del modal; (2) en Dashboard (`screens.js:268-286`) el punto de entrada es `MultiLineChart` (`charts.js:279`), no `StackedAreaChart`, y ahí no hay subtítulo que anuncie el click, así que el usuario lo descubre por el `cursor:pointer`.

**✔︎ [SEN-04] «910 menciones clasificadas» son etiquetas de emoción, no menciones: denominador multi-label y recortado al top-8** · `data-integrity`

- `apps/web/src/app/api/eco-data/route.ts:855-886 · .../apps/web/public/eco-prototype/screens.js:1790, 181…`
- El API agrega con `FROM mentions m, jsonb_array_elements(m.nlp_emotions) AS e ... COUNT(*)` (route.ts:855-865): una mención con 3 emociones se cuenta 3 veces, y el processor permite hasta 3 (`maxItems: 3`, .../infra/lambda/processor/index.ts:466). Luego `.slice(0, 8)` (route.ts:886) recorta la cola. En el front, EmotionsCard suma ese arreglo ya recortado (`const total = sorted.reduce(...)`, screens.js:1790) y lo rotula «Perfil del perí…
- *Importa porque:* «El 24.5% de las menciones expresan ira» y «el 24.5% de las etiquetas de emoción del top 8 son ira» son afirmaciones distintas, y la segunda no se puede convertir en la primera sin saber la distribución de etiquetas por mención. Un cliente que lleve ese 24.5% a una rueda de prensa está afirmando algo que el dato no so…
- *Arreglo:* Separar las dos magnitudes en el API: devolver `emotionTagCount` (la suma actual) y `classifiedMentionCount` (`COUNT(DISTINCT m.id) WHERE jsonb_array_length(nlp_emotions) > 0`), más `totalMentions` del periodo. En la tarjeta, rotular con el número de menciones y calcular los porcentajes sobre menciones distintas, no sobre etiquetas; si se conserva el conteo de etiquetas, decirlo («910 etiquetas en 604 menciones · una mención puede tene…
- *Verificador:* SEN-04 (P1) · «910 menciones clasificadas» son etiquetas de emoción, no menciones — y la cobertura del periodo es invisible Ubicación: `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/apps/web/src/app/api/eco-data/route.ts:855-865` (agregación) · `.../apps/web/public/eco-prototype/screens.js:1790` (suma) y `:1819` (rótulo). Qué pasa: el API cuenta etiquetas (`jsonb_array_elements` + `COUNT(*)`) y el processor asigna hasta 3 por mención (`infra/lambda/processor/index.ts:466`, prompt en `:422`). La tarjeta suma esas etiquetas y las rotula «menciones clasificadas» (`screens.js:1819`). Un lector de gobierno concluye que se clasificaron 910 menciones cuando pueden ser ~350–900…

**· [SEN-05] La tarjeta «Sentimiento en el tiempo» grafica volumen absoluto apilado, así que no puede responder si el sentimiento empeoró** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:1680-1685 · .../apps/web/public/eco-prototype/charts.js:468-46…`
- El título es «SENTIMIENTO EN EL TIEMPO» y el subtítulo confiesa el contenido real: «Volumen apilado». StackedAreaChart apila conteos crudos (charts.js:472-477) sobre `max = Math.max(1, ...totals)` (charts.js:469). En sentiment-desktop.png el 22 de julio produce una montaña naranja que triplica la altura de cualquier otro día: el ojo lee «estallido de negatividad», pero la banda naranja creció porque el TOTAL del día creció (el eje lleg…
- *Importa porque:* Es el gráfico grande de la pantalla de sentimiento y la pregunta que se le hace es siempre la misma: ¿vamos mejor o peor que la semana pasada? Tal como está, sólo contesta «¿hubo un pico de conversación?», que es la pregunta que ya contesta la tarjeta de volumen de otra pantalla. Peor: contesta la pregunta de sentimie…
- *Arreglo:* Dos series, no una: (a) un área 100% normalizada (cada día suma al alto completo) que muestre la MEZCLA, con el volumen del día como barra tenue de fondo o como sparkline gemela debajo; o (b) una línea de NSS diario con banda de referencia y el volumen como área de fondo. Si se conserva el apilado absoluto, renombrar la tarjeta a «Volumen por sentimiento» y mover el orden de apilado a Negativo abajo (base estable). En cualquier caso el…

**· [SEN-06] La emoción dominante «Ira» y tres más se pintan del mismo gris de fallback; los tokens --emo-* correctos ya existen y no se usan** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:1777-1786 · tokens ya definidos en .../apps/web/public/eco-pro…`
- emotionColor() decide por nombre contra una lista de 11 palabras (enojo, frustración, preocupación, sarcasmo, indiferencia, confusión, gratitud, esperanza, alegría, aprobación, alivio) y devuelve hex crudos (#8C5BA8, #7B8794, #5FA98A). Las emociones que realmente se pintan en pantalla son Ira, Esperanza, Alegría, Frustración, Sorpresa, Miedo, Tristeza: cuatro de las siete (Ira, Sorpresa, Miedo, Tristeza) no están en la lista y caen al…
- *Importa porque:* El gris es el color de «neutral / sin señal» en esta misma pantalla: es la banda Neutral del área apilada, el segmento Neutral del donut y el color del texto secundario. Pintar de gris la ira —la emoción más accionable para una agencia de gobierno, y aquí la número uno— le dice al lector exactamente lo contrario de lo…
- *Arreglo:* Reemplazar el cuerpo de emotionColor por un lookup a los tokens: `var(--emo-<slug>)` con normalización de acentos, y un `--emo-unknown` obligatorio (visualmente distinto del gris de texto) para lo no mapeado. Antes de eso, unificar la taxonomía: el enum del processor es la única lista que puede materializarse en la DB, así que los --emo-* deben cubrir esas 7 palabras (hoy sólo cubren «frustración»), y el colorMap del API (route.ts:875-…

### P1 (15)

**· [SEN-07] Las barras de emoción se escalan sobre el total, así que la más larga usa el 27% de su carril y las tres últimas son puntos idénticos** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:1858, 1873-1880`
- `const pct = (e.count / total) * 100` y `width: ${Math.max(2, pct)}%` — el ancho es el porcentaje sobre el total de 910, no sobre el máximo de la serie. Medido en el recorte /tmp/emo.png: el carril mide ~325px y el relleno de Ira ~87px, es decir el 27%; el 73% de cada carril está vacío por construcción y ningún dato podrá llenarlo nunca. Las tres últimas (Sorpresa 91, Miedo 84, Tristeza 73) miden 28/26/22px, y como la barra tiene 8px d…
- *Importa porque:* La tarjeta se llama «Emociones detectadas» y su trabajo es dejar ver de un golpe la forma del perfil emocional. Con el 73% del carril inutilizado y las diferencias comprimidas en una franja estrecha, el gráfico no rankea nada: el lector termina leyendo la columna de números, y entonces las barras son ruido decorativo…
- *Arreglo:* Escalar al máximo de la serie (`pct / maxPct * 100`) para que la primera barra llene el carril y las proporciones relativas sean legibles; mantener el porcentaje sobre el total en el texto, que es donde pertenece. Subir la barra de 8 a 10px y bajar borderRadius a 2 para que los casquetes no consuman la longitud de los valores pequeños. Sustituir el piso `Math.max(2, pct)` por un piso en píxeles (min-width: 3px), que no distorsiona la e…

**· [SEN-08] El dominio Y lo fija un único día atípico y no se redondea: 70% del área de trazado vacía y 29 días planchados** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:469, 502-504, 512-515`
- `const max = Math.max(1, ...totals)` sin redondeo a valor «bonito»: las etiquetas del eje salen 367 / 184 / 0 (charts.js:512-515 imprime `Math.round(max*(1-p))` para p ∈ {0, 0.5, 1}). En sentiment-tablet-fold.png el área de trazado mide ~437px y la pila típica de un día ocupa los ~110px de abajo: más del 70% del gráfico es aire, y los 29 días que no son el 22 de julio quedan comprimidos en el cuarto inferior, donde su variación día a d…
- *Importa porque:* Cuando un solo pico define la escala, la gráfica sólo sabe contar el pico. Para el trabajo real de la pantalla —notar que el tono lleva cuatro días deslizándose— la resolución vertical disponible es del 25%, y eso es lo que hace que el usuario no pueda ver un deterioro gradual hasta que ya es un pico.
- *Arreglo:* Redondear el dominio a una escala legible (paso 1/2/5 × 10^n → 400 en vez de 367) y etiquetar las cinco rejillas que ya se dibujan, o dibujar sólo tres. Para el aplastamiento por outlier: al normalizar a 100% (ver SEN-05) el problema desaparece de raíz; si se conserva el absoluto, ofrecer recorte al percentil 95 con marca explícita del valor recortado (nunca silenciosa). Y dejar de tratar el hueco de datos como cero: tokens.css:349 ya…

**· [SEN-09] «Distribución normalizada» da idéntico peso visual a un canal de 66 menciones y a uno de 446; el n va en 12px al 2.65:1** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:1725-1748`
- Las seis barras se dibujan al 100% del ancho de su columna sin ninguna codificación del volumen (screens.js:1736-1743); el único indicador de tamaño es el conteo a la derecha del nombre, en fontSize 12 y color var(--text-3) (screens.js:1734), que el probe mide en 2.65:1 sobre --canvas (falla AA 4.5:1). En sentiment-desktop.png el lector escanea seis barras del mismo largo y la que más grita es «Blogs · 56% neg» — con n=79, el 6% del to…
- *Importa porque:* Esta tarjeta es la que se usa para decidir dónde intervenir. Tal como está, empuja sistemáticamente hacia los canales pequeños, porque los porcentajes extremos viven en las colas: un equipo de comunicaciones dedicará esfuerzo a Blogs (79 menciones) creyendo que es el frente crítico mientras Noticias (446) queda iguala…
- *Arreglo:* Codificar el volumen: ancho de la barra proporcional a n (o alto proporcional, manteniendo el 100% de la mezcla), o ordenar por n y atenuar las filas bajo un umbral (por ejemplo n<100) con una nota «muestra pequeña». Subir el conteo a --fs-caption (12px) con color --text-2 para que se lea, y añadir el n al aria/title de cada segmento. Mantener el 100% normalizado —es la decisión correcta para comparar mezclas— pero nunca sin el n al mi…

**· [SEN-10] 18 botones sin nombre accesible de 12px de alto son la única forma de profundizar en la tarjeta; uno mide 3px de ancho en móvil** · `touch-target`

- `apps/web/public/eco-prototype/screens.js:1736-1743`
- Cada barra es un flex de tres <button> con `width: ${pct}%`, `padding: 0`, dentro de un contenedor de `height: 12` — sin texto, sólo atributo `title`. El probe de /sentiment los lista como 18 entradas «button» de 12px de alto sin nombre, con anchos de 6, 56, 106, 133, 145, 161, 178, 211, 234, 239, 261, 267, 311px en escritorio y de 3, 33, 63, 80, 86, 96, 106, 126, 139, 143, 156, 159, 186px en móvil. El de 3px es el segmento «1% neu» de…
- *Importa porque:* El subtítulo de la tarjeta promete «click un segmento para ver menciones» y el segmento es físicamente inalcanzable con el pulgar. Además, para un lector de pantalla la tarjeta es una lista de 18 botones llamados «button»: la pantalla que analiza el sentimiento ciudadano es la menos accesible del producto, en una herr…
- *Arreglo:* Envolver la barra en un contenedor de 44px de alto con la barra de 12px centrada (el área táctil crece sin cambiar el diseño), y dar a cada segmento `aria-label` explícito («Noticias, 26% negativo, 116 menciones — ver menciones»). Para segmentos bajo ~8% del ancho, no depender del click sobre el segmento: añadir las tres etiquetas de porcentaje de abajo (screens.js:1744-1748) como los targets reales, que ya tienen texto y posición esta…

**· [SEN-11] Todo el rectángulo de 260px del gráfico es una sola superficie de click sin límites verticales, y en táctil el tooltip no existe** · `affordance`

- `apps/web/public/eco-prototype/charts.js:479-486, 500, 530`
- `pickIdx` sólo consulta la coordenada X (`const x = e.clientX - rect.left - padding.l; const idx = Math.round(x / step)`) y no verifica Y: un click en el cielo vacío sobre las áreas, o dentro de los 36px del padding izquierdo, abre igualmente el modal de un día. El SVG entero lleva `cursor: pointer` (charts.js:500), así que no hay ninguna señal de dónde está el punto que se va a seleccionar. El tooltip y el crosshair sólo existen bajo…
- *Importa porque:* El gesto principal de la tarjeta se vuelve una lotería en el dispositivo donde más se consulta un dashboard de crisis. Y en escritorio el «todo es clickeable» sin retroalimentación previa hace que cada exploración cueste un modal que hay que cerrar.
- *Arreglo:* Acotar el hit-test al área de trazado (rechazar si la Y cae fuera de [0, innerH]) y dibujar bandas de hover por día para que el punto activo sea visible antes del click. En táctil, primer toque = mostrar crosshair y tooltip fijado, segundo toque en el mismo día = abrir el modal; alternativamente, un selector de día explícito bajo el eje. Extraer esto a una primitiva compartida, porque MultiLineChart y StackedAreaChart ya duplican el pa…

**· [SEN-12] El número protagonista es el elemento grande más apagado de la pantalla (2.65:1 en 40px, necesita 3:1) y el ojo se va a un conteo de etiquetas** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:1626 · .../packages/shared/src/format/metrics-display.ts:78-83…`
- El hero se colorea con `m.display.nss.color`, que para la banda NEUTRAL es TONE_COLOR.neutral = var(--text-3) (metrics-display.ts:82-83, 99). El probe de sentiment-desktop lo mide: «Neutral», 40px, weight 600, rgb(82,91,104) sobre rgb(14,22,32), ratio 2.65 con necesidad 3.0 — el texto más grande de la pantalla es el único que falla el umbral de texto grande. En sentiment-desktop-fold.png el orden real de atención es: (1) el pico naranj…
- *Importa porque:* La jerarquía visual está enseñando la lectura equivocada: quien entre tres segundos se lleva «223 de ira» —un número cuyo denominador es discutible (SEN-04)— en lugar del estado del sentimiento. Y la coincidencia de que la banda neutra use el color del texto terciario significa que el hero se apaga precisamente cuando…
- *Arreglo:* Desacoplar el color de la banda del color del texto: introducir un tono neutro de datos con contraste de texto grande (≥4.5:1 aunque sea grande) en vez de reutilizar --text-3 en TONE_COLOR.neutral; tokens.css:207 ya define --neu para ese rol semántico. Bajar el «223» de la tarjeta de emociones a --text-2 y a --fs-num-md (18px) para que no compita con el hero, y subir el hero a --fs-display-2xl con --ff-display (Besley) para que gane po…

**· [SEN-13] En móvil la cabecera de «Sentimiento por fuente» aplasta el título a 3 líneas y el subtítulo a 6 mientras los tabs conservan 250px** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:1698-1717`
- La cabecera es `display: flex, justifyContent: space-between` sin `flexWrap` y sin rama de breakpoint (screens.js:1698), con un grupo de cuatro píldoras de padding fijo que no encoge. En el recorte /tmp/mobhdr.png (de sentiment-mobile.png) el resultado es literal: «SENTIMIENTO / POR / FUENTE» en tres líneas y «Distribución / normalizada / · click un / segmento / para ver / menciones» en seis, todo dentro de una columna de ~90px, mientr…
- *Importa porque:* Es la tarjeta más alta de la pantalla y su cabecera queda ilegible justo en el dispositivo donde el título es la única pista de qué se está mirando. Rompe además la promesa del overhaul responsive: el reflow del contenido funciona, pero el encabezado —que es lo que orienta— es lo que se degrada.
- *Arreglo:* Bajo el breakpoint móvil, apilar: título y subtítulo a ancho completo y el grupo de dimensión en una fila propia debajo, con scroll horizontal si hiciera falta (o un <select> nativo, que además arregla el target de 22px). Concretamente: envolver la cabecera con `flexDirection: window.ecoCols('row','column')` y `alignItems: 'stretch'`. Y acortar el subtítulo, que hoy carga la instrucción de interacción («click un segmento…») en el lugar…

**· [SEN-14] En móvil el cromo de cabecera consume 319px antes del primer dato (contra 160 en escritorio), con una casilla dedicada al botón de sol** · `density`

- `apps/web/public/eco-prototype/shell.js:405-432, 549-552`
- Medido sobre sentiment-mobile.png (1170px a DPR 3): el borde superior de la tarjeta NSS cae en 956px del bitmap = 319 CSS px, repartidos en cinco filas apiladas — hamburguesa+eyebrow+título, buscador, selector DDEC, píldoras de periodo, y una quinta fila con Fechas + Chat + el botón de sol. En un viewport de 390×844 eso es cerca del 40% de la primera pantalla sin un solo dato. En sentiment-desktop-fold.png el mismo cromo mide ~160 CSS…
- *Importa porque:* Un dashboard de monitoreo se consulta en el teléfono, de pie, en medio de una crisis; que el primer scroll sea íntegramente controles es un costo directo sobre la tarea. Y darle a un cambio de apariencia el mismo rango espacial que al selector de periodo —hasta el punto de que se lleve una fila propia en escritorio— c…
- *Arreglo:* Mover el toggle de modo al menú de usuario del sidebar o a la paleta de comandos (ya existe la entrada «Cambiar a modo claro» en shell.js:602) y sacarlo de la barra. En móvil, colapsar buscador y selector de agencia en una fila (icono de lupa + agencia) y las píldoras de periodo en un control con scroll horizontal y targets de 44px, apuntando a ≤180px de cromo. Fusionar además el eyebrow con «DATOS AL CIERRE DE AYER», que hoy son dos l…

**· [SEN-15] Cero escalado tipográfico entre 1440 y 390, y el 40% del texto va por debajo del piso de 12px que el propio sistema declara** · `type-scale`

- `apps/web/public/eco-prototype/screens.js:1626-1884 (censo) · piso declarado en .../apps/web/public/eco-…`
- El censo de fuentes del probe es idéntico byte a byte en los cuatro viewports: IBM Plex Sans 99 nodos {9:2, 10:32, 11:17, 12:28, 13:12, 14:3, 16:2, 18:1, 22:1, 40:1} + IBM Plex Mono 40 nodos {9:8, 10:14, 12:13, 13:3, 15:1, 22:1}. Son 139 nodos de texto, de los que 129 (93%) miden ≤13px y 56 (40%) miden ≤10px. El sistema de diseño dice lo contrario en tokens.css:61-63: «--fs-caption: 12px /* PISO: metadatos, marcas de tiempo, ejes */» y…
- *Importa porque:* Los números de 9px son justamente las cifras de apoyo que sostienen las conclusiones (los porcentajes por emoción, las mezclas por canal). Pedirle a un director de agencia que lea 9px en un teléfono es garantizar que no los lea y decida sólo con la forma de las barras — que, según SEN-06 y SEN-07, es la parte menos fi…
- *Arreglo:* Migrar la pantalla a la escala que ya existe: `--fs-caption` (12) como piso duro para todo lo que hoy está en 9 y 10, `--fs-overline` (11) sólo para eyebrows en mayúsculas, `--fs-body-sm` (13) para filas densas, y `--fs-num-*` para las cifras; el hero a `--fs-display-2xl`, que ya es `clamp(30px, 3.6vw, 40px)` y por tanto escala solo. Añadir una regla de CI que falle si aparece un fontSize numérico <12 en screens.js. Nota de planificaci…

**· [SEN-16] Adopción cero del sistema de tokens en esta pantalla: 9 tamaños, 9 gaps, 5 radios y 3 hex crudos en 385 líneas** · `consistency`

- `apps/web/public/eco-prototype/screens.js:1510-1894`
- Conteo dentro de SentimentScreen + EmotionsCard (385 líneas): fontSize con 9 valores distintos (40, 22, 18, 15, 14, 12×9, 11, 10×4, 9), gap con 9 (2, 4, 6×3, 8×2, 12×3, 14×2, 16×3, 18×2, 24), padding con 6 y borderRadius con 5 (4×2, 6×3, 8, 999×2, 50%), más tres hex hardcodeados en 9 ocurrencias (#7B8794 ×5, #8C5BA8 ×2, #5FA98A ×2). Grep de las familias de tokens que tokens.css ya define, sobre screens.js completo: `--emo-` 0, `--cat-`…
- *Importa porque:* Tres commits de sistema de diseño (92e0d4a, d8ddb32, a69ea2e) ya corrigieron el contraste de --text-3, separaron --accent de --neg y sembraron paletas categóricas y de emoción; ninguna de esas correcciones llega a esta pantalla porque los valores están inline. Peor: como los hex quedaron congelados, la corrección de -…
- *Arreglo:* Migración mecánica y verificable en un solo PR por pantalla: sustituir los estilos inline por las clases .t-* y las variables --fs-*/--r-*/--emo-*/--chart-*, empezando por los tres hex y por los tamaños <12px (que son también los hallazgos SEN-06 y SEN-15). Cerrar la puerta después: regla de CI que falle ante un `#rrggbb` o un `fontSize:` numérico nuevo en screens.js/charts.js. Y cubrir el hueco que le falta al propio token layer: no h…

**· [SEN-17] Dos «−2.4» contiguos que significan cosas distintas, en dos colores, separados por una flecha decorativa** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:1625-1638`
- El botón del hero coloca en una sola línea de baseline: la palabra (40px), el valor «−2.4» (15px, --text-2), un Icons.ArrowRight de 14px, y el delta «▼ −2.4 vs período anterior» (12px, naranja). En sentiment-desktop-fold.png se leen literalmente dos «−2.4» a 120px de distancia: uno es el nivel del NSS y el otro el cambio contra el periodo anterior, sin nada que los distinga salvo el triángulo. Los tonos también se contradicen: la palab…
- *Importa porque:* El bloque que debería resolver la pregunta «¿cómo estamos y hacia dónde vamos?» exige que el lector desambigüe dos cifras idénticas y dos colores opuestos. En un vistazo rápido lo más probable es leer −2.4 como una sola cosa y perder el delta, que es la mitad accionable.
- *Arreglo:* Separar en dos renglones tipográficos: renglón 1 = palabra + valor con su rango («Negativo · −23 de −100 a +100»); renglón 2 = delta con etiqueta explícita («−2.4 pts vs. los 7 días previos»). Etiquetar la unidad del delta (puntos, no porcentaje) porque formatDelta lo emite como `absolute` (route.ts:374). Quitar la flecha del interior y dar la afordancia con hover/foco sobre toda la fila. Si palabra y delta discrepan en tono, que la pa…

**· [SEN-18] --text-3 hace de texto terciario, de serie de datos «Neutral» y de fallback de emoción; el token --neu existe y no se usa** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:1646, 1656, 1685, 1688, 1740 · token disponible en tokens.css:…`
- El mismo `var(--text-3)` se usa como color del segmento Neutral del donut (screens.js:1646), del punto de su leyenda (1656), de la banda Neutral del área apilada (1685), del punto de la leyenda del gráfico (1688) y del segmento neutral de las barras por fuente (1740) — y simultáneamente, según el probe, como color de los 45 textos de baja jerarquía de la pantalla (eyebrows, subtítulos, conteos, porcentajes, ejes). tokens.css:207 define…
- *Importa porque:* Mientras texto y dato compartan variable, cualquier ajuste de legibilidad del texto reescribe el significado de una serie del gráfico, y viceversa: es la razón por la que la corrección de contraste ya aplicada en tokens.css no se puede propagar sin riesgo. Y hoy provoca la colisión más dañina de la pantalla, que la ir…
- *Arreglo:* Separar los espacios de color: `--neu`/`--neu-bg` para la serie Neutral en donut, área y barras; `--chart-axis` para ejes y `--text-3` sólo para texto. Desapuntar --neu de --text-3 en tokens.css:207 y darle un valor propio con contraste suficiente frente a --pos y --neg en las dos modalidades. Con eso, subir --text-3 a los 5.00:1 que tokens.css:192 ya trae deja de tocar los datos y cierra los 45 hallazgos de contraste de golpe.

**· [SEN-19] La última etiqueta del eje X sale recortada («27 ju»): padding derecho de 10px para una etiqueta centrada en el borde** · `data-integrity`

- `apps/web/public/eco-prototype/charts.js:458, 519-524`
- `padding = { t: 10, r: 10, b: 24, l: 36 }` y la última marca se dibuja en `x = idx * step` = innerW con `textAnchor="middle"` (charts.js:523): la mitad derecha de la etiqueta necesita ~14px y sólo hay 10 de padding, así que el SVG la corta. El dato es correcto —esShortDate (eco-data/route.ts:84-101) produce «27 jul» vía toLocaleDateString es-PR— y en el recorte /tmp/xaxis.png se ve la «l» cortada al ras del borde. Se repite igual en es…
- *Importa porque:* En la gráfica principal de la pantalla, el extremo derecho es el dato más reciente y el que más se mira. Una fecha truncada en el punto que el usuario está usando para orientarse siembra la duda de si el periodo llega hasta donde dice, y es el tipo de detalle que un cliente señala en la primera demo.
- *Arreglo:* Subir `padding.r` a 28 (o calcularlo del ancho de la etiqueta más larga) y, mejor, anclar las marcas extremas al borde: `textAnchor="start"` para la primera y `"end"` para la última en vez de centrarlas. Extraer la utilidad de ejes a un solo lugar y aplicarla a Sparkline, AreaLineChart, MultiLineChart y StackedAreaChart, que hoy repiten cuatro implementaciones con paddings distintos.

**· [SEN-20] El modal de emoción sigue coloreándose con el `color` del backend, así que el arreglo documentado sólo se aplicó a la tarjeta** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:1559-1568 (comentario del arreglo en 1760-1786) · fuente del v…`
- openEmotionSlice hace `const accent = \`var(--${e.color})\`` (screens.js:1560), donde `e.color` viene del emotionColorMap del API, que devuelve 'neu' para todo lo que no esté en sus 7 llaves (route.ts:883: `?? 'neu'`). El comentario de la tarjeta (screens.js:1762-1766) documenta exactamente este bug —«el backend mapeaba emociones a color: 'neu', pero --neu no existe como CSS var, así que background: var(--neu) resolvía vacío»— y declar…
- *Importa porque:* El click en una fila es la acción principal de la tarjeta, y en cuatro de siete filas el modal se abre con un acento que no corresponde a la emoción: ira y sorpresa se presentan con el mismo color neutro. Es también un aviso de proceso: hay un arreglo documentado como cerrado que está a medias, y el token que lo tapab…
- *Arreglo:* Que openEmotionSlice llame a la misma función de color que la tarjeta —`emotionColor(e.emotion)`— en lugar de a `e.color`, y una vez unificada la taxonomía (SEN-06), que esa función devuelva `var(--emo-*)`. Eliminar `color` de la respuesta del API (route.ts:875-883): el color es decisión de presentación y tenerlo en el payload es lo que permitió que dos capas divergieran.

**· [SEN-21] El Donut no tiene guarda de cero: con datos vacíos dibuja un path NaN (anillo invisible), la leyenda imprime 0%/0%/0% y la prosa sigue narrando la crisis** · `empty-state`

- `apps/web/public/eco-prototype/charts.js:580-601 · defaults en .../apps/web/public/eco-prototype/data.js…`
- `const sum = total ?? data.reduce((s, d) => s + d.value, 0)` y luego `const frac = d.value / sum` (charts.js:580, 587): con el default de data.js:70-74 (los tres valores en 0) sum = 0, frac = NaN, y el path sale `M NaN NaN A …`, que el navegador descarta sin error de consola. Los otros tres widgets de la pantalla sí tienen vacío explícito —StackedAreaChart «Sin datos suficientes para graficar» (charts.js:462-466), EmotionsCard «Sin emo…
- *Importa porque:* El primer frame que ve un usuario nuevo, y el frame de cualquier agencia sin datos del periodo, es una tarjeta que parece funcionar y afirma una crisis inventada. Un anillo ausente sin mensaje se lee como «no hay problema», no como «no hay dato», que es lo contrario de lo que un sistema de alerta temprana debe comunic…
- *Arreglo:* Guarda en Donut: si sum ≤ 0, renderizar el anillo del track en --chart-void con un «Sin clasificar» centrado, nunca un path NaN. En la tarjeta hero, un único estado vacío que cubra hero + donut + prosa a la vez (la prosa desaparece con SEN-02). Y un skeleton compartido para el primer render, en lugar de pintar los defaults de data.js como si fueran medidas: hoy la diferencia entre «cargando», «vacío» y «cero real» es invisible en las t…

### P2 (7)

**· [SEN-22] «click un día» / «click un segmento»: anglicismo e imperativo mal formado en los dos subtítulos más leídos** · `copy`

- `apps/web/public/eco-prototype/screens.js:1680, 1701, 1737-1742`
- Los subtítulos dicen «Volumen apilado · click un día para ver menciones» y «Distribución normalizada · click un segmento para ver menciones»; los title de los 18 segmentos repiten «— click para ver menciones» (screens.js:1737-1742). No es sólo el préstamo: «click un día» no tiene verbo conjugado en español, es una traducción literal de «click a day».
- *Importa porque:* Es una plataforma del Gobierno de Puerto Rico y el texto de interfaz es lo primero que se revisa en una entrega institucional. Dos de las cuatro tarjetas llevan el error en su línea de instrucción, que es exactamente el texto que un usuario lee cuando no sabe qué hacer.
- *Arreglo:* «Haz clic en un día para ver sus menciones» / «Selecciona un segmento para ver sus menciones»; en táctil, «Toca un día…». Definir en el sistema de diseño la forma canónica de las instrucciones de interacción (persona, verbo, y variante táctil) y aplicarla a los title/aria de los segmentos en el mismo paso que SEN-10.

**· [SEN-23] El residuo de redondeo se descarga siempre en «negativo», y los tres porcentajes del donut pueden sumar 99% o 101%** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:1727-1729, 1654-1655`
- En las barras por dimensión: `pos = Math.round(...)`, `neu = Math.round(...)`, y `neg = Math.max(0, 100 - pos - neu)` (screens.js:1729) — el negativo no se redondea, absorbe el error de los otros dos, hasta 1pp de sesgo sistemático siempre en la misma dirección y siempre en el bucket que dispara decisiones. En el donut el problema es el complementario: los tres porcentajes se redondean por separado (screens.js:1655) sin corrección de r…
- *Importa porque:* Un punto porcentual no cambia una decisión, pero un donut que suma 101% sí destruye la confianza en toda la pantalla, y que el error vaya siempre al negativo es indefendible en una revisión metodológica. Ambas cosas son gratis de arreglar y caras de explicar.
- *Arreglo:* Usar reparto de residuo (método del mayor resto) en los dos sitios: redondear los tres valores y asignar el punto sobrante al de mayor parte fraccionaria, no a un bucket fijo. Extraerlo a un helper compartido en @eco/shared/format —el mismo problema existe en cada desglose porcentual del producto— y cubrirlo con un test que verifique suma exacta 100 sobre entradas adversas.

**· [SEN-24] ~130px de vacío al fondo de la tarjeta del gráfico porque su altura es fija dentro de un grid que estira** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:1677-1691`
- El grid es `1.5fr 1fr` con alineación por defecto (stretch), así que la tarjeta del gráfico iguala la altura de EmotionsCard, pero su contenido tiene alto fijo: `<StackedAreaChart … height={260} />` (screens.js:1685) más la leyenda. En sentiment-desktop.png la leyenda «Positivo · Neutral · Negativo» termina hacia y≈956 y el borde inferior de la tarjeta está en y≈1136: unos 130 CSS px de tarjeta vacía junto a una tarjeta vecina llena ha…
- *Importa porque:* En una pantalla donde el gráfico principal sufre por falta de resolución vertical (SEN-08), tener 130px de lienzo desperdiciados al lado es la contradicción más visible del layout, y el borde inferior desalineado del contenido rompe el ritmo de la fila.
- *Arreglo:* Dejar que la gráfica llene la tarjeta: alto por contenedor (ResizeObserver o aspect-ratio) en vez de `height={260}`, con un mínimo de 240px. Alternativa de una línea si se prefiere no tocar el chart: `alignItems: 'start'` en el grid de screens.js:1677, que quita el estirado y elimina el hueco. La primera opción es mejor porque además le regala altura útil al eje Y.

**· [SEN-25] La dimensión activa (Fuente/Tópico/Subtópico/Región) no vive en la URL, a diferencia del patrón que la propia app ya estableció** · `affordance`

- `apps/web/public/eco-prototype/screens.js:1512, 1706-1716 · patrón establecido en screens.js:1897-1899`
- `const [groupBy, setGroupBy] = useState('source')` es estado local puro; el botón sólo hace `setGroupBy(o.k)` sin tocar la ruta. TopicsScreen documenta la convención contraria dos líneas después de terminar esta pantalla: «The open topic lives in the URL (/topics/<slug>) so the browser Back button…» (screens.js:1897-1899). Además los cuatro botones no forman un tablist accesible (sin role/aria-selected) y miden 22px de alto en todos lo…
- *Importa porque:* El hallazgo real de esta pantalla suele ser «el sentimiento por región está peor en el norte»; sin URL, ese hallazgo no se puede enviar por correo ni marcar, y el botón Atrás del navegador se lleva al usuario fuera de la pantalla en vez de a la dimensión anterior. Es la clase de fricción que hace que la gente pegue ca…
- *Arreglo:* Persistir la dimensión en la URL (`/sentiment?por=region`) leyendo el valor inicial de la query, igual que TopicsScreen; el mismo cambio hace que el estado sobreviva al `location.reload()` que usan los cambios de periodo y de agencia. Y convertir el grupo en un tablist real (role="tablist"/"tab", aria-selected) con targets de 32px en escritorio y 44px en móvil.

**· [SEN-26] Tres nombres para una pantalla y un acrónimo en inglés sin traducir ni escala declarada** · `copy`

- `apps/web/public/eco-prototype/screens.js:1621 · nav en .../apps/web/public/eco-prototype/shell.js:137-2…`
- En sentiment-desktop-fold.png el ítem de navegación dice «Sentimiento», el eyebrow encima del título dice «ANÁLISIS EMOCIONAL», el título dice «Sentimiento» y la primera tarjeta encabeza «NSS (NET SENTIMENT SCORE)» (screens.js:1621). El acrónimo se expande al inglés en una interfaz enteramente en español, y en ningún lugar de la pantalla se dice en qué escala vive ni qué es «bueno»: el hero muestra «−2.4» sin unidad ni rango (ver SEN-0…
- *Importa porque:* El eyebrow es lo primero que se lee y contradice el nombre por el que el usuario llegó, lo que hace dudar de si se navegó a otro sitio. Y un indicador sin escala no es interpretable: «−2.4» puede ser catastrófico o irrelevante y el lector no tiene forma de saberlo sin preguntar.
- *Arreglo:* Un nombre por pantalla: si el ítem de navegación es «Sentimiento», el eyebrow debe reforzarlo o desaparecer (hoy sólo repite y contradice). Traducir el rótulo a «Sentimiento neto (NSS)» y añadir el rango junto al valor o en un tooltip con la definición y las cinco bandas. Extender la regla a toda la app: cualquier métrica con banda debe mostrar su dominio en el punto de lectura, no sólo en el modal de insight.

**· [SEN-27] Icono de corazón huérfano en la única tarjeta que lo tiene, y no es interactivo** · `affordance`

- `apps/web/public/eco-prototype/screens.js:1801, 1821`
- `<Icons.Heart size={14} color="var(--text-3)" />` colocado en la cabecera de EmotionsCard —tanto en el estado vacío (1801) como en el normal (1821)— sin envolver en botón, sin onClick, sin title. Es el único adorno de este tipo en las cuatro tarjetas de la pantalla; el probe no lo lista entre los targets porque no es interactivo. Visualmente ocupa la esquina superior derecha, que en el resto del producto es donde viven acciones de tarj…
- *Importa porque:* Un icono en la posición canónica de una acción, en gris de baja prioridad, que no responde al click: el usuario lo prueba una vez, no pasa nada, y aprende a desconfiar de las afordancias de la interfaz. Cuesta más que el valor decorativo que aporta.
- *Arreglo:* Quitarlo, o convertirlo en la acción que insinúa (fijar/favoritear la tarjeta) con estado real, foco visible y target de 44px. Si se conserva, aplicarlo consistentemente a todas las tarjetas o a ninguna, y documentar en el sistema de diseño que la esquina superior derecha de una card está reservada para acciones.

**· [SEN-28] El ramp de bandas del NSS no es monótono: «Muy positivo» se pinta con el naranja de la marca, el mismo hue que significó negativo en todo el producto** · `color-semantics`

- `packages/shared/src/format/metrics-display.ts:78-83, 89-99 · valores en .../apps/web/public/eco-prototy…`
- BAND_TONE mapea 'MUY NEG'→neg, 'NEG'→warn, 'NEUTRAL'→neutral, 'POS'→pos y 'MUY POS'→accent (metrics-display.ts:91-97), y TONE_COLOR.accent = var(--accent) = #FF6A3D en mando dark (tokens.css:196). El ramp de color de los cinco niveles queda: rojo → ámbar → gris → verde → NARANJA. Es decir, al mejorar el sentimiento el color vuelve a la familia cálida de la advertencia. Sin ubicación exacta en captura: en estos shots la banda es NEUTRAL…
- *Importa porque:* Toda la pantalla enseña al lector que el naranja es lo negativo: el anillo del donut, la banda superior del área, las barras de frustración. Que el mejor estado posible del indicador principal use ese mismo naranja invierte el significado en el único momento en que la agencia tiene buenas noticias, y en modo claro lle…
- *Arreglo:* Quitar 'accent' del vocabulario de bandas: el acento es identidad de marca, no una posición en una escala ordinal. Mapear 'MUY POS' y 'FUERTE' a un tono positivo intenso derivado de --pos, y 'NEG' a un negativo atenuado en vez de warn, de forma que el ramp sea monótono en luminosidad y en hue (rojo → rojo claro → neutro → verde claro → verde). Verificarlo con un test de contraste par a par entre bandas adyacentes, en mando dark y mando…


## Pantalla Tópicos

*25 hallazgos*

Tópicos es la pantalla donde el cliente debería contestar en cinco segundos "¿de qué se está hablando y qué se está calentando?", y hoy contesta mal por tres razones que no son cosméticas. Primero, ninguno de los tres widgets codifica lo que su forma promete: el "Treemap" es una rejilla de filas de 76px donde el rango manda y el área no (171 y 53 menciones ocupan exactamente el mismo espacio, mientras 210 vs 171 se dibujan 4:1), el calendario coloca los días por índice de array y no por fecha (la cabecera LUN…DOM sólo es verdad si no falta ni un día), y las burbujas ubican los tópicos en posiciones pseudoaleatorias sin significado. Segundo, un único naranja #FF6A3D significa a la vez "vista activa", "sentimiento negativo" y "el volumen subió": el mejor dato de la pantalla (Desarrollo económico +12%) se pinta con el mismo color de alarma que el peor. Tercero, cada widget resuelve su propia ventana temporal y su propio total bajo un mismo chip "7D" — el treemap cuenta 7 días cerrados, el calendario 35 días, el detalle 30 días rolantes e incluye menciones secundarias que el pie de página promete excluir — de modo que dos cifras del mismo tópico en la misma pantalla difieren ~42% sin explicación. A eso se suma un defecto de maquetación que aparece en los cuatro viewports capturados: los tiles de altura fija no contienen su contenido, así que la barra de sentimiento y el delta de cada tópico se dibujan fuera de su tile y quedan pegados al tópico de abajo, invitando a atribuir el dato al tópico equivocado. En móvil el reflow "funciona" (cero scroll horizontal) pero la pantalla p…

### P0 (9)

**· [TP-01] El "Treemap" no codifica magnitud por área: el rango manda y el tamaño miente** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2049-2087 (grid en :2051, span en :2055-2056)`
- No hay algoritmo de treemap: es un CSS grid de `repeat(4,1fr)` con `gridAutoRows:'76px'`, y el tamaño depende sólo del índice — `const span = i < 2 ? 2 : 1; const rowSpan = i < 2 ? 2 : 1;`. En topics-desktop-fold.png los dos primeros tiles miden 775×215px cada uno (idénticos entre sí, con 249 y 210 menciones: 18% de diferencia real dibujada como 0%), y los ocho restantes miden 282×110px idénticos entre sí, con 171, 158, 131, 105, 92, 7…
- *Importa porque:* El treemap es el widget que contesta la pregunta central de la pantalla. Un funcionario que lo mire concluirá que hay dos temas dominantes y ocho temas equivalentes, cuando en realidad Empleo y adiestramiento (171) tiene el triple de conversación que Agricultura (53) y está a 19% de Permisos y trámites. Es la clase de…
- *Arreglo:* Dos caminos, en este orden de preferencia. (a) Convertirlo en un treemap real: squarified treemap sobre `count` (≈40 líneas, sin dependencias) con un área mínima por celda para que los tópicos pequeños sigan siendo clickeables; el área pasa a ser el único canal de magnitud y se elimina el `span` por índice. (b) Si se quiere conservar la rejilla, renombrar el modo a "Cuadrícula" y añadir dentro de cada tile una barra de volumen normaliz…

**· [TP-02] La barra de sentimiento y el delta se dibujan fuera de su tile y quedan pegados al tópico de abajo** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:2051 (gridAutoRows:'76px') + :2082 y :2101 (SentimentBar)`
- El contenido del tile pequeño mide ~93px: padding 14+14, título 11px (13), número 18px (22 + marginTop 4), "+N también lo tocan" (12 + marginTop 2), barra 6px + marginTop 6. La fila mide 76px fijos y el botón no tiene `overflow:hidden`. En topics-desktop-fold.png (1440) la barra + "↑ 4%" de EMPLEO Y ADIESTRAMIENTO se pinta fuera del fondo verde del tile, sobre el fondo de la card y flush con el borde superior del tile PYMES Y COMERCIO…
- *Importa porque:* Por proximidad de Gestalt, el lector atribuye la barra y el delta al tile que tienen debajo. "↑ 4%" es el crecimiento de Empleo, pero se lee como el de PyMEs; el delta de la última fila cuelga en el vacío. Es un error de atribución de dato, no de estética: dos usuarios mirando la misma pantalla se llevan cifras distin…
- *Arreglo:* Eliminar `gridAutoRows:'76px'` y dejar que la fila crezca: `gridAutoRows:'minmax(84px, auto)'` para los tiles chicos y `gridAutoRows:'auto'` con `aspect-ratio` sólo en los grandes; añadir `overflow:hidden` al botón como red de seguridad. Reservar la barra en el flujo (no confiar en `justifyContent:'space-between'` con altura fija) y bajar el título a `--fs-label` con `line-clamp:2`. Verificar a 390, 768, 1024 y 1440: el título más larg…

**· [TP-03] Un mismo naranja #FF6A3D significa "vista activa", "sentimiento negativo" y "volumen al alza" a 300px de distancia** · `color-semantics`

- `apps/web/public/eco-prototype/index.html:373 (.chip.active) + screens.js:2053 (título) + screens.js:209…`
- Muestreo de píxeles sobre topics-desktop-fold.png: el chip activo "Treemap" tiene fondo #FF6A3D, el título "PERMISOS Y TRÁMITES" es #FF6A3D, y el delta "↑ 12%" de Desarrollo económico es #FF6A3D. El probe confirma el chip activo con texto blanco sobre rgb(255,106,61) a 2,85:1 (necesita 4,5). Positivo es #3FD47A y mixto #FFC043, así que el tile de Desarrollo económico lleva título verde y delta naranja simultáneamente, y el de Energía e…
- *Importa porque:* El naranja es el color de alarma del producto (alertas, crisis). Cuando el mejor dato de la pantalla — el tema más hablado, positivo, creciendo 12% — se pinta del mismo naranja que el tema más problemático y que el botón de la vista activa, el lector no puede distinguir señal de identidad de marca. Este par --accent =…
- *Arreglo:* tokens.css:196/201 ya separa --accent #FF6A3D de --neg #FF5470 (5,85:1, Δhue 24°): asegurar que el build servido tome esos valores. Falta el tercer uso: sacar el delta del canal de color semántico de sentimiento y darle su propio par (--delta-up / --delta-down, o gris + flecha), porque hoy `screens.js:2099` lo fija a `var(--neg)` y seguiría colisionando con el negativo aunque el negativo cambie de hue. Y cambiar el texto del chip activ…

**· [TP-04] El delta ↑ se pinta como negativo y ↓ como positivo, sin leyenda y contra la convención del resto del producto** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2097-2099, :2162, :2215, :2302`
- Las cuatro apariciones del delta en esta pantalla usan `t.delta > 0 ? 'var(--neg)' : t.delta < 0 ? 'var(--pos)'`. En el mismo archivo, el helper compartido de delta (screens.js:69) usa la convención inversa por defecto (`delta > 0 ? 'var(--pos)'`) y sólo invierte cuando se le pasa `invertDelta`; screens.js:5580 también usa ↑ = positivo. En topics-desktop-fold.png el resultado es "↑ 12%" en naranja para Desarrollo económico (tópico posi…
- *Importa porque:* El lector ve verde y naranja, no lee código. "Permisos y trámites ↓ 8% en verde" se interpreta como "los permisos mejoraron", cuando lo que bajó es el volumen de conversación (que puede ser malo: menos visibilidad de una gestión). Y "Desarrollo económico ↑ 12% en naranja" convierte una buena noticia en alarma. Con dos…
- *Arreglo:* Elegir UNA convención y documentarla en tokens.css: recomiendo delta de VOLUMEN neutro en color (gris `--text-2`) con flecha direccional, reservando pos/neg para lo que sí tiene polaridad (sentimiento, NSS, crisis). Si se quiere mantener "más volumen = más riesgo", entonces reutilizar el helper de screens.js:69 con `invertDelta` explícito para que la decisión viva en un solo sitio, y añadir al pie del treemap una línea de leyenda: "↑/↓…

**· [TP-05] El histograma "Volumen por hora" del modal de día está fabricado con Math.sin y no suma el volumen del día** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2003-2008 y :2017 (render en shell.js:1328-1344)`
- `const base = Math.sin((h - 10) / 24 * Math.PI) * 0.5 + 0.5; const jitter = ((h * 37) % 11) / 11 * 0.4; return Math.round((base + jitter) * (dayModal.volume / 24) * 1.6);` — 24 barras deterministas con etiquetas 00:00…23:00, presentadas bajo el rótulo "Volumen por hora". El seno tiene su máximo cuando (h−10)/24·π = π/2, es decir h = 22: TODOS los días, de TODOS los tópicos, de TODAS las agencias, muestran el mismo pico a las 22:00. La…
- *Importa porque:* Es un dato inventado presentado como medición dentro de un panel de gobierno. El primer usuario que abra dos días distintos verá la misma curva y sabrá que es sintética; a partir de ahí, ningún gráfico de la herramienta es creíble. Además contradice la política que data.js:1-12 declara explícitamente para este repo ("…
- *Arreglo:* Quitar el histograma del modal hasta que exista el dato: `histogram: null` y en su lugar mostrar la distribución pos/neu/neg real del día (ya viene en TOPIC_CALENDAR vía `sentiment`, y el endpoint calcula pos/neg en route.ts:766-767 — exponerlos). Si se quiere la curva horaria, añadir al SQL de TOPIC_CALENDAR un `COUNT(*) FILTER` por `date_part('hour', published_at AT TIME ZONE 'America/Puerto_Rico')`. Aplicar lo mismo a screens.js:282…

**· [TP-06] El calendario coloca los días por índice de array, no por fecha: la cabecera LUN…DOM sólo es verdad si no falta ningún día** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2470-2486 y :2515-2519`
- `const firstDow = (first.getDay() + 6) % 7; const cells = Array(firstDow).fill(null).concat(parsed);` y luego `for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i+7))`. La posición de un día se deriva del día de la semana del PRIMER elemento más su índice; la fecha real de cada celda nunca se consulta para colocarla. El SQL de origen (apps/web/src/app/api/eco-data/route.ts:735-760, `WHERE rk = 1`) sólo emite filas par…
- *Importa porque:* Un calendario cuya cabecera de días no es fiable induce conclusiones falsas sobre patrones semanales — "los viernes se habla más de permisos" es precisamente el tipo de lectura que este widget invita a hacer, y es la lectura que se rompe primero. Peor: falla silenciosamente, sin ningún indicio visual de que faltan día…
- *Arreglo:* Construir la rejilla desde el calendario, no desde el array: generar todas las fechas entre `start` y `end`, indexar los datos por `fullDate` en un Map, y renderizar cada celda desde la fecha (`cellsByDate.get(ymd) ?? null`), pintando los días sin dato con un estado explícito (hatch + tooltip "sin menciones clasificadas"). Usar el campo `date` que el endpoint ya envía (route.ts:772, calculado en AST) en vez de recomputar con `new Date(…

**· [TP-07] El calendario muestra 35 días mientras el chip global dice 7D, y se rotula "período seleccionado"** · `data-integrity`

- `apps/web/src/app/api/eco-data/route.ts:730 + screens.js:2505 y :2494-2497`
- `const calendarDays = Math.max(35, Math.min(days, 365));` — con 7D seleccionado el endpoint devuelve 35 días. El subtítulo de la card dice "Tópico principal y volumen del día · período seleccionado" y la esquina derecha muestra "Jun 2026 – Jul 2026", todo bajo el chip "7D" activo y el badge "DATOS AL CIERRE DE AYER" (topics-desktop-fold.png). Justo encima, el treemap sí respeta los 7 días (Desarrollo económico = 249). Las celdas del ca…
- *Importa porque:* Dos widgets adyacentes con ventanas distintas, ambos etiquetados con el mismo período, es la receta para que un director sume mal en una reunión. Y el rótulo "período seleccionado" es una afirmación falsa sobre el dato, no una imprecisión de copy.
- *Arreglo:* Decidir el contrato y hacerlo visible. Opción A (preferida): que el calendario respete el período y muestre un empty state útil cuando el período es corto ("el calendario necesita al menos 14 días; estás viendo 7D — cambia a 30D"). Opción B: mantener el mínimo de 35 días y rotularlo literalmente en el subtítulo ("últimos 35 días naturales, independiente del período seleccionado") más un badge "35 D" junto al título de la card. En ambos…

**· [TP-08] En móvil y tablet las celdas del calendario se solapan: el texto de un día lo tapa el día siguiente y el color se mezcla** · `density`

- `apps/web/public/eco-prototype/screens.js:2544 (repeat(7,1fr)) y :2556 (aspectRatio 1/1, minHeight 62)`
- En móvil el ancho útil del grid es ~334px: 7 pistas de ~44px con gap 4. El contenido de la celda impone un min-content mayor (la palabra "PERMISOS" a 9px/700/0.02em más padding 6+6 ≈ 62-72px), así que cada botón excede su pista y se pinta sobre el vecino. En el recorte de topics-mobile.png se lee "DESARRO|LLO EC…" cortado por el borde redondeado de la celda roja siguiente, "PERMISOS" cortado por la verde, y una celda verde translúcida…
- *Importa porque:* En móvil el calendario no comunica nada: no se puede leer el tópico, no se puede leer el número, y el color — el único canal que quedaba — está contaminado por el vecino. Es la vista que un director abre en el celular a las 6 AM cuando le llega el correo diario. Y visualmente parece un fallo de software, no una limita…
- *Arreglo:* No mantener 7 columnas por debajo de ~700px. Sustituir la rejilla mensual por una tira vertical de días (una fila por día: fecha + chip de tópico + volumen + punto de sentimiento), que además resuelve la truncación a 13 caracteres. Si se quiere conservar la rejilla, reducir la celda móvil a día + punto de color (sin nombre de tópico ni volumen), con `min-width:0` y `overflow:hidden` en el botón y el detalle en el modal de día. Añadir `…

**· [TP-09] El detalle del tópico muestra dos totales distintos del mismo tópico y el pie de página promete un toggle que no existe** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2309 vs :2273 y :2637-2651; nota en :2037-2041`
- La nota de la pantalla afirma: "Al hacer clic en un tópico verás las primarias por defecto, con un toggle para incluir las secundarias". El hero usa `topic.count` (primarias, top-confidence). La tabla usa `fetchSliceMentions({topic})`, que no envía `topicMode`, y el endpoint por defecto cuenta TODA mención que toque el tópico (apps/web/src/app/api/eco-mentions/route.ts:302: `topicMode === 'primary' ? 'primary' : 'all'`). Para Desarroll…
- *Importa porque:* La pantalla se autodesmiente por escrito: documenta un criterio de conteo y entrega otro. Es el mismo patrón que ya produjo cinco totales distintos en el Scorecard, y es el hallazgo más caro en términos de credibilidad porque el cliente puede verificarlo sin ayuda: lee la nota, hace clic, y las cifras no cuadran.
- *Arreglo:* Pasar `topicMode:'primary'` en `fetchSliceMentions` cuando el llamador es TopicDetail, e implementar de verdad el toggle que la nota promete ("Sólo primarias / Incluir secundarias"), mostrando en el subtítulo ambas cifras: "249 primarias · 354 con secundarias". Reenviar `from`/`to` desde `ecoWindowParams` (shell.js:56-58 ya lo construye) y añadir 'custom' a PERIOD_DAYS o rechazar la petición en vez de degradar a 30 días. Alinear la ven…

### P1 (12)

**· [TP-10] La celda del calendario codifica dos variables en un solo relleno, y el volumen es el texto con menos contraste de la pantalla** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2547-2548, :2559 y :2573`
- `intensity = 0.3 + (c.volume / maxV) * 0.7` se aplica como alfa sobre un hue que codifica sentimiento (SENT_HEX en :2454). Dos variables sobre el mismo canal: un día neutral de alto volumen (#7C8698 al 100%, luminancia 0,24) se ve MÁS claro y llamativo que un día positivo de volumen medio (#2E8B6A al 50%, luminancia 0,08), así que la lectura "¿qué días fueron intensos?" es imposible. El número de volumen usa `var(--text-2)` cuando inte…
- *Importa porque:* El volumen es la única cifra dura de la celda y es lo que menos se ve. Y el doble encoding hace que la pregunta que el widget existe para responder — dónde están los picos — no se pueda contestar de un vistazo, lo que empuja al usuario a abrir 35 modales.
- *Arreglo:* Separar los canales: hue/relleno = volumen (una escala secuencial monocroma de 5 pasos, la que ya usa el heatmap horario), y sentimiento = un punto o una barra inferior de 3px con --pos/--neu/--neg. Alternativamente, mantener el sentimiento en el relleno y mover el volumen a un sparkbar dentro de la celda. En cualquier caso subir el número de volumen a `--text` (5,9-10,5:1 en todo el rango de intensidad) y sustituir el piso 0,3 por una…

**· [TP-11] Regresión en curso: --on-accent en las celdas de alto volumen empeora el contraste que venía a arreglar, y deja tres colores de texto en una celda de 62px** · `contrast`

- `apps/web/public/eco-prototype/screens.js:2568, :2570 y :2573 (cambio introducido en el commit a69ea2e)`
- El commit de tokens cambió `intensity > 0.65 ? '#fff' : 'var(--text)'` por `intensity > 0.65 ? 'var(--on-accent)' : 'var(--text)'`. En mando dark `--on-accent` es #1A0A04 (tokens.css:211). Contraste real compuesto sobre el canvas #0E1620: en intensity 0,66 (justo al cruzar el umbral) #1A0A04 da 2,73:1 sobre verde, 2,28:1 sobre rojo y 3,04:1 sobre neutral; el valor que sustituyó, `--text` #E6ECF3, daba 5,94 / 7,10 / 5,34 en el mismo pun…
- *Importa porque:* La regla "texto oscuro sobre relleno saturado" es correcta para rellenos OPACOS; aquí el relleno es translúcido sobre un canvas casi negro, así que el fondo efectivo nunca es claro y la inversión empeora la legibilidad justo en los días más importantes (los de mayor volumen). Es una corrección de accesibilidad que pro…
- *Arreglo:* Revertir a `var(--text)` en :2568 y :2570 y llevar :2573 también a `var(--text)` (o `--text-2` sólo si el relleno se vuelve opaco). Regla general para el sistema: los tokens `--on-*` se aplican únicamente cuando el relleno es el token puro al 100%; si el relleno lleva alfa, el primer plano se decide contra el color compuesto. Vale documentarlo en tokens.css §5, porque el mismo patrón (relleno con alfa + `--on-*`) aparece en el heatmap…

**· [TP-12] "mixed" en inglés y ámbar de advertencia para lo neutral/mixto, sin leyenda en el treemap** · `copy`

- `apps/web/public/eco-prototype/screens.js:2053-2054, :2205, :2300, :2365`
- El endpoint emite `dominantSentiment: 'positivo' | 'negativo' | 'mixed'` (apps/web/src/app/api/eco-data/route.ts:632). En el treemap 'mixed' se pinta con `var(--warn)` #FFC043: en topics-desktop-fold.png "INCENTIVOS CONTRIBUTIVOS" y "AGRICULTURA" son los dos únicos títulos ámbar y el treemap no tiene leyenda alguna que lo explique (la leyenda con las cuatro categorías sólo existe en la vista Burbujas, :2170-2175). En la Lista y en el d…
- *Importa porque:* Ámbar es el color de precaución en el resto del producto (alertas, umbrales). Un tópico cuyo sentimiento está balanceado no es una advertencia; marcarlo así infla la sensación de riesgo de la pantalla. Y una palabra en inglés en un panel para el Gobierno de Puerto Rico es un defecto visible de acabado.
- *Arreglo:* Un mapa único `SENTIMENT_LABELS = { positivo:'Positivo', negativo:'Negativo', mixed:'Mixto', neutral:'Neutral' }` y `SENTIMENT_TOKENS = { positivo:'--pos', negativo:'--neg', mixed:'--neu', neutral:'--neu' }` en un solo sitio, usando `--neu`/`--neu-bg` (ya existen en tokens.css:207-208) para mixto/neutral en vez de `--warn`; reservar ámbar para umbrales y alertas. Añadir la leyenda de 4 categorías también al treemap y a la lista, y un f…

**· [TP-13] La leyenda "Tópicos del período" lista 6 de los 10 tópicos y sus puntos de color son todos grises (la paleta por tópico es código muerto)** · `iconography`

- `apps/web/public/eco-prototype/screens.js:2492 y :2597-2604 (paleta muerta en :2448-2451)`
- `uniqueTopics` se calcula como los tópicos que fueron top-1 de algún día, no los del período: en topics-desktop.png la leyenda lista 6 entradas (Desarrollo, Permisos, Empleo, Energía, Turismo, Incentivos) mientras el treemap justo arriba muestra 10. El punto de cada entrada es `background: 'var(--text-3)'` — gris para todas (:2601). `const palette = [...]; const colorFor = (slug) => ...` se define en :2448-2451 con el comentario "Color…
- *Importa porque:* Una columna que tiene forma de leyenda (título + puntos + etiquetas) y no aporta color no es una leyenda: es una lista que ocupa el 16% del ancho del widget y hace creer al lector que el período sólo tuvo 6 tópicos, contradiciendo el treemap de arriba. El comentario del código promete "hues consistentes" que el produc…
- *Arreglo:* Renombrar a "Tópicos que lideraron algún día (6 de 10)" y ordenar por número de días liderados, mostrando ese conteo a la derecha de cada fila — así la lista deja de parecer una leyenda y pasa a ser un dato. Borrar `palette`/`colorFor`/`slugIdx` de TopicCalendar (:2448-2451) y, si se quiere identidad por tópico, tokenizarla una vez (`--topic-1…--topic-8` en tokens.css) y usarla en los tres sitios (leyenda, modal, línea de evolución del…

**· [TP-14] En móvil el título de la card choca con el toggle Treemap/Burbujas/Lista** · `layout-rhythm`

- `apps/web/public/eco-prototype/index.html:305-313 (.card-hd) + screens.js:1972 (fila de chips sin flexWr…`
- `.card-hd` es `display:flex; align-items:center; justify-content:space-between; gap:12px`, con `min-width:0; flex:1` sólo en el primer hijo. El grupo de chips mide 82+83+62+12 = 239px y no puede encogerse (no tiene flex-shrink ni flex-wrap), así que al título le quedan ~95px. En el recorte de topics-mobile.png "TÓPICOS · VISTA PANORÁMICA" se parte en tres líneas y el chip naranja "Treemap" se dibuja pegado/encima de "PANORÁMICA", tapan…
- *Importa porque:* Es la primera card de la pantalla y en móvil su cabecera aparece rota: el nombre del widget y su control principal se pisan. El toggle es además el control más importante de la pantalla (elige la codificación de los datos) y aparece como si estuviera mal pegado.
- *Arreglo:* `flex-wrap: wrap` en `.card-hd` y `flex: 0 0 100%` para el grupo de acciones por debajo de 640px, convirtiendo el toggle en un segmented control de ancho completo (tres chips a `1fr`, altura 44px — resuelve también el target táctil). Y `min-width:0` + `flex-shrink:1` en el grupo de acciones para que nunca imponga su ancho. Nota para el cambio tipográfico en curso: `.card-hd-title` ya pasó a 15px `--ff-display` en HEAD, lo que aumenta e…

**· [TP-15] La columna "Distribución" de la vista Lista superpone volumen y mezcla de sentimiento en una sola marca** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2206-2213`
- El contenedor se escala a `width: ${(t.count/max)*100}%` y dentro las tres bandas usan `width: ${t.positivePct}%` de ESE contenedor ya escalado. Para Agricultura (53 de 249 = 21% del ancho) la mezcla 35/33/32 se comprime en el 21% de la columna: tres bandas de ~7px cada una en una pista de 110px. La cabecera de la columna dice sólo "Distribución" (:2187) y no hay eje ni valor numérico. La misma pantalla tiene una tercera implementación…
- *Importa porque:* El lector no puede saber si una barra corta significa "poco volumen" o "poco positivo", que es exactamente la ambigüedad que una tabla debería eliminar. Y precisamente en los tópicos pequeños — donde una mezcla muy negativa es la señal más útil, porque es un tema emergente — es donde la marca se vuelve ilegible.
- *Arreglo:* Dos columnas separadas: "Volumen" (barra normalizada a max, un solo color) y "Mezcla" (barra de 100% de ancho fijo con las tres bandas, más los valores `52/33/15` en `.num` a su lado). Extraer una primitiva única `<SentimentSplit pct={{pos,neu,neg}} showValues />` y usarla en los cuatro sitios (treemap, lista, subtópicos, detalle) para que la misma pregunta se responda siempre con la misma forma.

**· [TP-16] La vista Burbujas ubica los tópicos en posiciones pseudoaleatorias y su tipografía queda a ~4px en móvil** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2115-2178 (rng :2121-2125, radio :2127, svg :2149)`
- No hay captura de esta vista (el probe sólo fotografió el modo por defecto, `view='treemap'`, screens.js:1906), así que esto sale del código. `const s = Math.sin(i * 9973) * 10000; return s - Math.floor(s);` genera x/y: la posición no codifica nada, pero un lector siempre lee proximidad como relación. La separación de colisiones es una única pasada (:2131-2139), así que las burbujas grandes pueden seguir solapándose. El radio es `30 +…
- *Importa porque:* Es una de las tres codificaciones que el usuario puede elegir para los mismos datos, y es la menos honesta de las tres: sugiere agrupamientos que no existen y dimensiona por radio en vez de por área. En móvil es directamente inservible. Ofrecer tres vistas de las que ninguna codifica bien la magnitud multiplica la des…
- *Arreglo:* Si se conserva, dimensionar por área (`r = Math.sqrt(count/max) * rMax`, sin piso aditivo — usar un `rMin` sólo para clickeabilidad y marcarlo en la leyenda), sustituir el jitter por un packing determinista ordenado por volumen (círculo central = mayor), y hacer el viewBox función del ancho medido con `useChartWidth` con `preserveAspectRatio` y tamaños de texto en px de pantalla, ocultando la etiqueta cuando r < 28. En móvil, degradar…

**· [TP-17] Cada celda del calendario gasta 127×127px para tres números, y en "1A" el calendario mide ~7.000px** · `density`

- `apps/web/public/eco-prototype/screens.js:2556 (aspectRatio '1/1') + apps/web/src/app/api/eco-data/route…`
- A 1440px las pistas del calendario miden ~127px y `aspectRatio:'1/1'` las hace cuadradas: 16.129px² para un número de día (10px), un nombre truncado a 13 caracteres (9px) y un volumen (10px). La página completa mide 4.109px de alto (probe, topics-desktop) y el calendario ocupa desde y≈810 hasta el final: ~79% del scroll. El endpoint admite hasta 365 días, lo que a 131px por fila (127 + gap 4) son 53 filas ≈ 7.000px de calendario más 12…
- *Importa porque:* La jerarquía por superficie está invertida: el treemap, que responde la pregunta principal, recibe el 20% del scroll; el calendario, que responde una pregunta secundaria ("qué tema lideró cada día"), recibe el 80%. Nadie hace scroll 4.000px en una herramienta de monitoreo diario, así que el detalle del calendario no s…
- *Arreglo:* Quitar `aspectRatio:'1/1'` y fijar la celda con `height: clamp(56px, 7vw, 72px)`, que reduce el calendario de 35 días a ~450px y el de 365 días a ~2.900px. Por encima de 90 días, cambiar de rejilla mensual a una tira anual tipo contribution-graph (columna = semana, celda 12px, sin texto, detalle en hover/modal). Y considerar colapsar la card del calendario por defecto (`<details>` abierto sólo si el período ≤ 35 días) para que el treem…

**· [TP-18] El treemap, las burbujas y la lista no tienen estado vacío, y el calendario afirma "Sin actividad" cuando lo que falló fue el API** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:2049-2051, :2115, :2181 y :2458-2467`
- `TopicTreemap`, `TopicBubbles` y `TopicList` hacen `topics.map(...)` sin ninguna guarda: con `D.TOPICS = []` (el fallback de data.js:85 cuando /api/eco-data falla, ver index.html:1387-1394 que pinta un banner rojo arriba y sigue) la card se renderiza con su cabecera, sus tres chips, el subtítulo "Haz clic en un tópico para ver sus subtópicos"… y nada debajo. El calendario sí tiene estado vacío, pero su texto es una afirmación sobre el…
- *Importa porque:* "Sin actividad de tópicos en este periodo" es una afirmación falsa cuando la causa es un 500, un 429 o una sesión caída — y es exactamente el tipo de afirmación con la que alguien puede tomar una decisión ("esta semana no se habló del tema"). Una card vacía con instrucciones de clic pero sin nada clickeable es, además…
- *Arreglo:* Distinguir tres estados en los cuatro widgets: cargando (skeleton), vacío-verificado ("0 menciones clasificadas en 30 jun – 6 jul" + enlace a Configuración de tópicos) y error ("No pudimos cargar los tópicos" + botón Reintentar), propagando un flag desde el bootstrap (index.html ya calcula `apiFailed`) en vez de dejarlo sólo en el banner global. El texto de vacío nunca debe afirmar un hecho sobre el mundo cuando el origen del dato fall…

**· [TP-19] Dentro del tile, el dato menos accionable ocupa 30px y el más accionable 10px** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:2071-2074 y :2107`
- Jerarquía tipográfica del tile: número absoluto 30px/18px (`--ff-display`), título 11px uppercase, "+N también lo tocan" 10px `--text-3` (2,65:1 medido por el probe en las 10 instancias), delta 10px/700. El fixture da a Energía e infraestructura `delta: +31` con `dominantSentiment: negativo` — el tópico negativo que más acelera del período, es decir el hallazgo más urgente de la pantalla — y eso se comunica con "↑ 31%" en 10px en la es…
- *Importa porque:* El volumen absoluto de un tópico casi nunca es la decisión; el cambio sí lo es. Con esta jerarquía el ojo cae en cifras que no requieren acción y hay que buscar activamente la que sí. Es la misma inversión que ya se documentó en el hero del Scorecard, aquí a escala de tile.
- *Arreglo:* Invertir los pesos: título del tópico como el elemento dominante del tile (13-14px, `--text`), delta a 13px/700 junto al título con su flecha, y el volumen absoluto a 11px `--text-2` bajo el título (el área ya comunica la magnitud si se implementa TP-01). Mover "+N también lo tocan" a un chip con tooltip en vez de una línea de 10px que necesita una nota al pie para entenderse.

**· [TP-20] La nota que define qué cuenta cada número es el texto más pequeño y menos contrastado, a 4.100px del primer dato** · `copy`

- `apps/web/public/eco-prototype/screens.js:2034-2043`
- La nota (11px, `var(--text-3)`, medido 2,65:1 sobre canvas, sin card, sin borde, `padding:'12px 16px'`) explica el criterio de conteo del que dependen las diez cifras grandes de la pantalla y el significado de "+N también lo tocan". Está al final de un documento de 4.109px, después de 35 filas de calendario. En móvil (topics-mobile.png) queda a ~3.900px del treemap. Y su última frase promete un toggle que no existe (ver TP-09).
- *Importa porque:* Es la única definición operativa de la métrica principal. Si el lector no la ve, no sabe que las menciones multi-tópico se cuentan una sola vez, y comparará estos números con los del correo o con los de Menciones (1.3K en el badge de nav) sacando conclusiones falsas. Su tratamiento visual comunica "esto no importa" pr…
- *Arreglo:* Subir el criterio al subtítulo de la card del treemap ("Cada mención cuenta una vez, en su tópico de mayor confianza") y convertir la nota larga en un popover accesible desde un icono de info junto al título de la card, a 13px/`--text-2`. Y hacer "+N también lo tocan" autoexplicativo con un tooltip por tile ("105 menciones más mencionan este tema de forma secundaria; no se suman al 249").

**· [TP-21] Lo clickeable sólo se anuncia con hover: en táctil, cero affordance, y la instrucción sustituye al diseño** · `affordance`

- `apps/web/public/eco-prototype/screens.js:2063 y :2067-2068 (tiles), :2552-2553 (celdas), :2600-2603 (le…`
- Los tiles del treemap declaran `border: '1.5px solid transparent'` y sólo revelan el borde en `onMouseEnter`; no hay chevron, ni subrayado, ni cambio de fondo persistente. Las celdas del calendario abren un modal pero su única pista es el `title` nativo (:2553), que en táctil no existe — y ese `title` es además el único sitio donde vive el nombre completo del tópico, truncado a 13 caracteres en la celda (:2571). Las filas de la leyenda…
- *Importa porque:* En el iPad y el celular, que es donde se consume el panel en reunión, nada de la pantalla parece interactivo: se pierde por completo el drill-in a subtópicos, que es la funcionalidad principal de Tópicos. Cuando hace falta una frase para explicar que algo es clickeable, la affordance está mal resuelta.
- *Arreglo:* Estado de reposo visible en todo lo clickeable: `border: 1px solid var(--hairline)` + `Icons.ChevronRight` a 12px en la esquina de cada tile (como ya hace la Lista), y `:active`/`:focus-visible` con `outline: 2px solid var(--accent)` (la regla global existe en index.html:190). En las celdas del calendario, sustituir el `title` nativo por un tooltip propio disparado también por tap/focus, con el nombre completo del tópico. Retirar la in…

### P2 (4)

**· [TP-22] Sin escala local: 92% de las declaraciones de tamaño están en 9-13px, con 9 gaps, 11 paddings, 4 radios y 14 hex fuera del sistema en 730 líneas** · `type-scale`

- `apps/web/public/eco-prototype/screens.js:1897-2625`
- Censo del bloque de la pantalla: 37 declaraciones de `fontSize` con 8 valores (9×3, 10×10, 11×8, 12×4, 13×9, 14×1, 28×1, 30×1) — 34 de 37 son ≤13px, y los dos ≥28 existen sólo en el drill-in. `gap`: 2,4,5,6,8,10,12,16,20. `padding`: 6,12,14,20,40 más cinco formas string ('4px 6px', '8px 12px', '10px 12px', '12px 16px', '14px 18px'). `borderRadius`: 2,3,6,8. 14 colores hex hardcodeados, incluidos una paleta de 8 tópicos duplicada litera…
- *Importa porque:* Es el diagnóstico F10 a escala de una pantalla: sin escala, cada widget elige su propio ritmo y el conjunto se lee como cinco componentes de cinco productos distintos. El corolario práctico es que la pantalla entera corre por debajo del mínimo cómodo de lectura (9-11px con contraste 2,65:1) para un público que en su m…
- *Arreglo:* Migrar este bloque a los tokens que tokens.css ya define: `--fs-*` para tipografía (con un piso de 12px para texto de dato y 13px para prosa), `--space-*` para gap/padding, `--r-*` para radios. Sustituir los 14 hex por tokens (`--neu` para el gris neutral de datos, `--topic-*` si se decide conservar identidad por tópico) y borrar la paleta duplicada. Un lint sencillo (`grep -nE "(fontSize|gap|padding|borderRadius):\s*[0-9]|#[0-9A-Fa-f]…

**· [TP-23] 73 instancias bajo el mínimo WCAG por captura, concentradas en tres patrones repetidos** · `contrast`

- `/private/tmp/claude-502/-Users-alegut-MyApps-eco-populicom/bbe34d3f-a11d-4ddf-85a1-176cbbe9558a/scratchpad/shots/probe-report.json (key="topics", 73 entradas idénticas e…`
- Agrupadas, las 73 son tres patrones: (a) `--text-3` #525B68 sobre canvas a 2,65:1 en 9-11px — los 7 nombres de día (LUN…DOM, 9px/700), los 10 "+N también lo tocan", los dos `.card-hd-sub`, el eyebrow "TEMAS DETECTADOS", el badge "DATOS AL CIERRE DE AYER" y la nota metodológica; (b) el texto de las celdas del calendario, con el volumen en `--text-2` sobre relleno de sentimiento entre 1,36:1 y 4,07:1 y el nombre del tópico a 3,52:1 sobre…
- *Importa porque:* Es una herramienta de trabajo diario para funcionarios públicos, con obligación práctica de accesibilidad, y lo que falla no es decorativo: son las etiquetas de eje del calendario, los volúmenes por día, el criterio de conteo y el indicador de vista activa. Un usuario con vista cansada a las 6 AM no puede leer el volu…
- *Arreglo:* tokens.css:192 ya sube `--text-3` a #7C8798 (5,00:1) y `--text-2` a #A2ACBA (7,92:1): verificar que el build servido los tome, lo que liquida el grupo (a). Para (b), ver TP-11/TP-10: `--text` para todo el texto sobre celda y volumen a `--text` en lugar de `--text-2`. Para (c), `var(--on-accent)` #1A0A04 sobre el naranja (6,78:1). Regla de sistema: ningún texto por debajo de 12px puede usar el token de texto terciario, y ningún texto so…

**· [TP-24] Tres nombres para lo mismo en la misma pantalla: "Temas detectados", "Tópicos" y "Treemap"** · `consistency`

- `apps/web/public/eco-prototype/screens.js:1974 ("Treemap") + eyebrow "TEMAS DETECTADOS" y título "Tópico…`
- En 60px verticales la cabecera dice "TEMAS DETECTADOS" (eyebrow) y "Tópicos" (título H1), y el nav lateral dice "Tópicos". El toggle ofrece "Treemap" (jerga inglesa) junto a "Burbujas" y "Lista" (español). En el detalle, el breadcrumb dice "Tópicos / …" y el pill de sentimiento dice "mixed" (ver TP-12). El widget rotulado "Treemap" además no es un treemap (TP-01).
- *Importa porque:* Un panel de gobierno se lee también como documento institucional: mezclar "temas" y "tópicos" para el mismo objeto obliga al lector a preguntarse si son cosas distintas, y "Treemap" es vocabulario de analista, no de director. Cuesta poco y erosiona el acabado percibido.
- *Arreglo:* Elegir un término y usarlo en nav, eyebrow, título, breadcrumb y correos — recomiendo "Temas" (español correcto; "tópicos" es anglicismo) o, si el cliente ya adoptó "Tópicos", usarlo en los cinco sitios. Renombrar los modos a "Mapa" / "Burbujas" / "Lista" (o "Cuadrícula" si no se implementa el treemap real). Añadir el glosario de términos de UI al mismo sitio donde vive tokens.css para que los correos y la SPA no divergan.

**· [TP-25] En móvil la leyenda que decodifica el calendario queda ~2.000px por debajo del calendario, y los dos tópicos principales se vuelven banners con 50% de espacio muerto** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:2512 (ecoCols '1fr 200px' → '1fr') y :2055-2056 (span 2 sobre…`
- En escritorio la leyenda (Sentimiento del día / Tópicos del período / Opacidad = volumen) es una columna de 200px al lado de la rejilla, visible a la vez que los colores que explica. En móvil `ecoCols` devuelve una sola columna, así que la leyenda se apila DEBAJO de las 28 filas del calendario: en topics-mobile.png aparece a y≈6.900 de una página de 7.914px (~2.000px por debajo de la primera fila que explica). Y como el treemap móvil u…
- *Importa porque:* El reflow es correcto — hay una sola columna, no hay scroll horizontal — pero la función se pierde: una leyenda que no comparte pantalla con lo que decodifica no es una leyenda, y en móvil el usuario ve 28 filas de colores sin clave. Al mismo tiempo, el ranking se distorsiona más que en escritorio: #1 y #2 se ven 4× m…
- *Arreglo:* En móvil, mover la leyenda ARRIBA de la rejilla (o convertirla en una fila horizontal compacta bajo la cabecera de la card) y hacerla sticky mientras la rejilla está en viewport. Para el treemap, condicionar el `span` al breakpoint: en 2 columnas usar `span 1` con un tamaño de número mayor para el top-2 en vez de duplicar ancho y alto, o mejor, si se implementa el treemap real (TP-01) el área ya sale del dato y no del índice.


## Pantalla Narrativas

*30 hallazgos*

Narrativas es un enclave dentro del producto: es la única pantalla con 0 elementos `.card` (censo del probe), la única con 0 usos de `window.ecoCols` (las otras nueve suman 26), la única con un breakpoint propio (980px contra los 768/1024 del sistema) y la única que importa una paleta ajena — los seis colores de estado son copia literal de la paleta por defecto de Ant Design, con sus comentarios `cyan-6 / gold-6 / orange-6`. Sobre esa base, la pantalla comete el error más caro posible para un cliente de gobierno: afirma cosas que no puede sostener. El toolbar resalta "7D" mientras el fetch pide 730 días; la píldora dice PICO junto a "VEL. 24H 0.0"; el resumen declara "Volumen estable" a 40px de una gráfica que dice "Sin datos temporales todavía"; y las dos narrativas de mayor volumen del cliente (214 y 168 menciones, sobre "Apagones y confianza en LUMA" y "Demoras del permiso único") aparecen sin punto de color, con el estado en inglés crudo, sin ser contadas por ningún chip y hundidas en las posiciones 6 y 7 debajo de una narrativa dormida de 44 menciones — en móvil directamente no se ven. Todo eso sale de una sola grieta: el vocabulario de estados no tiene dueño (la API declara `status: string`, el cliente asume un enum cerrado de 6). El panel derecho, que es el 80% del ancho en escritorio, son siete cajas vacías con tres redacciones distintas de "Sin datos" y ~310px de zona muerta debajo. En móvil el reflow funciona, pero el contenido real empieza a 820px de scroll y la ausencia de datos ocupa 750px.

### P0 (7)

**· [N-01] El selector de periodo del header no aplica a esta pantalla: el toolbar dice 7D y el fetch pide 730 días** · `data-integrity`

- `screens.js:4803 y 4821; app.js:389; apps/web/src/app/api/narrative/route.ts:9-17 y 57-58; shell.js:377`
- `app.js:389` pasa `period={period}` a todas las pantallas, pero `function NarrativeScreen({ agency })` (screens.js:4803) sólo destructura `agency`; la prop se descarta en silencio. El fetch de screens.js:4821 es `/api/narrative?agency=…&limit=500` — sin `period`. La API sí lo soporta y su default es `Max` = 730 días (route.ts:57-58). Además su mapa `PERIOD_DAYS` (route.ts:9-17) es `{1D,5D,1M,3M,6M,1A,Max}` mientras el toolbar ofrece `[…
- *Importa porque:* El usuario de gobierno cree estar viendo la última semana y está viendo dos años de narrativas acumuladas. Cualquier lectura de "qué está pasando ahora" es falsa, y el sello "DATOS AL CIERRE DE AYER" del header refuerza una precisión temporal que aquí no existe. Es el hallazgo que más rápido destruye la credibilidad d…
- *Arreglo:* Tres pasos, ninguno cosmético. (1) Aceptar `period` en `NarrativeScreen` y pasarlo al fetch usando el helper ya existente `window.ecoWindowParams()` (shell.js:~55) para no reimplementar la lógica de rango custom. (2) Unificar el vocabulario: añadir `7D:7` y `30D:30` a `PERIOD_DAYS` (y retirar `1M`, que ya no existe en el toolbar) para que exista un solo diccionario de periodos en el producto. (3) Si por definición del producto una narr…

**· [N-02] Un estado fuera del enum se rompe en cinco lugares a la vez y vuelve inalcanzables 3 de las 8 narrativas** · `data-integrity`

- `screens.js:4600-4616 (enum), 4849-4853 (conteos), 4893-4907 (chips), 4919 y 4925 (fila), 5042-5043 (píldora); apps/web/src/app/api/narrative/route.ts:25`
- En narrative-desktop.png las filas "Apagones y confianza en LUMA" (214 menc · escalating), "Demoras del permiso único" (168 menc · sustained) y "Cierres en Calle Loíza" (38 menc · escalating) se pintan sin punto de color (screens.js:4919 asigna `background: undefined`), con el estado en inglés crudo (`NARRATIVE_STATUS_LABELS[n.status] || n.status`, línea 4925) y sin ser contadas por ningún chip: el rótulo dice "Todas (8)" y los chips s…
- *Importa porque:* Las tres narrativas ilegibles son 420 de las 815 menciones agrupadas — más de la mitad del volumen. No hay ningún filtro que las alcance (`statusFilter === 'all'` es la única vía), y si el usuario toca cualquier chip desaparecen. Un tablero que esconde la mayoría de su propio volumen y muestra términos en inglés a un…
- *Arreglo:* Sacar el vocabulario del cliente y hacerlo contrato: (1) definir el enum en un módulo compartido consumido por la API y por la SPA, y que `/api/narrative` valide y devuelva `status` normalizado + un `statusRaw` para depuración; (2) derivar los chips de los estados PRESENTES en la respuesta (`Object.keys(statusCounts)`), no de una constante literal, de modo que la suma de chips sea siempre igual a "Todas"; (3) añadir un fallback explíci…

**· [N-03] El cliente deshace el orden por importancia que la API ya calculó y entierra las dos narrativas más grandes** · `data-integrity`

- `screens.js:4856 y 4867-4872 (re-sort por RANK); screens.js:4830-4837 (selección por defecto); apps/web/src/app/api/narrative/route.ts:106`
- La API devuelve `ORDER BY n.mention_count DESC, n.born_at DESC` (route.ts:106), es decir 214, 168, 142, 96, 62, 51, 44, 38. El cliente re-ordena por una taxonomía de estado con `RANK[a.status] ?? 9` (screens.js:4868), así que todo estado desconocido cae al final: el orden que se ve en la captura es 142, 96, 62, 51, 44, 214, 168, 38. La narrativa de 214 menciones queda en la posición 6, debajo de una "Dormida" de 44. La misma tabla RANK…
- *Importa porque:* El orden de una lista maestra ES una afirmación editorial: "esto es lo más importante". Aquí la afirmación es falsa y sistemáticamente contraria al volumen. El usuario que abre la pantalla y lee de arriba abajo no llega nunca a la crisis de LUMA. En móvil el efecto es total: las dos mayores caen fuera del recorte de l…
- *Arreglo:* Un solo criterio de orden, visible y elegible. Ordenar por defecto por volumen dentro de la ventana activa (que es lo que la API ya hace) y exponer un selector explícito "Ordenar por: volumen · velocidad 24h · más reciente". Si se quiere conservar la prioridad por estado, aplicarla como un desempate secundario y jamás con `?? 9` (usar el rango medio para desconocidos, no el último). Y cambiar la selección por defecto a la primera fila…

**· [N-04] Cinco afirmaciones contradictorias sobre la misma narrativa en un solo viewport** · `data-integrity`

- `screens.js:5042 (píldora), 5047 (resumen), 5063 y 5067 (métricas), 5246 (streamgraph vacío); apps/web/src/app/api/narrative/route.ts:115-117`
- En narrative-desktop-fold.png, dentro de 400px verticales: la píldora dice "PICO", el resumen dice "Volumen estable", "VEL. 24H" dice 0.0, "ENGAGEMENT" dice 0 con 142 menciones, y la gráfica dice "Sin datos temporales todavía.". El origen del 0 es la coerción de nulos: `velocity24h: Number(r.velocity24h ?? 0)` y `totalEngagement: Number(r.totalEngagement ?? 0)` (route.ts:115-117), que el cliente re-envuelve con `Number(narrative.veloci…
- *Importa porque:* Un cluster "en pico" con velocidad 0.0 y engagement 0 es imposible; el lector concluye o que la métrica está rota o que la narrativa no importa, y en ambos casos deja de confiar en el resto de los números de la pantalla. Peor: "ENGAGEMENT 0" no dice "no lo hemos calculado", dice "a nadie le importó" — una afirmación s…
- *Arreglo:* Contrato de nulos explícito en los dos lados. La API debe devolver `null` (no 0) cuando la métrica no está calculada, y la UI debe pintar `null` como un guion largo em-dash con `title="aún no calculado"` y en `--text-3`, nunca como cifra. Añadir unidad y dirección a "Vel. 24h" (hoy es un número sin unidad: menciones/hora, ratio, delta?) — por ejemplo "+0,0 menc/h". Y hacer que la píldora de estado y el resumen se deriven de las mismas…

**· [N-05] «· nan%» visible al usuario, y la lista que dice estar ordenada por fuerza no lo está** · `data-integrity`

- `screens.js:5226 (render), 5222 (tooltip), 5015 (sort), 5005-5017 (memo `related`)`
- El probe captura el botón completo: `button.narrative-related-btn «Inversión farmacéutica en el norte · nan%»`, y en `lowContrast` el nodo `span.narrative-related-meta «· nan%»`. La expresión es `{edgeTypeLabel(r.edgeType)} · {(r.strength * 100).toFixed(0)}%` (5226): `edgeTypeLabel(undefined)` devuelve `''` (línea 4640) y `(undefined*100).toFixed(0)` devuelve la cadena `"NaN"`, que el `text-transform` deja como "nan". El mismo NaN se r…
- *Importa porque:* "nan%" es la clase de detalle que un cliente fotografía. Y el fallo silencioso es peor que el visible: el panel presenta un ranking de relaciones que no está ordenado, así que el usuario cree que la primera narrativa relacionada es la más conectada cuando puede ser cualquiera. Es exactamente el mismo patrón de F4 (fal…
- *Arreglo:* Un formateador único con guarda para todo porcentaje/ratio de la pantalla: si `!Number.isFinite(v)` devolver `—` y suprimir el separador `·` (hoy el `·` se pinta siempre, incluso sin etiqueta a su izquierda). Filtrar en el memo `related` las aristas sin `strength` finito antes de ordenar, y ordenar con un comparador que trate no-finitos como el mínimo. En paralelo verificar el contrato: `/api/narrative/edges` sí devuelve `strength: Num…

**· [N-06] La pantalla importa la paleta por defecto de Ant Design y la mete en el tema mando: dos hues casi idénticos para significados opuestos** · `color-semantics`

- `screens.js:4601-4608; comparar con apps/web/src/components/narratives/NarrativeStatusBadge.tsx:23-30; tokens.css:196-207`
- `NARRATIVE_STATUS_COLORS` es copia literal del componente Ant Design del monorepo, incluidos sus comentarios de paleta: `emerging #13c2c2 // cyan-6`, `active #52c41a // green-6`, `peaking #fa8c16 // orange-6`, `declining #faad14 // gold-6`, `dormant #8c8c8c // gray-7`, `revived #eb2f96 // magenta-6`. Ninguno de los seis existe en `tokens.css`. Consecuencias visibles en crop-filters: (a) el punto de "Pico" (#FA8C16) y el de "Decae" (#FA…
- *Importa porque:* El punto de color es el único codificador de estado en la lista maestra (el texto va a 10,5px y 2,65:1 de contraste). Si dos estados opuestos comparten hue, la lista deja de comunicar la única cosa que la hace útil: qué narrativa está subiendo y cuál se está apagando. Y una paleta de otro framework dentro del tema de…
- *Arreglo:* Tokenizar los seis estados en `tokens.css` con hues que se separen por CLARIDAD además de por matiz, y escogerlos según semántica de dirección, no de marca: subiendo = `--warn`/naranja, pico = `--neg`, decayendo = azul frío o `--info`, dormida = `--neu`, emergente = `--info-2`, revivida = magenta. Regla dura: `peaking` y `declining` deben diferir al menos 30° de matiz y 20% de luminancia. Y añadir forma además de color (triángulo arrib…

**· [N-07] La píldora de estado falla AA en los seis estados, y desaparece por completo en un séptimo** · `contrast`

- `index.html:839-847 (`color: white` hardcodeado); screens.js:5042 (background inline); tokens.css:170-173 y 211-216 (los tokens `--on-*` que existen y no se usan)`
- El probe mide `span.narrative-status-pill «PICO»`: blanco sobre `rgb(250,140,22)` = 2.38:1 contra 4.5 requerido, a 10px y mayúsculas con letter-spacing. La misma regla aplica a los otros cinco rellenos (blanco sobre #FAAD14 y #52C41A queda por debajo de 2,2:1). `tokens.css:170-173` documenta exactamente este problema ("blanco sobre estos rellenos falla AA sin excepción") y aporta `--on-accent/--on-pos/--on-warn/--on-info` para reemplaz…
- *Importa porque:* Es el elemento que nombra el estado de la narrativa, es decir el dato de decisión de la pantalla, y es ilegible para cualquiera con visión reducida o en una pantalla con brillo alto — condiciones normales en una sala de mando o proyectado en una reunión. Para una herramienta de gobierno también es un riesgo de cumplim…
- *Arreglo:* Sustituir `color: white` por `color: var(--on-status, var(--on-warn))` y mover el color de relleno del estilo inline a un `data-status` con reglas CSS por estado, de modo que exista una pareja relleno/primer-plano por estado y ningún caso pueda quedar sin fondo. Para el caso desconocido, fondo `--neu-bg` con borde `--hairline-strong` y texto `--text-2` (variante "outline") en vez de relleno. Subir el tamaño de la píldora a 11px y quita…

### P1 (20)

**· [N-08] El streamgraph no declara escala: 214 y 38 menciones producen bultos idénticos** · `chart-honesty`

- `screens.js:5237-5257 (`w/h` fijos, `yScale` normalizado a `maxTotal` local), 5304-5311 (leyenda sin máximo)`
- `yScale = yCenter - (v / maxTotal) * (innerH / 2) * 0.92` donde `maxTotal` es el máximo diario de ESA narrativa (5255). No se dibuja ningún eje Y, ningún tick, ninguna anotación de máximo; la leyenda sólo nombra Positivo/Neutral/Negativo. La caja mide siempre lo mismo (viewBox 1080×240, `max-height: 280px` en index.html:945).
- *Importa porque:* Es el mismo pecado que F2 en `MultiLineChart`, y aquí es peor porque no existe ni la opción `sharedScale`: al pasar de una narrativa a otra el gráfico no cambia de altura, así que el usuario compara formas y concluye que dos narrativas tienen el mismo peso cuando una tiene 5,6 veces más volumen. Un tablero cuya gráfic…
- *Arreglo:* Preservar el gusto por la forma suave pero anclar la magnitud: (1) etiquetar el máximo dentro del área ("máx. 38 menc/día" arriba a la derecha, en mono, `--text-3`); (2) añadir dos ticks Y (0 y máx) sobre la línea central que ya existe; (3) ofrecer un toggle "escala común" que normalice todas las narrativas al máximo global de la agencia, con la escala común como DEFAULT cuando se llega desde la lista maestra. Con eso la comparación en…

**· [N-09] Suavizado Catmull-Rom sobre conteos diarios en un área APILADA: el spline inventa volumen y las capas pueden cruzarse** · `chart-honesty`

- `screens.js:5277-5283 (`buildLayerPath` con `smoothPath`), 4644-4660 (`smoothPath`), 5259-5275 (apilado simétrico)`
- Cada capa se construye pasando los bordes superior e inferior por `smoothPath` de forma independiente (5280-5281). Catmull-Rom sobrepasa entre puntos de control; en una serie diaria con ceros intercalados el borde suavizado baja por debajo de 0 y sube por encima del dato, y como los dos bordes de una banda se suavizan por separado el borde superior puede quedar por debajo del inferior, produciendo un relleno auto-intersectado. En la li…
- *Importa porque:* En una gráfica apilada el overshoot no es un adorno: pinta menciones negativas o positivas en días donde el dato era cero. El lector ve un bulto de sentimiento negativo el martes y no hubo ninguno. Es exactamente el problema de F3 (suavizado no opcional), agravado porque aquí el área rellena la mentira en lugar de sól…
- *Arreglo:* Para series apiladas de conteos diarios, usar una interpolación monótona (Fritsch-Carlson / `curveMonotoneX`) que respeta los datos y sigue viéndose curva — el usuario conserva las líneas suavizadas que pidió sin overshoot. Como red de seguridad, clamp de cada `y` al rango de la banda antes de emitir el path (`Math.min/max` contra el borde vecino), y `curveStepAfter` cuando la serie tiene menos de 5 puntos, donde ninguna curva es hones…

**· [N-10] Eje X con granularidad de meses para narrativas de días, con ticks que caen fuera del área de trazado** · `chart-honesty`

- `screens.js:5291-5299 (generación de meses), 5374-5385 (render de ticks)`
- Los ticks se generan por MES arrancando en el día 1 del mes de `minT` (`cursor.setDate(1)`, 5293). Ese primer tick casi siempre es ANTERIOR al primer dato, así que `xScale(cursor)` devuelve un valor menor que `margin.left` y la marca se dibuja fuera del área útil (o recortada por el viewBox). Para una narrativa de dos semanas dentro de un mismo mes queda un único tick, potencialmente invisible. No hay ticks de día ni de semana en ningu…
- *Importa porque:* El eje temporal es cómo el usuario ubica un pico en el calendario para cruzarlo con un evento real (una conferencia de prensa, un apagón). Un eje sin fechas legibles convierte el streamgraph en una forma bonita sin anclaje, y refuerza el problema de N-01: la pantalla no comunica en ningún momento qué ventana temporal…
- *Arreglo:* Elegir granularidad según el span real: día si el rango es ≤14 días, semana si ≤90, mes si más; y generar el primer tick con `ceil` hacia el primer límite POSTERIOR a `minT`, nunca hacia atrás. Añadir siempre las fechas de inicio y fin del rango en los extremos del eje (ya existe el marcador "▸ inicio" en 5368-5371: extender ese patrón al extremo derecho) para que el gráfico declare su ventana sin depender de los ticks intermedios.

**· [N-11] Dentro del streamgraph, naranja significa a la vez «negativo», «pico» y «lo que seleccioné»; y verde significa «positivo» y «inicio»** · `color-semantics`

- `screens.js:5286 (capa negativa = `--neg`), 5341 y 5346 (día seleccionado = `--accent`), 5356-5359 (pico = `--accent`), 5368-5371 (marcador de inicio = `--pos`); screens.…`
- La capa de sentimiento negativo usa `var(--neg)`, que en el tema vigente de la captura es el mismo #FF6A3D que `--accent` (el hallazgo raíz F-accent==neg). Sobre esa capa naranja se dibujan, también en `--accent`: la línea vertical del pico, el texto "✕ pico", la línea punteada del día seleccionado y su punto. El marcador de nacimiento de la narrativa usa `--pos`, el mismo verde que la capa de sentimiento positivo que atraviesa. Y el r…
- *Importa porque:* El lector no puede decidir si un trazo naranja es un dato (sentimiento negativo) o cromo de interfaz (su propia selección). En una gráfica de sentimiento eso es fatal: el elemento más saliente de la imagen, la anotación del pico, se confunde con el volumen negativo. El azul de otro tema es el mismo defecto ya identifi…
- *Arreglo:* `tokens.css:201` ya separa `--neg: #FF5470` de `--accent`; adoptarlo cierra la mitad del problema. Para la otra mitad: las anotaciones de gráfica (pico, día seleccionado, inicio) no deben usar ningún color semántico de datos — asignarles un token propio `--chart-annotation` neutro-claro (`--text`) con trazo punteado, y distinguir el marcador de inicio por forma (banderín) en vez de por verde. Reemplazar los dos `rgba(63,181,216,…)` por…

**· [N-12] Sparkline fabricada: 30 ceros se pintan como una línea plana indistinguible de actividad real baja, y cada una se normaliza a su propio máximo** · `data-integrity`

- `apps/web/src/app/api/narrative/route.ts:151 (`|| new Array(30).fill(0)`); screens.js:4662-4673 (`max = Math.max(...data, 1)`), 4928-4930`
- La API garantiza siempre un array de 30 valores: si la narrativa no tiene filas, rellena con ceros (route.ts:151). En el cliente `max = Math.max(...data, 1)` (4666), así que 30 ceros producen un trazo plano en el borde inferior, con el color del estado y `strokeWidth 1.2` — visualmente idéntico a 30 días de actividad baja pero real. Además la normalización es por-serie: la sparkline de 214 menciones y la de 38 llegan a la misma altura.…
- *Importa porque:* Repite el error de fondo de F2 en la lista maestra, donde el usuario hace su primer triaje: ocho sparklines de la misma altura sugieren ocho narrativas de peso comparable. Y una línea plana fabricada es peor que ninguna: afirma que se midió algo que no se midió.
- *Arreglo:* Devolver `sparkline: null` cuando no hay datos y renderizar en su lugar un guion o nada — nunca ceros sintéticos. Normalizar todas las sparklines de la lista al máximo GLOBAL de la lista visible (una sola pasada en el memo `filteredNarratives`) para que la altura sea comparable entre filas, y añadir el máximo como `title` para que el número esté disponible sin ocupar píxeles. Alinear la ventana de la sparkline con el periodo activo una…

**· [N-13] Siete cajas vacías con tres redacciones distintas ocupan todo el panel principal; en móvil son ~750px de scroll de «Sin datos»** · `empty-state`

- `screens.js:5099, 5117, 5141, 5166 ("Sin datos"), 5246 ("Sin datos temporales todavía."), 5187 ("Aún sin datos (requiere ≥24h)"); index.html:813-819 (`.narrative-empty-sm…`
- En narrative-desktop.png el panel derecho (1.150px de ancho) contiene: la caja del streamgraph con "Sin datos temporales todavía.", tres cajas en fila con "Sin datos", dos cajas con "Sin datos" y "Aún sin datos (requiere ≥24h)", y una caja con una sola narrativa relacionada. El probe lista seis nodos `.narrative-empty-small`. Todas las cajas conservan su altura completa (el streamgraph reserva su caja; las cajas de la grilla mantienen…
- *Importa porque:* La suma de vacíos no comunica "esta narrativa es joven", comunica "el producto está roto". Es la lectura que se lleva un cliente en una demo. Y las tres redacciones distintas para la misma condición hacen que parezcan tres fallos distintos en vez de una sola causa (no hay serie temporal todavía).
- *Arreglo:* Un único componente de estado vacío con causa y acción, y una sola redacción por causa: "Esta narrativa nació hace X días; el desglose por plataforma requiere al menos 24h de datos". Cuando la causa es común a varios paneles (no hay `timeline`), colapsar los seis en UN bloque explicativo del ancho del panel con la fecha de nacimiento y las menciones ya recogidas, en vez de repetir seis cajas. Y no reservar altura: una caja vacía debe e…

**· [N-14] Tres dialectos de fetch-state dentro del mismo componente: uno muestra loading, otro afirma «Sin datos» mientras carga, y un tercero desaparece** · `empty-state`

- `screens.js:5082-5100 y 5105-5118 y 5123-5142 (data/loading/empty), 5149-5167 y 5172-5188 (data/empty, sin loading), 5192-5210 (el panel entero se omite)`
- Los tres paneles de la grilla de 3 tienen las tres ramas (`? : detailLoading ? :`). "Primera mención" y "Voz más influyente" sólo tienen dos ramas, así que durante la carga afirman "Sin datos". "Menciones recientes" está envuelto en `{recent.length > 0 && (…)}` (5192): si no hay datos el panel no existe — en la captura de escritorio simplemente no está, entre "Voz más influyente" y "Narrativas relacionadas". Igual "Narrativas relaciona…
- *Importa porque:* El usuario no puede distinguir "no hay datos" de "todavía cargando" de "esta sección no existe para esta narrativa". Al cambiar de narrativa los paneles aparecen y desaparecen, así que el layout no es estable y no se puede aprender dónde vive cada dato. Es el mismo síntoma de los "4 dialectos de fetch-state" que ya se…
- *Arreglo:* Una máquina de estados de datos por panel (`idle | loading | empty | error | ready`) resuelta por un hook o helper compartido, y una regla de layout: los paneles SIEMPRE se renderizan en el mismo orden y posición, con esqueleto en `loading` y estado vacío explicativo en `empty`. Nunca condicionar la existencia del panel al contenido; si una sección no aplica a este tipo de narrativa, decirlo dentro del panel.

**· [N-15] La lista maestra se corta a 5 de 8 en una región de scroll sin ninguna señal, y el rótulo insiste en «8 DE 8 NARRATIVAS»** · `affordance`

- `index.html:1287-1289 (`@media (max-width:980px)` → `.narrative-menu { max-height: 400px }`), 682 (`overflow: hidden`), 741-745 (`.narrative-list { overflow-y: auto }`);…`
- En narrative-tablet-fold.png el sexto ítem ("Apagones y confianza en LUMA") queda cortado por la mitad en el borde inferior del panel: se ve la parte superior de las letras y nada más. En narrative-mobile.png y narrative-mobile-fold.png la lista termina limpia después del quinto ítem y las tres restantes son invisibles, mientras el rótulo justo arriba dice "8 DE 8 NARRATIVAS". No hay fade, ni sombra de scroll, ni indicador de cantidad…
- *Importa porque:* El usuario cree que el cliente tiene 5 narrativas. Y por N-03 las tres que se ocultan son justo las de mayor volumen: la conversación sobre apagones y la de demoras de permisos, es decir los dos temas políticamente más caros. Un rótulo que dice 8 sobre una lista que muestra 5 es la definición de un tablero que engaña.
- *Arreglo:* Quitar el `max-height: 400px` arbitrario: en móvil/tablet la lista debe crecer con el contenido (con `max-height` en `dvh` si hace falta acotarla) o convertirse en un selector colapsable con contador ("Récord de visitantes 2026 — 1 de 8 ▾") que abre una hoja a pantalla completa. Si se conserva una región de scroll: gradiente de máscara en el borde, `scrollbar-color` visible con `--text-3`, `overflow: hidden` sólo en el eje X, y padding…

**· [N-16] La pantalla no usa la primitiva `.card` del producto: tiene un card paralelo, y en la pestaña vecina sí usa el del sistema** · `consistency`

- `index.html:962-970 (`.narrative-panel`) contra 293-303 (`.card`); screens.js:4757-4761 (`NarrativeGraph` sí usa `.card` + `.card-hd`); probe `/narrative`: `counts.cards…`
- El probe cuenta `cards: 0` en las cuatro capturas de `/narrative` — es la única pantalla del producto con cero. `.narrative-panel` es un card paralelo: fondo `--canvas-2` en vez de `--canvas`, radio `--r` en vez de `--r-lg` (y mando redefine `.card` a 6px en index.html:303), padding 12 en vez de 14/20, sin `box-shadow: var(--shadow-sm)`, y sin `.card-hd` / `.card-hd-title` / `.card-hd-sub` — el título es un `div.narrative-panel-label`…
- *Importa porque:* Un usuario que recorre Overview → Scorecard → Narrativas percibe un cambio de herramienta, no de sección. Y a nivel de mantenimiento significa que cada mejora de `.card` (sombra, radio, densidad, cabecera con subtítulo) hay que reimplementarla aquí a mano, que es exactamente por lo que esta pantalla se quedó atrás de…
- *Arreglo:* Reescribir `.narrative-panel` como `.card` + `.card-bd` y sustituir `.narrative-panel-label` por `.card-hd` con `card-hd-title` (nombre del panel) y `card-hd-sub` (la explicación que hoy no existe: "quién publicó primero", "de dónde viene el volumen"). Quitar el `.card` interno de `NarrativeGraph` y dejar que el contenedor de la vista sea el único card. Eso elimina de golpe cuatro valores fuera de escala (radio, padding, fondo, tipogra…

**· [N-17] Dos primitivas de chip a dos líneas de distancia en el mismo bloque visual, con lenguajes de «activo» opuestos** · `consistency`

- `index.html:702-726 (`.btn-chip`) contra 360-373 (`.chip`); screens.js:4887-4907 (filtros con `.btn-chip`) y 4946-4949 (pestañas con `.chip`); index.html:277 (`min-height…`
- Los filtros de estado usan `.btn-chip`: 10,5px, radio 999px, activo = `--accent-fill` con texto `--accent` (ghost). Las pestañas Detalle/Mapa usan `.chip`: 11px, radio 3px en mando, activo = relleno `--accent` sólido con `--on-accent`. Están a 40px de distancia vertical en la captura de escritorio y a 15 líneas en el código. El probe confirma la asimetría en móvil: `button.chip.active «Detalle»` mide 34px de alto (por el `min-height` d…
- *Importa porque:* El usuario aprende una gramática y la pantalla se la rompe en el mismo golpe de vista: si "activo" es un relleno naranja sólido en las pestañas, el chip "Todas (8)" con relleno tenue no parece activo (y de hecho la captura muestra ese chip como el filtro vigente). Es el caso más claro del "SPA-vs-AntD / falta de primi…
- *Arreglo:* Una sola primitiva de chip con dos variantes documentadas: `chip--filter` (toggle, ghost activo, con contador) y `chip--tab` (segmentado, relleno activo), ambas derivadas del mismo tamaño base, radio y `min-height`. Retirar `.btn-chip` y migrar los filtros. Extender el `min-height: 34px` móvil a la primitiva unificada para que ningún chip quede en 21px. Y convertir Detalle/Mapa en un verdadero control segmentado con `role="tablist"`, n…

**· [N-18] La fila de pestañas queda fuera del padding del panel: pisa la esquina redondeada y rompe la alineación con todo el contenido** · `layout-rhythm`

- `screens.js:4946 (el `div` de pestañas cuelga de `.narrative-canvas`); index.html:799-804 (`.narrative-canvas`, padding 0) y 821 (`.narrative-analysis`, padding 16/20/24)`
- El contenedor de las pestañas es hermano de `.narrative-analysis`, no hijo, y `.narrative-canvas` no tiene padding. En narrative-tablet-fold.png se ve el resultado con nitidez: el chip naranja "Detalle" arranca en el píxel exacto de la esquina superior izquierda del panel, montado sobre el radio del borde, mientras la píldora PICO y el título arrancan 40px más a la derecha. En narrative-mobile-fold.png el chip toca el borde izquierdo y…
- *Importa porque:* Es el primer elemento del panel principal y está desalineado con todos los demás: el ojo lo lee como un defecto de render, no como un control. Rompe la única línea vertical que organiza el panel y hace que el naranja del chip activo se pegue al borde, reforzando la lectura de "alerta" del hallazgo N-20.
- *Arreglo:* Mover la fila de pestañas dentro de un contenedor con el mismo padding lateral que `.narrative-analysis` (o mejor: pasar el padding a `.narrative-canvas` y quitarlo de `.narrative-analysis`, para que exista un solo dueño del padding del panel). Sustituir los estilos inline `{display:'flex',gap:6,marginBottom:12}` por una clase, y usar tokens de espaciado en vez de 6/12 crudos.

**· [N-19] 59 de 88 elementos de texto de la pantalla están por debajo de 12px, y 39 instancias fallan el contraste mínimo** · `type-scale`

- `probe `/narrative` (`fonts` y `lowContrast`); index.html:894-899 (`.narrative-metric-label` 9,5px), 971-977 (`.narrative-panel-label` 10px), 734-740 (`.narrative-menu-co…`
- Censo del probe en esta pantalla: IBM Plex Sans 81 elementos con tamaños 9(2) 10(16) 11(28) 12(13) 13(18) 16(2) 20(1) 22(1), más IBM Plex Mono 7 e Instrument Sans 9. Es decir 59 elementos bajo 12px y sólo cuatro a 16px o más, en una pantalla de 1440px. De las 39 instancias de bajo contraste, 26 son propias de la pantalla: los seis `.narrative-panel-label` y los tres `.narrative-metric-label` a 2,78:1 y 2,65:1, el rótulo "8 DE 8 NARRATI…
- *Importa porque:* Es la manifestación más extrema de F10 en una sola pantalla, y aquí el texto pequeño no es decorativo: los rótulos de 9,5px son los que dicen qué significa cada número (MENCIONES / VEL. 24H / ENGAGEMENT), y el par de 10,5px es el único dato cuantitativo de la lista maestra. Un funcionario leyendo esto proyectado o en…
- *Arreglo:* Adoptar la escala de `tokens.css` y subir el suelo: mínimo 12px para cualquier dato, 13px para el par volumen/estado de la lista, 11px sólo para rótulos de eje. Los rótulos de métrica y de panel pasan a `.t-overline` (11px, `--text-2`) en vez de 9,5/10px en `--text-3`. Adoptar `--text-3: #7C8798` de `tokens.css:192` (5,00:1) cierra de una vez 26 de las 39 instancias sin tocar el layout. Y reducir el uso de mayúsculas + letter-spacing,…

**· [N-20] La píldora PICO parece un botón primario y la fila seleccionada parece una fila en alerta** · `affordance`

- `index.html:839-847 (`.narrative-status-pill`), 762-765 (`.narrative-item.active`); tokens.css:198 (`--accent-fill: rgba(255,106,61,0.14)`)`
- En crop-filters.png la píldora "PICO" es un relleno naranja saturado, mayúsculas, radio 999, colocada inmediatamente a la izquierda de un título — exactamente el lenguaje visual de un botón primario del producto (`.btn-primary`), y no es clickeable ni tiene `title`. La fila activa de la lista combina borde 1px `--accent` con fondo `--accent-fill` (naranja al 14%), que sobre `--canvas` produce el bloque marrón-rojizo visible en la captu…
- *Importa porque:* Doble coste. Primero, el usuario intenta pulsar la píldora esperando filtrar por ese estado (que sería lo lógico) y no pasa nada. Segundo, y más grave para un cliente de gobierno: la fila seleccionada se lee como "incidente", así que la pantalla siempre parece tener una alarma activa. Naranja + borde en un tablero de…
- *Arreglo:* Separar los tres lenguajes. Selección: barra indicadora de 3px a la izquierda de la fila + fondo `--surface-raised` neutro, sin borde de color (patrón ya usado por el rail de navegación con `--rail-active-bg`). Estado: convertir la píldora en un chip "outline" (borde y texto del color de estado, fondo `--neu-bg`) y hacerla efectivamente clickeable para filtrar por ese estado — la afordancia existe, sólo falta el handler. Reservar el re…

**· [N-21] Zona muerta de ~310px en escritorio y hueco de ~110px entre paneles en móvil, por un `min-height` con número mágico** · `hierarchy`

- `index.html:669 (`min-height: calc(100vh - 140px)`), 679 (`height: calc(100vh - 140px)`), 1289 (`max-height: 400px`)`
- En narrative-desktop.png el contenido útil termina alrededor de los 655px de página y el documento mide 966px (probe `contentHeight: 966`): las dos cajas con borde — la lista y el canvas — se extienden ~310px por debajo de su contenido, dibujando dos rectángulos vacíos hasta el final. El `140px` no corresponde a la cabecera real, que consume ~190px (eyebrow + sello + título + fila propia del botón de tema). En móvil el mismo `min-heigh…
- *Importa porque:* El vacío no es neutral: dos cajas con borde y sin contenido leen como "aquí debería haber algo y falló", justo debajo de seis cajas que ya dicen "Sin datos". Y el `min-height` fuerza scroll vertical en una pantalla cuyo contenido cabría sin él, así que el usuario desplaza para descubrir que no hay nada.
- *Arreglo:* Eliminar el número mágico: usar `min-height: 0` en el grid y dejar que la altura la determine el contenido, o si se quiere el efecto de "panel a pantalla completa", derivarla de la cabecera real con una variable (`--header-h` actualizada por el propio Header) en vez de un 140 hardcodeado. Los bordes de panel no deben pintarse más allá del contenido: `align-items: start` en el grid. Y en móvil, quitar el `max-height` (ver N-15) elimina…

**· [N-22] El sujeto de la pantalla es más pequeño que la etiqueta de la pantalla, y su nombre se repite tres veces en 700px** · `hierarchy`

- `index.html:848-856 (`.narrative-title` 20px) contra shell.js:426-432 (`<h1>` 22px); screens.js:5045 (título), 5047 (resumen que repite el nombre), 4921 (nombre en la fil…`
- El `<h1>` genérico "Narrativas" pinta a 22px/700 con `--ff-display`; el nombre de la narrativa concreta, que es el objeto de análisis, pinta a 20px/700 con la misma familia y peso. En la captura de escritorio, dentro de un rectángulo de 700×250px aparece "Récord de visitantes 2026" tres veces: en la fila seleccionada de la lista, como título del panel, y citado entre comillas dentro del resumen. Lo primero que ve el ojo en la página es…
- *Importa porque:* En una pantalla de análisis de un objeto, el objeto tiene que ganar. Aquí la etiqueta de navegación gana por 2px y por posición, y el nombre real compite consigo mismo tres veces mientras el estado del que depende la decisión va a 10px. La consecuencia práctica es que en una captura de pantalla enviada por correo no s…
- *Arreglo:* Invertir la jerarquía: el `<h1>` de la pantalla baja a rótulo (11px overline, `--text-2`) y el nombre de la narrativa sube a 24-28px con `--ff-display`. Eliminar la repetición: el resumen no debe citar el nombre ni el conteo (ver N-23). Y aprovechar el cambio tipográfico ya decidido: Besley en el nombre de la narrativa a 26px con una itálica para el eyebrow da la distinción editorial que hoy se intenta con 2px de diferencia.

**· [N-23] El resumen es circular y afirma una tendencia en el mismo viewport donde la gráfica dice que no hay serie temporal** · `copy`

- `screens.js:5047 (render de `narrative.summary`); apps/web/src/app/api/narrative/route.ts:95 (`n.summary` viene de la DB, generado por el lambda de clustering)`
- El texto renderizado es: «Cluster de 142 menciones alrededor de "Récord de visitantes 2026". Volumen estable.» — para una narrativa llamada "Récord de visitantes 2026" cuyo conteo de 142 ya aparece dos veces arriba (fila de la lista y métrica MENCIONES). La segunda frase declara una tendencia de volumen a 40px de una caja que dice "Sin datos temporales todavía." y de una métrica que dice "VEL. 24H 0.0".
- *Importa porque:* Ocupa la posición más valiosa de la pantalla —debajo del título, en 13px sobre 740px de ancho— y no aporta información nueva; peor, aporta una afirmación ("Volumen estable") que la propia pantalla contradice dos veces. Un funcionario que cite ese resumen en un informe estará citando una conclusión que el sistema no pu…
- *Arreglo:* Cambiar el contrato del resumen: prohibir que repita el nombre y el conteo (esos ya están en el chrome) y exigir que aporte el contenido sustantivo — de qué se está hablando, quién lo impulsa, qué lo detonó. Y condicionar las frases de tendencia a que exista serie: si `timeline` está vacío, el renderizador debe truncar la oración de tendencia o mostrar "tendencia no disponible". Ambas cosas se arreglan en el prompt del lambda de cluste…

**· [N-24] Dos tipografías distintas en la misma fila de tres métricas, y el cambio a Besley las dejará sin alineación tabular** · `consistency`

- `index.html:900-907 (`.narrative-metric-value`, `font-family: var(--ff-numeric)`); screens.js:5059, 5063, 5067; tokens.css:27 (`--ff-numeric: 'Besley', Georgia, serif`)`
- En crop-nums.png, a 10× de aumento, "142" pinta con avance proporcional (~9,3px por carácter, cero ovalado, 1 sin serif de base) mientras "0.0" y "0" pintan en IBM Plex Mono (cero con punto interior, avance uniforme de ~10,8px). Los tres nodos comparten la misma regla CSS. El censo del probe corrobora la asimetría: sólo dos elementos a 18px en IBM Plex Mono, cuando hay tres `.narrative-metric-value` a 18px. No puedo fijar el mecanismo…
- *Importa porque:* Tres cifras que el usuario debe comparar de un vistazo, en dos tipografías con anchos de dígito distintos: la comparación visual falla y la fila parece un error de render. Y hacia adelante el problema empeora: con la nueva capa `--ff-numeric` pasa a ser Besley (serif) sin `font-variant-numeric: tabular-nums`, así que…
- *Arreglo:* No depender de la resolución de `--ff-numeric` en este sitio: aplicar la clase `.num` que ya existe (index.html:180, con `tabular-nums lining-nums` y `font-feature-settings`) a los tres valores, y declarar explícitamente la familia numérica del sistema. Para el cambio a Besley: verificar que el corte variable incluye cifras tabulares o reservar `--ff-mono` (IBM Plex Mono) para todas las cifras de tablero, que es el uso para el que se c…

**· [N-25] 36 objetivos por debajo de 44px, y la lista maestra completa es inoperable sin ratón** · `touch-target`

- `probe `smallTargets` de `/narrative`; screens.js:4914-4917 (`<li onClick>` sin `tabIndex` ni `role`), 5326-5333 (`<rect onClick>` en SVG); index.html:277-279 (el `min-he…`
- Objetivos propios de la pantalla, medidos: siete `button.btn-chip` a 21px de alto (idéntico en móvil), dos `button.chip` a 26px en escritorio y 34px en móvil, `input.narrative-search` a 34px también en móvil (mientras el buscador del header sube a 40px por la regla de index.html:279), y `button.narrative-related-btn` de 762×33px. Las filas de la lista son elementos `<li>` con `onClick` sin `tabIndex`, `role="option"` ni manejo de tecla…
- *Importa porque:* Seleccionar una narrativa es LA tarea de la pantalla y no se puede hacer con teclado ni con lector de pantalla: no hay nada enfocable en la lista. Para una herramienta de gobierno eso es un problema de cumplimiento, no de comodidad. Y en móvil, siete filtros de 21px de alto en un ancho de 390px hacen que tocar el chip…
- *Arreglo:* Convertir las filas en `<button>` (o `<li role="option">` con `tabIndex`, `aria-selected` y navegación con flechas) y añadir `:focus-visible` con el `outline: 2px solid var(--accent)` que ya define `tokens.css:456`. Extender el `min-height: 40px` móvil a la primitiva de chip unificada y a `.narrative-search` (que debería ser `.input`, ver N-16). Para el streamgraph, exponer los días como una lista navegable por teclado además de las zo…

**· [N-26] Único breakpoint fuera del sistema (980px) y única pantalla que no adoptó `ecoCols`: quedó fuera del overhaul responsive** · `consistency`

- `index.html:1287 (`@media (max-width: 980px)`) contra shell.js:16 y 48 (`768 / 1024`); screens.js:4803 (no recibe `bp`); grep: 26 usos de `window.ecoCols` en screens.js,…`
- `useBreakpoint` y `ecoCols` definen las paradas del producto en 768 y 1024 (shell.js:13-52) y las otras nueve pantallas los usan 26 veces. Narrativas no usa ninguno: todo su reflow depende de un único `@media (max-width: 980px)`. `app.js:395` pasa `bp` a la pantalla y `NarrativeScreen({ agency })` lo descarta. Entre 981 y 1024px el resto del producto ya está en modo tablet y esta pantalla sigue en dos columnas con la barra de 320px y e…
- *Importa porque:* Explica por qué esta pantalla acumula los problemas de responsividad que ya se resolvieron en el resto del producto (regiones de scroll con altura fija, huecos por `min-height`, grillas que colapsan de golpe): la corrección de PR #87 no la tocó. Y una franja de 43px de anchos donde el layout es inconsistente con el re…
- *Arreglo:* Migrar el reflow a `window.ecoCols('320px 1fr', '1fr')` para el grid principal y `ecoCols('1fr 1fr 1fr','1fr','1fr 1fr')` para la grilla de tres, alineando las paradas con 768/1024 y añadiendo la etapa intermedia de 2 columnas en tablet que hoy falta. Recibir `bp` como prop y usarlo también para decidir el alto del streamgraph (ver N-27). Eliminar el `@media (max-width: 980px)`.

**· [N-27] En móvil el reflow es correcto pero la jerarquía se invierte: el dato clave llega a 1.150px de scroll y las tres métricas se separan 1.400px en tablet** · `density`

- `index.html:886-892 (`.narrative-header-metrics`, `text-align: right`) y 1291-1292 (`flex-direction: column` + `justify-content: space-between`); screens.js:5237-5239 (st…`
- Tres degradaciones que el reflow no sugiere. (1) Orden de lectura: en narrative-mobile.png hacen falta ~355px de cabecera + ~460px de panel de lista + ~110px de hueco antes de que empiece el detalle; la fila MENCIONES/VEL/ENGAGEMENT aparece a ~1.150px de scroll, después de haber pasado por cinco narrativas y siete controles. (2) Alineación de métricas: en escritorio las tres van agrupadas y alineadas a la derecha; en ≤980px pasan a `sp…
- *Importa porque:* El móvil es donde un funcionario mira esto camino a una reunión. Hoy tiene que atravesar toda la interfaz de selección para llegar al primer número, y cuando llega, los tres números no se pueden comparar y las dos gráficas son ilegibles. El reflow no falló; falló la decisión de qué es lo primero que hay que ver.
- *Arreglo:* En móvil, invertir el orden del DOM: detalle primero, selector de narrativa colapsado arriba (ver N-15). Las tres métricas van a una grilla de 3 columnas iguales con rótulo y valor alineados al inicio de cada celda, en las dos orientaciones — nunca `space-between`. Y sustituir el viewBox fijo por `useChartWidth` (el hook que el resto del producto ya usa) con altura y tamaño de tipografía por breakpoint, de modo que las etiquetas se pin…

### P2 (3)

**· [N-28] El eyebrow más largo del producto se recorta en escritorio y tablet, y se ve completo sólo en móvil** · `copy`

- `app.js:162 (`eyebrow: 'Clusters emergentes · ramificaciones'`); shell.js:413 (`flex: '1 1 240px'`) y 415 (`whiteSpace: nowrap` + ellipsis)`
- El probe registra un único elemento truncado en `/narrative` desktop: `div.section-eyebrow «CLUSTERS EMERGENTES · RAMIFICACIONES»` con `clientW: 255` y `scrollW: 263`. En la captura de 1440px se lee "CLUSTERS EMERGENTES · RAMIFICACIO…" y en la de 768px "CLUSTERS EMERGENTES · RAMIFICACI…"; en la de 390px se lee completo, porque la barra envuelve y el bloque de título recupera ancho. La causa es el `flex: '1 1 240px'` del bloque de títul…
- *Importa porque:* Es la única pantalla del producto donde ocurre porque tiene el eyebrow más largo, y el resultado es la peor de las lecturas posibles: la información se pierde en la pantalla grande y se conserva en la pequeña. También delata la cabecera derrochadora de F11: el eyebrow no cabe porque hay demasiados controles compitiend…
- *Arreglo:* Dos frentes. Corto: acortar el eyebrow a "Clusters y ramificaciones" y permitir dos líneas (`white-space: normal` con `line-clamp: 2`) en vez de truncar. Estructural: sacar el grupo de periodo y el botón de tema de la fila del título (F11) para devolverle ancho al bloque de identidad, con lo que el eyebrow cabe sin recortes en todos los anchos.

**· [N-29] «Mapa de conexiones» promete una red que los datos no sostienen, y rellena con nodos sueltos sin decirlo** · `empty-state`

- `screens.js:4680-4693 (`layout`: relleno con top-40 sin aristas), 4735 (estado vacío), 4758-4760 (subtítulo del card), 4752-4754 (etiquetas del top 12)`
- Con los datos sembrados hay una sola arista para ocho narrativas (el panel "Narrativas relacionadas" muestra un único elemento). El código, cuando hay menos de 40 nodos con arista, concatena las 40 narrativas de mayor volumen SIN conexión (4686-4691) y el subtítulo del card anuncia "N narrativas · M conexiones · pasa el cursor para ver relaciones" (4760). El resultado es un mapa de conexiones donde casi todos los nodos están aislados y…
- *Importa porque:* El usuario abre la pestaña esperando la red de ramificaciones que el eyebrow de la pantalla promete y encuentra puntos dispersos; la lectura natural es "no hay relaciones entre los temas", cuando la verdad puede ser "el clustering de aristas no está produciendo resultados" (coherente con el estado congelado del featur…
- *Arreglo:* Hacer que el mapa declare su propia cobertura: subtítulo del tipo "8 narrativas · 1 conexión detectada · 7 sin conexiones" y, cuando las aristas sean menos que los nodos, mostrar un aviso explícito por encima del grafo en vez de rellenar en silencio. Y decidir el umbral: si el relleno con nodos sin aristas existe sólo para que el lienzo no se vea vacío, es preferible el estado vacío honesto que ya existe en 4735, con el número de narra…

**· [N-30] Implementación duplicada en Next.js + Ant Design: debe sobrevivir la SPA, pero hay que rescatar una cosa de la otra antes de borrarla** · `consistency`

- `apps/web/src/components/narratives/{NarrativeDetail,NarrativeGraph,NarrativeStatusBadge,TimelineSlider}.tsx y apps/web/src/app/narratives/page.tsx (702 líneas, sólo en e…`
- Los cinco archivos de Next.js no existen en `origin/main`: están staged en el monorepo principal. Usan Ant Design (`Tag`, tema propio) y son el origen de la paleta que hoy está copiada en `screens.js:4601-4608` — `NarrativeStatusBadge.tsx:23-30` trae los mismos seis hex con los comentarios `cyan-6 / green-6 / orange-6 / gold-6 / gray-7 / magenta-6`. Ambas implementaciones consumen las mismas cuatro rutas de `/api/narrative*`.
- *Importa porque:* Mantener dos UIs de la misma función garantiza que las correcciones se apliquen a una y no a la otra (es lo que ya pasó con la paleta), y una versión con Ant Design dentro del tema mando reintroduce el problema SPA-vs-AntD que la auditoría de julio identificó como sistémico. Pero borrarla sin más pierde lo único que h…
- *Arreglo:* Debe sobrevivir la SPA (`screens.js`), porque es la que el usuario alcanza vía `/narrative`, comparte cabecera, agencia, tema y periodo, y es la que aparece en las capturas. Antes de borrar la versión AntD: extraer de `NarrativeStatusBadge.tsx` el tipo `NarrativeStatus` a un módulo compartido (`packages/shared`) y hacer que tanto `/api/narrative/route.ts` como la SPA lo consuman — así el enum pasa a tener un solo dueño, que es la raíz…


## Geografía

*24 hallazgos*

La pantalla se apoya entera en un mapa de símbolos proporcionales que no es proporcional, no está rotulado y cambia de significado cuando el usuario pulsa "Sentimiento" sin decirlo en ninguna parte: el radio es lineal con un piso de 8px (un municipio con 1 mención dibuja un área 24.6× mayor que la honesta) y en modo Sentimiento el tamaño pasa a codificar |NSS|, de modo que un pueblo con 3 menciones y NSS -10 se convierte en el círculo más grande de la isla y San Juan en un punto. Debajo del mapa hay dos tarjetas que contradicen al mapa y entre sí: "Sentimiento por región" promedia el NSS municipal SIN ponderar por volumen mientras imprime "4 municipios · 669 menciones" al lado, y el mismo indicador ya existe en /sentiment calculado por mención (SENTIMENT_BY_REGION en eco-data), así que las dos pantallas darán cifras distintas bajo el mismo título. El basemap CARTO dark_all remata el problema: medí las etiquetas de lugar en 2.04:1 como máximo (#444 sobre tierra #090909) y los marcadores tapan justo los topónimos que representan, con lo cual ningún círculo se puede atribuir a un municipio sin hover — y en táctil no hay hover. En móvil no es solo pérdida de jerarquía: con contenedor de 314px y minZoom 8 el fitBounds se clampa, la isla se recorta y el zoom-out queda deshabilitado (lo confirma el probe), así que Mayagüez —el #5 por volumen— es literalmente inalcanzable. Nota de encuadre: las capturas son del commit 8a996a8; los tres commits posteriores del worktree (92e0d4a, d8ddb32, a69ea2e) ya arreglaron --text-3 (2.65→5.00:1), separaron --accent de --neg y devolvieron jerarq…

### P0 (9)

**· [GEO-01] Los círculos del mapa no son proporcionales: radio lineal con piso de 8px** · `chart-honesty`

- `apps/web/public/eco-prototype/charts.js:804`
- `const r = 8 + (v / max) * 22;`. Con max=341 (San Juan): 341→r30, 66→r12.3, 5→r8.3, 1→r8.1. Leído como área, 341 vs 66 sale 5.99× cuando la diferencia real es 5.17×; leído como diámetro sale 2.45×. El piso de 8px es el gran deformador: frente a una codificación honesta (r=30·√(v/max)) un municipio con 5 menciones pinta 5.2× más área de la que le toca y uno con 1 mención 24.6×. En geography-desktop.png los círculos de Culebra, Vieques y…
- *Importa porque:* El mapa es lo primero y lo único que el ojo lee de esta pantalla. Un funcionario que lo mire concluye 'hay conversación en toda la isla' cuando la mitad de esos puntos puede ser una sola mención, y subestima la concentración real en el área metro. Es exactamente el error que hace que un mapa se cite en una reunión con…
- *Arreglo:* r = rMax·√(v/vMax) con rMin ≈ 3px (no 8) y rMax ≈ 26px; si hace falta visibilidad mínima, usar un anillo de 1px de 4px de radio para v>0 en vez de inflar el área. Extraer la escala a una función única `symbolRadius(v, vMax)` en charts.js y usarla también en la leyenda de GEO-10.

**· [GEO-02] El tamaño del círculo cambia de significado al pulsar «Sentimiento» y nada lo declara** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2781`
- `accessor={(m) => metric === 'count' ? m.count : Math.abs(m.nss)}`. En modo Volumen el radio codifica menciones; en modo Sentimiento codifica el valor absoluto del NSS, normalizado al máximo |NSS| del periodo. La leyenda que cambia (screens.js:2786-2790) solo explica el COLOR: «Positivo (>+2) / Neutral / Negativo (<-2)». Con NSS = (pos−neg)/total·10 (apps/web/src/app/api/eco-geo/route.ts:167), un municipio con 3 menciones todas negativ…
- *Importa porque:* Es la inversión total de la importancia: el modo que el cliente usará para detectar problemas ('¿dónde está el malestar?') premia con el símbolo más grande a los municipios con menos datos y castiga a los que concentran la conversación. Y como el usuario acaba de ver el mismo tamaño significando volumen, arrastra esa…
- *Arreglo:* En modo Sentimiento mantener tamaño = volumen (comparable entre modos) y mover TODO el significado del sentimiento al color divergente. Exigir volumen mínimo (p. ej. n≥20) para colorear; por debajo, gris neutro con la nota «muestra insuficiente» en el tooltip y en la leyenda. Si se quiere conservar el doble encoding, rotular el modo explícitamente: «Tamaño: menciones · Color: NSS».

**· [GEO-03] El mapa y la tarjeta de región dan veredictos opuestos sobre el mismo NSS** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:2782 y 2834-2840`
- El mapa cubetea con zona muerta: `m.nss > 2 ? pos : m.nss < -2 ? neg : warn`. La tarjeta de región es binaria en cero: `color: avgNss > 0 ? 'var(--pos)' : 'var(--neg)'` y `background: pct > 0 ? pos : neg`. En geography-desktop.png la región Norte se imprime en rojo (−1.4) y Este en rojo (−0.6), pero sus municipios, con |NSS|<2, se pintan AMARILLO/neutral en el mapa de arriba. Además `avgNss > 0` es falso para 0 exacto: una región perfe…
- *Importa porque:* Dos codificaciones del mismo indicador a 300px de distancia en la misma pantalla. El lector no puede saber si Norte está mal (rojo abajo) o normal (amarillo arriba), y la respuesta correcta depende de qué widget mire primero. Es la clase de contradicción que un cliente usa para descartar la herramienta completa.
- *Arreglo:* Definir UNA escala de NSS en tokens (dominio −10..+10, umbrales de neutralidad ±2, tres colores + gris de muestra insuficiente) y consumirla desde el mapa, la tarjeta de región, el modal y los correos. Cero exacto pertenece a la banda neutral, nunca a --neg.

**· [GEO-04] El NSS de región es un promedio SIN ponderar, presentado junto al volumen que ignora** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2813-2814`
- `const avgNss = regionMunis.reduce((s,m) => s+m.nss, 0) / regionMunis.length;` y en la línea siguiente se suma el volumen solo para imprimirlo: `total`. En la captura, «Metro −0.2 · 4 municipios · 669 menciones» es la media aritmética de San Juan (341), Bayamón (144), Carolina (118) y Guaynabo (66): Guaynabo pesa lo mismo que San Juan, que tiene 5.2× más menciones.
- *Importa porque:* El número grande y coloreado es el que se lee, y la línea que lo acompaña («669 menciones») induce a creer que resume esas 669 menciones. No lo hace: un municipio pequeño y ruidoso puede voltear el signo de una región entera. En un tablero de gobierno esto se traduce en atención asignada al lugar equivocado.
- *Arreglo:* Ponderar por volumen: `sum(m.nss*m.count)/sum(m.count)`, o mejor, calcular NSS de región desde los conteos crudos (Σpos−Σneg)/Σtotal usando m.positivo/m.negativo que ya vienen en el payload. Si se conserva el promedio simple, decirlo en el subtítulo («promedio simple de municipios»).

**· [GEO-05] «Sentimiento por región» existe dos veces en el producto con dos cálculos distintos** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2810-2815 vs apps/web/src/app/api/eco-data/route.ts:842-850`
- eco-data ya entrega `SENTIMENT_BY_REGION` agregando positivo/neutral/negativo por región a nivel de mención, y /sentiment lo pinta con ese nombre (screens.js:1521, opción «Región»). Geography ignora ese dataset y recalcula la región en el cliente promediando NSS municipales. Ambas tarjetas se titulan «Sentimiento por región».
- *Importa porque:* El mismo cliente, el mismo periodo y el mismo título dan dos números según la pantalla en la que esté. Es una repetición del patrón F9 (cinco totales en el Scorecard) y es el tipo de inconsistencia que aparece en una presentación cuando alguien compara dos capturas.
- *Arreglo:* Geography debe consumir SENTIMENT_BY_REGION (y hacer que /api/eco-geo lo devuelva ya filtrado por fuente/tópico/subtópico, como devuelve municipalities). Un indicador, un cálculo, un origen.

**· [GEO-06] El mapa no tiene ni un topónimo legible, y los marcadores tapan los que importan** · `contrast`

- `apps/web/public/eco-prototype/charts.js:752 (tileLayer dark_all)`
- Medido sobre geography-desktop-fold.png: las etiquetas del basemap topan en rgb(68,68,68) sobre tierra rgb(9,9,9) → 2.04:1 (y 1.55:1 sobre el mar rgb(38,38,38)); el máximo de toda la capa de texto es #444. Contraste tierra/mar: 1.30:1, así que la silueta de la isla también es débil. En el recorte del área metro, el círculo de San Juan (r=30) cubre por completo la palabra «SAN JUAN» y el de Bayamón tapa «Bayamón». No hay etiquetas propi…
- *Importa porque:* Un mapa cuya única función es decir DÓNDE no dice dónde. Sin hover (imposible en táctil, GEO-16) el usuario no puede atribuir ningún círculo a un municipio; el mapa se degrada a una manchita naranja decorativa y toda la lectura real se traslada a la lista «Top municipios», que solo muestra 8 de 18.
- *Arreglo:* Cambiar a `dark_nolabels` + un segundo tileLayer `dark_only_labels` en un pane por encima de markerPane (`map.createPane('labels'); pane.style.zIndex=650`), de modo que los topónimos queden SOBRE los círculos. Añadir etiqueta permanente (L.tooltip permanent, 11px, con halo) para el top 5 por volumen. Y si el basemap sigue en 2:1, sustituir el estilo por uno con etiquetas ≥4.5:1.

**· [GEO-07] Si la consulta filtrada falla, el mapa sigue mostrando los datos SIN filtrar y no avisa** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2704-2708`
- `.then((r) => (r.ok ? r.json() : { municipalities: null })).then((d) => { if (...Array.isArray(d.municipalities)) setMunis(...) }).catch(() => {})`. Ante 400/500/timeout no se llama a setMunis: `munis` conserva D.MUNICIPALITIES (el arranque, sin filtros) mientras los tres selects muestran «Turismo», «Facebook», etc. El catch está vacío, no hay estado de error, y /api/eco-geo devuelve 400 en tópico inválido y 500 en fallo de agregación…
- *Importa porque:* El usuario cree estar viendo la geografía de un tópico y está viendo la de todo. No hay ninguna pista visual de la diferencia: mismos círculos, mismos números. Es el fallo más peligroso de la pantalla porque produce una conclusión falsa con apariencia normal.
- *Arreglo:* Guardar `error` en estado y, si la petición falla, vaciar el mapa y pintar un bloque «No se pudo aplicar el filtro · Reintentar» sobre el lienzo (o revertir los selects al último estado exitoso). Nunca dejar datos de un filtro distinto al que muestran los controles.

**· [GEO-08] «78 municipios monitoreados» está hardcodeado; el mapa solo dibuja 18** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2755 y app.js:159`
- Los dos textos («78 MUNICIPIOS · PUERTO RICO» en el eyebrow y «78 municipios monitoreados» en el subtítulo) son constantes de código, no se derivan de `munis`. En la captura, la suma de la tarjeta de regiones es 4+2+3+2+3+4 = 18 municipios y 1,312 menciones. /api/eco-geo hace INNER JOIN sobre mention_municipalities (route.ts:130-134), así que los municipios sin menciones geolocalizadas simplemente no existen en la respuesta, y la panta…
- *Importa porque:* Un alcalde o un secretario que no ve su municipio no puede distinguir «no hay conversación sobre nosotros» de «no lo estamos geolocalizando». Y la cifra 78, repetida dos veces arriba, certifica una cobertura que el mapa no respalda: 4.3× más municipios de los que dibuja.
- *Arreglo:* Derivar el texto: «{munis.length} de 78 municipios con menciones geolocalizadas · {geoCoveragePct}% del volumen del periodo». Añadir al payload de eco-geo el total de menciones del periodo y el total con municipio para poder calcular esa cobertura, y mostrar los municipios con 0 como puntos vacíos de 3px para que existan visualmente.

**· [GEO-09] En móvil la isla se recorta y el zoom-out está deshabilitado: Mayagüez es inalcanzable** · `layout-rhythm`

- `apps/web/public/eco-prototype/charts.js:745 y 838`
- `minZoom: 8` + `fitBounds(..., { padding: [24,24], maxZoom: 10 })` con un contenedor de 314px (probe, clientW=314). A z8 Puerto Rico mide ~382px de ancho (1.87° de longitud entre marcadores) contra ~266px útiles, así que fitBounds pide un zoom <8 y Leaflet lo clampa. Resultado en geography-mobile.png: el extremo oeste queda fuera, la etiqueta de Mayagüez se corta como «…UEZ» y su círculo aparece partido en el borde izquierdo. El probe…
- *Importa porque:* No es pérdida de jerarquía, es pérdida de datos: Mayagüez es el 5º municipio por volumen (92 menciones) y en teléfono no se puede ver ni tocar, y el control que serviría para recuperarlo está apagado. El teléfono es el dispositivo del usuario ejecutivo.
- *Arreglo:* Quitar `minZoom: 8` (o bajarlo a 7) y sustituir la altura fija por un contenedor con aspect-ratio ~16/9 en móvil; llamar a `fitBounds` con `padding` proporcional al ancho y sin `maxZoom` cuando el contenedor sea estrecho. Verificar con el probe que zoom-out queda habilitado en 390px.

### P1 (14)

**· [GEO-10] El mapa no tiene leyenda de tamaño: un punto de 8px con la palabra «Volumen»** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2785-2786`
- La leyenda es `<span className="dot">` (8px fijos, index.html:607) + el texto «Volumen». No hay escala de tamaños, ni valor máximo, ni unidad, ni el número que representa el círculo mayor. En modo Sentimiento se añaden dos puntos más del mismo tamaño para el color, pero el tamaño sigue sin explicarse.
- *Importa porque:* Sin escala, el lector no puede convertir área en cifras y solo le queda el orden relativo — que además está distorsionado (GEO-01). El punto de 8px, que coincide con el radio MÍNIMO real de los marcadores, sugiere falsamente que ese es el tamaño de referencia.
- *Arreglo:* Leyenda de tres círculos anidados con los valores reales (máximo, mitad, mínimo del periodo) usando la misma función de radio que los marcadores, más la unidad («menciones»). En modo Sentimiento, dos leyendas: tamaño (menciones) y color (NSS con sus umbrales).

**· [GEO-11] Las barras divergentes de región son inertes: el dato ocupa el 1-8% de la pista** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:2815 y 2838-2841`
- `pct = clamp(avgNss/10)` y el relleno mide `Math.abs(pct)*50`% de la pista. Con los valores de la captura: Sur −1.6 → 8% (medido 53px de 695), Metro −0.2 → 0.7% (~5px), indistinguible del tick central de 1px en --text-3. Ningún extremo está rotulado, así que tampoco se sabe que la pista representa ±10.
- *Importa porque:* Seis filas ocupan media pantalla para no comunicar nada: la comparación entre regiones solo funciona leyendo los números, y el gráfico que debería hacerla instantánea sugiere «todo está en cero». Encima, un dominio de ±10 sin rotular hace pensar que −1.6 es despreciable cuando es −16% neto.
- *Arreglo:* Escalar al rango plausible del indicador (±3 con marcas en −2/0/+2, la misma banda neutral de GEO-03) o cambiar a un dot plot de una sola pista compartida por las seis regiones, que además permite comparar entre filas. Rotular los extremos y el cero.

**· [GEO-12] El orden de las regiones parece significativo y contradice los números que imprime** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:2810`
- `[...new Set((munis || []).map((m) => m.region))]` = orden de llegada del API, que ordena por volumen MUNICIPAL (eco-geo/route.ts:165). En la captura sale Metro 669, Sur 118, Oeste 184, Centro 105, Norte 105, Este 131: «Sur» aparece encima de «Oeste» teniendo 66 menciones menos. Como el orden depende del municipio líder, cambia con cada filtro de fuente/tópico y las filas saltan de posición. Otras pantallas sí ordenan explícitamente (s…
- *Importa porque:* Toda lista vertical se lee como un ranking. Aquí el ranking implícito no es ni volumen, ni NSS, ni alfabético, y el lector saca conclusiones de prioridad falsas. La inestabilidad al filtrar impide además comparar dos estados de la pantalla.
- *Arreglo:* Orden explícito y declarado en el subtítulo: por volumen de región descendente (coherente con «Top municipios») o por NSS ascendente si la tarjeta trata de riesgo. Añadir un selector si de verdad hacen falta ambos.

**· [GEO-13] El mapa se reencuadra y pierde el zoom/pan del usuario en cada render** · `affordance`

- `apps/web/public/eco-prototype/screens.js:2781-2783 + charts.js:840 y 838`
- `accessor` y `colorFn` se pasan como arrow functions inline y `onMunicipalityClick={openMuniSlice}` se redefine en cada render, así que las deps del efecto `[municipalities, accessor, colorFn, onMunicipalityClick]` cambian siempre: se ejecutan `layer.clearLayers()` y `fitBounds(...)` en cada re-render del screen. Cualquier setState del padre (setLoadingGeo true/false, abrir o cerrar el modal de un municipio, cambiar un filtro) devuelve…
- *Importa porque:* El único gesto de exploración que ofrece el mapa —acercarse al área metro, donde los círculos se solapan— se deshace en cuanto el usuario hace lo siguiente que la pantalla le pide (clic en un municipio → modal → cerrar). Rompe la tarea de inspección y se percibe como un mapa que «se sacude».
- *Arreglo:* Envolver accessor/colorFn/openMuniSlice en useCallback/useMemo y separar el efecto en dos: uno que redibuje marcadores y otro que haga fitBounds solo cuando cambie el conjunto de municipios (comparando slugs) o al montar. Añadir un botón «Reencuadrar» explícito.

**· [GEO-14] No hay estado vacío ni de carga real: filtrar sin resultados deja un mapa mudo y dos tarjetas huecas** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:2777 y charts.js:798-799`
- Con `munis = []`, PRMap hace `clearLayers()` y retorna antes de dibujar o reencuadrar (charts.js:799): queda el basemap con cero puntos y el encuadre anterior. HBarList no pinta filas y el `card-bd` de regiones queda vacío con solo su cabecera. El único indicador de proceso es `{loadingGeo && <span style={{fontSize:11,color:'var(--text-3)'}}>Actualizando…</span>}` al lado de los selects, mientras el mapa sigue mostrando los datos viejo…
- *Importa porque:* Vacío, cargando y roto se ven igual. El usuario que combine tópico+fuente sin cobertura geográfica concluirá que la herramienta está caída, o peor, que no hay conversación en ningún municipio.
- *Arreglo:* Tres estados explícitos en el lienzo del mapa: skeleton + atenuación del 40% durante la carga, bloque «Sin menciones geolocalizadas con estos filtros · Limpiar filtros» cuando la respuesta viene vacía, y el bloque de error de GEO-07. Las dos tarjetas inferiores deben mostrar el mismo mensaje en vez de quedarse en blanco.

**· [GEO-15] Tres selects a ancho completo y sin etiqueta consumen la mitad del espacio previo al mapa** · `density`

- `apps/web/public/eco-prototype/screens.js:2763-2775 + index.html:396`
- El contenedor es `display:flex; gap:8; flexWrap:wrap` con `minWidth` 150/160/170 —claramente pensado para una sola fila— pero `.input { width: 100% }` obliga a cada select a ocupar la línea completa: el probe mide 1114×35 en escritorio y 316×40 en móvil, tres veces. Son ~145px de alto de filtros (más 16 de margen) antes del primer dato, y un desplegable de 1114px para el valor «Todas las fuentes». Ninguno tiene etiqueta: «Todas las fue…
- *Importa porque:* Los filtros pesan visualmente más que el mapa que filtran y empujan el dato hacia abajo (GEO-21 ya desperdicia medio lienzo). Sin rótulos, el usuario no sabe qué dimensión está tocando hasta desplegar, y un control deshabilitado a ancho completo parece un campo roto.
- *Arreglo:* `display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 240px))` con rótulo de 10px sobre cada control (Fuente / Tópico / Subtópico) y `width:auto` en estos selects; el subtópico deshabilitado con `aria-disabled` y texto de ayuda («Elige un tópico primero») en lugar de placeholder.

**· [GEO-16] Las cifras del mapa solo existen en hover, y en el área metro los círculos se solapan** · `affordance`

- `apps/web/public/eco-prototype/charts.js:822-830 y 812`
- `marker.bindTooltip(...)` sin `permanent`, es decir hover puro; el clic está tomado por `onMunicipalityClick` (charts.js:831), que abre el modal. En táctil no hay hover, así que el único camino a «341 menciones · NSS −0.4» es abrir el modal municipio por municipio. Además `fillOpacity: 0.78` hace que los solapes del área metro (San Juan r=30 sobre Bayamón, Cataño y Guaynabo, ver recorte) produzcan una lente más brillante que no represe…
- *Importa porque:* En el dispositivo donde más se consulta un tablero ejecutivo, el mapa no entrega una sola cifra sin abrir un modal por punto. Y la lente brillante del solape es un artefacto que se lee como «aquí hay más», justo en la zona más densa y sensible del país.
- *Arreglo:* Etiquetas permanentes con el valor para el top 5 y tooltip también en `click` cuando `L.Browser.touch` (o sustituir el modal por un panel lateral que muestre primero la ficha del municipio). Bajar a `fillOpacity: 0.55` con `stroke` de 1.5px del color pleno, o desplazar los solapes con un pequeño dodge, para que dos círculos superpuestos no generen un tercer tono.

**· [GEO-17] El drill-in titula el acrónimo, degrada el municipio y muestra un desglose inventado** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2712-2724 y 2653-2664`
- `openMuniSlice` fija `title: 'NSS ' + m.nss.toFixed(1)` y manda el nombre del municipio al eyebrow, mientras el slice de región usa otra gramática: `title: 'Sentimiento en ' + r` (2821). El desglose que se pinta antes de que llegue el fetch sale de `splitSentiment(m.count, ...)`, que reparte con ratios fijos (0.55/0.25/0.20 · 0.22/0.28/0.50 · 0.38/0.40/0.22) según un umbral de ±2 — aunque `m.positivo`, `m.neutral` y `m.negativo` REALES…
- *Importa porque:* El usuario ve durante la carga un desglose plausible y falso, con la huella dactilar idéntica en todos los municipios neutrales; si el fetch falla, el catch deja 0 menciones y el modal contradice al mapa. Y titular «NSS −0.4» en vez de «San Juan» convierte la ficha de un lugar en la ficha de un número.
- *Arreglo:* Usar `sentiment: { pos: m.positivo, neu: m.neutral, neg: m.negativo }` (dato real ya disponible) y borrar splitSentiment de esta ruta. Título = nombre del municipio, NSS como valor secundario junto al volumen; misma gramática para el slice de región («Metro · 4 municipios»).

**· [GEO-18] La capa del mapa está fuera del sistema de tokens y el rediseño de tokens ya la desincronizó** · `color-semantics`

- `apps/web/public/eco-prototype/charts.js:810, 816, 823-827 + index.html:652-657`
- El marcador se traza con `color: '#0E1620'` y el tooltip con `#3FD47A` / `#FF6A3D` / `#E6ECF3` / `#8A94A1` hardcodeados. Tras 92e0d4a, `--neg` pasó a #FF5470 (tokens.css:201) y `--accent` se quedó en #FF6A3D: el tooltip pinta ahora un NSS negativo en NARANJA (el color de acento/volumen) mientras la leyenda del mismo mapa lo pinta rosa. Además `.leaflet-control-attribution a` usa `rgba(63,181,216,0.85)`, que es el acento del tema costa…
- *Importa porque:* El único sitio del producto donde el color debe ser inequívoco (el color ES el dato en modo Sentimiento) es el que no obedece a los tokens: cualquier ajuste futuro de la paleta seguirá dejando el mapa detrás, y ya hay dos rojos distintos para «negativo» a la vez.
- *Arreglo:* Leer los colores en tiempo de render con `getComputedStyle(document.documentElement).getPropertyValue('--pos'|'--neg'|'--warn'|'--text')` (o pintar el tooltip con clases en vez de estilos inline) y regenerar los marcadores en el MutationObserver de data-mode que ya existe (charts.js:776). Sustituir el azul de atribución por `--info` y dar variantes claras a controles y tooltip.

**· [GEO-19] Los dos elementos más luminosos del lienzo son cromo, no dato** · `hierarchy`

- `apps/web/public/eco-prototype/index.html:643-649 y screens.js:2757-2759`
- Los controles de Leaflet quedan con `color: #E6ECF3 !important` sobre `rgba(14,22,32,0.95)`: el bloque +/− es el par de glifos más brillante de la captura (ver geography-desktop-fold.png, esquina superior izquierda del mapa) y compite con el chip naranja lleno «Volumen», que es el objeto de mayor saturación de la tarjeta. Los círculos de datos van a 0.78 de opacidad, por debajo de ambos.
- *Importa porque:* El ojo aterriza en el zoom y en un selector de modo antes que en San Juan. En una pantalla cuyo único mensaje es la distribución territorial, el orden de lectura correcto es dato → leyenda → controles, y aquí está invertido.
- *Arreglo:* Bajar los controles a `--text-2` sobre fondo translúcido y sin borde (o moverlos a la esquina inferior derecha, junto a la atribución); dar al chip activo el mismo peso que a los inactivos con un subrayado de 2px en --accent en lugar de relleno pleno. Subir los marcadores a opacidad 0.85 con trazo del color pleno.

**· [GEO-20] Los objetivos propios de la pantalla están por debajo de 44px, incluidos los del mapa** · `touch-target`

- `apps/web/public/eco-prototype/screens.js:2758, 2799-2803 + index.html:277`
- probe.smallTargets del viewport móvil: chips de modo 66×34 y 83×34 (`.chip { min-height: 34px }`, index.html:277), controles de Leaflet 30×30, los tres enlaces de atribución de 11px de alto, y las 8 filas de «Top municipios» a 332×23 (el `padding: '4px 6px'` de HBarList, charts.js:619). Las filas de región sí cumplen. En escritorio los chips bajan a 26px.
- *Importa porque:* Las filas de 23px son la ruta ALTERNATIVA al mapa (la única accesible cuando el mapa está recortado en móvil, GEO-09): fallar el toque abre el modal del municipio vecino y el usuario cree que el dato es de otro sitio. El zoom de 30px es el control que necesitaría para recuperar Mayagüez.
- *Arreglo:* Subir HBarList a `padding: '10px 6px'` cuando es clickable (44px de alto en táctil), `.chip { min-height: 44px }` en el media query táctil, y `.leaflet-control-zoom a { width: 44px; height: 44px }` bajo `@media (pointer: coarse)`.

**· [GEO-21] El lienzo del mapa tiene proporción fija de 420px: medio océano vacío en escritorio** · `layout-rhythm`

- `apps/web/public/eco-prototype/charts.js:865 y 838`
- Altura fija de 420px y `fitBounds(..., { maxZoom: 10 })`. A z10 Puerto Rico mide ~764px de ancho, así que en un contenedor de 1490px (escritorio) la isla ocupa ~51% del ancho y el resto es mar y las Islas Vírgenes (se leen «Charlotte Amalie» y «Road Town», jurisdicciones ajenas). En móvil, la misma constante deja ~45% del alto vacío por debajo de la isla (geography-mobile.png).
- *Importa porque:* La pieza principal de la pantalla desperdicia la mitad de su superficie, lo que obliga a los círculos a ser pequeños y a solaparse justo donde hay más datos, y empuja «Top municipios» y las regiones fuera del primer pantallazo. Además dedica píxeles de un tablero del Gobierno de Puerto Rico a territorio de otra jurisd…
- *Arreglo:* Contenedor con `aspect-ratio` responsivo (≈ 2.6/1 en escritorio, 16/9 en móvil) en lugar de 420px fijos, y `maxBounds` ajustados al archipiélago puertorriqueño (incluyendo Vieques y Culebra) para que el encuadre no regale espacio a las USVI. Subir `maxZoom` del fitBounds a 11 para que la isla llene el ancho disponible.

**· [GEO-22] La instrucción principal está en anglicismo y en un dialecto distinto al del resto del producto** · `copy`

- `apps/web/public/eco-prototype/screens.js:2755 vs screens.js:1971`
- Aquí: «78 municipios monitoreados · click un municipio para ver menciones». En Tópicos, la misma instrucción está bien escrita: «Haz clic en un tópico para ver sus subtópicos». También conviven «Sentimiento en el tiempo · Volumen apilado · click un día para ver menciones» (1680). Y el subtítulo «NSS agregado» (2808) usa un acrónimo sin definición ni escala en la única tarjeta que lo cuantifica.
- *Importa porque:* Es un producto para el Gobierno de Puerto Rico: «click un municipio» no es español y delata plantilla sin revisar. «NSS agregado» pide al lector que sepa qué es un Net Sentiment Score y en qué rango vive antes de poder interpretar −1.6.
- *Arreglo:* Unificar: «Haz clic en un municipio para ver sus menciones». Subtítulo de la tarjeta de regiones: «Net Sentiment Score (NSS) promedio · escala −10 a +10» (y ponderado, según GEO-04). Pasar todas las cadenas de la SPA por una revisión de estilo con glosario.

**· [GEO-24] El mapa no existe para teclado ni para lector de pantalla** · `accessibility`

- `apps/web/public/eco-prototype/charts.js:807-832 y 861-872`
- Los marcadores son `L.circleMarker` → `<path>` SVG sin `tabindex`, sin `role`, sin nombre accesible; el contenedor (charts.js:862) no tiene `role="img"`, ni `aria-label`, ni tabla equivalente. El tooltip solo se dispara por mouseover. La única ruta equivalente es «Top municipios», que son botones reales pero muestran 8 de los 18 municipios con datos.
- *Importa porque:* El contenido principal de la pantalla queda inaccesible para una parte de los usuarios de una plataforma de gobierno, y el sustituto de facto (la lista) está truncado, así que ni siquiera hay paridad de información.
- *Arreglo:* `role="img"` + `aria-label` con el resumen («18 municipios con menciones; mayor volumen San Juan, 341») en el contenedor, marcadores con `keyboard: true` y `alt`/`title` por marcador, y una tabla completa de los 18 municipios (colapsable, `<table>` real) como equivalente textual — que además resuelve el «Top 8 de 18».

### P2 (1)

**· [GEO-23] Cuatro decisiones de sistema distintas dentro de una sola pantalla** · `consistency`

- `apps/web/public/eco-prototype/screens.js:2752, 2762, 2795, 2828, 2838`
- (1) `card-bd` con `padding: 24` (2762) contra los 16px del primitivo (index.html:317), así que la tarjeta del mapa respira distinto que las dos de abajo. (2) `gap: 16` en el stack vertical (2752) frente a `gap: 12` en el grid de las dos tarjetas (2795), para la misma relación de hermandad. (3) Dos pistas de barra: `.bar-track` (--canvas-2, radio 1px en mando, index.html:602-604) en «Top municipios» y un div inline con `background: var(…
- *Importa porque:* Aisladas son cosméticas; juntas hacen que dos tarjetas gemelas parezcan de dos productos y que el usuario no aprenda una sola regla de «qué es clickeable». Es la manifestación local de F10 (ni escala tipográfica ni de espaciado).
- *Arreglo:* Un solo `--space` (12) para gaps de nivel de tarjeta, `padding: 16` del primitivo sin override, `.bar-track` como única pista de barra, y una sola primitiva `ListRow` (fondo transparente + hover + chevron) para todas las filas que abren el drill-in.


## Pantalla Alertas

*27 hallazgos*

Alertas es la pantalla con más deuda de veracidad de todo el producto: es una consola de triage cuyo objeto central —la alerta disparada— es lo último que aparece en la página, no tiene acciones, y llega al lector después de pasar por tres capas que rellenan huecos con valores inventados en vez de admitirlos (la API de eco-data fija `priority:'media'`, `triggered:0`, `lastFired:'—'` para TODAS las reglas; la de historial convierte cualquier banda desconocida en 'media'; el SPA repite el mismo fallback; y un fallo de red se pinta como "Sin alertas disparadas en el período"). El resultado es que las dos pestañas de la misma pantalla se contradicen: "Reglas" jura que ninguna regla se ha disparado nunca y que todas son de prioridad media, mientras "Historial" muestra 11 activaciones con 5 ALTA. A eso se suman dos gráficas que no sostienen su escala (un ranking cuyo 3 se ve más largo que un 5 de la tarjeta vecina, y un "Activaciones por día" que no es un eje temporal y que en la captura sale como una caja vacía de 110px bajo el rótulo "11 eventos en el período"), un interruptor Activa/Inactiva que no persiste nada, un badge rojo permanente en el rail que cuenta reglas activas y no alertas sin atender, y dos formularios de configuración embebidos por iframe que son literalmente otro producto (tema AntD claro "Mar Caribe", primario turquesa, fuentes del sistema) y que además editan siempre la configuración de DDEC aunque el shell esté en otra agencia. En móvil el reflow es correcto pero la jerarquía se pierde: las dos columnas que dicen QUÉ se disparó y CUÁNTAS menciones quedan f…

### P0 (12)

**· [AL-01] La pestaña Reglas inventa prioridad, activaciones y último disparo en la API — y contradice a Historial en la misma pantalla** · `data-integrity`

- `apps/web/src/app/api/eco-data/route.ts:1036-1044 (consumido en apps/web/public/eco-prototype/screens.js:3146-3167)`
- `ALERTS = alertRows.map(a => ({ …, priority: 'media', triggered: 0, lastFired: '—', … }))`: los tres campos están hardcodeados, no salen de la DB. La tabla de la pestaña Reglas pinta exactamente esas columnas (`Prioridad`, `Activaciones 30d`, `Último`). En la misma pantalla, Historial (que sí lee /api/alerts/history) muestra 11 activaciones con 5 ALTA y 3 disparos para "Pico de menciones negativas · Energía" (captura alerts-desktop.png…
- *Importa porque:* Un admin que entra a Reglas concluye que ninguna regla se ha disparado nunca y que todas son de prioridad media — decide no escalar, o borra una regla que en realidad es la que más dispara. Es la pestaña donde se gestiona el sistema de alertas de una agencia de gobierno y sus tres columnas de estado son ficción. Ademá…
- *Arreglo:* Devolver los campos reales: `priority` desde `alert_rules` (o eliminar la columna si el concepto no existe en el modelo), y `triggered`/`lastFired` con un LEFT JOIN agregado a `alert_history` (COUNT en 30d y MAX(triggered_at)). Mientras no existan, no pintar la columna: mejor tres columnas menos que tres columnas falsas. Quitar el `limit(20)` o exponer el total.

**· [AL-02] El interruptor Activa/Inactiva de cada regla no persiste nada** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3085-3090 y 3151-3158`
- Comentario propio del código: "Local overrides for rule active toggle (not yet persisted to backend)". `onClick={() => setRuleActive(s => ({...s, [a.id]: !s[a.id]}))}` — no hay fetch/PATCH a /api/alerts. El switch se pone verde, la etiqueta cambia a "Activa", y al recargar vuelve al estado anterior.
- *Importa porque:* Es el control más peligroso de la pantalla: un operador silencia una regla antes de un evento público, ve la confirmación visual, y la regla sigue enviando correos; o cree haber reactivado una regla que sigue muerta. No hay toast, no hay error, no hay forma de saberlo salvo recargar.
- *Arreglo:* O se cablea (PATCH /api/alerts/:id con estado optimista + rollback + toast de error) o se deshabilita visiblemente (switch en `disabled`, tooltip "solo lectura por ahora"). No dejar un control que miente. El editor ya tiene el patrón de toast (screens.js:3187) para reutilizar.

**· [AL-03] El badge rojo "4" del rail cuenta reglas activas, no alertas sin atender, y nunca baja** · `color-semantics`

- `apps/web/public/eco-prototype/shell.js:86, 95 y 168-175`
- `const activeAlerts = (D.ALERTS||[]).filter(a => a.active).length;` → `{ key:'alerts', badge: activeAlerts, urgent: activeAlerts > 0 }`, y el badge `urgent` se pinta con `background: var(--neg)`. En todas las capturas el rail muestra "Alertas 4" en rojo junto a "Menciones 1.3K" en gris — mismo componente, dos significados (objetos de configuración vs. ítems).
- *Importa porque:* Un badge numérico rojo sobre un ítem de navegación tiene un significado universal: "hay N cosas nuevas sin atender". Aquí significa "existen 4 reglas encendidas", es decir, el estado saludable del sistema se comunica como alarma permanente. Se destruye la única señal de urgencia que tiene el producto: si el rojo siemp…
- *Arreglo:* El badge debe contar activaciones sin atender en la ventana relevante (requiere AL-22, un estado `acknowledged` en alert_history). Interinamente: badge gris con el conteo de activaciones 24h, y reservar `urgent`/`--neg` para severidad alta sin atender. Nunca derivarlo del número de reglas.

**· [AL-04] Un fallo de red se muestra como "Sin alertas disparadas en el período"** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:3340-3349 y 3097-3101`
- `.then(r => r.ok ? r.json() : { history: [] }).catch(() => setRows([]))` — un 500, un 403 de agencia no resuelta o una caída de red producen `rows = []`, y el componente renderiza el estado vacío feliz: "Sin alertas disparadas en el período." El KPI hace lo mismo: `.catch(() => {})` deja `fired24h: null` y la tarjeta se queda en '—' para siempre (visible en la captura como "ÚLTIMA ALERTA —" junto a "ACTIVACIONES · 24H 11").
- *Importa porque:* En una consola de alertas de gobierno, "no pude leer los datos" y "todo está tranquilo" son mensajes opuestos y aquí son idénticos. Es la peor clase de silencio: el usuario cierra la pestaña convencido de que no hay nada que atender.
- *Arreglo:* Tres estados distintos y distinguibles: cargando (skeleton con la forma de las tarjetas), vacío verificado ("0 activaciones entre el 21 y el 27 de julio" + CTA "Crear regla"), y error (`--neg`, texto del código HTTP, botón Reintentar). Guardar el error en el state: `.catch(e => setError(e))` en vez de tragarlo.

**· [AL-05] La severidad se inventa: CRISIS y ALERTA colapsan en "alta", NORMAL se muestra como alerta "baja", y lo desconocido se marca "media" dos veces** · `data-integrity`

- `apps/web/src/app/api/alerts/history/route.ts:16-22 y 79; apps/web/public/eco-prototype/screens.js:3363 y 3421`
- `bandToSeverity`: CRISIS→alta, ALERTA→alta, ELEVADO→media, NORMAL→baja, resto→null; luego `severity = bandToSeverity(d.band) ?? d.severity ?? 'media'`. En el SPA se repite: `const s = (r.severity==='alta'||r.severity==='baja') ? r.severity : 'media'` (3363) y `r.severity || 'media'` (3421). En la captura, 4 filas MEDIA y una tarjeta "Mezcla de severidad: Media 4" que puede estar contando huecos.
- *Importa porque:* La distinción CRISIS vs ALERTA es exactamente la que dispara el protocolo de escalamiento del cliente, y la pantalla la borra: ambas salen con el mismo badge naranja "ALTA". Peor: un evento de banda NORMAL aparece listado como una alerta (severidad baja) y un evento sin banda aparece como MEDIA, un valor que nadie cal…
- *Arreglo:* Cuatro niveles con token propio (`crisis` / `alerta` / `elevado` / `normal`), mostrar la banda cruda en la fila y el `crisisScore` junto a ella; para lo desconocido usar `pill-unknown` (ya existe en index.html:353, rayado + borde punteado) y contarlo en una cuarta barra "sin clasificar" en Mezcla de severidad. Eliminar los dos fallbacks a 'media'.

**· [AL-06] Dos tarjetas de barras idénticas con denominadores y rieles distintos: un 3 se ve más largo que un 5** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:3378 (Mezcla de severidad) vs 3391-3392 (Reglas más activas)`
- Izquierda: `width: (sev[k]/rows.length)*100%` sobre un riel `flex:1` (~660px en desktop) → Alta=5 llena el 45%. Derecha: `width: (n/ruleMax)*100%` sobre un riel fijo de 90px → la regla con 3 llena el 100%. En la captura (recorte a_cards.png) la barra del "3" es visualmente más llena que la del "5", y las dos filas tienen el mismo alto de 8px, el mismo radio y el mismo naranja.
- *Importa porque:* Están lado a lado, en la misma fila de tarjetas, con el mismo lenguaje gráfico. El ojo compara horizontalmente antes de leer los números, y la comparación es falsa dos veces: distinto denominador (total vs máximo) y distinto largo de riel (660 vs 90px). Además el ranking pinta todas las barras en `--accent` sin import…
- *Arreglo:* Un solo patrón `BarRow` con dos props explícitas: `denominator: 'total' | 'max'` y una etiqueta que lo diga ("% del total" / "vs. la más activa"), mismo ancho de riel en ambas tarjetas (mínimo 160px), y el color de la barra derivado de la severidad de la regla, no fijo en accent. Con la nueva capa de tokens (--neg #FF5470 separado de --accent #FF6A3D) la incoherencia se hará todavía más visible: rosa a la izquierda, naranja a la derech…

**· [AL-07] "Activaciones por día" no es un eje temporal, y en la captura es una caja vacía de 110px bajo el rótulo "11 eventos en el período"** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:3358 y 3403-3412`
- `days = Object.keys(byDay).sort()` — solo los días QUE TIENEN eventos — y `gridTemplateColumns: repeat(days.length, 1fr)`: los días sin activaciones no existen, así que dos alertas separadas por tres semanas se dibujan como dos barras contiguas del mismo ancho. La altura es `(byDay[d]/max)*100%`, sin eje Y ni valores, y las únicas etiquetas son `days[0]` y `days[days.length-1]` a 9px. En la captura desktop y móvil el contenedor sale co…
- *Importa porque:* Es la única vista temporal de la pantalla y no se puede leer: no distingue un día con 1 activación de un día con 6 (el máximo siempre llena el 100%), no muestra los huecos —que en alertas son la información— y en el peor caso pinta nada mientras el texto promete 11 eventos. Un director que mira esa caja vacía concluye…
- *Arreglo:* Generar la serie de días completa del período (incluyendo ceros) con el mismo helper que usa el resto del producto; añadir eje Y con 2-3 marcas y el valor sobre la barra máxima; etiquetas de fecha cada N días, no solo los extremos; y un estado vacío explícito cuando `days.length === 0` en lugar de un contenedor de 110px en blanco. Si el conteo del subtítulo no se puede reconciliar con las barras, no mostrar el subtítulo.

**· [AL-08] El umbral de crisis se presenta de tres formas distintas en la misma pantalla (40% / 0.40 / "Umbral 0.40") y el editor no valida rango por métrica** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2906 vs 3211 y 3307-3310; nombre de regla visible en la captura alerts-desktop.png`
- CrisisAlertsTab muestra `${Math.round(crisisMin*100)}%` → "40%". El editor pide el mismo número como `0.40` en un `<input type=number step="any">` sin unidad ni min/max. El historial lo muestra dentro del nombre de la regla: "Crisis · Umbral 0.40". Las métricas del editor mezclan escalas sin decirlo: Crisis 0–1, BHI 0–1, Polarización 0–100, velocidad en σ (screens.js:3211-3215).
- *Importa porque:* Quien vea "40%" en la tarjeta y luego escriba 40 en el editor crea una regla de Crisis Score ≥ 40 que no puede dispararse nunca — una regla muerta que el usuario cree activa. Nada en el formulario lo impide ni lo advierte, y el `hint` que explicaría la escala está a 10px en `--text-3`.
- *Arreglo:* Una sola representación por métrica en todo el producto (recomendado: 0–100 con sufijo visible, convirtiendo en la frontera de la API). En el editor: sufijo de unidad dentro del input, `min`/`max`/`step` derivados de METRIC_DEFAULTS, y validación en submit con el mensaje pegado al campo. Subir el hint a 11-12px y a `--text-2`.

**· [AL-09] Las dos pestañas de configuración son otro producto: tema AntD claro "Mar Caribe" dentro del shell mando dark** · `consistency`

- `apps/web/src/theme/eco-theme.ts:5-37; iframes en apps/web/public/eco-prototype/screens.js:2938-2949 y 3060-3071`
- `ecoTheme`: `colorPrimary:'#0A7EA4'` (turquesa), `colorBgContainer:'#FFFFFF'`, `colorText:'#0E1E2C'`, `fontFamily:'-apple-system…'`, `borderRadius: 8/14`, `controlHeight: 36`. El shell mando dark usa `--canvas #0E1620`, accent #FF6A3D, IBM Plex Sans, radio 6px en `.card` y controles de 26-31px. `layoutBg` se pone `transparent` cuando `embed=1` (settings/alerts/page.tsx:114) pero las `Card` siguen siendo #FFFFFF por token, así que queda…
- *Importa porque:* Son las dos superficies donde el cliente configura el umbral que dispara todo el sistema y donde escribe los destinatarios de los correos: exactamente donde no puede parecer un prototipo cosido. Además reenseña el color de acción: el usuario aprende "naranja = ejecutar" en la SPA y dentro del iframe el botón Guardar e…
- *Arreglo:* Dos caminos, en este orden de preferencia: (a) portar los dos formularios a componentes de la SPA (son ~10 campos cada uno) y borrar los iframes; (b) si se mantiene AntD, crear un `ecoThemeDark` con `algorithm: theme.darkAlgorithm` alimentado por los mismos tokens (--canvas, --text, --accent, --hairline, radios, controlHeight 32) y aplicarlo cuando `embed=1`. En ambos casos, capturar estas pestañas en la próxima ronda de screenshots.

**· [AL-10] El formulario embebido edita siempre la configuración de DDEC, aunque el shell esté en otra agencia — y los KPIs de arriba muestran los de la agencia correcta** · `data-integrity`

- `apps/web/src/app/settings/alerts/page.tsx:55 y 67 (idem reports/page.tsx:100 y 115); iframe sin parámetro de agencia en screens.js:2940 y 3062`
- `useState<string>('ddecpr')` y, cuando carga la lista de agencias, `const ddec = agencies.find(a => a.slug==='ddecpr'); if (ddec) setSelectedAgencySlug(ddec.slug)` — fuerza DDEC otra vez. El `src` del iframe es `/settings/alerts?embed=1`, sin agencia. En cambio CrisisAlertsTab lee `localStorage.getItem('eco.agency')` (screens.js:2868) para los cuatro KPIs de la misma pestaña.
- *Importa porque:* Con el shell en AAA o JGO, el usuario ve arriba el umbral y los destinatarios de AAA y justo debajo un formulario que dice "Agencia: DDEC" — y si guarda, cambia el umbral de crisis de DDEC creyendo que ajusta AAA. Es una escritura cruzada entre inquilinos disparada por un desajuste de diseño, no por un permiso.
- *Arreglo:* Pasar la agencia en el src (`/settings/alerts?embed=1&agency=${ag}`), leerla en la página y no re-forzar ddecpr cuando llega la lista; ocultar la Card "Agencia" cuando `embed=1` (el shell ya tiene un selector global, tener dos es la causa del desajuste); y remontar el iframe con `key={agency}` para que un cambio de agencia recargue el formulario.

**· [AL-11] El editor descarta correos inválidos en silencio y confirma "Regla creada."** · `copy`

- `apps/web/public/eco-prototype/screens.js:3235 y 3183`
- `const emails = emailsText.split(/[\s,]+/).map(s=>s.trim()).filter(s => /.+@.+\..+/.test(s));` — todo lo que no pasa el regex desaparece sin mensaje. "juan@agencia" (sin TLD), un punto y coma en vez de coma, o un espacio mal puesto reducen la lista silenciosamente. Después `onSaved` dispara el toast "Regla creada." y cambia a la pestaña Reglas.
- *Importa porque:* El único propósito de una regla de alerta es notificar a alguien. Guardar una regla con menos destinatarios de los que el usuario escribió, y confirmarla como exitosa, produce una alerta que en el momento crítico no le llega al director. Nadie lo descubre hasta que la crisis pasa.
- *Arreglo:* Validar al perder foco: pintar los correos aceptados como chips y los rechazados en `--neg` con el motivo; bloquear el guardado si hay entradas no resueltas; y no permitir crear una regla con 0 destinatarios sin una confirmación explícita. El toast de éxito debe decir a cuántos destinatarios se notificará ("Regla creada · notifica a 3 correos").

**· [AL-12] Después de crear una regla, la lista a la que te lleva no la contiene** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3183 y 3146 (con `const D = window.ECO_DATA` en screens.js:4)`
- `onSaved={() => { setEditorOpen(false); fireToast('ok','Regla creada.'); setTab('rules'); }}`. La pestaña Reglas itera `D.ALERTS`, que es el snapshot de arranque de `window.ECO_DATA`; nada refetchea eco-data tras el POST. La regla nueva no aparece hasta recargar la página.
- *Importa porque:* El toast dice que se creó, la pantalla a la que te empuja dice que no existe. El usuario asume que falló y la crea otra vez — duplicando reglas y duplicando correos a los destinatarios en el próximo ciclo.
- *Arreglo:* Que la pestaña Reglas tenga su propio fetch a /api/alerts (como Historial) e invalidarlo tras el POST; o insertar optimistamente la regla devuelta por el POST en el state. Mientras eso no exista, no navegar a Reglas: quedarse en el editor con un estado de éxito que muestre lo guardado.

### P1 (11)

**· [AL-13] Tres promesas distintas de latencia de evaluación en la misma pantalla, y ninguna coincide con el cron real** · `copy`

- `apps/web/public/eco-prototype/screens.js:2900, 2932 y 3321; cron real en infra/lib/workers-stack.ts:261`
- CrisisAlertsTab: sub del KPI "evalúa cada 10 min" (2900) y sub de la tarjeta "Los cambios aplican desde el siguiente ciclo (≤ 10 min)" (2932). AlertRuleEditor, en la misma pantalla: "Se evalúa sobre el snapshot diario de la agencia (cron de métricas)" (3321). La página AntD embebida repite "cada 10 min" en un `Alert` que además está oculto cuando `embed=1`. El cron: `events.Schedule.rate(cdk.Duration.minutes(5))`.
- *Importa porque:* La latencia es la propiedad que define si un producto de alertas sirve. Aquí el usuario recibe dos respuestas contradictorias con un factor de ~288x entre ellas (10 minutos vs. diario), y la que aparece justo donde crea la regla es la pesimista y falsa: quien la lea decidirá que no puede confiar en las reglas para nad…
- *Arreglo:* Un solo string derivado de una constante compartida (`EVAL_INTERVAL_MIN = 5`) usado en los tres lugares y en el `Alert` de la página embebida; mostrar la latencia real, no la del peor caso ni la aspiracional, y mantener visible la explicación del mecanismo también en modo embed.

**· [AL-14] En una pantalla de alertas no hay una sola alerta above the fold** · `hierarchy`

- `capturas alerts-desktop-fold.png / alerts-tablet-fold.png; encabezado en shell.js (fila propia para el botón de tema) + screens.js:3117-3139`
- En 1440×~830 CSS px se ve: eyebrow + "DATOS AL CIERRE DE AYER" + título + una fila entera con un único botón de sol (~190px, F11 del brief), cuatro KPIs que cuentan objetos de configuración (5 reglas, 4 activas, 11 activaciones, — última), la barra de pestañas, y dos tarjetas derivadas. "HISTORIAL DETALLADO" empieza en y≈1080 CSS px, después de una gráfica vacía de ~200px. En móvil el primer badge ALTA aparece a ~1350 CSS px de scroll.
- *Importa porque:* La primera pregunta del usuario es "¿qué se disparó y qué tan grave?" y la página responde "tienes 5 reglas configuradas". El artefacto más grave del período (5 activaciones ALTA) es lo último y lo único sin acciones. La densidad además es baja: 4 tarjetas de 150px para cuatro enteros de un dígito.
- *Arreglo:* Invertir el orden: (1) la activación más reciente/grave como banner con severidad, hora, regla y titular editorial; (2) la lista de activaciones; (3) las dos tarjetas analíticas; (4) los conteos de configuración, colapsados en una sola línea de resumen ("4 de 5 reglas activas · última evaluación hace 3 min"). Reducir el encabezado moviendo el botón de tema al rail y eliminando su fila propia.

**· [AL-15] La tabla de historial no tiene encabezados y su única cifra (menciones) es 0 estructuralmente para las reglas de métrica** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3415-3425 (vs. la tabla de Reglas que sí tiene encabezados en 3143-3145); API en apps/web/src/app/api/alerts/history/route.ts:84…`
- La tarjeta "Historial detallado" arranca directamente con filas de grid `120px 140px 1fr 90px`, sin fila de títulos. La última columna es `r.mentionIds?.length || 0` alineada a la derecha, sin rótulo — en la captura son once ceros en columna. Las alertas de crisis y de métrica no llevan menciones asociadas, así que ese 0 es su valor normal. La API devuelve además `headline` (el titular editorial de la alerta), `band`, `crisisScore`, `s…
- *Importa porque:* El lector ve una columna de ceros pegada a badges ALTA y concluye lo contrario de lo que pasó: que las alertas no tienen evidencia detrás, o que se dispararon en falso. Y lo único que explicaría el evento —el titular editorial que la propia API ya trae— no se muestra en ninguna parte de la pantalla.
- *Arreglo:* Añadir fila de encabezados como en la pestaña Reglas; usar `mentionCount` de la API en vez de recontar `mentionIds`; mostrar '—' (no 0) cuando la regla es de métrica y una etiqueta de columna explícita ("Menciones"); y reemplazar el nombre de la regla como contenido principal de la fila por `headline` con el nombre de la regla como metadato secundario, más `crisisScore`/`band` cuando existan.

**· [AL-16] Móvil: las dos columnas que dicen qué pasó y cuántas menciones quedan fuera del viewport; el ancho visible se lo llevan una columna de guiones y un badge estirado** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:3419 (`gridTemplateColumns:'120px 140px 1fr 90px', minWidth:560`) dentro de `.scroll-x``
- probe-report.json, alerts/mobile: 11 entradas en `overflowing`, todas de esta tabla — la fila llega a `right: 573` con `vw: 390`; `span «Pico de menciones negativas · Energía»` ocupa 313→455 y `span.num «0»` 467→557, ambos fuera de pantalla. En la captura alerts-mobile.png solo se ven el guion, el badge y un jirón del nombre cortado a media palabra ("Pico de mer / negativas · E"). `hScroll.overflow = 0` (el scroll está bien contenido),…
- *Importa porque:* En móvil —el dispositivo con el que un director revisa alertas fuera de la oficina— la pantalla de alertas muestra, por defecto, cero información útil por fila: la fecha (guiones), el badge, y nada más. Hay que hacer scroll horizontal dentro de cada tarjeta para leer qué se disparó, y no hay ninguna señal de que ese s…
- *Arreglo:* Por debajo de 700px, reemplazar la grilla por una tarjeta por activación: línea 1 = badge de severidad + hora relativa; línea 2 = titular/regla en 13px a dos líneas; línea 3 = metadatos (menciones, banda). Eso elimina el `minWidth:560` y el scroller anidado. Si se mantiene la tabla, la columna de fecha debe ser la primera en colapsar (hora relativa en 60px) y el nombre debe ser la columna prioritaria.

**· [AL-17] Los badges de severidad se estiran a 140px y parecen campos de texto: falta el `justifySelf:'start'` que sí tiene la tabla de Reglas** · `consistency`

- `apps/web/public/eco-prototype/screens.js:3421 vs 3149`
- En Reglas: `<span className="pill …" style={{ justifySelf:'start' }}>`. En Historial: el mismo `.pill` sin `justifySelf`, y como `.pill` es `display:inline-flex` (index.html:321-322) el grid item se estira a todo el ancho de la columna de 140px. En la captura, "ALTA", "MEDIA" y "BAJA" son slabs de 140px con el texto pegado a la izquierda; el de "BAJA" (`pill-neu`, con borde) se lee como un campo de formulario deshabilitado o un botón.
- *Importa porque:* Un badge estirado deja de leerse como etiqueta y empieza a leerse como control: el usuario intenta hacer clic para filtrar o editar. Y al perder su ancho intrínseco, deja de funcionar como marca visual escaneable — que es todo su propósito en una lista de triage.
- *Arreglo:* `justifySelf:'start'` en la fila del historial (arreglo de una línea) y, mejor, mover la regla al CSS: `.pill { justify-self: start; align-self: center; }` en index.html para que ningún consumidor futuro tenga que recordarlo.

**· [AL-18] La barra de pestañas mezcla 2 vistas, 2 destinos de configuración y una acción primaria en la misma fila — y en móvil el envoltorio los revuelve** · `consistency`

- `apps/web/public/eco-prototype/screens.js:3124-3139`
- Cuatro `.chip` seguidos, separados por un divisor de 1px y la palabra "CONFIGURACIÓN" a 10px `--text-3` (contraste 2.89 según el probe), luego `<div style={{flex:1}}/>` y el botón `.btn-primary` "Nueva regla". El chip activo usa `--accent` de fondo, el mismo naranja del botón primario. En móvil (captura m_tabs) la fila se parte: "Reportes por correo" cae en la segunda línea junto a "Nueva regla", y "CONFIGURACIÓN" queda huérfana entre…
- *Importa porque:* Nada distingue "ver historial" de "abrir un formulario de configuración": los cuatro chips son idénticos y el único agrupador es una palabra gris ilegible. Y como el estado activo y la acción primaria comparten el mismo naranja, el ojo aterriza en "Nueva regla" en una pantalla cuyo trabajo es leer alertas, no crearlas.
- *Arreglo:* Separar en dos niveles: pestañas reales (Historial | Reglas) con subrayado como estado activo —no relleno de acento— y un menú/botón "Configuración" con icono de engranaje que abra crisis y reportes en un panel; el CTA en su propia zona derecha con `flex-shrink:0` y `order` explícito para que en móvil quede en su propia fila completa. Reservar el relleno de acento exclusivamente para la acción primaria.

**· [AL-19] Dos ventanas temporales bajo un solo rótulo: "DATOS AL CIERRE DE AYER" en el encabezado, ventana rolante en la API, y un KPI de 24h fijo junto a totales del período** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3097 y 3120; apps/web/src/app/api/alerts/history/route.ts:47-50`
- El KPI llama `/api/alerts/history?period=1D` con el período fijo, mientras las tarjetas usan el período seleccionado (7D en la captura). La API calcula `since = new Date(); since.setDate(since.getDate()-days)` — rolling desde ahora, no días cerrados. En la captura conviven "ACTIVACIONES · 24H 11", "11 activaciones" y "11 eventos en el período": tres rótulos, tres ventanas nominales, el mismo número.
- *Importa porque:* Es el patrón F9 del brief repetido aquí: el lector no puede saber si 11 es de un día o de una semana, y el encabezado promete un criterio (cierre de ayer) que esta pantalla no cumple. Con un cliente que reporta cifras a prensa, esto se convierte en una cifra mal citada.
- *Arreglo:* Una sola ventana por pantalla, resuelta en un helper compartido, y rótulos que la nombren con fechas explícitas ("21–27 jul"). Si se quiere un KPI de 24h, decir "últimas 24 h (rolling)" y diferenciarlo tipográficamente de los totales del período. Alinear la API a días cerrados si el encabezado global lo promete.

**· [AL-20] Los acentos de los cuatro KPIs no codifican nada, el chip del icono siempre es naranja, y el '—' de 30px se lee como una barra de censura** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:3118-3121 y 90 (KpiCard)`
- Los cuatro KPIs pasan `accent` distintos sin criterio: `--text-2`, `--accent`, `--neg`, `--pos`. "Última alerta" recibe verde de positivo; "Activaciones · 24h" recibe rojo. Y en KpiCard el fondo del chip del icono es siempre `var(--accent-fill)`, sin importar el accent: en el recorte a_kpi4.png se ve un glifo de pulso VERDE sobre un cuadrado naranja. En la captura el valor de "Última alerta" es un `—` a 30px en fuente display, que se p…
- *Importa porque:* Que una alerta reciente sea "verde/positiva" y que el número de reglas encendidas sea "rojo/negativo" invierte el significado de la paleta en la pantalla donde el color es la señal de triage. El chip naranja fijo confirma que el color es decorativo, no semántico. Y un guion de 30px no comunica "sin datos": comunica "d…
- *Arreglo:* Regla explícita: los KPIs de configuración van neutros (`--text-2`), y `--neg`/`--warn` se reservan para valores que superan un umbral. Que el chip del icono derive su fondo del `accent` recibido (`color-mix(in oklab, ${accent} 14%, transparent)`). Y un estado 'sin dato' propio en KpiCard: texto 13px `--text-3` ("sin activaciones aún") en lugar del em dash a tamaño de titular.

**· [AL-21] Afordancias muertas en la pestaña Reglas: el menú "…" no es un botón y la celda de canales queda en blanco justo cuando la regla no notifica a nadie** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3159-3166`
- `<Icons.More size={14} color="var(--text-3)" />` — un SVG suelto: sin `<button>`, sin onClick, sin foco, sin menú detrás. Los canales son `<span title={c}>` con icono solo (sin texto alternativo visible), y cuando `a.channels` está vacío la celda queda vacía; en la API los canales se derivan de `notifyEmails` (eco-data/route.ts:1043), así que "regla activa sin destinatarios" —el estado más peligroso de la configuración— se dibuja exact…
- *Importa porque:* El "…" al final de cada fila es la promesa universal de "aquí edito/borro/silencio esta regla"; no hacer nada al pulsarlo es la clase de detalle que le dice al cliente que la herramienta es una demo. Y no señalar una regla sin destinatarios es un fallo operativo: se disparará y no llegará a nadie.
- *Arreglo:* O se implementa el menú (editar / duplicar / silenciar / borrar) o se elimina el icono. Para los canales: chip textual ("correo · 3") en vez de icono solo, y cuando no hay destinatarios un `pill-warn` explícito "sin destinatarios" en la fila, más un contador en el KPI de reglas.

**· [AL-22] No existe ciclo de vida de la alerta: sin acciones por fila, sin filtros, sin drill-down (el modal ya está cableado y nunca se usa) y con un tope de 40 filas silencioso** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3082 y 3178 (`slice`/`MentionsSliceModal` nunca disparados), 3172 (`onMentionClick` pasado a AlertsHistory y sin usar), 3418 (`r…`
- `const [slice, setSlice] = useState(null)` y `{slice && <MentionsSliceModal …>}` existen en AlertsScreen, pero `setSlice` no se llama en ninguna parte de la pantalla. `AlertsHistory({ onMentionClick })` recibe el handler y no lo usa: ninguna fila tiene onClick, cursor ni hover. La API trae hasta 200 filas (route.ts:30), las tarjetas cuentan sobre todas, y la tabla pinta 40 sin ningún "mostrando 40 de N". Tampoco hay filtro por severida…
- *Importa porque:* Una consola de alertas sin "atendida/descartada" no puede responder la pregunta de gestión ("¿qué queda pendiente?"), y es la razón de fondo por la que el badge del rail no puede significar nada (AL-03). Sin drill-down, cada activación es un callejón sin salida: el usuario ve que algo pasó y no puede ver qué se dijo.…
- *Arreglo:* Añadir `acknowledged_at`/`acknowledged_by` en alert_history y una acción por fila ("Marcar atendida") con filtro "solo pendientes" por defecto; hacer las filas clickeables abriendo el MentionsSliceModal ya cableado con `mentionIds` (o el editorial cuando la regla es de métrica); hacer clickeables las barras de las dos tarjetas para filtrar la tabla; y mostrar "40 de N · ver todas" cuando se trunque.

**· [AL-23] Los iframes tienen altura fija (1100/1200px) sin negociación: hueco muerto en escritorio y scroll anidado en móvil** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:2944 y 3066`
- `height: 1100` en la pestaña de crisis y `height: 1200` en la de reportes, `border:none`, sin postMessage de altura. El contenido interior es AntD con `Space size={16}` y una tabla de histórico de 14 filas, cuyo alto depende del ancho: a 390px los campos pasan a una columna y la página crece muy por encima de 1100px; a 1440px con configuración vacía sobra medio contenedor.
- *Importa porque:* En móvil produce lo único que la revisión responsive había eliminado del producto: un scroller anidado dentro del scroll de la página, con el botón "Guardar cambios" atrapado dentro. En escritorio deja una tarjeta con 300-400px vacíos que parece un error de carga.
- *Arreglo:* Que la página embebida publique su alto (`ResizeObserver` + `postMessage`) y que el contenedor lo aplique; o, preferible, portar los formularios a la SPA (AL-09) y con eso desaparece el problema. Interinamente, `min-height` en vez de `height` y un enlace "abrir en pantalla completa" por si el iframe queda corto.

### P2 (4)

**· [AL-24] "Baja" se pinta con dos grises distintos en widgets adyacentes, y el gris que usa es el de texto terciario** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:3374 (`['baja','var(--text-3)']`) vs 3421 (`pill-neu`, definido en index.html:339-348)`
- La barra de "Baja" en Mezcla de severidad usa `--text-3` (el mismo gris del texto deshabilitado); el badge "BAJA" de la tabla usa `pill-neu`, que en modo oscuro es `color-mix(--text-2 22%)` con borde y texto `--text`. En la captura son dos grises visiblemente distintos para el mismo nivel, a 400px de distancia.
- *Importa porque:* Un mismo valor de una escala ordinal debe tener un solo color en toda la pantalla, y ese color no debería ser el gris de "apagado": "baja" es una clasificación, no una ausencia. Es el mismo problema que el comentario de `pill-neu` en el CSS ya intentó resolver para los sentimientos.
- *Arreglo:* Tokenizar la escala de severidad (`--sev-crisis`, `--sev-alta`, `--sev-media`, `--sev-baja`) y consumirla en barras, badges y bordes. `--sev-baja` debe ser un azul/gris con identidad propia (p. ej. derivado de `--info`), no `--text-3`.

**· [AL-25] Estados de carga y vacío como frase suelta: salto de layout de ~100px a ~900px y ningún camino de salida** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:3345-3350`
- `Cargando historial…` y `Sin alertas disparadas en el período.` son la misma tarjeta de `padding:40, textAlign:center, fontSize:13, color:--text-3`. Al resolver, se sustituyen por ~900px de tarjetas: la página salta. El vacío no ofrece ninguna acción, aunque el CTA "Nueva regla" está justo arriba y la causa más común del vacío es no tener reglas.
- *Importa porque:* El salto rompe el scroll si el usuario ya empezó a moverse, y el vacío deja al usuario sin siguiente paso en la pantalla donde el siguiente paso es obvio. Los cuatro KPIs además muestran '—' hasta que resuelve el fetch, así que el primer paint de la pantalla comunica "no hay nada".
- *Arreglo:* Skeletons con la geometría final (dos tarjetas de barras + bloque de gráfica + 6 filas) para que la altura no cambie; estado vacío con fechas explícitas del período, una línea de causa probable y el CTA "Crear regla"; y en los KPIs, skeleton en vez de '—' mientras `fired24h === null`.

**· [AL-26] 15 instancias bajo el mínimo WCAG y 30 objetivos por debajo de 44px; lo que queda tras la capa de tokens es local de esta pantalla** · `contrast`

- `probe-report.json (key="alerts", desktop y mobile); apps/web/public/eco-prototype/screens.js:3130 y index.html:277`
- Del probe: `button.chip.active «Historial»` blanco sobre naranja 2.85:1, `button.btn.btn-primary «Nueva regla»` 2.85:1, chips de período 2.78:1, `span «CONFIGURACIÓN»` 2.89:1 a 10px/700, y tres `card-hd-sub` ("11 activaciones", "Top 5 por activaciones", "11 eventos en el período") a 2.65:1 — justo los rótulos que dan contexto a las cifras. Objetivos: chips a 26px de alto en escritorio y 34px en móvil (`index.html:277`), `select` de age…
- *Importa porque:* Los tres subtítulos afectados son los que dicen sobre qué universo están calculadas las barras; ilegibles, las barras quedan sin denominador declarado (ver AL-06). Y el chip activo es el que indica en qué pestaña estás.
- *Arreglo:* Re-correr el probe sobre la capa de tokens y verificar. Lo que no arreglan los tokens y es propio de esta pantalla: subir el rótulo "CONFIGURACIÓN" a 11px/`--text-2` (o eliminarlo al reestructurar las pestañas, AL-18) y llevar `.chip` a 32px en escritorio / 44px en móvil, con el `select` de agencia al mismo alto que los demás controles.

**· [AL-27] Arquitectura de información circular: "Reportes por correo" no es una alerta, y Configuración remite a Alertas** · `consistency`

- `apps/web/public/eco-prototype/screens.js:3132 y 3176 (tab reports dentro de Alertas) vs screens.js:3511 y 3516 (TemplatesAdmin: "Destinatarios y hora en Alertas → Report…`
- Dentro de Alertas hay un grupo rotulado "CONFIGURACIÓN" con dos pestañas, mientras el rail tiene su propio ítem "Configuración" bajo la sección "SISTEMA". Y desde Configuración → Plantillas de correo, dos tarjetas mandan al usuario de vuelta a "Alertas → Reportes por correo" y "Alertas → Alertas de crisis".
- *Importa porque:* Dos destinos distintos llamados "Configuración" en la misma interfaz, y el reporte diario/semanal —que no es un evento sino una suscripción programada— vive bajo Alertas por razones de implementación. El usuario aprende la app por prueba y error en vez de por modelo mental.
- *Arreglo:* Mover "Reportes por correo" a Configuración (junto a Plantillas, que es su vecino natural) y dejar en Alertas solo lo que dispara por evento: historial, reglas y el umbral de crisis. Con eso el grupo "CONFIGURACIÓN" de la barra de pestañas se reduce a una sola entrada y el rótulo duplicado desaparece.


## Configuración / Usuarios y roles

*25 hallazgos*

Esta es la pantalla con más autoridad del producto —decide quién ve qué de una agencia de gobierno— y es la que menos se toma en serio a sí misma. El diagnóstico de fondo no es cosmético: la pantalla **afirma cosas que el sistema no sabe** (un log de actividad con IPs inventadas idéntico para todo usuario, un estado "Invitado" que en realidad significa "nunca inició sesión", un contador de "1 invitación pendiente" que nadie rastrea) y **confirma acciones que no verificó** (ninguna mutación revisa `res.ok`, así que el toast "Usuario guardado" sale igual con 500 que con 201; y `GET /api/users` convierte un fallo de DB en `{users:[]}` con HTTP 200, que la tabla pinta como "Sin resultados · ajusta los filtros"). El defecto más caro es de una línea: el drawer de invitación arranca con `role:'analista'`, clave que no existe en `ROLES`, así que no se marca ningún radio y tanto el cliente como la API coercen a `viewer` — quien invita creyendo dar "Analista" crea un "Solo lectura". En lo visual, el presupuesto de jerarquía y de color está invertido: 201 px de documentación estática de roles se interponen entre el filtro y la tabla que filtra, el primer usuario aparece a 620 px de 900 en escritorio y a 1155 px en móvil, el único dato coloreado es `Estado` (el menos consecuente) mientras `Rol` —el campo que otorga poder— es monocromo, y las dos filas que requieren acción (Invitado, Suspendido) quedan al final porque la API ordena por `createdAt desc`. Todo se pinta con estilos inline, lo que deja a esta pantalla fuera de cada corrección del sistema: no usa `.input` (sin anillo de foc…

### P0 (5)

**· [SET-01] El fallo de la API se pinta como "no hay usuarios · ajusta los filtros"** · `data-integrity`

- `apps/web/src/app/api/users/route.ts:74-77 + apps/web/public/eco-prototype/screens.js:3565, 3570, 3600-3608, 3744, 3787-3791`
- `GET /api/users` termina en `catch { return NextResponse.json({ users: [] }) }` — HTTP 200 con lista vacía. En el cliente, `const [loading, setLoading] = useState(true)` (3565) y `const [error, setError] = useState(null)` (3570) se setean pero NO aparecen en el JSX en ninguna parte (grep sobre las líneas 3563-3798: 2 coincidencias, ambas declaraciones). El único estado vacío es el de 3787: «Sin resultados · ajusta los filtros o limpiar…
- *Importa porque:* Escenario: cae la conexión a RDS. El administrador abre Configuración y lee «0 usuarios · 0 activos», «0 resultados», «Sin resultados · ajusta los filtros». Concluye una de dos cosas falsas: que la plataforma no tiene usuarios, o que sus propios filtros están mal. Con esa lectura puede volver a invitar gente que ya ex…
- *Arreglo:* Tres cambios acoplados: (1) en la ruta, devolver 500 con `{error}` en vez de `{users:[]}` — el enmascaramiento es el origen; (2) en UsersAdmin, pintar `loading` como 5 filas skeleton con la misma altura de fila (evita el salto de layout) y `error` como una tarjeta con `--neg`, el mensaje del backend y un botón «Reintentar» que llame a `refresh()`; (3) separar los dos vacíos: «Sin resultados para estos filtros» (con limpiar filtros) sól…

**· [SET-02] Invitar sin tocar el rol crea un "Solo lectura" aunque el formulario diga Analista** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3696 (default `role:'analista'`), 3598 (`roleToApi`), 3893-3903 (radios), apps/web/src/app/api/users/route.ts:97`
- El CTA abre el drawer con `user: { …, role: 'analista', … }`. Las claves de `ROLES` (3542-3547) son `admin|editor|analyst|viewer`: `'analista'` no es ninguna. Consecuencia doble: en el drawer `selected = form.role === r.k` (3894) es false para las cuatro tarjetas → **ningún radio queda marcado**, y `roleToApi('analista')` (3598) cae al fallback `'viewer'`; la API repite la coerción (`isRole(body.role) ? body.role : 'viewer'`).
- *Importa porque:* Un administrador abre «Invitar usuario», escribe nombre y correo, ve el botón primario habilitado y pulsa «Enviar invitación». La plataforma crea un usuario **Solo lectura**. El operador no recibe ninguna señal: no hubo error, y la etiqueta que él leyó mentalmente en el default («analista») coincide con un rol real de…
- *Arreglo:* Cambiar el default a `role: 'analyst'` (clave válida) y, sobre todo, cerrar la clase de bug: (a) que el botón primario esté deshabilitado mientras `!ROLES.some(r => r.k === form.role)`, con el texto «Selecciona un rol» debajo; (b) eliminar el fallback silencioso `roleToApi` — si el rol no es válido, no enviar y mostrar error; (c) en la API, responder 400 «role inválido» en vez de degradar a `viewer` (route.ts:97), para que un cliente r…

**· [SET-03] «Usuario guardado» se muestra también cuando la API rechazó el cambio** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3624-3663 (saveUser), 3665-3681 (deleteUser)`
- `await fetch(...)` sin comprobar `r.ok`, y acto seguido `setDrawer(null); refresh(); ecoToast('ok','Usuario guardado')`. `fetch` sólo rechaza por error de red, así que 400/403/404/500 pasan por la rama de éxito. Rutas que devuelven esos códigos: correo duplicado → 500 «Failed to create user» (route.ts:137-140), «Agency not resolved» → 403 (route.ts:92), fuera de alcance → 403/404 (users/[id]/route.ts:37, 56). `deleteUser` es igual: toa…
- *Importa porque:* Escenario real: el admin invita a alguien que ya existe. La API responde 500, el drawer se cierra, sale el toast verde «Usuario guardado» y la lista se recarga **sin** la persona. El operador ya recibió la confirmación, así que no vuelve a intentarlo: asume que el correo salió y espera. Lo mismo al cambiar un rol: la…
- *Arreglo:* En ambas funciones: `const r = await fetch(...); if (!r.ok) { const j = await r.json().catch(()=>({})); throw new Error(j.error || ('HTTP '+r.status)); }`. Mantener el drawer ABIERTO en caso de error, con el mensaje inline junto al botón (no sólo un toast que se va), y dejar el botón en estado `saving` (`disabled` + «Guardando…») mientras la promesa está en vuelo — hoy se puede pulsar dos veces y crear dos filas.

**· [SET-04] «Actividad reciente» es un registro inventado, idéntico para todos los usuarios, con IPs falsas** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3952-3970`
- Array literal dentro del render: `{ ts:'hace 5 min', a:'Inició sesión', ip:'10.24.1.18' }`, `'Exportó reporte semanal'`, `'Editó regla de alerta #R-12'`, `'Cambió rol a analista'`. No depende de `form` ni de ningún fetch: se pinta igual para cualquier fila que se abra, incluidos usuarios suspendidos o que nunca entraron. Choca de frente con el dato real de la propia fila: Javier Domenech muestra «Última actividad 06/17/2026» en la tabl…
- *Importa porque:* Un registro de actividad con marcas de tiempo, acciones y direcciones IP tiene forma de bitácora de auditoría; es exactamente el artefacto que un cliente de gobierno cita en una investigación interna o ante una queja de acceso indebido. Aquí es decorado. En el momento en que el cliente abra dos usuarios distintos y ve…
- *Arreglo:* Quitar el bloque hoy mismo. Si hay que dejar el hueco, poner un estado honesto («El historial por usuario no está disponible todavía») o, mejor, sustituirlo por los dos datos que el backend ya tiene: `lastLogin` y `createdAt` (route.ts:71-72) presentados como «Último acceso · 27 jul 2026, 6:00 AM (AST)» y «Invitado el · …». Cuando exista bitácora real, alimentarla de un endpoint y no mostrar nada mientras carga.

**· [SET-05] «Invitado» y «1 invitación pendiente» describen un estado que el sistema no rastrea; la invitación pudo no haberse enviado nunca** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3592, 3693, 3617-3622, 3848-3854, 3635 + apps/web/src/app/api/users/route.ts:114-118`
- `status: u.isActive ? (u.lastLogin ? 'activo' : 'invitado') : 'suspendido'` (3592): «Invitado» es literalmente «activo y nunca inició sesión». La cabecera lo convierte en un hecho contable: «5 usuarios · 3 activos · 1 invitación pendiente · 1 suspendidos» (3693, visible en las 4 capturas). Además, en la API el aprovisionamiento en Cognito es best-effort declarado —«el invitar nunca falla en duro»— y si falla se inserta la fila con `cog…
- *Importa porque:* Tres lecturas falsas encadenadas. (1) Un usuario cuyo correo de invitación jamás salió (fallo de Cognito/SES) se ve idéntico a uno invitado ayer que aún no entra: ambos dicen «Invitado». El admin no tiene forma de saber que debe reenviar, y la queja llega como «el código de registro no funciona». (2) Un usuario que ll…
- *Arreglo:* Modelar el estado en vez de inferirlo: columna `invited_at` / `invite_sent` (y registrar si `provisionCognitoUser` devolvió `null`) y derivar cuatro estados explícitos: «Activo», «Invitado · enviado el X», «Invitación no enviada» (en `--warn`, con acción «Reenviar invitación») y «Suspendido». Mientras no exista ese campo: renombrar la etiqueta a «Sin primer acceso» y el contador a «1 sin primer acceso» (que es lo que el dato sostiene),…

### P1 (15)

**· [SET-06] La documentación estática de roles se interpone entre el filtro y la tabla que filtra, y su único dato dinámico renderiza vacío** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:3722-3740 (tarjeta), 3729 (`{r.count}` inexistente en ROLES 3542-3547), 3724 (ecoCols sin argumento de tablet), 3726 (divisores…`
- Orden vertical real (captura settings-desktop, 1440×900): tarjeta con título+CTA+barra de filtros (158→284 px CSS), tarjeta «ROLES DISPONIBLES» (301→502 px = 201 px), tarjeta «USUARIOS» con la cabecera y las filas (517→887). El feedback del filtro («5 resultados», screens.js:3744) queda ~230 px por debajo del input que lo produce. La primera fila de datos empieza a 620 px de un viewport de 900: el 69% del alto se gasta antes del primer…
- *Importa porque:* El usuario que entra aquí viene con una de dos tareas: encontrar a una persona, o cambiarle el rol. Ninguna necesita leer las definiciones de los cuatro roles, y menos antes de ver la lista. Poner una referencia estática por encima del dato y en medio del par filtro→resultado hace que la tarea principal empiece con un…
- *Arreglo:* Reordenar y comprimir: (1) mover el bloque de roles DEBAJO de la tabla, o mejor convertirlo en un popover de ayuda desde el encabezado «ROL» de la tabla y desde el drawer, donde la definición sí es decisional; (2) pegar la barra de filtros a la tarjeta de la tabla (mismo `.card`) para que input y «N resultados» se toquen; (3) si se conserva la tarjeta, poblar `count` (`users.filter(u=>u.role===r.k).length`) y convertir cada tarjeta en…

**· [SET-07] La cabecera afirma periodo, agencia y frescura sobre una pantalla que no tiene ninguno de los tres** · `data-integrity`

- `apps/web/public/eco-prototype/app.js:161 y 374-375 (Header sin `live={false}`), shell.js:415-424 (sello «Datos al cierre de ayer»), shell.js:436-470 (switcher de agencia…`
- En las 4 capturas la cabecera de Configuración muestra: el sello «● DATOS AL CIERRE DE AYER», el switcher «DDEC», los chips 1D/5D/7D/30D/3M/6M/1A/Max con 7D activo, y el botón «Fechas». `UsersAdmin` llama `fetch('/api/users')` sin un solo parámetro de periodo o agencia; la API devuelve todos los usuarios del alcance del llamante (route.ts:53-59). La propia tabla lo delata: con «DDEC» seleccionado se listan filas con agencia `aaa` y `sg…
- *Importa porque:* Cuatro controles de alcance encima de una lista que no responde a ninguno. El daño concreto no es el espacio: es que un administrador que ve «DDEC» arriba y una fila «Marisol Vega · aaa» abajo tiene que decidir si eso significa que Marisol tiene acceso a DDEC (no lo tiene) o que el switcher no aplica (así es). Y los c…
- *Arreglo:* Que la cabecera declare su propio alcance por pantalla: extender `SCREEN_META` (app.js:153-165) con `scope: 'global' | 'agency-period'` y en `Header` (shell.js:367) ocultar chips de periodo, «Fechas» y el sello `live` cuando `scope === 'global'`. Para el switcher hay dos salidas honestas: ocultarlo también, o dejarlo y añadir bajo el título «Usuarios de todas las agencias que administras» + un chip de filtro por agencia dentro de la ta…

**· [SET-08] Lo primero que se lee en la pantalla es el nombre de una sección que ya no existe** · `copy`

- `apps/web/public/eco-prototype/app.js:161 vs screens.js:3434-3443`
- `settings: { label: 'Configuración', eyebrow: 'Alertas y usuarios' }`. El eyebrow se pinta como primer elemento de la cabecera en las 4 capturas («ALERTAS Y USUARIOS»). Pero el comentario de `SettingsScreen` dice explícitamente «"Preferencias de alertas" se eliminó» y `allSections` (3440-3443) sólo contiene `usuarios` y `plantillas`. Las reglas de alerta viven en la pantalla Alertas, no aquí.
- *Importa porque:* El eyebrow es el único migajón de contexto de la pantalla: es lo que orienta a alguien que llegó desde un enlace o desde el buscador. Hoy anuncia «Alertas» y no hay alertas: el usuario buscará una sección que no está, o peor, concluirá que la configuración de alertas se perdió. Es una etiqueta stale que sobrevivió a u…
- *Arreglo:* `eyebrow: 'Usuarios y plantillas de correo'` en app.js:161 — y como regla, derivar el eyebrow de `sections.map(s => s.l)` para que no vuelva a desincronizarse cuando se agregue o quite una sección.

**· [SET-09] En móvil el Estado desaparece de la pantalla —y hay un filtro por Estado— sin ninguna señal de que la tabla se desplaza** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:3745-3747 y 3762 (`minWidth: 740` dentro de `.scroll-x`), 3711-3717 (filtro de estados), index.html:244 (`.scroll-x`)`
- El probe de settings@390 reporta 26 elementos `overflowing`: la cabecera de la tabla llega a `right: 753` en un viewport de 390; la columna «ESTADO» arranca en `left: 451` y «ÚLTIMA ACTIVIDAD» en `left: 573`; los chevrones en `left: 695`. En settings-mobile.png la fila se corta a media pastilla de rol («Adminis…», «Solo lec…»). `.scroll-x` es sólo `overflow-x:auto` sin degradado ni sombra de borde, así que el corte se lee como texto ro…
- *Importa porque:* En móvil la pantalla ofrece un desplegable «Todos los estados» para filtrar por una columna que el usuario no puede ver, y el corte cae a mitad de una pastilla — el patrón visual de un bug, no de un contenedor desplazable. El administrador que revisa accesos desde el teléfono (el caso de uso más probable: alguien pide…
- *Arreglo:* Dos cosas. (1) Debajo de 768 px dejar de usar rejilla y renderizar tarjetas apiladas: fila 1 avatar+nombre+correo, fila 2 pastillas de Rol y Estado, fila 3 agencia + último acceso, todo el bloque como `<button>` de ancho completo y ≥56 px de alto. Es el mismo patrón que ya usan otras listas del producto y elimina el scroll horizontal en vez de decorarlo. (2) Mientras exista `.scroll-x`, darle afordancia real: `mask-image`/degradado de…

**· [SET-10] La rejilla da ancho fijo a los enums cortos y ancho elástico al identificador: el nombre se trunca desde 1280 px** · `density`

- `apps/web/public/eco-prototype/screens.js:3747 y 3762 (`'1.6fr 1.2fr 110px 110px 110px 40px'`, `minWidth: 740`), 3457 (`ecoCols('220px 1fr','1fr')`), 3771-3772 (ellipsis)`
- Probe `clipped`: a 1440 px el área de texto del usuario mide 221 px y trunca «Javier Domenech Rodríguez de la ...» (visible en settings-desktop.png); a 1280 px baja a **129 px** y además trunca el correo del propio administrador («agutierrez@populico…»); a 768 px, 118 px. Mientras tanto la columna AGENCIA (1.2fr ≈ 201 px a 1440) contiene «ddecpr» (6 caracteres) y tres columnas de 110 px fijos sostienen «Editor», «Activo» y una marca de…
- *Importa porque:* El nombre y el correo son el identificador: es cómo el administrador confirma que está tocando a la persona correcta antes de cambiarle permisos. Es justo el campo que se trunca, y a 1280 px —resolución habitual de portátil de gobierno— se trunca hasta el correo, que es el desambiguador cuando hay dos personas con ape…
- *Arreglo:* Rejilla: `minmax(240px, 2.6fr) minmax(90px, .8fr) max-content max-content 110px 40px` y bajar `minWidth` a ~640. Sub-navegación: con `sections.length <= 3` renderizar tabs horizontales (o un segmented control) en vez de la columna de 220 px — devuelve 240 px a la tabla y de paso arregla el ítem inactivo que en móvil flota como texto suelto sin fondo ni borde (screens.js:3462-3472, visible en settings-mobile.png). Y añadir `title={u.nam…

**· [SET-11] El color se gasta en Estado (administrativo) y Rol —el campo que otorga poder— queda monocromo, con dos geometrías de badge en la misma fila** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:3756 (`stTone`), 3777-3779 (badge de rol hecho a mano), 3781 (`pill pill-${stTone}` + `textTransform:'capitalize'`), index.html:…`
- En settings-desktop.png la región de datos tiene exactamente tres elementos con color: dos «Activo» en verde, un «Invitado» en ámbar y un «Suspendido» en el rojo-naranja de `pill-neg`. «Administrador», «Editor», «Analista» y «Solo lectura» se pintan todos con el mismo badge neutro construido a mano en 3777 (`background: var(--canvas-2)`, `borderRadius: 999`) — indistinguibles entre sí. Y ese badge convive en la misma fila con la pastil…
- *Importa porque:* El ojo va primero a los tres verdes «Activo» — la información menos consecuente de la tabla — y no hay ninguna señal visual que distinga al único Administrador (control total sobre usuarios, plantillas, reglas y configuración) de un Solo lectura. En una auditoría de accesos, que es para lo que se abre esta pantalla, e…
- *Arreglo:* Invertir el reparto: (1) Rol pasa a ser el elemento coloreado, con una escala de privilegio de un solo hue —Administrador `--accent-fill` + borde `--accent` + peso 600; Editor y Analista `--info-bg`/`--info`; Solo lectura neutro— para que la jerarquía de poder se lea de un vistazo; (2) Estado baja a texto con un punto de 6 px: verde `--pos` para activo, `--warn` para sin primer acceso, y `--text-disabled` con el punto hueco para Suspen…

**· [SET-12] «Última actividad» se imprime en la zona horaria del navegador, con formato MM/DD y segundos, en una columna que no le cabe** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3593 (`toLocaleString('es-PR')` sin `timeZone`) y 3782, frente a screens.js:3420 (misma app, con `timeZone: 'America/Puerto_Rico…`
- `lastSeen: u.lastLogin ? new Date(u.lastLogin).toLocaleString('es-PR') : '—'`. Sin la opción `timeZone`, el valor se renderiza en la TZ del cliente. Resultado en las capturas: «07/27/2026, 6:00:00 a. m.» en mono a 11 px, envuelto a dos líneas dentro de la columna de 110 px. En la misma pantalla de Alertas el producto sí fija la zona: `new Date(r.triggeredAt).toLocaleString('es-PR', { timeZone: 'America/Puerto_Rico' })` (3420).
- *Importa porque:* Toda la narrativa temporal del producto está anclada a Puerto Rico —la cabecera dice «datos al cierre de ayer», los correos salen a las 6:00 AM PR—, así que el lector asume AST. Un administrador de Populicom que abra el dashboard desde otra zona verá horas de acceso desplazadas y podría concluir que alguien entró de m…
- *Arreglo:* Un solo formateador compartido: `formatPrDateTime(iso)` → «27 jul 2026, 6:00 AM» con `timeZone:'America/Puerto_Rico'`, y en la celda mostrar la forma relativa («hace 1 d», «hace 3 h») con el valor absoluto en `title`. Eso cabe en una línea de 90 px, elimina la ambigüedad de formato y ancla la zona. Aplicarlo también a 3420 para que exista una sola función y no dos convenciones.

**· [SET-13] La columna Agencia muestra slugs internos de base de datos mezclados con una palabra en español** · `copy`

- `apps/web/public/eco-prototype/screens.js:3591 y 3775; los nombres legibles ya están cargados en 3573-3578 (`agencyOptions` con `{slug, name}`) y se usan en el drawer (38…`
- `agency: u.allAgencies ? 'Todas' : (u.agencies.length ? u.agencies.join(', ') : '—')`. En las capturas la columna dice «Todas», «ddecpr», «ddecpr», «aaa», «sgpr, gobernadora» — mientras el switcher de la cabecera, tres centímetros arriba, llama a la misma agencia «DDEC». El componente ya recibe los nombres legibles: en el drawer se pinta `{a.name} ({a.slug})` (3881).
- *Importa porque:* El usuario final es personal de gobierno, no operador de la base. «ddecpr» y «sgpr» son identificadores de nuestra tabla; obligan a traducir mentalmente y hacen que la herramienta parezca una consola interna. Peor: al no coincidir con «DDEC» del switcher, un lector cuidadoso puede dudar de si «ddecpr» y «DDEC» son la…
- *Arreglo:* Mapear con `agencyOptions` y pintar `name` (siglas oficiales) en pastillas neutras, máximo dos visibles + «+2» con tooltip; «Todas» pasa a una pastilla `--info` «Todas las agencias» para que se distinga de un nombre propio; y el vacío `—` a texto explícito «Sin agencia asignada» en `--warn`, porque hoy un usuario sin acceso a nada se ve como un guion inocuo.

**· [SET-14] Los campos de esta pantalla no usan `.input`: sin anillo de foco y sin el piso táctil de 40 px que el sistema ya define** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3990-3995 (`inputStyle` con `outline:'none'`), 3701-3705 (buscador artesanal), 3839-3853 (campos del drawer) vs index.html:396-4…`
- `inputStyle` es una copia a mano de `.input` que añade `outline: 'none'` y, siendo estilo inline, no puede declarar `:focus` — así que TODOS los campos del drawer de invitación quedan sin indicador de foco, mientras `.input:focus { border-color: var(--accent) }` existe en el CSS y funciona en el resto del producto. En el buscador de la barra de filtros, el `<input>` va desnudo dentro de un div con el padding y el borde: el probe lo mid…
- *Importa porque:* Dos fallos de una misma causa. El de foco rompe la operación por teclado en un formulario de permisos: quien tabula no sabe en qué campo está, y es un formulario donde equivocarse de campo significa dar un rol de más. El de tamaño es peor en móvil: el usuario ve un campo de búsqueda de 40 px y toca donde le parece; el…
- *Arreglo:* Borrar `inputStyle` y usar `className="input"` en los cinco campos del drawer (así heredan foco, hover y el piso de 40 px de golpe). En el buscador de filtros, mover el padding del wrapper al `<input>` (o envolver todo en un `<label>`), y añadir un `:focus-within` en el wrapper. Como regla del sistema: prohibir `outline:'none'` en estilos inline — si un componente necesita foco propio, va al CSS con `:focus-visible`.

**· [SET-15] La fila es clickeable pero no es un control: sin teclado, sin foco, y la única pista visual es un chevron de 14 px** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3758-3765 (`<div onClick>` con `className="row-hover"`), 3783 (chevron `color="var(--text-3)"`), index.html:455-456 (`.row-hover…`
- La fila es un `div` con `onClick` y `cursor:'pointer'`: sin `role="button"`, sin `tabIndex`, sin handler de Enter/Espacio, sin anillo de foco. La única afordancia estática es `Icons.ChevronRight size={14}` en `--text-3` al final de la fila (en móvil, además, queda fuera de pantalla en `left: 695` de 390 — ver SET-09). El hover sólo cambia el fondo a `--canvas-2`, un delta muy bajo en modo oscuro.
- *Importa porque:* Editar un usuario es la acción central de la pantalla y su punto de entrada es invisible hasta que pasas el ratón por encima. En escritorio se descubre por accidente; con teclado o lector de pantalla no se descubre nunca: la tabla de usuarios es literalmente inoperable sin ratón. Para un sistema de gobierno eso tambié…
- *Arreglo:* Convertir la fila en un elemento interactivo real: `<div role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } }} aria-label={`Editar ${u.name}`}>` con `:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px }` en una clase CSS. Y hacer explícita la acción: un botón «Editar» de texto en la última columna (visible siempre, no en hover) en lugar del chevron…

**· [SET-16] El botón «Eliminar» no elimina: suspende, y el propio diálogo lo contradice** · `copy`

- `apps/web/public/eco-prototype/screens.js:3977-3981 (botón «Eliminar» con icono de basurero y `color: var(--neg)`), 3665-3681 (`deleteUser`: confirm «¿Suspender este usua…`
- Tres nombres para una acción en un mismo flujo: la etiqueta dice «Eliminar», el diálogo dice «¿Suspender este usuario? Podrás reactivarlo después.», el toast de éxito dice «Usuario suspendido» y el de error vuelve a «No se pudo eliminar». El backend hace un soft-delete (`isActive: false`). No existe en toda la interfaz ninguna forma de retirar de verdad a una persona.
- *Importa porque:* El basurero rojo es el vocabulario universal de «destructivo e irreversible». Un administrador que quiere quitar a alguien que dejó la agencia lo pulsa, lee el diálogo, y ya no sabe qué va a pasar; si acepta, cree que borró y en realidad dejó una cuenta suspendida (recuperable, y que sigue apareciendo en la lista). Al…
- *Arreglo:* Nombrar la acción por lo que hace en los cuatro sitios: botón «Suspender acceso» con icono de candado/pausa (no basurero), en `--warn` y no `--neg`; diálogo «Suspender a {nombre}. Perderá el acceso de inmediato y podrás reactivarlo desde esta misma ficha.»; toasts «Acceso suspendido» / «No se pudo suspender». En la ficha de un usuario ya suspendido, ese botón se convierte en «Reactivar acceso». Si el cliente necesita borrado real (baja…

**· [SET-17] Un administrador puede degradarse o suspenderse a sí mismo desde la tabla, sin aviso y sin marca de "eres tú"** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3754-3784 (todas las filas idénticas), 3893-3915 (radios de rol sin excepción), 3977 (Eliminar sin excepción) + apps/web/src/app…`
- En settings-desktop.png la primera fila es «Alejandro Gutiérrez · agutierrez@populicom.com · Administrador», que es exactamente el usuario en sesión (pie de la barra lateral: «Alejandro Gutiérrez · Admin · DDEC»). La fila no tiene ninguna marca que la distinga, y al abrirla el drawer permite cambiar el rol a «Solo lectura» o el Estado a «Suspendido». `PATCH /api/users/[id]` sólo comprueba `requireRole(['admin'])` y el alcance de agenci…
- *Importa porque:* Si el único administrador de una agencia se pone «Solo lectura» (algo perfectamente alcanzable dado SET-02, donde el rol seleccionado no siempre es el que se cree), pierde `manage_users`, la pantalla Configuración desaparece de su navegación (shell.js:129-132) y ya no hay forma de revertirlo desde el producto: hace fa…
- *Arreglo:* Tres capas: (1) marcar la fila propia con una pastilla «Tú» y ordenarla primero de forma explícita; (2) en el drawer de uno mismo, deshabilitar el `select` de Estado y los radios que reduzcan privilegio, con la nota «No puedes cambiar tu propio rol ni suspenderte»; (3) guarda en el backend: `PATCH` responde 409 si `id === callerId` y el cambio implica `isActive:false` o degradación de rol, y también si dejaría la agencia sin ningún adm…

**· [SET-18] Validación de correo por «contiene @», y se puede guardar un usuario sin ninguna agencia** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3812 (`valid = form.name.trim() && /@/.test(form.email)`), 3843-3847 (campo «Correo institucional»), 3861-3886 (agencias) vs app…`
- `/@/.test()` acepta `a@`, `@`, `juan@sinpunto`. El mismo producto valida correos de destinatarios con una expresión real en la página AntD de reportes. Además, con «Todas las agencias» desmarcado y cero casillas seleccionadas, `valid` sigue siendo true: se crea un usuario cuyo `agency` renderiza `—`. Y cuando el formulario es inválido el único feedback es el botón primario en `disabled` (3974): no hay mensaje que diga qué falta.
- *Importa porque:* Un correo mal escrito no falla aquí: falla en Cognito/SES, en silencio (route.ts:114 «el invitar nunca falla en duro»), y produce exactamente el caso de SET-05: una fila «Invitado» que nunca recibirá nada. La etiqueta promete «Correo institucional» y no se comprueba ningún dominio. Y un usuario sin agencia entra a la…
- *Arreglo:* Compartir un único validador con la página de reportes (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) y añadir un aviso —no bloqueo— si el dominio no termina en `.pr.gov`/`populicom.com`, coherente con la etiqueta «institucional». Exigir al menos una agencia o `allAgencies` para habilitar el envío. Y sustituir el `disabled` mudo por errores inline bajo cada campo al perder el foco, más un resumen junto al botón («Falta: rol, agencia»).

**· [SET-19] Las dos filas que requieren acción quedan al final y bajo el pliegue; no hay orden ni ordenación posible** · `hierarchy`

- `apps/web/public/eco-prototype/screens.js:3610-3615 (filtra pero no ordena), 3752 (cabeceras no interactivas), 3743-3793 (sin paginación) + apps/web/src/app/api/users/rou…`
- La API ordena por fecha de creación descendente y el cliente no reordena. En settings-desktop.png las tres filas «Activo» están arriba y las dos excepciones —«Marisol Vega · Invitado · —» y «Javier Domenech · Suspendido»— son las dos últimas; con un viewport de 900 px la última cae ya pegada al borde. Ninguna cabecera de columna es clickeable (son `div`, 3752) y no hay paginación ni contador de páginas, mientras la tabla de Menciones s…
- *Importa porque:* El administrador entra a esta pantalla por una excepción: alguien no puede entrar, alguien se fue, alguien pidió más permisos. El orden por «creado recientemente» es el único que no responde a ninguna de esas preguntas, y coloca sistemáticamente las anomalías donde menos se ven. Con 5 usuarios se sobrevive; con 40 —cu…
- *Arreglo:* Orden por defecto que priorice excepciones: Suspendidos e «Invitación no enviada» primero, luego sin primer acceso, luego activos por último acceso descendente — y decirlo en la cabecera de la tarjeta («Ordenado por: requiere atención»). Hacer clickeables los encabezados USUARIO / ROL / ESTADO / ÚLTIMA ACTIVIDAD con indicador de dirección, y añadir paginación (o scroll virtual) con el mismo componente de Menciones a partir de ~25 filas.

**· [SET-20] El drawer de invitación es un scroll de ~1200 px con la acción al fondo, sin barra fija, sin trampa de foco y sin bloqueo de scroll** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:3819-3987 (estructura), 3973-3983 (acciones al final del flujo), 3821 (`drawer-backdrop` con `onClick={onClose}`), 3804-3808 (só…`
- El drawer apila cinco bloques —Identidad, Agencias visibles, Rol y permisos (4 tarjetas), Páginas visibles (9 casillas) y Actividad reciente (4 filas falsas)— y sólo después la fila de botones, sin `position: sticky`. En móvil `max-width: 95vw` lo deja en ~370 px, donde la rejilla de páginas cae a una columna (9 filas) y el scroll crece más. No hay `role="dialog"`, `aria-modal`, autofoco en el primer campo, trampa de foco ni bloqueo de…
- *Importa porque:* El flujo principal («invitar a alguien») termina en un botón al que hay que llegar haciendo scroll a ciegas, y en móvil pasando por un log de actividad inventado que no aplica a un usuario que aún no existe. Peor: un roce en el backdrop —muy fácil con un panel de 370 px— destruye el formulario completo sin confirmació…
- *Arreglo:* (1) Barra de acciones `position: sticky; bottom: 0` con fondo `--canvas` y borde superior, siempre visible. (2) No renderizar «Actividad reciente» en modo crear (y eliminarla del todo, ver SET-04); considerar acordeón para «Páginas visibles» ya que el 90% de los casos usa el default «Todas». (3) `role="dialog" aria-modal="true" aria-labelledby`, autofoco en «Nombre completo», trampa de foco, `overflow:hidden` en el `body` mientras está…

### P2 (5)

**· [SET-21] 83 de 107 nodos de texto por debajo de 13 px, y 27 de ellos a 9-10 px, en una pantalla de lectura densa** · `type-scale`

- `apps/web/public/eco-prototype/screens.js:3692 (12), 3728-3734 (13/11/**9**), 3744 (11 vía `.card-hd-sub`), 3749 (**10**), 3767 (11), 3771-3772 (13/11), 3775 (12), 3777 (…`
- Censo de fuentes del probe para `settings` (idéntico en los 4 viewports): 107 nodos en IBM Plex Sans con tamaños 9 px×12, 10 px×15, 11 px×31, 12 px×25, 13 px×20, 16 px×3, 22 px×1; más 9 nodos en IBM Plex Mono (9 px×1, 10 px×4, 11 px×4). Es decir: **77% del texto de la pantalla está por debajo de 13 px** y 27 nodos están a 9-10 px, incluidas las pastillas de permisos de las tarjetas de rol (`fontSize: 9`, screens.js:3734 y 3908), las ca…
- *Importa porque:* Los usuarios son personal de agencias de gobierno, no analistas de 25 años con dos monitores. Texto de 9 px en mayúsculas y con `letter-spacing` (las pastillas USUARIOS/PLANTILLAS/REGLAS) es decorativo: nadie lo lee, y son precisamente los permisos que la tarjeta pretende explicar. El contraste, por cierto, ya lo arre…
- *Arreglo:* Barrido de esta pantalla contra el nuevo piso: 9 px → `--fs-overline` (11) sólo si van en mayúsculas, si no `--fs-caption` (12); las cabeceras de columna a 11 px mayúsculas; los correos, agencia y última actividad a `--fs-caption` (12); nombre de usuario a `--fs-body-sm` (13); etiquetas de `Field` a `--fs-overline` (11). Y sustituir cada literal numérico por `var(--fs-*)`, que es lo único que evita la reincidencia.

**· [SET-22] Concordancias rotas y dos contadores redundantes que se contradicen al filtrar** · `copy`

- `apps/web/public/eco-prototype/screens.js:3693 y 3744`
- `{stats.invitados} invitación pendiente · {stats.suspendidos} suspendidos` produce literalmente «1 suspendidos» en las 4 capturas, y produciría «2 invitación pendiente» con dos invitados. La tarjeta de la tabla usa `{filtered.length} resultados` → «1 resultados» al filtrar. Además la cabecera dice «5 usuarios» y la tarjeta de abajo «5 resultados»: dos contadores del mismo hecho a 230 px de distancia que dejan de coincidir en cuanto se…
- *Importa porque:* Son los primeros números que se leen en la pantalla y están mal escritos; en un producto de gobierno la desprolijidad gramatical se lee como desprolijidad de datos. Y la duplicación de contadores repite en pequeño el problema sistémico del producto (varios totales del mismo hecho en una vista): al filtrar, el lector t…
- *Arreglo:* Helper `plural(n, 'suspendido', 'suspendidos')` para las cuatro cifras (y «1 invitación pendiente» / «3 invitaciones pendientes», «1 resultado»). Un solo contador: la cabecera mantiene el resumen del universo («5 usuarios · 3 activos · 1 sin primer acceso · 1 suspendido») y la tabla sólo muestra un número cuando hay filtro activo, con la relación explícita: «1 de 5 usuarios · filtro: Editor».

**· [SET-23] Los cinco avatares son del mismo azul con iniciales en blanco hardcodeado: el canal de color no informa y falla contraste** · `iconography`

- `apps/web/public/eco-prototype/screens.js:3594 (`avatar: '#4A7FB5'` fijo para todos), 3767 (`color: '#fff'`), frente a SEED_USERS 3532-3537 que sí tenía un color por pers…`
- `fromApi` asigna el mismo hex a todo el mundo, así que las cinco fichas de la captura son círculos idénticos. El probe mide las iniciales («AG», «LQ», «GR», «MV», «JD») en `#fff` sobre `#4A7FB5` = **4.2:1**, por debajo de 4.5 para 11 px en negrita. Ambos valores son hex literales inline, fuera del sistema: el barrido de `--on-*` de `tokens.css` (que ya reemplazó los `#fff` sobre relleno saturado en otras pantallas) no llega aquí.
- *Importa porque:* Un avatar de color existe para dar reconocimiento rápido de fila; cinco círculos iguales sólo añaden 30 px de ruido a la izquierda del único dato que importa (nombre y correo), y encima le roban ancho a la columna que ya se trunca (SET-10). Las iniciales quedan además por debajo del mínimo legible.
- *Arreglo:* O se elimina el avatar y el nombre gana 40 px, o se le da función: derivar el color de la paleta categórica de `tokens.css` (`--cat-1..8`) por índice estable del usuario, y pintar las iniciales con el `--on-*` correspondiente en vez de `#fff`. Cero hex literales en el componente.

**· [SET-24] La costura SPA/AntD: las plantillas se ven aquí, sus destinatarios se editan en otro sistema de diseño, y el texto que lo explica no es un enlace** · `consistency`

- `apps/web/public/eco-prototype/screens.js:3511 y 3516 (instrucciones en texto plano), 3502-3527 (TemplatesAdmin) vs screens.js:3060-3062 (`<iframe src="/settings/reports?…`
- «Plantillas de correo» vive en Configuración, pero su tarjeta dice en texto plano «Destinatarios y hora en Alertas → Reportes por correo» y «Configúrala en Alertas → Alertas de crisis»: ninguna de las dos frases es navegable. El destino real es un `iframe` a una página Next.js con Ant Design embebida en la pantalla de Alertas. Y la vista previa del correo se inyecta en un `iframe` con `background: '#fff'` (3523) dentro de una interfaz…
- *Importa porque:* Un mismo objeto —el correo de reporte— está partido entre dos pantallas, dos sistemas de diseño y dos niveles de rigor, y la única pista para atravesar la frontera es una frase que no se puede pulsar. El administrador que llega a «Plantillas» buscando cambiar quién recibe el correo tiene que memorizar una ruta y naveg…
- *Arreglo:* Corto plazo: convertir esas dos frases en botones que naveguen a la pestaña correspondiente (`onNav('alerts')` + tab), y unificar el validador de correo en un helper compartido. Medio plazo: mover «Reportes por correo» a Configuración —es configuración, no vigilancia— y reemplazar el `iframe` por un componente nativo de la SPA; mientras siga embebido, forzar `?embed=1` con los tokens de `mando` para que no se vea como otra aplicación.…

**· [SET-25] Una fila propia de cabecera con un solo botón de tema, y tres tratamientos de título para el mismo nivel jerárquico** · `layout-rhythm`

- `apps/web/public/eco-prototype/shell.js:398-401 (`flexWrap:'wrap'` sin colapso) y 425-431 (h1 22 px), screens.js:3689 (título de tarjeta 16/700 a mano) vs index.html:314…`
- En settings-desktop-fold.png la cabecera ocupa 137 px CSS y su tercera fila contiene exactamente un botón de 44×30 (el sol): no es una fila diseñada, es el desborde de `flexWrap:'wrap'` cuando título + buscador + agencia + 8 chips de periodo + Fechas + Chat + tema no caben en 1440 px. Debajo, tres jerarquías para el mismo rango: «Configuración» (h1 22 px), «Usuarios y roles» (16 px/700 inline, 3689) y «ROLES DISPONIBLES»/«USUARIOS» (`.…
- *Importa porque:* El desborde deja una banda de 44 px de alto que el ojo lee como una sección vacía y empuja todo el contenido; sumado a SET-06 es la razón de que el primer usuario aparezca a 620 px. Y tener tres tamaños para «título» sin escala hace que la tarjeta de filtros parezca más importante que la tarjeta de la tabla, que es do…
- *Arreglo:* Cabecera: mover el botón de tema y «Fechas» a un menú de desbordamiento (⋯) y darle al bloque de título `flex: 1 1 100%` en tablet para que el envoltorio ocurra en un punto elegido; objetivo ≤96 px de cromo. Títulos: el título de tarjeta usa siempre `.card-hd-title` (borrar el 16/700 inline de 3689) y el h1 pasa a `var(--fs-display-lg)`, de modo que la escala del sistema —no un literal— decida el rango. Y definir `--fs-overline`/`--tra…


## Búsqueda global

*25 hallazgos*

Rutas relativas a /Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit. /search es la pantalla más simple del producto y la que más engaña: promete «todas las menciones» tres veces (eyebrow, placeholder, título del estado vacío) mientras el fetch envía window.ecoGetPeriodParams() y el API descarta duplicados y toda la pertinencia «baja», de modo que un funcionario que busca un término y ve «No se encontraron menciones» concluye que el tema no existe cuando solo no existe en los últimos 7 días. Encima, la búsqueda no imprime nunca sus criterios: si el usuario entra por un chip de «Tópicos frecuentes», el encabezado dice solo «Resultados» y el tópico aplicado vive escondido en un «·1» dentro de un popover cerrado — una cifra screenshoteable sin su contexto. Como pantalla es Menciones con otra piel: comparten fetch, facetas, tres vistas, paginación y estados, pero divergen en doce detalles pequeños (dónde vive «Ordenar», si los chips llevan conteo, el copy de error, si la paginación se guarda contra error), que es exactamente la clase de divergencia que erosiona la confianza; mi recomendación es fusionarla como el estado «con query» de Menciones y dejar /search como alias. El cromo global la asfixia: en escritorio 138px de cabecera (con una fila entera para un solo botón de tema) y en móvil ~340px — el 40% de la pantalla — antes del único control que la pantalla necesita, con dos campos de búsqueda distintos a 100px uno del otro y un teclado ⌘K dibujado en un teléfono. El ⌘K, además, ofrece cinco comandos («Ver solo menciones negativas», «…en Facebook») que no ap…

### P0 (5)

**· [S-01] «Todas las menciones» es falso: la búsqueda está acotada al período del header (7D por defecto) y no lo dice en ninguna parte** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:1330 (params con window.ecoGetPeriodParams) · app.js:156 (eyebrow) · screens.js:1367 y 1383 (copy) · apps/web/src/app/api/eco-me…`
- En search-desktop.png la pantalla dice tres veces «todas las menciones» (eyebrow «RESULTADOS EN TODAS LAS MENCIONES», placeholder «Buscar en todas las menciones — palabras clave, autor, tema…», título del vacío «Busca en todas las menciones») mientras el chip 7D está activo en el header. El fetch inyecta siempre el período: `new URLSearchParams({ ...window.ecoGetPeriodParams(), … })`, y el API añade `gte(mentions.publishedAt, since)`.…
- *Importa porque:* Un funcionario que busca «Negrón» o «apagón» y recibe «No se encontraron menciones» concluye que no se habló del tema. La causa real es que la ventana por defecto son 7 días cerrados. Es el error más caro posible en una herramienta de vigilancia: un falso negativo con apariencia de dato.
- *Arreglo:* 1) Cambiar el copy a lo que realmente hace: eyebrow «Resultados en el período seleccionado», placeholder «Buscar menciones — palabras clave, autor, URL…». 2) Imprimir el criterio junto al conteo en `.card-hd-sub`: «1,024 menciones · 21–27 jul (7D) · DDEC». 3) Añadir en la propia pantalla un chip de alcance «Período (7D)» / «Todo el histórico» que escriba el período solo para la búsqueda, sin tocar el header (hoy el único control está a…

**· [S-02] El API descarta silenciosamente la pertinencia «baja» y los duplicados, bajo la promesa de «todas»** · `data-integrity`

- `apps/web/src/app/api/eco-mentions/route.ts:190-198 (excluye nlp_pertinence='baja' salvo includeLow) y :171-172 (is_duplicate=false)`
- `else if (!includeLow || …) conditions.push(sql\`(nlp_pertinence IS NULL OR nlp_pertinence <> 'baja')\`)`. SearchScreen nunca envía `includeLow` ni `pertinence` (screens.js:1330-1338), así que toda mención clasificada como baja pertinencia es invisible para la búsqueda, sin aviso. Lo mismo para los duplicados.
- *Importa porque:* El usuario busca una URL o una frase exacta que vio con sus ojos, no aparece, y pierde la confianza en el sistema entero — o peor, reporta que «no hubo cobertura». Ocultar registros es defendible; ocultarlos mientras se dice «todas las menciones» no lo es.
- *Arreglo:* Declarar la exclusión y hacerla reversible: en el pie de resultados, «N menciones · se excluyeron M de baja pertinencia y K duplicados» con un enlace «incluir» que añada `includeLow=1`. Requiere devolver esos dos conteos desde el endpoint (dos COUNT extra sobre el mismo whereClause sin la condición correspondiente).

**· [S-03] Los resultados no muestran los criterios que los produjeron: un chip de tópico filtra la lista sin dejar rastro visible** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:1407 (chip → setFilters({topic})) · 1462 (título «Resultados» sin filtros) · 1433 (único indicio: «Más filtros ·1» dentro de un…`
- Los ocho chips de «TÓPICOS FRECUENTES» de search-desktop.png no escriben nada en el input: aplican `filters.topic`. Al hacerlo, `hasCriteria` pasa a true, el estado vacío desaparece y el encabezado dice literalmente «Resultados» / «N menciones · página 1 de 4». El nombre del tópico no aparece en ningún sitio; el input sigue mostrando su placeholder. El único rastro es un «·1» naranja de 10px pegado al botón «Más filtros».
- *Importa porque:* Es una cifra sin contexto, y esta pantalla es la que la gente captura para pegar en un informe. «Resultados: 320 menciones» leído como total de la agencia, cuando es el subconjunto de un tópico dentro de 7 días, es una conclusión falsa producida por la interfaz.
- *Arreglo:* Barra de criterios activos siempre visible sobre los resultados: pills removibles (× ) para query, tópico, región, fuente, sentimiento y período, más un «Limpiar todo». El título de la tarjeta debe reconstruirse desde los criterios («Turismo y promoción · 7D · DDEC»), no ser la cadena fija «Resultados». Y el chip debe además escribir su nombre en el input para que la pantalla y el campo no se contradigan.

**· [S-04] Cinco comandos del ⌘K prometen filtrar Menciones y no filtran nada: mentionsFilter no lo consume ningún componente** · `data-integrity`

- `apps/web/public/eco-prototype/shell.js:604-608 · app.js:406 (setMentionsFilter + setActive) · app.js:391 (prop mentionsFilter) · screens.js:785 (MentionsScreen solo dese…`
- `grep -n mentionsFilter screens.js app.js` devuelve únicamente app.js:246, 391 y 424. `MentionsScreen({ onMentionClick })` nunca lee la prop, así que «Ver solo menciones negativas», «…de alta pertinencia», «…en Facebook», «…en X / Twitter» y «…en Noticias» solo navegan al feed sin filtrar. Peor: el ChatDrawer sí recibe ese estado muerto (app.js:424), así que el asistente puede describir un contexto filtrado que no existe en pantalla.
- *Importa porque:* El usuario pide «solo negativas», recibe un feed de todo y lee las primeras filas como si fueran las negativas. Y el atajo estrella del producto queda como decorado; es lo primero que se demuestra en una presentación al cliente.
- *Arreglo:* Aceptar el filtro en el destino: `MentionsScreen({ onMentionClick, mentionsFilter, setMentionsFilter })` que haga merge en su estado `filters` al montar y luego limpie el buffer. Para «alta pertinencia» hace falta además exponer `pertinence` en la barra de filtros (el API ya lo soporta, route.ts:194). Mientras no se implemente, borrar los cinco comandos: es mejor no ofrecerlos que ofrecerlos falsos.

**· [S-05] La query se mutila en silencio: tokens de 1 carácter se descartan y no hay unaccent, pero el encabezado repite la frase completa del usuario** · `data-integrity`

- `apps/web/src/app/api/eco-mentions/route.ts:227-236 (filter t.length>=2 + ILIKE sin unaccent) · screens.js:1288 (searchTerms con el mismo filtro) · screens.js:1462 (títul…`
- `q.trim().split(/\s+/).filter(t => t.length >= 2)`: buscar «Ley 8» ejecuta solo `ILIKE '%ley%'`, devuelve todo lo que diga «ley», lo titula «Resultados para «Ley 8»» y el <mark> solo pinta «ley». Y la condición es `title ILIKE '%tok%' OR snippet ILIKE …` sin `unaccent()`: «energia» no encuentra «energía» y «Anasco» no encuentra «Añasco».
- *Importa porque:* Dos falsos resultados de signo opuesto sobre un producto en español de Puerto Rico: falsos positivos etiquetados con la búsqueda que el usuario no hizo, y falsos negativos cada vez que alguien escribe sin acentos —que es como se escribe en un teclado de oficina—.
- *Arreglo:* 1) Backend: `CREATE EXTENSION unaccent` y comparar `unaccent(title) ILIKE unaccent($1)` (índice GIN trigram sobre la expresión); es la corrección de mayor impacto por línea de código de toda la pantalla. 2) No descartar tokens de 1 carácter cuando van junto a otros (números de ley, iniciales); si se descartan, decirlo: «Se ignoró «8» (término demasiado corto)» bajo el input, y resaltar solo lo que realmente se buscó.

### P1 (15)

**· [S-06] Búsqueda y Menciones son la misma pantalla con doce divergencias: debe ser un estado de Menciones, no una pantalla aparte** · `consistency`

- `apps/web/public/eco-prototype/screens.js:785-1006 (MentionsScreen) vs 1265-1507 (SearchScreen); comparten SOURCE_OPTIONS/VIEW_MODES/SORT_OPTIONS (707-729), MentionsList/…`
- Divergencias verificadas línea a línea: (1) el input vive en la barra de filtros a 13px con «Buscar en menciones…» vs un hero de 48px/16px; (2) «Ordenar» está dentro del popover «Más filtros» (917-931) vs chips visibles en la barra (1456); (3) los chips de sentimiento llevan conteo solo en Search (1425); (4) Menciones tiene 5 QuickMetric y Search ninguna; (5) sin criterio, Menciones muestra el feed completo y Search un estado vacío; (6…
- *Importa porque:* Cada divergencia es un lugar donde el producto se contradice: el mismo usuario ve dos veces la misma tabla con reglas distintas y deja de fiarse de cuál manda. Y duplica el coste de cada corrección futura: los hallazgos S-01/S-02/S-03 hay que arreglarlos dos veces.
- *Arreglo:* Fusionar: una sola pantalla Menciones con dos estados —feed (sin query) y resultados (con query/filtros)—. El hero de búsqueda pasa a ser el campo primario de la barra de filtros (48px, 16px, con botón de limpiar), los recientes y los chips de tópicos se muestran como panel de sugerencias al enfocar el campo vacío, y /search queda como alias de ruta que abre Menciones con `?q=` y el foco en el campo. Elimina ~240 líneas y deja un único…

**· [S-07] Dos campos de búsqueda simultáneos con estados que se desincronizan: el del header conserva el término viejo para siempre** · `consistency`

- `apps/web/public/eco-prototype/shell.js:343-364 (HeaderSearch con useState('') local, sin prop de valor) · app.js:382 (onSearch) · screens.js:1299-1303 (sync del hero des…`
- search-desktop.png muestra los dos inputs a la vez: el del header («Buscar menciones, autor, URL… ⌘K») y el hero («Buscar en todas las menciones — palabras clave, autor, tema…»). HeaderSearch guarda su texto en estado local que nunca se limpia ni recibe el valor actual; el hero sí se sincroniza desde `searchQuery`. Resultado: se busca «apagón» desde el header, luego se refina a «apagón Añasco» en el hero, y el header sigue mostrando «a…
- *Importa porque:* Dos campos visibles con dos términos distintos y ninguna indicación de cuál está gobernando los resultados. En una demo al cliente es la clase de detalle que se interpreta como «los datos tampoco cuadran».
- *Arreglo:* Un único origen de verdad: pasar `value={searchQuery}` a HeaderSearch y que su onChange escriba el mismo estado, o —mejor— ocultar el HeaderSearch en la pantalla de resultados (el hero ya cumple ese papel) y dejar en el header solo el botón de comando rápido.

**· [S-08] El campo de búsqueda del header —el primero que ve un usuario de móvil— tiene 12px de letra y 33px de alto: dispara el zoom de iOS y falla el objetivo táctil** · `touch-target`

- `apps/web/public/eco-prototype/shell.js:357 (fontSize: 12, padding '8px 56px 8px 32px') · index.html:277-278 (min-height 40px solo desde el media query) · probe search-de…`
- El probe mide 33px de alto en escritorio y 40px en móvil (mínimo recomendado 44). En search-mobile.png ese input aparece por encima del hero: el orden de lectura del teléfono pone primero el campo equivocado. Safari iOS hace zoom automático en cualquier input con font-size < 16px, así que tocarlo desplaza y amplía la página; el hero, con fontSize 16 (screens.js:1369), no lo hace.
- *Importa porque:* El usuario de móvil pelea con un zoom involuntario en el primer control que toca, y lo hace en el campo que menos hace (sin debounce, sin ?q=, sin botón de limpiar): solo responde a Enter.
- *Arreglo:* Subir el input del header a `font-size: var(--fs-body)` (14px) mínimo y 16px en móvil, altura 40-44px, y no renderizarlo cuando bp==='mobile' (el hamburguesa + el hero ya cubren el caso). Con la fusión de S-06, el campo del header se convierte en el único y vive dentro de la pantalla.

**· [S-09] La tecla ⌘K se dibuja como botón en pantallas táctiles y en Windows, y al tocarla abre un tercer buscador con otro alcance** · `affordance`

- `apps/web/public/eco-prototype/shell.js:359-362 (botón con <span class="kbd">⌘K</span>) · app.js:330-331 (el atajo acepta metaKey || ctrlKey) · shell.js:661 (placeholder…`
- En search-mobile.png el keycap ⌘K aparece a 24×22px dentro del input, en un teléfono sin tecla ⌘. El handler global acepta Ctrl, pero la etiqueta dice ⌘, y el cliente es una oficina de gobierno con Windows. Al pulsarlo se abre el spotlight, cuyo placeholder no menciona menciones aunque su función más útil sea justo buscarlas (shell.js:566-581).
- *Importa porque:* Un affordance que parece el botón de «buscar» ejecuta otra cosa, con otro alcance y otro placeholder. Y la pista de teclado es falsa para la mitad de la plantilla.
- *Arreglo:* Detectar plataforma (`navigator.platform`/`userAgentData`) y renderizar «Ctrl K» donde corresponda; ocultar el keycap cuando `bp==='mobile'` (no hay atajo posible) y sustituirlo por un botón de lupa con `aria-label="Buscar"` de 44×44 que ejecute la búsqueda. Cambiar el placeholder del palette a «Buscar menciones, ir a una pantalla, cambiar período…».

**· [S-10] /search no existe en la navegación: ningún elemento del rail queda activo y no hay forma de volver a la búsqueda** · `hierarchy`

- `apps/web/public/eco-prototype/shell.js:87-97 (getNav sin entrada 'search') · app.js:82-113 (la ruta sí existe) · screens.js:1265 (la prop setActive se recibe y no se usa…`
- En search-desktop.png los nueve elementos del rail se ven idénticos: ninguno está resaltado, porque `analysisNav` no contiene 'search' (shell.js:273 filtra sobre NAV). La pantalla solo se alcanza por Enter en el header o por ⌘K, y desde ella no hay migas de pan ni «volver a Menciones». `setActive` llega a SearchScreen y no se invoca ni una vez.
- *Importa porque:* El usuario pierde el «usted está aquí» justo en la pantalla a la que llega por un salto (no por navegación), y el rail —que es el mapa mental del producto— parece roto. Es también la razón por la que la búsqueda es invisible para quien no conoce el atajo.
- *Arreglo:* Con la fusión de S-06, la búsqueda queda bajo «Menciones» y el rail conserva su estado activo. Si se mantiene separada: añadir la entrada al NAV con badge del número de resultados, o al menos marcar «Menciones» como activo cuando active==='search' y poner un enlace «Ver este resultado en Menciones» en la cabecera de resultados (para eso está la prop setActive muerta).

**· [S-11] Los conteos por sentimiento —lo único comparativo de la barra de facetas— desaparecen justo cuando el usuario filtra** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:1425 (`filters.sentiment === 'all' && <span class="num">`) · apps/web/src/app/api/eco-mentions/route.ts:377-390 (sentAgg se calc…`
- El desglose pos/neu/neg se agrega sobre el mismo `whereClause` que filtra por sentimiento, así que al pedir «negativo» el endpoint devuelve pos=0/neu=0. La UI lo tapa mostrando los números solo en el estado «Todas», y además los pinta con `color: var(--text-3)` a 11px — en el build auditado 2.65:1, por debajo de AA.
- *Importa porque:* El dato que convierte cuatro botones en una lectura («de 1.024, 780 neutrales y 190 negativas») se borra en el momento exacto en que el usuario está comparando, y mientras se ve es el texto menos legible de la barra. La denominación desaparecida invita a leer el subconjunto como si fuera el total.
- *Arreglo:* Calcular las facetas ignorando el propio filtro de sentimiento (segundo COUNT agrupado sin esa condición, o `facets=1` en el endpoint) y mostrarlas siempre, con el chip activo destacando su porción. Subir el número a `--fs-caption` (12px) con `--text-2` y `.num` tabular; el porcentaje entre paréntesis ayuda más que el valor absoluto solo.

**· [S-12] El orden de resultados cambia por su cuenta: «Relevancia» es el estado inicial pero se pinta «Reciente», y al escribir salta sin que el usuario toque nada** · `affordance`

- `apps/web/public/eco-prototype/screens.js:1273 (useState('relevance')) · 732-735 (resolveSort) · 763-783 (SortChips resalta el orden EFECTIVO) · route.ts:403-409 (relevan…`
- Con un filtro de tópico y sin query, `sortBy='relevance'` pero `resolveSort` devuelve 'recent' y el chip activo es «Reciente». En cuanto la query alcanza 2 caracteres, el chip activo salta a «Relevancia» sin interacción. La «relevancia» real es un conteo de coincidencias en el título (0..8) y nada más: sin ponderar recencia, engagement ni alcance, y sin explicación en la interfaz.
- *Importa porque:* El orden de una lista es una afirmación sobre qué importa más. Que cambie solo, y que «Relevancia» signifique «el término sale en el título», hace que las tres primeras filas —las que se leen— dependan de una regla que nadie declaró.
- *Arreglo:* Estado inicial 'recent' y cambio de orden solo por acción explícita; si se mantiene el auto-salto, avisarlo («Ordenado por relevancia al haber término de búsqueda»). Añadir tooltip a «Relevancia»: «Prioriza coincidencias en el titular». Deshabilitado ya está bien resuelto (opacity 0.45 + title), pero conviene `aria-disabled` en lugar de solo `disabled` para que el lector de pantalla anuncie el motivo.

**· [S-13] La marca de coincidencia (<mark>) usa el color de acento, que en el build auditado es idéntico a «negativo»: un acierto se lee como alarma** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:1118 (mark con background var(--accent-fill), color var(--accent)) · index.html@8a996a8:198 y :203 (--accent: #FF6A3D === --neg:…`
- En el commit auditado (8a996a8) `--accent` y `--neg` son el mismo #FF6A3D. Las tres vistas de resultados resaltan el término con ese naranja (5.35:1 sobre el relleno, legible) exactamente en las filas donde el pill «NEGATIVO» usa el mismo tono: la fila se lee como sentimiento, no como coincidencia. La capa de tokens sembrada hoy separa --neg a #FF5470, lo que mitiga el choque, pero el <mark> sigue sin token propio y comparte color con…
- *Importa porque:* El color es el único canal que un lector usa para escanear una lista de resultados. Si «coincide con tu búsqueda» y «mención negativa» son el mismo naranja, el usuario deduce una carga negativa que el dato no afirma.
- *Arreglo:* Token propio, fuera de la escala semántica de sentimiento: `--mark-bg: rgba(255,192,67,0.18)` / `--mark-fg: #FFC043` (o un subrayado de 2px con `text-decoration-color`), y usarlo en screens.js:1118. Regla del sistema: los tres colores de sentimiento (--pos/--neu/--neg) no se usan para nada que no sea sentimiento.

**· [S-14] En el build auditado, todo chip activo queda ilegible: --on-accent no está definido y el color cae a heredado sobre relleno naranja** · `contrast`

- `apps/web/public/eco-prototype/index.html:373 ([data-theme="mando"] .chip.active { background: var(--accent); color: var(--on-accent) }) · `git show 8a996a8:…/index.html…`
- En 8a996a8 la variable --on-accent no existe en ningún bloque, así que `color: var(--on-accent)` es inválido en tiempo de cómputo y la propiedad cae a heredado (≈ --text #E6ECF3 sobre #FF6A3D = 2.85:1; si hereda --text-2, 1.08:1). En /search esto se ve en cuanto hay resultados: el ViewToggle tiene siempre un chip activo (screens.js:1473), SortChips también (1456), y los chips de sentimiento al filtrar (1423).
- *Importa porque:* El estado seleccionado —el que dice al usuario qué está viendo— es el elemento menos legible de la barra. Con texto a 11px sobre naranja saturado, un usuario de 55 años en un monitor de oficina no distingue qué vista o qué orden está activo.
- *Arreglo:* Ya resuelto en tokens.css (--on-accent #1A0A04, 6.78:1): verificar que index.html carga tokens.css antes de su <style> y añadir un fallback defensivo `color: var(--on-accent, #1A0A04)`. Añadir al especimen del sistema una fila con los cuatro estados de chip (reposo/hover/activo/deshabilitado) para que la regresión se vea.

**· [S-15] El estado vacío mezcla dos alineaciones, deja un huérfano tipográfico y cita filtros que todavía no existen en pantalla** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:1380-1387 (card padding 28, textAlign center, párrafo 12px --text-3 maxWidth 460) · 1390 y 1404 (section-eyebrow alineados a la…`
- search-desktop.png: icono y dos líneas centradas, tercera línea con la palabra «tópico.» sola, y justo debajo «TÓPICOS FRECUENTES» alineado a la izquierda con sus chips — dos ejes de alineación en una tarjeta de 380px de alto. El párrafo mide 12px con --text-3 (probe: ratio 2.65, need 4.5) y termina diciendo «usa los filtros para acotar por sentimiento, fuente o tópico», cuando la barra de facetas no se renderiza hasta que hay criterio…
- *Importa porque:* Es lo único que la pantalla dice cuando no hay nada, así que es la única oportunidad de enseñar a usarla; y enseña algo falso (unos filtros invisibles) con el texto menos legible de la página.
- *Arreglo:* Todo a la izquierda dentro de un bloque de ~52ch (los estados vacíos centrados solo funcionan cuando no llevan listas debajo). Párrafo a `--fs-body-sm` (13px) con `--text-2`. Copy que describa lo que hay: «Escribe una o más palabras clave. Se busca en titulares, texto, URL y dominio dentro del período seleccionado (7D)». Y equilibrar la última línea con `text-wrap: pretty` o recortando la frase para matar el huérfano.

**· [S-16] «No se encontraron menciones» no ofrece la salida que resolvería el 90% de los casos: ampliar el período** · `empty-state`

- `apps/web/public/eco-prototype/screens.js:1484-1493`
- El estado de cero resultados es un párrafo de 13px centrado en 40px de padding, con un único botón «Quitar filtros» y solo si hay filtros activos. No menciona el período, no ofrece ampliarlo, no sugiere quitar acentos ni buscar menos términos (la query es AND entre todos los tokens, route.ts:231-236).
- *Importa porque:* La causa más frecuente de cero resultados en esta pantalla es la ventana de 7 días (S-01), y es justo la que el mensaje no nombra ni permite corregir. El usuario abandona con la conclusión equivocada.
- *Arreglo:* Estado de cero resultados con jerarquía y acciones: título «Sin resultados para «X» en los últimos 7 días» + tres botones reales: «Buscar en todo el histórico», «Quitar filtros (2)», «Incluir baja pertinencia». Si la query tiene ≥2 tokens, sugerir la búsqueda con el token más específico solo («Probar solo «Añasco»»).

**· [S-17] En móvil, 340px (40% de la pantalla) son cromo antes del campo de búsqueda; en escritorio el header gasta una fila entera en un botón de tema** · `density`

- `apps/web/public/eco-prototype/shell.js:396-552 (header con flexWrap wrap: eyebrow + «datos al cierre» + h1 + HeaderSearch + agencia + 8 chips de período + Fechas + Chat…`
- Medido sobre las capturas: en móvil (390×844, DPR3) el bloque de cabecera termina en y≈306px CSS y el hero input arranca en y≈340px — el 40% del alto útil antes del único control que la pantalla necesita, con el input del header y el hero separados por ~100px. En escritorio (1440×900) el header ocupa 138px y su última fila contiene únicamente el botón de tema (44×30), ~44px de altura para un control que nadie usa a diario.
- *Importa porque:* En la pantalla más vacía del producto, el cromo pesa más que el contenido. En un teléfono el usuario tiene que hacer scroll para ver los primeros resultados de su propia búsqueda, y la fila del sol en escritorio comunica que el layout se desbordó.
- *Arreglo:* 1) Sacar el botón de tema del header a la ficha de usuario del rail (o eliminarlo: la app fija mando/dark). 2) En móvil colapsar los 8 chips de período en un solo botón «7D ▾» que abra una hoja inferior — hoy son 8 objetivos de 22px de alto. 3) Con S-06/S-08, un único campo de búsqueda: el hero pasa a ser la primera cosa bajo el título.

**· [S-18] En móvil la cabecera de resultados se la come el selector de vistas: el eco de la query y el conteo quedan aplastados, y «Tabla» es inusable a 390px** · `layout-rhythm`

- `apps/web/public/eco-prototype/index.html:305-313 (.card-hd display flex sin flex-wrap) · screens.js:1460-1473 (título + subtítulo + ViewToggle) · index.html:277 (.chip m…`
- .card-hd no envuelve y el ViewToggle son tres chips de ~200px que no pueden encogerse; a 390px quedan ~130px para «Resultados para «apagón Añasco»» y «1,024 menciones · página 1 de 4», que se parten en cuatro o cinco líneas. Y la tercera opción del toggle abre una tabla de 9 columnas dentro de un `overflow:auto` de 334px de ancho.
- *Importa porque:* Lo que el usuario necesita leer para saber qué está viendo (su término y cuántos resultados hay) pierde la pelea contra un conmutador de vistas que en un teléfono solo tiene una opción razonable. El reflow «funciona» —no hay desborde— pero la jerarquía se invierte.
- *Arreglo:* `.card-hd { flex-wrap: wrap }` y en móvil mover el ViewToggle debajo del título ocupando el ancho, o reducirlo a iconos de 44×44 sin etiqueta. Ocultar «Tabla» cuando bp==='mobile' (y forzar viewMode='cards' si estaba guardado en localStorage), que es el único modo con jerarquía propia en pantalla estrecha.

**· [S-19] Cuatro contratos temporales contradictorios en una sola pantalla** · `copy`

- `apps/web/public/eco-prototype/shell.js:289-299 («Ingesta en vivo» con punto --pos y clase pulse) · shell.js:218-224 (punto verde permanente en el logo) · shell.js:420-42…`
- search-desktop.png muestra a la vez: punto verde con brillo en el logo, «Ingesta en vivo · hace 6 h» con punto verde pulsante en el pie del rail, «● DATOS AL CIERRE DE AYER» en gris junto al título, el chip 7D activo, y el campo que dice «todas las menciones».
- *Importa porque:* El usuario no puede responder a la pregunta más básica antes de buscar: ¿hasta cuándo llegan estos datos? Cada elemento contesta otra cosa, y la señal más llamativa (verde + pulso) es la menos exacta.
- *Arreglo:* Un solo contrato temporal, en un solo sitio: «Datos hasta 27 jul, 11:59 PM (AST) · última ingesta hace 6 h» junto al título, en --text-2, sin verde y sin pulso (el verde es semántico de «positivo» en este producto). Quitar el punto verde del logo y el pulso del pie.

**· [S-20] Estados de carga y error incoherentes: se puede paginar un resultado que falló, y al cambiar de página no hay ninguna señal de que algo esté cargando** · `consistency`

- `apps/web/public/eco-prototype/screens.js:1497 (paginación sin guarda !error, frente a la de Menciones en 995) · 1475-1476 (el «Buscando…» solo aparece si mentions.length…`
- Tras un error, `error=true` oculta las listas pero `data.total` conserva el valor anterior, así que bajo el mensaje «No se pudo completar la búsqueda» sigue habiendo una paginación clicable de un resultado inexistente. Y al pasar a la página 2, `loading=true` pero como `data.mentions.length > 0` no se pinta nada: la tabla anterior se queda quieta ~300-800ms y luego cambia de golpe.
- *Importa porque:* Un control que promete navegar datos que ya no existen, y una lista que muta sin avisar: el usuario no sabe si está mirando la página 1 o la 2, ni si el 0 que ve es «no hay» o «falló».
- *Arreglo:* Guardar la paginación con `!error && data.total > PAGE_SIZE` y limpiar `data` en el catch. Un único patrón de carga para las tres vistas: overlay de opacidad 0.5 + `aria-busy` sobre la lista existente al paginar, y skeleton de filas en la primera carga. Extraer el trío vacío/cargando/error a un componente compartido con Menciones (hoy son cuatro dialectos distintos en el producto).

### P2 (5)

**· [S-21] Los dos únicos atajos del estado vacío no ayudan: recientes contaminados por el debounce y chips de tópicos sin conteo** · `affordance`

- `apps/web/public/eco-prototype/screens.js:1307-1319 (pushRecentSearch dentro del efecto de debounce) · 1250-1262 (localStorage 'eco.recentSearches', sin agencia ni usuari…`
- El término se guarda en recientes desde el efecto de debounce, no al confirmar: escribir despacio «huelga» graba «hu» y «huelg» como búsquedas recientes. La clave de localStorage es global, así que los términos de DDEC aparecen al cambiar a AAA o a la Gobernadora en el mismo navegador. Los chips de tópicos sí vienen ordenados por volumen (eco-data/route.ts:542, ORDER BY primary_count DESC) pero se pintan sin el `count` que ya llega en…
- *Importa porque:* Un historial lleno de fragmentos deja de ser un atajo y se convierte en ruido; y ocho chips sin cifra no dicen si «Atención ciudadana» son 400 menciones o 4 —justo la información que haría útil el atajo—. El cruce de términos entre agencias es además un pequeño problema de contexto en una consola multi-agencia.
- *Arreglo:* Guardar recientes solo al confirmar (Enter, clic en chip, o navegación con ?q=), no en el debounce. Escopar la clave por agencia (`eco.recentSearches.<agency>`). Pintar el conteo en cada chip de tópico con `.num` («Desarrollo económico 412») y hacer que el clic escriba también el nombre en el input.

**· [S-22] El ⌘K promete más de lo que hace: seis tópicos que abren la misma pantalla, «0.2K menciones» y «crear regla» que solo navega** · `affordance`

- `apps/web/public/eco-prototype/shell.js:612-614 (tópicos: label con (t.count/1000).toFixed(1)+'K', action → onNav('topics')) · 610 («Crear nueva regla de alerta» → onNav(…`
- `${t.name} · ${(t.count/1000).toFixed(1)}K menciones` convierte 412 menciones en «0.4K» y 40 en «0.0K», mientras el `fmt()` del dashboard mostraría «412». Los seis comandos de tópico ejecutan `onNav('topics')` sin pasar el slug: los seis hacen lo mismo. «Crear nueva regla de alerta» abre la pantalla de Alertas sin abrir el editor. Los resultados en vivo muestran solo el titular recortado a 80 caracteres, sin dominio, fecha ni sentimien…
- *Importa porque:* El palette es el atajo que se demuestra al cliente en los primeros dos minutos. Etiquetas que prometen un destino y entregan otro, más cifras con formato de dato falso («0.0K»), lo dejan como maqueta.
- *Arreglo:* Usar `fmt(t.count)` (o `toLocaleString('es-PR')`) en la etiqueta; pasar el slug (`onNav('topics', t.slug)`) para que cada tópico abra su drill-in; que «Crear regla» abra el editor (AlertRuleEditor, screens.js:3205) con un parámetro de arranque; y en cada resultado de mención añadir una segunda línea con dominio · fecha · pill de sentimiento.

**· [S-23] El palette no es accesible ni usable con el dedo: sin role/aria, sin trampa de foco, filas de 35px y pistas solo de teclado** · `affordance`

- `apps/web/public/eco-prototype/shell.js:655-698 (div.spotlight-backdrop sin role=dialog/aria-modal; filas con padding '9px 12px' y fontSize 13; footer con ↑↓/↵/esc) · ind…`
- El contenedor es un div sin `role="dialog"`, `aria-modal`, `aria-activedescendant` ni combobox/listbox; el foco no está atrapado, así que Tab sale al contenido de detrás. Las filas miden ~35px (por debajo de 44). En 390px, con la lista a 440px empezando en 12vh y el teclado virtual abierto, el pie con las tres pistas de teclado queda fuera de alcance y sin sentido en táctil.
- *Importa porque:* El atajo estrella queda cerrado para teclado asistido y para lectores de pantalla, y en el teléfono se comporta como una lista que no cabe con instrucciones que no aplican.
- *Arreglo:* `role="dialog" aria-modal="true" aria-label="Comando rápido"`, input con `role="combobox" aria-expanded aria-controls`, lista con `role="listbox"` y `aria-selected` en la fila activa; trampa de foco al abrir y devolución del foco al cerrar. Filas a 44px mínimo en táctil, `max-height: min(440px, 60vh)` y ocultar el pie de pistas cuando bp==='mobile'.

**· [S-24] El hero es una tarjeta que solo contiene un input: doble marco, 82px «vacíos» y un campo de texto de ~1.560px de ancho** · `layout-rhythm`

- `apps/web/public/eco-prototype/screens.js:1360-1376 (card padding 16 con un único input height 48, width 100%) · probe search-desktop: emptyCards [{el:'div.card', h:82}]`
- El probe clasifica esa tarjeta como vacía (no tiene texto). Visualmente son dos bordes de 1px concéntricos con 16px de aire muerto entre ellos (search-desktop-fold.png), y en 1440px el campo se estira a todo el ancho del contenido: una línea de texto de ~1.560px donde el cursor arranca pegado al borde izquierdo y el resultado aparece 380px más abajo.
- *Importa porque:* El contenedor no aporta información y sí ruido: compite con la tarjeta de resultados por el mismo lenguaje visual. Un campo tan ancho rompe la medida de lectura y deja el ojo sin punto de anclaje entre lo que escribe y lo que obtiene.
- *Arreglo:* Eliminar la tarjeta y dejar el input como elemento de página (o convertir la tarjeta misma en el campo, con la lupa dentro y sin borde interior). `max-width: 720px` con el botón de limpiar y el conteo de resultados en la misma línea, para que query y respuesta queden a menos de 100px de distancia.

**· [S-25] La pantalla usa ocho tamaños de letra y valores inline en lugar de la escala ya sembrada en tokens.css** · `type-scale`

- `probe search-desktop, fonts: IBM Plex Sans en 9/10/11/12/13/15/16/22 px + IBM Plex Mono en 9/10 · screens.js:1369 (fontSize 16), 1383 (15), 1384 (12), 1425/1433 (10), 14…`
- El censo de fuentes del probe da 18 elementos a 11px y 8 a 12px sobre 52 elementos de texto; los tamaños de 9 y 10px aparecen en los eyebrows y en los conteos de facetas. Nada de esto pasa por los tokens: son literales en objetos de estilo inline. La capa tokens.css (sembrada hoy, con Besley/Krub, --fs-caption 12px como piso y --text-3 a 5.00:1) existe pero esta pantalla no la consume.
- *Importa porque:* Sin escala, cada tamaño es una decisión suelta, y la consecuencia observable es que la información con más valor (los conteos, el período, el eco de la query) queda sistemáticamente en el escalón más pequeño y más apagado. Es también lo que hará que el cambio a Besley/Krub se vea desalineado: la nueva tipografía hered…
- *Arreglo:* Migrar /search primero (es la pantalla más pequeña, ~240 líneas) como prueba piloto de la capa de tokens: hero input `--fs-body-lg`, título del vacío `--fs-title-md` con --ff-display, párrafo `--fs-body-sm`/--text-2, eyebrows `--fs-overline`/--text-2, conteos y metadatos `--fs-caption`. Ningún texto por debajo de 12px salvo el overline en mayúsculas. Sirve de patrón medible para las otras nueve pantallas.


## Espaciado, radios, elevación, movimiento e inventario de primitivas de componente

*28 hallazgos*

La SPA no tiene sistema de espaciado ni de elevación: 17 valores de gap, 70 de padding, 14 de margin-top, 10 radios numéricos contra 4 tokens que casi nadie usa, y una rampa de superficies INVERTIDA en dark (`--canvas-2` #091018 es más oscuro que la card #0E1620 y queda a 1.038:1 del fondo de página, así que un panel anidado se lee como un agujero). La sombra de card en mando dark es matemáticamente invisible (1.022:1), de modo que la única señal de separación es un hairline a 6% con 1.161:1 — y la card apenas se separa del fondo a 1.090:1. Eso convierte dos problemas cosméticos en problemas de veracidad: (a) un contenedor vacío es indistinguible de uno con datos — la card "Activaciones por día" pinta 110 px de nada bajo un subtítulo que dice "11 eventos en el período"; (b) hay 24 bloques de estado vacío/carga/error copiados a mano en 3 paddings distintos porque no existe primitiva de estado. La cabecera consume 228 px antes del primer dato en escritorio y 284–306 px en móvil (34–36% del fold), con una fila entera dedicada a un botón de tema que además duplica el control que ya vive en TweaksPanel. Los eyebrows numerados 01→05 del Overview se pintan en TRES estilos tipográficos distintos, así que la secuencia no se lee como secuencia. Hay cero `prefers-reduced-motion` en todo el repo con 5 animaciones infinitas, y `HBarList` anima `width 0.3s` en cada render, lo que hace que al cambiar de periodo las barras "se muevan" como si el dato evolucionara. Faltan 14 primitivas que el código reinventa: Overlay (3 modales copiados, 3 drawers, 3 popovers, 4 recetas de backdrop, 9 z-i…

### P0 (1)

**· [P-01] No existe primitiva de estado: 24 bloques copiados a mano en 3 tamaños, y cards que renderizan vacío sin decirlo** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3400-3413`
- La card 'Activaciones por día' pinta un grid de 110px de alto (`height: 110, alignItems: 'end'`) con barras de `minHeight: 2` y NINGÚN estado vacío, bajo un subtítulo que dice literalmente `{rows.length} eventos en el período` = '11 eventos en el período'. En alerts-desktop-fold.png esa card son ~250px de negro absoluto. En paralelo, la firma `padding: N, textAlign: 'center', color: 'var(--text-3)', fontSize: 13` aparece copiada 24 vec…
- *Importa porque:* Un contenedor vacío sin estado se lee como 'cero'. Aquí el sistema afirma 11 activaciones y dibuja nada: el lector concluye que no hubo alertas en el período, que es exactamente la conclusión opuesta a la verdad, en la pantalla de vigilancia de crisis. Y como los 24 estados replicados tienen tres tamaños, el mismo men…
- *Arreglo:* Crear `<State kind="loading|empty|error|forbidden" size="sm|md|lg" title detail? action? icon?/>` con un solo padding por size (sm 16, md 24, lg 24 con altura mínima). Migrar los 24 bloques, las 4 clases narrative-empty*, `ExecStateWrap` (screens.js:5517) y el 'Sin resultados' del spotlight (shell.js:689). Añadir `empty` a la card de Activaciones por día y a todo widget que dibuje geometría derivada de un array.

### P1 (20)

**· [E-01] La rampa de superficies está invertida: un panel anidado es más oscuro que su card y casi idéntico al fondo de página** · `hierarchy`

- `apps/web/public/eco-prototype/index.html:191-192`
- En mando dark `--canvas: #0E1620` y `--canvas-2: #091018`. Medido: canvas-2 vs canvas = 1.050:1, y canvas-2 vs `--bg` #060A10 = 1.038:1. `--canvas-2` se usa indistintamente para dos roles opuestos: panel elevado dentro de una card (~14 sitios, p.ej. el insight box de shell.js:1281) y well hundido (bar-track, screens.js:3377,3391). Visible en alerts-desktop-fold.png y dashboard-desktop-fold.png: los paneles interiores parecen recortes v…
- *Importa porque:* Un usuario de gobierno no puede distinguir un panel que contiene datos de un hueco en la tarjeta. La misma superficie significa 'encima' y 'debajo' según el widget, así que la profundidad no comunica nada y el ojo tiene que releer cada bloque para saber qué agrupa con qué.
- *Arreglo:* Rampa monótona ascendente: --surface-0 #060A10 (página) → --surface-1 #121B26 (card, 1.143:1 vs L0) → --surface-2 #1A2432 (panel dentro de card, 1.109:1 vs L1) → --surface-3 #232E3D (popover) → --surface-overlay #1A2432. Token aparte y explícito para hundido: --surface-sunken #0A121B (1.085:1 POR DEBAJO de L1). Repartir los ~23 usos de var(--canvas-2) entre --surface-2 y --surface-sunken según rol. Eliminar --bg-2 (0 usos reales).

**· [E-02] La sombra de card es matemáticamente invisible en dark, así que la separación depende de un hairline a 1.16:1** · `contrast`

- `apps/web/public/eco-prototype/index.html:213-214`
- `--shadow-sm: 0 1px 0 rgba(0,0,0,0.4)` compuesto sobre `--bg` #060A10 da #04060A: ratio 1.022:1 — indetectable. `--shadow` (0 usos en la SPA) igual. La card se separa del fondo 1.090:1 y su borde `--hairline` (blanco 6%) da 1.161:1 sobre la card. En overview-mobile-fold.png las tres cards del termómetro (NEGATIVO/NEUTRAL/POSITIVO) apiladas a 12px sólo se distinguen por ese borde.
- *Importa porque:* El dashboard se usa en móvil, con luz ambiente y brillo bajo. Cuando el hairline a 1.16:1 desaparece, tres tarjetas apiladas se leen como un bloque continuo y el lector puede asociar el número 456 a la etiqueta POSITIVO. Es un error de atribución de cifra, no un problema estético.
- *Arreglo:* Retirar `box-shadow: var(--shadow-sm)` de `.card` (index.html:360) — no aporta nada. Subir la card a --surface-1 #121B26 (1.143:1 vs página) y el borde a --border-1 rgba(255,255,255,0.10) → 1.338:1 sobre la card (+15% de visibilidad de filo, sin glow). Reservar las sombras (--shadow-pop, --shadow-overlay, --shadow-sticky) exclusivamente para lo que flota sobre contenido arbitrario.

**· [E-03] El hover de las 5 KPI clickeables del Scorecard es una sombra que en dark no existe** · `affordance`

- `apps/web/public/eco-prototype/screens.js:86-87`
- `onMouseEnter` aplica `transform: translateY(-1px)` y `boxShadow: '0 6px 18px rgba(0,0,0,0.18)'`. Sobre #060A10/#0E1620 ese negro al 18% da ~1.008:1: cero. El único feedback real es 1px de desplazamiento. En dashboard-desktop-fold.png las 5 cards (NET SENTIMENT SCORE, RIESGO DE CRISIS, VOLUMEN, BRAND HEALTH, POLARIZACIÓN) sólo anuncian que son clickeables con un micro-texto 'DETALLES' de 9px (screens.js:94-96).
- *Importa porque:* Cada una de esas cards abre el MetricInsightModal con la interpretación IA de la métrica — la función más valiosa de la pantalla. Si el hover no responde y el único indicio es texto de 9px, el usuario nunca descubre que puede entrar. La función existe y es invisible.
- *Arreglo:* Reemplazar la sombra por un cambio de superficie + borde, que en dark sí lee: `:hover { background: var(--surface-2); border-color: var(--border-strong); }` con `transition: background var(--dur-2) var(--ease-std), border-color var(--dur-2) var(--ease-std)`. Conservar el translateY(-1px). Subir 'DETALLES' al mismo tamaño que la etiqueta de la KPI o sustituirlo por un chevron de 14px alineado a la derecha.

**· [E-04] Los overlays comparten superficie exacta con las cards que tapan, y el drawer no tiene sombra ni radio** · `hierarchy`

- `apps/web/public/eco-prototype/index.html:553-561`
- `.drawer` = `background: var(--canvas); border-left: 1px solid var(--hairline)` — sin box-shadow y sin border-radius. Lo mismo `.spotlight` (index.html:534), `.chat-drawer` (:570) y los 3 modales inline (shell.js:1213, shell.js:1620, screens.js:3272) usan `var(--canvas)`, el mismo valor que `.card`. Un panel de 560px se despega del contenido con un borde a 1.161:1.
- *Importa porque:* Un modal que tiene la misma superficie que las tarjetas de detrás sólo se separa por el tinte del scrim. Si el scrim falla o el usuario está a contraluz, el panel de detalle de una mención se lee como parte de la página, y el lector no sabe qué está mirando ni qué cerró.
- *Arreglo:* `--surface-overlay: #1A2432` (1.109:1 por encima de la card), `border: 1px solid var(--border-strong)` (blanco 16%), `--shadow-overlay: 0 16px 48px -12px rgba(0,0,0,0.72)` y `--highlight-top: inset 0 1px 0 rgba(255,255,255,0.06)` — el filo superior claro es la señal que en dark lee como 'levantado'. Consolidar todo en una primitiva `<Overlay variant="modal|drawer|sheet|popover|command">`.

**· [H-01] 228px de cromo antes del primer dato en escritorio y 284–306px en móvil, con una fila entera para el botón de tema** · `density`

- `apps/web/public/eco-prototype/shell.js:396-552`
- Medido en las capturas (px CSS): overview-desktop-fold header 112px + preámbulo 116px = primer dato a 228px; dashboard-desktop-fold 137+74 = 211px; overview-mobile-fold header 284px, primer dato a 423px (50% de un fold de 844px); dashboard-mobile-fold header 306px. El `flexWrap: 'wrap'` del header (shell.js:401) empuja el botón de tema (shell.js:549-551) a una segunda fila propia: 31px de botón + 12px de gap = 43px verticales para un i…
- *Importa porque:* El usuario abre el dashboard en el teléfono para saber si hay crisis. Hoy tiene que hacer scroll para ver el primer número, y la mitad de la primera pantalla la ocupan controles que ya usó (buscador, agencia, periodo) más un botón de tema que se toca una vez al año. En una consola de vigilancia, el fold es el producto.
- *Arreglo:* Una sola barra sticky de 48px (--h-bar) con controles a --h-ctl (32) / --h-tap (44 en táctil): search (flex, max 420) · PeriodPicker unificado con el chip de frescura dentro · agencia · Chat · overflow '⋯'. Eliminar el botón de tema del header (ya existe en TweaksPanel shell.js:1097-1114 y en ⌘K shell.js:601-602). En móvil: dos filas de 44px ≈ 112px. Resultado proyectado: primer dato a 139px en escritorio (−39%) y 216px en móvil (−33 a…

**· [H-02] El gap de página es igual al gap entre cards, así que las secciones no se agrupan** · `layout-rhythm`

- `apps/web/public/eco-prototype/index.html:282-289`
- `.eco-page { gap: 16px }` separa secciones de primer nivel, mientras el grid interno de cada sección usa `gap: 12` (screens.js:4197, 4370, 3370) y el label de sección usa `marginBottom: 8` (screens.js:4196). Ratio 16:12 = 1.33. En overview-desktop-fold.png el espacio entre el bloque del termómetro y la card de crisis es indistinguible del espacio entre las tres cards del termómetro.
- *Importa porque:* Sin un salto de escala claro, el lector no percibe que 'NEGATIVO/NEUTRAL/POSITIVO' son un grupo y 'RIESGO DE CRISIS' es otro asunto. En una pantalla de 5 secciones eso obliga a leer las etiquetas para reconstruir la estructura, en vez de verla.
- *Arreglo:* Escala 24 / 12 / 8 (20 / 12 / 8 en móvil): --gap-section 24 entre secciones, --gap-card 12 entre cards de una sección, --gap-item 8 entre el label de sección y su primera card. Ratio 2:1,5:1. Añadir una regla izquierda de 2px (--border-strong) al `<SectionHeader>` para que la agrupación siga siendo legible cuando el contraste de superficie baja.

**· [H-03] Los eyebrows numerados 01→05 del Overview se pintan en tres estilos tipográficos distintos** · `consistency`

- `apps/web/public/eco-prototype/screens.js:4196`
- `01 ·` usa `.section-eyebrow` (10px/700/--text-3/ls 0.14em, index.html:473). `02 ·` es un div inline DENTRO de la card (11px/600/--text-2/ls 0.08em, screens.js:4283). `03 ·` y `04 ·` usan `.card-hd-title` (12px/600/--text-2/ls 0.08em, screens.js:4334,4378). `05 ·` vuelve a `.section-eyebrow` (screens.js:4520). En overview-desktop-fold.png '01 · TERMÓMETRO' y '05 · INSIGHTS' son visiblemente más pequeños y apagados que '03 · TENDENCIA',…
- *Importa porque:* La numeración promete un orden de lectura tipo informe, pero al pintarse en tres tamaños/pesos/colores distintos la secuencia no se lee como secuencia: el ojo la interpreta como tres tipos de encabezado que casualmente empiezan con dígitos. El recurso cuesta atención y no entrega la estructura que promete. Además nadi…
- *Arreglo:* Quitar los dígitos y expresar el orden con espacio (--gap-section 24px) + regla izquierda. Dejar etiquetas informativas ('TERMÓMETRO · vs ventana previa'). Si el cliente exige mantener la numeración, renderizar los cinco desde una sola primitiva `<SectionHeader step={n}>` con un único estilo (dígito en --text-3, tabular) y siempre a nivel de página, nunca dentro de la card. Liberar el slot del eyebrow para el alcance del dato ('7 días…

**· [P-02] `.pill` se blockifica como grid item: la severidad 'ALTA' se estira a 140px y se lee como barra de magnitud** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:3421`
- `.pill` es `display: inline-flex` (index.html:386). En el historial de alertas la pill se coloca como hijo directo de un grid `gridTemplateColumns: '120px 140px 1fr 90px'` (screens.js:3419) sin `justify-self`, así que se blockifica y llena los 140px de la columna. Visible en alerts-desktop-fold.png: 'ALTA' aparece como un rectángulo relleno de ~140px de ancho, no como una etiqueta que abraza el texto. El mismo componente sí lleva `styl…
- *Importa porque:* En una tabla de alertas, un rectángulo coloreado de ancho fijo se lee como barra: el lector asume que la longitud codifica magnitud (severidad, volumen). No lo hace: es una categoría. Y como una pill 'MEDIA' mediría exactamente lo mismo, el falso eje de magnitud es además constante, lo que refuerza la lectura errónea…
- *Arreglo:* En el primitivo: añadir `justify-self: start; align-self: center; width: fit-content;` al `.pill` base (o `place-self: center start` cuando sea grid item) y exponer `block` como variante EXPLÍCITA para los pocos casos donde se quiera ancho completo. Retirar el `justifySelf` inline de shell.js:1390 una vez arreglado el base.

**· [P-03] Ocho implementaciones del rol 'etiqueta + número grande', con cuatro line-heights distintos** · `consistency`

- `apps/web/public/eco-prototype/screens.js:67`
- `KpiCard` (screens.js:67, padding 18, fontSize 30, lineHeight 1 y 1.1 según modo), `QuickMetric` (screens.js:1008, padding 16, fontSize 30, sin lineHeight), `StatBox` (screens.js:2436, sin padding, fontSize 30, marginTop 4), `.narrative-metric-value` (index.html:961, fontSize 18, lineHeight 1.2), termómetro inline (screens.js:4228, fontSize 30, lineHeight 1), crisis card inline (screens.js:4288, fontSize 30, lineHeight 1.1), MetricInsi…
- *Importa porque:* Es la causa mecánica del hallazgo F12 (cinco lenguajes visuales en cinco cards adyacentes del Scorecard): no hay un componente que imponga cómo se dice un número, así que cada pantalla lo dice a su manera y el usuario no puede comparar dos métricas de un vistazo. Los line-heights distintos hacen que números del mismo…
- *Arreglo:* Una primitiva `<Metric label word? value tone? delta? sub? spark? size="sm|md|lg" onClick? hint?/>` que fije lineHeight, alineación de línea base, la relación palabra↔número de apoyo y el patrón de delta (reusando `DeltaBadge`, screens.js:46). Borrar KpiCard, QuickMetric, StatBox y `.narrative-metric*`, y migrar los 4 sitios inline.

**· [P-04] Seis estilos tipográficos para el mismo rol de micro-etiqueta mayúscula** · `consistency`

- `apps/web/public/eco-prototype/index.html:473`
- `.section-eyebrow` 10px/700/--text-3/ls 0.14em (index.html:473, 56 usos) · `.card-hd-title` 12px/600/--text-2/ls 0.08em (index.html:378, 32 usos) · label de `KpiCard` 11px/600/--text-2/ls 0.08em (screens.js:91) · `StatBox`/`Field` 10px/700/--text-3/ls 0.1em (screens.js:2438, 4000) · `.narrative-panel-label` 10px/--text-3/ls 0.08em (index.html:1032, 7 usos) · `.narrative-metric-label` 9.5px/--text-3/ls 0.08em (index.html:955).
- *Importa porque:* Seis grafías para 'esto es el nombre de lo que sigue' hacen que el lector no pueda usar el estilo como pista de nivel: no sabe si una etiqueta encabeza una sección, una card o un campo. Es la razón directa de que la numeración 01→05 no se lea como secuencia (H-03).
- *Arreglo:* Un solo `<SectionHeader label sub? step? actions? rule?/>` con dos tamaños (page / card) y dueño de su propio espaciado inferior — hoy `.section-eyebrow` tiene 5 marginBottom inline distintos en 56 usos (0 ×2, 4 ×1, 6 ×2, 8 ×12, 10 ×12), así que la primitiva no controla ni su gap. Consolidar `.card-hd-title`, los labels de KpiCard/StatBox/Field y las dos clases narrative-* en ese componente.

**· [P-05] No hay primitiva de Overlay: 3 modales copiados carácter por carácter, 4 backdrops, 14 z-index y ningún focus-trap** · `consistency`

- `apps/web/public/eco-prototype/shell.js:1210-1217`
- El bloque `position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:'min(Npx,94vw)', maxHeight:'88vh', borderRadius:12, boxShadow:'0 24px 60px rgba(0,0,0,0.28)'` está triplicado en shell.js:1210 (MentionsSliceModal), shell.js:1617 (MetricInsightModal) y screens.js:3269 (AlertRuleEditor). Backdrops: `.spotlight-backdrop` rgba(0,0,0,.5)+blur 4px (index.html:520), `.drawer-backdrop` rgba(0,0,0,.5) sin blur (:546),…
- *Importa porque:* Cada modal nuevo se copia con sus propios valores, así que el sistema no puede evolucionar: cambiar la sombra de los overlays son 6 ediciones. Y funcionalmente el usuario paga el precio: sin focus-trap, el tabulador se escapa detrás del modal; sin scroll-lock, la página se mueve debajo; con el chat por debajo del back…
- *Arreglo:* `<Overlay variant="modal|drawer|sheet|popover|command" size anchor open onClose header footer/>` dueña de: scrim único (--scrim rgba(3,6,10,0.72), sin blur), z tokenizado (--z-pop 1100 / --z-overlay 1200 / --z-modal 1300 / --z-toast 1400), focus-trap, Escape, scroll-lock, aria-modal, restore-focus y las animaciones de entrada/salida. Un solo `<Tooltip>` que reemplace `.tt`, los 34 `title=` y los 2 tooltips SVG de charts.js:389,548. Un…

**· [M-01] Cero reglas de prefers-reduced-motion en todo el repositorio, con cinco animaciones infinitas activas** · `motion`

- `apps/web/public/eco-prototype/index.html:484-688`
- `grep -rn prefers-reduced-motion` sobre apps/web/public y apps/web/src devuelve 0 resultados. Animaciones infinitas activas: `shimmer 1.6s` (index.html:491), `pulse 2s ease-in-out` (:679, 2 usos), `ringPulse 1.6s ease-out` (:687, 0 usos), `tickerRun 60s linear` (:672), `fadeIn 0.6s infinite alternate` en el cursor de streaming del chat (chat-drawer.js:95), más `pulse 1.4s` inline (screens.js:2322).
- *Importa porque:* El producto es de uso obligado para funcionarios: no se puede elegir no usarlo. Una marquesina de 60s en movimiento continuo más un cursor parpadeando a 1,67 Hz en periferia degradan la lectura de cifras para cualquiera y son incapacitantes para usuarios con trastorno vestibular o sensibilidad al movimiento, que no ti…
- *Arreglo:* Bloque global `@media (prefers-reduced-motion: reduce)` con `animation-duration:1ms !important; animation-iteration-count:1 !important; transition-duration:1ms !important`, MÁS un estado terminal legible para las cinco infinitas (no basta con duración 1ms): `.skeleton{animation:none;background:var(--surface-sunken)}`, `.pulse{animation:none;opacity:1}`, `.ring-pulse{animation:none;box-shadow:0 0 0 2px var(--neg)}`, `.ticker-inner{anima…

**· [M-02] Las barras animan su ancho en cada render, así que al cambiar de periodo el dato parece evolucionar** · `motion`

- `apps/web/public/eco-prototype/charts.js:627`
- `HBarList` pinta el fill con `transition: 'width 0.3s var(--ease)'` sin ninguna condición, y `screens.js:1879` repite el patrón. Al cambiar el periodo en el header (shell.js:462 → `setPeriod`) el árbol se re-renderiza con datos de OTRA ventana y las barras se deslizan desde los valores anteriores.
- *Importa porque:* Una barra que crece de 40% a 70% comunica 'esto subió'. Aquí no subió nada: son dos conjuntos de datos distintos. El usuario ve una animación de crecimiento cada vez que cambia de 7D a 30D y puede leerla como tendencia. Es la definición de una animación que miente.
- *Arreglo:* Gatear la transición al caso 'mismo dataset, valor cambiado' (hover, filtro en cliente) y desactivarla en el remonte por cambio de periodo/agencia: `key={period + agency}` en el contenedor para forzar remonte sin transición, o prop `animate={false}`. Regla de sistema: el movimiento nunca representa cambio de dato salvo que el eje temporal sea el mismo.

**· [S-01] 17 valores de gap, 70 de padding y 14 de margin-top sin escala** · `density`

- `apps/web/public/eco-prototype/screens.js:1`
- Censo sobre screens.js+shell.js+charts.js+chat-drawer.js+app.js: `gap` 17 valores distintos en 301 usos (8 ×64, 6 ×48, 12 ×41, 10 ×39, 4 ×29, 16 ×26, 2 ×12, 5 ×12, 14 ×10, 20 ×9, 18 ×3, 3 ×2, 24 ×2, 1/22/0/11 ×1). `padding` 70 literales en 195 usos. `marginTop` 14 valores en 74 usos, `marginBottom` 10 en 72. En el CSS de index.html, otros 29 paddings y 10 gaps.
- *Importa porque:* Sin escala, cada card se separa de la siguiente por un valor decidido en el momento, así que dos widgets con la misma jerarquía se ven a distinta distancia y el lector no puede usar el espacio para inferir agrupación. Es también lo que hace imposible cambiar la densidad del producto de forma coherente (el control 'Den…
- *Arreglo:* Escala base 4 con un medio-paso restringido: 0/2/4/8/12/16/20/24/32/48/64 (--sp-*), más roles semánticos (--gap-cluster 4, --gap-item 8, --gap-card 12, --gap-block 16, --gap-section 24). Migración mecánica 'al paso más cercano; en empate, al vecino más frecuente': 1→2, 3→4, 5→4, 6→8 (48 usos, el mayor impacto), 10→8, 11→12, 14→12, 18→16, 22→20. Desaparecen 1,3,5,6,10,11,14,18,22. Los 146 margin-top/bottom se eliminan: el gap del padre…

**· [S-02] Nueve paddings distintos aplicados directamente a `.card`, puenteando `.card-bd`** · `density`

- `apps/web/public/eco-prototype/index.html:381`
- `.card-bd` define `padding: 16px`, pero hay 26 cards con padding inline en 9 valores: 0 ×3, 12 ×2, 14 ×2, 16 ×4, 18 ×1 (KpiCard, screens.js:81), 20 ×4, 24 ×8, 28 ×1 (screens.js:1380), 40 ×3. Además `.card-bd` recibe padding inline en 3 sitios más (20, 24, 40).
- *Importa porque:* Cards vecinas con el mismo rol tienen aire distinto: en dashboard-desktop-fold.png las 5 KPI (padding 18) están junto a la card de resumen ejecutivo (padding 20), y en mentions-desktop-fold.png las 5 QuickMetric (padding 16) junto a la card de filtros (14). El resultado es que las cifras no comparten retícula y el blo…
- *Arreglo:* `<Card pad="none|sm|md|lg">` = 0/12/16/20, con `xl` (24) reservado a modal/drawer/hero. Migración: 14→12, 18→16, 22→20, 28→24; los 13 casos de `padding: 40` NO se remapean porque son estados vacíos/carga/error y pasan a `<State size="lg">` (ver P-01). Prohibir `padding` inline en `.card` por lint.

**· [S-03] Trece alturas de control y bumps móviles fijados deliberadamente por debajo de 44px** · `touch-target`

- `apps/web/public/eco-prototype/index.html:339-342`
- El bloque móvil declara `.btn{min-height:40px}`, `.chip{min-height:34px}`, `select,input[type=date],.input{min-height:40px}` — los tres por debajo del mínimo táctil. Alturas pintadas: 21 (.btn-chip), 22 (chips de periodo, shell.js:464), 23 (.chip), 26 ('Fechas', shell.js:479), 29-31 (.btn), 30 (.narrative-day-close), 33 (.input, .narrative-search), 34/40 (bumps móviles), 38 (.chat-send), 40 (hamburguesa). Los probes registran 369 targe…
- *Importa porque:* Los ocho chips de periodo miden 22×34-41px y están separados por 0px de gap dentro de una bolsa: en un teléfono, tocar '7D' y acertar '5D' cambia la ventana de datos sin que el usuario lo note, y todos los números de la pantalla cambian. El error es silencioso porque el chip activo se marca con un fondo de 1.09:1 de c…
- *Arreglo:* Escala de alturas: --h-ctl-sm 28 (sólo ≥1025px), --h-ctl 32, --h-ctl-lg 40, --h-tap 44; padding-inline 8/12/16. `@media (max-width:1024px), (pointer:coarse) { --h-ctl-sm: var(--h-tap); --h-ctl: var(--h-tap); --h-ctl-lg: var(--h-tap); }`. En el header, fusionar la bolsa de 8 chips y el botón 'Fechas' en un único `<PeriodPicker>` (trigger de 32/44px + popover) — elimina 9 targets pequeños de un golpe. Alinear también AntD (controlHeight…

**· [H-04] En móvil el selector de agencia mide 55px mientras la bolsa de periodos mide 31px, en filas consecutivas** · `layout-rhythm`

- `apps/web/public/eco-prototype/shell.js:438-449`
- La pill de agencia tiene `padding: '6px 12px'` y contiene un `<select>` al que el bump móvil aplica `min-height: 40px` (index.html:342) → 52-55px de alto. La bolsa de periodos (shell.js:452) tiene `padding: 3` y botones de 22px → 31px. Medido en overview-mobile-fold.png y dashboard-mobile-fold.png: cinco filas de header con alturas 43 / 40 / 55 / 31 / 40.
- *Importa porque:* Cinco filas apiladas con cinco alturas distintas hacen que el header se lea como un montón de piezas sueltas, no como una barra. El control más alto (55px) es el que el usuario cambia menos (la agencia), y el más bajo (31px) el que cambia más (el periodo): la jerarquía visual está exactamente invertida respecto a la f…
- *Arreglo:* Todos los controles del header a la misma altura (--h-ctl 32 en escritorio, --h-tap 44 en táctil). Quitar el padding del wrapper de agencia y dar el alto al propio control. Dos filas de 44px en móvil como máximo: fila 1 ☰ + título compacto + búsqueda + ⋯, fila 2 periodo (scroll-x) + agencia.

**· [R-01] Diez radios numéricos contra cuatro tokens; en la misma fila del header conviven 10px, 4px y 999px** · `consistency`

- `apps/web/public/eco-prototype/index.html:16-19`
- Tokens declarados: --r-sm 6 / --r 10 / --r-lg 14 / --r-xl 20. Valores realmente pintados: 1 ×1, 2 ×7, 3 ×17, 4 ×10, 5 ×1, 6 ×15, 8 ×23, 10 ×12, 12 ×5, 999 ×8, '50%' ×20, 'inherit' ×2, `height/2` ×2. `.input` no tiene override para mando (index.html:458-468) así que conserva --r = 10px, mientras `.btn` mando es 4px (:451) y la pill de agencia 999px (shell.js:440). Visible en overview-desktop-fold.png: el buscador tiene esquinas claramen…
- *Importa porque:* El radio es la firma de la marca: cuando tres controles adyacentes tienen tres radios distintos, la interfaz parece ensamblada con piezas de tres productos. En un cliente de gobierno eso resta credibilidad al dato que muestra.
- *Arreglo:* Set final --r-none 0 / --r-xs 2 / --r-sm 4 / --r-md 6 / --r-lg 10 / --r-pill 999 / --r-circle 50%, redefinidos DENTRO de cada bloque de tema (mando 2/4/6/10, costa 3/6/10/14, gaceta 1/3/4/4 con pill 3). Mapa: 1→2, 3→4, 5→4, 8→6 (23 usos, el mayor cambio), 12→10; sobreviven 2,4,6,10,999. Eliminar los 13 overrides `[data-theme] .x{border-radius}` (index.html:366,367,396,397,432,433,450,451,468,542,543,664,665) que atropellan los tokens e…

**· [P-06] No hay primitiva de tabla: 13 plantillas de grid a mano, cada una con su propio header, hover y truncado** · `consistency`

- `apps/web/public/eco-prototype/screens.js:1199`
- 18 usos de `gridTemplateColumns` con columnas fijas, en 13 plantillas distintas: '52px 1.5fr 1.5fr 1.3fr 108px 74px 88px', '2fr 80px 80px 80px 120px 120px 30px', '24px 2fr 80px 110px 1.2fr 70px 24px', '20px 2fr 110px 110px 80px 30px', '1.6fr 1.2fr 110px 110px 110px 40px', '28px 2fr 110px 110px 1.4fr', '22px 120px 1fr 64px 12px', '20px 2fr 130px 100px 100px', '20px 1fr 90px 120px 120px' (shell.js:1377), '140px 1fr 60px', '120px 140px 1f…
- *Importa porque:* Cada tabla decide por su cuenta la altura de fila, el separador, el hover, qué columna se trunca y si hay header pegajoso. El usuario que pasa de Menciones a Alertas a Usuarios tiene que reaprender a leer una tabla tres veces, y en la de alertas la severidad se convierte en una barra falsa (ver P-02).
- *Arreglo:* `<DataTable columns={[{key,header,width,align,render,sticky?}]} rows onRowClick? dense? empty loading? error?/>` con altura de fila tokenizada (--h-row-sm 36 / --h-row 44 / --h-row-lg 52), separador --border-1, hover --surface-2, truncado por columna declarado y header sticky. Migrar las 13 plantillas y los 3 `<table>`.

**· [P-07] Los tabs de Alertas son chips y el tab activo es visualmente idéntico al botón primario de la misma fila** · `affordance`

- `apps/web/public/eco-prototype/screens.js:3125-3132`
- Los cuatro tabs (Historial, Reglas, Alertas de crisis, Reportes por correo) se renderizan como `className={'chip ' + (tab===x?'active':'')}`. En mando, `.chip.active` es `background: var(--accent); color:#fff` (index.html:437) — exactamente lo mismo que `.btn-primary` (index.html:453). En alerts-desktop-fold.png, 'Historial' (tab activo) y 'Nueva regla' (acción primaria) son dos rectángulos naranjas en la misma fila horizontal.
- *Importa porque:* El usuario no puede distinguir 'dónde estoy' de 'qué puedo hacer'. Un tab activo es un indicador de estado; un botón primario es una acción creadora. Pintarlos igual invita a pulsar 'Nueva regla' creyendo que es una pestaña, en la pantalla donde se configuran las alertas de crisis.
- *Arreglo:* `<Tabs variant="underline">` para navegación interna: sin relleno, indicador de 2px en --accent bajo el tab activo, texto en --text para activo y --text-2 para inactivos. Reservar el relleno de --accent exclusivamente para `.btn-primary`. Mantener `.chip` sólo para filtros multi-selección (Todas/Positivo/Neutral/Negativo de Menciones), que sí son toggles.

### P2 (7)

**· [R-02] Radios que crecen hacia adentro: tiles de 8px dentro de cards de 6px** · `consistency`

- `apps/web/public/eco-prototype/screens.js:2062`
- `[data-theme="mando"] .card { border-radius: 6px }` (index.html:367), pero los tiles del treemap dentro de esa card usan `borderRadius: 8` (screens.js:2062), los ítems del command palette 8px dentro de `.spotlight` a 6px (shell.js:677), y los modales 12px con paneles interiores de 8px (shell.js:1281). Visible en topics-desktop-fold.png: las esquinas de los tiles se ven 'más blandas' que el borde de la card que los contiene.
- *Importa porque:* Cuando el hijo tiene más radio que el padre, la esquina del hijo se despega del borde del contenedor y el conjunto se ve mal ensamblado. Es sutil por elemento y sistemático en toda la pantalla.
- *Arreglo:* Regla de anidamiento: el radio de un hijo nunca supera el del padre y cada nivel baja un escalón — --r-lg (overlay) → --r-md (card) → --r-sm (panel dentro de card) → --r-xs (fill dentro de track). Concretamente: tiles del treemap y filas del palette a --r-sm (4), paneles dentro de modal a --r-sm. Cambiar también `border: 1.5px` → 1px en screens.js:2063 (un borde fraccional renderiza borroso a 1x).

**· [P-08] Nueve implementaciones de barra/medidor con cuatro alturas y siete radios** · `consistency`

- `apps/web/public/eco-prototype/index.html:663`
- `.bar-track` existe (radio 999 en costa, 1px en mando) y sólo se usa 2 veces. Reimplementaciones: screens.js:1873 (h8 r4), screens.js:3377 (h8 r4), screens.js:3391 (h8 r4), shell.js:1315 (h6 r3), shell.js:1744 (h4 r2), charts.js:607 `HBarList` (trackHeight default 6), `.narrative-bar-track` (h6 r3, max-width 80, index.html:1095), `.narrative-sentiment-bar` (h10 r5, index.html:1039), `SentimentSplitBar` (h6 por defecto, screens.js:5563)…
- *Importa porque:* Las barras son el segundo lenguaje cuantitativo del producto después de los números. Con cuatro grosores distintos, una barra de 4px y una de 10px que representan el mismo tipo de proporción se perciben como métricas de importancia distinta, cuando la diferencia es sólo que las escribieron dos personas distintas.
- *Arreglo:* `<Meter value max? segments? height="xs|sm|md" tone? inset/>` con alturas 4/6/8 y radio --r-xs (2) o --r-pill según variante, track en --surface-sunken y fill con `border-radius: inherit`. Migrar los 9 sitios y borrar `.narrative-bar-track` y `.narrative-sentiment-bar`.

**· [M-03] Once duraciones, seis easings, y un switch que anima `left` en vez de `transform`** · `motion`

- `apps/web/public/eco-prototype/screens.js:3154-3155`
- El toggle de reglas activas es un track 28×16 con knob de 12px y `transition: 'all 0.2s'` sobre `left` (propiedad de layout, dispara reflow) en ambos elementos. Duraciones en el sistema: 0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.26, 0.28, 0.3, 0.6, 1.4/1.6/2/60s. Easings: `var(--ease)`=cubic-bezier(0.22,1,0.36,1), `ease`, `linear`, `ease-in-out`, `ease-out` y el default implícito. También `transition:'all 0.2s var(--ease)'` en el tile de tre…
- *Importa porque:* Once duraciones hacen que dos interacciones equivalentes (abrir un popover, abrir un drawer) respondan a ritmos distintos, y el sistema se siente inconsistente sin que el usuario sepa por qué. Animar `left` con `all` produce jank en la tabla de reglas, y el track de 16px de alto es además un target táctil imposible.
- *Arreglo:* Cuatro duraciones (--dur-1 80ms press/hover, --dur-2 140ms estado, --dur-3 200ms popover/fade, --dur-4 280ms drawer) y tres easings (--ease-out entradas, --ease-in salidas, --ease-std estado), conservando el actual como --ease-emph sólo para drawer/sheet. Mapa: 0.1/0.12→dur-1, 0.15→dur-2, 0.18/0.2/0.22→dur-3, 0.26/0.28/0.3→dur-4. Prohibir `transition: all`: enumerar propiedades. Crear `<Switch>` que anime `transform: translateX()` con…

**· [P-09] El sistema de Ant Design es una segunda gramática completa, en tema claro, embebida en un iframe de altura fija dentro de una card oscura** · `consistency`

- `apps/web/src/theme/eco-theme.ts:3-38`
- `ecoTheme` declara paleta 'Mar Caribe' en modo claro (colorPrimary #0A7EA4, colorBgContainer #FFFFFF, colorText #0E1E2C), radios 6/8/14, `controlHeight` 28/36/40 y sus propias sombras. `globals.css` añade un gradiente de sidebar #0E1E2C→#1A3548 y radios 2/3/6/8/10 con un teal que no pertenece a ningún tema activo. Ese sistema se inyecta en la SPA mando-dark vía `<iframe src="/settings/reports?embed=1" style={{height: 1200, border:'none…
- *Importa porque:* El mismo producto tiene dos identidades: el usuario que edita destinatarios de reportes sale del centro de mando oscuro a un formulario blanco con otro azul, otros radios y otras alturas de control, sin transición ni explicación. Y la altura fija de 1200px garantiza que el formulario o se recorta o deja un hueco vacío…
- *Arreglo:* Mapear los tokens de AntD a los del SPA (borderRadiusSM/borderRadius/borderRadiusLG → 4/6/10; controlHeight 28/32/40; colorBgContainer → var(--surface-1); colorBorder → var(--border-1)) y activar `theme.darkAlgorithm` cuando `data-mode="dark"`. A medio plazo, sacar el formulario del iframe y renderizarlo con las primitivas del SPA, o al menos sustituir `height: 1200` por altura negociada vía postMessage.

**· [S-04] El hairline de la card está descentrado 6px y las primitivas no poseen su propio espaciado** · `layout-rhythm`

- `apps/web/public/eco-prototype/index.html:369-381`
- `.card-hd { padding: 14px 16px 10px }` cierra con 10px y `.card-bd { padding: 16px }` abre con 16px, así que el hairline separador queda a 10px arriba y 16px abajo. En paralelo, `.section-eyebrow` (56 usos) recibe cinco `marginBottom` inline distintos: 0 ×2, 4 ×1, 6 ×2, 8 ×12, 10 ×12 (screens.js y shell.js).
- *Importa porque:* El hairline descentrado hace que el título de la card parezca 'caído' hacia el separador, un defecto que se repite en las 32 cards con header de la aplicación. Y una primitiva de etiqueta que no controla su gap significa que el mismo componente empuja su contenido a cinco distancias distintas: el ritmo vertical no pue…
- *Arreglo:* `.card-hd { padding: var(--sp-3) var(--pad-card) }` (12/16/12, simétrico) y `.card-hd + .card-bd { padding-top: var(--sp-3) }` para pegar al hairline. `<SectionHeader>` con `margin-bottom: var(--gap-item)` (8) fijo y sin override posible; los casos que hoy usan 0 pasan a un contenedor con `gap`.

**· [H-05] La altura de la cabecera está hardcodeada en dos reglas de Narrativas, así que rediseñarla rompe ese layout** · `layout-rhythm`

- `apps/web/public/eco-prototype/index.html:732`
- `.narrative-screen { min-height: calc(100vh - 140px) }` (index.html:732) y `.narrative-menu { height: calc(100vh - 140px); position: sticky; top: 12px }` (:740-742). El 140 es una estimación de la altura del header, que en realidad mide 112px en Overview y 137px en Scorecard (medido en las capturas) y 284-306px en móvil.
- *Importa porque:* Hoy ya está mal: en la pantalla de Narrativas el menú lateral queda 25-30px descuadrado respecto al viewport disponible. Y bloquea el rediseño de cabecera: bajar el header a 48px dejaría el menú de Narrativas 90px corto sin que nada avise.
- *Arreglo:* Tokenizar la altura de la barra (`--h-bar: 48px`, con override móvil a 112px) y sustituir por `calc(100vh - var(--h-bar) - var(--pad-page-y) * 2)`. Auditar el resto de constantes de layout acopladas: `height: 1200` del iframe (screens.js:3053), `height: 420` de los charts (charts.js:855,866) y `maxHeight: 440` del palette (shell.js:665).

**· [E-05] Diecisiete recetas de sombra y catorce z-index sin escala, con el chat por debajo del backdrop de drawer** · `consistency`

- `apps/web/public/eco-prototype/index.html:213-214`
- 8 sombras inline ('0 24px 60px rgba(0,0,0,0.28)' ×3, '0 8px 24px -8px' ×2, '0 10px 30px' ×2, '0 12px 32px', '0 0 6px', 'inset 0 1px 0', '0 1px 2px' ×2) + 9 en CSS ('0 0 40px rgba(0,0,0,0.45)', '0 24px 60px -20px', '-16px 0 48px -28px', '0 12px 40px -12px', '0 8px 20px', '-8px 0 30px rgba(0,0,0,0.18)', var(--shadow-sm), y los dos de ringPulse). z-index inline: 50, 80 ×2, 90, 100, 400, 2000 ×2, 2001 ×3, 2200, 2500; en CSS: 100 ×2, 120, 1…
- *Importa porque:* Sin escala, cada superficie flotante nueva se inventa un número y una sombra, y las colisiones sólo se descubren cuando un usuario ve un panel tapado. Ya hay una: el chat contextual (1999) queda por debajo del backdrop de cualquier drawer (2000), así que abrir un drawer con el chat abierto oscurece el chat.
- *Arreglo:* Cuatro tokens de sombra (--shadow-pop, --shadow-overlay, --shadow-sticky, --highlight-top) y siete de z (--z-base 0, --z-sticky 100, --z-map 400, --z-pop 1100, --z-overlay 1200, --z-modal 1300, --z-toast 1400), aplicados exclusivamente desde la primitiva `<Overlay>`. Prohibir z-index e box-shadow literales por lint.


## Sistema tipográfico de ECO + plan de migración a Besley

*19 hallazgos*

ECO no tiene escala tipográfica: 21 tamaños distintos de font-size (incluyendo seis medios-píxeles) reparten 472 declaraciones, y el **71.5% de los 8,750 nodos de texto medidos en las 40 capturas corre a ≤11px, el 47% a ≤10px, y solo el 4.4% llega a 14px o más**. La distribución de tamaños es **idéntica byte a byte en 390px y en 1440px** (cero `clamp()`, cero `font-size` dentro de un `@media`): el tipo no responde. Ese piso de 10-11px es también la causa raíz del problema de contraste — **449 de los 471 fallos WCAG (95%) están en texto ≤11px**, y 415 de ellos son `--text-3 (#525B68)` a 2.65:1, que a 10px no tiene ninguna exención de "texto grande". Para el lector real (director de agencia, 50+, monitor de oficina a ~60cm) la altura de carácter a 10px es de ~10.6 minutos de arco, muy por debajo del mínimo ergonómico de ~16′. En peso: se descargan **5 familias / 18 archivos / 208.7 KB (latin)**, de las cuales el tema `mando` pinta 3 — Newsreader (80.6 KB) e Instrument Serif (30.0 KB) se bajan para pintar **0 nodos** porque los temas `costa`/`gaceta` son inalcanzables (`app.js:185`, `useState` sin setter), e Instrument Sans se cuela por 4 reglas que piden `var(--ff-sans)`, variable que `mando` nunca redefine. Propongo una escala nombrada de **7 pasos (12/14/17/20/24/30/40 px) + un escape hatch de 11px con whitelist de 2 sitios**, con `clamp()` exactos, y un reparto Besley/Krub verificado contra los archivos reales de Google Fonts: **Besley SÍ tiene `tnum` (verificado: las 10 cifras tabulares miden 0.55 em exactos), Krub NO lo tiene** — `font-variant-numeric: tabular-nums` es…

### P0 (4)

**· [T1] El 71.5% del texto corre a ≤11px y el 47% a ≤10px; solo el 4.4% llega a 14px** · `type-scale`

- `censo agregado de shots/probe-report.json (probe.fonts, 40 capturas) — origen: index.html:378, index.html:473 y los 391 fontSize inline de screens.js/shell.js`
- 8,750 nodos de texto medidos en las 40 capturas: 9px=1,106 · 10px=3,020 · 11px=2,128 · 12px=1,476 · 13px=636 · ≥14px=384. Es decir 6,254 nodos (71.5%) a ≤11px y 4,126 (47.2%) a ≤10px. Por pantalla el peor es Tópicos: 94.0% del texto a ≤11px y 87.5% a ≤10px (topics-desktop-fold.png). Unión de declaraciones: 21 valores distintos de font-size (8.5 a 40, con seis fraccionarios), 55% de ellas ≤11px.
- *Importa porque:* El lector es un director de agencia de 50+ en un monitor de oficina. A 96 ppi y ~60 cm, 10px de IBM Plex Sans dan una altura de carácter de 1.85 mm = 10.6 minutos de arco, contra el ~16′ que las guías de ergonomía visual (ISO 9241-303 y equivalentes) fijan como mínimo y los 20-22′ de la zona cómoda. El 71.5% de la pan…
- *Arreglo:* Escala de 7 pasos con piso de cuerpo en 14px y mínimo absoluto de 12px (caption): 12/14/17/20/24/30/40, con un único escape hatch de 11px con whitelist de 2 sitios (ticks del heatmap 24×7 en charts.js:682-691 y la atribución de Leaflet en index.html:716). Krub aporta +6.6% de x-height sobre Plex Sans (0.550 vs 0.516 em medido), así que 12px de Krub rinden como 12.8px de hoy.

**· [T2] El 95% de los fallos WCAG está en texto ≤11px: el problema de contraste es el problema de tamaño** · `contrast`

- `index.html:197 (--text-3: #525B68) + index.html:473-479 (.section-eyebrow a 10px)`
- De los 471 fallos de contraste en escritorio (probe.lowContrast): 49 a 9-9.5px, 231 a 10-10.5px, 169 a 11px, 18 a 12px, 4 a ≥13px → 449/471 = 95% a ≤11px. Y 415/471 son un solo color: --text-3 (#525B68) sobre --canvas (#0E1620) = 2.65:1. Peor caso: 'div.num «22»' en el calendario de Tópicos a 10px con #8A94A1 = 1.36:1. En móvil, los mismos 471.
- *Importa porque:* A 10px no existe la exención de 'texto grande' de WCAG (arranca en 18.66px bold / 24px regular), así que el umbral aplicable es 4.5:1 y estamos a 2.65:1 — un 41% por debajo. Además la sensibilidad al contraste en frecuencias espaciales altas cae con la edad: para el público objetivo esto no es 'poco legible', es invis…
- *Arreglo:* Dos movimientos acoplados: (a) subir todo lo que hoy es 9-11px a caption (12px) o body (14px); (b) prohibir --text-3 para texto y reservarlo para hairlines/iconos decorativos — el microcopy pasa a --text-2 (#8A94A1 = 4.55:1 sobre #0E1620). Solo eso cierra ~430 de los 471.

**· [T3] El tipo no responde en absoluto: cero clamp(), cero font-size dentro de un @media** · `type-scale`

- `index.html:321-353 (bloque @media móvil, sin una sola declaración font-size)`
- grep de clamp( en index.html + los 7 .js: 0 resultados. fontSize condicionado a isMobile/bp/ecoCols: 0. font-size dentro de un bloque @media: 0. El probe lo confirma: la distribución de tamaños pintados es idéntica en los cuatro viewports — desktop {9:284,10:755,11:532,12:369,13:159,14:20,…} vs mobile {9:266,10:755,11:532,12:369,13:159,14:20,…}; los ±18 nodos de diferencia a 9px son ticks de gráfica que reflotan.
- *Importa porque:* El overhaul responsive de julio (PR #87) reflotó el layout pero dejó la tipografía congelada entre 390px y 1440px. Resultado en las dos direcciones: en móvil el párrafo del resumen ejecutivo (18px, screens.js:378) ocupa 12 líneas y toda la primera pantalla (dashboard-mobile-fold.png), mientras el eyebrow que lo etique…
- *Arreglo:* clamp() en los cinco pasos superiores, interpolando entre 390px y 1440px de viewport: --fs-display: clamp(1.875rem, 1.6429rem + 0.952vw, 2.5rem) (30→40) · --fs-metric: clamp(1.5625rem, 1.4464rem + 0.476vw, 1.875rem) (25→30) · --fs-title: clamp(1.3125rem, 1.2429rem + 0.286vw, 1.5rem) (21→24) · --fs-subtitle: clamp(1.125rem, 1.0786rem + 0.190vw, 1.25rem) (18→20) · --fs-lead: clamp(1rem, 0.9768rem + 0.095vw, 1.0625rem) (16→17). body (14)…

**· [T4] Todo campo de texto está por debajo de 16px: iOS hace zoom al enfocar y reintroduce el scroll horizontal** · `density`

- `shell.js:357 (buscador global, fontSize: 12) · index.html:465 (.input, 13px) · index.html:627 (.chat-input, 13px) · index.html:752-753 (.narrative-search, 13px) · shell.…`
- El @media (max-width: 768px) de index.html:340-342 añade min-height: 40px a .btn/.chip/.input pero NO toca font-size. Los cinco campos de texto de la app se quedan a 12-13px en móvil.
- *Importa porque:* Safari en iOS hace zoom automático de la página al enfocar cualquier input con font-size < 16px. Ese zoom deja el viewport a ~1.33× del ancho de la pantalla, es decir, reintroduce exactamente el scroll horizontal que el overhaul responsive (PR #87) eliminó y que los 40 probes confirman en 0. Un usuario que busca una m…
- *Arreglo:* Añadir al @media (max-width: 768px) existente: .input, .narrative-search, .chat-input, input[type="text"], input[type="search"], input[type="date"], textarea, select { font-size: 16px; }

### P1 (11)

**· [T5] .num no significa 'número': viste palabras, y eso bloquea la migración** · `consistency`

- `index.html:244 (.num) · screens.js:102 ({valueWord}, 30px) · screens.js:1626 ({nss.word}, 40px) · screens.js:4288 ({word}, 30px)`
- 62 elementos con className="num". Diez de ellos pisan la familia con fontFamily: 'var(--ff-display)' (screens.js:102, 115, 1030, 1626, 2072, 2440, 4228, 4288; shell.js:1286, 1644) y al menos tres no contienen una cifra sino una palabra — el número más grande de la app, 40px en screens.js:1626, es el texto 'Neutral'/'Alerta'. En dashboard-desktop-fold.png la fila del hero muestra Neutral · Alerta · 4.0K · Débil · Moderada: cuatro palabr…
- *Importa porque:* '.num' es de facto 'el look de cifra grande', no un contrato semántico. Mientras siga así, apuntar --ff-numeric a una fuente tabular reviste palabras con cifras tabulares (inocuo) y con el tracking negativo de cifras (no inocuo), y hace imposible aplicar automáticamente la regla 'las cifras van en la fuente tabular'.…
- *Arreglo:* Partir en dos: T.metric/T.display (rol 'valor destacado', vale para palabra o cifra, Besley) y el mixin T.tabular (fontFamily: var(--ff-tabular) + font-variant-numeric: tabular-nums + letter-spacing: 0), que se esparce SOLO cuando el contenido es numérico. Renombrar la clase .num a .val (display) y crear .tnum (tabular) para que el nombre deje de mentir.

**· [T6] Dos tipografías distintas para el mismo rol de 'número grande'** · `consistency`

- `index.html:244 (.num → --ff-numeric = IBM Plex Mono) vs screens.js:2072 y shell.js:1286 (.num + fontFamily: 'var(--ff-display)' = IBM Plex Sans)`
- De 62 elementos .num, 52 salen en IBM Plex Mono y 10 en IBM Plex Sans por override inline. Visible comparando capturas: en dashboard-desktop-fold.png el KPI '4.0K' tiene proporciones de mono; en topics-desktop-fold.png los '249' y '210' del mismo rol (cifra grande de tile) salen en la sans. El probe lo cuantifica: 1,838 nodos en Plex Mono (21.0%) contra 6,864 en Plex Sans (78.4%).
- *Importa porque:* El lector aprende a leer 'la fuente de máquina de escribir = dato duro'. Cuando el mismo rol aparece en dos fuentes en pantallas adyacentes, esa señal se rompe y la mono deja de significar nada. Además impide una decisión limpia en la migración: no hay una sola regla que reemplazar.
- *Arreglo:* Un solo tratamiento para cifras destacadas: Besley 600/700 + font-variant-numeric: tabular-nums (verificado: el lookup tnum de Besley mapea zero…nine a uniFF10…uniFF19 y las diez cifras miden 0.55 em exactos). La mono queda confinada a cifras en columna por debajo de 18px.

**· [T7] Un mismo rol con tres especificaciones distintas en una sola pantalla** · `hierarchy`

- `screens.js:4196 (01), screens.js:4282-4284 (02), screens.js:4334 (03), screens.js:4378 (04), screens.js:4520 (05)`
- Los cinco encabezados numerados de Overview: 01 y 05 usan .section-eyebrow (10px / 700 / 0.14em / --text-3), 02 usa un estilo inline (11px / 600 / 0.08em / --text-2), 03 y 04 usan .card-hd-title (12px / 600 / 0.08em / --text-2). Tres tamaños, dos pesos, dos trackings y dos colores para la misma cosa en un scroll (overview-desktop-fold.png).
- *Importa porque:* La numeración 01→05 promete al lector una estructura, un índice de la pantalla. Si cada peldaño del índice se compone distinto, el lector no puede usar el tamaño ni el color para saber en qué nivel está: la promesa de estructura se convierte en ruido, y la única forma de navegar es leerlo todo.
- *Arreglo:* Un token único T.eyebrow (Krub 600 / 12px / uppercase / 0.06em / --text-2) para los cinco, con el número en --accent para que el índice sea escaneable. Eliminar el estilo inline de screens.js:4282-4284 y unificar .section-eyebrow con .card-hd-title en una sola regla.

**· [T8] El tema mando pinta Instrument Sans sin querer: --ff-sans nunca se redefine** · `consistency`

- `index.html:20 (--ff-sans en :root) + index.html:230 ([data-theme="mando"] body) + index.html:693, index.html:752, index.html:772, index.html:1202`
- mando redefine --ff-display y --ff-numeric (index.html:184-186 y 215-216) pero jamás --ff-sans, y cambia la fuente del body por una regla aparte (:230). Las cuatro reglas que piden var(--ff-sans) explícitamente — .leaflet-container (:693), .narrative-search (:752), .btn-chip (:772), .narrative-related-btn (:1202) — siguen en Instrument Sans. El probe lo confirma: /narrative pinta 9 nodos en Instrument Sans (8 a 11px, 1 a 13px) y /geogr…
- *Importa porque:* Dos sans distintas conviviendo en la misma pantalla, en los controles (buscador de narrativas y chips de estado) — justo donde el usuario mira para filtrar. Y se pagan 29.2 KB de descarga por 48 nodos. Es también la prueba de que el sistema de temas está roto: un tema que cambia el body por una regla ad-hoc en vez de…
- *Arreglo:* En :root definir --ff-body y hacer --ff-sans: var(--ff-body) como alias de compatibilidad; borrar index.html:230 (es la línea que hace que la fuente de display sea la del cuerpo, y si sobrevive a la migración todo el dashboard sale en Besley); apuntar las cuatro reglas a var(--ff-body).

**· [T9] --letter-display no existe en modo oscuro: los títulos pierden su tracking, los números no** · `consistency`

- `index.html:186 (definida en mando-light) vs index.html:188-217 (mando-dark, sin definirla) · index.html:244 (.num, con fallback) · shell.js:428, shell.js:1230, shell.js:…`
- --letter-display solo aparece en los tres bloques light (:60, :123, :186). En modo oscuro no está definida. .num la consume con fallback — var(--letter-display, -0.01em) — así que en oscuro aplica −0.01em. Los 8 letterSpacing: 'var(--letter-display)' inline NO tienen fallback: la sustitución es inválida, la declaración queda 'invalid at computed-value time', la propiedad pasa a unset y letter-spacing hereda normal.
- *Importa porque:* El modo oscuro es el modo de producción (app.js:150, TWEAK_DEFAULTS mode:'dark'). O sea: en producción los <h1> y los títulos de tópico se componen SIN el ajuste óptico que sus propios números SÍ tienen, y el mismo componente se dibuja distinto en claro que en oscuro. Nadie lo detectó porque nadie usa el modo claro —…
- *Arreglo:* Mover --letter-display: -0.01em a :root (index.html:14-26) y borrarla de los tres bloques light. Ojo: al hacerlo, el tracking empieza a aplicarse en oscuro y los títulos se estrechan ~1% — es un cambio visual real que hay que anunciar, no un no-op.

**· [T10] 110.6 KB de fuentes latin descargadas para pintar cero nodos** · `type-scale`

- `index.html:10 (link de Google Fonts) · index.html:121-123, index.html:379, index.html:481 (reglas de gaceta) · app.js:185 (useState sin setter)`
- Medí la respuesta real de Google (66 @font-face, 33 URLs, content-length de cada archivo): 5 familias / 18 archivos únicos / 208.7 KB latin / 337.0 KB con latin-ext. Newsreader (80.6 KB latin, 131.0 KB con ext) e Instrument Serif (30.0 KB / 45.9 KB) solo se usan en [data-theme="gaceta"]. Y gaceta es inalcanzable: app.js:185 hace const [theme] = useState(TWEAK_DEFAULTS.theme), sin setter — mando es permanente. El probe confirma 0 nodos…
- *Importa porque:* Es más de la mitad del presupuesto tipográfico gastado en cero píxeles, en una app que además bloquea el arranque en una llamada a /api/eco-data y que se usa desde redes de agencia. Y las reglas de gaceta (index.html:379, 481) son código muerto que cualquiera que lea el CSS interpretará como una decisión de diseño vig…
- *Arreglo:* Borrar las familias serif del link y las reglas [data-theme="gaceta"]/[data-theme="costa"] junto con sus bloques de tema (index.html:31-152, :379, :481, :231). El set propuesto — Besley wght@400..800 sin itálica + Krub wght@400;500;600 + IBM Plex Mono wght@500 — es 3 familias / 10 archivos / 80.2 KB latin / 140.2 KB con ext: −62% / −58%. Verificado HTTP 200 contra Google.

**· [T11] La jerarquía se hace con versalitas apretadas y grises, el mecanismo menos legible disponible** · `hierarchy`

- `index.html:473-479 (.section-eyebrow: 10px/700/0.14em/--text-3, 44 usos) · index.html:378 (.card-hd-title: 12px/600/0.08em, 32 usos) · index.html:397 (mando .pill: 10px/…`
- 50 textTransform: 'uppercase' inline + 12 reglas CSS con uppercase; 66 letterSpacing inline con 11 valores distintos (0.02em a 0.14em); 21 usos de 0.08em y 21 de 0.1em. Y el 49.2% de todos los nodos de texto pintados es 600 o 700 (probe.fonts: 400=35.8%, 500=15.0%, 600=29.3%, 700=19.9%). Prácticamente no hay jerarquía por tamaño: el 74% de las declaraciones cae en cuatro valores contiguos (10/11/12/13).
- *Importa porque:* Tres mecanismos fallando juntos: (a) las mayúsculas eliminan las ascendentes y descendentes que dan forma reconocible a la palabra, y a 10px eso obliga a leer letra por letra; (b) 0.14em de tracking a 10px separa las letras más allá de la agrupación perceptual, así que ni siquiera queda la silueta; (c) cuando la mitad…
- *Arreglo:* Jerarquía por tamaño (7 pasos con saltos de 1.17 abajo y 1.25 arriba) y por color (--text / --text-2), no por caja y tracking. Las versalitas se limitan a UN token, T.eyebrow: 12px / 600 / 0.06em (la mitad del tracking actual) / --text-2. Eliminar el peso 700 de la UI (el énfasis fuerte pasa a Besley o a color) y dejar 500 como peso de etiqueta.

**· [T12] El título de card rompe a 3 líneas en móvil y choca con los controles de la misma fila** · `layout-rhythm`

- `index.html:378 (.card-hd-title) renderizado en screens.js:1966-1988 (cabecera de Tópicos · Vista panorámica)`
- En shots/topics-mobile-fold.png 'TÓPICOS · VISTA PANORÁMICA' ocupa tres líneas y su subtítulo 'Haz clic en un tópico para ver sus subtópicos' otras tres, apretados a la izquierda de los botones Treemap/Burbujas/Lista. Medido: la cadena mide 204.2px a 12px con 0.08em de tracking — las mayúsculas en español son ~30% más anchas que la caja baja y el tracking añade otro ~8%. En escritorio el probe ya marca como truncados los spans 'Energía…
- *Importa porque:* Es el sitio donde el cambio a Besley haría más daño: medido, la misma cadena en Besley 600 mide 245.3px (+20.1%) y 'EVOLUCIÓN MULTI-MÉTRICA' pasa de 186.7 a 232.3px (+24.4%). Un título de card que ya rompe en tres líneas pasaría a cuatro y empujaría los controles fuera de la fila.
- *Arreglo:* El título de card NO va en Besley. Krub 600 en mayúsculas mide 197.7px, un 3.2% MENOS que hoy: cabe gratis. Y donde haya ancho, pasar a caja alta y baja con T.bodyStrong (14px), que reduce el ancho otro ~25%. Añadir min-width: 0 y flex-wrap al contenedor de .card-hd (index.html:369-377) para que el título y los controles no compitan por la misma línea.

**· [T13] Dos <h1> compitiendo con 4px de diferencia: ningún salto perceptible** · `hierarchy`

- `shell.js:426-431 (h1 del header sticky, 22px/700) · screens.js:4171-4177 (h1 del hero de Overview, 26px/600)`
- En overview-desktop-fold.png se ven los dos: 'Overview' a 22px/700 en el header y 'Conversación pública de los últimos 7 días' a 26px/600 justo debajo. 4px de diferencia y el más pequeño es el más pesado. Además el h1 del header es nowrap + ellipsis y el del hero no tiene límite.
- *Importa porque:* El lector no puede saber cuál es el título de la pantalla, y un lector de pantalla anuncia dos encabezados de nivel 1 por documento. Peor: el paso 22→26 es el mismo orden de magnitud que 10→11 en el resto del sistema, así que la escala no distingue 'título de app' de 'título de contenido' de 'cifra grande' — los tres…
- *Arreglo:* Un solo T.title (24/21px, Besley 600) para el título de pantalla; el hero de Overview baja a T.subtitle (20/18) o se convierte en subtítulo del h1, y el header deja de repetirlo. Esto además ataca F11 del brief: el eyebrow + 'DATOS AL CIERRE DE AYER' + el título + la fila del botón de tema consumen ~190px antes del primer dato.

**· [T14] La única prosa real de la app (18px) no baja en móvil y se come la primera pantalla** · `density`

- `screens.js:378 (resumen ejecutivo, fontSize: 18, lineHeight: 1.45)`
- En dashboard-mobile-fold.png el párrafo ocupa 12 líneas y toda la primera pantalla del teléfono: no queda ni un KPI por encima del pliegue. El comentario del código (screens.js:376-377) dice 'Fuente reducida a 18px y line-height 1.45 (issue #1)', o sea que ya se bajó una vez para escritorio, sin considerar el móvil. Es el único nodo de la app por encima de 16px que es texto corrido (los otros 30/40px son cifras).
- *Importa porque:* El resumen ejecutivo es lo primero que lee el director y lo que resume el periodo — merece ser el texto más grande de la pantalla. Pero a ancho de teléfono, 18px con line-height 1.45 significa 12 líneas y cero contexto visible: el usuario tiene que hacer scroll a ciegas para llegar a los números que el propio párrafo…
- *Arreglo:* T.lead con clamp(1rem, 0.9768rem + 0.095vw, 1.0625rem) → 16px en el teléfono y 17px en escritorio, line-height 1.5. A 16px de Krub el párrafo cabe en ~39 caracteres por línea a 390px: 9 líneas en vez de 12, y deja ver el primer KPI. Además, capar el resumen a 60 palabras desde el prompt (hoy son 75) y mover los 3 metadatos de screens.js:386-397 (SEÑAL DOMINANTE / ALCANCE / SIGUIENTE PASO, hoy a 10px/0.1em) a T.eyebrow 12px.

**· [T15] Los ejes de las gráficas mezclan cifras tabulares y proporcionales, y a 9px en --text-3** · `data-integrity`

- `charts.js:162 y charts.js:523 (labels de fecha, sin fontFamily) vs charts.js:159, charts.js:297, charts.js:311, charts.js:441, charts.js:514 (ticks numéricos con fontFam…`
- charts.js:159 pone fontFamily="var(--ff-numeric)" en los ticks del eje Y, pero charts.js:162 dibuja las fechas del eje X sin fontFamily, así que heredan el body (proporcional). charts.js:297 y 311 usan fontSize="9" y charts.js:441 fontSize="9", todos con fill="var(--text-3)" = 2.65:1. En overview-desktop-fold.png las fechas del eje ('21 jul' … '27 jul') están al límite de lo legible.
- *Importa porque:* Un eje con dos voces tipográficas hace que el lector dude de si '43.0' y '21 jul' pertenecen al mismo sistema de medida. Y un tick a 9px con 2.65:1 no se puede leer: el usuario acaba interpretando la forma de la curva sin poder anclar ningún valor a ninguna fecha — que es exactamente el modo de lectura que produce con…
- *Arreglo:* Declarar fontFamily explícitamente en TODOS los <text> (en SVG el font-family no se hereda de forma fiable y font-variant-numeric no se aplica si no se pide): ticks numéricos con fontFamily="var(--ff-tabular)" + style={{fontVariantNumeric:'tabular-nums'}}; fechas/categorías con fontFamily="var(--ff-body)". Subir todos a fontSize="12" (caption) y fill="var(--text-2)".

### P2 (4)

**· [T16] Las flechas y símbolos vienen de fuentes del sistema, con otro peso y otro ancho** · `iconography`

- `charts.js:271 (▲/▼) · shell.js:693 (↑↓ en .kbd), shell.js:1666 (▲/▼) · screens.js:2096, screens.js:2164, screens.js:2305 (↑/↓/↔), screens.js:4234, screens.js:5580-5581,…`
- Verifiqué los cmap de los cuatro archivos reales: ninguna de las fuentes (Plex Sans, Plex Mono, Besley, Krub) tiene → ▲ ▼ ● ■ ⌘ ✕. Uso en el código: → 47× · ⌘ 14× · ▲ 5× · ▼ 5× · ↑ 4× · ↓ 4× · ✕ 2×. En overview-desktop-fold.png el ▲ de '▲+34%' no comparte grosor ni altura óptica con los dígitos de al lado. Además Besley tampoco tiene ↑ ni ↓, que Plex y Krub sí tienen.
- *Importa porque:* Cada uno de esos 61 glifos se resuelve en una fuente distinta según el sistema operativo del usuario (Apple Symbols en macOS, Segoe UI Symbol en Windows), con peso y ancho impredecibles. En indicadores de dirección — que es literalmente el signo de si una métrica sube o baja — la inconsistencia de peso hace que unos d…
- *Arreglo:* Sustituir los 61 glifos por los componentes SVG que YA existen: icons.js:20-23 exporta ArrowUp/ArrowDown/ArrowRight/ArrowLeft y TrendUp/TrendDown, y screens.js:117 ya usa <I2.ArrowUp size={11} />. Así la tipografía deja de depender de fuentes de símbolos del sistema y el cambio a Besley (que pierde ↑↓) deja de ser un riesgo.

**· [T17] Veinticuatro declaraciones en medio píxel: texto diminuto y además borroso** · `type-scale`

- `index.html:773 (10.5), index.html:830 (12.5), index.html:841 (10.5), index.html:936 (10.5), index.html:944 (9.5), index.html:956 (9.5), index.html:1001 (10.5), index.htm…`
- Seis valores fraccionarios en el sistema — 8.5, 9.5, 10.5, 11.5, 12.5, 13.5 — repartidos en 24 declaraciones. Todos por debajo de 14px.
- *Importa porque:* En una pantalla 1× (los monitores de oficina que usa el cliente) un font-size fraccionario coloca las líneas base y los trazos en medio píxel de dispositivo, y el rasterizador los reparte entre dos filas de píxeles: el texto pierde definición justo en el rango donde ya no sobraba. Es la única categoría de este informe…
- *Arreglo:* Prohibir font-size fraccionario. Los 24 sitios caen en caption (12) o body (14) con la tabla de mapeo del plan. Añadir la regla al checklist de revisión: grep -n "fontSize: *[0-9]*\.[0-9]" debe devolver 0.

**· [T18] Las páginas Next.js/AntD tienen el cuerpo MÁS GRANDE que el dashboard, y en otra fuente** · `consistency`

- `apps/web/src/theme/eco-theme.ts:31-32 (fontFamily al stack del sistema) · apps/web/src/app/layout.tsx:9-15 (<head> sin ninguna fuente) · apps/web/src/app/globals.css:38-…`
- eco-theme.ts:30-32 lleva el comentario '// Typography — system fonts, no external loading' y fija -apple-system/Segoe UI/Roboto. No declara fontSize, así que AntD usa su default de 14px. El dashboard SPA tiene como cuerpo máximo 13px y mediana 11px. Y globals.css:38-44 (.eco-sidebar-section-label) usa 10px con letter-spacing 1.5px y rgba(255,255,255,0.2) — un contraste de ~1.4:1 sobre el degradado del sidebar.
- *Importa porque:* El mismo producto tiene dos identidades tipográficas: /sign-in y /settings/reports en la fuente del sistema a 14px, y el dashboard en IBM Plex a 11px. El usuario que va de una a otra percibe dos aplicaciones distintas — y la que parece 'más cuidada' es la que tiene menos diseño. Además la paleta de AntD es otra (color…
- *Arreglo:* Extraer el bloque de tokens a un tokens.css compartido y enlazarlo desde index.html y layout.tsx; en eco-theme.ts fijar fontFamily a Krub, fontFamilyCode a IBM Plex Mono, fontSize:14, fontSizeSM:12, fontSizeLG:17, fontSizeXL:20, fontSizeHeading1..5: 30/24/20/17/14 y lineHeight 1.5/1.35. AntD no tiene token de fuente de titulares, así que Besley entra por CSS en globals.css (h1-h4, .ant-typography h1-h4, .ant-modal-title, .ant-drawer-ti…

**· [T19] .num aplica tracking negativo a cifras tabulares, y hay reglas que piden tabular-nums sin fuente tabular** · `data-integrity`

- `index.html:244 (.num: letter-spacing: var(--letter-display, -0.01em)) · index.html:1109-1112 (.narrative-bar-count: font-variant-numeric: tabular-nums sin font-family)`
- index.html:244 combina font-variant-numeric: tabular-nums con letter-spacing negativo. Y .narrative-bar-count (index.html:1109-1112) pide tabular-nums a 11px pero no declara familia, así que hereda el body: hoy funciona por accidente porque los dígitos de IBM Plex Sans ya miden 0.6 em fijos; con Krub deja de funcionar (dispersión medida del 35.1%: '1111'=23.87px vs '8888'=29.33px a 13px).
- *Importa porque:* letter-spacing en CSS añade el espacio DESPUÉS de cada carácter, incluido el último, así que una columna de cifras alineadas a la derecha queda desplazada y la retícula tabular se rompe por un margen pequeño pero sistemático. Más importante: la regla de .narrative-bar-count documenta una suposición falsa — 'pedir tabu…
- *Arreglo:* En el mixin tabular, letter-spacing: 0 siempre, y font-family: var(--ff-tabular) obligatorio junto a font-variant-numeric (nunca uno sin el otro). Añadir a la revisión: grep de 'tabular-nums' sin 'ff-tabular' en la misma regla debe devolver 0.


## Sistema de COLOR de ECO

*30 hallazgos*

El sistema de color de ECO tiene una falla de raíz — `--accent` y `--neg` son el mismo hex (#FF6A3D en dark, #C83A1E en light) — que no es cosmética: produce lecturas falsas verificables con píxeles. La escala de Brand Health pinta la banda FUERTE (la mejor) con el MISMO rojo que CRÍTICO (la peor); el gauge de NSS pinta MUY POS igual que MUY NEG; en la gráfica multi-métrica las series "NSS" y "Crisis" son indistinguibles; Twitter y YouTube comparten color en la distribución por fuente; y el mapa de Geografía en modo "Volumen" cubre Puerto Rico de burbujas naranja-alarma. A eso se suman tres desacuerdos de semántica: (a) el delta de volumen es verde-si-sube en el Scorecard y rojo-si-sube en Tópicos —el mismo dato, colores opuestos, verificado por píxel en el treemap—; (b) la leyenda de la tendencia colorea la DIRECCIÓN y no la valencia, así que "NEGATIVO ▼8.5%" (buena noticia) sale en rojo; (c) `BAND_TONE` manda FUERTE, MUY POS y ACELERADA al tono `accent`, que es el rojo. Los 103 literales hex del JS no son ruido: son cuatro paletas fósiles de otros temas (costa/gaceta/Ant Design) que conviven en la misma pantalla — el calendario de tópicos usa #2E8B6A/#C2412F mientras el treemap 400px arriba usa #3FD47A/#FF6A3D, dos verdes y dos rojos para "positivo" y "negativo". En contraste, 415 de las 471 instancias que fallan WCAG en escritorio (88%) son un solo token: `--text-3` #525B68 sobre `--canvas` #0E1620 = **2.65:1**; otras 56 son texto claro sobre rellenos (mínimo 1.36:1 en los conteos del calendario, 2.38:1 en la píldora "PICO"). Corregir dos tokens y una regla de tinta ("r…

### P0 (13)

**· [C1] --accent y --neg son el MISMO hex: 108 usos de interfaz y 96 de dato colapsan en un color** · `color-semantics`

- `apps/web/public/eco-prototype/index.html:198 y :203 (dark); :167 y :173 (light)`
- `--accent:#FF6A3D` y `--neg:#FF6A3D` en el bloque mando dark; `--accent:#C83A1E` y `--neg:#C83A1E` en mando light. ΔE(accent,neg)=0 en ambos modos. costa y gaceta NO tienen esta colisión (costa dark: accent #3FB5D8 vs neg #EF6F5A). En mentions-desktop-fold.png el mismo naranja significa seis cosas a la vez: chip activo «Todas», punto del filtro «Negativo», «VELOCIDAD Acelerada», «VIRALES 1.0K», píldoras «NEGATIVO» y toggle «Lista».
- *Importa porque:* Un director que abre la consola no puede distinguir «esto es accionable» de «esto es una alarma». Todas las demás fallas de color de esta auditoría son consecuencias de esta.
- *Arreglo:* Plan A: mover --accent al azul (#58A6FF dark / #1F5FA8 light) y dejar --neg intacto → ΔE 116/103. Sólo cambian 3 valores de token; los 96 usos de --neg (todos datos) no se tocan. Alinear --info:var(--accent) como ya hacen costa y gaceta.

**· [C2] La escala de Brand Health pinta FUERTE (la mejor banda) con el mismo rojo que CRÍTICO (la peor)** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:613-616 (BrandHealthMini) y shell.js:1580-1581 (gradiente del modal)`
- `segments = [neg 0-40%, warn 40-60%, pos 60-80%, **accent** 80-100%]`. Con accent===neg, muestreo de píxeles en dashboard-desktop-fold.png a lo largo de la barra (y=1228): x2055-2155 → (48,33,34) rojo oscuro; x2180-2230 → (255,192,67) ámbar; x2255-2280 → (20,46,41) verde oscuro; x2305-2355 → (48,33,34) **rojo oscuro otra vez**. Bajo las etiquetas 1 / 4.6 / 6.4 / 8.2 / 10.
- *Importa porque:* La métrica insignia de salud de marca tiene los dos extremos en rojo. Un BHI de 9.5/10 (excelente) se ve idéntico a un 2/10 (crisis). Es la lectura más peligrosa del dashboard.
- *Arreglo:* Cuarto segmento a `--pos-strong` (#7BE8A4 dark, 12.34:1 / #0F5F2C light, 7.42:1): mismo tono que --pos, más luminoso → la escala sube monótonamente. Mismo cambio en shell.js:1580-1581.

**· [C3] El gauge de NSS pinta MUY POS con el mismo rojo que MUY NEG** · `color-semantics`

- `apps/web/public/eco-prototype/shell.js:1596-1597`
- `gradient: linear-gradient(90deg, var(--neg) 0-30%, var(--warn) 30-45%, var(--text-3) 45-55%, var(--pos) 55-70%, **var(--accent)** 70-100%)` con labels ['MUY NEG','NEG','NEUTRAL','POS','MUY POS'].
- *Importa porque:* El MetricInsightModal del NSS —la métrica que el cliente mira primero— muestra una escala de sentimiento con rojo en los dos extremos. Sentimiento excelente indistinguible de sentimiento pésimo.
- *Arreglo:* Último tramo a `var(--pos-strong)`. Y corregir metrics-display.ts:97 donde 'MUY POS' → tono 'accent'.

**· [C4] Las series NSS y Crisis se dibujan con el mismo color en la gráfica multi-métrica** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:260 y :263`
- `seriesConfig = [{key:'nss', color:'var(--accent)'}, …, {key:'crisisRiskScore', color:'var(--neg)'}]`. En dashboard-desktop-fold.png la leyenda de «EVOLUCIÓN MULTI-MÉTRICA» muestra dos puntos naranja idénticos junto a «NSS» y «Crisis». El componente permite seleccionar hasta 3 series simultáneas.
- *Importa porque:* Seleccionar NSS + Crisis produce dos líneas del mismo color sobre el mismo lienzo, sin forma de saber cuál es cuál. El usuario atribuye el movimiento de una a la otra.
- *Arreglo:* Asignar colores desde la paleta categórica: nss→--cat-1, crisisRiskScore→--neg (es un veredicto), brandHealthIndex→--pos, totalMentions→--neu, polarizationIndex→--cat-2, engagementRate→--cat-4.

**· [C5] Twitter y YouTube comparten color en la distribución por fuente; news es verde y blog ámbar** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:290 y :544`
- `{facebook:'#0A7EA4', twitter:'var(--accent)', news:'var(--pos)', instagram:'#8B5CF6', youtube:'var(--neg)', blog:'var(--warn)'}` — cuatro de seis fuentes usan tokens semánticos, y twitter/youtube resuelven al mismo hex. screens.js:544 lo pasa como `colorFn` de la barra de TOP_SOURCES.
- *Importa porque:* Un gráfico de IDENTIDAD pintado con tokens de VEREDICTO: la prensa se ve «positiva» por ser prensa y los blogs «en alerta» por ser blogs, y dos plataformas se fusionan en una sola barra visual. Es lectura falsa, no estética.
- *Arreglo:* Paleta categórica dedicada: news→--cat-1 (#3FC8D8), facebook→--cat-2 (#B084F0), twitter→--cat-3 (#EC6FA8), instagram→--cat-4 (#AEBE4E), youtube→--cat-5 (#C9A38A), resto→--cat-other (#8D99AC). Todas ≥6.31:1 sobre --canvas y ΔE≥35 de pos/neg/warn/accent.

**· [C6] El delta de volumen es verde-si-sube en el Scorecard y rojo-si-sube en Tópicos** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:452 (verde) vs screens.js:2097-2099, 2162, 2215, 2302 (rojo); origen en apps/web/src/app/api/eco-data/route.ts:386`
- Scorecard: `deltaInfo={m.deltaDisplay.totalMentions}` → `formatDelta(cur,prev,{kind:'percent'})` SIN `invert` → toneFor('up',false)='pos' → verde («4.0K ▲+42%» en dashboard-desktop-fold.png). Tópicos: `t.delta > 0 ? 'var(--neg)' : 'var(--pos)'`. Muestreo de píxeles en topics-desktop-fold.png: el tile «Desarrollo económico» tiene título (58,193,113)=--pos y debajo «↑12%» en (255,106,61)=--neg; «Permisos y trámites» tiene título naranja…
- *Importa porque:* El mismo dato (volumen de menciones) con colores opuestos en dos pantallas, y dentro del treemap un tile se contradice a sí mismo a 20px de distancia: «este tema es positivo» + «creció, alarma». La regla «crecer es malo» acierta para tópicos negativos y miente para los positivos.
- *Arreglo:* Declarar `goodDirection` por métrica. Volumen (total y por tópico) = 'none' → delta en --delta-flat (gris) + flecha + palabra «sube»/«baja». Ninguna de las dos pantallas colorea el volumen.

**· [C7] La leyenda de la tendencia colorea la dirección, no la valencia: NEGATIVO ▼8.5% sale en rojo** · `color-semantics`

- `apps/web/public/eco-prototype/charts.js:270`
- `<span style={{ color: delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>` — sin condición ni parámetro por serie. En overview-desktop-fold.png, sección «03 · TENDENCIA · DÍA A DÍA»: «NEGATIVO 43.0 ▼ 8.5%» en rojo y «POSITIVO 36.0 ▲ 0.0%» en verde. A 300px de distancia, la card «NEGATIVO 583 ▲+34%» del termómetro (screens.js:4204-4207, invert:true) aplica la regla CONTRARIA.
- *Importa porque:* Las menciones negativas bajaron —la mejor noticia de la pantalla— se pinta como alarma; y dos reglas opuestas conviven en la misma pantalla. Además el delta se calcula contra `s.vals[0]` (el primer punto de la ventana), un tercer baseline con tratamiento visual idéntico a los otros dos.
- *Arreglo:* Pasar `goodDirection` por serie a MultiLineChart; series sin valencia (volumen, neutral) en --delta-flat; series con valencia invertida (negativo) usan `invert`. Añadir palabra («mejora»/«empeora») para no depender del color.

**· [C8] BAND_TONE manda FUERTE, MUY POS y ACELERADA al tono accent (=rojo) y ALTA polarización a verde** · `color-semantics`

- `packages/shared/src/format/metrics-display.ts:89-100`
- `FUERTE:'accent', 'MUY POS':'accent', ACELERADA:'accent'` con `TONE_COLOR.accent='var(--accent)'` (línea 82) === var(--neg). Y `ALTA:'pos'` mientras `EXTREMA:'warn'`: polarización ≥50% (mala) sale verde y ≥75% ámbar. El diccionario es global, así que el token 'ALTA' colisiona entre métricas. Confirmado en mentions-desktop-fold.png: «VELOCIDAD Acelerada» en el mismo naranja que «VIRALES 1.0K» (marcado tone="neg" a propósito).
- *Importa porque:* El formateador compartido —usado por dashboard Y por los cuatro correos— dice que el mejor Brand Health posible y el mejor NSS posible son del color de la crisis, y que polarizarse es saludable. Los correos heredan la misma tabla.
- *Arreglo:* BAND_TONE anidado por (métrica, banda): bhi{FUERTE:'pos'}, nss{'MUY POS':'pos'}, polarization{ALTA:'warn', EXTREMA:'neg', 'APÁTICA':'neu'}, velocity{todas:'neu'}. Eliminar 'accent' de MetricTone.

**· [C9] Ira, Miedo, Tristeza y Sorpresa se pintan con el gris de indiferencia: tres mapas de emoción que no coinciden** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:1777-1786 · apps/web/src/app/api/eco-data/route.ts:875-878 · infra/lambda/processor/index.ts:546-548`
- El set canónico del processor es ['frustración','enojo','alivio','gratitud','preocupación','sarcasmo','indiferencia']. El mapa del API tiene 4 claves que el processor NUNCA emite (aprobación, esperanza, alegría, confusión) y le faltan 4 que sí emite → todas caen a 'neu'. `emotionColor()` en el front IGNORA a propósito ese color y re-mapea por nombre con una tercera lista. En sentiment-desktop-fold.png la emoción DOMINANTE «Ira» (223, 2…
- *Importa porque:* La tarjeta «Emociones detectadas» promete un código de color y entrega ruido. La emoción más frecuente del periodo —ira— se ve como «indiferencia», que es exactamente la lectura opuesta para un gobierno midiendo malestar ciudadano.
- *Arreglo:* Una sola fuente: el API emite `emotionKey` (slug canónico del processor) y el front hace `var(--emo-${key})`. Borrar emotionColor() y emotionColorMap. Siete tokens --emo-* (hex y contrastes en la propuesta, todos ≥4.86:1 en ambos modos, ΔE mín. 30). Fallback visible: --emo-indiferencia + sufijo «(sin clasificar)».

**· [C10] El calendario de tópicos usa la paleta de otro tema y deja el conteo del día en 1.36:1** · `contrast`

- `apps/web/public/eco-prototype/screens.js:2454 (SENT_HEX), :2548-2573 (celdas), :2610-2612 (leyenda de opacidad)`
- `SENT_HEX = {positivo:'#2E8B6A', negativo:'#C2412F', neutral:'#7C8698'}` — hexes de costa/gaceta LIGHT. Muestreo de píxeles en topics-desktop-fold.png: la leyenda «Sentimiento del día» pinta (46,139,106)/(194,65,47)/(124,134,152) mientras el treemap 400px arriba usa (58,193,113)=--pos y (255,106,61)=--neg. Del probe: `.num «24»` = #8A94A1 sobre rgb(46,139,106) → 1.36:1 (40 instancias); nombre del tópico #E6ECF3 sobre el mismo verde → 3…
- *Importa porque:* Dos verdes y dos rojos para «positivo» y «negativo» en la misma pantalla, y el volumen del día —el dato que la celda existe para comunicar— es invisible.
- *Arreglo:* Sustituir SENT_HEX por --pos/--neg/--neu. Celdas etiquetadas: sólo 4 buckets (--seq-1,2,4,5), tinta --seq-ink-lo para 1/2 (11.30 y 6.84) y --seq-ink-hi para 4/5 (6.71 y 10.82). --seq-3 prohibido con texto (3.98/4.01, falla por ambos lados). Y arrancar en --seq-0 transparent en vez de intensity 0.3 para que «cero» no se vea como «poco».

**· [C11] Texto blanco sobre relleno lleno: 22 instancias entre 2.38 y 4.32:1, incluidos todos los botones primarios** · `contrast`

- `apps/web/public/eco-prototype/index.html:437 (.chip.active), :453 (.btn-primary), :635 (.chat-send), :905 (.narrative-status-pill)`
- Del probe-report: #FFFFFF sobre #FF6A3D = 2.85:1 (chips activos «Todas»/«Señal del día», btn-primary «Ver menciones»/«Nueva regla», 40 instancias sumando viewports); #FFFFFF sobre #FA8C16 = 2.38:1 (.narrative-status-pill «PICO», el peor texto de la app); #FFFFFF sobre #4A7FB5 = 4.20 (avatares); #FFFFFF sobre #8A94A1 = 3.07. Calculado: #fff falla sobre los CUATRO tokens semánticos (1.63–2.85) mientras #08111B pasa sobre los cuatro (6.67…
- *Importa porque:* Los botones de acción principal de una consola de gobierno no se leen. Y la regla «blanco sobre color» es sistemáticamente imposible con tokens luminosos en dark.
- *Arreglo:* Tokens --accent-ink/--pos-ink/--neg-ink/--warn-ink/--cat-ink = #08111B en dark, #FFFFFF en light. Regla dura: relleno lleno ⇒ tinta oscura; texto claro sólo sobre tinte ≤20%. .narrative-status-pill pasa a píldora tintada (2.38 → 5.35).

**· [C12] --text-3 #525B68 sobre --canvas #0E1620 da 2.65:1 y explica 415 de los 471 fallos AA (88%)** · `contrast`

- `apps/web/public/eco-prototype/index.html:197`
- Calculado: #525B68 sobre #0E1620 = 2.65, sobre #091018 = 2.78, sobre #060A10 = 2.89 (necesita 4.5). Del probe, desktop: 415 de 471 instancias son este color — `.card-hd-sub`, botones de periodo 1D…Max, `.section-eyebrow`, «hace 6 h», «NORMAL»/«NEGATIVO», `.narrative-panel-label`, y hasta `.num «Neutral»` a 30px y 40px. Por tamaño: 216 a 10px, 169 a 11px, 46 a 9px = 91.5% es texto de 9–11px. En mando light --text-3 #8A909B da 3.21:1, ta…
- *Importa porque:* Todo el tercer nivel de información del dashboard —subtítulos, unidades, marcas de tiempo, etiquetas de eje, controles de periodo— es un tier que el sistema cree que dice algo y el usuario no lee.
- *Arreglo:* --text-3: #7C8695 (4.94 dark) / #636B77 (5.38 light). --text-2: #A9B4C2 (8.66) / #454C58 (8.65). Añadir --text-disabled (#5A6472 / #9AA1AC) para lo que sí es inoperante. Pasos de L* 17.3/20.2 — más parejos, tres tiers claros, sin aplanar. Nota: no arregla que sea 9px; eso va con la escala tipográfica.

**· [C13] El mapa de Geografía en modo Volumen cubre la isla de burbujas naranja-alarma; al cambiar a Sentimiento el mismo naranja cambia de significado** · `data-integrity`

- `apps/web/public/eco-prototype/screens.js:2782`
- `colorFn={(m) => metric === 'nss' ? (m.nss > 2 ? 'var(--pos)' : m.nss < -2 ? 'var(--neg)' : 'var(--warn)') : 'var(--accent)'}`. En geography-desktop-fold.png los 78 municipios son burbujas #FF6A3D con leyenda «● Volumen» del mismo color. El canal de color no codifica nada (el tamaño ya lleva la magnitud) pero inyecta alarma.
- *Importa porque:* «Puerto Rico está en llamas» es la primera lectura, y es falsa: son sólo conteos. Peor, el mismo naranja pasa a significar «municipio negativo» al tocar el toggle, sin que la leyenda avise.
- *Arreglo:* Modo Volumen: relleno --seq-4 con radio = magnitud, o rampa --seq-1..5 por quintil. Modo Sentimiento: --pos/--neu/--neg y leyenda que cambie con el modo. El puente readToken() (charts.js:806-830) para que Leaflet siga al modo.

### P1 (10)

**· [C14] En Alertas, las barras de severidad ALTA y las de conteo de activaciones son el mismo naranja, en cards adyacentes** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:3374 vs :3392`
- Card izquierdo: `[['alta','var(--neg)'],['media','var(--warn)'],['baja','var(--text-3)']]`. Card derecho, pegado: `background:'var(--accent)'` para las 5 barras de «Reglas más activas». En alerts-desktop-fold.png las dos cards muestran barras naranja idénticas lado a lado.
- *Importa porque:* El lector escanea de izquierda a derecha y concluye «5 reglas de severidad alta» cuando el card derecho sólo dice cuántas veces disparó cada regla.
- *Arreglo:* Barras de magnitud a --seq-4 o --neu (no llevan valencia). Con accent en azul (C1) el conflicto desaparece igual, pero la barra de conteo tampoco debe ser accent: es dato, no interfaz.

**· [C15] .pill-info es visualmente idéntica a .pill-neg: 4% de opacidad las separa** · `color-semantics`

- `apps/web/public/eco-prototype/index.html:400 vs :414`
- `.pill-neg{background:var(--neg-bg); color:var(--neg)}` con --neg-bg=rgba(255,106,61,.10); `.pill-info{background:var(--accent-fill); color:var(--accent)}` con --accent-fill=rgba(255,106,61,.14). Mismo hex de texto, mismo tinte con 4% de diferencia.
- *Importa porque:* Una anotación informativa (procedencia del dato, nota de método) se lee como una alerta. En una consola de crisis eso genera falsos positivos de atención.
- *Arreglo:* --info:var(--accent) con accent en azul (C1) resuelve el hex; además separar --info-fill de --accent-fill conceptualmente y reservar .pill-info para anotaciones del sistema.

**· [C16] La escala de Polarización tiene 3 zonas de color para 4 bandas y cortes que no son los canónicos** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:467 vs shell.js:1589 vs packages/shared/src/format/metrics-display.ts:166-171`
- screens.js:467: `text-3 0-30%, warn 30-60%, #8B5CF6 60-100%` — TRES zonas, con etiquetas «APÁTICA MODERADA ALTA EXTREMA» (cuatro). shell.js:1589 usa CUATRO zonas con cortes 30/50/75 y añade un tramo --neg. La función canónica polarizationBand() corta en 30/50/75. Tres versiones de la misma escala.
- *Importa porque:* El marcador se posiciona sobre un gradiente cuyos límites no corresponden a las bandas que las etiquetas anuncian: un valor de 55% cae en la zona ámbar de la card («MODERADA») y en la violeta del modal («ALTA»). El mismo número, dos veredictos.
- *Arreglo:* Un solo generador de rampa por métrica, derivado de los cortes canónicos: polarización → --neu 0-30, --warn 30-50, --cat-2 50-75, --neg 75-100. Sustituir #8B5CF6 (10 ocurrencias) por --cat-2 (#B084F0, 6.41:1).

**· [C17] En la rampa de crisis, las zonas ALERTA y CRISIS son indistinguibles (ΔE=14)** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:34 (CRISIS_GRADIENT) y :38`
- `… #E0662E 40%-60%, var(--neg) 60%-100%`. ΔE(#E0662E,#FF6A3D)=14; contrastes 5.29 y 6.39 sobre canvas. En overview-desktop-fold.png la mitad derecha de la barra («ALERTA» + «CRISIS») se lee como una única zona naranja. #E0662E es además un literal huérfano usado 3 veces.
- *Importa porque:* El umbral operativo del producto (0.60 = CRISIS, el que dispara correos) es invisible en la escala que existe para mostrarlo. Un 0.45 y un 0.75 se ven igual.
- *Arreglo:* Tokens --crisis-1..4: #3FD47A / #FFC043 / #FF8A4C (7.79) / #E23B2E (4.72). ΔE entre los dos últimos = 28. Borrar #E0662E.

**· [C18] Los 6 estados de narrativa usan la paleta de Ant Design, que choca con los tokens semánticos, y el desconocido cae al naranja de alarma** · `consistency`

- `apps/web/public/eco-prototype/screens.js:4601-4607 y :4785`
- `{peaking:'#FA8C16', active:'#52C41A', emerging:'#13C2C2', revived:'#EB2F96', declining:'#FAAD14', dormant:'#8C8C8C'}`. Calculado: ΔE(#FA8C16,--neg)=26, ΔE(#FAAD14,--warn)=17, ΔE(#52C41A,--pos)=22 — tres colisiones. Y :4785 `NARRATIVE_STATUS_COLORS[n.status] || 'var(--accent)'` → los estados `escalating`/`sustained` (3 de las 8 narrativas en narrative-desktop-fold.png, sin punto de color en la lista) se pintan naranja en el mapa de con…
- *Importa porque:* «Decae» se lee como «advertencia» y «Activa» como «positivo»; y una narrativa cuyo estado el front no reconoce se muestra como la más urgente que existe. Además la píldora «PICO» tiene el peor contraste de la app (2.38:1).
- *Arreglo:* Seis tokens --nar-* (hex y contrastes en la propuesta). pico comparte familia con --neg a propósito: el significado ES urgencia, y compartir tono está permitido cuando el significado coincide. --nar-unknown con borde punteado para que el fallback sea visible. Píldora tintada en vez de relleno lleno con color:white.

**· [C19] mando LIGHT es alcanzable y persistente, y está roto: el mapa, el tooltip y dos tokens hardcodean valores de dark** · `consistency`

- `apps/web/public/eco-prototype/app.js:186 y shell.js:549 (alcanzable) · charts.js:810, 816, 824-826 · shell.js:761-763 · index.html:166, 174, 691-721`
- `mode` se lee de localStorage (app.js:186) y el botón del sol del header (shell.js:549) lo alterna y lo persiste (app.js:290). En light: charts.js:810 `color:'#0E1620'` (contorno azul-marino sobre mapa claro), :816 `#3FD47A/#FF6A3D/#8A94A1`, :824-826 tooltip con texto #E6ECF3 dentro de `rgba(14,22,32,.95)` (index.html:696); shell.js:761-763 los mismos 4 hex. Y calculado: --warn #B47410 = 3.86:1 y --text-3 #8A909B = 3.21:1 sobre blanco,…
- *Importa porque:* Cualquier usuario que toque el único botón de su fila (F11) queda permanentemente en un modo con el mapa ilegible y dos tokens de texto por debajo de AA. Y nadie lo ha medido.
- *Arreglo:* Helper `readToken(name)` para las opciones de Leaflet + tooltip por clase CSS tematizada (reescribir index.html:691-721 con tokens). Corregir --warn a #8A5A0B (5.92) y --text-3 a #636B77 (5.38). Correr shoot.mjs también en data-mode="light": criterio de aceptación lowContrast===0 en 80 capturas.

**· [C20] Seis combinaciones tema×modo declaradas, dos alcanzables, y las inalcanzables filtran sus hexes al CSS de producción** · `consistency`

- `apps/web/public/eco-prototype/index.html:31-152 (costa+gaceta) · :522, :548, :718, :1009 · screens.js:674, :2454, :2610-2612 · shell.js:202, :223, :244-245`
- 124 líneas de CSS para costa y gaceta + 13 overrides `[data-theme=]` + 14 condicionales `theme === 'gaceta'` en shell.js, todo inalcanzable (app.js:185 no expone setTheme). Y su paleta se filtró: index.html:718 y :1009 usan `rgba(63,181,216,…)` (cyan costa) dentro del CSS activo; screens.js:674 pinta la leyenda del heatmap con `rgba(11,95,128,…)` (azul costa) mientras las celdas usan naranja mando; screens.js:2454 y 2610-2612 usan #2E8…
- *Importa porque:* Cada combinación multiplica la superficie donde el color se escapa del sistema. La leyenda del heatmap y su mapa no coinciden porque son de temas distintos; el logo tiene cuatro familias de color en 200×60px.
- *Arreglo:* Borrar los 4 bloques de tema y los 13+14 overrides. Promover los tokens de mando dark a `:root` INCONDICIONAL con `:root[data-mode="light"]` como único override — esto también arregla F5 (el error boundary blanco-sobre-blanco cuando App revienta antes del useEffect de app.js:319-320). Si la demo de 3 temas tiene valor comercial, va a un theme-showcase.html fuera del bundle.

**· [C21] El favicon del producto no es del color del producto: cyan #2A92B5 vs logo naranja con borde y badge teal** · `iconography`

- `apps/web/public/eco-prototype/icon.svg:3-6 · shell.js:201-204, :213-217, :223, :244-245`
- icon.svg hardcodea `#2A92B5` (que es --accent-2 de COSTA) en los arcos y el punto. shell.js:213-217 pinta los mismos arcos con `var(--accent-2)` = #FF8A63 naranja. shell.js:202 borde `rgba(125,183,172,.18)` (teal), :244-245 badge v2.3 con fondo `rgba(125,183,172,.12)`, borde `rgba(125,183,172,.2)` y texto `var(--accent-2)` naranja. shell.js:223 glow del punto «en vivo» en `rgba(107,158,127,.6)` (#6B9E7F, de la paleta de tópicos) mientr…
- *Importa porque:* La pestaña del navegador y la esquina superior izquierda de la app son de colores distintos. Cuatro familias de color en la zona de marca es lo primero que ve un funcionario al abrir la consola.
- *Arreglo:* Tokens --brand-mark/--brand-tile-a/--brand-tile-b/--brand-line. Con --accent en azul (C1) el favicon cyan y la marca convergen naturalmente: icon.svg pasa a #58A6FF y los arcos a var(--brand-mark). El glow del punto en vivo usa color-mix del propio --pos.

**· [C22] Los tópicos tienen dos identidades de color según la vista, y su paleta está duplicada 4 veces (una copia muerta)** · `consistency`

- `apps/web/public/eco-prototype/screens.js:311, :1998, :2448, :4143 (paleta) · :2451 (colorFor sin usar) · :2101-2103 y :2153 (identidad por sentimiento)`
- El array `['#E1767B','#4A7FB5','#6B9E7F','#C08457','#8B6BB0','#D4A73E','#5A9FA8','#A3624D']` está copiado literal en cuatro sitios. En el treemap y las burbujas el color del tópico se deriva de su SENTIMIENTO dominante (pos/neg/warn); en openTopicSlice y el calendario se deriva del ÍNDICE en la paleta. `colorFor` (:2451) se declara y nunca se usa: los puntos de «Tópicos del período» son todos var(--text-3) (:2601). Contrastes de la pal…
- *Importa porque:* «Energía e infraestructura» es naranja en una pantalla y taupe en otra: no hay forma de seguir un tópico entre vistas. Y la paleta de identidad usa colores que ya significan veredicto.
- *Arreglo:* Una sola constante exportada con --cat-1..5 + --cat-other (≥6.31:1, ΔE≥35 de los semánticos). Un tópico = un --cat-N estable por slug en TODAS las vistas; el sentimiento dominante se expresa con la barra de distribución, que ya existe. Borrar colorFor o usarla en los puntos de la lista.

**· [C23] El chip del icono de KpiCard siempre usa el tinte naranja aunque el icono sea verde o violeta** · `consistency`

- `apps/web/public/eco-prototype/screens.js:90`
- `<div style={{ background:'var(--accent-fill)', color: accent }}><IconC color={accent}/></div>` con accent variable por card: var(--pos) en Brand Health, #8B5CF6 en Polarización, var(--text-2) en Volumen, var(--neg) en Crisis. En dashboard-desktop-fold.png el corazón verde de Brand Health y el asterisco violeta de Polarización se sientan sobre un tinte naranja.
- *Importa porque:* Cinco cards adyacentes con cinco iconos de colores distintos sobre el mismo tinte: el tinte deja de significar nada y el conjunto se lee como decoración, no como código.
- *Arreglo:* `background: color-mix(in oklab, ${accent} 14%, var(--canvas))` — el tinte deriva del propio color del icono. Aprovechar para eliminar accent="var(--accent)" del NSS (screens.js:430) y accent="var(--neg)" del Crisis (:437), que hoy dan a dos cards el MISMO borde superior naranja de 2px.

### P2 (7)

**· [C24] openEmotionSlice construye var(--neu), una variable que no existe en ningún tema** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:1560`
- `const accent = \`var(--${e.color})\`;` con e.color ∈ {pos,neg,warn,neu} desde route.ts:883. `--neu` no está declarada en ninguno de los 6 bloques de tema. Es exactamente el bug que el comentario de screens.js:1762-1765 dice haber arreglado («--neu no existe como CSS var»), sobreviviendo 200 líneas más arriba. 4 de las 8 emociones que el API devuelve tienen color 'neu'.
- *Importa porque:* La mitad de los modales de emoción abren con el acento sin resolver (borde/barra invisible). Silencioso: no hay error de consola.
- *Arreglo:* Declarar --neu (#8D99AC dark / #4A5567 light, 6.31 y 7.54) y migrar a `var(--emo-${emotionKey})` según C9. --neu también reemplaza el color-mix de .pill-neu (index.html:404-412).

**· [C25] Cero se pinta como poco en los dos heatmaps** · `chart-honesty`

- `apps/web/public/eco-prototype/screens.js:688 y :2548`
- Heatmap horario: `rgba(255,106,61, 0.08 + intensity*0.85)` — una franja con 0 menciones se pinta con 8% de naranja. Calendario: `intensity = 0.3 + (c.volume/maxV)*0.7` — arranca en 30%.
- *Importa porque:* En un mapa de calor, distinguir «no hubo actividad» de «hubo poca» es la mitad del valor del gráfico. Hoy el fondo del mapa insinúa actividad donde no hay.
- *Arreglo:* --seq-0: transparent con `box-shadow: inset 0 0 0 1px var(--hairline)`. Los buckets 1..5 arrancan en el primer valor >0. El vacío se ve vacío.

**· [C26] El rail de navegación tiene el texto inactivo en 4.32:1 y las hairlines estructurales en 1.19:1** · `contrast`

- `apps/web/public/eco-prototype/index.html:209 (--rail-fg) y :193 (--hairline)`
- Calculado: `rgba(255,255,255,.44)` sobre --rail-bg #030609 resuelve a #727475 → 4.32:1 (falla 4.5 por poco). --hairline `rgba(255,255,255,.06)` resuelve a #1C242D → 1.16:1 sobre canvas; --hairline-strong .12 → 1.51. WCAG 1.4.11 pide 3:1 para límites que transmiten información (separadores de fila en tablas de datos, subrayado del tab activo).
- *Importa porque:* Nueve etiquetas de navegación permanentes por debajo de AA, y los separadores de las tablas de menciones —que definen qué campo pertenece a qué fila— casi invisibles.
- *Arreglo:* --rail-fg a `rgba(255,255,255,.58)` → 6.86:1. Separar --hairline (decorativo, .07 = 1.19) de --hairline-strong (estructural, .34 = 3.10 dark / #8F96A0 = 3.00 light). Y añadir --rail-active-line: el estado activo del nav deja de depender sólo de un tinte.

**· [C27] Los overlays y sombras tienen cuatro valores distintos, dos de ellos en azul costa** · `consistency`

- `apps/web/public/eco-prototype/index.html:522, :530, :548, :552, :1233`
- `.spotlight-backdrop{background:rgba(11,26,38,.4)}` y `.drawer-backdrop{rgba(11,26,38,.4)}` — #0B1A26 es el --text de COSTA light. Se sobreescriben con `[data-mode="dark"] rgba(0,0,0,.5)`; `.narrative-day-overlay` usa `rgba(0,0,0,.4)` sin override. Tres valores para la misma capa.
- *Importa porque:* Los modales oscurecen el fondo con intensidades distintas según de qué pantalla vengan, y el valor base es de un tema muerto. Se nota al abrir ⌘K y luego el drawer de una narrativa.
- *Arreglo:* Un solo `--overlay: rgba(2,6,11,.62)` dark / `rgba(14,17,22,.44)` light, usado por spotlight-backdrop, drawer-backdrop, eco-menu-backdrop y narrative-day-overlay. Elimina también el override [data-mode="dark"].

**· [C28] En la card NEGATIVO del termómetro, el punto de categoría y el delta son el mismo naranja con dos significados apilados** · `color-semantics`

- `apps/web/public/eco-prototype/screens.js:4190 y :4204-4207`
- `{name:'Negativo', accent:'var(--neg)', invert:true}` → el punto de 8px usa --neg (IDENTIDAD: bucket negativo) y `dColor` usa --neg cuando delta>0 (VEREDICTO: empeoró). En overview-desktop-fold.png la card muestra «● NEGATIVO / 583 44% / ▲+34%» con el punto y la flecha del mismo hex a 30px de distancia.
- *Importa porque:* El lector no puede saber si el naranja del delta dice «esto pertenece al grupo negativo» o «esto empeoró». Cuando el delta baja el color cambia a verde dentro de una card cuyo punto sigue naranja: dos códigos de color compitiendo en 100px².
- *Arreglo:* El punto de categoría a --neg; el delta a --delta-worse/--delta-better (mismo valor hoy) y con prefijo textual «empeora»/«mejora», para que la distinción no dependa del color (WCAG 1.4.1).

**· [C29] Tokens sin dueño: --info con 0 usos en 11k líneas y --accent-2 con 9** · `consistency`

- `apps/web/public/eco-prototype/index.html:207 (--info) y :199 (--accent-2)`
- `grep -o "var(--info)" *.js index.html | wc -l` → 0. `var(--accent-2)` → 9 usos, de los cuales 4 son los arcos del logo y 1 el badge v2.3. --info está declarado en los SEIS bloques de tema (6 líneas mantenidas para nada) y en mando es el único tema donde no es igual al accent.
- *Importa porque:* Un token declarado y no usado es una promesa que el sistema no cumple: la próxima persona que necesite un color «informativo» inventará un literal en vez de usarlo (que es exactamente cómo llegamos a 103).
- *Arreglo:* --info: var(--accent) (patrón de costa y gaceta) y usarlo donde hoy hay --text-3 haciendo de anotación: «sin base de comparación», notas de método, el tooltip de «cada mención cuenta una vez». --accent-2 se restringe a hover y marca, documentado en el bloque.

**· [C30] El color es el único portador de la valencia en deltas y estados: falla WCAG 1.4.1** · `copy`

- `apps/web/public/eco-prototype/screens.js:46-58 (DeltaBadge), :4234-4235, charts.js:270-272`
- DeltaBadge renderiza `{info.arrow} {info.value}` con `color: toneC`. La flecha ▲/▼ codifica DIRECCIÓN, nunca valencia: «▲+12 pts» en Riesgo de crisis y «▲+42%» en Volumen son glifos idénticos con veredictos opuestos, distinguibles sólo por el color. Un deuteranope (≈6% de hombres) no distingue #3FD47A de #FF6A3D con fiabilidad a 11px.
- *Importa porque:* Los correos y el dashboard comunican «mejora» y «empeora» exclusivamente por color, en un producto de gobierno sujeto a criterios de accesibilidad.
- *Arreglo:* Añadir la palabra al DeltaDisplay y renderizarla (visible en desktop, .sr-only en móvil si el espacio aprieta): «▲ +12 pts · empeora». Y todo estado (narrativa, severidad) lleva glifo además de color: ▲▲ pico, ▲ emergente, ▼ decae, · dormida.


## Refutados

**[OV-06] El "TOTAL DEL PERIODO" de la tabla de tópicos no es la suma de sus filas: faltan 118 menciones (9%) sin fila que las absorba** — REFUTADO por causa (c) artefacto del harness + (b) el comportamiento no puede ocurrir en producto. 1) El descuadre es literalmente la aritmética de la fixture del propio harness, no del producto. `/private/tmp/.../scratchpad/fixtures/overview.json` trae `totals = {total: 1329, positive: 294, neutral: 483, negative: 552}` y 8 filas escritas a mano (253+213+173+159+133+106+93+80 = 1,210) → hueco de 119, y NINGUNA fila con `isOther` ni `isUnclassified`. La captura `overview-desktop.png` (1,313 vs 1,195, hueco 118) es la misma fixture con jitter. Es decir: el auditor midió su propio generador de datos. 2) La fixture viola el contrato del API, así que la premisa "8 filas con nombre propio" es imposible en prod. `packages/shared/src/aggregations/sentiment-report.ts:97` fija `TOP_N_TOPICS = 7`; :295-310 cortan a 7 clasificadas y empujan SIEMPRE `Otros tópicos (N)` cuando `rest.length > 0`; :31…

**[SC-07] El estado vacío se presenta como veredicto tranquilizador: 'NORMAL' en verde y un pico de actividad inventado** — El titular del hallazgo no se sostiene: ningún componente muestra "NORMAL" en verde cuando no hay dato. (1) OVERVIEW: `OverviewHighlights` tiene guarda explícita antes de llamar a `crisisBand` — `if (m.crisisRiskScore == null) return null;` (screens.js:4255), así que con score nulo la card entera (palabra, barra y knob) NO se renderiza. (2) SCORECARD: la KpiCard de "Riesgo de crisis" NO usa `cb.label`; usa `m.display.crisis.word` / `.value` / `.tone` (screens.js:437), que vienen del backend vía `@eco/shared/format`. Con raw null, `formatMetric` devuelve `emptyDisplay()` = `{word:'—', value:null, band:null, tone:'neutral'}` (packages/shared/src/format/metrics-display.ts:214-216, test explícito en metrics-display.test.ts:100-104), y el fallback local de data.js:52-59 es idéntico ('—', tone neutral, color var(--text-3)). El delta sale "— sin base" (DeltaBadge, screens.js:50). Es decir, el…

**[SEN-01] El hero dice "Neutral" con el doble de menciones negativas que positivas: dos escalas de NSS y bandas medidas contra la equivocada** — REFUTADO por (a) ubicación mal leída y (c) artefacto del harness. 1) `eco-data/route.ts:824` NO emite el NSS del TIMELINE. Está dentro del `.map()` de **MUNICIPALITIES** (`/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/apps/web/src/app/api/eco-data/route.ts:818-834`, campo `nss` de cada municipio, usado solo por Geografía). El NSS por día del TIMELINE se emite en `route.ts:258` (`nss: Number(s.nss ?? 0)`) — pasa el valor del snapshot **sin dividir**. 2) El hero de /sentiment no mezcla dos escalas: palabra y número salen del MISMO objeto. `screens.js:1626` imprime `m.display.nss.word` y `:1627` imprime `m.display.nss.value`, y ese objeto lo produce una sola llamada `formatMetric('nss', winCur.nss)` en `route.ts:359`. `formatMetric` (metrics-display.ts:255-259) deriva banda y número del mismo `raw`, así que son consistentes por construcción. 3) En producción `winCur` vi…

