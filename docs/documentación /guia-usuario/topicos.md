# Tópicos

La pantalla de **Tópicos** es el análisis temático: qué temas concentran la conversación,
cómo se reparte su sentimiento, cómo evolucionan en el tiempo y qué subtemas los componen.

Para abrirla, pulsa **Tópicos** en la barra lateral. Responde al
[selector de período](primeros-pasos.md#selector-de-período) y de
[agencia](primeros-pasos.md#selector-de-agencia).

Antes de leerla conviene entender qué es un tópico y la diferencia entre conteo **primario** y
**secundario**: [Conceptos · Tópicos](../fundamentos/conceptos.md#tópicos).

## Vista panorámica

La parte superior muestra todos los tópicos del período con tres formas de verlos,
intercambiables con un toggle:

- **Treemap** — rectángulos cuyo tamaño es proporcional al volumen y cuyo color refleja el
  sentimiento dominante. Da la foto de "qué pesa más".
- **Burbujas** — los tópicos como círculos; útil para comparar magnitudes de un vistazo.
- **Lista** — una tabla ordenada, con el conteo y las cifras de cada tópico.

En cualquiera de las tres, el **color indica el sentimiento dominante** del tópico (positivo,
negativo, neutral o mixto). **Haz clic en un tópico** para entrar a su detalle.

### Conteo primario y "+N también lo tocan"

El número principal de cada tópico es su **conteo primario**: menciones donde ese tópico es
el de **mayor confianza**. Es el mismo criterio que usan el [Overview](overview.md), el
[Scorecard](dashboard-scorecard.md) y el [reporte por correo](reportes-correo.md), para que
las cifras cuadren entre pantallas.

Junto a él puede aparecer "**+N también lo tocan**": son menciones donde el tópico aparece,
pero como tema **secundario**. Así una misma mención que habla de varios temas cuenta una sola
vez en su tópico principal, sin desaparecer del todo de los demás.

## Calendario de tópico dominante

Bajo la panorámica, un **calendario** muestra, día a día, **cuál fue el tópico que dominó la
conversación** ese día, con un color por tópico. Sirve para ver cómo se van turnando los
temas a lo largo del tiempo y detectar el día en que un tema irrumpió.

Al hacer clic en un día del calendario se abre el detalle de ese día para ese tópico, con un
acceso a sus menciones (ver [Menciones](menciones.md)).

## Detalle de un tópico

Al entrar a un tópico verás:

### Descripción IA del período

Un texto breve generado por IA que explica **de qué trató ese tópico en el período
seleccionado**. Es específico del rango de fechas que estés viendo: la descripción de "Empleo"
en una semana de anuncios de inversión no será la misma que en una semana de cierres. Si dice
**Generando descripción para este periodo…**, la IA está calculándola; aparecerá en unos
segundos (ver [Insights de IA](insights-ia.md)).

### Evolución del tópico

Una gráfica con la **evolución diaria** de las menciones del tópico (en hora de Puerto Rico),
para ver si crece, decae o tiene picos. En las vistas de lista, cada tópico muestra además un
**sparkline** (mini gráfica de tendencia) para una lectura rápida.

### Subtópicos

Los **subtópicos** que componen el tema, cada uno con su volumen y, cuando está disponible,
una breve descripción de qué cubre ese subtema. Permiten bajar un nivel de granularidad: por
ejemplo, dentro de "Turismo", distinguir "hoteles", "cruceros" o "eventos".

### Porcentaje de sentimiento

Dentro del detalle se muestra cómo se reparte el sentimiento del tópico (positivo / neutral /
negativo), para saber si el tema juega a favor o en contra. Ver también
[Sentimiento](sentimiento.md).

## Tareas frecuentes

- **Saber de qué se habla más** — mira el treemap o la lista de la panorámica.
- **Ver qué tema dominó un día concreto** — usa el calendario de tópico dominante.
- **Entender un tema en un período** — entra al tópico y lee su descripción IA.
- **Bajar al detalle** — abre los subtópicos del tópico.
- **Pasar a las menciones** — haz clic en el tópico, su día en el calendario, o un subtópico,
  para abrir el feed filtrado.
