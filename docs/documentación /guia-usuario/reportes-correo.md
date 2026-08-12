# Reportes por correo

> **Solo administradores.** Esta pantalla la pueden ver y editar únicamente los usuarios con
> rol de [administrador](primeros-pasos.md#roles-y-permisos). Otros roles reciben el correo
> (si están en la lista de destinatarios) pero no configuran el envío.

ECO envía un **reporte semanal por correo** con el resumen de la conversación: la versión en
email de lo que ves en el [Overview](overview.md). Desde esta pantalla decides si se envía, a
qué hora, en qué zona horaria, con qué plantilla y a quién.

Para abrirla: **Configuración → Reportes por correo** (también accesible desde la pestaña
*Reportes por correo* de la pantalla de [Alertas](alertas.md)).

## Qué reporte se envía

El reporte cubre los **últimos 7 días naturales cerrados terminando ayer** (no incluye el día
en curso), en la zona horaria configurada. Por eso puede diferir levemente del Overview en
pantalla, que sí incluye hoy. Contiene los totales por sentimiento, la evolución diaria, los
tópicos principales y un resumen — la misma lectura del [Overview](overview.md).

## Configurar el envío

### Elegir la agencia

En la parte superior, selecciona la **agencia** cuya configuración quieres editar. Cada
agencia tiene su propio reporte, hora y lista de destinatarios.

### Campos de la configuración

| Campo | Qué controla |
|---|---|
| **Estado** | Activa o desactiva el envío automático. Si está **inactivo**, no se manda nada (pero puedes seguir enviando pruebas manuales). |
| **Hora local de envío** | La hora (00:00–23:00) a la que sale el reporte, **en la zona horaria elegida**. |
| **Zona horaria** | La zona que define esa hora (San Juan/Puerto Rico, Bogotá, Nueva York, Ciudad de México, Lima, Santiago, Buenos Aires o UTC). |
| **Plantilla del correo** | El diseño del reporte. Hoy: *Resumen semanal de sentimiento (últimos 7 días)*. |
| **Destinatarios** | Hasta **20 correos**. Escribe cada uno y pulsa Enter (o sepáralos con coma, punto y coma o espacio). |
| **Nombre del remitente** | El nombre que aparece como emisor. |
| **Correo del remitente** | La dirección emisora. **Debe estar verificada en AWS SES** (ver aviso abajo). |

Pulsa **Guardar cambios** para aplicar. La pantalla muestra cuándo fue la última
actualización.

> **Cómo se envía en la práctica.** Un proceso automático corre **cada hora** y envía el
> reporte solo a las agencias cuya **hora local** (según su zona horaria) coincide con la hora
> configurada. Así, configurar las 06:00 en *América/Puerto_Rico* hace que el reporte salga a
> las 6 de la mañana hora de Puerto Rico.

> **Remitente verificado (SES).** El correo del remitente debe estar verificado en el sistema
> de envío de Amazon (SES). Hoy está verificado `agutierrez@populicom.com`. Para usar otra
> dirección, primero hay que verificarla; si pones una sin verificar, el envío fallará.

## Enviar una prueba

El botón **Enviar prueba ahora** dispara el reporte inmediatamente, sin esperar a la hora
programada, usando los destinatarios configurados. Sirve para revisar cómo queda antes de
dejarlo en automático.

Posibles resultados de la prueba:

- **Enviado** — el correo salió correctamente (se muestra un identificador del mensaje).
- **Sin datos** — no hubo menciones en los últimos 7 días para generar el reporte.
- Otro estado o **error** — revisa el aviso; suele deberse a un remitente no verificado o un
  destinatario inválido.

> Debes tener al menos un **destinatario** guardado para poder enviar una prueba.

## Historial de envíos

Abajo, la tabla **Histórico de envíos (últimos 14)** registra cada intento de envío con:

- **Fecha** del envío.
- **Estado** — *enviado*, *falló*, *sin datos*, *sin destinatarios* u *omitido*.
- **Trigger** — si fue automático o una prueba manual.
- **Destinatarios** a los que se mandó.
- **Menciones** — el desglose por sentimiento (negativas / neutrales / positivas) de ese
  reporte.
- **Error** — el detalle, si algo falló.

Es el lugar para confirmar que el reporte de esta mañana salió, y a quién, o para diagnosticar
por qué no llegó (ver [Preguntas frecuentes](faq.md#no-recibí-el-reporte-por-correo)).

## Tareas frecuentes

- **Cambiar la hora o la zona del envío** — edita *Hora local* y *Zona horaria* y guarda.
- **Añadir o quitar a alguien** — edita la lista de **Destinatarios** y guarda.
- **Probar el diseño** — pulsa **Enviar prueba ahora** a tu propio correo.
- **Confirmar que salió** — revisa el **Histórico de envíos**.
- **Pausar los envíos** — pon el **Estado** en inactivo.
