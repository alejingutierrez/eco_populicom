# Sentimiento

La pantalla de **Sentimiento** desglosa la polaridad de la conversación con más detalle que
el termómetro del [Overview](overview.md): cómo se reparte el sentimiento en total, por
fuente, por tópico y por región, además de las emociones detectadas.

Para abrirla, pulsa **Sentimiento** en la barra lateral. Todo responde al
[selector de período](primeros-pasos.md#selector-de-período) y de
[agencia](primeros-pasos.md#selector-de-agencia).

Antes de leerla, conviene tener claro qué es el sentimiento y en qué se diferencia de la
emoción: [Conceptos · Sentimiento](../fundamentos/conceptos.md#sentimiento).

## Qué muestra la pantalla

### Distribución de sentimiento

El reparto global del período entre menciones **positivas**, **neutrales** y **negativas**.
Es la base del [NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score): cuantas
más positivas frente a negativas, más alto el NSS.

### Sentimiento por fuente

Cómo cambia el tono según el tipo de [fuente](../fundamentos/glosario.md#términos-generales)
(Facebook, X/Twitter, Instagram, YouTube, noticias, blogs, foros). Útil para detectar si una
plataforma concreta arrastra el sentimiento — por ejemplo, prensa favorable pero redes
críticas, o al revés.

### Sentimiento por tópico

El tono de cada tema de conversación. Te dice qué temas juegan **a favor** y cuáles **en
contra**, para priorizar dónde actuar. Para el análisis temático completo, ver
[Tópicos](topicos.md).

### Sentimiento por región

Cómo varía la percepción por territorio. Un mismo promedio nacional puede esconder zonas muy
positivas y otras muy negativas; aquí se ven separadas. Para el mapa municipio a municipio,
ver [Geografía](geografia.md).

### Top emociones detectadas

Las emociones más frecuentes en el período (alegría, miedo, enojo, sorpresa, tristeza, etc.).
La emoción es el **matiz** detrás del sentimiento: dos conversaciones igual de negativas no se
gestionan igual si una es de *enojo* y otra de *miedo*. Al hacer clic en una emoción puedes
ver las menciones que la expresan (ver [Menciones](menciones.md)).

> **Sentimiento ≠ emoción.** El sentimiento es la dirección (a favor / en contra / neutral);
> la emoción es el tono específico. Ver
> [Conceptos · Sentimiento](../fundamentos/conceptos.md#sentimiento).

## Cómo interpretarla

- **Mira el balance global primero**, luego baja a los cortes (fuente, tópico, región) para
  encontrar **de dónde** viene el tono.
- **Combina con la [Polarización](../fundamentos/metodologia-metricas.md#polarización)** del
  [Scorecard](dashboard-scorecard.md): un balance neutral puede esconder una audiencia muy
  dividida.
- **Cruza emociones con sentimiento**: el enojo suele pedir respuesta distinta que la
  tristeza o el miedo.

## Tareas frecuentes

- **Saber qué fuente está en contra** — revisa *Sentimiento por fuente*.
- **Priorizar temas a mejorar** — ordena mentalmente por el sentimiento negativo en
  *Sentimiento por tópico*.
- **Detectar un foco regional** — revisa *Sentimiento por región* y confírmalo en
  [Geografía](geografia.md).
- **Entender el tono detrás de lo negativo** — mira las *Top emociones* y abre sus menciones.
