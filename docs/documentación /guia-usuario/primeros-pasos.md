# Primeros pasos

Todo lo que necesitas para entrar a ECO y moverte con soltura: iniciar sesión, entender qué
puede hacer tu rol, elegir la agencia y el período de análisis, y reconocer los elementos
que aparecen en todas las pantallas.

## Iniciar sesión

ECO se abre en el navegador. En la pantalla de inicio de sesión:

1. Escribe tu **correo electrónico** (el mismo con el que te invitaron).
2. Escribe tu **contraseña**.
3. Pulsa **Iniciar sesión**.

La autenticación se gestiona con Amazon Cognito. La sesión queda guardada en una cookie
segura, así que normalmente no tendrás que volver a entrar en cada visita; cuando la sesión
caduca, ECO te devuelve automáticamente a esta pantalla.

> **¿No tienes cuenta o no recuerdas tu contraseña?** Las cuentas las crea un
> administrador de tu agencia (ver [Roles](#roles-y-permisos)). Si no puedes entrar,
> contacta a quien administra ECO en tu organización; revisa también las
> [Preguntas frecuentes](faq.md#no-puedo-iniciar-sesión).

Tras iniciar sesión, ECO te lleva al panel. Si habías intentado abrir una pantalla concreta
antes de autenticarte, te devuelve a esa misma pantalla.

## Roles y permisos

Cada usuario pertenece a una sola agencia y tiene un **rol** que determina qué puede hacer.
Hay tres roles:

| Rol | Para quién | Qué puede hacer |
|---|---|---|
| **Administrador** (admin) | Responsable de la cuenta | Todo lo del analista, **más**: configurar el [reporte semanal por correo](reportes-correo.md), gestionar usuarios (invitar, cambiar rol, desactivar) y editar la configuración de la agencia. |
| **Analista** (analyst) | Quien trabaja los datos a diario | Ver todas las pantallas de análisis, explorar menciones, crear y editar [reglas de alerta](alertas.md), usar todos los filtros y exploraciones. |
| **Visor** (viewer) | Quien solo necesita consultar | Ver las pantallas de análisis y los reportes en modo lectura. No crea alertas ni cambia configuración. |

Algunas acciones están reservadas a administradores. Si tu rol no las permite, ECO te lo
indicará (por ejemplo, la configuración de reportes muestra el aviso "Solo administradores
pueden editar esta configuración" y los controles aparecen deshabilitados). Esto es
esperado, no un error; ver [Preguntas frecuentes](faq.md#no-puedo-entrar-a-una-pantalla-o-no-puedo-editar-algo).

> El rol y la agencia se asignan al crear tu cuenta y viajan dentro de tu sesión. No se
> cambian desde el panel por el propio usuario: los ajusta un administrador.

## Selector de agencia

ECO es multi-cliente: cada cliente es una **agencia** (ver
[Glosario](../fundamentos/glosario.md#términos-generales)). Tus datos, alertas y reportes
están aislados por agencia.

En la parte superior de la pantalla hay un selector con el ícono de un edificio que muestra
la agencia activa (por ejemplo, *DDEC*). Si tu cuenta tiene acceso a más de una agencia,
puedes cambiar entre ellas desde ahí; todos los números de la pantalla se recalculan para la
agencia seleccionada. La mayoría de los usuarios verá una sola agencia.

## Navegación general

La navegación vive en la **barra lateral izquierda**, agrupada en dos secciones:

**Análisis**
- **Overview** — resumen diario de la conversación. Ver [Overview](overview.md).
- **Scorecard** — métricas compuestas y análisis táctico. Ver [Scorecard](dashboard-scorecard.md).
- **Menciones** — el feed de publicaciones individuales. Ver [Menciones](menciones.md).
- **Sentimiento** — desglose de polaridad y emociones. Ver [Sentimiento](sentimiento.md).
- **Tópicos** — análisis por tema. Ver [Tópicos](topicos.md).
- **Geografía** — mapa por municipio y región. Ver [Geografía](geografia.md).
- **Alertas** — reglas e historial de disparos. Ver [Alertas](alertas.md).

**Sistema**
- **Configuración** — usuarios, ajustes de la agencia y, para administradores,
  [reportes por correo](reportes-correo.md).

Junto al menú de Análisis verás también **Narrativas**, el grafo de historias detectadas
automáticamente (ver [Narrativas](narrativas.md)).

Algunos elementos útiles de la barra lateral:

- **Insignias numéricas** — junto a *Menciones* aparece el total de menciones del período;
  junto a *Alertas*, el número de reglas activas (en rojo si hay alguna).
- **Ingesta en vivo** — un indicador con la hora de la última ingesta de datos, para que
  sepas qué tan fresca es la información.
- **Colapsar** — reduce la barra a solo íconos para ganar espacio.

### Buscar y saltar rápido (⌘K)

Pulsa **⌘K** (o **Ctrl+K**) en cualquier momento para abrir el **buscador de comandos**. Es
la forma más rápida de moverte por ECO. Desde ahí puedes:

- **Ir a** cualquier pantalla escribiendo su nombre.
- **Cambiar el período** (Hoy, Últimos 7 días, Último mes, etc.).
- **Abrir Menciones ya filtradas** (solo negativas, alta pertinencia, una fuente concreta).
- **Buscar menciones por palabra clave** — al escribir dos o más letras, el buscador muestra
  menciones reales que coinciden; al elegir una, se abre su ficha de detalle.

Navega con las flechas ↑ ↓, abre con **Enter** y cierra con **Esc**.

### Modo claro / oscuro y apariencia

En la cabecera hay un botón de sol/luna para alternar entre **modo claro** y **modo
oscuro**. La preferencia se recuerda en tu navegador.

## Selector de período

El **selector de período** está en la cabecera y es el control más importante de ECO:
define la ventana de tiempo de **toda** la pantalla. Es el mismo en Overview, Scorecard,
Sentimiento, Tópicos, etc., así que basta cambiarlo una vez.

Se presenta como una fila de "chips". Las opciones son:

| Chip | Significado |
|---|---|
| **1D** | Hoy (el día calendario en curso, hora de Puerto Rico) |
| **5D** | Últimos 5 días |
| **7D** | Últimos 7 días |
| **30D** | Últimos 30 días (equivale a "un mes") |
| **90D** | Últimos 90 días (equivale a "tres meses") |
| **3M** | Últimos 3 meses |
| **6M** | Últimos 6 meses |
| **1A** | Último año |
| **Max** | Todo el histórico disponible |

> Las ventanas son **rolantes** y terminan **hoy** (incluyen el día en curso, aunque sea
> parcial), para que el panel refleje lo que está pasando ahora mismo. El
> [reporte por correo](reportes-correo.md) usa en cambio una semana **cerrada** que termina
> ayer; por eso el panel y el correo pueden no coincidir exactamente al milímetro. Las horas
> y los días se calculan en hora de Puerto Rico (AST, UTC−4).

### Rango de fechas personalizado

Para analizar un período exacto (por ejemplo, una campaña o un evento), pulsa el botón
**Fechas** (ícono de calendario) junto a los chips:

1. Elige una fecha **Desde** y una fecha **Hasta**.
2. Pulsa **Aplicar**.

La pantalla se recarga mostrando solo ese intervalo, y el botón pasa a mostrar el rango
elegido. Para volver a un período predefinido, pulsa cualquier chip o usa **Limpiar** dentro
del calendario. La fecha "Desde" debe ser anterior o igual a la fecha "Hasta".

## Qué hacer a continuación

- Mira el [Overview](overview.md) para una lectura rápida del estado actual.
- Si quieres profundizar, pasa al [Scorecard](dashboard-scorecard.md).
- Para entender qué significan los números que ves, consulta la
  [Metodología de métricas](../fundamentos/metodologia-metricas.md).
