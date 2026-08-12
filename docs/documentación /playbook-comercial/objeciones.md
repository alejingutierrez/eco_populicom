# Manejo de objeciones

Las objeciones más frecuentes al vender ECO y cómo responderlas — **con honestidad**. La
regla de oro: nunca inventes una capacidad, un precio o una certificación para cerrar.
Una promesa falsa se cobra en la implementación y quema la cuenta.

Cada objeción sigue el patrón **reconocer → reencuadrar → responder con evidencia → cerrar
con pregunta**.

## Índice de objeciones

- [Precio y presupuesto](#precio-y-presupuesto)
- [Ya usamos otra herramienta](#ya-usamos-otra-herramienta)
- [Exactitud y madurez](#exactitud-y-madurez) (incluye exactitud de la IA y estado de las
  alertas en vivo)
- [Privacidad y datos](#privacidad-y-datos)
- [Idioma / español](#idioma--español)
- [Cobertura de fuentes](#cobertura-de-fuentes)
- [Esfuerzo de adopción](#esfuerzo-de-adopción)

---

## Precio y presupuesto

> *"¿Cuánto cuesta?" / "No tenemos presupuesto para otra herramienta."*

- **Reconocer:** "Es justo querer claridad de inversión antes de avanzar."
- **Responder:** [PENDIENTE: confirmar con el equipo precios, planes y modalidad]. No
  improvises una cifra. Lo correcto es: "El precio depende del alcance de la cuenta;
  déjame confirmarlo con el equipo y te traigo una propuesta concreta."
- **Reencuadrar hacia valor:** "Antes del número, veamos qué te ahorraría: las horas que
  hoy gasta tu equipo recolectando y leyendo menciones a mano, y el costo de enterarte
  tarde de una crisis."
- **Cerrar:** "¿Te parece si te preparo una propuesta a la medida de tu alcance?"

> Para gobierno, la modalidad de contratación pública también es [PENDIENTE: confirmar con
> el equipo].

## Ya usamos otra herramienta

> *"Ya tenemos un sistema de monitoreo / escucha social."*

- **Reconocer:** "Perfecto, eso quiere decir que ya valoran escuchar la conversación; no
  parto de cero contigo."
- **Reencuadrar:** "La pregunta no es si monitoreas, sino **qué tan profundo entiendes** lo
  que escuchas. La mayoría de las herramientas **cuentan** menciones y arman nubes de
  palabras. ECO **interpreta** la conversación con IA generativa."
- **Responder con los diferenciadores** ([Diferenciadores](diferenciadores.md)):
  - **Narrativas** como historias con ciclo de vida e iniciadores, en un grafo navegable —
    no una lista de *hashtags*.
  - **Riesgo de crisis continuo** (0–1), para anticipar en vez de reaccionar.
  - **IA en español** que entiende ironía y contexto.
  - **Geografía municipal** (78 municipios en PR).
- **Cerrar:** "¿Te muestro algo en una demo que tu herramienta actual no te da hoy? Si no
  te aporta nada nuevo, te lo digo yo mismo." (Lleva a la [demo](guion-demo.md), directo a
  narrativas.)

## Exactitud y madurez

Aquí caben dos preocupaciones relacionadas: **¿la IA acierta?** y **¿está todo el producto
terminado?**. Trátalas con honestidad; es lo que protege la relación.

### "¿Qué tan exacta es la clasificación de la IA?"

- **Reconocer:** "Ninguna clasificación automática es perfecta, y desconfiar de eso es
  sano."
- **Responder:** "ECO usa IA generativa que **lee el texto** —entiende contexto e ironía
  mucho mejor que las palabras clave que usan las herramientas tradicionales. Y todo es
  **auditable**: detrás de cada métrica están las menciones reales, así que puedes verificar
  por qué algo se clasificó como lo hizo." (Muéstralo en [Menciones](../guia-usuario/menciones.md)
  durante la demo.)
- **Apoyo:** la [pertinencia](../fundamentos/conceptos.md#pertinencia) filtra el ruido, y
  los indicadores combinan señales para no depender de una sola lectura.
- **No prometas** un porcentaje de exactitud específico a menos que el equipo te dé una
  cifra documentada: [PENDIENTE: confirmar con el equipo si existe una métrica de exactitud
  publicable].

### "¿Está todo el producto terminado?" (alertas en vivo)

Esta es la objeción donde **más importa ser honesto**.

- **Lo que SÍ está plenamente operativo:** las **alertas de crisis por correo**, las
  **reglas de alerta** configurables y el **historial de disparos**. Los paneles, el
  análisis de sentimiento/tópicos/geografía, el grafo de narrativas, los reportes semanales
  y los insights de IA son sólidos y demostrables.
- **Lo que está en evolución:** algunos paneles de **monitoreo en vivo** dentro de la
  consola de alertas todavía están madurando (no todos persisten datos aún).
- **Cómo decirlo:** "Lo que ya está en producción y puedes usar desde el día uno son las
  **alertas de crisis por correo** y las **reglas con su historial**. Estamos ampliando el
  monitoreo en vivo minuto a minuto; te muestro exactamente lo que ya funciona y lo que
  viene, sin venderte humo."
- **Por qué esto vende:** la honestidad genera confianza y evita una decepción en la
  implementación. **No** presentes un "centro de operaciones de alertas en vivo" como si
  estuviera terminado.

## Privacidad y datos

> *"¿Dónde quedan nuestros datos? ¿Quién los ve?"* (Muy frecuente en gobierno.)

- **Reconocer:** "Es de lo primero que debe preguntar una entidad responsable."
- **Responder (a nivel comercial):**
  - **Aislamiento por agencia:** cada cliente es una [agencia](../fundamentos/glosario.md#términos-generales)
    con sus datos, usuarios y configuración **separados**. Un cliente no ve los datos de
    otro.
  - **Control de acceso por roles:** los usuarios tienen [roles](../guia-usuario/primeros-pasos.md#roles-y-permisos)
    (administrador con permisos de edición, y perfiles de menor privilegio); el cliente
    decide quién ve y quién modifica.
  - **Alojamiento en la nube:** ECO opera en infraestructura de nube gestionada.
- **Lo que NO debes afirmar:** certificaciones específicas (ISO, SOC 2, FedRAMP, etc.) ni
  cumplimientos concretos. Si preguntan, "[PENDIENTE: confirmar con el equipo qué
  certificaciones o cumplimientos están vigentes]". Ver [Seguridad y privacidad](seguridad-privacidad.md).
- **No reveles** detalles técnicos internos, proveedores ni arquitectura.
- **Cerrar:** "Te conecto con el equipo para responder por escrito cualquier requisito
  formal de seguridad que tengan."

## Idioma / español

> *"Las herramientas que probamos fallan con el español de aquí."*

- **Reconocer:** "Es una queja real; mucho software de monitoreo piensa en inglés."
- **Responder:** "La IA de ECO clasifica e interpreta **en español de forma nativa**, no
  como una traducción. Entiende modismos, ironía y el lenguaje real de Puerto Rico y
  Latinoamérica." Ver [Diferenciadores](diferenciadores.md#2-español-nativo).
- **Cerrar:** "En la demo te muestro menciones reales en español clasificadas, y tú juzgas
  si entiende el matiz."

## Cobertura de fuentes

> *"¿De dónde sacan las menciones? ¿Cubren [tal red / tal medio]?"*

- **Reconocer:** "La cobertura es clave: una herramienta solo vale lo que escucha."
- **Responder:** "ECO cubre **múltiples fuentes** —redes sociales, noticias, blogs y
  foros— y las normaliza a un formato común para compararlas. La conversación se nutre
  **integrándonos con plataformas líderes de monitoreo de medios**, así que el alcance es
  amplio."
- **Lo que NO debes hacer:** nombrar proveedores específicos, exponer credenciales ni
  detalles técnicos de las integraciones.
- **Si preguntan por una fuente puntual:** "Déjame confirmar la cobertura exacta de esa
  fuente con el equipo" — [PENDIENTE: confirmar con el equipo el listado exacto de fuentes
  y redes cubiertas].
- **Cerrar:** "¿Qué fuentes son las críticas para ti? Lo verifico y te confirmo."

## Esfuerzo de adopción

> *"Suena bien, pero no tenemos tiempo para implementar y aprender otra herramienta."*

- **Reconocer:** "El miedo a otro proyecto pesado es legítimo."
- **Reencuadrar:** "ECO está pensada para que la información **venga hacia ti**: el reporte
  semanal llega solo por correo y las alertas te encuentran. No tienes que vivir dentro del
  panel."
- **Responder:**
  - **Entrega automatizada:** panel + reportes por correo + alertas; gran parte del valor
    llega sin que nadie tenga que entrar.
  - **Curva suave:** las dos vistas de resumen ([Overview](../guia-usuario/overview.md) y
    [Scorecard](../guia-usuario/dashboard-scorecard.md)) están pensadas para leerse de un
    vistazo; hay una [Guía de Usuario](../guia-usuario/README.md) completa.
  - **Roles:** un visor solo consume; no todos necesitan aprender a configurar.
- **Onboarding / soporte:** el detalle del acompañamiento de implementación es [PENDIENTE:
  confirmar con el equipo el proceso de onboarding y soporte].
- **Cerrar:** "¿Empezamos con un alcance acotado para que vean valor rápido sin un proyecto
  grande?"

---

## Recordatorio final

Cuando no sepas algo —precio, certificación, SLA, una fuente concreta, una cifra de
resultado— di **"lo confirmo con el equipo"**. Es infinitamente mejor que inventar. La
credibilidad es el activo de venta de ECO.
