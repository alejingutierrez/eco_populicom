# ECO — Vista Ejecutiva Multi-agencia · SPEC compartido para los mockups

Estás construyendo **mockups hiperrealistas** (estáticos, HTML) de una vista
**súper-ejecutiva** del producto **ECO (Social Listening)**, pensada para la
**Gobernadora de Puerto Rico y altos cargos del gobierno central** que necesitan
ver el estado de **todas las agencias a la vez**. No es una app real: es un mockup
de presentación, pero debe verse y sentirse como producto terminado.

Hay 6 conceptos distintos. Tú construyes **uno**. Todos comparten este SPEC,
`tokens.css` y `data.js` para que se vean como la **misma familia de producto**.

---

## 0. Reglas de oro (no negociables)

1. **Un solo archivo HTML** autocontenido, salvo dos enlaces compartidos:
   `<link rel="stylesheet" href="tokens.css">` y `<script src="data.js"></script>`.
   Las fuentes llegan vía `@import` dentro de `tokens.css`. **No** uses otras
   librerías (nada de Chart.js, D3, Tailwind, React). Gráficas = **SVG a mano**.
2. **Nunca** escribas colores hex sueltos. Usa **siempre** las variables CSS de
   `tokens.css` (`var(--text)`, `var(--accent)`, `var(--pos)`, `var(--neg)`,
   `var(--warn)`, `var(--canvas)`, `var(--hairline)`, etc.). Así el tema funciona.
3. **Datos exactos** desde `window.MOCK` (ver §2). Nombres de agencias y números
   tal cual. Cero "lorem ipsum", cero placeholders. Renderiza tablas/grids
   iterando `MOCK.agencies` con plantillas JS (`el.innerHTML = ...`).
4. **Español de Puerto Rico**, registro institucional/ejecutivo.
5. Diseña para un viewport **1440×900** (escritorio). Conceptos 1, 2, 3, 6 deben
   **caber sin scroll** (vista de "un vistazo"). El 5 puede tener scroll suave.
   El 4 es un documento vertical (se desplaza).
6. **No arranques servidores ni tomes screenshots.** Solo escribe el archivo HTML.
   El QA es central.
7. Incluye el **chrome compartido** (§3) y el **pie con disclaimer** (§3).

---

## 1. Cómo cablear el archivo

```html
<!DOCTYPE html>
<html lang="es" data-theme="TEMA" data-mode="MODO">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ECO — Vista Ejecutiva · <NOMBRE DEL CONCEPTO></title>
  <link rel="stylesheet" href="tokens.css" />
  <style> /* estilos propios del concepto aquí */ </style>
</head>
<body>
  <div id="app"></div>
  <script src="data.js"></script>
  <script> /* render leyendo window.MOCK */ </script>
</body>
</html>
```

`data-theme` ∈ `costa | gaceta | mando`. `data-mode` ∈ `light | dark`.
(Tu concepto te dice cuál usar.) El `<body>` ya hereda fondo y tipografía del tema.

---

## 2. Esquema de datos — `window.MOCK`

```
MOCK.meta   { product, client, scope, principal:'La Fortaleza', period:'Últimos 7 días',
              periodShort:'7 días', updated:'Hoy · 6:00 AM AST', disclaimer }
MOCK.gov    {
  name:'Gobierno de Puerto Rico', principal,
  bhi:50, bhiDelta:-3,            // Índice de Salud 0–100
  nss:-11, nssDelta:-6,           // Sentimiento Neto -100..100
  crisis:0.47, crisisDelta:+0.05, // Riesgo de Crisis 0–1 (=> banda ALERTA)
  polar:0.49, polarDelta:+0.03,   // Polarización 0–1
  engVel:1.7,                     // Velocidad de Interacción ×
  vol:178700, volDelta:+14,       // Menciones 7d, % vs semana previa
  reach:33150000,                 // Alcance
  agenciesTracked:13, inCrisis:1, inAlert:5,
  positivePct:33, neutralPct:31, negativePct:36,
  trend:[14 nums BHI], nssTrend:[14], crisisTrend:[14]
}
MOCK.agencies[]  (13 objetos), cada uno:
  key, name, short, sector('Económico'|'Social'|'Infraestructura'|'Seguridad'),
  lead (nombre del/la titular), role,
  bhi, bhiDelta, nss, nssDelta, crisis, polar, engVel,
  vol, reach, pos, neu, neg (%), rankDelta (Δ posición vs semana previa),
  hue (matiz HSL sugerido para series), win (logro), concern (riesgo principal),
  trend[14] (BHI), nssTrend[14], crisisTrend[14], volTrend[14]
MOCK.themes[]  olas temáticas que cruzan agencias: {label, vol, nss, agencies[], crisis, polar?}
MOCK.feed[]    escalamiento en vivo: {t, sev('crisis'|'alerta'|'elevado'|'positivo'), agency(key), title, metric, reach}

Helpers:
  MOCK.fmt.int(n)      -> "178,700"
  MOCK.fmt.compact(n)  -> "7.8M" / "178.7k"
  MOCK.fmt.signed(n,d) -> "+34" / "−18"   (usa el signo menos "−")
  MOCK.fmt.pct(n)      -> "47%"
  MOCK.crisisBand(s)   -> {label:'NORMAL|ELEVADO|ALERTA|CRISIS', cls:'pill-*', color, isCrisis?}
  MOCK.bhiBand(v)      -> {label:'Crítico|Débil|Sano|Fuerte', cls, color}
  MOCK.spark(arr,w,h,pad) -> {line, area, points, last:[x,y]}   // path SVG suave
  MOCK.byKey(k)        -> agencia
```

