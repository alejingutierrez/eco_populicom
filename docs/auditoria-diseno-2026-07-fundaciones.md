# Fundaciones del sistema de diseño — especificaciones completas

Apéndice de [`auditoria-diseno-2026-07.md`](auditoria-diseno-2026-07.md). Tres especificaciones: color, tipografía, y espaciado/primitivas. Parte del contenido de color y tipografía **ya está implementado** en `apps/web/public/eco-prototype/tokens.css` (ver §2 del informe); lo que queda aquí es el resto del plan, con los valores exactos.

---

# Sistema de COLOR de ECO (tokens, temas, semántica, contraste)

## Resumen

El sistema de color de ECO tiene una falla de raíz — `--accent` y `--neg` son el mismo hex (#FF6A3D en dark, #C83A1E en light) — que no es cosmética: produce lecturas falsas verificables con píxeles. La escala de Brand Health pinta la banda FUERTE (la mejor) con el MISMO rojo que CRÍTICO (la peor); el gauge de NSS pinta MUY POS igual que MUY NEG; en la gráfica multi-métrica las series "NSS" y "Crisis" son indistinguibles; Twitter y YouTube comparten color en la distribución por fuente; y el mapa de Geografía en modo "Volumen" cubre Puerto Rico de burbujas naranja-alarma. A eso se suman tres desacuerdos de semántica: (a) el delta de volumen es verde-si-sube en el Scorecard y rojo-si-sube en Tópicos —el mismo dato, colores opuestos, verificado por píxel en el treemap—; (b) la leyenda de la tendencia colorea la DIRECCIÓN y no la valencia, así que "NEGATIVO ▼8.5%" (buena noticia) sale en rojo; (c) `BAND_TONE` manda FUERTE, MUY POS y ACELERADA al tono `accent`, que es el rojo. Los 103 literales hex del JS no son ruido: son cuatro paletas fósiles de otros temas (costa/gaceta/Ant Design) que conviven en la misma pantalla — el calendario de tópicos usa #2E8B6A/#C2412F mientras el treemap 400px arriba usa #3FD47A/#FF6A3D, dos verdes y dos rojos para "positivo" y "negativo". En contraste, 415 de las 471 instancias que fallan WCAG en escritorio (88%) son un solo token: `--text-3` #525B68 sobre `--canvas` #0E1620 = **2.65:1**; otras 56 son texto claro sobre rellenos (mínimo 1.36:1 en los conteos del calendario, 2.38:1 en la píldora "PICO"). Corregir dos tokens y una regla de tinta ("relleno lleno = tinta oscura") elimina el 100% de esos 471 casos. Propongo: colapsar 6 combinaciones tema×modo a 1 tema × 2 modos con los tokens en `:root` incondicional (esto además cura el error boundary blanco-sobre-blanco), mover `--accent` al azul #58A6FF / #1F5FA8 (ΔE 116 vs `--neg`, y realinea con el favicon cyan que ya existe), y sustituir los 103 literales por cinco escalas nombradas con hex y contraste medidos: categórica (5+otros), emociones (7, el set canónico del processor), estados de narrativa (6), secuencial de magnitud (5) y tiers de texto AA.

> Todos los ratios de este documento están calculados con la fórmula WCAG 2.1 (luminancia relativa) y todas las distancias ΔE con CIE76 en Lab D65, sobre los hex exactos. Los valores marcados **HOY** salen del código en `/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/apps/web/public/eco-prototype/` y de `shots/probe-report.json`.

---

# 0 · Diagnóstico en una tabla

| # | Síntoma medible | Valor HOY | Objetivo |
|---|---|---|---|
| 1 | `--accent` vs `--neg` (mando dark) | **ΔE = 0** (`#FF6A3D` ambos) | ΔE ≥ 60 |
| 2 | `--accent` vs `--neg` (mando light) | **ΔE = 0** (`#C83A1E` ambos) | ΔE ≥ 60 |
| 3 | Instancias bajo AA en escritorio | **471** (1,884 sumando 4 viewports) | 0 |
| 4 | ...de las cuales son `--text-3` | **415 (88.1%)** a 2.65–2.89:1 | — |
| 5 | ...texto claro sobre relleno | **56 (11.9%)**, mínimo **1.36:1** | — |
| 6 | Texto que falla, por tamaño | **431 de 471 (91.5%) son 9–11px** | — |
| 7 | Literales de color fuera de tokens | **103 en JS + 17 hex + 12 rgba con tinte en index.html = 132** | ≤ 8 (sólo fallbacks pre-React) |
| 8 | Paletas de "positivo/negativo" coexistiendo | **2 verdes (#3FD47A, #2E8B6A) y 2 rojos (#FF6A3D, #C2412F)** | 1 y 1 |
| 9 | Combinaciones tema×modo declaradas | **6** (≈124 líneas de CSS + 13 overrides `[data-theme=]` + 14 condicionales `theme ===` en JS) | 2 |
| 10 | Combinaciones alcanzables en prod | **2** (mando dark + mando **light**, ver §1.1) | 2 |
| 11 | Tokens declarados sin un solo uso | `--info` = **0 usos** en 11k líneas | 0 |

---

# 1 · Los 3 temas × 2 modos: qué se borra y qué se conserva

## 1.1 Corrección al brief: mando **light** SÍ es alcanzable

El brief dice que sólo `mando`+`dark` llega a producción. Es medio cierto:

- `app.js:185` → `const [theme] = useState(TWEAK_DEFAULTS.theme);` — sin setter. `costa` y `gaceta` son **inalcanzables**. ✔
- `app.js:186` → `const [mode, setMode] = useState(() => localStorage.getItem('eco.mode') || TWEAK_DEFAULTS.mode);`
- `shell.js:549` → el botón del **sol** en el header llama `setMode(mode === 'dark' ? 'light' : 'dark')`
- `app.js:290` → `localStorage.setItem('eco.mode', mode)` — **persiste entre sesiones**

Es decir: cualquier usuario que toque el botón del sol (el único botón de su fila, F11) queda en **mando light para siempre**, y ese modo está roto:

| Roto en mando light | Ubicación | Qué pasa |
|---|---|---|
| Marcadores del mapa | `charts.js:810` `color:'#0E1620'`, `816` `#3FD47A/#FF6A3D/#8A94A1` | contorno azul-marino y verdes de dark sobre un mapa claro |
| Tooltip del mapa | `charts.js:824-826` `#E6ECF3` / `#8A94A1` | texto casi blanco dentro de una caja `rgba(14,22,32,.95)` (index.html:696) |
| Marcadores de menciones | `shell.js:761-763` mismos 4 hex de dark | idem |
| Calendario de tópicos | `screens.js:2454` `SENT_HEX` | hex de **costa light** — funciona por accidente en light, choca en dark |
| `--warn` como texto | index.html:174 `#B47410` | **3.86:1** sobre blanco → falla AA |
| `--text-3` como texto | index.html:166 `#8A909B` | **3.21:1** sobre blanco → falla AA |

La razón estructural: Leaflet recibe colores como **strings en opciones JS** (`fillColor`, `color`), no como CSS, así que no puede resolver custom properties de forma temática sin un puente. Es el argumento más fuerte para reducir el número de combinaciones: **cada combinación adicional multiplica la superficie donde el color se escapa del sistema.**

## 1.2 Recomendación: 1 tema × 2 modos, con los tokens en `:root`

**Conservar:** `mando` dark (canónico) + `mando` light (porque el toggle ya está enviado y persistido; quitarlo ahora rompería a quien lo tenga activado).

**Borrar:**

| Qué | Ubicación exacta | Líneas |
|---|---|---|
| Bloque `costa` light | `index.html:31-61` | 31 |
| Bloque `costa` dark | `index.html:62-89` | 28 |
| Bloque `gaceta` light | `index.html:94-124` | 31 |
| Bloque `gaceta` dark | `index.html:125-152` | 28 |
| Overrides `[data-theme="gaceta"]` | index.html:231, 366, 379, 396, 432, 436, 450, 455, 468, 481, 542 | 11 reglas |
| Overrides `[data-theme="costa"]` | index.html (2 selectores) | 2 reglas |
| Condicionales `theme === 'gaceta'` en JS | `shell.js:154, 199, 201, 202, 204, 206, 232-237, 1083-1092` | 14 ramas |
| Selector de tema en TweaksPanel | `shell.js:1080-1094` (los swatches con `#0B5F80,#3FB5D8,#0F2949,#C8A961,#0A0F16,#C83A1E`) | 6 literales |
| `--letter-display`, `--ff-serif` sólo-gaceta | index.html:21, 60, 123 | — |

**Total: ≈118 líneas de CSS, 14 ramas de JS, 6 literales hex.**

**Y el cambio que paga el viaje:** al quedar un solo tema, los tokens dejan de necesitar el selector `[data-theme="mando"][data-mode="dark"]` y pasan a `:root` **incondicional**, con `:root[data-mode="light"]` como único override.

Eso arregla **F5** de gratis. Hoy `app.js:319-320` pone `data-theme`/`data-mode` dentro de un `useEffect` **de `App`**; si `App` revienta en el primer render el effect nunca corre, `<html>` queda sin atributos, **ningún bloque de tema matchea** y todas las custom properties quedan sin definir → el `EcoErrorBoundary` se pinta blanco sobre blanco con un stack trace crudo. Con los tokens en `:root` la pantalla de error hereda la paleta completa aunque React nunca haya montado.

```css
/* ANTES */
[data-theme="mando"][data-mode="dark"] { --canvas:#0E1620; … }
/* DESPUÉS */
:root { --canvas:#0E1620; … }              /* dark = default incondicional */
:root[data-mode="light"] { --canvas:#FFFFFF; … }
```

**Consecuencia que hay que aceptar:** se pierde la demo de 3 temas. Si se quiere conservar como material comercial, el sitio correcto es un `theme-showcase.html` estático fuera del bundle de producción, no 118 líneas en el CSS crítico de una consola de gobierno.

---

# 2 · Romper `--accent === --neg`

## 2.1 Los sitios donde produce lecturas ambiguas (verificados)

| id | Dónde | Código | Qué lee el usuario |
|---|---|---|---|
| A | **Escala de Brand Health** | `screens.js:613-616` segmentos `neg / warn / pos / **accent**` + `shell.js:1580-1581` | La banda **FUERTE** (8–10, la mejor) se pinta del **mismo rojo** que **CRÍTICO** (1–4, la peor). Verificado por píxel en `dashboard-desktop-fold.png`: la barra corre `(48,33,34) rojo-oscuro → (255,192,67) ámbar → (20,46,41) verde-oscuro → (48,33,34) **rojo-oscuro**`. |
| B | **Gauge de NSS** | `shell.js:1596-1597` `…var(--pos) 55-70%, var(--accent) 70-100%` | **MUY POS** = mismo rojo que **MUY NEG**. Los dos extremos de la escala de sentimiento son rojos. |
| C | **Gráfica multi-métrica** | `screens.js:260` `nss: 'var(--accent)'` vs `263` `crisisRiskScore: 'var(--neg)'` | Seleccionar NSS + Crisis dibuja **dos líneas del mismo color**; la leyenda tiene dos puntos naranja idénticos (visible en `dashboard-desktop-fold.png`). |
| D | **Distribución por fuente** | `screens.js:290` y `544` `twitter:'var(--accent)'`, `youtube:'var(--neg)'` | **Twitter y YouTube son el mismo color** en la barra de fuentes. Además `news:'var(--pos)'` (verde=positivo) y `blog:'var(--warn)'` (ámbar=alerta): un gráfico de *identidad* pintado con tokens de *veredicto*. |
| E | **Botón primario** | index.html:453 `.btn-primary{background:var(--accent);color:#fff}` | "Ver menciones" y "Nueva regla" son cajas de alarma. En `mentions-desktop-fold.png` el chip activo "Todas", el punto del filtro "Negativo", "VELOCIDAD **Acelerada**", "VIRALES 1.0K", las píldoras "NEGATIVO" y el toggle "Lista" son **el mismo hex con seis significados**. |
| F | **"VELOCIDAD Acelerada"** | `metrics-display.ts:97` `ACELERADA:'accent'` → `TONE_COLOR.accent='var(--accent)'` | Un aumento del ritmo de conversación (neutro/informativo) sale en el rojo de alarma, al lado de "VIRALES" que sí está marcado `tone="neg"` a propósito. |
| G | **`.pill-info` ≡ `.pill-neg`** | index.html:400 vs **414** (`.pill-info{background:var(--accent-fill);color:var(--accent)}`) | `--neg-bg` = `rgba(255,106,61,.10)` y `--accent-fill` = `rgba(255,106,61,.14)`: 4% de opacidad separan una píldora informativa de una de alarma. |
| H | **Barra del heatmap horario** | `screens.js:688` celdas `rgba(255,106,61, .08+i*.85)` vs **`674`** leyenda `rgba(11,95,128, o)` | Celdas naranja-mando, leyenda azul-**costa**. Y el naranja dice "esta franja es mala" cuando sólo dice "hay volumen". |
| I | **Mapa de Geografía · modo Volumen** | `screens.js:2782` `colorFn={(m)=> metric==='nss' ? … : 'var(--accent)'}` | Toda la isla en burbujas naranja-alarma (ver `geography-desktop-fold.png`), con leyenda "● Volumen" del mismo color. Al cambiar a "Sentimiento" el **mismo naranja pasa a significar "municipio negativo"** sin que cambie la leyenda. |
| J | **Alertas: severidad vs magnitud** | `screens.js:3374` `['alta','var(--neg)']` vs **`3392`** `background:'var(--accent)'` | Card izquierdo: barra naranja = severidad **ALTA**. Card derecho, adyacente: 5 barras naranja = simple **conteo de activaciones**. Se leen como "5 reglas críticas". |
| K | **Cards del Scorecard** | `screens.js:430` `accent="var(--accent)" highlight` (NSS) y `437` `accent="var(--neg)" highlight` (Crisis) | Dos cards con el **mismo borde superior naranja de 2px**: la métrica principal de sentimiento y el riesgo de crisis. |
| L | **Estados de narrativa desconocidos** | `screens.js:4785` `NARRATIVE_STATUS_COLORS[n.status] \|\| 'var(--accent)'` | `escalating`/`sustained` (3 de las 8 narrativas sembradas) caen al naranja → en el mapa de conexiones se ven como **"Pico"** (`#FA8C16`, casi el mismo naranja). |
| M | **Marca** | `icon.svg` (favicon) `#2A92B5` **cyan** vs `shell.js:213-217` arcos en `var(--accent-2)` **naranja**, `202` borde `rgba(125,183,172,.18)` **teal**, `244-245` badge v2.3 fondo/borde teal + texto naranja | Cuatro familias de color en 200×60px. Verificado en `logo-zoom.png`. El favicon del producto no es del color del producto. |

## 2.2 Paleta corregida — **Plan A (recomendado)**: `--accent` al azul, `--neg` intacto

**Por qué mover accent y no neg:** `--neg` tiene 96 usos y todos son *datos* (sentimiento, crisis, severidad, alertas) — no queremos tocarlos. `--accent` tiene 108 usos y todos son *interfaz* (nav activo, foco, links, botón primario, chips activos, marks, tints). Mover accent no cambia ni un dato de sitio. Y el azul **realinea con el favicon cyan que ya existe** y con el patrón de los otros dos temas, donde `--info` **es** el accent (`costa: --info:#0B5F80` = accent; `gaceta: --info:#0F2949` = accent). Mando fue el único que rompió el patrón: le dio a `--info` un azul propio (**0 usos**) y le regaló el rojo al accent.

### mando · DARK

| Token | HOY | **PROPUESTO** | Contraste vs `--canvas` #0E1620 | Notas |
|---|---|---|---|---|
| `--bg` | `#060A10` | `#060A10` | — | sin cambio |
| `--bg-2` | `#0A111A` | `#0A111A` | — | sin cambio |
| `--canvas` | `#0E1620` | `#0E1620` | — | sin cambio |
| `--canvas-2` | `#091018` | `#091018` | — | sin cambio |
| `--text` | `#E6ECF3` | `#E6ECF3` | **15.30** ✔AAA | sin cambio |
| `--text-2` | `#8A94A1` | **`#A9B4C2`** | 5.92 → **8.66** ✔AAA | L* 60.9 → 72.9 |
| `--text-3` | `#525B68` | **`#7C8695`** | **2.65 ✘** → **4.94** ✔AA | L* 38.3 → 55.6 |
| `--text-disabled` | (no existe) | **`#5A6472`** | 3.15 | sólo para estado deshabilitado, nunca informativo |
| `--accent` | `#FF6A3D` | **`#58A6FF`** | **7.20** ✔AAA | ΔE vs `--neg` = **116** |
| `--accent-2` | `#FF8A63` | **`#8CC2FF`** | 9.77 | hover / marca |
| `--accent-fill` | `rgba(255,106,61,.14)` | **`rgba(88,166,255,.14)`** | resuelve a `#182A3F`; accent encima = **5.77** ✔ | |
| `--accent-line` | (no existe) | **`rgba(88,166,255,.45)`** | | bordes de estado activo |
| `--accent-ink` | (no existe) | **`#08111B`** | **7.51** sobre `#58A6FF` ✔ | tinta de `.btn-primary` |
| `--info` | `#58A6FF` (0 usos) | **`var(--accent)`** | 7.20 | se alía, no se duplica |
| `--pos` | `#3FD47A` | `#3FD47A` | **9.45** ✔AAA | sin cambio |
| `--pos-strong` | (no existe) | **`#7BE8A4`** | **12.34** | tope de escala (BHI FUERTE, NSS MUY POS) |
| `--pos-fill` | `rgba(63,212,122,.10)` | **`rgba(63,212,122,.14)`** | pos encima = **7.23** ✔ | |
| `--pos-ink` | (no existe) | **`#08111B`** | **9.86** ✔ | |
| `--neg` | `#FF6A3D` | `#FF6A3D` | **6.39** ✔AA | **sin cambio** |
| `--neg-fill` | `rgba(255,106,61,.10)` | **`rgba(255,106,61,.14)`** | neg encima = **5.35** ✔ | |
| `--neg-ink` | (no existe) | **`#08111B`** | **6.67** ✔ | |
| `--warn` | `#FFC043` | `#FFC043` | **11.15** ✔AAA | sin cambio |
| `--warn-fill` | `rgba(255,192,67,.10)` | **`rgba(255,192,67,.14)`** | warn encima = **8.34** ✔ | |
| `--warn-ink` | (no existe) | **`#08111B`** | **11.64** ✔ | |
| `--neu` | **no existe** (¡y `screens.js:1560` la usa!) | **`#8D99AC`** | **6.31** ✔AA | cierra el bug de `var(--neu)` |
| `--neu-fill` | — | **`rgba(141,153,172,.16)`** | neu encima = **5.15** ✔ | reemplaza el `color-mix` de `.pill-neu` |
| `--hairline` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.07)` | 1.19 — **decorativo** | |
| `--hairline-strong` | `rgba(255,255,255,.12)` | **`rgba(255,255,255,.34)`** | **3.10** ✔ 1.4.11 | separadores que **significan** (filas de tabla, subrayado de tab activo) |
| `--rail-bg` | `#030609` | `#030609` | — | |
| `--rail-fg` | `rgba(255,255,255,.44)` | **`rgba(255,255,255,.58)`** | resuelve `#959698`, **6.86** vs rail (era **4.32 ✘**) | |
| `--rail-active-bg` | `rgba(255,106,61,.18)` | **`rgba(88,166,255,.16)`** | | |
| `--rail-active-line` | (no existe) | **`#58A6FF`** | | barra de 2px: el estado activo deja de depender sólo del tinte |
| `--overlay` | 3 valores distintos | **`rgba(2,6,11,.62)`** | | unifica index.html:522/530, 548/552, 1233 |

### mando · LIGHT

| Token | HOY | **PROPUESTO** | vs `#FFFFFF` | vs `--bg` `#F5F6F7` |
|---|---|---|---|---|
| `--text` | `#0E1116` | `#0E1116` | 18.91 ✔ | 17.48 ✔ |
| `--text-2` | `#525963` | **`#454C58`** | 7.08 → **8.65** ✔ | **7.99** ✔ |
| `--text-3` | `#8A909B` | **`#636B77`** | **3.21 ✘** → **5.38** ✔ | **4.98** ✔ |
| `--text-disabled` | — | **`#9AA1AC`** | 2.64 | sólo deshabilitado |
| `--accent` | `#C83A1E` | **`#1F5FA8`** | **6.44** ✔ | 5.95 ✔ |
| `--accent-2` | `#E85A3E` | **`#17518F`** | 8.05 ✔ | 7.44 ✔ |
| `--accent-fill` | `rgba(200,58,30,.08)` | **`rgba(31,95,168,.09)`** | | |
| `--accent-ink` | — | **`#FFFFFF`** | **6.44** sobre accent ✔ | |
| `--info` | `#1F4575` | **`var(--accent)`** | | |
| `--neg` | `#C83A1E` | **`#C0341B`** | 5.15 → **5.60** ✔ | 5.18 ✔ |
| `--neg-ink` | — | **`#FFFFFF`** | 5.60 ✔ | |
| `--pos` | `#1D7F3C` | **`#1B7538`** | 5.06 → **5.76** ✔ | 5.32 ✔ |
| `--pos-strong` | — | **`#0F5F2C`** | 7.42 ✔ | |
| `--pos-ink` | — | **`#FFFFFF`** | 5.76 ✔ | |
| `--warn` | `#B47410` | **`#8A5A0B`** | **3.86 ✘** → **5.92** ✔ | 5.47 ✔ |
| `--warn-ink` | — | **`#FFFFFF`** | 5.92 ✔ | |
| `--neu` | — | **`#4A5567`** | 7.54 ✔ | 6.97 ✔ |
| `--hairline` | `#DFE2E6` | `#DFE2E6` | 1.30 decorativo | |
| `--hairline-strong` | `#BFC5CC` | **`#8F96A0`** | **3.00** ✔ 1.4.11 | |

**ΔE `--accent` vs `--neg`:** dark **116** · light **103** (hoy: **0** en ambos).

## 2.3 Plan B (si el cliente se niega a perder el naranja de interfaz)

Mantener `--accent:#FF6A3D` y mover `--neg` a un rojo-rosa: `#FF4D6A` (dark, 5.65:1) / `#B3243C` (light).

- ΔE accent↔neg = **32**. Es distinguible lado a lado, pero **no** en un punto de 8px, ni en una línea de 1.5px, ni para un deuteranope.
- No resuelve el error de categoría: un botón "Ver menciones" naranja junto a una píldora "NEGATIVO" rosa-roja sigue leyéndose como familia.
- Obliga a tocar los **96** usos de `--neg` (todos datos) en vez de los 108 de accent (todos interfaz).
- **Y no arregla A ni B**: la banda FUERTE del BHI seguiría siendo naranja, o sea "casi alarma".

**Veredicto: Plan A.** Si el naranja es identidad irrenunciable, la salida honesta es conservarlo como `--accent` y **eliminar `accent` del vocabulario de datos** (ver §5.2), no acercar dos rojos.

---

# 3 · Los 132 literales → escalas tokenizadas

## 3.1 Censo por intención

| Intención | Literales | Ocurrencias | Ubicaciones | Token nuevo |
|---|---|---|---|---|
| **Tinta sobre relleno** | `#fff` | 12 | `charts.js:417`; `screens.js:497,499,2568,2570,3155,3523,3767`; `shell.js:173,203,231,313` | `--accent-ink` / `--pos-ink` / `--neg-ink` / `--warn-ink` / `--cat-ink` |
| **Polarización** | `#8B5CF6` | 10 | `screens.js:264,290,463,464,467×2,468,544`; `shell.js:1589×2` | `--cat-2` (`#B084F0`) |
| **Paleta de tópicos** (duplicada **4 veces**) | `#E1767B #4A7FB5 #6B9E7F #C08457 #8B6BB0 #D4A73E #5A9FA8 #A3624D` | 32 | `screens.js:311, 1998, 2448, 4143` (+ `3532-3537, 3594` avatares) | `--cat-1..5` + `--cat-other` |
| **Emociones** | `#8C5BA8 #7B8794 #5FA98A` | 9 | `screens.js:1771-1785` | `--emo-*` (7 tokens) |
| **Estados de narrativa** (Ant Design) | `#FA8C16 #52C41A #13C2C2 #EB2F96 #FAAD14 #8C8C8C` | 6 | `screens.js:4602-4607` | `--nar-*` (6 tokens) |
| **Sentimiento fósil (costa)** | `#2E8B6A #C2412F #7C8698` + `#7C86984D #7C869999 #7C8698FF` | 6 | `screens.js:2454, 2610-2612` | `--pos` / `--neg` / `--neu` |
| **Fuentes/plataformas** | `#0A7EA4` | 2 | `screens.js:290, 544` | `--cat-*` |
| **Banda intermedia de crisis** | `#E0662E` | 3 | `screens.js:34×2, 38` | `--crisis-3` (ver §3.5) |
| **Mando dark en JS (Leaflet)** | `#0E1620 #3FD47A #FF6A3D #8A94A1 #E6ECF3` | 11 | `charts.js:810,816,824-826`; `shell.js:761-763` | puente `readToken()` (§3.6) |
| **Marca** | `#1A2838 #0B111A` + `rgba(125,183,172,…)` ×3 + `rgba(107,158,127,.6)` + `#2A92B5` (icon.svg) | 7 | `shell.js:201-204, 223, 244-245`; `icon.svg` | `--brand-*` |
| **Swatches del selector de tema** | `#0B5F80 #3FB5D8 #0F2949 #C8A961 #0A0F16 #C83A1E` | 6 | `shell.js:1087` | **se borran con el selector** |
| **Fallbacks pre-React** (legítimos) | `#3a1411 #3a2e11 #ff8a63 #ffc043 #060A10 #8A94A1` | 6 | `index.html:1359, 1387-1388` | **se quedan literales, a propósito** |
| **Azul costa filtrado en index.html** | `rgba(63,181,216,.85)` `rgba(63,181,216,.08)` | 2 | `index.html:718, 1009` | `--accent` |

## 3.2 Paleta **categórica** — identidad, nunca veredicto

Restricción real: hay que esquivar 4 bandas de tono reservadas (neg ~44°, warn ~81°, pos ~150°, accent ~274° en tono Lab) manteniendo ΔE ≥ 30 entre pares. **No caben 8 colores.** Caben **5 + "otros"** — y esa es la recomendación de diseño, no una limitación: una dona de 8 plataformas es ilegible de todos modos, y las fuentes **ya tienen glifo de marca** en la lista de menciones (`Icons.Facebook`, etc.). Regla: **identidad de plataforma = glifo + etiqueta; el color sólo entra cuando hay ≤5 categorías y se necesita ligar series entre dos vistas.** Todo lo que pase de 5 se agrupa en `--cat-other`.

### DARK (sobre `--canvas` #0E1620)

| Token | Hex | L* | Tono | Contraste | ΔE mín. vs pos/neg/warn/accent |
|---|---|---|---|---|---|
| `--cat-1` cyan | **`#3FC8D8`** | 74.4 | 211° | **9.07** ✔AAA | **48** |
| `--cat-2` violeta | **`#B084F0`** | 63.4 | 309° | **6.41** ✔AA | **35** |
| `--cat-3` magenta | **`#EC6FA8`** | 63.4 | 352° | **6.42** ✔AA | **60** |
| `--cat-4` oliva | **`#AEBE4E`** | 73.8 | 112° | **8.90** ✔AAA | **37** |
| `--cat-5` taupe | **`#C9A38A`** | 69.8 | 60° | **7.87** ✔AAA | **51** |
| `--cat-other` | **`#8D99AC`** | 62.9 | 269° | **6.31** ✔AA | **40** |
| `--cat-ink` | **`#08111B`** | — | — | 6.6–9.5 sobre cada relleno ✔ | tinta sobre relleno lleno |

ΔE pares mínimos: taupe/other **32**, cyan/other **34**, violeta/magenta **44**. Todos ≥ 4.5:1 → **también sirven como texto de leyenda**, no sólo como relleno.

### LIGHT (sobre `#FFFFFF`)

| Token | Hex | Contraste vs `#FFF` | vs `#F5F6F7` | ΔE mín. vs semánticos light |
|---|---|---|---|---|
| `--cat-1` | **`#1E7A88`** | **5.01** ✔ | 4.63 ✔ | 41 |
| `--cat-2` | **`#6B3FA0`** | **7.38** ✔ | 6.82 ✔ | 32 |
| `--cat-3` | **`#A61E63`** | **7.03** ✔ | 6.50 ✔ | 54 |
| `--cat-4` | **`#5C6B14`** | **5.89** ✔ | 5.44 ✔ | 29 |
| `--cat-5` | **`#7A5641`** | **6.49** ✔ | 6.00 ✔ | 30 |
| `--cat-other` | **`#4A5567`** | **7.54** ✔ | 6.97 ✔ | 34 |
| `--cat-ink` | **`#FFFFFF`** | 5.0–7.5 sobre cada relleno ✔ | | |

### Asignación de fuentes (reemplaza `screens.js:290` y `544`)

| Fuente | HOY | PROPUESTO |
|---|---|---|
| news | `var(--pos)` 🚨 verde=positivo | `--cat-1` |
| facebook | `#0A7EA4` | `--cat-2` |
| twitter/X | `var(--accent)` 🚨 | `--cat-3` |
| instagram | `#8B5CF6` | `--cat-4` |
| youtube | `var(--neg)` 🚨 | `--cat-5` |
| blog / reddit / forum / resto | `var(--warn)` 🚨 | `--cat-other` |

## 3.3 Paleta de **emociones** — 7, el set canónico

El set canónico **no es el que el frontend cree**. `infra/lambda/processor/index.ts:546-548`:

```ts
const validEmotions: Emotion[] = [
  'frustración','enojo','alivio','gratitud','preocupación','sarcasmo','indiferencia',
];
```

Hoy hay **tres** mapas que no coinciden:

1. `apps/web/src/app/api/eco-data/route.ts:875-878` → `{enojo, frustración, preocupación, aprobación, esperanza, alegría, confusión}`. **4 de sus 7 claves (`aprobación`, `esperanza`, `alegría`, `confusión`) el processor nunca las emite**, y le faltan `alivio`, `gratitud`, `sarcasmo`, `indiferencia` → todas caen a `'neu'`.
2. `screens.js:1777-1786` `emotionColor()` — **ignora a propósito** el `color` del API y re-mapea por nombre con otra lista.
3. `screens.js:1560` `openEmotionSlice()` — **sí** usa `e.color` → `var(--neu)`, una variable que **no existe en ningún tema**, así que el acento del modal se resuelve vacío.

Consecuencia visible en `sentiment-desktop-fold.png`: la emoción **dominante, "Ira" (223, 24.5%)**, se pinta **gris** — el gris de "indiferencia" — igual que Miedo, Tristeza y Sorpresa. Cuatro de las siete filas usan el color de fallback. La tarjeta promete un código de color y entrega ruido.

**Regla:** las emociones **sí** pueden compartir familia con pos/neg/warn, porque significan lo mismo (valencia). Lo que no puede pasar es que compartan **hex** (o el usuario no distingue "el sentimiento es negativo" de "la emoción es enojo"). Se implementan como **rampa divergente** con `sarcasmo` fuera de eje.

| Token | DARK | vs canvas | LIGHT | vs #FFF |
|---|---|---|---|---|
| `--emo-enojo` | **`#F2545B`** | **5.37** ✔ | **`#B02A34`** | **6.51** ✔ |
| `--emo-frustracion` | **`#FF8A4C`** | **7.79** ✔ | **`#B85416`** | **4.86** ✔ |
| `--emo-preocupacion` | **`#F0B429`** | **9.76** ✔ | **`#8A6410`** | **5.37** ✔ |
| `--emo-sarcasmo` | **`#B084F0`** (=`--cat-2`) | **6.41** ✔ | **`#6B3FA0`** | **7.38** ✔ |
| `--emo-indiferencia` | **`#8D99AC`** (=`--neu`) | **6.31** ✔ | **`#4A5567`** | **7.54** ✔ |
| `--emo-alivio` | **`#4FD1C5`** | **9.75** ✔ | **`#0F7A72`** | **5.19** ✔ |
| `--emo-gratitud` | **`#3FD47A`** (=`--pos`) | **9.45** ✔ | **`#1B7538`** | **5.76** ✔ |

ΔE pares mínimos dark: enojo/frustración **33**, frustración/preocupación **37**, indiferencia/alivio **41**. Light: **30** mínimo.

**Acción de código (una sola fuente de verdad):** borrar `emotionColor()` (`screens.js:1777-1786`) y el `emotionColorMap` del API (`route.ts:875-878`); el API emite **`emotionKey`** (el slug canónico normalizado del processor) y el front hace `var(--emo-${emotionKey})`. Cualquier emoción fuera de las 7 → `--emo-indiferencia` **más** un sufijo textual "(sin clasificar)", para que el fallback sea visible y no silencioso.

## 3.4 Estados de **narrativa** — 6

Hoy `screens.js:4601-4607` es la paleta de Ant Design, importada tal cual: `#FA8C16` choca con el naranja de alarma (ΔE vs `--neg` = 26), `#FAAD14` con `--warn` (ΔE = 17), `#52C41A` con `--pos` (ΔE = 22). Y `index.html:905` `.narrative-status-pill{color:white}` sobre `#FA8C16` da **2.38:1 — el peor texto de toda la aplicación**.

Es una escala **ordinal de intensidad** (dormida < emergente < activa < pico) con dos estados fuera de eje (decae, revivida). Que `pico` aterrice en la familia del rojo **es correcto**: una narrativa en pico *sí* es urgente. La regla que se estrena aquí: **compartir tono está permitido cuando el significado es el mismo** (urgencia); está prohibido cuando es distinto (interfaz vs dato).

| Estado | Token | DARK | vs canvas | LIGHT | vs #FFF | Glifo (a11y) |
|---|---|---|---|---|---|---|
| Pico | `--nar-pico` | **`#FF6A3D`** (=`--neg`) | **6.39** ✔ | **`#C83A1E`** | 5.15 ✔ | ▲▲ |
| Activa | `--nar-activa` | **`#4DA3E8`** | **6.69** ✔ | **`#1F5FA8`** | 6.44 ✔ | ● |
| Emergente | `--nar-emergente` | **`#3FC8D8`** (=`--cat-1`) | **9.07** ✔ | **`#146C7C`** | 6.06 ✔ | ▲ |
| Revivida | `--nar-revivida` | **`#B084F0`** (=`--cat-2`) | **6.41** ✔ | **`#6B3FA0`** | 7.38 ✔ | ↻ |
| Decae | `--nar-decae` | **`#C69A5B`** | **7.08** ✔ | **`#7A5A25`** | 6.33 ✔ | ▼ |
| Dormida | `--nar-dormida` | **`#5B6676`** | 3.12 (sólo relleno) | **`#6E7784`** | 4.53 ✔ | · |
| **Desconocido** | `--nar-unknown` | **`#5B6676`** + borde punteado | — | idem | — | ? |

ΔE pares mínimos: dark **37**, light **21** (dormida/emergente — aceptable porque van siempre con etiqueta + glifo).

**Y la píldora:** `.narrative-status-pill` deja de ser relleno lleno con `color:white` y pasa a **relleno tintado + texto del token**, igual que `.pill-*`:

```css
.narrative-status-pill{
  background: color-mix(in oklab, var(--nar-c) 16%, var(--canvas));
  color: var(--nar-c);
  border: 1px solid color-mix(in oklab, var(--nar-c) 45%, transparent);
}
```
`#FF6A3D` sobre su propio 16% = **5.35:1** ✔ (era 2.38 ✘). El `--nar-unknown` añade `border-style:dashed` para que "no sé qué estado es esto" se vea.

## 3.5 Escalas **secuenciales** — magnitud sin valencia

### `--seq-*` (volumen: heatmap horario, coropleta, calendario)

El volumen **no es bueno ni malo**. Se pinta en la familia del accent (atención), no en la del rojo.

| Token | DARK | vs canvas | LIGHT | vs #FFF |
|---|---|---|---|---|
| `--seq-0` | **`transparent`** + `inset 0 0 0 1px var(--hairline)` | — | idem | — |
| `--seq-1` | **`#16323F`** | 1.35 | **`#DCEBF2`** | 1.22 |
| `--seq-2` | **`#1C5570`** | 2.24 | **`#A9D2E2`** | 1.61 |
| `--seq-3` | **`#1F7C9E`** | 3.84 | **`#6BADC7`** | 2.49 |
| `--seq-4` | **`#2FA6C9`** | 6.43 | **`#2E7F9E`** | 4.52 |
| `--seq-5` | **`#5FD3E8`** | 10.37 | **`#0E4F68`** | 8.99 |

ΔE entre pasos adyacentes: 16–18 — ordenado y perceptualmente uniforme, que es lo que debe hacer una secuencial.

**Dos correcciones de honestidad que la rampa habilita:**

1. **`--seq-0` ≠ `--seq-1`.** Hoy `screens.js:688` arranca en `alpha .08` y `screens.js:2548` en `intensity = 0.3 + …`: una franja con **cero** menciones se pinta con 8% (o 30%) de color. "Nada" se ve como "poco". Con `--seq-0: transparent` + hairline, el vacío es vacío.
2. **Tinta de celdas etiquetadas.** `screens.js:2568-2573` alterna entre `#fff` y `var(--text)` (`#E6ECF3`) según `intensity > 0.65`. **No es un flip**: 6% de diferencia de luminancia entre las dos ramas. Sobre `#2E8B6A` opaco dan 4.19 y 3.52 — ambos fallan. Y el conteo usa `var(--text-2)` → **1.36:1** (40 instancias en el probe, las peores de la app).
   **Regla nueva:** celdas con etiqueta usan **sólo 4 buckets** (`seq-1, seq-2, seq-4, seq-5`) y la tinta salta de verdad:
   | Bucket | Tinta | Contraste |
   |---|---|---|
   | `--seq-1` | `--text` `#E6ECF3` | **11.30** ✔ |
   | `--seq-2` | `--text` `#E6ECF3` | **6.84** ✔ |
   | `--seq-4` | `--cat-ink` `#08111B` | **6.71** ✔ |
   | `--seq-5` | `--cat-ink` `#08111B` | **10.82** ✔ |
   `--seq-3` queda **prohibido para celdas con texto** (3.98 / 4.01 — falla por ambos lados). Es el paso "muerto" de toda rampa de 5; hay que saberlo y esquivarlo, no descubrirlo en producción.

### `--crisis-1..4` (rampa de veredicto, 4 bandas)

`screens.js:34` `CRISIS_GRADIENT` corre `pos → warn → #E0662E → neg`. Los dos últimos tramos son **ΔE = 14**: en la captura `overview-desktop-fold.png` las zonas ALERTA y CRISIS se leen como una sola. Y `#E0662E` es un literal huérfano que aparece 3 veces.

| Banda | Corte | Token | DARK | vs canvas |
|---|---|---|---|---|
| NORMAL | <0.25 | `--crisis-1` | **`#3FD47A`** (=`--pos`) | 9.45 |
| ELEVADO | <0.40 | `--crisis-2` | **`#FFC043`** (=`--warn`) | 11.15 |
| ALERTA | <0.60 | `--crisis-3` | **`#FF8A4C`** | **7.79** — ΔE vs crisis-4 = **28** |
| CRISIS | ≥0.60 | `--crisis-4` | **`#E23B2E`** | **4.72** — rojo profundo, ΔE vs `--neg` = 22 |

## 3.6 El puente para Leaflet (los 11 literales de `charts.js` / `shell.js`)

Leaflet recibe colores como strings JS, así que no hay forma de que resuelvan variables CSS en `fillColor`/`color`. Un helper de 3 líneas cierra la fuga y hace que el mapa siga al modo:

```js
const readToken = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// charts.js:810/816 y shell.js:761-763
color: readToken('--canvas'),
fillColor: readToken(m.nss > 0 ? '--pos' : m.nss < 0 ? '--neg' : '--neu'),
```
Y el tooltip (`charts.js:824-826`) usa `class="eco-map-tooltip"` con CSS tematizado en vez de estilos inline — hay que reescribir `index.html:695-721` para usar tokens (`var(--canvas)`, `var(--text)`, `var(--hairline-strong)`, `var(--accent)`) en lugar de los 8 `rgba()` literales, incluidos los dos `rgba(63,181,216,…)` que son **azul costa** filtrado dentro del CSS.

---

# 4 · Los 471 casos de bajo contraste, agrupados

## 4.1 Distribución exacta (viewport desktop; los 4 viewports dan los mismos 471)

| Grupo | Instancias | % | Color / fondo | Ratio | Ejemplos del probe |
|---|---|---|---|---|---|
| **G1 · `--text-3` sobre superficies oscuras** | **415** | **88.1%** | `#525B68` sobre `#0E1620` / `#091018` / `#060A10` | **2.65 / 2.78 / 2.89** | `«hace 6 h»`, `.card-hd-sub`, botones `1D…Max`, `.section-eyebrow`, `«NORMAL»`, `«NEGATIVO»`, `.narrative-panel-label`, `«142 menc»`, `.num «Neutral»` (30px y 40px) |
| **G2 · `#fff` sobre relleno lleno** | **22** | 4.7% | `#FFFFFF` sobre `#FF6A3D` / `#FA8C16` / `#4A7FB5` / `#2E8B6A` / `#8A94A1` | **2.85 / 2.38 / 4.20 / 4.19 / 3.07** | `.chip.active «Todas»`, `.btn-primary «Ver menciones»`, `.narrative-status-pill «PICO»`, avatares `«AG»`, celdas del calendario |
| **G3 · `--text` sobre relleno** | **21** | 4.5% | `#E6ECF3` sobre `#2E8B6A` / `#C2412F` / `#7C8698` | **3.52 / 4.32 / 3.09** | nombres de tópico en las celdas del calendario, conteos `.mono «30»` |
| **G4 · `--text-2` sobre relleno** | **13** | 2.8% | `#8A94A1` sobre `#2E8B6A` / `#C2412F` / `#7C8698` | **1.36 / 1.67 / 3.09** | `.num «24»`, `.num «27»` — el volumen del día en el calendario |

**Por tamaño:** 216 a 10px, 169 a 11px, 46 a 9px → **431 de 471 (91.5%) son texto de 9–11px.**

## 4.2 Respuestas directas

- **`--text-3` #525B68 sobre `--canvas` #0E1620 → 2.65:1.** Necesita 4.5 (es texto de 9–13px, no aplica la excepción de texto grande, que empieza en 18.66px bold / 24px). Falta un **41%** de luminancia.
- **Sobre `--canvas-2` #091018 → 2.78:1. Sobre `--bg` #060A10 → 2.89:1.** El peor caso es `--canvas` (la superficie más clara), así que ahí se calibra.

## 4.3 Valores nuevos que pasan AA **sin aplanar** la jerarquía

| Tier | HOY | L* | **PROPUESTO** | L* | vs canvas | vs canvas-2 | vs bg |
|---|---|---|---|---|---|---|---|
| `--text` | `#E6ECF3` | 93.1 | `#E6ECF3` | 93.1 | **15.30** | 16.03 | 16.68 |
| `--text-2` | `#8A94A1` | 60.9 | **`#A9B4C2`** | 72.9 | **8.66** | 9.09 | 9.44 |
| `--text-3` | `#525B68` | **38.3** | **`#7C8695`** | 55.6 | **4.94** | 5.19 | 5.39 |
| `--text-disabled` | — | — | **`#5A6472`** | 42.6 | 3.15 | — | — |

**Sobre "aplanar":** los pasos de L* pasan de 22.6 / 32.2 a **17.3 / 20.2** — más parejos y aún claramente tres tiers (17 puntos de L* es más del doble del umbral de discriminación en pantalla). Lo que hoy se lee como "jerarquía profunda" es en realidad **un tier invisible**: 415 elementos que el sistema *cree* que dice y el usuario no lee.

Y hay que decirlo sin rodeos: **subir el contraste no arregla 9px.** El grupo G1 sigue siendo texto de 9–11px con `letter-spacing: 0.14em` en mayúsculas. La corrección de color es necesaria pero no suficiente; se coordina con la unidad de tipografía (mínimo 12px para texto informativo, 11px sólo para eyebrows en `--text-2`).

## 4.4 La regla que elimina G2+G3+G4 (56 casos) de un golpe

> **Relleno lleno ⇒ tinta oscura. Sin excepciones. Texto claro sólo sobre tinte (≤20%).**

`#fff` **falla sobre los cuatro tokens semánticos** (1.63–2.85:1). `#08111B` **pasa sobre los cuatro** (6.67–11.64:1).

| Componente | HOY | PROPUESTO | Antes → Después |
|---|---|---|---|
| `.btn-primary` (index.html:453) | `background:var(--accent); color:#fff` | `color: var(--accent-ink)` | **2.85 → 7.51** ✔ |
| `.chip.active` mando (index.html:437) | `background:var(--accent); color:#fff` | `color: var(--accent-ink)` | **2.85 → 7.51** ✔ |
| `.chat-send` (index.html:635) | `background:var(--accent); color:#fff` | `color: var(--accent-ink)` | 2.85 → 7.51 ✔ |
| `.narrative-status-pill` (index.html:905) | `color:white` sobre relleno lleno | píldora tintada (§3.4) | **2.38 → 5.35** ✔ |
| Avatares (`screens.js:3767`) | `color:#fff` sobre `#4A7FB5` | `--cat-ink` sobre `--cat-2` | **4.20 → 6.7** ✔ |
| Celdas del calendario (`screens.js:2568-2573`) | `#fff` / `--text` / `--text-2` sobre `SENT_HEX` | 4 buckets `--seq-*` + tinta que salta (§3.5) | **1.36 → ≥6.71** ✔ |
| Toggle de vista `«Lista»`, `«Volumen»`, `«Historial»`, `«Treemap»`, `«Detalle»` | `#fff` sobre accent | `--accent-ink` | 2.85 → 7.51 ✔ |

`--pos-ink`, `--neg-ink`, `--warn-ink`, `--cat-ink` valen todos `#08111B` en dark y `#FFFFFF` en light — pero se declaran por token, no se comparten a mano, para que un cambio futuro de `--warn` no rompa su tinta en silencio.

---

# 5 · Semántica: reglas duras

## 5.1 A qué tiene derecho cada familia

| Familia | Significa | Se usa **sólo** en | **Prohibido** |
|---|---|---|---|
| `--accent` / `--accent-fill` / `--accent-line` | «puedes interactuar / esto está seleccionado / esto lo hizo la IA» | nav activo, `:focus-visible`, links, botón primario, chip/tab activo, `<mark>` de búsqueda, borde de fila seleccionada, badges de IA | **jamás** dentro de un área de datos: series de gráfica, puntos de leyenda, rellenos de barra, marcadores de mapa, píldoras de valor |
| `--pos` / `--neg` / `--warn` | **veredicto** sobre un valor: bueno / malo / precaución | píldoras de sentimiento, bandas de métrica, severidad, deltas con valencia definida | como identidad de categoría (fuente, tópico, plataforma) |
| `--neu` | clasificado como neutral (≠ sin clasificar) | píldora `neutral`, segmento neutral de las barras | como "sin datos" |
| `--info` (= `--accent`) | anotación del sistema, no del dato | "sin base de comparación", notas de procedencia, tooltips de método | como veredicto |
| `--cat-1..5` / `--cat-other` | **identidad** de una categoría | fuentes, tópicos, series de una gráfica multi-categoría (≤5) | como veredicto; con >5 categorías |
| `--emo-*` | emoción detectada | tarjeta de emociones, filtros por emoción | fuera de esa dimensión |
| `--nar-*` | estado de una narrativa | píldoras/puntos/sparklines de narrativa | fuera de esa dimensión |
| `--seq-1..5` | **magnitud** sin valencia | heatmap horario, coropleta, calendario, sparkline de volumen | cuando el dato tiene valencia (usar `--crisis-*`) |
| `--crisis-1..4` | magnitud **con** valencia (riesgo) | gauge/barra de crisis, mezcla de severidad | como escala de volumen |
| `--text-disabled` | control inoperante | chips deshabilitados, controles bloqueados | como texto informativo atenuado |

**Corolario 1:** el tono `accent` desaparece del vocabulario de datos. `metrics-display.ts:29` pasa a `type MetricTone = 'neg'|'warn'|'pos'|'neu'|'info'`.

**Corolario 2:** el chip de icono de `KpiCard` (`screens.js:90`) deja de usar `background:'var(--accent-fill)'` con `color: accent` variable. Hoy la card de Brand Health muestra un corazón **verde** sobre un tinte **naranja**, y Polarización un icono **violeta** sobre tinte naranja. El tinte debe derivar del mismo color del icono: `background: color-mix(in oklab, ${accent} 14%, var(--canvas))`.

## 5.2 Las tres inconsistencias de veredicto y su corrección

### (a) El delta de volumen tiene dos reglas opuestas — misma app, y una de ellas misma pantalla

| Sitio | Código | Volumen ↑ se pinta |
|---|---|---|
| Scorecard, card "Volumen · período" | `screens.js:452` `deltaInfo={m.deltaDisplay.totalMentions}` → `route.ts:386` `formatDelta(cur, prev, {kind:'percent'})` **sin `invert`** → `toneFor('up', false)` = `'pos'` | **VERDE** (`+42%` en la captura) |
| Tópicos: treemap, lista, burbujas, detalle | `screens.js:2097-2099`, `2162`, `2215`, `2302` `t.delta > 0 ? 'var(--neg)'` | **ROJO** |

Verificado por píxel en `topics-desktop-fold.png`: el tile **«Desarrollo económico»** tiene el título en `(58,193,113)` = `--pos` (sentimiento dominante positivo) y justo debajo **«↑ 12%»** en `(255,106,61)` = `--neg`. El tile dice "este tema es positivo" y a 20px de distancia dice "creció, alarma". Mientras «Permisos y trámites» (título naranja = negativo) muestra **«↓ 8%»** en `(63,212,122)` verde. La regla "crecer es malo" acierta para los tópicos negativos y **miente para los positivos**.

### (b) La leyenda de la tendencia colorea la DIRECCIÓN, no la valencia

`charts.js:270`:
```js
<span style={{ color: delta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
```
Sin condición ni parámetro. En `overview-desktop-fold.png`, sección «03 · TENDENCIA · DÍA A DÍA»: **«NEGATIVO 43.0 ▼ 8.5%»** en **rojo**. Las menciones negativas *bajaron* — la mejor noticia de la pantalla — pintada como alarma. Y 300px arriba, la card «NEGATIVO 583 ▲+34%» del termómetro (`screens.js:4204-4207`, `invert:true`) aplica la regla **contraria**. Dos reglas opuestas, misma pantalla, mismo dato.

*Nota colateral:* ese delta se calcula contra `s.vals[0]` (el **primer punto de la ventana**), no contra el día anterior ni contra el período previo — un tercer baseline con tratamiento visual idéntico a los otros dos.

### (c) `BAND_TONE` manda "lo mejor" al rojo

`packages/shared/src/format/metrics-display.ts:89-100`:
```ts
FUERTE: 'accent', 'MUY POS': 'accent', ACELERADA: 'accent',   // → var(--accent) === var(--neg)
NORMAL:'pos', SANO:'pos', POSITIVO:'pos', ALTA:'pos', POS:'pos',
ELEVADO:'warn', 'DÉBIL':'warn', MODERADA:'warn', EXTREMA:'warn', NEG:'warn',
```
Tres bugs en cinco líneas:
1. `FUERTE` (BHI 8.2–10, el mejor estado posible) y `'MUY POS'` (NSS ≥ 20) → tono `accent` → **el rojo de crisis**.
2. `ALTA: 'pos'` → «Polarización **Alta**» (≥50%, mal) se pinta **verde**, mientras `EXTREMA` (≥75%) se pinta ámbar (menos grave que verde-para-alta, invertido).
3. `NEG: 'warn'` y `'MUY NEG': 'neg'` — el NSS negativo tiene dos familias distintas. La tabla mezcla tokens de bandas de **cuatro métricas distintas** en un solo diccionario global, así que `ALTA` colisiona entre métricas.

**Corrección — tono por (métrica, banda), no por banda global:**

```ts
export type MetricTone = 'neg' | 'warn' | 'pos' | 'neu' | 'info';

const BAND_TONE: Record<BandedMetricKey, Record<string, MetricTone>> = {
  crisis:       { NORMAL:'pos', ELEVADO:'warn', ALERTA:'neg',  CRISIS:'neg' },
  bhi:          { 'CRÍTICO':'neg', 'DÉBIL':'warn', SANO:'pos', FUERTE:'pos' },   // FUERTE = pos, no accent
  polarization: { 'APÁTICA':'neu', MODERADA:'warn', ALTA:'warn', EXTREMA:'neg' }, // ALTA ya no es pos
  nss:          { 'MUY NEG':'neg', NEG:'neg', NEUTRAL:'neu', POS:'pos', 'MUY POS':'pos' },
  velocity:     { ACELERADA:'neu', ESTABLE:'neu', DESACELERADA:'neu' },           // el ritmo no tiene valencia
};
```
Con eso, `BrandHealthMini` (`screens.js:613-616`) pasa a `neg / warn / pos / pos-strong`:

```js
const segments = [
  { from:0,   to:0.4, color:'var(--neg)'  },
  { from:0.4, to:0.6, color:'var(--warn)' },
  { from:0.6, to:0.8, color:'var(--pos)'  },
  { from:0.8, to:1,   color:'var(--pos-strong)' },   // #7BE8A4 — ΔE vs --pos = 22
];
```
`--pos-strong: #7BE8A4` (dark, **12.34:1** vs canvas) / `#0F5F2C` (light, **7.42:1**). Mismo tono, más luminoso: la escala **sube** monótonamente en vez de volver al rojo. Idem `shell.js:1580-1581` (BHI) y `1596-1597` (NSS).

## 5.3 "Métrica mala que subió" vs "métrica buena que subió"

**Regla:** el **color codifica la valencia del cambio**; la **flecha codifica la dirección**; una **palabra** codifica las dos (WCAG 1.4.1 — el color nunca solo).

Cada métrica declara su `goodDirection`; el que no la tenga **no se colorea**.

| Métrica | `goodDirection` | ↑ | ↓ | Ejemplo |
|---|---|---|---|---|
| NSS | `up` | ▲ verde «mejora» | ▼ rojo «empeora» | |
| Brand Health | `up` | ▲ verde «mejora» | ▼ rojo «empeora» | |
| % positivo | `up` | ▲ verde | ▼ rojo | |
| Riesgo de crisis | `down` | ▲ **rojo** «empeora» | ▼ verde «mejora» | **métrica mala que subió** |
| % / conteo negativo | `down` | ▲ rojo «empeora» | ▼ verde «mejora» | |
| Polarización | `down` | ▲ rojo | ▼ verde | (con nota: alta polarización + NSS≈0 es la lectura útil) |
| **Volumen de menciones** | **`none`** | ▲ **gris** «sube» | ▼ gris «baja» | resuelve (a): ni verde ni rojo |
| **Volumen por tópico** | **`none`** | ▲ gris «sube» | ▼ gris «baja» | idem — **la misma regla en las dos pantallas** |
| **Alcance / engagement** | `none` | ▲ gris | ▼ gris | |
| **Velocidad** | `none` | ▲ gris «acelera» | ▼ gris «desacelera» | resuelve (F) |
| % neutral | `none` | gris | gris | |
| Sin período previo | — | `·` `--text-3` «sin base» | | ya implementado ✔ |

Tokens-alias para que el mapeo sea auditable de un vistazo:
```css
--delta-better: var(--pos);
--delta-worse:  var(--neg);
--delta-flat:   var(--text-3);
```
`DeltaBadge` (`screens.js:46-58`) nunca vuelve a leer `--pos`/`--neg` directamente. Y añade la palabra:

```jsx
<span style={{ color: `var(--delta-${info.valence})` }}>
  {info.arrow} {info.value}
  <span className="sr-only"> · {info.valence === 'better' ? 'mejora' : info.valence === 'worse' ? 'empeora' : 'sin valencia'}</span>
</span>
```

**Un detalle fino que hay que resolver:** en la card «NEGATIVO» del termómetro (`screens.js:4188-4238`) el punto de categoría es naranja (**identidad** = bucket negativo) y el delta `▲+34%` también es naranja (**veredicto** = empeoró). Dos semánticas en el mismo hex, apiladas a 30px. Corrección: el punto de categoría pasa a `--neg`, el delta a `--delta-worse` (mismo valor hoy, pero) **y el delta gana el prefijo textual «empeora»** para que la distinción no dependa del color.

---

# 6 · Bloque listo para pegar en `index.html`

Reemplaza las líneas **14-217** completas (`:root` + los 6 bloques de tema).

```css
:root {
  /* ═══════════ FORMA ═══════════ */
  --r-sm: 4px; --r: 6px; --r-lg: 8px; --r-xl: 12px;
  --ease: cubic-bezier(.22, 1, .36, 1);
  --ff-sans: 'Krub', -apple-system, BlinkMacSystemFont, sans-serif;
  --ff-display: 'Besley', Georgia, serif;
  --ff-numeric: 'Krub', -apple-system, sans-serif;
  --ff-mono: 'IBM Plex Mono', ui-monospace, monospace;

  /* ═══════════ MANDO · DARK — default INCONDICIONAL ═══════════
     Sin selector [data-theme]: si App revienta antes del useEffect
     que pone data-theme/data-mode (app.js:319-320), el error boundary
     igual hereda la paleta. Ver F5. */

  /* superficies */
  --bg:#060A10; --bg-2:#0A111A; --canvas:#0E1620; --canvas-2:#091018;
  --hairline:rgba(255,255,255,.07);          /* decorativo · 1.19:1 */
  --hairline-strong:rgba(255,255,255,.34);   /* estructural · 3.10:1 ✔1.4.11 */
  --overlay:rgba(2,6,11,.62);

  /* texto — todos ≥4.5:1 sobre --canvas */
  --text:#E6ECF3;            /* 15.30 */
  --text-2:#A9B4C2;          /*  8.66 */
  --text-3:#7C8695;          /*  4.94 */
  --text-disabled:#5A6472;   /*  3.15 · sólo controles inoperantes */

  /* INTERFAZ — nunca datos */
  --accent:#58A6FF;                          /* 7.20 */
  --accent-2:#8CC2FF;                        /* 9.77 */
  --accent-fill:rgba(88,166,255,.14);
  --accent-line:rgba(88,166,255,.45);
  --accent-ink:#08111B;                      /* 7.51 sobre --accent */
  --info:var(--accent); --info-fill:var(--accent-fill);

  /* VEREDICTO — sólo datos */
  --pos:#3FD47A;        --pos-fill:rgba(63,212,122,.14);  --pos-ink:#08111B;
  --pos-strong:#7BE8A4;                                    /* 12.34 · tope de escala */
  --neg:#FF6A3D;        --neg-fill:rgba(255,106,61,.14);  --neg-ink:#08111B;
  --warn:#FFC043;       --warn-fill:rgba(255,192,67,.14); --warn-ink:#08111B;
  --neu:#8D99AC;        --neu-fill:rgba(141,153,172,.16); --neu-ink:#08111B;
  /* compat: los .pill-* actuales leen --*-bg */
  --pos-bg:var(--pos-fill); --neg-bg:var(--neg-fill); --warn-bg:var(--warn-fill);

  /* DELTAS — alias auditables */
  --delta-better:var(--pos); --delta-worse:var(--neg); --delta-flat:var(--text-3);

  /* CATEGÓRICA — identidad (≤5 + otros) */
  --cat-1:#3FC8D8; --cat-2:#B084F0; --cat-3:#EC6FA8;
  --cat-4:#AEBE4E; --cat-5:#C9A38A; --cat-other:#8D99AC;
  --cat-ink:#08111B;

  /* EMOCIONES — set canónico del processor (7) */
  --emo-enojo:#F2545B;    --emo-frustracion:#FF8A4C; --emo-preocupacion:#F0B429;
  --emo-sarcasmo:#B084F0; --emo-indiferencia:#8D99AC;
  --emo-alivio:#4FD1C5;   --emo-gratitud:#3FD47A;

  /* NARRATIVAS (6 + desconocido) */
  --nar-pico:#FF6A3D;   --nar-activa:#4DA3E8;  --nar-emergente:#3FC8D8;
  --nar-revivida:#B084F0; --nar-decae:#C69A5B; --nar-dormida:#5B6676;
  --nar-unknown:#5B6676;

  /* SECUENCIAL — magnitud sin valencia */
  --seq-0:transparent;
  --seq-1:#16323F; --seq-2:#1C5570; --seq-3:#1F7C9E; --seq-4:#2FA6C9; --seq-5:#5FD3E8;
  --seq-ink-lo:#E6ECF3;   /* para seq-1/2 */
  --seq-ink-hi:#08111B;   /* para seq-4/5 · seq-3 PROHIBIDO con texto */

  /* CRISIS — magnitud con valencia */
  --crisis-1:#3FD47A; --crisis-2:#FFC043; --crisis-3:#FF8A4C; --crisis-4:#E23B2E;

  /* MARCA — una sola familia */
  --brand-mark:#58A6FF; --brand-tile-a:#12202E; --brand-tile-b:#080E16;
  --brand-line:rgba(88,166,255,.20);

  /* RAIL */
  --rail-bg:#030609;
  --rail-fg:rgba(255,255,255,.58);          /* 6.86 vs rail (era 4.32 ✘) */
  --rail-fg-active:#FFFFFF;
  --rail-active-bg:rgba(88,166,255,.16);
  --rail-active-line:#58A6FF;
  --rail-border:rgba(255,255,255,.06);

  --shadow-sm:0 1px 0 rgba(0,0,0,.4);
  --shadow:0 1px 0 rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6);
}

/* ═══════════ MANDO · LIGHT — único override ═══════════ */
:root[data-mode="light"] {
  --bg:#F5F6F7; --bg-2:#E8EAED; --canvas:#FFFFFF; --canvas-2:#F5F6F7;
  --hairline:#DFE2E6; --hairline-strong:#8F96A0;   /* 3.00:1 ✔ */
  --overlay:rgba(14,17,22,.44);

  --text:#0E1116;          /* 18.91 */
  --text-2:#454C58;        /*  8.65 */
  --text-3:#636B77;        /*  5.38 (era #8A909B → 3.21 ✘) */
  --text-disabled:#9AA1AC;

  --accent:#1F5FA8;        /* 6.44 */
  --accent-2:#17518F;      /* 8.05 */
  --accent-fill:rgba(31,95,168,.09);
  --accent-line:rgba(31,95,168,.40);
  --accent-ink:#FFFFFF;

  --pos:#1B7538;   --pos-ink:#FFFFFF;  --pos-fill:rgba(27,117,56,.10);  --pos-strong:#0F5F2C;
  --neg:#C0341B;   --neg-ink:#FFFFFF;  --neg-fill:rgba(192,52,27,.10);
  --warn:#8A5A0B;  --warn-ink:#FFFFFF; --warn-fill:rgba(138,90,11,.12); /* era #B47410 → 3.86 ✘ */
  --neu:#4A5567;   --neu-ink:#FFFFFF;  --neu-fill:rgba(74,85,103,.12);
  --pos-bg:var(--pos-fill); --neg-bg:var(--neg-fill); --warn-bg:var(--warn-fill);

  --cat-1:#1E7A88; --cat-2:#6B3FA0; --cat-3:#A61E63;
  --cat-4:#5C6B14; --cat-5:#7A5641; --cat-other:#4A5567; --cat-ink:#FFFFFF;

  --emo-enojo:#B02A34; --emo-frustracion:#B85416; --emo-preocupacion:#8A6410;
  --emo-sarcasmo:#6B3FA0; --emo-indiferencia:#4A5567;
  --emo-alivio:#0F7A72; --emo-gratitud:#1B7538;

  --nar-pico:#C83A1E; --nar-activa:#1F5FA8; --nar-emergente:#146C7C;
  --nar-revivida:#6B3FA0; --nar-decae:#7A5A25; --nar-dormida:#6E7784; --nar-unknown:#6E7784;

  --seq-1:#DCEBF2; --seq-2:#A9D2E2; --seq-3:#6BADC7; --seq-4:#2E7F9E; --seq-5:#0E4F68;
  --seq-ink-lo:#0E1116; --seq-ink-hi:#FFFFFF;

  --crisis-1:#1B7538; --crisis-2:#8A5A0B; --crisis-3:#B85416; --crisis-4:#A32717;

  --brand-mark:#1F5FA8; --brand-tile-a:#EDF3FA; --brand-tile-b:#DCE7F4;
  --brand-line:rgba(31,95,168,.22);

  --rail-bg:#0A0F16; --rail-fg:rgba(255,255,255,.62); --rail-fg-active:#FFFFFF;
  --rail-active-bg:rgba(88,166,255,.18); --rail-active-line:#58A6FF;
  --rail-border:rgba(255,255,255,.06);

  --shadow-sm:0 1px 0 rgba(14,17,22,.05);
  --shadow:0 1px 0 rgba(14,17,22,.05), 0 6px 16px -10px rgba(14,17,22,.12);
}

/* ═══════════ Reglas de componente afectadas ═══════════ */

/* relleno lleno ⇒ tinta oscura */
.btn-primary { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); }
.btn-primary:hover { background:var(--accent-2); border-color:var(--accent-2); }
.chip.active { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
.chat-send { background:var(--accent); color:var(--accent-ink); }

/* píldoras: tinte + texto del token (todas ≥5.15:1) */
.pill-pos { background:var(--pos-fill);  color:var(--pos);  }
.pill-neg { background:var(--neg-fill);  color:var(--neg);  }
.pill-warn{ background:var(--warn-fill); color:var(--warn); }
.pill-neu { background:var(--neu-fill);  color:var(--neu);
            border:1px solid color-mix(in oklab, var(--neu) 45%, transparent); }
.pill-info{ background:var(--info-fill); color:var(--info); }  /* ya NO idéntica a pill-neg */
.pill-unknown { background:repeating-linear-gradient(45deg,var(--canvas-2) 0 4px,transparent 4px 8px);
                color:var(--text-3); border:1px dashed var(--hairline-strong); }

/* estado de narrativa: tinte, no relleno lleno (2.38 → 5.35) */
.narrative-status-pill {
  background: color-mix(in oklab, var(--nar-c, var(--neu)) 16%, var(--canvas));
  color: var(--nar-c, var(--neu));
  border: 1px solid color-mix(in oklab, var(--nar-c, var(--neu)) 45%, transparent);
  padding:2px 8px; border-radius:999px; font-size:10px; font-weight:600;
  text-transform:uppercase; letter-spacing:.06em;
}
.narrative-status-pill[data-unknown="true"] { border-style: dashed; }

/* nav activo: tinte + barra, no sólo tinte */
.eco-nav-item.active { background:var(--rail-active-bg); box-shadow:inset 2px 0 0 var(--rail-active-line); }

/* Leaflet tematizado (adiós a los 8 rgba literales de index.html:691-721) */
.leaflet-container { background:var(--canvas); font-family:var(--ff-sans); }
.leaflet-tooltip.eco-map-tooltip {
  background:var(--canvas); border:1px solid var(--hairline-strong);
  color:var(--text); box-shadow:var(--shadow); padding:6px 10px; border-radius:var(--r-sm);
}
.leaflet-control-zoom a, .leaflet-control-layers-toggle, .leaflet-control-layers-expanded {
  background:var(--canvas) !important; color:var(--text) !important;
  border:1px solid var(--hairline-strong) !important;
}
.leaflet-control-zoom a:hover, .leaflet-control-layers-toggle:hover { background:var(--accent-fill) !important; }
.leaflet-control-attribution { background:var(--canvas-2) !important; color:var(--text-3) !important; }
.leaflet-control-attribution a { color:var(--accent) !important; }
.narrative-stream-day:hover rect { fill:var(--accent-fill); }   /* era rgba(63,181,216,.08) — azul costa */

/* utilidad para lectores de pantalla (regla 1.4.1) */
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
           overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
```

---

# 7 · Plan de migración por fases

| Fase | Alcance | Archivos:líneas | Efecto medible |
|---|---|---|---|
| **F0** (1 commit, cero riesgo visual) | Tokens a `:root`, borrar costa/gaceta, añadir tiers de texto y `--*-ink`, aplicar la regla de tinta | `index.html:14-217, 231, 366, 379, 396, 400-421, 432-456, 468, 481, 542, 691-721, 905, 1009`; `shell.js:154, 199-260, 1080-1094` | **471 → 0** fallos AA · error boundary con paleta · −118 líneas CSS |
| **F1** (`accent` al azul) | Sólo cambian 3 valores de token; los 108 usos de `--accent` siguen igual | `index.html` (`--accent`, `--accent-2`, `--accent-fill`) + `icon.svg` | ΔE accent↔neg **0 → 116**. Resuelve C, D, E, G, I, J, K, L de un golpe |
| **F2** (semántica de veredicto) | `BAND_TONE` por métrica, `goodDirection`, `DeltaBadge` con palabra | `metrics-display.ts:29, 78-109`; `screens.js:46-58, 613-616, 2097-2099, 2162, 2215, 2302, 4204-4207`; `charts.js:270`; `shell.js:1580-1597` | BHI y NSS monótonos · una sola regla de delta en toda la app |
| **F3** (escalas) | `--cat-*`, `--emo-*`, `--nar-*`, `--seq-*`, `--crisis-*` | `screens.js:34, 38, 264, 290, 311, 463-468, 544, 674, 688, 1560, 1777-1786, 1998, 2448, 2454, 2548-2573, 2610-2612, 2782, 3374, 3392, 4143, 4601-4607, 4785`; `route.ts:875-886`; `processor/index.ts:546-548` (emitir `emotionKey`) | **103 literales → ≤6** (sólo fallbacks pre-React) |
| **F4** (mapa) | `readToken()` + tooltip por CSS | `charts.js:806-830`; `shell.js:755-770` | mando light deja de estar roto |
| **F5** (guardarraíl) | Test que falle el build si aparece un hex nuevo fuera de `index.html`, o si algún par (color, fondo) del CSS baja de 4.5 | `apps/web/scripts/compile-prototype.js` | la deuda no vuelve a crecer |

**Prueba de aceptación:** volver a correr `shoot.mjs` en los 4 viewports **y en `data-mode="light"`** (que hoy no se probó). Criterio: `probe.lowContrast.length === 0` en las 80 capturas.

---

# 8 · Lo que este cambio NO arregla

- **9–11px sigue siendo 9–11px.** 431 de los 471 casos son texto diminuto; el color los hace legibles, no cómodos. Requiere la escala tipográfica.
- **La normalización por serie del `MultiLineChart`** (F2 del brief) es deshonesta aunque los colores sean perfectos: separar NSS de Crisis por color hace *visible* que las escalas no comparten eje.
- **Los cinco totales distintos** (F9) son un problema de datos; ningún token los reconcilia.
- **`--seq-3` es un paso muerto** para celdas con texto. Es una restricción física de cualquier rampa de 5 pasos en dark, no un defecto que se pueda "arreglar": se documenta y se esquiva.


## Riesgos

- Mover --accent al azul cambia la personalidad visual del producto: el naranja está en el nav activo, los botones primarios, el logo y todos los CTA de las capturas que el cliente ya vio. Es una decisión de marca, no técnica — necesita el visto bueno explícito de Populicom antes de F1. Mitigación: F0 (contraste, tinta, borrado de temas) es independiente y se puede enviar solo, y el Plan B queda documentado con sus números para que la decisión se tome con datos.
- La paleta categórica sólo tiene 5 ranuras reales + «otros». Es una restricción física (hay 4 bandas de tono reservadas por pos/neg/warn/accent y no caben 8 colores con ΔE≥30 en dark), no una preferencia. Si el cliente exige 8 fuentes con color propio, hay que aceptar ΔE≈19 entre pares — es decir, dos plataformas confundibles. La salida correcta es glifo+etiqueta para plataformas y agrupar en «Otros».
- Los correos importan el mismo BAND_TONE y las mismas palabras de @eco/shared/format. Cambiar metrics-display.ts:89-100 altera el color de los cuatro correos en el mismo deploy, y sus clientes de correo NO soportan custom properties: hay un mapa de hexes literales en @eco/shared/email/chrome.ts que hay que sincronizar a mano o los correos quedarán con la paleta vieja mientras el dashboard tiene la nueva.
- El drift bundle-vs-git de este repo aplica: si eco-weekly-report o eco-metrics-calculator tienen en su bundle una copia de metrics-display distinta de la de la rama, el cambio de tonos no llegará (o revertirá algo). Descargar y comparar los bundles antes de redeployar, como manda CLAUDE.md.
- Subir --text-3 de 2.65 a 4.94 hace VISIBLE mucho texto que hoy es ruido de fondo: subtítulos de card, notas al pie, unidades. Varias pantallas van a sentirse más cargadas de lo que el equipo espera, y algunas jerarquías que hoy «funcionan» porque el tercer nivel es invisible dejarán de funcionar. Hay que revisar densidad junto con la unidad de tipografía, no después.
- La regla «relleno lleno ⇒ tinta oscura» convierte los botones primarios de blanco-sobre-naranja a casi-negro-sobre-azul. Es correcto por contraste (2.85 → 7.51) pero se lee como un botón de alta visibilidad, distinto de la convención de botón oscuro con texto blanco. Conviene validarlo en una captura antes de aplicarlo a los ~15 sitios.
- --seq-3 (#1F7C9E) es inutilizable para celdas con texto: 3.98:1 con tinta clara y 4.01 con tinta oscura, falla por ambos lados. Es inherente a cualquier rampa secuencial de 5 pasos sobre canvas oscuro. Si alguien lo usa por descuido en un heatmap etiquetado, el fallo será silencioso — de ahí el guardarraíl de F5.
- Todo el análisis de light mode es calculado, no observado: los probes sólo cubrieron dark. Puede haber fallos de contraste y de tema en light que no aparecen en esta lista (sospechosos: sombras, .skeleton, el gradiente del logo, el treemap). Correr shoot.mjs con data-mode="light" antes de declarar el modo soportado.


---

# Sistema tipográfico de ECO + plan de migración a Besley (títulos) / Krub (cuerpo)

## Resumen

ECO no tiene escala tipográfica: 21 tamaños distintos de font-size (incluyendo seis medios-píxeles) reparten 472 declaraciones, y el **71.5% de los 8,750 nodos de texto medidos en las 40 capturas corre a ≤11px, el 47% a ≤10px, y solo el 4.4% llega a 14px o más**. La distribución de tamaños es **idéntica byte a byte en 390px y en 1440px** (cero `clamp()`, cero `font-size` dentro de un `@media`): el tipo no responde. Ese piso de 10-11px es también la causa raíz del problema de contraste — **449 de los 471 fallos WCAG (95%) están en texto ≤11px**, y 415 de ellos son `--text-3 (#525B68)` a 2.65:1, que a 10px no tiene ninguna exención de "texto grande". Para el lector real (director de agencia, 50+, monitor de oficina a ~60cm) la altura de carácter a 10px es de ~10.6 minutos de arco, muy por debajo del mínimo ergonómico de ~16′. En peso: se descargan **5 familias / 18 archivos / 208.7 KB (latin)**, de las cuales el tema `mando` pinta 3 — Newsreader (80.6 KB) e Instrument Serif (30.0 KB) se bajan para pintar **0 nodos** porque los temas `costa`/`gaceta` son inalcanzables (`app.js:185`, `useState` sin setter), e Instrument Sans se cuela por 4 reglas que piden `var(--ff-sans)`, variable que `mando` nunca redefine. Propongo una escala nombrada de **7 pasos (12/14/17/20/24/30/40 px) + un escape hatch de 11px con whitelist de 2 sitios**, con `clamp()` exactos, y un reparto Besley/Krub verificado contra los archivos reales de Google Fonts: **Besley SÍ tiene `tnum` (verificado: las 10 cifras tabulares miden 0.55 em exactos), Krub NO lo tiene** — `font-variant-numeric: tabular-nums` es un no-op silencioso en Krub, cuyos dígitos varían un 35.1% de ancho ("1111"=23.87px vs "8888"=29.33px a 13px). Por eso los números grandes van a Besley+tnum, las columnas y ticks se quedan en IBM Plex Mono (1 peso, 9.8 KB), y Besley **nunca** baja a versalitas de 10-12px: en mayúsculas mide **+19% a +24% más ancho** que IBM Plex Sans (medido sobre cadenas reales de la UI), lo que reventaría `.card-hd-title` — que en móvil ya rompe a 3 líneas y choca con los botones Treemap/Burbujas/Lista. La propuesta baja a **3 familias / 10 archivos / 80.2 KB latin (−62%)**.

﻿# Sistema tipográfico de ECO — diagnóstico y migración a Besley + Krub

Todas las rutas son absolutas desde
`/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit` (abreviado `<WT>`).
SPA: `<WT>/apps/web/public/eco-prototype/`.

---

## 1. Diagnóstico del estado actual

### 1.1 Cinco familias, tres pintan, dos son peso muerto

`index.html:10` pide 5 familias en un solo `css2`. Medí la respuesta real de
Google (66 `@font-face`, 33 URLs únicas) y el `content-length` de cada archivo:

| Familia | archivos únicos (latin) | latin | latin + latin-ext | nodos que pinta en `mando` |
|---|---|---|---|---|
| IBM Plex Sans (variable) | 1 | 39.3 KB | 64.6 KB | **6,864 (78.4%)** |
| IBM Plex Mono (estático ×3) | 3 | 29.5 KB | 55.6 KB | **1,838 (21.0%)** |
| Instrument Sans (variable) | 1 | 29.2 KB | 40.0 KB | 48 (0.5%) — **fuga, ver 1.5** |
| Instrument Serif | 2 | 30.0 KB | 45.9 KB | **0** |
| Newsreader (variable + itálica) | 2 | 80.6 KB | 131.0 KB | **0** |
| **TOTAL** | **18** | **208.7 KB** | **337.0 KB** | 8,750 |

- **110.6 KB latin (176.9 KB con latin-ext) se descargan para pintar cero
  píxeles.** Newsreader e Instrument Serif solo se usan en `[data-theme="gaceta"]`
  (`index.html:121-123, 379, 481`), y `gaceta` es **inalcanzable**: `app.js:185`
  hace `const [theme] = useState(TWEAK_DEFAULTS.theme)` — sin setter. `mando` es
  permanente. `costa` idem.
- Los datos de pintado vienen de `probe.fonts` agregado sobre las 40 capturas
  (`shots/probe-report.json`).

### 1.2 No hay escala: 21 tamaños, seis de ellos fraccionarios

Unión de las ~90 declaraciones `font-size` del `<style>` de `index.html` y las
391 `fontSize` inline de `screens.js`/`shell.js`/`charts.js`/`chat-drawer.js`/`app.js`:

```
8.5  9  9.5  10  10.5  11  11.5  12  12.5  13  13.5  14  15  16  18  20  22  26  28  30  40
```

| tamaño | declaraciones | % |
|---|---|---|
| 11px | 114 | 24.2% |
| 10px | 94 | 19.9% |
| 12px | 86 | 18.2% |
| 13px | 66 | 14.0% |
| 9px | 35 | 7.4% |
| todo lo demás (15 valores) | 77 | 16.3% |

**55% de las declaraciones son ≤11px; 74% ≤12px.** Los seis fraccionarios
(8.5 / 9.5 / 10.5 / 11.5 / 12.5 / 13.5, 24 declaraciones) caen en medio píxel
de dispositivo en pantallas 1×: texto ya diminuto, además borroso.

Pesos (censo de pintado, `probe.fonts`): 400 = 35.8%, 500 = 15.0%,
600 = 29.3%, 700 = 19.9%. **El 49.2% del texto del dashboard es semibold o
bold.** Cuando la mitad de la página está en negrita, la negrita deja de
significar nada — no hay jerarquía por peso, solo ruido.

`letterSpacing` inline: 11 valores (`0.02`…`0.14em`), 66 usos.
`textTransform: 'uppercase'`: 50 usos inline + 12 reglas CSS. La jerarquía real
de ECO no se hace con tamaño, se hace con **versalitas apretadas y grises** — el
mecanismo menos legible disponible.

### 1.3 El tipo no responde: cero `clamp()`, cero `font-size` en `@media`

```
grep -c "clamp(" <WT>/apps/web/public/eco-prototype/*.js index.html   → 0
fontSize condicionado a isMobile/bp/ecoCols                          → 0
font-size dentro de un bloque @media                                 → 0
```

Y el probe lo confirma: la distribución de tamaños pintados es **idéntica** en
los cuatro viewports (los ±18 nodos de diferencia a 9px son ticks de gráfica
que reflotan):

```
desktop {9:284, 10:755, 11:532, 12:369, 13:159, 14:20, …}
mobile  {9:266, 10:755, 11:532, 12:369, 13:159, 14:20, …}
```

El overhaul responsive de julio (PR #87) reflotó **layout** pero no tocó
**tipografía**. Consecuencia visible en `shots/dashboard-mobile-fold.png`: el
párrafo del resumen ejecutivo (18px, `screens.js:378`) ocupa **12 líneas y toda
la primera pantalla** del teléfono, mientras el eyebrow que lo etiqueta sigue a
10px.

### 1.4 El problema de contraste ES el problema de tamaño

De los 471 fallos WCAG en escritorio (`probe.lowContrast`):

| tamaño del texto | fallos |
|---|---|
| 9–9.5px | 49 |
| 10–10.5px | 231 |
| 11px | 169 |
| 12px | 18 |
| ≥13px | 4 |

**449 / 471 = 95% ocurre en texto ≤11px.** Y 415 de los 471 son un solo color:
`--text-3: #525B68` (`index.html:197`) sobre `--canvas: #0E1620` = **2.65:1**.
A 10px no existe la exención de "texto grande" de WCAG (que empieza en 18.66px
bold / 24px regular), así que el umbral aplicable es 4.5:1. Peor caso medido:
`div.num «22»` en Tópicos a 10px con `#8A94A1` sobre celda de calendario =
**1.36:1**.

Móvil: los mismos 471.

### 1.5 Fuga de familia: `mando` pinta Instrument Sans sin querer

`index.html:20` define `--ff-sans: 'Instrument Sans'` en `:root`.
`index.html:230` hace `[data-theme="mando"] body { font-family: var(--ff-display) }`
— o sea, `mando` cambia el `body` pero **nunca redefine `--ff-sans`**. Todo lo
que pide explícitamente `var(--ff-sans)` sigue en Instrument Sans:

- `index.html:693` `.leaflet-container` → los 3 nodos de 9px de la atribución del mapa
- `index.html:752` `.narrative-search` (13px)
- `index.html:772` `.btn-chip` (10.5px) → los 8 nodos de 11px en `/narrative`
- `index.html:1202` `.narrative-related-btn`

Resultado medido: `/narrative` y `/geography` mezclan **dos sans distintas en la
misma pantalla**, y se pagan 29.2 KB por 48 nodos.

### 1.6 `--letter-display` no existe en modo oscuro

`--letter-display` está definido en `costa-light:60`, `gaceta-light:123` y
`mando-light:186` — **en ningún bloque `dark`**. `mando` dark
(`index.html:188-217`) define `--ff-display` y `--ff-numeric` pero no
`--letter-display`.

- `.num` (`index.html:244`) usa `var(--letter-display, -0.01em)` → **con
  fallback**, en oscuro aplica −0.01em.
- Los 8 `letterSpacing: 'var(--letter-display)'` inline (`shell.js:428, 1230,
  1640`; `screens.js:378, 4172, 2298`, …) **no tienen fallback** → sustitución
  inválida → `unset` → `normal`.

O sea: en modo oscuro (el modo de producción) **los títulos pierden el tracking
óptico que los números sí tienen**, y el mismo componente se compone distinto
en claro que en oscuro. Nadie lo notó porque nadie usa el modo claro.

### 1.7 `.num` no significa "número"

62 elementos llevan `className="num"`. **10 de ellos pisan la familia con
`fontFamily: 'var(--ff-display)'`** (`screens.js:102, 115, 1030, 1626, 2072,
2440, 4228, 4288`; `shell.js:1286, 1644`), y **al menos 3 no contienen un
número sino una palabra**:

```js
// screens.js:102  — 30px
<div className="num" style={{ fontSize: 30, …, fontFamily:'var(--ff-display)' }}>{valueWord}</div>
// screens.js:1626 — 40px, el número más grande de la app… es texto
<div className="num" style={{ fontSize: 40, … }}>{(m.display && m.display.nss.word) || 'NSS'}</div>
// screens.js:4288 — 30px
<div className="num" style={{ fontSize: 30, …, color: wordColor }}>{word}</div>
```

Visible en `shots/dashboard-desktop-fold.png`: la fila del hero enseña
`Neutral · Alerta · 4.0K · Débil · Moderada` — cuatro palabras y un número en
el mismo hueco de 30px, dos de ellas en Plex **Sans** y una en Plex **Mono**.
`.num` es de facto "el look de cifra grande", no un contrato semántico. **Esto
es el bloqueador nº1 de la migración**: no se puede apuntar `--ff-numeric` a
una fuente tabular y esperar que salga bien, porque la clase también viste
palabras.

### 1.8 Un rol, tres especificaciones (misma pantalla)

Los encabezados numerados de secciones de Overview, todos el mismo rol:

| sección | archivo:línea | especificación |
|---|---|---|
| `01 · Termómetro` | `screens.js:4196` | `.section-eyebrow` → 10px / 700 / 0.14em / `--text-3` |
| `02 · Riesgo de crisis` | `screens.js:4282-4284` | inline → 11px / 600 / 0.08em / `--text-2` |
| `03 · Tendencia` | `screens.js:4334` | `.card-hd-title` → 12px / 600 / 0.08em / `--text-2` |
| `04 · Tópico principal` | `screens.js:4378` | `.card-hd-title` → idem |
| `05 · Insights` | `screens.js:4520` | `.section-eyebrow` → 10px / 700 / 0.14em / `--text-3` |

Tres tamaños, dos pesos, dos trackings y dos colores para la misma cosa, en un
scroll.

Y dos `<h1>` compitiendo: `shell.js:426` (22px/700, header sticky) y
`screens.js:4171` (26px/600, hero de Overview). 4px de diferencia = ningún
salto perceptible, más un problema de a11y (dos h1 por documento).

### 1.9 Qué significa esto para un usuario de gobierno de 50+

Altura de carácter (cap-height real medida en los archivos, ×1.516 ′/px a
96 ppi CSS y ~60 cm de distancia):

| tamaño | cap-height | minutos de arco | veredicto |
|---|---|---|---|
| 9px Plex Sans | 1.66 mm | **9.5′** | ilegible sin acercarse |
| 10px (47% del texto) | 1.85 mm | **10.6′** | por debajo del mínimo |
| 11px (24%) | 2.03 mm | **11.6′** | por debajo del mínimo |
| 12px | 2.22 mm | 12.7′ | límite inferior |
| 14px Krub | 2.59 mm | 14.9′ | aceptable |
| 17px Krub | 3.15 mm | 18.0′ | cómodo |
| 24px Besley | 4.76 mm | 27.3′ | titular |

Las guías de ergonomía visual (ISO 9241-303 y equivalentes) ponen el mínimo en
~16′ de altura de carácter y la zona cómoda en 20–22′. **El 71.5% del texto de
ECO está entre 9.5′ y 11.6′** — es decir, entre el 60% y el 73% del mínimo. Y
esto es antes de sumar el contraste: la sensibilidad al contraste en
frecuencias espaciales altas cae con la edad, así que `--text-3` a 2.65:1 y
10px no es "poco legible" para el público objetivo, es invisible. El director
de agencia que decide con esta pantalla no está leyendo el 70% de ella: está
leyendo los cinco números de 30px y el párrafo de 18px, y adivinando el resto.

---

## 2. La escala nueva: 7 pasos + 1 escape hatch

Base 14px (0.875rem). Razón ~1.17 abajo (la UI densa necesita tres peldaños
funcionales próximos) y ~1.25 arriba (los titulares necesitan saltos claros).
Se eliminan 8 / 8.5 / 9 / 9.5 / 10 / 10.5 / 11.5 / 12.5 / 13 / 13.5 / 15 / 16 /
18 / 22 / 26 / 28 → de 21 valores a 7.

| token | rol | desktop | móvil | `clamp()` (recomendado, en rem) | line-height | letter-spacing | peso | familia |
|---|---|---|---|---|---|---|---|---|
| `display` | la cifra única del hero (NSS del Scorecard) | **40** | **30** | `clamp(1.875rem, 1.643rem + 0.952vw, 2.5rem)` | 1.0 | −0.02em | 700 | **Besley** + `tabular-nums` |
| `metric` | cifra de KPI card, cifra de tile de treemap | **30** | **25** | `clamp(1.5625rem, 1.446rem + 0.476vw, 1.875rem)` | 1.05 | −0.015em | 600 | **Besley** + `tabular-nums` |
| `title` | `<h1>` de pantalla / hero de sección | **24** | **21** | `clamp(1.3125rem, 1.243rem + 0.286vw, 1.5rem)` | 1.2 | −0.01em | 600 | **Besley** |
| `subtitle` | título de drawer/modal, título de narrativa, título de tópico | **20** | **18** | `clamp(1.125rem, 1.078rem + 0.19vw, 1.25rem)` | 1.3 | −0.005em | 600 | **Besley** |
| `lead` | párrafo del resumen ejecutivo, empty states grandes | **17** | **16** | `clamp(1rem, 0.977rem + 0.095vw, 1.0625rem)` | 1.5 | 0 | 400 | **Krub** |
| `body` | texto por defecto, títulos de mención, celdas, snippets | **14** | **14** | `0.875rem` (fijo) | 1.5 | 0 | 400 | **Krub** |
| ↳ `bodyStrong` | énfasis dentro del cuerpo | 14 | 14 | ídem | 1.5 | 0 | 600 | Krub |
| ↳ `label` | UI: botones, chips, pills, headers de tabla, ejes categóricos | 14 | 14 | ídem | 1.35 | 0 | 500 | Krub |
| `caption` | metadatos, sub-labels, hints, ticks numéricos de gráfica | **12** | **12** | `0.75rem` (fijo) | 1.35 | 0 | 500 | **Krub** |
| ↳ `eyebrow` | eyebrow de sección y título de card **en versalitas** | 12 | 12 | `0.75rem` | 1.2 | **0.06em** | 600 | Krub `uppercase`, color `--text-2` |
| `micro` | **escape hatch, whitelist de 2 sitios** | **11** | **11** | `0.6875rem` | 1.15 | 0.02em | 500 | Krub / Plex Mono |

**Whitelist de `micro` (11px) — el único caso justificado, y nada más:**

1. `charts.js:682-691` — etiquetas de hora del heatmap 24×7. La rejilla tiene
   24 columnas de `cellSize`; 12px no cabe sin romper la matriz. Compensación
   obligatoria: subir el color de `--text-3` a `--text-2` (4.5:1+).
2. `index.html:716` `.leaflet-control-attribution` — hoy 9px; sube a 11px. Es
   texto legal de terceros, no dato.

Todo lo demás que hoy está a 8–11px sube a `caption` (12) o `label`/`body` (14).

**Nota de equivalencia óptica (medida en los archivos reales):** Krub tiene
x-height **0.550 em** contra **0.516 em** de IBM Plex Sans (+6.6%). Krub a 12px
tiene la misma altura de x que Plex Sans a **12.8px**, y Krub a 14px equivale a
Plex Sans a **14.9px**. La escala no solo sube el piso: el mismo número de px
rinde ~7% más legibilidad. Ese margen es el que hace defendible un `caption` de
12px en un panel denso.

**Regla dura de mínimos táctiles/móviles:**

```css
/* index.html — dentro del @media (max-width: 768px) que ya existe en :321-353 */
.input, .narrative-search, .chat-input,
input[type="text"], input[type="date"], textarea, select { font-size: 16px; }
```

Hoy `.input` es 13px (`index.html:465`), `.chat-input` 13px (`:627`),
`.narrative-search` 13px (`:752`) y el buscador global 12px (`shell.js:357`).
**Todo campo de texto <16px hace que iOS Safari haga zoom automático al
enfocarlo**, y ese zoom deja la página a 1.33× de ancho — es decir, reintroduce
el scroll horizontal que PR #87 eliminó. Es el bug tipográfico con la peor
relación esfuerzo/daño de la lista.

---

## 3. Reparto Besley / Krub — decisión por rol, con la evidencia

Medí los archivos que sirve Google hoy mismo (`fontTools` sobre los `.woff2`
del subset `latin`):

| | upm | x-height | cap-height | ancho medio | `tnum` | line-height por defecto (hhea) |
|---|---|---|---|---|---|---|
| IBM Plex Sans | 1000 | 0.516 | 0.698 | 0.533 em | — (dígitos ya 0.6 fijo) | 1.300 |
| IBM Plex Mono | 1000 | 0.516 | 0.698 | 0.600 em | — (monoespaciada) | 1.300 |
| **Besley** (var 400–900) | 2000 | **0.520** | **0.750** | **0.627 em** | **SÍ** | **1.675** |
| **Krub** (estática) | 1000 | **0.550** | 0.700 | 0.557 em | **NO** | 1.300 |

Dos hechos que deciden todo lo demás:

1. **Besley tiene `tnum` y funciona.** Extraje el lookup GSUB: mapea
   `zero…nine → uniFF10…uniFF19` y **las diez cifras tabulares miden 0.55 em
   exactos**. `font-variant-numeric: tabular-nums` sobre Besley da cifras
   tabulares de verdad.
2. **Krub no tiene `tnum`** (features: `frac, kern, liga, locl`).
   `font-variant-numeric: tabular-nums` sobre Krub es un **no-op silencioso**, y
   sus dígitos tienen un **35.1% de dispersión** (`1` = 0.459 em, `0` = 0.620 em):

```
Krub 600 @13px:  "1111" = 23.87px   "8888" = 29.33px   (5.5px de diferencia)
Besley 600 @13px (con tnum): 28.47px  /  29.35px  →  con tnum: idénticos
IBM Plex Sans/Mono:          31.20px  /  31.20px  (tabular por construcción)
```

Y el ancho en mayúsculas, medido sobre cadenas reales de la UI:

| cadena (sitio real) | px / tracking | Plex Sans 600 | Besley 600 | Δ | Krub 600 | Δ |
|---|---|---|---|---|---|---|
| `TÓPICOS · VISTA PANORÁMICA` (`.card-hd-title`) | 12 / 0.08em | 204.2px | 245.3px | **+20.1%** | 197.7px | −3.2% |
| `EVOLUCIÓN MULTI-MÉTRICA` (`.card-hd-title`) | 12 / 0.08em | 186.7px | 232.3px | **+24.4%** | 182.0px | −2.5% |
| `ENERGÍA E INFRAESTRUCTURA` (treemap, `screens.js:2071`) | 11 / 0.06em | 180.5px | 224.1px | **+24.2%** | 173.8px | −3.7% |
| `SCORECARD TÁCTICO · TIEMPO REAL` (`.section-eyebrow`) | 10 / 0.14em | 220.1px | 264.8px | **+20.3%** | 213.3px | −3.1% |
| `Configuración` (`<h1>`, `shell.js:426`) | 22 / 0 | 141.7px | 166.5px | +17.5% | 146.6px | +3.4% |
| `Conversación pública de los últimos 30 días` (`screens.js:4171`) | 26 / 0 | 526.2px | 593.1px | +12.7% | 537.2px | +2.1% |
| `DDEC anuncia inversión de $340 millones…` (cuerpo) | 13 / 0 | 396.4px | — | — | 412.0px | +3.9% |

### Decisión por rol

| rol | archivo:línea | hoy | **propuesta** | por qué |
|---|---|---|---|---|
| **Título de página (`<h1>`)** | `shell.js:426`, `screens.js:4171` | Plex Sans 22/26px 600-700 | **Besley 600, `title` (24/21)** | Es el único sitio con ancho de sobra y donde el serif contrastado hace el trabajo institucional que se le pide. Unifica los dos h1 en un tamaño. Obligatorio: `line-height: 1.2` explícito (ver riesgo R5). |
| **Título de card (`.card-hd-title`)** | `index.html:378` (32 usos) | 12px / 600 / **uppercase** / 0.08em / `--text-2` | **Krub 600, `eyebrow` (12, uppercase 0.06em) en cards estrechas; `label`/`bodyStrong` 14 en caja alta y baja donde haya espacio** | **NO Besley.** Tres razones medidas: (a) +20…+24% de ancho, y en `shots/topics-mobile-fold.png` este título **ya** rompe a 3 líneas y colisiona con los botones Treemap/Burbujas/Lista; (b) a 12px sobre `#0E1620` las hairlines del Clarendon se adelgazan por debajo de 1 px de dispositivo y el trazo se rompe o se apaga; (c) Besley **no tiene `smcp`** (features: `calt, kern, liga, mark, tnum`), así que unas versalitas serían falsas. Krub en mayúsculas es **−3%** más estrecho que hoy: entra gratis. |
| **Eyebrow de sección (`.section-eyebrow`)** | `index.html:473-479` (44 usos) | 10px / **700** / **0.14em** / `--text-3` | **Krub 600, `eyebrow`: 12px / 0.06em / `--text-2`** | El tracking de 0.14em a 10px destruye la forma de palabra justo cuando el lector menos puede reconstruirla; combinado con 2.65:1 es el mayor generador de fallos WCAG del sistema (415 nodos). Subir 2px, bajar el tracking a la mitad y subir un escalón de color arregla legibilidad y contraste de un golpe. **Besley aquí sería el peor error posible del rediseño.** |
| **Número grande de KPI (`.num` a 30–40px)** | `index.html:244`; `screens.js:115, 1030, 2072, 2440, 4228`; `shell.js:1286, 1644` | Plex **Mono** (52 casos) o Plex **Sans** vía override (10 casos) — dos idiomas visuales para el mismo rol | **Besley 600/700 + `font-variant-numeric: tabular-nums`, tokens `metric`/`display`** | Verificado: `tnum` de Besley iguala las 10 cifras a 0.55 em. Es el rol donde el serif contrastado aporta autoridad y donde el tamaño protege las hairlines. Y **unifica** los dos tratamientos actuales. Requisito previo: arreglar 1.7 (`.num` sobre palabras) o las palabras heredan cifras tabulares (inocuo) **pero también** −0.02em de tracking sobre letras (no inocuo). |
| **Números tabulares en tablas y listas (11–14px)** | `charts.js:629`, `index.html:1109-1112`, celdas de `/mentions`, `/alerts` | Plex Mono o nada | **IBM Plex Mono 500 (`--ff-tabular`) + `tabular-nums`, tamaño `caption`/`label`** | Krub queda descartado por medición (no `tnum`, 35% de dispersión: una columna de conteos que se actualiza tiembla). Besley a 11–13px pierde hairlines sobre fondo oscuro. Se mantiene **una** mono, reducida a **1 peso** (9.8 KB latin). Beneficio de sistema: la mono queda confinada al rol "dato duro" y deja de ser la voz de los titulares — se vuelve significativa en vez de decorativa. |
| **Labels de eje de gráfica** | `charts.js:159, 162, 297, 311, 441, 514, 523` | 9–10px, `--text-3`, `fontFamily` puesto **solo en los numéricos** | **ticks numéricos: `--ff-tabular` 500, `caption` 12px, color `--text-2`. Ticks de fecha/categoría: Krub 500, `caption` 12px** | Hoy `charts.js:162` y `:523` no ponen `fontFamily`, así que las fechas heredan el `body` (proporcional) mientras el eje Y va en mono: dos voces en un eje. En SVG el `font-family` **no** se hereda de forma fiable a través de `<svg>`; hay que declararlo en cada `<text>`. Y `font-variant-numeric` **no** se aplica si no se pide explícitamente. |
| **Cuerpo / títulos de mención** | `screens.js:1184` (13px), `index.html:1157` (12.5px) | Plex Sans 13 / 12.5 | **Krub 400/500, `body` (14)** | El contenido que el usuario vino a leer está hoy a 13px, un píxel por encima del título del card que lo contiene (12px): contenido y cromo pesan igual. Krub a 14 rinde como Plex a 14.9. |
| **Microcopy / metadatos** | `index.html:380, 841, 1163, 1220`, `screens.js` (~150 sitios a 10–11px) | 9–11px `--text-3` | **Krub 500, `caption` (12), color `--text-2`** | Sube 1–3px y un escalón de color: cierra ~430 de los 471 fallos de contraste sin tocar la paleta. |
| **Código / URLs / IDs / `.kbd`** | `index.html:245-252` | Plex Mono 10px | **Plex Mono 500, `caption` 12 (`.kbd` a `micro` 11 si el chip no crece)** | Único rol donde la mono es semántica de verdad. |

### Resumen del reparto

- **Besley** solo por encima de 18px, y solo en 4 roles: `display`, `metric`,
  `title`, `subtitle`. Siempre con `line-height` explícito. Nunca en
  mayúsculas, nunca por debajo de 18px, nunca con tracking positivo.
- **Krub** es todo lo demás: cuerpo, labels, chips, botones, eyebrows,
  microcopy, ejes categóricos. 3 pesos (400/500/600). Se elimina el 700.
- **IBM Plex Mono** sobrevive con 1 peso (500) y un solo mandato: cualquier
  cifra que deba alinearse en columna o actualizarse en vivo por debajo de
  18px. Alias `--ff-tabular`.

---

## 4. Plan de migración

### 4.1 El `<link>` exacto (verificado: HTTP 200, 19 `@font-face`, 10 archivos únicos)

```html
<!-- index.html:8-10 — reemplaza las 3 líneas actuales -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Besley:wght@400..800&family=Krub:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" />
```

Coste medido:

| | familias | archivos únicos | latin | latin + latin-ext |
|---|---|---|---|---|
| hoy | 5 | 18 | 208.7 KB | 337.0 KB |
| **propuesta** | **3** | **10** | **80.2 KB** | **140.2 KB** |
| ahorro | −2 | −8 | **−128.4 KB (−62%)** | **−196.8 KB (−58%)** |

Decisiones de eje/peso, con su justificación de bytes:

- **Besley `wght@400..800` sin itálica.** Besley es variable, así que Google
  devuelve **un solo archivo** (36.5 KB latin) cubra el rango que cubra —
  pedir `400..800` en vez de `400..900` no ahorra nada, pero declarar el rango
  evita que el navegador sintetice pesos. **Omitir la itálica sí ahorra:
  39.5 KB latin / 19.5 KB latin-ext.** No hay ningún rol de la escala que la
  pida (la única itálica del sistema hoy es de `gaceta`, tema muerto). Si más
  adelante se quiere una voz editorial, se añade `1,400..700` y se paga
  entonces.
- **Krub `400;500;600`.** Krub es **estática**: cada peso es un archivo de
  ~11.8 KB latin. 3 pesos = 34.7 KB. Bajar a `400;600` ahorraría 11.9 KB pero
  deja la UI sin peldaño medio (los 1,312 nodos que hoy son 500). Se elimina el
  700 (1,740 nodos hoy) — el énfasis fuerte pasa a Besley o a color.
- **IBM Plex Mono `500` (un peso).** 9.8 KB latin. Hoy se piden 3 pesos
  (29.5 KB) para 1,838 nodos que, tras la migración, se reducen a columnas y
  ticks. El 500 es el que mejor aguanta a 12px sobre fondo oscuro.
- No hay control de subset en `css2`: el subset `thai` de Krub y el `cyrillic`
  de Besley **no se descargan nunca** porque el navegador respeta
  `unicode-range`. No hay que hacer nada.

**Objetivo (fase 3): autohospedar los 10 `.woff2`** en
`<WT>/apps/web/public/eco-prototype/fonts/` con `@font-face` propios. Motivos,
en orden: (a) elimina 2 handshakes DNS+TLS a dominios de Google en el camino
crítico de una app de gobierno; (b) hace estables las URLs de `preload` (las de
`gstatic` están versionadas y cambian); (c) quita una dependencia de terceros
de la cadena de suministro y del expediente de privacidad de un sistema
gubernamental — el hotlinking a Google Fonts ya ha sido problemático en otras
jurisdicciones y es, como mínimo, una pregunta que alguien va a hacer.

### 4.2 Preload y `font-display`

```html
<!-- solo con fuentes autohospedadas; máximo 3 preloads -->
<link rel="preload" as="font" type="font/woff2" crossorigin
      href="/eco-prototype/fonts/krub-400-latin.woff2" />
<link rel="preload" as="font" type="font/woff2" crossorigin
      href="/eco-prototype/fonts/besley-var-latin.woff2" />
<link rel="preload" as="font" type="font/woff2" crossorigin
      href="/eco-prototype/fonts/krub-600-latin.woff2" />
```

`font-display: swap` en las tres familias (nunca `optional`: `optional` puede
descartar la fuente en conexiones lentas y cambiar el aspecto del producto de
forma no determinista, inaceptable en una herramienta de mando). Con las
métricas de fallback de 4.3, el swap es visualmente casi invisible.

No hace falta preload de Plex Mono: 9.8 KB y su rol vive en tablas.

### 4.3 Fallbacks con métricas ajustadas (CLS ≈ 0)

Calculados con las métricas reales que medí. `size-adjust = x-height(webfont) /
x-height(fallback)`; `ascent/descent-override = métrica(webfont) / size-adjust`.
Métricas de los fallbacks leídas de los archivos del sistema:
Arial `x=0.5186, asc=0.9053, desc=0.2119`; Georgia `x=0.4814`; Menlo
`adv0=0.6021`.

```css
@font-face {
  font-family: 'KrubFallback';
  src: local('Arial'), local('Helvetica Neue'), local('Liberation Sans');
  size-adjust: 106.1%;      /* 0.550 / 0.5186 */
  ascent-override: 95.0%;   /* 1.007 / 1.061 */
  descent-override: 27.6%;  /* 0.293 / 1.061 */
  line-gap-override: 0%;
}
@font-face {
  font-family: 'BesleyFallback';
  src: local('Georgia'), local('Liberation Serif'), local('Times New Roman');
  size-adjust: 108.0%;      /* 0.520 / 0.4814 */
  ascent-override: 115.7%;  /* 1.250 / 1.080 */
  descent-override: 39.3%;  /* 0.425 / 1.080 */
  line-gap-override: 0%;
}
/* Plex Mono no necesita ajuste: su avance es 0.600 em y el de Menlo 0.6021
   em (0.3% de diferencia). Con ui-monospace/Menlo el layout tabular no se
   mueve. */
```

### 4.4 Tokens: **una** fuente de verdad en CSS, un façade JS

El bloque de custom properties es la única fuente de números. `T` es una capa
delgada encima para que los estilos inline puedan consumirlos.

```css
/* index.html — sustituye :root de :14-26 (y ver 4.5 para los bloques de tema) */
:root {
  /* ── familias ── */
  --ff-body:    'Krub', 'KrubFallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
  --ff-display: 'Besley', 'BesleyFallback', Georgia, 'Times New Roman', serif;
  --ff-tabular: 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace;

  /* ── ALIAS DE COMPATIBILIDAD ──
     Mantienen vivas las 38 referencias inline a --ff-sans/--ff-numeric/
     --ff-serif y las 4 reglas CSS que las usan. Permiten cambiar TODA la
     tipografía de la app sin editar un solo JSX (ver fase 0). */
  --ff-sans:    var(--ff-body);
  --ff-numeric: var(--ff-tabular);
  --ff-mono:    var(--ff-tabular);
  --ff-serif:   var(--ff-display);

  /* ── tracking de display: AHORA en :root, no solo en los temas light
        (arregla 1.6: en dark quedaba sin definir y los 8 letterSpacing
        inline colapsaban a normal) ── */
  --letter-display: -0.01em;

  /* ── escala tipográfica ── */
  --fs-display:  clamp(1.875rem,  1.6429rem + 0.952vw, 2.5rem);    /* 30 → 40 */
  --fs-metric:   clamp(1.5625rem, 1.4464rem + 0.476vw, 1.875rem);  /* 25 → 30 */
  --fs-title:    clamp(1.3125rem, 1.2429rem + 0.286vw, 1.5rem);    /* 21 → 24 */
  --fs-subtitle: clamp(1.125rem,  1.0786rem + 0.190vw, 1.25rem);   /* 18 → 20 */
  --fs-lead:     clamp(1rem,      0.9768rem + 0.095vw, 1.0625rem); /* 16 → 17 */
  --fs-body:     0.875rem;                                          /* 14 */
  --fs-caption:  0.75rem;                                           /* 12 */
  --fs-micro:    0.6875rem;                                         /* 11 (whitelist) */

  /* ── line-heights ── */
  --lh-display: 1.0;  --lh-metric: 1.05; --lh-title: 1.2;  --lh-subtitle: 1.3;
  --lh-prose:   1.5;  --lh-ui:     1.35; --lh-tight: 1.15;
}
```

Los `clamp()` interpolan linealmente entre 390px y 1440px de viewport
(`slope = (desktop − móvil) / 1050`; comprobado: `--fs-title` da 21.0px a 390px
y 24.00px a 1440px). Los extremos van en `rem` a propósito: así el usuario que
sube el tamaño de fuente del navegador — cosa que hace exactamente el público
de 50+ de esta app — obtiene un escalado real en los 7 pasos.

**Y el façade JS.** Recomiendo **un objeto `T` de tokens**, no clases
utilitarias. Razón: los 391 `fontSize` ya viven **dentro** de objetos
`style={{…}}` junto al color, el margen y el layout de cada nodo. Con clases
utilitarias habría que tocar `className` **y** dejar el objeto inline igual
(para color/layout): dos sitios por nodo, y un modelo mixto donde la mitad del
tipo está en CSS y la otra en JS. Con `T`, cada sitio es un diff de un token,
mecánicamente greppable, y la convención "los estilos viven junto al
componente" que el repo ya tiene se mantiene.

`data.js` se carga **primero** (`index.html:1475`,
`compile-prototype.js:18`), así que es el sitio natural:

```js
/* ── <WT>/apps/web/public/eco-prototype/data.js — al inicio del archivo ──
   Los VALORES viven en las custom properties de index.html; esto es solo el
   façade para los estilos inline. Cambiar la escala = editar CSS, nada más. */
const T = {
  display:    { fontFamily:'var(--ff-display)', fontSize:'var(--fs-display)',  lineHeight:'var(--lh-display)',  letterSpacing:'-0.02em',  fontWeight:700, fontVariantNumeric:'tabular-nums' },
  metric:     { fontFamily:'var(--ff-display)', fontSize:'var(--fs-metric)',   lineHeight:'var(--lh-metric)',   letterSpacing:'-0.015em', fontWeight:600, fontVariantNumeric:'tabular-nums' },
  title:      { fontFamily:'var(--ff-display)', fontSize:'var(--fs-title)',    lineHeight:'var(--lh-title)',    letterSpacing:'var(--letter-display)', fontWeight:600 },
  subtitle:   { fontFamily:'var(--ff-display)', fontSize:'var(--fs-subtitle)', lineHeight:'var(--lh-subtitle)', letterSpacing:'-0.005em', fontWeight:600 },
  lead:       { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-lead)',     lineHeight:'var(--lh-prose)',    letterSpacing:0, fontWeight:400 },
  body:       { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-body)',     lineHeight:'var(--lh-prose)',    letterSpacing:0, fontWeight:400 },
  bodyStrong: { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-body)',     lineHeight:'var(--lh-prose)',    letterSpacing:0, fontWeight:600 },
  label:      { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-body)',     lineHeight:'var(--lh-ui)',       letterSpacing:0, fontWeight:500 },
  caption:    { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-caption)',  lineHeight:'var(--lh-ui)',       letterSpacing:0, fontWeight:500 },
  eyebrow:    { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-caption)',  lineHeight:'var(--lh-tight)',    letterSpacing:'0.06em', fontWeight:600, textTransform:'uppercase' },
  micro:      { fontFamily:'var(--ff-body)',    fontSize:'var(--fs-micro)',    lineHeight:'var(--lh-tight)',    letterSpacing:'0.02em', fontWeight:500 },

  /* MIXIN, no un paso de tamaño: se esparce DESPUÉS de un token de tamaño
     para cualquier cifra que deba alinearse en columna o refrescarse en vivo
     por debajo de 18px. Krub NO tiene tnum — sin esto, tiembla. */
  tabular:    { fontFamily:'var(--ff-tabular)', fontVariantNumeric:'tabular-nums', letterSpacing:0 },
};
window.ECO_T = T;
```

Uso (el `const T = window.ECO_T` no hace falta: `const` de nivel superior en un
script clásico es visible en los scripts posteriores, igual que `PERIODS` en
`data.js:14`; si se prefiere el idioma explícito del repo, `window.ecoCols`, se
añade `const T = window.ECO_T;` al inicio de cada consumidor):

```jsx
// antes — screens.js:2071-2073
<div style={{ fontSize: 11, fontWeight: 700, color, textTransform:'uppercase', letterSpacing:'0.06em' }}>{t.name}</div>
<div className="num" style={{ fontSize: i < 2 ? 30 : 18, fontWeight: 600, color:'var(--text)', marginTop: 4, fontFamily:'var(--ff-display)' }}>{fmt(t.count)}</div>

// después
<div style={{ ...T.eyebrow, color }}>{t.name}</div>
<div style={{ ...(i < 2 ? T.metric : T.subtitle), color:'var(--text)', marginTop: 4 }}>{fmt(t.count)}</div>
```

```jsx
// tabla / eje: número que debe alinearse
<div style={{ ...T.caption, ...T.tabular, textAlign:'right' }}>{n.toLocaleString('es-PR')}</div>
```

**Si se prefiere un archivo aparte** (`tokens.js`), hay que registrarlo en
**dos** sitios: `compile-prototype.js:18` (array `FILES`) y `index.html:1475`
(array `files`), como primer elemento. Meterlo en `data.js` no toca el build.
Y en cualquier caso hay que subir el cache-bust `?v=prodc21` → `prodc22` en
`index.html:1479`.

### 4.5 Reglas CSS de `index.html` a tocar (lista completa)

**Bloque de familias y temas**

| línea | qué | acción |
|---|---|---|
| `20-23` | `--ff-sans/-serif/-mono/-display` | reemplazar por el `:root` de 4.4 |
| `58-60` | costa-light `--ff-display/-numeric/--letter-display` | **borrar** (tema muerto) |
| `121-123` | gaceta-light idem (Newsreader) | **borrar** — es lo que quita 80.6 KB |
| `184-186` | mando-light idem | **borrar** (ya en `:root`) |
| `215-216` | mando-dark `--ff-display/-numeric` | **borrar** (ya en `:root`) |
| `223` | `html,body { font-family: var(--ff-sans) }` | → `var(--ff-body)` |
| **`230`** | `[data-theme="mando"] body { font-family: var(--ff-display) }` | **BORRAR.** Es la línea que hace que la fuente de display sea la fuente del cuerpo. Si sobrevive, todo el dashboard sale en Besley. |
| `231` | `[data-theme="gaceta"] body` | borrar con el tema |

**Utilidades y primitivas**

| línea | selector | hoy | → |
|---|---|---|---|
| `244` | `.num` | `--ff-numeric` + `tabular-nums` + `var(--letter-display,-0.01em)` | `--ff-tabular` + `tabular-nums` + **`letter-spacing: 0`** |
| `245` | `.mono` | `--ff-mono` | `--ff-tabular` |
| `249` | `.kbd` | 10px | `--fs-micro` (11) |
| **`378`** | `.card-hd-title` | 12 / 600 / uppercase / 0.08em / `--text-2` | `--fs-caption` (12) / 600 / uppercase / **0.06em** / `--text-2` |
| `379` | gaceta `.card-hd-title` | Newsreader itálica 15px | borrar |
| `380` | `.card-hd-sub` | 11 / `--text-3` | 12 / `--text-2` |
| `391-393` | `.pill` | 11 / 600 | 12 / 600 |
| `397` | mando `.pill` | 10 / 0.04em | 12 / 0.05em |
| `427` | `.chip` | 11 / 500 | 14 (`label`) |
| `444` | `.btn` | 13 / 500 | 14 (`label`) |
| `451` | mando `.btn` | 12 | 14 |
| `465` | `.input` | 13 | 14 (+ **16 en móvil**) |
| **`473-479`** | `.section-eyebrow` | 10 / 700 / 0.14em / `--text-3` | 12 / 600 / **0.06em** / **`--text-2`** |
| `481` | gaceta `.section-eyebrow` | Newsreader itálica 13 | borrar |
| `508` | `.tt::after` | 11 | 12 |
| `590` | `.chat-title-btn` | 12 | 14 |
| `599` | `.chat-list-item` | 12 | 14 |
| `618` | `.chat-suggest` | 12.5 | 14 |
| `627` | `.chat-input` | 13 | 14 (+16 móvil) |
| `693` | `.leaflet-container` | `var(--ff-sans)` | `var(--ff-body)` |
| `716` | `.leaflet-control-attribution` | 9 `!important` | 11 (`micro`, whitelist) |

**Bloque `.narrative-*` (`:726-1346`) — 34 declaraciones**

`752-753` `.narrative-search` ff-sans/13 → ff-body/14(+16 móvil) ·
`772-773` `.btn-chip` ff-sans/10.5 → ff-body/12 ·
`796-799` `.narrative-menu-count` 10/0.08em → 12/0.06em ·
`830-833` `.narrative-item-name` 12.5 → 14 ·
`841` `.narrative-item-meta` 10.5 → 12 ·
`856` `.narrative-empty-li` 13 → 14 ·
`870-871` `.narrative-empty` 14/1.6 → 17/1.5 (`lead`) ·
`876` `.narrative-empty-small` 12 → 12 ✓ ·
`903-907` `.narrative-status-pill` 10/0.06em → 12/0.05em ·
**`911-916`** `.narrative-title` ff-display/20 → **`subtitle`** (Besley 20, `line-height:1.3` explícito) ·
`920-921` `.narrative-summary` 13 → 14 ·
`936` `.narrative-tag` 10.5 → 12 ·
`944` `.narrative-tag-mini` 9.5 → 12 ·
`956-959` `.narrative-metric-label` 9.5/0.08em → 12/0.06em ·
**`962-966`** `.narrative-metric-value` 18/`--ff-numeric` → **Besley `subtitle` 20 + `tabular-nums`** ·
`981` `.narrative-stream-legend` 11 → 12 ·
`1001` `.narrative-stream-hint` 10.5 → 12 ·
`1033-1036` `.narrative-panel-label` 10/0.08em → 12/0.06em ·
`1052` `.narrative-sentiment-row` 11 → 12 ·
`1067` `.narrative-peak` 11 → 12 ·
`1085` `.narrative-bar-list li` 11.5 → 14 ·
**`1109-1112`** `.narrative-bar-count` 11 + `tabular-nums` → 12 + `font-family: var(--ff-tabular)` (hoy pide tabular sin fuente tabular) ·
`1122` `.narrative-init-author` 13 → 14 ·
`1127` `.narrative-init-date/-meta` 11 → 12 ·
`1132-1134` `.narrative-init-snippet` 12 → 14 ·
`1139` `.narrative-link` 11 → 14 ·
`1157-1160` `.narrative-mention-title` 12.5 → 14 ·
`1163` `.narrative-mention-meta` 10.5 → 12 ·
`1175` `.narrative-sentiment-mini` 9.5 → 12 ·
`1202` `.narrative-related-btn` ff-sans → ff-body ·
`1213` `.narrative-related-name` 12.5 → 14 ·
`1220` `.narrative-related-meta` 10.5 → 12 ·
`1265-1268` `.narrative-day-eyebrow` 10/0.08em → 12/0.06em ·
**`1271-1273`** `.narrative-day-title` ff-display/18 → `subtitle` 20 Besley + `line-height:1.3` ·
`1278` `.narrative-day-count` 12 ✓ ·
`1307-1309` `.narrative-day-cluster-label` 11/0.08em → 12/0.06em ·
`1316` `…-label em` 10 → 12 ·
`1326-1329` `.narrative-day-mention-title` 12.5 → 14 ·
`1332` `…-meta` 10.5 → 12 ·
`1342-1345` `…-snippet` 11.5/1.45 → 14/1.5

**HTML/JS crudo fuera de React** (no pasa por `T`, hay que editarlo a mano):
`1359` `#eco-boot` (11px / 0.14em / `-apple-system`) → 12px / 0.06em y añadir
`'Krub'` al stack; `1383` y `1393` banner de API 12/11 → 14/13; `1489`
`<pre>` de error → dejar `monospace`, pero **el `EcoErrorBoundary` se pinta sin
tokens de tema** (hallazgo F5 del brief): añadir un `font-family` y un color
literales, no `var(--…)`.

**Bloque nuevo, dentro del `@media (max-width: 768px)` existente (`:321-353`)**

```css
  /* Sin esto, iOS Safari hace zoom al enfocar cualquier campo y reintroduce
     el scroll horizontal que PR #87 eliminó. */
  .input, .narrative-search, .chat-input,
  input[type="text"], input[type="search"], input[type="date"],
  textarea, select { font-size: 16px; }
```

### 4.6 Los 391 `fontSize` inline: codemod por fases

Distribución: `screens.js` 272 · `shell.js` 97 · `charts.js` 11 ·
`chat-drawer.js` 5 · `app.js` 6. Tabla de mapeo para el codemod (**con
revisión humana**: 30px significa `metric` en 7 sitios y "palabra grande" en 3,
ver 1.7):

| hoy | token |
|---|---|
| 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5 | `T.caption` (12) — salvo la whitelist de `micro` |
| ídem, cuando es una etiqueta en versalitas | `T.eyebrow` |
| 13, 13.5, 14 | `T.body` / `T.bodyStrong` / `T.label` según peso |
| 15, 16, 17, 18 | `T.lead` |
| 19, 20, 22 | `T.subtitle` |
| 24, 26, 28 | `T.title` |
| 30 | `T.metric` |
| 40 | `T.display` |

Orden de ataque (de menor a mayor riesgo): `charts.js` (11) → `chat-drawer.js`
(5) → `app.js` (6) → `shell.js` (97) → `screens.js` (272).

En `charts.js` hay que hacer además dos cosas que el codemod no ve:

```jsx
// charts.js:162 y :523 — hoy sin fontFamily: heredan el body (proporcional)
<text … fontSize="12" fontFamily="var(--ff-body)" fill="var(--text-2)">{data[idx].date}</text>
// charts.js:159, 297, 311, 441, 514 — ticks numéricos
<text … fontSize="12" fontFamily="var(--ff-tabular)"
      style={{ fontVariantNumeric:'tabular-nums' }} fill="var(--text-2)">{v}</text>
```

Comandos de censo para verificar avance:

```bash
WT=/Users/alegut/MyApps/eco_populicom/.claude/worktrees/design-audit/apps/web/public/eco-prototype
grep -c "fontSize:" $WT/screens.js $WT/shell.js $WT/charts.js   # 272 / 97 / 11 → 0
grep -n "fontSize: *\(8\|9\|10\|11\)\b" $WT/*.js | wc -l         # 259 → 0
grep -n "letterSpacing: *'0\.1[24]em'" $WT/*.js                  # tracking >0.08em → 0
```

### 4.7 Fase 4 — símbolos: sacar las flechas de la tipografía

Ninguna de las fuentes candidatas tiene `→ ▲ ▼ ● ⌘ ✕` (tampoco IBM Plex hoy),
y **Besley además no tiene `↑ ↓`** (Plex y Krub sí). Uso real en el código:
`→` 47× · `⌘` 14× · `▲` 5× · `▼` 5× · `↑` 4× · `↓` 4× · `✕` 2×. Hoy todos
salen de una fuente de símbolos del sistema, con otro peso y otro ancho — se ve
en `shots/overview-desktop-fold.png`, donde el `▲` de `▲+34%` no comparte
grosor con los dígitos de al lado.

Los iconos SVG **ya existen**: `icons.js:20-23` exporta
`ArrowUp / ArrowDown / ArrowRight / ArrowLeft` (+ `TrendUp/TrendDown`), y
`screens.js:117` ya usa `<I2.ArrowUp size={11} />`. Sustituir los 61 glifos de
texto por esos componentes hace la tipografía autosuficiente y elimina una
fuente de inconsistencia entre macOS y Windows. Sitios: `charts.js:271`,
`shell.js:693, 1666`, `screens.js:2096, 2164, 2305, 4234, 5580, 5581, 5930`.

### 4.8 Ant Design y las páginas Next.js

Situación actual: `layout.tsx` **no carga ninguna fuente**, y
`eco-theme.ts:31-32` fija `fontFamily` al stack del sistema con el comentario
`// Typography — system fonts, no external loading`. Además AntD no declara
`fontSize`, así que usa su default de **14px** — es decir, **las páginas
`/sign-in`, `/settings/reports` y `/narratives` tienen el cuerpo MÁS GRANDE que
el dashboard entero** (cuyo máximo de cuerpo es 13px y cuya mediana es 11px).
Tras la migración esa incoherencia se resuelve sola porque `body` pasa a 14.

Cambios:

1. **Extraer el bloque de tokens a un archivo compartido**
   `<WT>/apps/web/public/eco-prototype/tokens.css` (familias, `--fs-*`,
   `--lh-*`, `@font-face` de fallback) y consumirlo desde los dos lados:
   `<link rel="stylesheet" href="/eco-prototype/tokens.css">` en
   `index.html` y en `layout.tsx`. Sin esto, `globals.css` no puede referirse a
   `var(--ff-display)` (hoy los tokens solo existen dentro del `<style>` de la
   SPA).
2. **`layout.tsx`**: añadir los `preconnect` + el `<link>` de 4.1 (o los
   `@font-face` autohospedados vía `tokens.css`).
3. **`eco-theme.ts`**:

```ts
token: {
  // …
  fontFamily: "'Krub', 'KrubFallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  fontFamilyCode: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  fontSize: 14,          // body
  fontSizeSM: 12,        // caption
  fontSizeLG: 17,        // lead
  fontSizeXL: 20,        // subtitle
  fontSizeHeading1: 30, fontSizeHeading2: 24, fontSizeHeading3: 20,
  fontSizeHeading4: 17,  fontSizeHeading5: 14,
  lineHeight: 1.5, lineHeightLG: 1.5, lineHeightSM: 1.35,
},
```

4. **`globals.css`**: AntD no tiene token de "fuente de titulares", así que
   Besley entra por CSS:

```css
h1, h2, h3, h4,
.ant-typography h1, .ant-typography h2, .ant-typography h3, .ant-typography h4,
.ant-modal-title, .ant-drawer-title, .ant-card-head-title {
  font-family: var(--ff-display);
  letter-spacing: var(--letter-display);
}
.ant-table-cell .eco-num, .ant-statistic-content-value {
  font-family: var(--ff-tabular);
  font-variant-numeric: tabular-nums;
}
```

5. `globals.css:38-44` `.eco-sidebar-section-label` (10px / `letter-spacing:
   1.5px` / `rgba(255,255,255,0.2)` — contraste ≈1.4:1) → 12px / 0.06em /
   `rgba(255,255,255,0.55)`.
6. Los 11 `fontSize` inline de `src/**` (`sign-in/page.tsx`,
   `settings/alerts/page.tsx`, `settings/reports/page.tsx`: valores 11, 12, 13,
   14, 22) → tokens equivalentes. Superficie trivial.

### 4.9 Fases y entregables

| fase | contenido | JSX tocado | efecto |
|---|---|---|---|
| **0** | `tokens.css` + `<link>` nuevo + alias `--ff-sans/-numeric/-serif` + `--letter-display` en `:root` + borrar `index.html:230` + borrar temas muertos + `@media` inputs 16px | **cero** | La app entera cambia de tipografía y **−128 KB**, sin editar un componente. Reversible en un commit. |
| **1** | Las ~90 reglas de `index.html` (tabla 4.5) | cero | Desaparecen los tamaños <12px del CSS; cierra ~430 fallos de contraste al subir microcopy a `--text-2`. |
| **2** | Codemod de los 391 `fontSize` inline, archivo por archivo | sí | La escala queda impuesta; `grep fontSize:` → 0. |
| **3** | Autohospedar fuentes + `preload` + tokens compartidos + AntD | — | CLS ≈ 0, sin terceros. |
| **4** | Símbolos → `Icons.*` | sí | Tipografía autosuficiente. |

Recordatorio operativo (memoria del proyecto): `dist/` está gitignoreado y se
regenera con `compile-prototype.js` en el `prebuild`; hay que **subir a mano**
el `?v=prodcNN` de `index.html:1479` en cada fase o el navegador sirve el
bundle viejo.

### 4.10 Cómo verificar

- Re-correr el probe y comprobar: `probe.fonts` debe mostrar **3** familias, la
  distribución de tamaños debe **cambiar** entre `desktop` y `mobile` (hoy es
  idéntica), `sizes` no debe contener nada <12 salvo los 2 sitios de la
  whitelist, y `lowContrast` debe caer de 471 a <40.
- Montar la App completa con el tema `mando` real (no el componente aislado) y
  comparar contra las capturas actuales de `shots/` a los 4 viewports.
- iOS real (o Safari responsive con "Prevent zoom" desactivado): enfocar el
  buscador del header y confirmar que la página **no** hace zoom.


## Riesgos

- Anchura de Besley en versalitas: medido +19% a +24% sobre cadenas reales (TÓPICOS · VISTA PANORÁMICA 204.2→245.3px; EVOLUCIÓN MULTI-MÉTRICA 186.7→232.3px; ENERGÍA E INFRAESTRUCTURA 180.5→224.1px). Sitios que romperían si Besley baja a los títulos de card o a los eyebrows: index.html:378 (.card-hd-title, 32 usos — en topics-mobile-fold.png ya rompe a 3 líneas y choca con Treemap/Burbujas/Lista), screens.js:2071 (labels del treemap, que el probe ya marca truncados en escritorio), shell.js:415 (.section-eyebrow del header, con nowrap+ellipsis, compartiendo fila con el chip 'Datos al cierre de ayer'). Mitigación: Besley solo ≥18px y nunca en mayúsculas; Krub en mayúsculas mide −3%, así que entra sin coste.
- Altura de línea por defecto de Besley: 1.675 contra 1.300 de IBM Plex Sans (medido en hhea: 2500/-850 sobre upm 2000). Todo elemento que pase a Besley SIN line-height explícito crece su caja de línea un 29%. Sitio concreto: shell.js:426-431, el <h1> del header sticky, que no declara lineHeight — su caja pasaría de ~28.6px a ~36.9px, empujando el header ~8px en TODAS las pantallas y descuadrando el cálculo de --eco-banner-offset (index.html:1403-1406) y los calc(100vh - 140px) de index.html:730 y 740. También screens.js:2298 (título de tópico, 28px sin lineHeight). Mitigación: line-height explícito en los cuatro tokens Besley, sin excepción.
- Krub no puede hacer cifras tabulares: no tiene el feature tnum (solo frac, kern, liga, locl), así que font-variant-numeric: tabular-nums es un no-op SILENCIOSO, y sus dígitos tienen 35.1% de dispersión ('1'=0.459 em contra '0'=0.620 em). Riesgo concreto: los números que se renderizan SIN className="num" heredan el body y quedan en Krub — entre ellos charts.js:162 y charts.js:523 (fechas del eje X) y las celdas numéricas de /mentions y /alerts. Una columna de conteos que se refresca al cambiar de periodo temblaría. Mitigación: mixin T.tabular obligatorio (IBM Plex Mono + tabular-nums) en toda cifra alineable por debajo de 18px; auditar con un grep de números sin .num antes de la fase 2.
- Besley pierde ↑ y ↓, que IBM Plex y Krub sí tienen (verificado en los cmap de los cuatro archivos). Sitios afectados: screens.js:2096, screens.js:2164, screens.js:2305 (deltas de SentimentBar con ↑/↓/↔) y shell.js:693 (.kbd con ↑↓). Si el delta acaba dentro de una run de Besley, la flecha cae a la fuente de símbolos del sistema con otro peso. Y → (47 usos), ⌘ (14), ▲▼ (10) y ✕ (2) YA caen a fallback hoy en las cuatro fuentes. Mitigación: fase 4, sustituir por Icons.ArrowUp/ArrowDown/ArrowRight (icons.js:20-23), que ya existen y ya se usan en screens.js:117.
- Densidad: subir el piso de 10-11px a 12/14px hace crecer los bloques de texto entre un 15% y un 25% de alto. Sitios con altura fija que van a apretar: index.html:740-743 (.narrative-menu con height: calc(100vh - 140px) y overflow: hidden) combinado con index.html:834-838 (-webkit-line-clamp: 2 en .narrative-item-name) — el mismo raíl de 320px va a mostrar menos narrativas y a truncar antes; index.html:730 (.narrative-screen, min-height: calc(100vh - 140px)); screens.js:2051 (gridAutoRows: '76px' de los tiles del treemap, que ya no cabrán con label de 12px + cifra de 30px + barra). Mitigación: convertir esas alturas en min-height/auto antes de la fase 1, y revisar los tiles con el nuevo tamaño.
- Definir --letter-display en :root (arreglo de T9) ACTIVA el tracking de −0.01em en modo oscuro, donde hoy está inactivo por sustitución inválida. Los 8 letterSpacing inline (shell.js:428, 1230, 1640; screens.js:378, 2298, 4172, …) empiezan a aplicarse: los títulos se estrechan ~1% y algunas líneas reflotan. Es un cambio visual real que nadie pidió — hay que anunciarlo y revisar capturas antes/después, no colarlo como parte del cambio de fuente.
- Los alias de compatibilidad (--ff-sans: var(--ff-body), --ff-numeric: var(--ff-tabular), --ff-serif: var(--ff-display)) hacen que la fase 0 cambie toda la tipografía sin tocar JSX, pero también significan que las 38 referencias inline a --ff-* siguen ahí y ya no dicen la verdad sobre qué fuente piden. Si los alias se quedan indefinidamente, la próxima persona leerá 'var(--ff-serif)' en shell.js:207 y asumirá que hay una serif de texto en el sistema. Mitigación: los alias son andamio de una sola release; la fase 2 los elimina y el codemod debe dejar el grep de --ff-sans/--ff-numeric/--ff-serif en 0.
- Besley no tiene smcp (features verificados: calt, kern, liga, mark, tnum): no hay versalitas verdaderas. Cualquier maqueta que muestre eyebrows en 'small caps' de Besley estaría enseñando mayúsculas escaladas — más pesadas y más anchas de lo que el diseño promete. Tampoco tiene onum/pnum/lnum, así que no hay cifras de estilo antiguo para los títulos editoriales. Conviene cerrarlo con el cliente antes de que aparezca en una presentación.


---

# Espaciado, radios, elevación, movimiento e inventario de primitivas de componente

## Resumen

La SPA no tiene sistema de espaciado ni de elevación: 17 valores de gap, 70 de padding, 14 de margin-top, 10 radios numéricos contra 4 tokens que casi nadie usa, y una rampa de superficies INVERTIDA en dark (`--canvas-2` #091018 es más oscuro que la card #0E1620 y queda a 1.038:1 del fondo de página, así que un panel anidado se lee como un agujero). La sombra de card en mando dark es matemáticamente invisible (1.022:1), de modo que la única señal de separación es un hairline a 6% con 1.161:1 — y la card apenas se separa del fondo a 1.090:1. Eso convierte dos problemas cosméticos en problemas de veracidad: (a) un contenedor vacío es indistinguible de uno con datos — la card "Activaciones por día" pinta 110 px de nada bajo un subtítulo que dice "11 eventos en el período"; (b) hay 24 bloques de estado vacío/carga/error copiados a mano en 3 paddings distintos porque no existe primitiva de estado. La cabecera consume 228 px antes del primer dato en escritorio y 284–306 px en móvil (34–36% del fold), con una fila entera dedicada a un botón de tema que además duplica el control que ya vive en TweaksPanel. Los eyebrows numerados 01→05 del Overview se pintan en TRES estilos tipográficos distintos, así que la secuencia no se lee como secuencia. Hay cero `prefers-reduced-motion` en todo el repo con 5 animaciones infinitas, y `HBarList` anima `width 0.3s` en cada render, lo que hace que al cambiar de periodo las barras "se muevan" como si el dato evolucionara. Faltan 14 primitivas que el código reinventa: Overlay (3 modales copiados, 3 drawers, 3 popovers, 4 recetas de backdrop, 9 z-index sin escala), Tabla (13 plantillas de grid a mano), Estado, Métrica (8 implementaciones del rol "etiqueta + número grande"), Tooltip (3 mecanismos, uno muerto), Meter (9 barras), Toast (2 hosts), Switch, Tabs.

> Todas las medidas de captura son en px CSS (las capturas son @2x: desktop 2000→1440, móvil 924→390).
> Censo de valores inline sobre `screens.js` (5 956 líneas) + `shell.js` (1 765) + `charts.js` (878) + `chat-drawer.js` (325) + `app.js` (440), y del bloque `<style>` de `index.html` (líneas 13–1355).

---

# 0. La deuda, en números

| Dimensión | Hoy | Propuesta | Reducción |
|---|---|---|---|
| Valores de `gap` | **17** (0,1,2,3,4,5,6,8,10,11,12,14,16,18,20,22,24) · 301 usos | **8** (0,2,4,8,12,16,20,24) | −53% |
| Valores de `padding` | **70** literales / 14 numéricos + 56 shorthands · 195 usos | **6** contenedor + 4 alturas de control | −91% |
| Valores de `margin-top` | **14** · 74 usos | 0 (el gap del padre manda) | −100% |
| Paddings distintos en `.card` | **9** (0,12,14,16,18,20,24,28,40) | **4** (`pad="none|sm|md|lg"`) | −56% |
| Radios numéricos | **10** (1,2,3,4,5,6,8,10,12,999) + `50%` + `inherit` | **5** (2,4,6,10,999) + `50%` | −50% |
| Overrides `[data-theme] .x{border-radius}` | **13** | **0** (se redefinen 5 tokens por tema) | −100% |
| Alturas de control pintadas | **13** (21,22,23,26,29,30,31,33,34,35,38,40,41) | **4** (28,32,40,44) | −69% |
| Recetas de `box-shadow` | **17** (8 inline + 9 CSS) | **4** tokens | −76% |
| Recetas de backdrop | **4** (0.4/0.5 × blur 0/2/4) | **1** | −75% |
| Valores de `z-index` | **14** sin escala (50→2500) | **7** tokens | −50% |
| Duraciones de transición | **11** (0.1→0.3 s) + 6 easings | **4** duraciones + 3 easings | −64% |
| Bloques de estado vacío/carga/error copiados | **24** inline (paddings 16/24/40) + 4 clases `narrative-empty*` | **1** primitiva `<State>` | −96% |
| Plantillas de tabla en grid a mano | **13** distintas en 18 usos | **1** primitiva `<DataTable>` | −92% |
| Implementaciones de "etiqueta + número grande" | **8** | **1** (`<Metric>`) | −87% |
| Implementaciones de barra/medidor | **9** (h 4/6/8/10; r 1/2/3/4/5/999/inherit) | **1** (`<Meter>`) | −89% |
| Estilos de micro-etiqueta mayúscula | **6** | **1** (`<SectionHeader>`) | −83% |
| Cromo antes del primer dato | **228 px** desktop / **284–306 px** móvil | **139 px** / **216 px** | −39% / −49% |
| `prefers-reduced-motion` | **0 reglas** en todo el repo | 1 bloque global | — |

---

# 1. Escala de espaciado

## 1.1 Los tokens

Base **4 px**, con un único medio-paso (2 px) permitido sólo *dentro* de un mismo clúster (icono↔texto, punto↔etiqueta, número↔sufijo).

```css
:root {
  --sp-0:  0px;
  --sp-05: 2px;   /* SUB-REJILLA: sólo intra-clúster. Prohibido entre bloques. */
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3:  12px;
  --sp-4:  16px;
  --sp-5:  20px;
  --sp-6:  24px;
  --sp-8:  32px;
  --sp-12: 48px;
  --sp-16: 64px;
}
```

Roles semánticos encima (lo que se escribe en el código de pantalla, nunca `--sp-*` a pelo en layout de página):

```css
:root {
  --gap-cluster:  var(--sp-1);   /* 4  — icono↔label, label↔valor */
  --gap-item:     var(--sp-2);   /* 8  — filas de lista, chips, keywords */
  --gap-card:     var(--sp-3);   /* 12 — entre cards de una misma sección (grid gap) */
  --gap-block:    var(--sp-4);   /* 16 — entre bloques dentro de una card */
  --gap-section:  var(--sp-6);   /* 24 — entre secciones de página */
  --pad-card-sm:  var(--sp-3);   /* 12 */
  --pad-card:     var(--sp-4);   /* 16 */
  --pad-card-lg:  var(--sp-5);   /* 20 */
  --pad-card-xl:  var(--sp-6);   /* 24 — sólo modal/drawer/hero */
  --pad-page-x:   var(--sp-6);   /* 24 (desktop) */
  --pad-page-y:   var(--sp-5);   /* 20 */
}
@media (max-width: 768px) {
  :root { --pad-page-x: var(--sp-3); --pad-page-y: var(--sp-3); --gap-section: var(--sp-5); }
}
```

## 1.2 Mapa de migración — los 17 `gap`

Regla mecánica, sin criterio humano: **al paso más cercano; en empate, al vecino más frecuente**.

| Viejo | Usos | → Nuevo | Token | Nota |
|---:|---:|---:|---|---|
| 0 | 1 | 0 | `--sp-0` | |
| 1 | 1 | **2** | `--sp-05` | `charts.js` gap del heatmap |
| 2 | 12 | 2 | `--sp-05` | queda sólo intra-clúster; los de nav (`shell.js:272,281`) suben a 4 |
| 3 | 2 | **4** | `--sp-1` | |
| 4 | 29 | 4 | `--sp-1` | |
| 5 | 12 | **4** | `--sp-1` | ↓1 |
| **6** | **48** | **8** | `--gap-item` | **el cambio de mayor impacto**: empate 4/8, gana 8 (64 vs 29 usos) |
| 8 | 64 | 8 | `--gap-item` | |
| **10** | **39** | **8** | `--gap-item` | empate 8/12, gana 8 |
| 11 | 1 | **12** | `--gap-card` | logo del rail (`shell.js:193`) |
| 12 | 41 | 12 | `--gap-card` | |
| 14 | 10 | **12** | `--gap-card` | empate 12/16, gana 12 |
| 16 | 26 | 16 | `--gap-block` | |
| 18 | 3 | **16** | `--gap-block` | empate 16/20, gana 16 |
| 20 | 9 | 20 | `--sp-5` | |
| 22 | 1 | **20** | `--sp-5` | `screens.js:1380` |
| 24 | 2 | 24 | `--gap-section` | |

**Desaparecen: 1, 3, 5, 6, 10, 11, 14, 18, 22.** Sobreviven 0, 2, 4, 8, 12, 16, 20, 24.

## 1.3 Mapa de migración — `padding`

### Numéricos (`padding: N`)

| Viejo | Usos | → Nuevo | Token | Nota |
|---:|---:|---|---|---|
| 0 | 8 | 0 | `--sp-0` | |
| 3 | 2 | **4** | `--sp-1` | bolsa de periodos (`shell.js:452`) |
| 6 | 1 | **8** | `--sp-2` | |
| 8 | — | 8 | `--sp-2` | |
| 12 | 6 | 12 | `--pad-card-sm` | |
| **14** | **9** | **12** | `--pad-card-sm` | `card` slim, tweaks, datepop |
| 16 | 11 | 16 | `--pad-card` | |
| **18** | **2** | **16** | `--pad-card` | `KpiCard` (`screens.js:81`) |
| 20 | 7 | 20 | `--pad-card-lg` | |
| **22** | **1** | **20** | `--pad-card-lg` | |
| 24 | 14 | 24 | `--pad-card-xl` | |
| **28** | **1** | **24** | `--pad-card-xl` | `screens.js:1380` |
| **40** | **13** | **24** | `<State size="lg">` | ⚠️ los 13 usos son estados vacíos/carga/error; **no** se migra el padding, se migra el bloque a la primitiva |

**Desaparecen: 3, 6, 14, 18, 22, 28, 40.** Sobreviven 0, 4, 8, 12, 16, 20, 24.

### Shorthands (los 15 más usados de 56)

| Viejo | Usos | Rol real | → Nuevo |
|---|---:|---|---|
| `'8px 10px'` | 15 | fila de lista / celda | `var(--sp-2) var(--sp-3)` |
| `'2px 6px'` | 8 | micro-badge | primitiva `<Badge>` (h 18, px 6) |
| `'14px 16px'` | 7 | `card-hd` | `var(--sp-3) var(--sp-4)` (simétrico, ver §1.5) |
| `'10px 12px'` | 7 | fila / panel | `var(--sp-2) var(--sp-3)` |
| `'10px 16px'` | 5 | botón grande | `--h-ctl-lg` + `padding-inline: var(--sp-4)` |
| `'6px 10px'` | 4 | chip | `--h-ctl-sm` + `padding-inline: var(--sp-3)` |
| `'12px 16px'` | 3 | panel | `var(--sp-3) var(--sp-4)` |
| `'4px 8px'` | 3 | pill | primitiva `<Pill>` (h 20, px 8) |
| `'12px 14px'` | 3 | chat head | `var(--sp-3) var(--sp-4)` |
| `'20px 24px'` | 2 | header de modal | `var(--sp-5) var(--sp-6)` |
| `'18px 24px'` | 2 | header de drawer | `var(--sp-5) var(--sp-6)` |
| `'16px 18px'` | 2 | — | `var(--sp-4)` |
| `'9px 12px'` | 2 | nav item | `--h-ctl-lg` (44 en táctil) + `padding-inline: var(--sp-3)` |
| `'8px 56px 8px 32px'` | 1 | input con affordances | `--h-ctl-lg` + iconos absolutos a `--sp-3` |
| `collapsed ? '9px 0' : '9px 12px'` | 4 | rail colapsado | `--h-ctl-lg` + `padding-inline: 0 | var(--sp-3)` |

### `margin` → 0

Los 74 `marginTop` (4:15, 2:12, 8:10, 6:8, 12:6, 10:5, 3:4, 16:3, −2:3, 1:3, 5:2, 18:1, −4:1) y los 72 `marginBottom` (10:23, 8:19, 6:16, 4:7 …) **se eliminan**: el espaciado lo pone el `gap` del contenedor flex/grid padre. Excepciones permitidas: `margin-inline: -8/-10` para "sangrar" filas hover al borde de la card (4 usos, `screens.js`) → token `--bleed: calc(-1 * var(--pad-card))`.

## 1.4 Alturas de control (la escala que hoy no existe)

Hoy se pintan **13** alturas. Los probes registran **369 targets <44 px en móvil**, con la distribución: 22 px ×100, 35 px ×102, 40 px ×61, 34 px ×31, 23 px ×20, 26 px ×13, 12 px ×13. Peor: los bumps móviles de `index.html:340-342` fijan deliberadamente `.btn{min-height:40px}` / `.chip{min-height:34px}` / `input,select{min-height:40px}` — **todos por debajo de 44**.

```css
:root {
  --h-ctl-sm: 28px;  /* controles densos, sólo ≥1025px */
  --h-ctl:    32px;  /* default desktop */
  --h-ctl-lg: 40px;  /* acciones primarias, campos de formulario */
  --h-tap:    44px;  /* mínimo táctil */
  --px-ctl-sm: var(--sp-2);  /* 8  */
  --px-ctl:    var(--sp-3);  /* 12 */
  --px-ctl-lg: var(--sp-4);  /* 16 */
}
@media (max-width: 1024px), (pointer: coarse) {
  :root { --h-ctl-sm: var(--h-tap); --h-ctl: var(--h-tap); --h-ctl-lg: var(--h-tap); }
}
```

| Control | Archivo:línea | Alto hoy | → Token |
|---|---|---:|---|
| `.btn` | `index.html:440` (`7px 14px`, fs13) | 31 | `--h-ctl` |
| `.btn` mando | `index.html:451` (fs12) | 29 | `--h-ctl` |
| `.chip` | `index.html:424` (`5px 10px`) | 23 | `--h-ctl-sm` |
| `.chip` móvil | `index.html:341` | 34 | `--h-tap` |
| `.input` | `index.html:458` (`7px 12px`) | 33 | `--h-ctl-lg` |
| `.btn-chip` | `index.html:763` (`3px 8px`, fs10.5) | 21 | `--h-ctl-sm` |
| chips de periodo | `shell.js:464` (`4px 10px`) | 22 | `--h-ctl` |
| botón "Fechas" | `shell.js:479` (`5px 10px`) | 26 | `--h-ctl` |
| pill de agencia + `select` | `shell.js:438,446` | 29 → **55 en móvil** | `--h-ctl` / `--h-tap` |
| `.narrative-search` | `index.html:745` | 33 | `--h-ctl-lg` |
| hamburguesa | `shell.js:408` | 40 | `--h-tap` |
| `.chat-send` | `index.html:632` | 38 | `--h-ctl-lg` |
| `.narrative-day-close` | `index.html:1282` | 30 | `--h-ctl` |
| switch inline | `screens.js:3154` (28×16) | **16** | `<Switch>` con `--h-tap` de hit-area |
| AntD `controlHeight` | `apps/web/src/theme/eco-theme.ts:35-37` | 28/36/40 | alinear a 28/32/40 |

## 1.5 Simetría del hairline de la card

`.card-hd` cierra con **10 px** (`index.html:369`: `padding: 14px 16px 10px`) y `.card-bd` abre con **16 px** (`index.html:381`) → el hairline queda descentrado 6 px. Propuesta:

```css
.card-hd { padding: var(--sp-3) var(--pad-card); }              /* 12 16 12 */
.card-bd { padding: var(--pad-card); }                          /* 16 */
.card-hd + .card-bd { padding-top: var(--sp-3); }               /* 12 — pega al hairline */
```

---

# 2. Radios

## 2.1 El set final

Hoy existen `--r-sm:6 / --r:10 / --r-lg:14 / --r-xl:20` (`index.html:16-19`) pero se pintan **10 valores numéricos** y hay **13 overrides `[data-theme] .x{border-radius:…}`** que atropellan los tokens en vez de redefinirlos. Consecuencia visible en la captura `overview-desktop-fold.png`: en la misma fila del header convive el input de búsqueda a **10 px** (`.input` no tiene override mando, `index.html:458-468`), el botón "Chat" a **4 px** (`index.html:451`) y la pill de agencia a **999 px** (`shell.js:440`).

```css
:root {
  --r-none:   0;
  --r-xs:     2px;   /* fills de barra, swatches, rects SVG */
  --r-sm:     4px;   /* controles: btn, chip, input, kbd, tag, panel anidado */
  --r-md:     6px;   /* cards, paneles, popovers, tiles, celdas */
  --r-lg:     10px;  /* modal, drawer, spotlight, sheet */
  --r-pill:   999px;
  --r-circle: 50%;
}
[data-theme="costa"] { --r-xs:3px; --r-sm:6px;  --r-md:10px; --r-lg:14px; }
[data-theme="gaceta"]{ --r-xs:1px; --r-sm:3px;  --r-md:4px;  --r-lg:4px;  --r-pill:3px; }
[data-theme="mando"] { --r-xs:2px; --r-sm:4px;  --r-md:6px;  --r-lg:10px; }
```

**Regla de anidamiento (hoy violada):** el radio de un hijo nunca supera el del padre. Cada nivel de anidamiento baja un escalón: `--r-lg` (overlay) → `--r-md` (card) → `--r-sm` (panel dentro de card) → `--r-xs` (fill dentro de track).

## 2.2 Mapa de migración

| Viejo | Usos | → Nuevo | Token | Sitios representativos |
|---:|---:|---:|---|---|
| 1 | 1 | **2** | `--r-xs` | `.bar-track` mando (`index.html:665`) |
| 2 | 7 | 2 | `--r-xs` | swatches del streamgraph, `rx=2` en `charts.js:397,416` |
| 3 | 17 | **4** | `--r-sm` | `.pill/.chip/.btn` mando+gaceta, medidores |
| 4 | 10 | 4 | `--r-sm` | `.kbd`, `.skeleton`, badge de IA |
| 5 | 1 | **4** | `--r-sm` | `.narrative-sentiment-bar` (`index.html:1042`) |
| 6 | 15 | 6 | `--r-md` | `.card` mando, `.spotlight` mando, `NavItem` |
| **8** | **23** | **6** | `--r-md` | ⚠️ tiles del treemap (`screens.js:2062`) **dentro** de `.card` a 6 px; ítems del palette (`shell.js:677`); hamburguesa |
| 10 | 12 | 10 | `--r-lg` | `--r` heredado: `.input`, `.btn`, `.chat-suggest`, `.chat-send`, badge del rail |
| **12** | **5** | **10** | `--r-lg` | los 3 modales (`shell.js:1214,1621`; `screens.js:3273`), `.chat-input` |
| 999 | 8 | 999 | `--r-pill` | pill de agencia, bolsa de periodos, `.pill/.chip` costa |
| `'50%'` | 20 | — | `--r-circle` | dots, avatares, marcador de banda |
| `'inherit'` | 2 | — | `inherit` | fill dentro de track (correcto, se queda) |
| `height / 2` | 2 | — | `--r-pill` | |
| `theme==='gaceta'?3:6` | 1 | — | `--r-md` | `shell.js:154` (deja de ser condicional) |
| `theme==='gaceta'?4:8` | 1 | — | `--r-md` | `shell.js:199` |
| `'2px 2px 0 0'` | 2 | — | `var(--r-xs) var(--r-xs) 0 0` | barras de histograma |

**Desaparecen: 1, 3, 5, 8, 12** y los 13 overrides por tema.

---

# 3. Elevación: un sistema honesto para dark

## 3.1 Por qué el actual es ficticio (números medidos)

| Par | Ratio WCAG | Lectura |
|---|---:|---|
| `--canvas` #0E1620 vs `--bg` #060A10 | **1.090:1** | la card apenas se despega del fondo |
| `--canvas-2` #091018 vs `--canvas` #0E1620 | **1.050:1** | panel anidado invisible **y más oscuro que su padre** |
| `--canvas-2` vs `--bg` | **1.038:1** | un panel dentro de una card ≈ el fondo de página → **se lee como agujero** |
| `--hairline` (blanco 6%) sobre canvas | **1.161:1** | único separador real de todo el sistema |
| `--shadow-sm` `0 1px 0 rgba(0,0,0,.4)` sobre bg | **1.022:1** | **matemáticamente invisible** |
| hover de `KpiCard` `0 6px 18px rgba(0,0,0,.18)` (`screens.js:86`) | ~1.008:1 | el hover de las 5 KPI clickeables no existe |

En dark, una sombra negra sobre un fondo casi negro no puede producir elevación. La elevación tiene que venir de **la superficie**, no de la sombra.

## 3.2 La rampa (mando dark)

```css
[data-theme="mando"][data-mode="dark"] {
  /* superficies: cada nivel SUBE en luminancia */
  --surface-0:        #060A10;  /* página            — ratio vs L0: 1.000 */
  --surface-1:        #121B26;  /* card, rail-item   — 1.143 vs L0 */
  --surface-2:        #1A2432;  /* panel dentro de card, header de card, fila hover — 1.109 vs L1 */
  --surface-3:        #232E3D;  /* popover, dropdown, tooltip — 1.140 vs L2 */
  --surface-overlay:  #1A2432;  /* modal / drawer / sheet — 1.109 vs la card que tapa */
  --surface-sunken:   #0A121B;  /* wells: bar-track, input, code — 1.085 POR DEBAJO de L1 */

  /* bordes por nivel (blanco a alpha creciente para compensar la superficie) */
  --border-1:         rgba(255,255,255,0.10);  /* sobre L1 → 1.338:1 (hoy 1.161) */
  --border-2:         rgba(255,255,255,0.10);  /* sobre L2 → 1.359:1 */
  --border-strong:    rgba(255,255,255,0.16);  /* overlay, focus, hover de card */

  /* sombras: SOLO para elementos que flotan sobre contenido arbitrario */
  --shadow-pop:     0 4px 12px -2px rgba(0,0,0,0.55);
  --shadow-overlay: 0 16px 48px -12px rgba(0,0,0,0.72);
  --shadow-sticky:  0 1px 0 var(--border-1), 0 8px 16px -12px rgba(0,0,0,0.6);
  --highlight-top:  inset 0 1px 0 rgba(255,255,255,0.06); /* filo superior: lo que en dark SÍ lee como "levantado" */

  --scrim: rgba(3,6,10,0.72);  /* backdrop único, sin blur por defecto */
}
```

Light mode invierte la jerarquía de señales: la sombra vuelve a ser primaria y el borde baja a 1 px al 6% de negro.

## 3.3 Qué señal usar y cuándo (la regla que falta)

| Nivel | Qué vive ahí | Superficie | Borde | Sombra | Filo |
|---|---|---|---|---|---|
| **L0** página | `.eco-page` | `--surface-0` | — | — | — |
| **L1** contenedor | `.card`, `KpiCard`, tile de treemap, celda de calendario | `--surface-1` | `--border-1` | **nunca** | — |
| **L2** dentro de L1 | `.card-hd`, panel anidado, fila `:hover`, insight box, histograma | `--surface-2` | `--border-2` | **nunca** | — |
| **L2-inset** | `.bar-track`, `.narrative-bar-track`, input dentro de card, well | `--surface-sunken` | `--border-1` | **nunca** | — |
| **L3** flotante anclado | popover de fechas, dropdown de filtros, tooltip, `.tweaks-panel` | `--surface-3` | `--border-strong` | `--shadow-pop` | `--highlight-top` |
| **L4** overlay modal | modal, drawer, `.spotlight`, sheet, chat drawer | `--surface-overlay` | `--border-strong` | `--shadow-overlay` | `--highlight-top` |
| **sticky** | header al hacer scroll (`scrollTop>0`) | `--surface-1` | `--border-1` | `--shadow-sticky` | — |

Tres reglas duras:

1. **La sombra nunca separa dos superficies estáticas.** Si dos cosas están en el flujo, se separan por superficie + borde. Esto retira `box-shadow: var(--shadow-sm)` de `.card` (`index.html:360`) y el hover de `KpiCard` (`screens.js:86-87`) — que se reemplaza por `background: var(--surface-2); border-color: var(--border-strong)`, una señal que en dark **sí** se ve.
2. **Un overlay nunca comparte superficie con lo que tapa.** Hoy `.spotlight`, `.drawer`, `.chat-drawer` y los 3 modales usan `var(--canvas)` — exactamente el mismo valor que las cards de detrás (`index.html:534,556,570`; `shell.js:1213,1620`; `screens.js:3272`). Con la rampa, `--surface-overlay` queda 1.109:1 por encima.
3. **Ningún hijo es más oscuro que su padre salvo que sea un `well` declarado.** Esto arregla el "agujero en la card": los ~23 usos de `background:'var(--canvas-2)'` en `screens.js` se reparten entre `--surface-2` (panel elevado) y `--surface-sunken` (track/well) — hoy `--canvas-2` sirve ambos roles y por eso los dos se ven mal.

## 3.4 Mapa de tokens viejos → nuevos

| Viejo | Usos | → Nuevo |
|---|---:|---|
| `--bg` | página, `.eco-app` | `--surface-0` |
| `--bg-2` | 0 usos reales en la SPA | **eliminar** |
| `--canvas` en `.card` | 69 | `--surface-1` |
| `--canvas` en overlays | 6 | `--surface-overlay` |
| `--canvas-2` como panel/hover | ~14 | `--surface-2` |
| `--canvas-2` como track/well | ~9 | `--surface-sunken` |
| `--hairline` | ~120 | `--border-1` / `--border-2` según nivel |
| `--hairline-strong` | 18 | `--border-strong` |
| `--shadow-sm` | 1 (`.card`) | **eliminar** |
| `--shadow` | 0 usos | **eliminar** |
| 8 sombras inline + 9 CSS | 17 | `--shadow-pop` / `--shadow-overlay` / `--shadow-sticky` |
| 4 backdrops (`rgba(11,26,38,.4)`, `rgba(0,0,0,.4)`, `rgba(0,0,0,.5)`, blur 0/2/4) | 5 | `--scrim`, sin blur |

## 3.5 Escala de z-index

Hoy: 50, 80, 90, 100, 120, 400, 1000, 1999, 2000, 2001, 2040, 2050, 2100, 2200, 2500 — 14 valores, con el chat (1999) *por debajo* del backdrop de drawer (2000) y el toast global (2500) por encima de todo por accidente.

```css
:root {
  --z-base: 0; --z-sticky: 100; --z-map: 400;   /* Leaflet llega a 1000 */
  --z-pop: 1100; --z-overlay: 1200; --z-modal: 1300; --z-toast: 1400;
}
```

---

# 4. Ritmo vertical de página y cabecera

## 4.1 Medición del cromo (capturas reales)

| Captura | Filas del header | Alto header | Preámbulo de página | **Primer píxel de dato** | % de un fold de 844 px |
|---|---:|---:|---:|---:|---:|
| `overview-desktop-fold` | 2 | 112 | 116 | **228** | — |
| `dashboard-desktop-fold` | 2 | 137 | 74 | **211** | — |
| `overview-mobile-fold` | **5** | **284** | 139 | **423** | 50% |
| `dashboard-mobile-fold` | **5** | **306** | 16 | **322** | 38% |

Desglose analítico del header (`shell.js:396-552`, `padding:'14px 28px'`, `gap:12`, `flexWrap:'wrap'`):

- **Escritorio, fila 1** = bloque de título (43 px; 57 px si el eyebrow envuelve, como en Scorecard) + search + agencia + bolsa de periodos + Fechas + Chat.
- **Escritorio, fila 2** = **el botón de tema solo** (31 px + 12 de gap = **43 px de alto para un icono de 14 px**). Confirmado en las 4 capturas de escritorio y en las 4 de laptop.
- **Móvil, 5 filas** de alturas 43 / 40 / **55** / 31 / 40. La fila de 55 px es la pill de agencia: `padding:'6px 12px'` (`shell.js:440`) + `select{min-height:40px}` del bump móvil (`index.html:342`) = 52–55 px. Cinco filas, cinco alturas distintas, ninguna igual a 44.

Además el header pinta **dos H1** por pantalla en Overview y Scorecard: `<h1>{title}</h1>` con "Overview" (`shell.js:426`) y el H1 real de la página, "Conversación pública de los últimos 7 días" (`screens.js:4171`). Y en Scorecard el eyebrow dice **"SCORECARD TÁCTICO · TIEMPO REAL"** a 2 px del chip que dice **"DATOS AL CIERRE DE AYER"** (`shell.js:422`) — dos afirmaciones contradictorias sobre la frescura del dato en el mismo bloque de 137 px.

## 4.2 La cabecera propuesta

**Una sola barra sticky de 48 px** (`--h-bar: 48`), controles a `--h-ctl` (32) / `--h-tap` (44) en táctil:

```
[☰ móvil] [ Buscar… ⌘K ]  [ 7D ▾ · datos al cierre de ayer ]  [ 🏛 DDEC ▾ ]  [ ✨ Chat ]  [ ⋯ ]
   44        flex 1, max 420           control único de ventana        32           32      32
```

| Elemento actual | Decisión | Razón |
|---|---|---|
| `eyebrow` ("TEMAS DETECTADOS", "FLUJO DE CONVERSACIÓN", "SCORECARD TÁCTICO · TIEMPO REAL") | **eliminar** | duplica el ítem activo del rail y en Scorecard contradice el chip de frescura |
| `<h1>{title}</h1>` del header | **eliminar** en pantallas con hero propio (Overview, Scorecard); **bajar a la página** como primer elemento en las demás (Menciones, Alertas, Configuración) | hoy son dos H1 y el segundo no aporta nada que el rail no diga |
| "DATOS AL CIERRE DE AYER" | **fusionar** dentro del control de periodo | califica la *ventana*, no la *página*; hoy flota junto al título como si calificara la pantalla |
| Bolsa de periodos (8 chips de 22 px) + botón "Fechas" | **fusionar en un solo control** `<PeriodPicker>`: trigger de 32 px + popover con los 8 presets + "Rango…" | hoy son dos controles adyacentes que hacen lo mismo con dos formas distintas; libera ~180 px horizontales y elimina 8 targets de 22 px |
| Botón de tema (fila propia) | **eliminar del header** → ya existe en `TweaksPanel` "Modo" (`shell.js:1097-1114`) y en ⌘K (`shell.js:601-602`); accesible desde `⋯` | 43 px verticales × 10 pantallas × 4 viewports para una acción mensual y duplicada |
| Search | queda, `flex:1 1 240px; max-width:420px` | |
| Agencia, Chat | quedan a 32 px | |
| `⋯` (nuevo) | Tweaks · Densidad · Exportar · Salir | |

**Móvil**: dos filas de 44 px → `☰ · [título compacto 14 px del nav activo] · 🔍 · ⋯` / `[periodo scroll-x] · [agencia]`. Total ≈ **112 px** (era 284–306).

**Resultado**

| | Hoy | Propuesta | Δ |
|---|---:|---:|---:|
| Header desktop | 112–137 | **48** | −64 a −89 px |
| Primer dato desktop | 228 | **139** | **−39%** |
| Header móvil | 284–306 | **112** | −172 a −194 px |
| Primer dato móvil | 322–423 | **216** | **−33 a −49%** |
| Targets <44 px en el header móvil | 12 | **0** | |

⚠️ Acoplamiento a romper: `index.html:732` y `:742` hardcodean `calc(100vh - 140px)` para `.narrative-screen` y `.narrative-menu` — es la altura del header adivinada. Sustituir por `calc(100vh - var(--h-bar) - var(--pad-page-y) * 2)`.

## 4.3 Ritmo entre secciones

Hoy `.eco-page { gap: 16px }` (`index.html:288`) aplica **el mismo espacio** entre secciones de primer nivel que el grid interno entre cards (12 px). Ratio 16:12 = 1.33 → el ojo no puede agrupar. Escala propuesta con ratio 2:1,5:1:

| Relación | Hoy | Propuesta | Token |
|---|---:|---:|---|
| Entre secciones de página | 16 | **24** (20 en móvil) | `--gap-section` |
| Entre cards de una sección | 12 | 12 | `--gap-card` |
| Entre etiqueta de sección y su primera card | 8 | 8 | `--gap-item` |
| Entre bloques dentro de una card | 10–16 | 16 | `--gap-block` |

Y un refuerzo no-espacial para el primer nivel: la etiqueta de sección lleva una regla izquierda de 2 px (`--border-strong`), lo que hace la agrupación legible incluso cuando el contraste de superficie es bajo.

## 4.4 Veredicto sobre los eyebrows numerados "01 ·" … "05 ·"

**Son ruido tal como están implementados.** Tres razones, todas verificables:

1. **Los cinco números se pintan en tres estilos tipográficos distintos**, así que no se leen como una secuencia:
   - `01 ·` → `.section-eyebrow` (`screens.js:4196`): 10 px / 700 / `--text-3` / ls 0.14em
   - `02 ·` → div inline **dentro** de la card (`screens.js:4283`): 11 px / 600 / `--text-2` / ls 0.08em
   - `03 ·`, `04 ·` → `.card-hd-title` (`screens.js:4334,4378`): 12 px / 600 / `--text-2` / ls 0.08em
   - `05 ·` → `.section-eyebrow` otra vez (`screens.js:4520`)

   Visible en `overview-desktop-fold.png`: "01 · TERMÓMETRO" y "05 · INSIGHTS" son notablemente más pequeños y apagados que "03 · TENDENCIA", y "02" ni siquiera está en el nivel de página.
2. **Nadie referencia las secciones por número.** No hay índice, ni anclas, ni exportación paginada, ni el correo diario (que esta pantalla espeja) usa esa numeración. El número no resuelve ninguna tarea del lector.
3. **Ocupan el slot del eyebrow**, que debería llevar el *alcance del dato* ("7 días cerrados · TZ Puerto Rico") — precisamente la información que hoy está mal colocada arriba, junto al título.

**Recomendación:** quitar los dígitos; dejar etiquetas cortas e informativas (`TERMÓMETRO · vs ventana previa`), y expresar el orden con espacio (`--gap-section` 24 px) + la regla izquierda. Si el cliente exige conservar la numeración porque el informe se lee en voz alta en reuniones, entonces **un solo estilo** renderizado por `<SectionHeader step={1}>`, con el dígito en `--text-3` y tabular, nunca dentro de la card.

---

# 5. Inventario de primitivas

## 5.1 Lo que existe

| Primitiva | Definida en | Usos | Variantes ad-hoc que deberían ser props | Veredicto |
|---|---|---:|---|---|
| `.card` | `index.html:356` (+366,367 overrides) | 69 | **9 paddings inline** (0,12,14,16,18,20,24,28,40) que puentean `.card-bd`; `overflow:hidden` ×2; `position:absolute` como popover ×2 | `pad`, `flush`, `as` |
| `.card-hd` / `-title` / `-sub` | `index.html:369-380` | 32/32/31 | consistente; padding asimétrico (§1.5) | conservar dentro de `<Card header>` |
| `.card-bd` | `index.html:381` | 23 | 3 paddings inline (20,24,40) | `pad` |
| `.card-bd-flush` | `index.html:382` | **0** | — | **muerta, eliminar** |
| `.pill` + `-pos/-neg/-neu/-warn/-info/-unknown` | `index.html:385-421` | 6 directos + 42 por template | `justifySelf:'start'` ×1 (`shell.js:1390`), `fontSize:9` ×1, override completo de bg/border ×1 (`shell.js:946`) | **bug de blockificación** (P-02); añadir `size`, `tone`, `block` |
| `.chip` | `index.html:424-437` | 14 | usada como **tab** (`screens.js:3125-3132`), como **filtro**, como **botón "Recargar"** (`screens.js:3055`) y con `fontSize:10, padding:'3px 8px'` inline | separar `<Tabs>` de `<FilterChip>` |
| `.btn` / `.btn-primary` | `index.html:440-455` | 29/10 | 8 `fontSize` inline; `flex:1` ×3; `opacity` manual para disabled ×2 | `size`, `variant`, `block`, `loading`, `disabled` |
| `.btn-chip` | `index.html:763-787` | 2 | duplica `.chip` con otro radio/alto/estado disabled | **fusionar con `.chip`** |
| `.input` | `index.html:458-470` | 19 | 6 overrides de `fontSize`/`padding`; **sin override de radio en mando** (10 px junto a botones de 4 px) | `size`, `invalid`, `prefix/suffix` |
| `.section-eyebrow` | `index.html:473` | **56** | **5 `marginBottom` distintos** (0×2, 4×1, 6×2, 8×12, 10×12) → la primitiva no posee su espaciado | `<SectionHeader>` con gap propio |
| `.num` / `.mono` / `.kbd` | `index.html:244-252` | 62/21/5 | ok | conservar |
| `.skeleton` | `index.html:488` | 6 | alturas 14 inline ×3 | `<Skeleton lines w>` |
| `.tt[data-tooltip]` | `index.html:496-513` | **0** | — | **muerta**; el trabajo lo hacen 34 `title=` nativos |
| `.row-hover` | `index.html:516` | 20 | `background: var(--canvas-2)` → con la rampa pasa a `--surface-2` | conservar |
| `.spotlight` + backdrop | `index.html:520-543` | 1 | — | absorber en `<Overlay variant="command">` |
| `.drawer` + backdrop | `index.html:546-562` | 2 (`MentionDrawer`, `UserDrawer`) | **sin radio ni sombra**; header `'18px 24px'` copiado verbatim en ambos | `<Overlay variant="drawer">` + `<OverlayHeader>` |
| `.chat-drawer` y 9 clases `.chat-*` | `index.html:566-641` | 1 pantalla | radios 10/12/999, paddings propios, `z-index:1999` **por debajo** del backdrop de drawer | reescribir sobre `<Overlay>` |
| `.tweaks-panel` | `index.html:644` | 1 | — | `<Overlay variant="panel">` |
| `.bar-track` | `index.html:663` | **2** | **9 reimplementaciones inline** (h 4/6/8/10; r 1/2/3/4/5/999/inherit) en `screens.js:1873,3377,3391`; `shell.js:1315,1744`; `charts.js:607`; `.narrative-bar-track`; `.narrative-sentiment-bar` | `<Meter>` |
| `.dot` | `index.html:668` | 19 | 12 dots inline con `width/height/borderRadius:'50%'` propios | `size`, `tone` |
| `.ticker` / `.pulse` / `.ring-pulse` | `index.html:671-688` | 2/2/**0** | `ring-pulse` muerta; `ticker` = 60 s infinita | ver §6 |
| `.hr` / `.link` | `index.html:656-660` | 1/1 | 3 links inline con `color:var(--accent)` a mano | `<Link>` |
| `.narrative-*` (52 clases) | `index.html:726-1354` | 1 pantalla | **familia paralela completa**: su propio `Panel`, `Empty`, `Tag`, `Metric`, `Drawer`, `BarList`, `Dot`, `Search` | migrar a las primitivas globales; borra ~430 líneas de CSS |
| `KpiCard` | `screens.js:67` | ~12 | `padding:18`, hover con sombra invisible | → `<Metric>` |
| `QuickMetric` | `screens.js:1008` | 5 | `padding:16`, hover con `background` | → `<Metric>` |
| `StatBox` | `screens.js:2436` | 4 | sin padding, label 10/700/0.1em | → `<Metric size="sm">` |
| `DeltaBadge` | `screens.js:46` | 3 | bien hecha, no exportada | exportar |
| `Field` | `screens.js:3997` | 5 | label 10/700/0.1em (6.º estilo de micro-etiqueta) | exportar + `hint`/`error` |
| `Pagination` | `screens.js:1036` | 2 | bien hecha, no exportada | exportar |
| `ExecStateWrap` | `screens.js:5517` | 3 (sólo exec) | es un `<State>` a medias, con `padding:24` | → `<State>` |
| `SentimentSplitBar` | `screens.js:5563` | 2 | `height=6` | → `<Meter segments>` |
| `ViewToggle` / `SortChips` / `SourceSelect` | `screens.js:745,763,737` | 1 c/u | tres formas distintas de "elegir uno de N" | → `<SegmentedControl>` |
| `ToastHost` | `app.js:34` | global | **duplicado**: toast inline propio en `AlertsScreen` (`screens.js:3187-3199`) con otra sombra y otro z-index (2200 vs 2500) | un solo host |
| AntD (`ecoTheme`) | `apps/web/src/theme/eco-theme.ts` | páginas Next | **segunda gramática entera**: paleta teal #0A7EA4 en modo **claro**, radios 6/8/14, `controlHeight` 28/36/40, sus propias sombras; embebida en **iframe de 1200 px fijos** dentro de una card oscura (`screens.js:3046`) | mapear tokens AntD a los del SPA o sacar el form del iframe |

## 5.2 Primitivas AUSENTES que el código reinventa cada vez

| Ausente | Qué se reinventa hoy | Evidencia |
|---|---|---|
| **Overlay / Modal / Drawer / Popover / Sheet** | 3 modales centrados copiados carácter por carácter (`position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:min(Npx,94vw); maxHeight:88vh; borderRadius:12; boxShadow:'0 24px 60px rgba(0,0,0,0.28)'`) ; 3 drawers; 3 popovers; 4 backdrops distintos; 5 listeners de `Escape` idénticos; **ningún** scroll-lock ni focus-trap | `shell.js:1210-1217`, `shell.js:1617-1624`, `screens.js:3269-3275`; `index.html:520,546,1230`; `shell.js:491` |
| **Tabla de datos** | **13 plantillas distintas** de `gridTemplateColumns` con columnas fijas en 18 usos; el header de columnas, el `borderTop` entre filas, el hover y el `overflow:hidden + textOverflow` se reescriben en cada pantalla | `screens.js:1199,3419`; `shell.js:1377`; `MentionsTable`, `UsersAdmin`, `AlertsHistory`, `TablaScreen` |
| **EmptyState / Loading / Error (`<State>`)** | **24 bloques inline** con la firma `padding:N, textAlign:'center', color:'var(--text-3)', fontSize:13` en **tres tamaños** (16 ×2, 24 ×9, 40 ×13) + 4 clases `.narrative-empty*` con un 4.º y 5.º tamaño (`80px 24px`, `16px`) + `ExecStateWrap`. Y hay cards que **no tienen ninguno**: "Activaciones por día" pinta 110 px vacíos | `screens.js:982,988,1476,1479,1485,2349,2390,2411,2414,2462,3346,3349,3788,4051,4059,4325,4353,5520,5528,5542`; `index.html:853,866,874` |
| **MetricValue (`<Metric>`)** | **8 implementaciones** del rol "etiqueta + número grande": `KpiCard` (18 pad), `QuickMetric` (16), `StatBox` (0), `.narrative-metric` (CSS), termómetro inline (`screens.js:4228`), crisis card inline (`screens.js:4288`), `MetricInsightModal` (`shell.js:1644`), grid de métricas del drawer (`shell.js:885`). Ocho `fontSize:30` con cuatro `lineHeight` distintos (1, 1.1, 1.2, ninguno) | confirma y explica F12 |
| **Tooltip** | **3 mecanismos**: `.tt[data-tooltip]` (definida, **0 usos**), 34 `title=` nativos (invisibles en táctil, 1–2 s de delay, sin estilo), 2 tooltips SVG a mano (`charts.js:389,548` con `rx=6`, padding propio), + `.eco-map-tooltip` de Leaflet con un 4.º estilo | `index.html:496,695`; `charts.js:389,548` |
| **Meter / Bar** | 9 barras con 4 alturas y 7 radios (§5.1) | `screens.js:1873,3377,3391`; `shell.js:1315,1744`; `charts.js:607`; `index.html:1039,1095` |
| **SectionHeader** | **6 estilos** para la misma micro-etiqueta mayúscula: `.section-eyebrow` 10/700/`text-3`/0.14em · `.card-hd-title` 12/600/`text-2`/0.08em · label de `KpiCard` 11/600/`text-2`/0.08em · `StatBox`/`Field` 10/700/`text-3`/0.1em · `.narrative-panel-label` 10/`text-3`/0.08em · `.narrative-metric-label` 9.5/`text-3`/0.08em | `index.html:378,473,955,1032`; `screens.js:91,2438,4000` |
| **Tabs** | Los tabs de Alertas son `.chip` con `active` pintado en `--accent`, es decir **idéntico al botón primario "Nueva regla"** que está en la misma fila (visible en `alerts-desktop-fold.png`) | `screens.js:3125-3132`; `index.html:437,453` |
| **Switch** | Toggle a mano: track 28×16, knob 12, `transition:'all 0.2s'` animando **`left`** (propiedad de layout) | `screens.js:3154-3155` |
| **SegmentedControl** | 5 implementaciones: bolsa de periodos (`shell.js:452`), `ViewToggle`, `SortChips`, modo en Tweaks (`shell.js:1099`), densidad en Tweaks (`shell.js:1117`) | `shell.js:452,1099,1117`; `screens.js:745,763` |
| **Surface** | ~23 `background:'var(--canvas-2)' + border + borderRadius` inline haciendo de "panel" | `screens.js` passim |
| **Badge (numérico)** | badge del rail (`shell.js:169`), contadores de nav, `+N` de subtópicos, `narrative-tag-mini` | `shell.js:169`; `shell.js:1402`; `index.html:939` |
| **Toast** | 2 hosts (`app.js:47` z2500 / `screens.js:3187` z2200) con sombras distintas | `app.js:47`; `screens.js:3187` |
| **Link** | `.link` (1 uso) vs 3 `color:'var(--accent)'` inline | `index.html:656` |

## 5.3 Lista mínima a crear, con API

**Bloque 1 — desbloquea todo lo demás (P0)**

```ts
<Surface level={0|1|2|3} inset?  as?  pad?  radius?  children/>
<Card pad="none|sm|md|lg"  header?  subtitle?  actions?  flush?  onClick?  children/>
<State kind="loading|empty|error|forbidden"  size="sm|md|lg"
       title  detail?  action?  icon?/>            // 1 sola firma para los 29 bloques
<SectionHeader label  sub?  step?  actions?  rule?/>   // dueña de su marginBottom
<Metric label  word?  value  tone?  delta?  sub?  spark?
        size="sm|md|lg"  onClick?  hint?/>          // reemplaza las 8
```

**Bloque 2 — corrige comportamiento, no sólo estilo (P1)**

```ts
<Overlay variant="modal|drawer|sheet|popover|command"
         size="sm|md|lg"  anchor?  open  onClose
         header?  footer?  children/>
// dueña de: scrim único, z tokenizado, focus-trap, Escape, scroll-lock,
// aria-modal, restore-focus, y la animación de entrada/salida.
<DataTable columns={[{key,header,width,align,render,sticky?}]}
           rows  onRowClick?  dense?  empty  loading?  error?/>
<Tooltip content  placement?  delay?  children/>     // reemplaza .tt + 34 title=
<Pill tone="pos|neg|neu|warn|info|unknown"  size="sm|md"  block?  children/>
<Meter value  max?  segments?  height="xs|sm|md"  tone?  inset/>
<Tabs items  value  onChange  variant="underline|segmented"/>
```

**Bloque 3 — cierra el sistema (P2)**

```ts
<Field label  hint?  error?  required?  children/>   // ya existe local: exportar
<Switch checked  onChange  label/>                    // transform, no left
<SegmentedControl options  value  onChange  size?/>
<Badge value  tone?  max?/>   <Skeleton lines?  w?/>   <Link/>
<Pagination/>                                         // ya existe: exportar
<Toast/>                                              // un solo host
```

---

# 6. Movimiento

## 6.1 El estado actual

- **11 duraciones**: 0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.26, 0.28, 0.3, 0.6, 1.4/1.6/2/60 s.
- **6 easings**: `var(--ease)` = `cubic-bezier(0.22,1,0.36,1)`, `ease`, `linear`, `ease-in-out`, `ease-out`, y el default implícito.
- **`prefers-reduced-motion`: 0 reglas en TODO el repo** (`index.html`, los 5 JS de la SPA, y `apps/web/src/app/globals.css`).
- **5 animaciones infinitas**: `shimmer 1.6s` (`index.html:491`), `pulse 2s` (`:679`), `ringPulse 1.6s` (`:687`, **0 usos**), `tickerRun 60s linear` (`:672`), `fadeIn 0.6s infinite alternate` en el cursor de streaming del chat (`chat-drawer.js:95`), + `pulse 1.4s` inline (`screens.js:2322`).
- **Dos animaciones de propiedades de layout**: `transition:'all 0.2s'` sobre `left` en el switch (`screens.js:3154-3155`) y `padding-right 0.28s` sobre el grid raíz al abrir el chat (`index.html:581` — esta última es intencional y shipeada en PR #87, se conserva).
- **`HBarList` anima `width 0.3s var(--ease)` en cada render** (`charts.js:627`) y lo mismo `screens.js:1879`.

## 6.2 Los tokens

```css
:root {
  --dur-1: 80ms;   /* press/hover de controles pequeños */
  --dur-2: 140ms;  /* color, borde, fondo, opacidad de estado */
  --dur-3: 200ms;  /* popover, tooltip, fade de overlay */
  --dur-4: 280ms;  /* drawer, sheet, reflow del chat */
  --ease-out:  cubic-bezier(0.2, 0, 0, 1);      /* entradas */
  --ease-in:   cubic-bezier(0.4, 0, 1, 1);      /* salidas */
  --ease-std:  cubic-bezier(0.2, 0, 0.2, 1);    /* cambios de estado */
  --ease-emph: cubic-bezier(0.22, 1, 0.36, 1);  /* = --ease actual; SOLO drawer/sheet */
}
```

| Duración vieja | Usos | → Token |
|---|---|---|
| 0.1 / 0.12 | 4 | `--dur-1` |
| 0.15 | 5 | `--dur-2` |
| 0.18 / 0.2 / 0.22 | 8 | `--dur-3` |
| 0.26 / 0.28 / 0.3 | 6 | `--dur-4` |
| `ease` / `ease-in-out` / `ease-out` / default | 6 | `--ease-std` |
| `var(--ease)` | 22 | `--ease-out` (o `--ease-emph` en drawer) |

## 6.3 Las reglas

**Anima**: `opacity`, `transform` (translate/scale/rotate), `background-color`, `border-color`, `color`, `box-shadow`, `backdrop-filter`.

**No anima nunca**: `width`/`height`/`top`/`left`/`margin`/`padding` (excepción única y documentada: `--chat-w` en `index.html:581`), **ni la geometría de una gráfica ante un cambio de datos**. El `transition: width 0.3s` de `charts.js:627` y `screens.js:1879` debe gatearse a "el valor cambió dentro del mismo periodo" (por ejemplo, hover/filtro en cliente) y **desactivarse en el remonte por cambio de periodo o agencia** — hoy, al pulsar "30D", las barras se deslizan desde el valor anterior y eso se lee como *el dato evolucionando*, cuando es otro dato distinto.

**El motion nunca es la única señal de estado**: hay que aparearlo con superficie, borde o texto. Esto ya es obligatorio en dark porque las sombras no leen (§3.1).

## 6.4 El bloque que falta

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  /* las 5 infinitas necesitan un estado terminal legible, no sólo duración 1ms */
  .skeleton  { animation: none; background: var(--surface-sunken); }
  .pulse     { animation: none; opacity: 1; }
  .ring-pulse{ animation: none; box-shadow: 0 0 0 2px var(--neg); }
  .ticker-inner { animation: none; }
  .ticker    { overflow-x: auto; }        /* el contenido sigue siendo alcanzable */
  .chat-cursor  { animation: none; opacity: 1; }
}
```

Nota aparte: `ticker 60s linear infinite` es una marquesina de noticias en un panel de gobierno. Aun con `reduced-motion` resuelto, el movimiento continuo en periferia compite con la lectura de cifras. Recomiendo reemplazarla por rotación discreta cada 6 s con crossfade `--dur-3`, o por una lista estática de 3 ítems — pero eso es decisión de producto, no de tokens.

---

# 7. Orden de implementación

| # | Paso | Archivos | Desbloquea |
|---|---|---|---|
| 1 | Declarar los tokens (`--sp-*`, `--r-*`, `--surface-*`, `--border-*`, `--shadow-*`, `--dur-*`, `--ease-*`, `--h-*`, `--z-*`) y el bloque `reduced-motion` | `index.html:14-26` + los 6 bloques de tema | todo |
| 2 | Rampa de superficies + retirar `box-shadow` de `.card` + reemplazar el hover de `KpiCard` | `index.html:188-217,356-365`; `screens.js:86-87` | arregla el "agujero en la card" y el hover fantasma |
| 3 | Redefinir los 5 radios por tema y borrar los 13 overrides | `index.html:366,367,396,397,432,433,450,451,468,542,543,664,665` | coherencia del header |
| 4 | `<State>` + reemplazar los 24 bloques y las 4 clases `narrative-empty*`; **añadir estado a "Activaciones por día"** | `screens.js` (20 sitios), `index.html:853-880` | quita la lectura falsa de "cero" |
| 5 | `<Overlay>` + migrar 3 modales, 3 drawers, 3 popovers, spotlight, chat, tweaks | `shell.js:1210,1617`; `screens.js:3269`; `index.html:520-653` | scroll-lock, focus-trap, z coherente |
| 6 | Cabecera nueva (48 px) + `<PeriodPicker>`; quitar eyebrow, 2.º H1 y botón de tema; arreglar `calc(100vh-140px)` | `shell.js:396-552`; `index.html:732,742` | −89/−194 px de cromo |
| 7 | `<Metric>` + `<SectionHeader>` + `<Meter>` + `<Pill>`; borrar `KpiCard`/`QuickMetric`/`StatBox` | `screens.js:46-130,1008,2436` | cierra F12 y el bug de la pill en grid |
| 8 | `<DataTable>` + migrar las 13 plantillas | `screens.js:1199,3419`; `shell.js:1377` | densidad y sticky header consistentes |
| 9 | `<Tabs>`, `<Switch>`, `<SegmentedControl>`, `<Tooltip>`; un solo `Toast`; exportar `Field`/`Pagination`/`DeltaBadge` | `screens.js:3125,3154,3187`; `index.html:496` | |
| 10 | Migrar las 52 clases `.narrative-*` a las primitivas globales | `index.html:726-1354` | −430 líneas de CSS |
| 11 | Alinear los tokens de AntD (`radius` 4/6/10, `controlHeight` 28/32/40) y sacar `/settings/reports` del iframe de 1200 px | `apps/web/src/theme/eco-theme.ts`; `screens.js:3046` | una sola gramática |



---

