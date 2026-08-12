# Glosario

Definiciones breves de los términos de ECO. Para explicaciones extensas ver
[Conceptos](conceptos.md); para los indicadores numéricos ver
[Metodología de métricas](metodologia-metricas.md).

## Términos generales

- **Agencia** — cada cliente dentro de ECO. El sistema es multi-cliente: los datos,
  usuarios y configuración están aislados por agencia. Ej.: *DDEC*.
- **Usuario** — persona con acceso al panel de una agencia. Tiene un rol:
  *administrador*, *analista* o *visor*.
- **Mención** — unidad básica de información: una publicación individual (un *post*, una
  noticia, un comentario) que ECO recoge y analiza. Ver [Conceptos](conceptos.md#menciones-y-fuentes).
- **Fuente** — el tipo de origen de una mención: Facebook, X/Twitter, Instagram,
  YouTube, noticias, blogs, foros, etc.
- **Autor** — quien publicó la mención.
- **Engagement** — interacciones que recibió una mención (*likes*, comentarios,
  *shares*). Mide cuánta reacción generó.
- **Alcance** (*reach*) — número estimado de personas que pudieron ver la mención.
- **Pertinencia** — qué tan relevante es una mención para la agencia. Tres niveles:
  **alta**, **media**, **baja**. Filtra el ruido de menciones poco relacionadas.
- **Período** — la ventana de tiempo que se está viendo (1 día, 7 días, 1 mes, etc.).

## Clasificación de contenido

- **Sentimiento** — la polaridad de una mención: **positivo**, **neutral** o
  **negativo**. Lo asigna la IA. Ver [Conceptos](conceptos.md#sentimiento).
- **Emoción** — el tono emocional detectado: alegría, miedo, enojo, sorpresa, tristeza,
  etc. Una mención puede tener varias.
- **Tópico** — tema de conversación de una agencia (taxonomía configurable). Una mención
  puede pertenecer a varios tópicos; el de mayor confianza es el **tópico primario**.
- **Subtópico** — subdivisión de un tópico.
- **Municipio / Región** — ubicación geográfica asociada a la mención (en Puerto Rico,
  los 78 municipios y sus regiones).

## Narrativas

- **Narrativa** — grupo de menciones que comparten un mismo eje de conversación,
  detectado automáticamente por similitud semántica. Es "una historia" dentro del ruido.
  Ver [Conceptos](conceptos.md#narrativas).
- **Centroide** — el "centro" semántico de una narrativa; representa de qué trata en
  promedio.
- **Ciclo de vida** — el estado de una narrativa: *emergente, activa, en pico, en
  declive, dormida* o *revivida*.
- **Iniciador** — quién originó la narrativa. Se distingue el **primero** (cronológico)
  del **influyente** (el de mayor alcance).
- **Conexión** (*edge*) — relación entre dos narrativas: comparten menciones, comparten
  autores o son semánticamente parecidas.

## Métricas

Definidas en detalle en [Metodología de métricas](metodologia-metricas.md).

- **NSS** (*Net Sentiment Score*) — balance neto de sentimiento, de −100 a +100.
- **BHI** (*Brand Health Index*) — índice compuesto de salud reputacional, de 0 a 1.
- **Riesgo de crisis** — indicador continuo (0 a 1) del riesgo reputacional, con bandas
  *Normal / Elevado / Alerta / Crisis*.
- **Polarización** — porcentaje de opiniones con carga (positivas + negativas) frente a
  las neutrales.
- **Momentum reputacional** — cuánto cambió el NSS respecto a hace 7 días.
- **Tasa de engagement** — interacciones sobre alcance.
- **Tasa de amplificación** — qué porción del engagement son *shares* (viralidad).
- **Velocidad de engagement** — cuánto se desvía el engagement de hoy de su promedio
  histórico.
- **Anomalía de volumen** — cuánto se desvía el número de menciones de hoy de su
  promedio histórico.

## Entrega

- **Panel** (*dashboard*) — la aplicación web donde se ven las métricas y los análisis.
- **Reporte por correo** — resumen periódico (semanal) enviado por email.
- **Alerta** — notificación automática que se dispara cuando se cumple una condición
  (p. ej. caída de sentimiento o pico de volumen).
- **Insight de IA** — texto explicativo generado automáticamente que interpreta los
  datos de un período o una métrica.
- **Briefing** — resumen ejecutivo de las últimas horas, generado por IA varias veces al
  día.
