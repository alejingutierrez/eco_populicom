# Alertas

Las **alertas** avisan automáticamente cuando se cumple una condición que defines —por
ejemplo, un pico de menciones negativas sobre un tema— para que no tengas que vigilar el panel
todo el día. Esta pantalla reúne las reglas de alerta, su historial de disparos y un acceso a
los [reportes por correo](reportes-correo.md).

Para abrirla, pulsa **Alertas** en la barra lateral. En la barra lateral, esta entrada
muestra una insignia con el número de reglas activas.

Qué es una alerta, en concepto: [Glosario · Entrega](../fundamentos/glosario.md#entrega).

## Cómo está organizada

La pantalla se divide en pestañas:

- **Feed en vivo** — los eventos de alerta recientes en orden cronológico.
- **Reglas** — la lista de tus reglas configuradas, con su estado.
- **Alertas de crisis** — el seguimiento del [riesgo de crisis](../fundamentos/metodologia-metricas.md#riesgo-de-crisis).
- **Historial** — el registro de disparos. Ver [Historial de disparos](#historial-de-disparos).
- **Reportes por correo** — atajo a la configuración del [reporte semanal](reportes-correo.md)
  (solo administradores).

> **Estado de la función.** Hoy está plenamente operativo: crear y listar **Reglas**, el
> **Historial** real de disparos, los **Reportes por correo** y los **avisos de crisis por
> correo**. La pestaña **Feed en vivo** y algunos indicadores por regla (prioridad, número de
> disparos, último disparo) muestran datos de ejemplo mientras se completa su persistencia.

## Crear una regla de alerta

Pulsa **Nueva regla** para abrir el editor. Una regla se compone de:

### Identidad

- **Nombre** (obligatorio) — cómo reconocerás la regla. Por ejemplo, *"Pico de negativos en
  infraestructura"*.
- **Descripción** (opcional) — contexto o la razón de la regla.

### Condición / umbral

Defines qué tiene que ocurrir para que la alerta se dispare, combinando:

- **Tópico** — limitar la regla a un tema concreto (o cualquiera).
- **Sentimiento** — vigilar solo menciones positivas, neutrales o negativas (o cualquiera).
- **Pertinencia** — exigir un nivel de [pertinencia](../fundamentos/conceptos.md#pertinencia)
  (alta / media / baja, o cualquiera), para no disparar con ruido.
- **Volumen mínimo** — cuántas menciones que cumplan lo anterior tienen que acumularse para
  disparar.
- **Ventana de tiempo** — en cuántos minutos deben acumularse ese mínimo de menciones (por
  ejemplo, "al menos 5 menciones negativas de infraestructura en 60 minutos").

### Destinatarios de correo

Lista de correos que recibirán la notificación cuando la regla se dispare. Escribe uno o
varios, separados por coma o espacio.

Al guardar, la regla aparece en la pestaña **Reglas**.

> **Permisos.** Crear y editar reglas es una acción de [analista o administrador](primeros-pasos.md#roles-y-permisos).
> Un visor puede consultar las reglas y el historial, pero no modificarlos.

## Activar y desactivar

En la pestaña **Reglas**, cada regla tiene un interruptor **Activa / Inactiva**. Desactivar
una regla la conserva pero detiene sus disparos y sus correos — útil para silenciar
temporalmente sin perder la configuración. La lista muestra además, por regla, sus canales de
notificación; otros indicadores (prioridad, número de disparos y último disparo) aún muestran
datos de ejemplo (ver la nota de estado en «Cómo está organizada»).

## Editar una regla

Desde la lista de **Reglas**, abre una regla para cambiar su condición, sus umbrales o sus
destinatarios. Los cambios aplican a los disparos siguientes.

## Historial de disparos

La pestaña **Historial** muestra el registro real de cuándo se dispararon tus reglas. Por cada
disparo verás:

- La **regla** que se activó.
- La **fecha y hora** del disparo.
- La **severidad** y el **sentimiento** asociados.
- Las **menciones** que provocaron el disparo, con acceso a su detalle (ver
  [Menciones](menciones.md)).

Puedes acotar el historial por [período](primeros-pasos.md#selector-de-período). Es el lugar
para auditar "¿saltó la alarma anoche y por qué?".

## Relación con el riesgo de crisis

Cuando el [riesgo de crisis](../fundamentos/metodologia-metricas.md#riesgo-de-crisis) cruza su
umbral, ECO puede enviar un aviso por correo con un texto explicativo generado por IA. La
pestaña **Alertas de crisis** te permite seguir este indicador. El riesgo de crisis se lee en
detalle en el [Scorecard](dashboard-scorecard.md#las-métricas-compuestas-kpis).

## Tareas frecuentes

- **Vigilar un tema sensible** — crea una regla con ese **tópico**, sentimiento **negativo** y
  un **volumen mínimo** en una **ventana** corta.
- **Silenciar sin borrar** — desactiva la regla con su interruptor.
- **Saber por qué saltó una alarma** — revisa el **Historial** y abre sus menciones.
- **Cambiar quién recibe los avisos** — edita los **destinatarios** de la regla.