**Narrativa de los datos** (apóyala en el diseño): el gobierno está en **ALERTA**
ponderada. **Energía (AEE/LUMA)** está en **CRISIS** (lo que más arrastra). **Salud,
AAA, DTOP, Educación y Seguridad** en **ALERTA**. **Turismo y DDEC** son las
estrellas. El Índice de Salud del gobierno baja 3 pts esta semana; el sentimiento
neto cae a −11, empujado por Energía y Educación.

---

## 3. Chrome compartido (todas las vistas)

**Barra superior ejecutiva** (estilízala según tu tema):
- Izquierda: marca **ECO** (un punto/acento + wordmark) · separador · `Gobierno de
  Puerto Rico` · etiqueta fina `Vista Ejecutiva`.
- Centro/derecha: chip de periodo `Últimos 7 días`, texto `Actualizado: Hoy · 6:00 AM AST`,
  y un indicador `● EN VIVO` (punto que late, color `--pos` o `--accent`).
- Puedes añadir el sello/escudo conceptual de "La Fortaleza" como detalle (un
  monograma circular, no un logo real).

**Pie / banda inferior**: muestra `MOCK.meta.disclaimer`
("Datos ilustrativos · mockup de diseño · no representan métricas reales") en
`--text-3`, tamaño 10–11px. Discreto pero presente.

---

## 4. Vocabulario de métricas (etiquetas en español)

| Campo | Etiqueta UI | Escala / formato |
|---|---|---|
| `bhi` | **Índice de Salud** (de marca) | 0–100 · banda Crítico/Débil/Sano/Fuerte |
| `nss` | **Sentimiento Neto** | −100…+100 (`fmt.signed`) |
| `crisis` | **Riesgo de Crisis** | 0.00–1.00 · banda NORMAL/ELEVADO/ALERTA/CRISIS |
| `polar` | **Polarización** | 0.00–1.00 |
| `engVel` | **Velocidad de Interacción** | `1.7×` |
| `reach` | **Alcance** | `fmt.compact` |
| `vol` | **Menciones** | `fmt.int` / `fmt.compact` |

Bandas de crisis (umbral → etiqueta): `<0.25 NORMAL` · `<0.40 ELEVADO` ·
`<0.60 ALERTA` · `>=0.60 CRISIS`. Usa **siempre** `MOCK.crisisBand()`.

---

## 5. Recetas de componentes (vanilla — copia y adapta)

Todas usan las clases de `tokens.css` (`.card`, `.pill`, `.pill-pos/neg/warn/neu/info`,
`.num`, `.mono`, `.section-eyebrow`, `.card-hd`, `.bar-track`, `.row-hover`, `.chip`,
`.btn`, `.dot`, `.pulse`, `.ring-pulse`).

**Número héroe (KPI):**
```html
<div class="num" style="font-size:34px;font-weight:600;line-height:1;color:var(--text)">50</div>
```
Etiqueta: `<div style="font-size:11px;font-weight:600;color:var(--text-2);text-transform:uppercase;letter-spacing:.08em">Índice de Salud</div>`
Delta: color `var(--pos)` si mejora, `var(--neg)` si empeora, `var(--text-3)` si 0.
(Para crisis/polarización el signo se invierte: subir es malo → `var(--neg)`.)

