# Scorecard táctico

El **Scorecard** es el "puesto de mando" del analista: reúne las **métricas compuestas** de
ECO, un **briefing ejecutivo** generado por IA y herramientas para profundizar por hora,
tópico, fuente y geografía. Donde el [Overview](overview.md) da la lectura rápida, el
Scorecard da el análisis.

Para abrirlo, pulsa **Scorecard** en la barra lateral.

Todo en esta pantalla responde al [selector de período](primeros-pasos.md#selector-de-período)
y al [selector de agencia](primeros-pasos.md#selector-de-agencia) de la cabecera.

## Briefing ejecutivo

En la parte superior, el **Resumen ejecutivo** es un texto corto generado por IA que destila
lo más importante del período en lenguaje claro: la señal dominante, el alcance y una acción
recomendada. Tiene tres enfoques que puedes alternar:

- **Señal** — la lectura general del período.
- **Emergente** — lo que está empezando a moverse (temas o narrativas al alza).
- **Crisis** — el ángulo de riesgo, si lo hay.

Cuando el texto lo generó la IA, lo verás marcado con un distintivo y la hora aproximada de
generación. El botón de acción del briefing te lleva a las menciones del tema dominante. Cómo
interpretar estos textos está en [Insights de IA](insights-ia.md).

## Las métricas compuestas (KPIs)

Una fila de tarjetas muestra los indicadores clave del período. Cada uno resume una
dimensión distinta de la salud reputacional:

| KPI | Qué responde | Detalle |
|---|---|---|
| **NSS** | ¿La conversación es a favor o en contra? | [NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score) |
| **Brand Health (BHI)** | ¿Cómo está la salud reputacional, todo junto? | [BHI](../fundamentos/metodologia-metricas.md#bhi-brand-health-index) |
| **Riesgo de crisis** | ¿Hay riesgo reputacional al alza? | [Riesgo de crisis](../fundamentos/metodologia-metricas.md#riesgo-de-crisis) |
| **Polarización** | ¿La audiencia está dividida o es indiferente? | [Polarización](../fundamentos/metodologia-metricas.md#polarización) |
| **Tasa de engagement** | ¿Cuánto reacciona la audiencia? | [Tasa de engagement](../fundamentos/metodologia-metricas.md#tasa-de-engagement-y-tasa-de-amplificación) |
| **Volumen** | ¿Cuántas menciones hubo? ¿Es un pico? | [Anomalía de volumen](../fundamentos/metodologia-metricas.md#velocidad-de-engagement-y-anomalía-de-volumen) |

> El **Riesgo de crisis** y la **Polarización** se presentan en escala 0 a 1 (también
> legibles como porcentaje). El riesgo se lee además por **bandas** —Normal, Elevado,
> Alerta, Crisis—; los umbrales están en la
> [tabla de bandas](../fundamentos/metodologia-metricas.md#riesgo-de-crisis).

**Haz clic en cualquier KPI** para abrir su **explicación de IA**: un texto que interpreta
por qué la métrica está en ese nivel en este período, junto con un acceso a las menciones que
más la explican (por ejemplo, las negativas de alta pertinencia detrás de un riesgo de crisis
elevado). Si el texto aún se está generando, verás el estado descrito en
[Insights de IA](insights-ia.md).

## Evolución multi-métrica

Bajo los KPIs, una gráfica de líneas muestra cómo evolucionaron las métricas a lo largo del
período. Por defecto muestra solo **Menciones**; puedes **activar hasta tres series a la vez**
(NSS, Brand Health, Crisis, Polarización, Engagement) con los chips de la gráfica para
comparar, por ejemplo, si un pico de volumen coincidió con una caída del NSS.

En el período **1D** (hoy), la evolución se muestra **por hora** en lugar de por día, para
ver el detalle intradía. Al hacer clic en un punto de la gráfica (un día, o una hora en 1D)
se abre el detalle de esa franja con sus menciones.

## Timeline horario (mapa de calor)

El **mapa de calor por hora** cruza los días de la semana con las horas del día y colorea
cada celda según el volumen de menciones. Sirve para descubrir **cuándo** se concentra la
conversación (por ejemplo, las tardes de los días laborables). Haz clic en una celda para ver
las menciones publicadas en ese día de la semana y esa hora.

## Top tópicos y subtópicos

Una lista con los principales tópicos del período (hasta los 8 más relevantes), cada uno con
su volumen y su sentimiento dominante. Junto al conteo principal puede aparecer "**+N también
lo tocan**", que indica menciones donde ese tópico aparece como **secundario** (ver
[Tópicos](topicos.md) y [Conceptos · Tópicos](../fundamentos/conceptos.md#tópicos)). Al hacer
clic en un tópico se abre el detalle con sus menciones.

## Menciones recientes de alto engagement

Un bloque con las menciones recientes que más interacción generaron — lo "viral" del período.
Al hacer clic en una se abre su
[ficha de detalle](menciones.md#ficha-de-detalle-de-una-mención).

## Mapa de calor geográfico

Un resumen geográfico que muestra dónde se concentra la conversación por territorio. Para el
mapa completo de los 78 municipios, con el toggle entre volumen y sentimiento y el desglose
por región, ve a [Geografía](geografia.md).

## Profundizar (drill-down)

Casi todo en el Scorecard es **interactivo**: al hacer clic en un KPI, un día, una celda del
mapa de calor, una fuente, un tópico o una mención, ECO abre una ventana de detalle con el
desglose de esa "rebanada" y un acceso directo a las menciones que la componen. Es la forma
natural de pasar del número agregado a las publicaciones concretas que lo explican.

## Tareas frecuentes

- **Saber si hay una crisis en formación** — mira el KPI de **Riesgo de crisis** y su banda;
  haz clic para leer la explicación de IA.
- **Distinguir audiencia dividida de indiferente** — combina **NSS** cerca de 0 con la
  **Polarización** (ver [Polarización](../fundamentos/metodologia-metricas.md#polarización)).
- **Detectar un pico anómalo** — observa el KPI de **Volumen** y la gráfica de evolución.
- **Encontrar cuándo conviene publicar o vigilar** — usa el **mapa de calor por hora**.
- **Pasar de una métrica a sus menciones** — haz clic en el KPI y luego en su acceso a
  menciones.
