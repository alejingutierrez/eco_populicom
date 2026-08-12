# Seguridad y privacidad (nivel comercial)

Lo que un comprador pregunta sobre seguridad y datos —especialmente en **gobierno**— y
cómo responderlo a nivel **comercial**, sin revelar secretos técnicos y sin afirmar
certificaciones que no estén confirmadas.

> **Cómo usar este documento.** Es una guía de **conversación de venta**, no una ficha
> técnica de seguridad. Para requisitos formales por escrito (cuestionarios de seguridad,
> *due diligence*), **conecta al prospecto con el equipo**. Donde aparezca `[PENDIENTE]`,
> no afirmes nada: confírmalo antes.

## Lo que SÍ puedes afirmar

Estas son capacidades reales y demostrables, descritas en términos de negocio:

### Aislamiento de datos por agencia

ECO es **multi-cliente**: cada cliente es una [agencia](../fundamentos/glosario.md#términos-generales)
con sus **datos, usuarios y configuración separados**. Un cliente **no** ve la información
de otro.

- **Cómo decirlo:** "Sus datos están aislados de los de cualquier otro cliente. Lo que es
  suyo, es solo suyo."

### Control de acceso por roles

Dentro de cada agencia, los usuarios tienen un **rol** que define qué pueden hacer (ver
[Roles y permisos](../guia-usuario/primeros-pasos.md#roles-y-permisos)). Existe un perfil
de **administrador con permisos de edición** y perfiles de menor privilegio que solo
consultan.

- **Cómo decirlo:** "Usted decide quién puede ver y quién puede modificar. No todos en el
  equipo tienen el mismo nivel de acceso."

### Alojamiento en la nube

ECO opera sobre **infraestructura de nube gestionada**, sin que el cliente tenga que
instalar ni mantener servidores.

- **Cómo decirlo:** "Es un servicio en la nube; no tienen que montar ni mantener nada en
  sus instalaciones."
- **No entres en detalle** de proveedor, regiones, arquitectura ni configuración: son
  secretos técnicos que no van en la conversación comercial.

### Entrega controlada

Los [reportes por correo](../guia-usuario/reportes-correo.md) y las
[alertas](../guia-usuario/alertas.md) se envían a **destinatarios definidos por el
cliente**; la lista la controla el administrador de la agencia.

- **Cómo decirlo:** "Ustedes controlan exactamente quién recibe los reportes y las
  alertas."

## Lo que preguntará un comprador (y cómo responder)

| Pregunta típica | Respuesta a nivel comercial |
|---|---|
| "¿Otros clientes ven nuestros datos?" | No. Aislamiento por [agencia](../fundamentos/glosario.md#términos-generales). |
| "¿Quién en nuestro equipo puede ver/cambiar qué?" | Lo controlan ustedes con [roles](../guia-usuario/primeros-pasos.md#roles-y-permisos). |
| "¿Dónde se alojan los datos?" | En infraestructura de nube gestionada. [PENDIENTE: confirmar región/proveedor si el cliente lo exige por escrito]. |
| "¿Tienen certificación ISO / SOC 2 / FedRAMP / etc.?" | [PENDIENTE: confirmar con el equipo certificaciones vigentes]. **No** afirmar ninguna sin confirmación. |
| "¿Cumplen con [normativa específica]?" | [PENDIENTE: confirmar con el equipo]. No afirmar cumplimiento sin confirmación. |
| "¿De dónde provienen las menciones?" | De múltiples fuentes públicas (redes, noticias, blogs, foros), integrándonos con plataformas líderes de monitoreo. Sin nombrar proveedores. |
| "¿Cómo se respaldan / por cuánto tiempo guardan los datos?" | [PENDIENTE: confirmar con el equipo política de retención y respaldos]. |
| "¿Tienen un SLA de disponibilidad?" | [PENDIENTE: confirmar con el equipo si existe un SLA]. |
| "¿Cómo se cifran los datos?" | [PENDIENTE: confirmar con el equipo detalles a compartir comercialmente]. |
| "¿Pueden firmar un acuerdo de tratamiento de datos / confidencialidad?" | [PENDIENTE: confirmar con el equipo]. |

## Lo que NO debes hacer

- **No inventes certificaciones ni cumplimientos.** Si no está confirmado, es `[PENDIENTE]`.
- **No reveles detalles técnicos internos:** proveedores de datos, nombres de servicios,
  arquitectura, credenciales, configuraciones. La cobertura se describe como "integración
  con plataformas líderes de monitoreo de medios", sin más.
- **No prometas controles de seguridad específicos** (cifrado X, retención Y, región Z) sin
  confirmación del equipo.
- **No respondas por escrito un cuestionario formal de seguridad por tu cuenta:** escala al
  equipo.

## Mensaje de cierre

> "A nivel de producto, sus datos están **aislados** del resto de clientes, el **acceso lo
> controlan ustedes** por roles, y corre en la **nube** sin que tengan que mantener nada.
> Para cualquier requisito formal de seguridad o cumplimiento, los pongo en contacto
> directo con el equipo para responderlo por escrito y con precisión."

## Pendientes a confirmar con el equipo

Para cerrar ventas a gobierno conviene tener estos puntos resueltos por escrito. Todos
están **sin confirmar** en este playbook:

- [PENDIENTE] Certificaciones de seguridad vigentes (si las hay).
- [PENDIENTE] Cumplimientos normativos aplicables.
- [PENDIENTE] Región y proveedor de alojamiento divulgables.
- [PENDIENTE] Política de retención y respaldo de datos.
- [PENDIENTE] SLA de disponibilidad y soporte.
- [PENDIENTE] Detalles de cifrado divulgables a nivel comercial.
- [PENDIENTE] Disponibilidad de acuerdos (confidencialidad, tratamiento de datos).