**Sparkline (usa el helper):**
```js
const c = 'var(--accent)';                 // o color por banda
const s = MOCK.spark(a.trend, 120, 32, 2);
const svg = `<svg width="120" height="32" style="display:block">
  <path d="${s.area}" fill="${c}" opacity="0.12"/>
  <path d="${s.line}" stroke="${c}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <circle cx="${s.last[0].toFixed(1)}" cy="${s.last[1].toFixed(1)}" r="2.2" fill="${c}"/>
</svg>`;
```

**Barra de sentimiento (pos/neu/neg apiladas):**
```js
`<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:rgba(125,125,125,.18)">
  <div style="flex-grow:${a.pos};background:var(--pos)"></div>
  <div style="flex-grow:${a.neu};background:var(--text-3)"></div>
  <div style="flex-grow:${a.neg};background:var(--neg)"></div>
</div>`
```

**Banda de gradiente de crisis (patrón OverviewHighlights):**
```js
const cb = MOCK.crisisBand(a.crisis);
`<div style="height:6px;border-radius:3px;position:relative;background:linear-gradient(90deg,var(--pos) 0%,var(--pos) 25%,var(--warn) 25%,var(--warn) 40%,var(--neg) 40%,var(--neg) 100%)">
   <div style="position:absolute;left:${Math.min(a.crisis*100,100)}%;top:-3px;width:12px;height:12px;border-radius:50%;background:var(--canvas);border:2px solid ${cb.color};transform:translateX(-50%)"></div>
 </div>
 <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-3);margin-top:4px;font-family:var(--ff-mono);letter-spacing:.04em">
   <span>NORMAL</span><span>ELEVADO</span><span>ALERTA</span><span>CRISIS</span>
 </div>`
```

**Medidor radial (gauge) — para crisis del gobierno (arco 270°):**
```js
function gauge(value, max, size, thick, color){           // value/max 0..1
  const r=(size-thick)/2, cx=size/2, cy=size/2;
  const a0=Math.PI*0.75, a1=Math.PI*2.25, p=Math.max(0,Math.min(1,value/max));
  const pt=(ang)=>[cx+r*Math.cos(ang), cy+r*Math.sin(ang)];
  const [x0,y0]=pt(a0), [x1,y1]=pt(a1), [xv,yv]=pt(a0+(a1-a0)*p);
  return `<svg width="${size}" height="${size}">
    <path d="M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}" stroke="var(--canvas-2)" stroke-width="${thick}" fill="none" stroke-linecap="round"/>
    <path d="M ${x0} ${y0} A ${r} ${r} 0 ${p>0.66?1:0} 1 ${xv} ${yv}" stroke="${color}" stroke-width="${thick}" fill="none" stroke-linecap="round"/>
    <circle cx="${xv.toFixed(1)}" cy="${yv.toFixed(1)}" r="${thick/1.6}" fill="var(--canvas)" stroke="${color}" stroke-width="2"/>
  </svg>`;
}
```

**Pills de estado:**
```js
const cb = MOCK.crisisBand(a.crisis);  // `<span class="pill ${cb.cls}">${cb.label}</span>`
const bb = MOCK.bhiBand(a.bhi);        // `<span class="pill ${bb.cls}">${bb.label}</span>`
```

**Tarjeta:** `<div class="card" style="padding:16px">…</div>`. Encabezado de
tarjeta: `<div class="card-hd"><div><div class="card-hd-title">…</div><div class="card-hd-sub">…</div></div>…</div>`.

**Fila de tabla (grid):**
```html
<div class="row-hover" style="display:grid;grid-template-columns:…;gap:12px;padding:10px 14px;border-top:1px solid var(--hairline);align-items:center;font-size:13px">…</div>
```
Cabecera de tabla: texto 10px, `font-weight:700`, `color:var(--text-3)`,
`text-transform:uppercase`, `letter-spacing:.08em`.

**Delta de posición (ranking):** `▲ 2` en `var(--pos)`, `▼ 2` en `var(--neg)`,
`—` en `var(--text-3)` (usa `a.rankDelta`).

---

## 6. Calidad / acabado

- Jerarquía visual clara: lo más importante (estado del gobierno + qué arde) primero.
- Densidad informativa alta pero legible; alineación impecable (grids, tabular-nums).
- Microdetalles: hairlines, sombras suaves del token, pills, sparklines, un punto
  "EN VIVO" que late. Nada debe verse "a medio hacer".
- Contraste suficiente (los tokens ya lo garantizan si usas las variables).
- Que se lea como algo que pondrías frente a una Gobernadora: serio, preciso, elegante.
