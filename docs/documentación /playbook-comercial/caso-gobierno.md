# Caso de venta: Gobierno

Cómo vender ECO al sector público, con el **DDEC de Puerto Rico** (Departamento de
Desarrollo Económico y Comercio) como cliente de referencia. El comprador gubernamental
no compra "una herramienta de redes": compra **capacidad de leer a la ciudadanía**,
**anticipar problemas** y **demostrar gestión**. El lenguaje aquí es de **valor público**,
no de *marketing*.

## A quién le hablas

En una entidad pública, el interés suele venir de:

- **Comunicación / prensa / asuntos públicos** — necesita saber qué se dice y reaccionar a
  tiempo.
- **Gabinete o jefatura** — quiere una lectura ejecutiva de la percepción y del riesgo.
- **Equipos de programa** — quieren saber cómo cae un anuncio o un programa concreto.

Todos comparten una pregunta de fondo: **"¿Qué está pensando la gente, y dónde?"**

## Qué le importa a un comprador gubernamental

| Le importa | Cómo lo cubre ECO |
|---|---|
| Percepción ciudadana medible | [NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score) y [BHI](../fundamentos/metodologia-metricas.md#bhi-brand-health-index) como números defendibles |
| No ser sorprendido por una crisis | [Riesgo de crisis](../fundamentos/conceptos.md#crisis) continuo + alerta por correo |
| Entender el territorio | Análisis por [municipio](../fundamentos/conceptos.md#geografía) (78 en PR) |
| Saber si un anuncio funcionó | [Tópicos](../fundamentos/conceptos.md#tópicos) y [narrativas](../fundamentos/conceptos.md#narrativas) alrededor del programa |
| Rendir cuentas con evidencia | Reportes semanales y [menciones](../guia-usuario/menciones.md) con cita textual |
| Lenguaje y contexto local | IA que clasifica **en español** |
| Control de acceso | [Roles](../guia-usuario/primeros-pasos.md#roles-y-permisos) y aislamiento por agencia ([Seguridad](seguridad-privacidad.md)) |

## Casos de uso

### 1. Percepción ciudadana

**Necesidad:** saber, con datos y no por intuición, cómo perciben los ciudadanos a la
entidad y sus iniciativas.

**Con ECO:** el [panel](../guia-usuario/dashboard-scorecard.md) muestra el sentimiento neto
([NSS](../fundamentos/metodologia-metricas.md#nss-net-sentiment-score)) y la salud
reputacional ([BHI](../fundamentos/metodologia-metricas.md#bhi-brand-health-index)) día a
día, con su tendencia. La [polarización](../fundamentos/metodologia-metricas.md#polarización)
distingue una ciudadanía **dividida** de una **indiferente** —dos situaciones que exigen
respuestas opuestas.

**Valor público:** decisiones de comunicación basadas en evidencia, no en percepciones de
pasillo.

### 2. Crisis temprana

**Necesidad:** que un tema sensible no escale a crisis pública sin aviso.

**Con ECO:** el [riesgo de crisis](../fundamentos/conceptos.md#crisis) se calcula de forma
**continua** (0 a 1, bandas Normal/Elevado/Alerta/Crisis). Cuando cruza el umbral, ECO
envía un **aviso por correo** con un texto explicativo de IA.

**Valor público:** tiempo para preparar una respuesta mientras el tema aún es manejable;
menos sorpresas para la jefatura.

### 3. Monitoreo de anuncios y programas

**Necesidad:** medir cómo recibe la opinión pública un anuncio, una política o un programa.

**Con ECO:** se sigue la conversación por [tópico](../fundamentos/conceptos.md#tópicos) y se
observa qué [narrativas](../fundamentos/conceptos.md#narrativas) se forman alrededor del
anuncio —si la historia que cuaja es la que se quería contar o se torció hacia otra cosa.

**Valor público:** retroalimentación real sobre la comunicación de cada iniciativa, para
ajustar el mensaje.

### 4. Lectura territorial por municipio

**Necesidad:** entender que la percepción no es uniforme en toda la isla.

**Con ECO:** el análisis [geográfico](../fundamentos/conceptos.md#geografía) baja al nivel
de los **78 municipios** y sus regiones, revelando focos locales de molestia o de apoyo
que el promedio nacional oculta.

**Valor público:** atención y recursos donde de verdad hacen falta; sensibilidad
territorial en la respuesta.

### 5. Seguimiento de narrativas

**Necesidad:** saber qué **historias** circulan sobre la entidad y quién las impulsa, no
solo cuántas menciones hay.

**Con ECO:** el [mapa de narrativas](../guia-usuario/narrativas.md) muestra las historias
emergentes, su [ciclo de vida](../fundamentos/glosario.md#narrativas) y sus
**iniciadores** (el primero y el más influyente), y cómo se conectan entre sí.

**Valor público:** anticiparse a una narrativa adversa mientras es emergente, e identificar
quién la está amplificando.

## Lenguaje de valor público (cómo lo dices)

Evita la jerga de *marketing*. Traduce a términos de gestión pública:

| En vez de decir… | Di… |
|---|---|
| "Aumenta tu *engagement*" | "Entiende cómo responde la ciudadanía a tus mensajes" |
| "Mejora tu marca" | "Mide y cuida la percepción pública de la entidad" |
| "Detecta tendencias virales" | "Anticipa qué temas pueden escalar y prepárate" |
| "Segmenta tu audiencia" | "Lee la conversación por municipio y por región" |
| "Genera *leads*" | "Sustenta decisiones de comunicación con evidencia" |

## La referencia DDEC

El **DDEC de Puerto Rico** usa ECO para leer la percepción ciudadana día a día, con
reportes semanales por correo y seguimiento de narrativas. Úsalo para dar **credibilidad**:
"Una entidad de gobierno de Puerto Rico ya lo usa en su operación diaria."

> **Precisión.** Cita la referencia como **uso real en operación**. No atribuyas
> resultados cuantitativos concretos (porcentajes de mejora, crisis evitadas) a menos que
> el equipo te confirme cifras documentadas: [PENDIENTE: confirmar con el equipo si hay
> métricas de resultado publicables del caso DDEC].

## Temas que un comprador público suele plantear

- **Privacidad y datos** — ver [Seguridad y privacidad](seguridad-privacidad.md); el
  aislamiento por agencia y los roles son argumentos clave.
- **Contratación / presupuesto** — [PENDIENTE: confirmar con el equipo precios, planes y
  modalidad de contratación pública].
- **Cumplimiento** — no afirmes certificaciones específicas; ver
  [Objeciones · Privacidad](objeciones.md#privacidad-y-datos).
- **Idioma** — la clasificación **en español** es un punto fuerte; ver
  [Diferenciadores](diferenciadores.md#2-español-nativo).
