# Insights de IA

A lo largo de ECO encontrarás **textos generados por inteligencia artificial** que interpretan
los datos en lenguaje claro: explican qué pasó, por qué una métrica está en cierto nivel o de
qué trató un tema. Esta página explica **cómo leerlos**, qué significan los estados mientras se
generan y por qué a veces tardan unos segundos.

Qué es un insight y qué es un briefing, en concepto:
[Glosario · Entrega](../fundamentos/glosario.md#entrega).

## Dónde aparecen los insights

| Insight | Dónde | Qué interpreta |
|---|---|---|
| **Insights del período** | [Overview](overview.md#insights-de-ia-del-período) | Lo más negativo, lo más positivo y un resumen general del período. |
| **Briefing ejecutivo** | [Scorecard](dashboard-scorecard.md#briefing-ejecutivo) | La señal dominante, lo emergente y el ángulo de crisis, con una acción sugerida. |
| **Explicación de métrica** | [Scorecard](dashboard-scorecard.md#las-métricas-compuestas-kpis), al hacer clic en un KPI | Por qué una métrica (NSS, BHI, crisis, polarización, volumen) está en ese nivel. |
| **Descripción de tópico** | [Tópicos](topicos.md#descripción-ia-del-período) | De qué trató un tópico en el período seleccionado. |
| **Resumen de mención** | [Ficha de detalle](menciones.md#ficha-de-detalle-de-una-mención) | Un resumen breve del contenido de una publicación. |
| **Aviso de crisis** | Correo de [alerta](alertas.md) | Por qué se disparó una alerta de riesgo de crisis. |

## Cómo interpretarlos

- Los insights son una **lectura asistida**, no un veredicto: te orientan sobre dónde mirar.
  Cuando algo sea importante, **confírmalo con los datos** y abre las menciones que lo
  sustentan (casi todos los insights tienen un acceso a sus menciones).
- Están **calculados para el [período](primeros-pasos.md#selector-de-período) y la
  [agencia](primeros-pasos.md#selector-de-agencia)** que tienes activos. Si cambias el período,
  el insight cambia: la descripción de un tópico en una semana no es la misma que en un mes.
- Son **específicos del rango de fechas**. Un mismo tópico o métrica se explica distinto según
  la ventana que estés viendo.

## El estado "calculando" (computing)

Generar estos textos toma unos segundos. ECO usa un esquema de **caché**: la primera vez que
alguien pide el insight de un período concreto, se calcula y se guarda; las siguientes veces se
sirve al instante.

Por eso, al abrir un insight por primera vez puedes ver uno de estos estados:

- **GENERANDO… / Generando descripción para este periodo…** — la IA está calculando el texto
  en ese momento. ECO **reintenta solo** cada pocos segundos y mostrará el resultado en cuanto
  esté listo, sin que tengas que recargar. Normalmente tarda unos segundos.
- **Listo** — el texto ya está disponible (y quedará cacheado para la próxima vez).
- **Actualizando…** — se te muestra una versión **cacheada** mientras la IA recalcula en
  segundo plano una versión más fresca; el texto se refrescará solo.
- **No fue posible generar… / Intenta más tarde** — algo impidió calcularlo. Espera un momento
  y vuelve a abrirlo; si persiste, ver [Preguntas frecuentes](faq.md#los-insights-de-ia-tardan-o-no-aparecen).

> Si el cálculo se demora más de lo razonable, ECO deja de esperar y muestra un aviso. No es un
> error de tus datos; suele resolverse volviendo a abrir el insight al cabo de un momento.

## Frescura de la caché

- **Períodos pasados (históricos)** — una vez calculado, el insight de un período ya cerrado no
  cambia (los datos de esas fechas ya no se mueven), así que se sirve siempre desde la caché, al
  instante.
- **Períodos que incluyen hoy o ayer** — como esos datos aún cambian, ECO **refresca** el
  insight periódicamente. Si la versión guardada tiene cierta antigüedad, te muestra la
  existente y dispara un recálculo en segundo plano (el estado *Actualizando…*).

Esto explica por qué un insight de "hoy" puede tardar un instante en la primera carga del día,
mientras que el de una semana del mes pasado aparece de inmediato.

## Tareas frecuentes

- **Entender por qué una métrica está alta** — haz clic en su KPI en el
  [Scorecard](dashboard-scorecard.md) y lee la explicación.
- **Resumir rápido un período** — usa los insights del [Overview](overview.md) o el briefing
  ejecutivo.
- **Verificar un insight** — abre las menciones que lo respaldan desde el propio insight.
- **Si tarda** — espera unos segundos; se actualiza solo. No hace falta recargar.
