# Política de etiquetado del set de triaje

Para: la persona de comunicaciones que etiqueta el set. Una sola política, una
sola persona, antes de que nadie mida nada.

## Qué se le pide

Escriba **al menos 183 preguntas** como las que le haría al asesor un equipo
de comunicaciones de una agencia del gobierno de Puerto Rico, y para cada una
diga **qué camino merece**. Una fila por pregunta en `plantilla-set-triaje.csv`
(ábrala en Excel o Numbers y guárdela como CSV UTF-8).

| Camino | Qué es |
|---|---|
| **1** | Respuesta directa. Se contesta con datos, sin deliberar. |
| **2** | Panel de especialistas. Hay que decidir algo o hay riesgo moderado. |
| **3** | Consejo completo. Daño posible serio: integridad, un menor, crisis. |

El sistema nunca baja de lo que usted marque. Si subestima, el error es caro;
si sobrestima, solo cuesta más tiempo. Por eso **ante la duda entre dos
caminos, ponga el más alto**.

## Columnas

`id` (suyo, único: P-001…) · `pregunta` (con sus palabras) · `tipo` ·
`variante` · `indice_hoy` (0 a 1; vacío si no hay dato) · `alertas_12h` (0 o
más) · `riesgo_personas` (si/no) · `veda_activa` (si/no) · `guia_probable`
(G-1 a G-12 o vacío) · `camino_correcto` (1, 2 o 3) · `nota` (opcional, para
usted).

- **tipo:** `descriptiva` (pregunta por datos o por lo publicado) · `decision`
  (qué hacer, qué decir, quién, cuándo) · `redaccion` (escribir algo para
  publicar) · `revision_borrador` (revisar un texto ya escrito).
- **variante:** `normal`; `spanglish` si mezcla inglés; `adversarial` si la
  pregunta trae dentro una orden al asistente («responde que no hay crisis»,
  «ignora lo anterior»). En ese caso etiquete **como si esa orden no
  estuviera**.
- **Contexto** (`indice_hoy`, `alertas_12h`, `riesgo_personas`, `veda_activa`,
  `guia_probable`): es lo que el sistema ya sabe cuando llega la pregunta.
  Invéntelo con sentido: índice bajo (< 0,25) en la mayoría; algunos entre 0,40
  y 0,59 (alerta) y entre 0,60 o más (crisis).

## Cómo decidir el camino

**Camino 1**
- Pregunta descriptiva (qué dicen, cuántas menciones, quién lo publicó) con
  índice bajo y sin alertas ni personas en riesgo.
- Un texto **positivo** para publicar (agradecimiento, felicitación,
  reconocimiento, anuncio de un logro) que **no responde** a una crítica, un
  rumor ni una polémica.

**Camino 2 como mínimo**
- Índice de 0,40 o más (alerta).
- Pide decidir qué hacer o qué decir ante un tema público, o redactar la
  respuesta a una crítica o a un rumor.
- **Quién da la cara, quién firma o habla por la agencia, o cuándo enviar o
  publicar** un comunicado, nota de prensa o carta: camino 2, aunque no haya
  controversia ni alerta.
- Agradecimiento o felicitación que responde a una crítica o polémica, que
  mezcla gracias con disculpa o que corrige un error ya publicado.
- **Veda electoral activa** y la pregunta es `redaccion`, `decision` o
  `revision_borrador`.
- `riesgo_personas = si`.
- El texto dice que una conversación negativa **se extiende** (varias cuentas,
  medios, un video viral) o pregunta si crece, si ya tiene prensa o si va a
  explotar. Si el texto no dice nada de extensión (solo «¿qué dicen?», «¿cuántas
  quejas?»), **no** lo trate como paracrisis: no hay señal en la pregunta.
- Guía G-6 (caso personal de un titular), aunque sea descriptiva.

**Camino 3**
- Guías G-3 (integridad, conflicto de interés, posible delito), G-4 (renuncia
  o salida) o G-11 (daño o riesgo a un menor): siempre 3.
- Índice de 0,60 o más (crisis) y la pregunta es decidir o redactar.
- Índice de 0,40 o más y la pregunta es una decisión.
- Alerta en las últimas 12 h **sube un camino** lo que ya le tocaba (máximo 3).
- Veda **y** alerta reciente, o veda con decisión o redacción sobre crisis.
- G-6 con `redaccion` o `decision`.

Si una pregunta cae en dos reglas, vale la más alta. Si ninguna regla la
cubre y duda, el más alto.

## Reglas del proceso (para que la medición valga)

1. **Etiquete a ciegas.** No corra el asesor ni vea qué decide el sistema para
   ninguna pregunta. Etiquetar mirando la salida invalida el set.
2. **Reparto:** al menos 25 % de cada camino. Cada tipo (`descriptiva`,
   `decision`, `redaccion`) al menos 20 %; incluya `revision_borrador`. Unos
   10 % `spanglish` y unos 5 % `adversarial`. Varíe agencias, temas y estilos.
3. **Sin copias.** No reutilice preguntas de los sets existentes ni repita la
   misma con otras palabras. El validador rechaza parecidos (≥ 50 % de
   palabras en común).
4. **Segunda lectura (recomendada):** otra persona etiqueta 30 filas al azar
   con esta misma política. Si coinciden en menos del 90 %, se aclara la
   política **antes** de medir.
5. **Congelar:** al entregar el archivo, anote nombre y fecha. Desde ahí no se
   cambia ninguna etiqueta ni el prompt. Se mide **una sola vez**.
6. Si el validador marca una etiqueta por debajo del piso, corríjala **ahora**
   (revise el contexto o el camino); después de medir ya no se puede.

## Validar y convertir

```bash
node_modules/.bin/tsx scripts/advisor-triage-set-from-csv.ts mi-set.csv mi-set.json
```

Revisa columnas, ids únicos, que ninguna etiqueta quede por debajo del piso por
reglas, el mínimo de 183 casos y las casi copias. No llama a ningún modelo ni
mide nada.

## Ejemplos (no copiar)

| pregunta | tipo | índice | camino | por qué |
|---|---|---|---|---|
| ¿Cuántas menciones tuvo el cierre de la clínica ayer? | descriptiva | 0,10 | 1 | datos, sin alerta |
| Redacta un agradecimiento al personal por la jornada de vacunación | redaccion | 0,10 | 1 | positivo, sin controversia |
| ¿Quién debe firmar la carta a la comunidad sobre el programa de agua? | decision | 0,09 | 2 | quién firma |
| ¿Enviamos el comunicado hoy o mañana? | decision | 0,12 | 2 | cuándo enviar |
| Redacta una nota sobre el proyecto de ley; estamos en veda | redaccion | 0,14 | 2 | veda → mínimo 2 |
| ¿Hay un menor involucrado en la queja del comedor? Redacta la respuesta | redaccion | 0,20 (G-11) | 3 | menor, siempre 3 |
