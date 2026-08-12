# Overview

El **Overview** es la pantalla de resumen diario: la lectura rápida de cómo está la
conversación. Es el **espejo en pantalla del [reporte semanal por correo](reportes-correo.md)**,
así que si recibes ese correo reconocerás aquí la misma estructura, pero interactiva y para
cualquier [período](primeros-pasos.md#selector-de-período).

Para abrirla, pulsa **Overview** en la barra lateral.

## Para qué sirve

Responde de un vistazo a "¿cómo vamos?": cuántas menciones hubo, si predomina lo positivo o
lo negativo, cómo evolucionó día a día, qué temas mandaron y qué se dijo de más impacto.
Cuando necesites análisis más fino (métricas compuestas, drill-down por hora o geografía),
pasa al [Scorecard](dashboard-scorecard.md).

## Cómo leer la pantalla

La pantalla está organizada de arriba hacia abajo en estos bloques:

### 1. Termómetro — totales por sentimiento

Tres cifras grandes con el total de menciones **positivas**, **neutrales** y **negativas**
del período seleccionado. Cada una trae un **delta** que la compara con el **período
anterior equivalente** (por ejemplo, los 7 días previos a los 7 días que estás viendo). Una
flecha y un color indican si subió o bajó.

- Lee primero la proporción entre las tres: ahí está el tono general de la conversación.
- Lee después los deltas: te dicen si la situación **mejora o empeora** respecto al período
  anterior, que suele ser la pregunta más accionable.

El significado de "positivo / neutral / negativo" está en
[Conceptos · Sentimiento](../fundamentos/conceptos.md#sentimiento). El indicador que resume
todo esto en un solo número es el [NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score),
que verás en el [Scorecard](dashboard-scorecard.md).

### 2. Serie temporal diaria

Una gráfica con la evolución día a día del volumen de menciones, desglosada por sentimiento.
Sirve para ver **tendencias** y **picos**: un día con un salto inusual de menciones
negativas salta a la vista aquí.

Puedes **hacer clic en un día** de la serie para abrir el detalle de ese día (volumen,
desglose por sentimiento y acceso a las menciones de esa fecha).

### 3. Top tópicos con sentimiento

La lista de los temas que más conversación concentraron en el período, cada uno con su
volumen y su mezcla de sentimiento. Te dice **de qué se está hablando** y si cada tema juega
a favor o en contra.

Al hacer clic en un tópico vas a su análisis detallado (ver [Tópicos](topicos.md)). El
concepto de tópico y la diferencia entre conteo primario y secundario están en
[Conceptos · Tópicos](../fundamentos/conceptos.md#tópicos).

### 4. Sentimiento por fuente

El reparto del sentimiento según el tipo de [fuente](../fundamentos/glosario.md#términos-generales)
(redes, noticias, blogs, foros). Útil para saber **dónde** está pasando la conversación y si
una fuente concreta es la que arrastra el tono. Para el desglose completo por fuente, ver
[Sentimiento](sentimiento.md).

### 5. Top menciones

Una selección de las menciones más relevantes del período. Al hacer clic en cualquiera se
abre su **ficha de detalle** (ver [Menciones · Ficha de detalle](menciones.md#ficha-de-detalle-de-una-mención)),
con el texto, las métricas de interacción, las emociones detectadas, el tópico, la geografía
y menciones similares.

### Insights de IA del período

Bajo el resumen, ECO muestra un bloque de **insights generados por IA** que interpreta en
texto qué pasó en el período: lo más negativo, lo más positivo y un resumen general. Si el
bloque dice **GENERANDO…**, es que la IA está calculando esos textos en ese momento;
aparecerán solos en unos segundos. Cómo leer estos textos y qué significan los estados de
carga está en [Insights de IA](insights-ia.md).

## Tareas frecuentes

- **Comparar con el período anterior** — mira los deltas del termómetro. Cambia el
  [período](primeros-pasos.md#selector-de-período) para comparar ventanas distintas.
- **Investigar un día puntual** — haz clic en ese día de la serie temporal.
- **Pasar de un tema a sus menciones** — haz clic en un tópico de la lista, o abre una de las
  top menciones.
- **Analizar una campaña concreta** — usa el
  [rango de fechas personalizado](primeros-pasos.md#rango-de-fechas-personalizado).

## Relación con el reporte por correo

El Overview con el período **7D** se parece mucho a lo que llega en el
[reporte semanal](reportes-correo.md). La diferencia clave: el panel usa una ventana rolante
que **incluye hoy**, mientras que el correo cubre una semana **cerrada terminando ayer**. Por
eso, si comparas el correo de la mañana con el Overview, los totales pueden diferir
ligeramente — es esperado.
