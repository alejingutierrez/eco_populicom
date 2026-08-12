# Narrativas

La pantalla de **Narrativas** muestra las "historias" que ECO detecta automáticamente dentro
de la conversación: grupos de menciones que cuentan, en el fondo, lo mismo. A diferencia de
los [tópicos](topicos.md) (una taxonomía fija de temas), las narrativas **emergen solas** por
similitud de significado y tienen su propio ciclo de vida.

Para abrirla, pulsa **Narrativas** en la barra lateral.

Conviene leer primero qué es una narrativa, su ciclo de vida y las conexiones entre ellas:
[Conceptos · Narrativas](../fundamentos/conceptos.md#narrativas).

## El grafo de narrativas

El centro de la pantalla es un **grafo**: cada **nodo** es una narrativa y cada **línea** que
une dos nodos es una [conexión](../fundamentos/glosario.md#narrativas) (comparten menciones,
comparten autores o son semánticamente parecidas). El grafo se acomoda solo para que las
narrativas relacionadas queden cerca.

Cada nodo codifica dos señales:

- **Tamaño** — proporcional al **número de menciones** de la narrativa (las más grandes son
  las más voluminosas).
- **Color** — el **estado del ciclo de vida** de la narrativa (ver la tabla abajo).

**Haz clic en un nodo** para abrir su [panel de detalle](#panel-de-detalle).

Sobre el grafo, una barra de resumen indica cuántas narrativas y conexiones hay visibles y
cuántas hay de cada estado.

## Filtrar por estado

El **ciclo de vida** de una narrativa refleja su momento. Puedes filtrar el grafo para ver
solo los estados que te interesen:

| Estado | Significado |
|---|---|
| **Emergente** | Recién aparece, todavía pequeña. |
| **Activa** | Con volumen sostenido. |
| **Pico** | Su momento de máxima actividad. |
| **Decae** | Perdiendo fuerza. |
| **Revivida** | Vuelve a tener actividad tras estar dormida. |
| **Dormida** | Sin actividad por un tiempo prolongado. |

Usa el selector **Filtrar por estado** (admite varios a la vez) en la cabecera. Para vigilar
lo que está naciendo, filtra por **Emergente** y **Activa**; para entender una crisis pasada,
añade **Pico** y **Decae**.

El botón de **recargar** vuelve a traer los datos más recientes.

## Control de línea de tiempo

Bajo el grafo, el **control de línea de tiempo** (timeline slider) acota el rango de fechas
visible. Al moverlo, el grafo muestra solo las narrativas **nacidas** dentro del intervalo
seleccionado, junto con sus conexiones. Es la forma de "rebobinar" y ver cómo era el mapa de
conversación en un momento dado, o de aislar las narrativas de una semana concreta.

## Panel de detalle

Al hacer clic en una narrativa se abre un panel con todo su perfil:

- **Resumen** — una descripción de qué trata la narrativa.
- **Palabras clave** — los términos que la caracterizan.
- **Métricas** — número de menciones, engagement y alcance totales, y su velocidad reciente
  (cuánta actividad en las últimas 24 horas).
- **Estado** y fechas clave — cuándo **nació**, cuándo llegó a su **pico** y la fecha de su
  **última mención**.
- **Iniciadores** — quién **inició** la narrativa: el **primero** (cronológicamente) y el
  **más influyente** (el de mayor alcance). Ver
  [Conceptos · Narrativas](../fundamentos/conceptos.md#narrativas).
- **Línea de tiempo** — la evolución diaria de las menciones de la narrativa, desglosada por
  sentimiento, desde su nacimiento hasta hoy.
- **Top autores** — las cuentas que más contribuyeron a la narrativa, por engagement.
- **Plataformas** — el reparto de la narrativa por tipo de fuente.
- **Narrativas conectadas** — las otras narrativas con las que se relaciona, con el tipo y la
  fuerza de cada conexión; sirven para saltar de una historia a las que la rodean.
- **Menciones recientes** — las últimas publicaciones de la narrativa, con acceso al detalle.

## Cómo se generan

Las narrativas y sus conexiones se **calculan automáticamente** a partir de las menciones; el
sistema las refresca periódicamente. Si una agencia se acaba de incorporar o se acaba de
activar la función, el grafo puede aparecer vacío hasta que se procese la conversación: ECO te
lo indicará con un mensaje. Ver [Preguntas frecuentes](faq.md#la-pantalla-de-narrativas-está-vacía).

## Tareas frecuentes

- **Ver qué está naciendo** — filtra por estado **Emergente**.
- **Encontrar quién impulsa una historia** — abre la narrativa y mira sus **iniciadores** y
  **top autores**.
- **Entender cómo creció algo** — revisa la **línea de tiempo** del panel de detalle.
- **Explorar historias relacionadas** — salta por las **narrativas conectadas**.
- **Reconstruir un momento** — usa el **control de línea de tiempo** para acotar fechas.
