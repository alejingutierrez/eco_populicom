# Qué es ECO

**ECO es una plataforma de inteligencia de medios y escucha social (*social
listening*).** Recoge de forma continua lo que se dice en redes sociales, noticias,
blogs y foros sobre una organización, lo clasifica con inteligencia artificial y lo
convierte en métricas, narrativas y alertas accionables.

El objetivo es responder, en cualquier momento, preguntas como:

- ¿Qué se está diciendo de nosotros **ahora mismo**, y es positivo o negativo?
- ¿Está **subiendo el riesgo** de una crisis reputacional?
- ¿Qué **temas** dominan la conversación y cómo evolucionan?
- ¿Qué **historias** (narrativas) están emergiendo y quién las impulsa?
- ¿Cómo varía la percepción **por región o municipio**?

## Para quién es

ECO es **multi-cliente** (cada cliente es una *agencia* dentro del sistema). Está
pensada para dos tipos de público comprador:

- **Gobierno** — entidades públicas que necesitan medir la percepción ciudadana,
  detectar crisis temprano y entender la conversación pública sobre sus programas. El
  cliente de referencia es el **DDEC de Puerto Rico** (Departamento de Desarrollo
  Económico y Comercio).
- **Marcas** — empresas que monitorean su reputación, el *engagement* de su audiencia y
  su posición frente a la competencia.

Dentro de cada agencia hay **usuarios** con distintos roles (administrador, analista,
visor) que consumen la información desde el panel web o por correo.

## Qué problema resuelve

El volumen de conversación digital es imposible de seguir manualmente. ECO automatiza
tres cosas difíciles de hacer a mano:

1. **Escala** — procesa miles de menciones sin intervención humana.
2. **Interpretación** — clasifica cada mención por sentimiento, emoción, tema y
   relevancia usando IA, no solo palabras clave.
3. **Anticipación** — detecta anomalías de volumen y deterioro de sentimiento antes de
   que se conviertan en una crisis visible, y avisa por correo.

## Cómo funciona (a alto nivel)

```
Fuentes (redes, noticias, blogs, foros)
        │
        ▼
   1. Ingesta continua   ──► trae menciones nuevas todo el tiempo
        │
        ▼
   2. Clasificación IA   ──► sentimiento, emociones, tópicos, pertinencia, geografía
        │
        ▼
   3. Análisis           ──► métricas diarias, narrativas, detección de crisis
        │
        ▼
   4. Entrega            ──► panel web · reportes por correo · alertas
```

1. **Ingesta** — ECO se conecta a un proveedor de datos de medios y trae las menciones
   nuevas de forma continua.
2. **Clasificación** — cada mención pasa por un modelo de IA que le asigna sentimiento,
   emociones, tópicos, nivel de pertinencia y ubicación.
3. **Análisis** — con esas menciones clasificadas se calculan las
   [métricas](metodologia-metricas.md), se agrupan en
   [narrativas](conceptos.md#narrativas) y se evalúa el
   [riesgo de crisis](conceptos.md#crisis).
4. **Entrega** — todo se muestra en el panel web, se resume en reportes por correo y
   dispara alertas cuando se cumplen condiciones definidas por el usuario.

El detalle técnico de cada paso (proveedor de datos, modelos, infraestructura) está en
la [Documentación Técnica](../tecnica/README.md).

## Qué ofrece, en una frase

> Un panel y un sistema de alertas que convierten el ruido de la conversación digital
> en una lectura clara de la salud reputacional, tema por tema, día a día y región por
> región.

Para el detalle de cada capacidad, ver la [Guía de Usuario](../guia-usuario/README.md);
para cómo se vende, el [Playbook Comercial](../playbook-comercial/README.md).
