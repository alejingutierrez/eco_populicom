# Preguntas frecuentes

Soluciones a las dudas y problemas más comunes al usar ECO. Si tu caso no está aquí, contacta
a quien administra ECO en tu organización.

## Acceso y sesión

### No puedo iniciar sesión

- Confirma que usas el **mismo correo** con el que te invitaron y que la **contraseña** es
  correcta.
- Las cuentas las crea un **administrador** de tu agencia; ECO no tiene auto-registro. Si nunca
  recibiste una invitación, pídela a tu administrador.
- Si la página te devuelve al inicio de sesión una y otra vez, tu sesión pudo **caducar**:
  vuelve a entrar. Revisa también que tu navegador acepte cookies para el sitio.

### Me sacó de la sesión solo

Es normal cuando la sesión **caduca** por seguridad. Simplemente vuelve a iniciar sesión; ECO
te devuelve a donde estabas.

### No puedo entrar a una pantalla, o no puedo editar algo

Lo más probable es que sea una cuestión de **rol** (ver
[Roles y permisos](primeros-pasos.md#roles-y-permisos)):

- La configuración de **[reportes por correo](reportes-correo.md)** y la **gestión de
  usuarios** son **solo para administradores**. Si eres analista o visor, verás un aviso de
  que no puedes editar y los controles deshabilitados — es esperado.
- Crear o editar **[reglas de alerta](alertas.md)** requiere ser analista o administrador; un
  visor solo consulta.

Si crees que tu rol debería permitirlo, pide a un administrador que lo revise.

## Datos en pantalla

### No veo datos / la pantalla está vacía

- Revisa el **[selector de período](primeros-pasos.md#selector-de-período)**: quizá estás en
  **1D** (hoy) y aún no hay menciones del día. Prueba con **7D** o **30D**.
- Si usaste un **rango de fechas personalizado**, comprueba que el intervalo realmente tenga
  conversación; amplíalo o vuelve a un período predefinido.
- Confirma que tienes seleccionada la **agencia correcta** en el selector de la cabecera.
- Revisa el indicador de **Ingesta en vivo** en la barra lateral: te dice qué tan reciente es
  el último dato cargado.

### Los números no cuadran entre el panel y el correo

Es esperado. El **panel** usa ventanas **rolantes que incluyen hoy** (el día en curso,
parcial), mientras que el **[reporte por correo](reportes-correo.md)** cubre una semana
**cerrada que termina ayer**. Por eso los totales pueden diferir ligeramente. Ver
[Overview · Relación con el reporte](overview.md#relación-con-el-reporte-por-correo).

### El conteo de un tópico no coincide entre pantallas

Asegúrate de comparar el **mismo criterio**. Por defecto, los tópicos se cuentan por su
mención **principal** (la de mayor confianza), igual en Overview, Scorecard y correo. Si en
[Menciones](menciones.md) activas también las **secundarias** ("+N también lo tocan"), el
número sube. Ver [Tópicos](topicos.md#conteo-primario-y-n-también-lo-tocan).

### Faltan menciones que esperaba ver

- Por defecto ECO **excluye la baja [pertinencia](../fundamentos/conceptos.md#pertinencia)**
  para filtrar ruido. Si buscas algo marginal, filtra explícitamente por pertinencia "baja" en
  [Menciones](menciones.md).
- ECO también **descarta duplicados** (la misma publicación replicada en varios sitios cuenta
  una vez), así que el conteo es menor que el bruto pero más fiel.
- Verifica que ningún **filtro** anterior siga activo acotando los resultados.

## Insights de IA

### Los insights de IA tardan o no aparecen

Generar estos textos toma unos segundos la primera vez. Si ves **GENERANDO…** o **Generando
descripción…**, ECO está calculando y **se actualiza solo** —no hace falta recargar—; aparecerá
en breve. Si ves **Actualizando…**, estás viendo una versión cacheada mientras se recalcula una
más fresca. Si aparece **No fue posible generar…**, espera un momento y vuelve a abrir el
insight. Todo el detalle en [Insights de IA](insights-ia.md#el-estado-calculando-computing).

### ¿Por qué un insight de hoy tarda y el de un mes pasado es instantáneo?

Los períodos **históricos** (ya cerrados) no cambian, así que su insight queda cacheado y se
sirve al instante. Los períodos que **incluyen hoy o ayer** se refrescan periódicamente porque
sus datos aún se mueven, por eso pueden tardar un instante en la primera carga del día. Ver
[Insights de IA · Frescura de la caché](insights-ia.md#frescura-de-la-caché).

## Narrativas

### La pantalla de Narrativas está vacía

Las [narrativas](narrativas.md) se generan **automáticamente** a partir de las menciones y se
refrescan periódicamente. Si tu agencia se acaba de incorporar o se acaba de activar la
función, el grafo puede tardar una o dos corridas del proceso en poblarse. Revisa también que
no tengas un **filtro de estado** activo que esté ocultando todo, ni el **control de línea de
tiempo** acotado a un rango sin narrativas.

## Reportes por correo

### No recibí el reporte por correo

Si eres **administrador**, abre **Configuración → [Reportes por correo](reportes-correo.md)** y
revisa:

- Que el **Estado** del reporte esté **activo**.
- Que tu correo esté en la lista de **Destinatarios**.
- La **hora** y la **zona horaria**: el reporte sale a esa hora local; si aún no llegó esa hora
  hoy, todavía no se ha enviado.
- El **Histórico de envíos**: ahí verás si el último intento fue *enviado*, *sin datos*,
  *falló* o *sin destinatarios*, con el detalle del error.
- Que el **correo del remitente** esté **verificado en SES** (un remitente no verificado hace
  fallar el envío).
- Tu carpeta de **spam / correo no deseado**.

Si no eres administrador, pide a quien lo sea que revise estos puntos.

### Quiero cambiar a quién llega el reporte

Solo un **administrador** puede hacerlo, editando la lista de **Destinatarios** en
[Reportes por correo](reportes-correo.md) (hasta 20 correos) y guardando.

## Rendimiento

### Una pantalla va lenta o muestra "límite excedido"

ECO limita la frecuencia de algunas consultas para proteger el sistema. Si haces muchas
peticiones muy seguidas (recargas repetidas, cambios rápidos de filtro), puede pedirte esperar
unos segundos. Espera un momento y reintenta.

## ¿Sigues con dudas?

- Para **qué significan** las métricas y los conceptos, consulta los
  [Fundamentos](../fundamentos/README.md).
- Para **cómo usar** una pantalla concreta, vuelve al [índice de la guía](README.md).
- Para cualquier otra cosa, contacta a quien administra ECO en tu organización.
