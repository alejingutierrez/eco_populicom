# Metodología de métricas

Qué mide cada indicador de ECO, en qué rango se mueve y cómo interpretarlo. Aquí el
enfoque es **conceptual**; las fórmulas exactas y su implementación están en la
[Documentación Técnica](../tecnica/README.md).

## Tabla resumen

| Métrica | Qué mide | Rango | Cómo leerla |
|---|---|---|---|
| **NSS** | Balance neto de sentimiento | −100 a +100 | >0 predomina lo positivo; <0 lo negativo; ≈0 equilibrio |
| **NSS 7d / 30d** | NSS promediado en 7 o 30 días | −100 a +100 | Suaviza el ruido diario; muestra la tendencia |
| **BHI** | Salud reputacional compuesta | 0 a 1 | Más alto = mejor salud (sentimiento + engagement + alcance + pertinencia) |
| **Momentum reputacional** | Cambio del NSS vs hace 7 días | −200 a +200 | Positivo = mejorando; negativo = deteriorando |
| **Tasa de engagement** | Interacción sobre alcance | 0 a 100%+ | Qué porción de la audiencia alcanzada interactuó |
| **Tasa de amplificación** | Qué porción del engagement son *shares* | 0 a 100% | Más alto = más viralidad / difusión orgánica |
| **Velocidad de engagement** | Desvío del engagement vs su historia | ≈ −3 a +3 | Positivo = más reacción de lo normal |
| **Riesgo de crisis** | Riesgo reputacional combinado | 0 a 1 | Bandas: Normal / Elevado / Alerta / Crisis |
| **Anomalía de volumen** | Desvío del volumen vs su historia | ≈ −3 a +3 | Alto = pico inusual de menciones |
| **Polarización** | Opiniones con carga vs neutrales | 0 a 100% | Alto = audiencia dividida (no apática) |

## NSS (*Net Sentiment Score*)

El indicador central de sentimiento. Resume en un solo número si la conversación es, en
neto, favorable o desfavorable: compara cuántas menciones positivas hay frente a las
negativas, sobre el total.

- **Rango:** −100 (todo negativo) a +100 (todo positivo). El 0 es el equilibrio.
- **Cómo leerlo:** un NSS de +30 significa que las positivas superan a las negativas por
  el equivalente al 30% del total. Para ver la **tendencia** (y no el ruido de un día),
  se usan las versiones promediadas **NSS 7d** y **NSS 30d**.

## BHI (*Brand Health Index*)

Un índice **compuesto** de salud reputacional, pensado para tener "un solo número" que
balancee varias dimensiones en lugar de mirar solo el sentimiento. Combina cuatro
ingredientes con distinto peso:

- **Sentimiento** sostenido (NSS de 30 días) — el de mayor peso.
- **Engagement** — cuánta interacción genera la conversación.
- **Alcance** — cuánta gente la ve (con un matiz importante: el alcance con sentimiento
  negativo **resta**, porque difundir algo negativo no es salud).
- **Pertinencia** — qué porción de la conversación es realmente relevante.

- **Rango:** 0 a 1 (en algunas vistas se muestra como 0 a 100). Más alto es mejor.
- **Cómo leerlo:** sube cuando el sentimiento mejora, hay buena interacción y la
  conversación relevante crece de forma sana; baja si crece el alcance de lo negativo o
  cae la interacción.

## Momentum reputacional

Mide **el cambio**, no el nivel: cuánto se movió el NSS respecto a hace 7 días.

- **Cómo leerlo:** positivo = la reputación está mejorando; negativo = se está
  deteriorando. Útil para responder "¿vamos mejor o peor que la semana pasada?".

## Tasa de engagement y tasa de amplificación

- **Tasa de engagement** = interacciones (likes + comentarios + shares) sobre el
  alcance. Indica qué porción de quienes vieron el contenido reaccionaron.
- **Tasa de amplificación** = qué porción de esas interacciones son **shares**. Aísla la
  difusión: un contenido muy compartido se está propagando, no solo gustando.

## Velocidad de engagement y anomalía de volumen

Ambas son **señales de anomalía**: comparan el dato de hoy con su comportamiento
histórico (últimos ~30 días) y lo expresan como cuántas "desviaciones estándar" se
aleja del promedio.

- **Velocidad de engagement** — ¿la gente está reaccionando más de lo normal por
  mención?
- **Anomalía de volumen** — ¿hay muchas más (o menos) menciones de lo habitual?
- **Cómo leerlas:** valores cerca de 0 son normales; valores altos (p. ej. +2 o +3)
  indican un evento fuera de lo común que merece atención. La anomalía de volumen
  alimenta el riesgo de crisis.

## Riesgo de crisis

Un indicador **continuo** (0 a 1) del riesgo reputacional, diseñado para anticipar
problemas. En vez de un "sí/no", combina varias señales con distinto peso:

- **Severidad** — cuánta de la conversación es negativa (mayor peso).
- **Velocidad** — si el volumen se está disparando (usa la anomalía de volumen).
- **Relevancia** — qué tan pertinente es la conversación negativa.
- **Confianza** — un multiplicador que **baja** el riesgo cuando hay pocos datos, para
  no disparar alarmas con poco volumen.

Se lee con cuatro **bandas**:

| Banda | Riesgo | Significado |
|---|---|---|
| **Normal** | < 0.25 | Sin señales de alarma |
| **Elevado** | 0.25 – 0.40 | Conviene vigilar |
| **Alerta** | 0.40 – 0.60 | Situación que requiere atención |
| **Crisis** | ≥ 0.60 | Riesgo reputacional alto |

Cuando el riesgo cruza el umbral configurado, ECO puede enviar una alerta por correo con
un texto explicativo generado por IA.

## Polarización

Mide qué porción de las opiniones tienen **carga** (positivas + negativas) frente a las
neutrales.

- **Cómo leerla:** distingue una audiencia **dividida** de una **apática**. Un NSS
  cercano a 0 con polarización **alta** significa que la gente opina fuerte en ambos
  sentidos (división); el mismo NSS≈0 con polarización **baja** significa indiferencia.
  Son situaciones muy distintas que el NSS por sí solo no separa.

---

> Las definiciones exactas (fórmulas, ventanas de cálculo, normalizaciones y código
> fuente) están en la sección de métricas de la
> [Documentación Técnica](../tecnica/README.md). Si un número del panel no cuadra con lo
> esperado, ese es el lugar para verificar cómo se calcula.
