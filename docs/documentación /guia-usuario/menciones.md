# Menciones

La pantalla de **Menciones** es el feed de publicaciones individuales que ECO recogió: cada
fila es una [mención](../fundamentos/conceptos.md#menciones-y-fuentes) (un post, una noticia,
un comentario). Aquí buscas, filtras y abres el detalle de cada una. Es donde aterrizas
cuando, desde cualquier otra pantalla, haces clic para "ver las menciones detrás" de un
número.

Para abrirla, pulsa **Menciones** en la barra lateral.

## Buscar por texto

La **búsqueda de texto completo** filtra las menciones que contienen tu término en el título
o en el contenido. Escribe una palabra o frase y la lista se reduce a las coincidencias
dentro del [período](primeros-pasos.md#selector-de-período) activo.

También puedes buscar menciones desde cualquier pantalla con el
[buscador de comandos (⌘K)](primeros-pasos.md#buscar-y-saltar-rápido-k).

## Filtros

Puedes combinar varios filtros a la vez para acotar exactamente lo que buscas. Los
disponibles son:

| Filtro | Qué hace |
|---|---|
| **Sentimiento** | Positivo, neutral o negativo. Ver [Sentimiento](../fundamentos/conceptos.md#sentimiento). |
| **Fuente** | Facebook, X/Twitter, Instagram, YouTube, noticias, blogs, foros. |
| **Tópico** | Menciones de un tema concreto. Ver [Tópicos](topicos.md). |
| **Subtópico** | Una subdivisión de un tópico. |
| **Municipio** | Menciones geolocalizadas en un municipio. Ver [Geografía](geografia.md). |
| **Región** | Menciones de una región (Metro, Sur, Centro-oriental, Oeste, Norte, Este). |
| **Emoción** | Una emoción detectada (alegría, miedo, enojo, etc.). |
| **Día de la semana** | Lunes a domingo (hora de Puerto Rico). |
| **Hora** | Una hora concreta del día (0–23, hora de Puerto Rico). |
| **Pertinencia** | Alta, media o baja. Ver [Pertinencia](../fundamentos/conceptos.md#pertinencia). |
| **Engagement mínimo** | Solo menciones con interacción por encima de un umbral (filtro "virales"). |

> **Nota sobre pertinencia.** Por defecto, ECO **excluye las menciones de baja pertinencia**
> para que el feed muestre conversación relevante y no ruido. Si filtras explícitamente por
> pertinencia "baja", sí las verás. El concepto está en
> [Pertinencia](../fundamentos/conceptos.md#pertinencia).

> **Sobre el conteo por tópico.** Cuando filtras por un tópico, por defecto verás las
> menciones donde ese tópico es el **principal** (el de mayor confianza), de modo que el
> conteo coincida con el del [Overview](overview.md) y el [Scorecard](dashboard-scorecard.md).
> Hay un toggle para incluir también las menciones donde el tópico aparece como
> **secundario**. La distinción primario/secundario está en
> [Conceptos · Tópicos](../fundamentos/conceptos.md#tópicos).

ECO también **descarta duplicados**: cuando la misma publicación se replica en muchos sitios
(habitual en crisis), se conserva una sola copia, así que el conteo del feed cuadra con el de
las demás pantallas.

## Qué muestra cada fila

Cada mención del feed presenta, de un vistazo:

- El **título o el extracto** del contenido.
- La **fuente** y el **dominio** de origen.
- El **autor**.
- El **sentimiento** (etiqueta de color: positivo / neutral / negativo).
- La **fecha relativa** ("hace 2 h", "hace 3 d").
- Señales de **engagement** (interacciones) cuando las hay.

## Paginación

El feed carga las menciones por páginas. Usa los controles de paginación para avanzar; cada
página trae un bloque de resultados ordenados de la más reciente a la más antigua dentro del
período y los filtros activos.

## Ficha de detalle de una mención

Al hacer clic en cualquier mención (aquí o en otras pantallas) se abre un **panel lateral de
detalle** con todo lo que ECO sabe de ella:

- **Cabecera** — sentimiento, dominio y fecha.
- **Título y autor**.
- **Métricas** — engagement, likes, comentarios y compartidas (solo se muestran las que
  tienen valor).
- **Resumen IA** — un resumen breve del contenido generado por IA, cuando está disponible.
- **Contenido** — el texto de la publicación.
- **Emociones detectadas** — las emociones que la IA identificó (puede haber varias).
- **Tópicos y subtópicos** — el tópico principal con su **nivel de confianza**, y los
  subtópicos asociados.
- **Geografía detectada** — un mini mapa con el municipio y la región de la mención, cuando
  está geolocalizada. El botón **Ver en mapa** te lleva a [Geografía](geografia.md) centrada
  en ese municipio.
- **Relacionadas** — menciones **similares** por contenido (ver abajo).
- **Ver original** — abre la publicación original en su sitio, en una pestaña nueva.

### Menciones similares ("Relacionadas")

En la ficha de detalle, el bloque **Relacionadas** muestra otras menciones parecidas a la que
estás viendo. La similitud se calcula por el **significado** del texto (no por palabras
exactas), así que agrupa publicaciones que hablan de lo mismo aunque usen términos distintos.
Si la mención todavía no tiene esa información calculada, ECO muestra como alternativa
menciones del mismo tópico principal. Al hacer clic en una relacionada, su propia ficha se
abre en el panel.

## Tareas frecuentes

- **Ver solo lo negativo de hoy** — período **1D** + filtro de sentimiento **negativo** (o el
  atajo del [buscador ⌘K](primeros-pasos.md#buscar-y-saltar-rápido-k)).
- **Encontrar lo viral** — usa **Engagement mínimo** para quedarte con lo más compartido.
- **Rastrear un tema en una zona** — combina filtro de **tópico** + **municipio** o
  **región**.
- **Investigar un pico** — filtra por **día de la semana** y **hora** de la franja sospechosa.
- **Leer la publicación original** — abre la ficha y pulsa **Ver original**.
