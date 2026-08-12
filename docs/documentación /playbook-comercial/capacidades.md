# Capacidades y beneficios

Cada capacidad de ECO traducida a **qué gana el cliente**. Úsala para mapear una necesidad
del prospecto con la función que la cubre, y para responder "¿y eso para qué me sirve?".

Para el detalle de **qué es** cada cosa, los enlaces llevan a los
[Fundamentos](../fundamentos/README.md); para **cómo se usa**, a la
[Guía de Usuario](../guia-usuario/README.md).

## Tabla maestra: capacidad → beneficio

| Capacidad | Qué hace | Qué gana el cliente |
|---|---|---|
| **Panel en tiempo real** | Métricas de salud reputacional ([NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score), [BHI](../fundamentos/metodologia-metricas.md#bhi-brand-health-index)) actualizadas | Saber en cualquier momento si la conversación está a favor o en contra, sin esperar a un informe |
| **Clasificación por IA en español** | Sentimiento, [emociones](../fundamentos/glosario.md#clasificación-de-contenido), [tópicos](../fundamentos/conceptos.md#tópicos), [pertinencia](../fundamentos/conceptos.md#pertinencia) por mención | Una lectura del *tono* y el *tema*, no solo del volumen; menos ruido y más señal |
| **Detección continua de crisis** | [Riesgo 0–1](../fundamentos/conceptos.md#crisis) con bandas Normal/Elevado/Alerta/Crisis + aviso por correo | Anticipar problemas mientras son pequeños, en vez de reaccionar cuando estallan |
| **Narrativas emergentes** | Agrupa menciones en [historias](../fundamentos/conceptos.md#narrativas) por similitud semántica, con [ciclo de vida](../fundamentos/glosario.md#narrativas) e iniciadores | Entender *qué historia* circula y quién la impulsa, desde que nace |
| **Mapa/grafo de narrativas** | Visualiza las narrativas conectadas y navegables en el tiempo | Recorrer la conversación y ver cómo unas historias alimentan a otras |
| **Análisis geográfico municipal** | Percepción por región y por [municipio](../fundamentos/conceptos.md#geografía) (78 en PR) | Detectar focos locales que el promedio nacional esconde |
| **Reportes semanales por correo** | Resumen automático cada semana | La rutina informativa llega sola; nadie tiene que compilarla |
| **Alertas por correo** | Aviso cuando se cumple una condición (pico, caída de sentimiento) o sube el riesgo de crisis | Enterarse de lo urgente sin vigilar el panel todo el día |
| **Reglas de alerta + historial** | Configurar condiciones propias y auditar cada disparo | Vigilancia a medida y trazabilidad de "¿por qué saltó la alarma?" |
| **Búsqueda y filtros de menciones** | Explorar el feed por fuente, sentimiento, tópico, pertinencia, fecha | Llegar al dato concreto y a la cita textual que sustenta una decisión |
| **Insights y briefings por IA** | Textos que interpretan un período o una métrica; briefings varias veces al día | Una primera lectura redactada, lista para revisar y compartir |
| **Cobertura multi-fuente** | Redes, noticias, blogs y foros normalizados a un formato | Una sola visión de toda la conversación, comparable entre fuentes |
| **Multi-agencia y roles** | Datos aislados por agencia; usuarios con rol (admin/analista/visor) | Cada cliente ve solo lo suyo; el acceso se controla por persona |

## Detalle por capacidad

### Panel en tiempo real de salud reputacional

Reúne los indicadores compuestos —[NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score),
[BHI](../fundamentos/metodologia-metricas.md#bhi-brand-health-index),
[momentum](../fundamentos/metodologia-metricas.md#momentum-reputacional),
[polarización](../fundamentos/metodologia-metricas.md#polarización)— en una vista de mando.

- **Beneficio:** un "estado de salud" de un vistazo, defendible con números.
- **Frase de venta:** "Abre el panel y en cinco segundos sabes si hoy vas mejor o peor que
  la semana pasada."

### Clasificación por IA en español

Cada mención se interpreta por su contenido, no por las palabras que contiene.

- **Beneficio:** menos falsos positivos, ironía y contexto bien entendidos, ruido filtrado
  por [pertinencia](../fundamentos/conceptos.md#pertinencia).
- **Frase de venta:** "Distinguimos una crítica real de una mención de pasada que solo usa
  tu nombre."

### Detección continua de crisis

El [riesgo de crisis](../fundamentos/metodologia-metricas.md#riesgo-de-crisis) es un valor
continuo, no un interruptor.

- **Beneficio:** tiempo de reacción; ver el riesgo *subir* antes del pico.
- **Frase de venta:** "Es un termómetro del riesgo, no una alarma que suena cuando ya es
  tarde."

### Narrativas y su mapa

Las [narrativas](../fundamentos/conceptos.md#narrativas) son la capacidad estrella en una
demo (ver [Guion de demo](guion-demo.md)).

- **Beneficio:** entender la conversación como **historias** con autor y trayectoria.
- **Frase de venta:** "Te mostramos las historias que se forman sobre ti, no una nube de
  palabras."

### Análisis geográfico municipal

- **Beneficio:** decisiones territoriales informadas; detectar dónde concentrar atención.
- **Frase de venta:** "El promedio nacional puede mentir; el mapa por municipio, no."

### Reportes semanales, alertas e insights

La capa de **entrega automatizada**: el reporte llega solo, la alerta encuentra al equipo,
y los textos de IA dan una primera lectura.

- **Beneficio:** la información trabaja para el equipo, no al revés.
- **Frase de venta:** "Configúralo una vez y deja que ECO te avise y te resuma."

> **Nota de precisión.** En la consola de alertas, lo plenamente operativo hoy son las
> **alertas de crisis por correo** y las **reglas + historial**. Algunos paneles de
> monitoreo en vivo aún están en evolución. Preséntalos con honestidad. Ver
> [Objeciones](objeciones.md#exactitud-y-madurez).

### Cobertura multi-fuente

La conversación se nutre integrándose con **plataformas líderes de monitoreo de medios**
para traer menciones de redes, noticias, blogs y foros.

- **Beneficio:** una sola visión, sin saltar entre herramientas.
- **Frase de venta:** "Unificamos toda la conversación en un solo lugar comparable."

### Multi-agencia y roles

Cada cliente es una [agencia](../fundamentos/glosario.md#términos-generales) con datos
aislados; los usuarios tienen [roles](../guia-usuario/primeros-pasos.md#roles-y-permisos)
(administrador, analista, visor).

- **Beneficio:** privacidad entre clientes y control de quién puede editar.
- **Frase de venta:** "Tus datos son solo tuyos, y tú decides quién ve y quién cambia."
- Más en [Seguridad y privacidad](seguridad-privacidad.md).
