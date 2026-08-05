# Harness de auditoría de diseño

Renderiza y mide la SPA del dashboard **completa** —tema real, cabecera real,
rail real— sin Next.js, sin RDS y sin Cognito.

Existe porque verificar diseño montando un componente aislado es *diseño
paralelo*: engaña. Y porque una medición que no se puede repetir no es una
medición, es una afirmación. La primera versión de este harness vivía en un
directorio temporal y el reaper de `/private/tmp` la borró; por eso ahora está
versionada aquí.

## Correr

```bash
python3 apps/web/tools/design-probe/gen-fixtures.py     # regenera el dataset
python3 apps/web/tools/design-probe/serve.py &          # sirve en :8822
cd apps/web/tools/design-probe
node shoot.mjs probe-a11y.js /tmp/out overview,dashboard desktop,mobile
```

`PROBE_SHOTS=0` mide sin capturar pantallazos (mucho más rápido).
`CHROME_BIN` y `PROBE_BASE` permiten cambiar navegador y origen.

## Las cuatro sondas, y por qué son cuatro

Cada una responde una pregunta distinta. Ninguna sustituye a las otras, y ese es
el punto: **una sonda limpia obliga a preguntar qué NO mide.**

| Sonda | Pregunta | Lo que se le escapa |
|---|---|---|
| `probe-a11y.js` | ¿Se lee el texto? ¿Se puede tocar? ¿Desborda? ¿Crashea? | Que el color sea legible y a la vez signifique lo contrario |
| `probe-state.js` | ¿Se ve **cuál** está seleccionado? (SC 1.4.11, 3:1) | Estados sin atributo ARIA |
| `probe-tokens.js` | ¿Los valores salen del sistema? | El **significado**: `--emo-ira` puede ser un duplicado hex exacto de `--neg` y pasar |
| `probe-encoding.js` | ¿El largo de la barra es proporcional a su número? | Que dos cards usen el mismo dibujo con significados distintos |

`probe-a11y.js` reporta `crash` **primero** y aborta: un crash atrapado por el
error boundary hace que todas las demás cifras mejoren, porque no hay pantalla
que medir. Pasó de verdad — al aplicar unos parches, `small44` del Scorecard
"bajó" de 190 a 2 y la vista en realidad no renderizaba.

## Los fixtures llevan casos borde a propósito

`gen-fixtures.py` es **determinista** (nada de RNG: dos corridas tienen que dar
el mismo dataset o dos mediciones no son comparables) y mete a propósito lo raro,
porque ahí vive el defecto:

- `polarizationIndex: null` — la métrica que no siempre se calcula.
- un `nss` nulo a mitad de serie — el hueco que `isGap()` debe respetar en vez de
  dibujar una recta que inventa el dato.
- deltas de signo mezclado y uno `hasBaseline: false` — para ver si la dirección
  del color respeta el contrato por métrica o sólo mira el signo.
- `status` de narrativa fuera del enum (`unknown`, `sin_clasificar`).
- una narrativa con `velocity24h: 0` y estado `peaking` — la contradicción real
  que la auditoría encontró en producción.
- `strength: null` en una arista, `engagement: 0` en varias menciones — para
  distinguir "cero medido" de "sin dato".
- `narrative-detail.json` **vacío**: el caso que degeneraba en cinco cajas
  idénticas diciendo "Sin datos".

Un fixture bonito esconde justo lo que se audita.

## Gotchas

- **El dataset entra por `/api/eco-data`**, no inyectado en el HTML: el bootstrap
  de `index.html` sobreescribe `window.ECO_DATA_REMOTE` con esa respuesta, así que
  inyectarlo en la página queda pisado. Los `_mocks` de `data.js` están casi todos
  vacíos porque en producción todo viene del endpoint.
- **Las sondas no pueden contener backticks**: se inyectan con `String.raw`.
  `shoot.mjs` lo verifica y falla en voz alta.
- **El campo de una arista de narrativa es `type`, no `edgeType`.** Un fixture con
  el nombre mal me hizo "arreglar" código que estaba bien.
- `Emulation.setTouchEmulationEnabled` rechaza `maxTouchPoints: 0`: siempre 5.
- Las páginas muy altas revientan el límite de captura de CDP: `shoot.mjs` acota
  el alto a 9000px y baja el `deviceScaleFactor`.
