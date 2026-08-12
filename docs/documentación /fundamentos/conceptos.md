# Conceptos clave

Los pilares de ECO explicados. Para definiciones de una línea ver el
[Glosario](glosario.md); para los números ver
[Metodología de métricas](metodologia-metricas.md).

## Menciones y fuentes

La **mención** es la unidad básica de ECO. Cada publicación que habla del tema vigilado
—un *tweet*, un *post* de Facebook, una noticia, un comentario en un foro— entra al
sistema como una mención con sus datos: autor, fecha de publicación, texto, fuente,
interacciones (*likes*, comentarios, *shares*) y alcance estimado.

Las menciones vienen de distintas **fuentes**: redes sociales (Facebook, X/Twitter,
Instagram, YouTube), medios de noticias, blogs y foros. ECO normaliza todas a un mismo
formato para poder compararlas y agregarlas.

Antes de contar, ECO **deduplica**: cuando la misma publicación llega repetida, se marca
como duplicado y no infla las cifras.

## Sentimiento

El **sentimiento** clasifica cada mención como **positiva**, **neutral** o **negativa**
según el tono hacia la agencia. Lo asigna un modelo de IA leyendo el texto (no solo
buscando palabras), por lo que entiende ironía, contexto y matices mejor que un sistema
de palabras clave.

El sentimiento es la base del indicador más usado, el [NSS](metodologia-metricas.md#nss-net-sentiment-score):
si hay más menciones positivas que negativas, el NSS es positivo, y viceversa.

> **Sentimiento ≠ emoción.** El sentimiento es la dirección (a favor / en contra /
> neutral). La **emoción** es el matiz: una mención negativa puede ser de *enojo* o de
> *miedo*, y eso cambia cómo se debe responder.

## Pertinencia

No todo lo que menciona un nombre es relevante. La **pertinencia** (alta / media / baja)
mide qué tan relacionada está realmente una mención con la agencia y sus temas. Sirve
para separar la conversación que importa del ruido (homónimos, menciones de pasada,
*spam*). Varias métricas dan más peso a las menciones de **alta pertinencia**.

## Tópicos

Los **tópicos** son los temas de conversación que le interesan a cada agencia
(configurables). Una misma mención puede tocar varios tópicos a la vez, así que la
clasificación es **multi-clase**: cada mención se asigna a todos los tópicos relevantes,
y el de mayor confianza se considera su **tópico primario**.

Esto permite dos lecturas: cuántas menciones tienen un tópico como *principal*
(conteo primario) y en cuántas más *aparece* aunque no sea el principal (conteo
secundario). Los tópicos pueden tener **subtópicos** para un análisis más fino.

## Narrativas

Una **narrativa** es un grupo de menciones que cuentan, en el fondo, **la misma
historia**. ECO las detecta automáticamente agrupando menciones por **similitud
semántica** (de qué hablan), no por palabras exactas. Así, "la nueva inversión en la
zona industrial" y "el anuncio de empleos en la planta" pueden caer en la misma
narrativa aunque no compartan palabras.

Cada narrativa tiene un **ciclo de vida** que refleja su momento:

- **Emergente** — recién aparece, todavía pequeña.
- **Activa** — con volumen sostenido.
- **En pico** — su momento de máxima actividad.
- **En declive** — perdiendo fuerza.
- **Dormida** — sin actividad por un tiempo prolongado.
- **Revivida** — vuelve a tener actividad tras estar dormida.

De cada narrativa, ECO identifica a su **iniciador**: el **primero** que la publicó
(cronológicamente) y el **más influyente** (el de mayor alcance). Y traza **conexiones**
entre narrativas cuando comparten menciones, comparten autores o son semánticamente
parecidas, lo que permite verlas como un **mapa** de la conversación.

## Crisis

ECO no espera a que una crisis sea evidente. Calcula de forma continua un **riesgo de
crisis** combinando varias señales: cuánta conversación negativa hay, si el **volumen**
se está disparando respecto a lo normal, qué tan **pertinente** es esa conversación y
cuántos datos respaldan la lectura (para no alarmar con poco volumen).

El resultado es un valor de 0 a 1 con cuatro **bandas** de lectura sencilla —
*Normal, Elevado, Alerta, Crisis*— en lugar de un simple "sí/no". Cuando el riesgo cruza
un umbral, ECO puede enviar una alerta por correo. Ver
[Metodología](metodologia-metricas.md#riesgo-de-crisis).

## Geografía

La conversación no es homogénea por territorio. ECO geolocaliza las menciones y permite
ver la percepción **por región y por municipio**. En Puerto Rico esto cubre los 78
municipios, lo que ayuda a detectar focos locales (un problema concentrado en una zona)
que el promedio nacional ocultaría.

## El recorrido del dato

Estos conceptos encajan en una secuencia: una **mención** entra desde una **fuente**, la
IA le asigna **sentimiento**, **emociones**, **pertinencia**, **tópicos** y
**geografía**; con muchas menciones clasificadas se calculan las **métricas** diarias,
se agrupan en **narrativas** y se evalúa el **riesgo de crisis**; y todo eso se entrega
en el panel, los reportes y las alertas. El "cómo" de cada paso está en la
[Documentación Técnica](../tecnica/README.md).
