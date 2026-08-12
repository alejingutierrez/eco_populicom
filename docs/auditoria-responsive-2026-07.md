# Auditoría de responsividad — Sitio ECO (SPA + Next.js)

> **Fecha:** 2026-07-22 · **Alcance:** todo el sitio (dashboard SPA de 10 rutas + páginas Next.js) · **Objetivo:** volver el sitio *full responsive* (teléfono ~375px, tablet ~768px, escritorio).

> **Método:** auditoría estática exhaustiva de 15 unidades de UI (fan-out de 15 agentes + síntesis) corroborada en vivo contra un build real servido con datos semilla (harness de fixtures `/api/*`).


## Resumen de hallazgos

**168 hallazgos** en 15 unidades.


| Severidad | Cantidad | Significado |
|---|---:|---|
| 🔴 P0 | 28 | Rompe el layout: contenido recortado/inaccesible o scroll horizontal del contenido principal |
| 🟠 P1 | 73 | Usable pero degradado: apretado, desbordado o mal reflowdo |
| 🟡 P2 | 67 | Pulido: áreas táctiles, tipografía, detalles |
| **Total** | **168** | |

### Por breakpoint afectado

| Breakpoint | Hallazgos |
|---|---:|
| Móvil | 112 |
| Tablet | 5 |
| Móvil+Tablet | 51 |

### Por categoría de defecto

| Categoría | Hallazgos |
|---|---:|
| Grid de columnas fijas (`fixed-grid`) | 36 |
| Área táctil <44px (`touch-target`) | 26 |
| Desbordamiento horizontal (`horizontal-overflow`) | 24 |
| Alto fijo en px (`fixed-height`) | 14 |
| Escalado de gráfica (`chart-scale`) | 13 |
| Espaciado/padding fijo (`spacing`) | 10 |
| Tabla se desborda (`table-overflow`) | 9 |
| Scroll-guard (min-width) (`scroll-guard`) | 8 |
| Panel de ancho fijo (`fixed-width-panel`) | 8 |
| Sin breakpoint/hook (`no-breakpoint`) | 7 |
| Posición absoluta (`absolute-pos`) | 6 |
| Tipografía no fluida (`font-scale`) | 5 |
| Escalado de mapa (`map-scale`) | 2 |

### Por pantalla / unidad

| Unidad | P0 | P1 | P2 | Total |
|---|---:|---:|---:|---:|
| Fundación del SPA — index.html + app.js | 3 | 4 | 5 | 12 |
| Marco de la app — Sidebar + Header | 3 | 5 | 3 | 11 |
| Overlays / drawers / modales | 0 | 3 | 8 | 11 |
| Pantalla Overview (landing) | 1 | 3 | 3 | 7 |
| Pantalla Dashboard / Scorecard | 5 | 2 | 3 | 10 |
| Pantalla Menciones | 3 | 3 | 5 | 11 |
| Pantalla Sentimiento | 1 | 6 | 2 | 9 |
| Pantalla Tópicos | 1 | 9 | 4 | 14 |
| Pantalla Geografía (mapa) | 2 | 0 | 5 | 7 |
| Pantalla Alertas | 3 | 8 | 3 | 14 |
| Pantalla Configuración / Usuarios | 3 | 4 | 5 | 12 |
| Pantalla Narrativas (SPA) | 1 | 8 | 3 | 12 |
| Primitivas de gráficas (charts.js) | 1 | 3 | 12 | 16 |
| Drawer de chat | 0 | 4 | 2 | 6 |
| Páginas Next.js + globals.css | 1 | 11 | 4 | 16 |

---

# ECO Responsive Audit — Consolidated Architecture Report

## 1. Executive summary

The ECO front-end is desktop-only by construction, not by accident. The SPA renders every layout as inline `gridTemplateColumns`/flex objects, which physically cannot carry `@media` queries, and the one global stylesheet block in `index.html` expresses responsiveness through exactly one real breakpoint (`max-width:768px`) plus two `min-width` "scroll guards" that force the content column to 900px/1120px. The Next.js pages are the same story with a different coat of paint: inline flex rows over Ant Design, and a `globals.css` with **zero** `@media` rules. The net effect is that today nothing reflows — it only squeezes until the `.eco-main{overflow-x:auto}` crutch converts every over-wide grid into a body-level horizontal scroll. This already breaks standard 1280px laptops (content region 1060px < the 1120px floor), not just phones.

**The single biggest blocker is the pair of `min-width` scroll guards at `index.html:283-288`.** They must die first, because they mask every downstream fixed-grid defect: as long as `.eco-page` is force-widened, none of the inner grids ever get the chance to reflow, so you cannot even see whether a per-screen fix worked. Removing them is also the highest-risk single change, because it exposes every fixed grid at once — which is why the sequencing in Section 3 pairs the guard removal with the foundation work rather than shipping it alone.

## 2. Architectural strategy (the core decision)

There are three mechanisms available, and the audit findings map cleanly onto which one each class of defect needs. The wrong instinct is to pick one; the right answer is a deliberate blend where the mechanism is chosen by *what kind of change the layout requires*.

### The three mechanisms, judged against this codebase

**Mechanism 1 — Move layouts to CSS classes + `@media` in `index.html`.**
Strength: it is the *only* mechanism that can restructure a layout (stack a row, hide a column, swap `border-left`→`border-top`, turn a rail into a drawer) at a hard breakpoint. Cost: it forces layout out of the co-located inline style object into a distant `<style>` block, which is a real readability/maintenance tax in a 4600-line `screens.js` where everything else is inline. Verdict: **reserve for layouts that must change shape, not just wrap** — the sidebar drawer, data-table→card transforms, sub-44px touch targets, and header/tab-bar wrapping.

**Mechanism 2 — A `useBreakpoint()` JS hook branching inline styles.**
Strength: keeps the branch co-located with the JSX (`bp==='mobile' ? '1fr' : '1.2fr 1fr'`), which fits this codebase's inline idiom better than any other option, and it is the *only* mechanism that can change **JS-controlled geometry** — chart `height` props, Heatmap `cellSize`, Leaflet `fitBounds` padding, the number of x-axis ticks, `Drawer width={520}`. Cost: adds a `matchMedia` listener and re-render; there is currently **no** `matchMedia` anywhere in `app.js`, so this is net-new infrastructure. Verdict: **the workhorse for the SPA's inline grids and for every chart/canvas dimension**, and the driver of the mobile drawer's open/close state.

**Mechanism 3 — Intrinsically-fluid CSS (`flex-wrap`, `auto-fit`/`minmax`, `clamp()`).**
Strength: needs no breakpoint at all, can stay inline (`flexWrap:'wrap'`, `clamp(20px,5vw,26px)`, `repeat(auto-fit,minmax(240px,1fr))` are all valid single CSS values in an inline object), and is the cheapest, lowest-risk fix per defect. Cost: it can only *wrap* or *rebalance*, never restructure, and `auto-fit` throws away intentional emphasis ratios (the 1.3fr hero KPIs, the 1.5fr chart column). Verdict: **the default first reach for card grids, chip rows, button rows, legends, and font/padding scaling** — roughly half the findings collapse to a one-token change here.

### Recommended blend, by defect category

| Defect category | Mechanism | Rationale |
|---|---|---|
| Scroll guards / global overflow | 1 (delete rules) | Pure CSS in the one file that already owns them |
| Sidebar → off-canvas drawer | 1 + 2 | Shape change (CSS) driven by `menuOpen` state (JS) |
| Fixed-grid **card** collections (KPIs, insights, roles, metrics) | 3 | `auto-fit/minmax` reflows 3→2→1 with no JS; use 1 only where emphasis ratios must survive |
| Fixed-grid **data tables/rows** (mentions, users, rules, topic list) | 1 (+2 for data-driven rows) | Must restructure to card-per-row; `@media` or a JS branch, not wrapping |
| Chip/button/legend/action rows | 3 | `flexWrap:'wrap'` inline, zero risk |
| Chart & canvas dimensions (height, cellSize, ticks, viewBox, Leaflet) | 2 (+3 for `clamp`/`aspect-ratio`) | Geometry lives in JS props, unreachable by CSS |
| Touch targets (< 44px chips/toggles/icons) | 1 | Size bumps at `@media` / `@media(pointer:coarse)` |
| Font scaling | 3 | `clamp()` inline, no breakpoint |
| Ant pages (form rows, tables, drawers, headers) | Ant primitives + 1 | `Row/Col xs/sm`, `Space wrap`, `Table scroll={{x}}`, `Grid.useBreakpoint()` |

### Shared primitives to build first (before any per-screen work)

1. **`useBreakpoint()` in `app.js`** — backed by `matchMedia('(max-width:768px)')` and `'(max-width:1024px)'`, returning `'mobile' | 'tablet' | 'desktop'`, re-rendering on change. Passed down to every screen and to `shell.js`. This is the linchpin for Mechanisms 2 and the drawer, and it does not exist today. Mirror it on the Ant side with `Grid.useBreakpoint()` (no new code, built into antd).
2. **Delete the two `.eco-page{min-width:…}` guards** and change `.eco-main{overflow-x:auto}` → `overflow-x:clip` during migration so over-wide content is a *visible* bug, not a silently-scrollable one. Re-introduce `overflow-x:auto` only on individual wide widgets wrapped in their own container.
3. **A small responsive utility layer** in `index.html`'s `<style>` block and in `globals.css`: `.btn-icon{min-width:44px;min-height:44px}`, `.touch-target{min-height:44px}` under `@media(max-width:768px)`, `.eco-form-row{...}` with a stack variant, plus a documented breakpoint set (768 / 1024 / 1120) so every fix uses the same stops. `globals.css` currently has none of this.
4. **A card-per-row table pattern** — one reusable approach (a `.data-row` class that is `display:grid` on desktop and `display:block`/stacked labeled pairs under `@media(max-width:768px)`, or a JS branch for data-driven rows) applied identically to Mentions List, Users table, Alert rules, Topic list, and History. Decide this once; every table finding inherits it.

### Two explicit design decisions

- **Sidebar → off-canvas drawer, not a permanent rail.** The current 56px rail is the worst of both worlds: it eats ~15% of a 375px viewport *and* is unusable, because the CSS forces 56px while the JS `collapsed` prop defaults to `false` and has no `matchMedia` hook — so the full 220px layout renders clipped inside a 56px `overflow:hidden` column with no way to widen it. Fix: at `≤768px` set `.eco-app{grid-template-columns:1fr}`, take `<aside>` out of flow as `position:fixed;transform:translateX(-100%)`, add a hamburger in the Header toggling a `menuOpen` state (`translateX(0)`) plus a tap-to-close backdrop, and render the **expanded** drawer (full labels + badges) so nav is actually usable. Use `100dvh` for the aside height and give the nav region `overflow-y:auto`.
- **Fixed-grid data tables → card-per-row on mobile, horizontal-scroll container as the fallback guard.** The primary content column (the mention title, the topic name, the user name) is exactly what today's fixed px tracks starve to an ellipsis. Card-per-row is the correct UX. Where a table is genuinely tabular and card-per-row is overkill (the 9-column MentionsTable already does this right), keep the `overflow:auto` *inner* container so the scroll is confined to the table, never the page. The rule: **scroll inside the widget, reflow everything else.**

## 3. Phased implementation plan

### P0 — Foundation (no per-screen value yet; unblocks everything)
Order matters: do 1–2 together so the guard removal is immediately backed by a reflow strategy.

- **WS-0.1 Breakpoint primitive** — add `useBreakpoint()` to `app.js` (`App()` at 181-408); thread `bp` into `shell.js` and each screen's props. *Files: `app.js`.*
- **WS-0.2 Kill scroll guards + overflow crutch** — delete `index.html:283-288`; change `.eco-main` overflow to `clip` for migration. *Files: `index.html`.*
- **WS-0.3 Off-canvas sidebar drawer** — `menuOpen` state in `App`, hamburger in `Header`, `.eco-app` single-column + fixed `<aside>` + backdrop at `≤768px`; force expanded render on mobile; `100dvh` + `overflow-y:auto` on nav. *Files: `app.js`, `shell.js` (Sidebar 51 / Header 266), `index.html` (261-295).*
- **WS-0.4 Utility CSS layer + touch primitives** — `.btn-icon`, `.touch-target`, `.card-hd{flex-wrap:wrap}` at breakpoint, documented stops; mirror in `globals.css`. *Files: `index.html`, `globals.css`.*
- **WS-0.5 API-banner dynamic offset** — measure banner height (ResizeObserver) → `--eco-banner-offset` instead of the fixed 40px. *Files: `app.js:605-629`.*

### P1 — Per-screen reflow (the bulk of the visible payoff)
Each screen is independent and can be parallelized once P0 lands. Within each, apply Mechanism 3 first (cheap wraps/auto-fit) then Mechanism 1/2 for the tables.

- **WS-1.1 Overview** (landing — do first): termómetro & insights → `auto-fit/minmax`; topic row → `@media` stack; hero `clamp()`. *`screens.js:3372-3947`.*
- **WS-1.2 Dashboard**: 5-col KPI hero, 2-col briefing, 3-col row-3, 5-col mentions row → CSS class + `@media`; Sparkline & Heatmap fixed px → see WS-2. *`screens.js:1-627`.*
- **WS-1.3 Mentions**: quick-metrics `auto-fit`; List row → JS-branch to `20px 1fr 30px`; sentiment chips & cards `min(100%,300px)`; more-filters popover bottom-sheet. *`screens.js:628-1050`.*
- **WS-1.4 Sentiment**: charts grid `@media` stack at 900; hero & group grids; EmotionsCard ranking row `minmax`; NSS row `flex-wrap`+`clamp`. *`screens.js:1051-1414`.*
- **WS-1.5 Topics**: TopicCalendar `1fr 200px`→stack (worst single grid); treemap 4→2 col + drop 2×2 spans; TopicList/subtopics row restructure; bubbles legend `flex-wrap`. *`screens.js:1415-2131`.*
- **WS-1.6 Geography**: two-col block → `auto-fit/minmax(280px)`; legend `flex-wrap`; card-bd padding `clamp`. *`screens.js:2132-2260`.*
- **WS-1.7 Alerts**: 7-col rules table → card-per-row; tab bar `flex-wrap` + kill `flex:1` spacer; KPI grids `auto-fit`; history rows stack; **iframe auto-height via `postMessage`** (embed already opts in with `?embed=1`). *`screens.js:2266-2822`.*
- **WS-1.8 Settings**: root `220px 1fr`→stack/tab-strip; users table → card-per-row (header+row in sync via JS branch); roles grid `auto-fit`; UserDrawer forms/activity/scope grids. *`screens.js` 2831-3336.*
- **WS-1.9 Narratives (SPA)**: **author the entire missing `.narrative-*` CSS** — grep returns 0 matches; the two-pane never lays out. Write it responsive from the start (flex two-pane → single-pane master-detail at 768, driven by `focthusedId`). *`screens.js:3952-4635`, `index.html` `<style>`.*
- **WS-1.10 Ant pages**: reports/alerts forms → `Row/Col xs/sm`; `Space wrap` on button rows; `Table scroll={{x:'max-content'}}` + `responsive` cols on history; `Drawer width={screens.md?520:'100%'}`; TimelineSlider/CrisisSlider mark density via `Grid.useBreakpoint()`; sign-in wrapper `clamp` padding. *`settings/reports/page.tsx`, `settings/alerts/page.tsx`, `narratives/page.tsx`, `NarrativeDetail.tsx`, `TimelineSlider.tsx`, `(auth)/sign-in/page.tsx`.*

### P2 — Charts, touch, polish
Cross-cutting; mostly Mechanism 2/3 in `charts.js`. Do after P1 so charts reflow into already-fixed containers.

- **WS-2.1 Heatmap** (highest of P2): CSS-grid fluid cells (`grid-template-columns:28px repeat(24,minmax(0,1fr))`, `aspect-ratio:1`) or 12-col 2-hour buckets on mobile; `:active` feedback replacing hover-only; ≥24px effective cells. *`charts.js:599-625`, `screens.js:614`.*
- **WS-2.2 Chart dimensions** — stop hard-coding heights; derive from measured width/`clamp`/breakpoint (AreaLine 180, MultiLine 260, StackedArea 220, PRMap 420); add `viewBox` to Donut/RadialGauge/Sparkline; width-adaptive x-tick density (mirror MultiLine's `floor(innerW/50)`); fix MultiLine right-tag clip (`padding.r≥52`) and tooltip clamp. *`charts.js`.*
- **WS-2.3 Touch targets** — sweep all sub-44px chips/toggles/icon-buttons/page buttons/heatmap cells/HBarList rows via `.touch-target`/`.btn-icon` + `@media`. *`index.html`, `shell.js`, `screens.js`, `charts.js`.*
- **WS-2.4 Chat drawer** — **prerequisite: confirm PR #76 chat CSS is merged into main's `index.html`** (main has zero `.chat-*` rules today). Then: `.chat-del` visible under `@media(hover:none)`; composer `font-size:16px` on mobile (iOS zoom); 44px send/close; scroll-lock on full-screen; raise squeeze breakpoint or rely on the now-removed guard. *`index.html:505-580`, `chat-drawer.js`.*
- **WS-2.5 Fluid polish** — Leaflet `clamp(300px,58vh,460px)` + `invalidateSize()` on resize + narrower `fitBounds` padding; toasts/tweaks-panel/popovers `max-width:calc(100vw-32px)` / bottom-sheet; spotlight `clamp` top offset. Delete `PRMapLegacy` if confirmed unused (not in `window.ECO_CHARTS`).

## 4. Risk & regression notes

- **The three themes (costa / gaceta / mando).** All layout fixes must be theme-agnostic — key on layout variables/hairlines, never hardcode a palette. The riskiest items are the `border-left`→`border-top` swaps (Dashboard Pulso column, TopicCalendar legend, crisis card divider): verify the divider reads correctly *stacked* in all three themes, since a horizontal-only divider becomes wrong when the grid collapses.
- **Dark mode.** Backdrops (sidebar drawer, mobile bottom-sheets, chat overlay) are new surfaces — check contrast and that the new `position:fixed` overlays inherit theme tokens, not defaults.
- **Leaflet.** `invalidateSize()` must fire after any container resize/height change or tiles render half-blank; the drawer becoming full-width on mobile is a resize event the map won't otherwise see. Test the map inside the full-width mobile drawer specifically.
- **The desktop experience (what current users rely on).** Removing the scroll guards is the highest-regression change: any grid not yet made fluid will overflow visibly instead of scrolling. Mitigate by shipping `overflow-x:clip` during migration (bugs become visible, not silent) and by not merging guard-removal until the P1 screen it affects has its reflow. The `auto-fit` option quietly discards intentional emphasis ratios (1.3fr hero KPIs, 1.5fr chart column, treemap 2×2 spans) — for those, use `@media`/JS-branch, not `auto-fit`, or desktop will visibly lose its hierarchy.
- **iframe auto-height (Alerts).** The `postMessage` handshake must be defensive — if the embedded page doesn't post, fall back to a generous fixed height + internal scroll, so a version-skew between the SPA and the embedded Next.js page can't clip the save button.
- **Chat drawer merge state.** Do not write responsive `.chat-*` rules against main — they'll target selectors that don't exist there. Gate WS-2.4 on the PR #76 CSS actually landing in main's `index.html`.

**Verification.** Use the existing `/api/*` fixtures harness (per MEMORY: "harness fixtures /api/* para navegar el SPA sin DB") to mount the **full app in the real `mando` theme** — never an isolated component, which the memory notes is "diseño paralelo que engaña." Drive the browser at **375 / 768 / 1280** (plus a 320px SE pass and the 900–1119px band that the guards specifically broke) against each route. Confirm at every width: no body-level horizontal scrollbar; primary content column (title/name) never ellipsis-collapsed; the sidebar drawer opens/closes with backdrop; charts fill without clipping; 44px targets. Remember the build path (per MEMORY `prototype-build-cachebust`): the SPA is JSX→dist via `compile-prototype.js`, served with a **manual** `?v=prodcNN` bump — increment it or the browser serves stale dist.

## 5. Effort read

| Phase | Size | Notes |
|---|---|---|
| **P0 Foundation** | **M** | Small surface (`app.js`, `shell.js`, `index.html`) but high care: the drawer + breakpoint hook are net-new infra and the guard removal is the highest-blast-radius change. Not large in LOC, large in review risk. |
| **P1 Per-screen** | **L** | The bulk of the work — 10 workstreams across ~4600 lines of `screens.js` plus the Ant pages. Parallelizable after P0. Narratives (WS-1.9) is a mini-project on its own (authoring CSS from scratch) and Settings/Alerts tables are the heaviest sub-items. |
| **P2 Charts + polish** | **M** | Concentrated in `charts.js` (mechanical once the pattern is set) plus a wide-but-shallow touch-target sweep. Chat drawer (WS-2.4) is blocked on a merge, not on effort. |

Rough shape: P0 is the gate, P1 is ~60% of total effort and where users see the change, P2 is finishing work that is individually small but numerous. Recommend shipping P0 + WS-1.1 (Overview, the landing route) as the first visible milestone.


---

## Apéndice — Catálogo completo de hallazgos

Agrupados por unidad, ordenados por severidad. Cada hallazgo cita la ubicación exacta en el código.


### Fundación del SPA — index.html + app.js
<sub>SPA layout foundation — index.html <style> block + app.js root skeleton</sub>

*12 hallazgos — P0:3 · P1:4 · P2:5*


**1. 🔴 P0 · .eco-page scroll guard (1120px)** <sub>`scroll-guard` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:286-288 @media(min-width:1120px) .eco-page{min-width:1120px}`
- **Problema:** Forces the content column to be at least 1120px wide whenever the viewport is >=1120px. Because the sidebar eats 220px (expanded), the content region only reaches 1120px at a viewport of ~1340px, so EVERY viewport from 1120px up to ~1339px — including the extremely common 1280px laptop with the sidebar expanded (content region = 1280-220 = 1060 < 1120) — overflows and scrolls horizontally via .eco-main. This is not a mobile-only bug; it breaks standard desktop laptops.
- **Evidencia:** `@media (min-width: 1120px) { .eco-page { min-width: 1120px; } }`
- **Arreglo:** Remove the min-width guard entirely (mechanism 3: intrinsically-fluid CSS). The page column must be allowed to be narrower than 1120px; the inner content grids in screens.js should reflow via grid-template-columns:repeat(auto-fit,minmax(280px,1fr)) and flex-wrap so they collapse column count as space shrinks instead of relying on a fixed floor. Any element that genuinely cannot shrink (a wide data table, the streamgraph) gets its OWN overflow-x:auto wrapper, not a global one.

**2. 🔴 P0 · .eco-page scroll guard (900px)** <sub>`scroll-guard` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:283-285 @media(min-width:900px) .eco-page{min-width:900px}`
- **Problema:** Forces the content column to a 900px floor at viewports 900–1119px. With the 220px sidebar the available content width at a 900px viewport is only 680px, so the page overflows by ~220px and the user must scroll horizontally to read primary content. This is the exact 'min-width scroll guard' anti-pattern the audit flags as a core defect: it converts a reflow problem into a horizontal-scroll problem across the entire tablet-landscape / small-desktop range.
- **Evidencia:** `@media (min-width: 900px) { .eco-page { min-width: 900px; } }`
- **Arreglo:** Delete this guard. Combine with mechanism 1 (move the per-screen layout grids from inline styles into CSS classes in index.html with @media rules) or mechanism 2 (a useBreakpoint() hook returning mobile|tablet|desktop that branches the inline gridTemplateColumns). The skeleton should never impose a width floor larger than the available column.

**3. 🔴 P0 · .eco-main horizontal-scroll enabler** <sub>`horizontal-overflow` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:269-274 .eco-main{min-width:0; overflow-x:auto}`
- **Problema:** overflow-x:auto on the main column is the mechanism that turns the min-width guards (and any over-wide inline grid in screens.js) into a body-level horizontal scrollbar instead of reflowing. With a correct viewport meta already present (index.html:5), this single rule is what defeats it: the browser is told to render device-width, but .eco-main is allowed to be arbitrarily wider and scroll. It masks every downstream fixed-width defect as 'just scroll'.
- **Evidencia:** `.eco-main { display:flex; flex-direction:column; min-width:0; overflow-x:auto; }`
- **Arreglo:** Change the main column to overflow-x:clip (or visible) so over-wide content is a visible bug during migration rather than silently scrollable, then make each screen's grids fluid (mechanism 3). Keep overflow-x:auto ONLY on individual wide widgets (tables, timeline/streamgraph) wrapped in their own scroll container, never on the whole page column.

**4. 🟠 P1 · .eco-app sidebar grid + missing off-canvas drawer** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `index.html:261-267 .eco-app{grid-template-columns:220px 1fr} / :290-295 @media(max-width:768px){...56px 1fr}`
- **Problema:** On phones the sidebar is forced to a permanent 56px icon rail that is always in the grid flow, so it eats ~15% of a 375px viewport at all times and can never be dismissed — there is no hamburger button and no off-canvas drawer. Full nav labels are unreachable on mobile (only icons). The collapsed toggle exists (keyboard '[' ']' at app.js:322, and setCollapsed) but there is no touch affordance for it and the media query overrides collapsed to 56px regardless.
- **Evidencia:** `.eco-app{grid-template-columns:220px 1fr} ... @media(max-width:768px){ .eco-app{grid-template-columns:56px 1fr} .eco-app[data-collapsed="true"]{grid-template-columns:56px 1fr} }`
- **Arreglo:** Convert to an off-canvas drawer on <=768px (mechanism 1 + 2): at that breakpoint set grid-template-columns:1fr (sidebar leaves the flow), position the Sidebar fixed with transform:translateX(-100%), and add a hamburger button in Header plus a menuOpen useState in App that toggles a .eco-app.menu-open class (translateX(0)) with a tap-to-close backdrop. This reclaims the full width for content and restores full nav labels on phones.

**5. 🟠 P1 · Breakpoint coverage — single 768px cliff** <sub>`no-breakpoint` · Tablet</sub>
- **Ubicación:** `index.html:283-295 (only @media 900 / 1120 / max-768)`
- **Problema:** There is exactly one shrink breakpoint (max-width:768px). Between 769px and 899px the sidebar snaps back to the full 220px (max-width:768 no longer applies and the default is not collapsed), while the min-width:900 guard has not yet kicked in — so a large-phone-landscape / small tablet gets a 220px sidebar plus content grids that still do not reflow, i.e. a cramped fluid squeeze with no column-count reduction. No intermediate breakpoint auto-collapses the rail or drops grid columns for tablets.
- **Evidencia:** `@media(max-width:768px){...} is the only shrink rule; 769-899px falls through to the 220px default sidebar with non-reflowing grids.`
- **Arreglo:** Add intermediate breakpoints (mechanism 1): e.g. auto-collapse the sidebar to 64px at <=1024px, and give the content grids explicit column counts per band (3-up desktop, 2-up tablet, 1-up mobile) via CSS classes with @media, or a useBreakpoint() hook (mechanism 2) that feeds the inline gridTemplateColumns in screens.js. Pair with removing the min-width guards.

**6. 🟠 P1 · App root — no JS breakpoint hook** <sub>`no-breakpoint` · Móvil+Tablet</sub>
- **Ubicación:** `app.js:181-408 App() (no matchMedia / useBreakpoint anywhere)`
- **Problema:** App exposes no viewport-size state — there is no matchMedia listener or useBreakpoint() returning mobile|tablet|desktop. All responsive behavior is delegated to CSS media queries in index.html, but per the architecture the actual content layouts are inline gridTemplateColumns/fixed widths in screens.js which CSS media queries CANNOT touch. Without a JS breakpoint the inline grids can never reflow, and the off-canvas drawer (needed for mobile) has no state to hang off of.
- **Evidencia:** `App() wires theme/mode/collapsed/active/agency state but never reads window.matchMedia; grep of app.js shows no matchMedia and no resize listener.`
- **Arreglo:** Add a useBreakpoint() hook in app.js (mechanism 2): const bp = useBreakpoint() backed by window.matchMedia('(max-width:768px)') and '(max-width:1024px)', re-rendering on change, then pass bp down to screens so they branch inline gridTemplateColumns (e.g. bp==='mobile' ? '1fr' : '1fr 1fr 1fr'). Also drives the mobile menuOpen/off-canvas logic and can auto-set collapsed on small screens.

**7. 🟠 P1 · API failure banner — hardcoded 40px offset** <sub>`absolute-pos` · Móvil</sub>
- **Ubicación:** `app.js:605-629 showApiBanner (627-628 body paddingTop:'40px')`
- **Problema:** The fixed top banner reserves exactly 40px of body padding, but the banner content (long Spanish messages like 'El servidor devolvió 500. Los datos mostrados son un respaldo estático.' plus a 'Reintentar' button, justify-content:center, no white-space control) wraps to 2–3 lines at 375px, making the banner ~70–90px tall. The content below is only pushed down 40px, so the top of the header/page is hidden underneath the wrapped banner on phones.
- **Evidencia:** `document.documentElement.style.setProperty('--eco-banner-offset','40px'); document.body.style.paddingTop = '40px'; — banner uses padding:10px 20px + flex wrap with no fixed height.`
- **Arreglo:** Measure the rendered banner height after append (banner.getBoundingClientRect().height) and set the body padding + --eco-banner-offset from it (mechanism 2: JS measurement), ideally re-measuring on a ResizeObserver so an orientation change or reflow keeps the offset correct. Alternatively cap the message and let it truncate, but dynamic measurement is safer.

**8. 🟡 P2 · .tweaks-panel fixed width** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `index.html:504-513 .tweaks-panel{position:fixed;width:300px;right:16px}`
- **Problema:** Fixed 300px panel pinned bottom-right with no max-width; at 375px it leaves only ~59px of margin and would overlap content/toasts. Latent in production because app.js is the 'production mount (no tweaks panel)' and never renders it — but the CSS still ships and any reuse of the class would break on phones.
- **Evidencia:** `.tweaks-panel { position: fixed; bottom: 16px; right: 16px; width: 300px; ... }`
- **Arreglo:** Add max-width:calc(100vw - 32px) (mechanism 3) so it can never exceed the viewport, and consider a @media(max-width:768px) rule making it a bottom sheet (left:8px;right:8px;width:auto). Low priority while it stays unmounted, but the class should be safe if reused.

**9. 🟡 P2 · Interactive primitives — sub-44px touch targets** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `index.html:245-251 .kbd(18px) / :363-370 .chip(pad 5x10) / :379-390 .btn(pad 7x14)`
- **Problema:** The foundational interactive primitives are all below the 44px minimum touch target and have no mobile override to enlarge them: .kbd is 18px tall, .chip computes to ~24px tall (font 11px + 5px vertical padding), .btn to ~30px (font 13px + 7px padding). Every chip/button built on these across the app is hard to tap on a phone.
- **Evidencia:** `.chip{padding:5px 10px;font-size:11px} .btn{padding:7px 14px;font-size:13px} .kbd{min-width:18px;height:18px}`
- **Arreglo:** Add a @media(max-width:768px) block (mechanism 1) bumping .btn/.chip to min-height:44px and increasing tap padding, or use clamp() on padding so targets grow on small screens. Non-actionable .kbd hints can stay small; actionable chips/buttons must reach 44px.

**10. 🟡 P2 · .card-hd header row — no wrap** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `index.html:308-316 .card-hd{display:flex;justify-content:space-between;gap:12px}`
- **Problema:** Card headers lay out as a single non-wrapping flex row (title block flex:1 + action controls, justify space-between). On narrow phones a long title plus action chips/segmented control on the right have nowhere to go — the title truncates hard against the actions or the actions push out and get clipped, since there is no flex-wrap and no mobile stacking rule.
- **Evidencia:** `.card-hd{padding:14px 16px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px}`
- **Arreglo:** Add flex-wrap:wrap to .card-hd, and in @media(max-width:768px) (mechanism 1) let the actions wrap to a second line (e.g. .card-hd{flex-wrap:wrap} and the actions container gets width:100% / margin-top). Keeps titles and controls fully visible on phones.

**11. 🟡 P2 · .spotlight-backdrop top offset** <sub>`absolute-pos` · Móvil</sub>
- **Ubicación:** `index.html:459-468 .spotlight-backdrop{padding-top:12vh}`
- **Problema:** The command palette is offset 12vh from the top. On a short landscape phone (e.g. 375px tall) that is only ~45px, but combined with the palette's own height and any on-screen keyboard the results list can be pushed below the fold. The .spotlight itself is fine (width:620px;max-width:90vw), so this is purely the vertical placement.
- **Evidencia:** `.spotlight-backdrop{...padding-top:12vh;...}`
- **Arreglo:** Use a smaller/clamped top offset on short viewports, e.g. padding-top:clamp(24px,12vh,120px) (mechanism 3), or a @media(max-height:600px) override reducing it, so the palette stays fully visible on short/landscape phones.

**12. 🟡 P2 · ToastHost container width** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `app.js:44-49 ToastHost({position:fixed;bottom:24;right:24;minWidth:240;maxWidth:420})`
- **Problema:** Toasts are pinned bottom-right with minWidth:240 and right:24; at 375px that is 240+24+24 = 288px which fits, but confirm-toasts add two buttons ('Cancelar' + 'Confirmar') inline with the text, and at 240–300px the text+buttons row gets very cramped. It is inline-styled so it cannot use a media query to widen to near-full-width on phones.
- **Evidencia:** `const base = { ...minWidth:240, maxWidth:420, display:'flex', alignItems:'center', gap:10 }; confirm renders two .btn inline.`
- **Arreglo:** Branch the toast container width on a JS breakpoint (mechanism 2): on mobile use left:12/right:12/width:auto and, for confirm toasts, stack the buttons below the message (flex-direction:column). Alternatively move the toast styles to a CSS class (mechanism 1) so a @media rule can make it full-bleed on phones.

### Marco de la app — Sidebar + Header
<sub>SPA app frame — Sidebar (shell.js:51) & Header (shell.js:266)</sub>

*11 hallazgos — P0:3 · P1:5 · P2:3*


**1. 🔴 P0 · Sidebar** <sub>`no-breakpoint` · Móvil+Tablet</sub>
- **Ubicación:** `shell.js:98 Sidebar <aside> (overflow:hidden) vs index.html:290-292 @media(max-width:768px) + app.js:185 collapsed init`
- **Problema:** The CSS grid and the JS render state are decoupled. At ≤768px `.eco-app` forces the sidebar column to a fixed 56px (index.html:291-292) irrespective of `data-collapsed`, but the Sidebar component renders its expanded 220px layout (logo wordmark+subtitle, ⌘K search button, 'Análisis'/'Sistema' section labels, nav labels+badges, 'Ingesta en vivo' status, user name, 'Colapsar' label) whenever the JS `collapsed` prop is false. `collapsed` defaults to false (app.js:185, from localStorage 'eco.collapsed') and there is NO matchMedia/breakpoint hook to force it true on mobile. Result on a default phone: the full expanded sidebar is squeezed into a 56px column and, because the <aside> has `overflow:'hidden'` (shell.js:98), every label/badge/search/status is clipped and unreachable. Worse, tapping the collapse toggle flips JS state but the CSS column stays 56px, so the user can never widen it back.
- **Evidencia:** `shell.js:98 `height:'100vh', overflow:'hidden'`; index.html:291 `.eco-app{grid-template-columns:56px 1fr}`; index.html:292 `.eco-app[data-collapsed="true"]{grid-template-columns:56px 1fr}`; app.js:185 `useState(()=>localStorage.getItem('eco.collapsed')==='true')` (no matchMedia)`
- **Arreglo:** Add a JS breakpoint hook (mechanism 2): a `useBreakpoint()`/matchMedia('(max-width:768px)') listener in App that forces `collapsed=true` while mobile, so the JS render matches the 56px CSS column. This alone fixes the clip. Preferred (also addresses the next finding): replace the permanent rail on mobile with an off-canvas drawer — render the sidebar as `position:fixed` full-expanded-width overlay + backdrop, hidden by default, toggled by a hamburger, so the 220px expanded layout is actually usable.

**2. 🔴 P0 · Sidebar** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `shell.js:51 Sidebar / app.js:347 .eco-app grid`
- **Problema:** There is no hamburger or off-canvas drawer. Even in its intended collapsed form the sidebar is a permanent 56px icon rail (index.html:291) that consumes ~15% of a 375px viewport (~19% of a 320px SE) at all times, and the content grids beside it never reflow. On phones the sidebar cannot be hidden to give content full width.
- **Evidencia:** `index.html:290-292 `@media(max-width:768px){.eco-app{grid-template-columns:56px 1fr}}`; app.js:347 `<div className="eco-app" data-collapsed={collapsed}>` — no drawer/overlay markup`
- **Arreglo:** Mechanism 2 (JS breakpoint) + mechanism 1 (CSS class): at ≤768px set `.eco-app` to a single column (`grid-template-columns:1fr`), take the <aside> out of flow as `position:fixed;transform:translateX(-100%)` with a `.open` class + backdrop, and add a hamburger button (in the Header) that toggles it. Gives content the full 375px width and makes the expanded labels reachable.

**3. 🔴 P0 · Sidebar / NavItem** <sub>`no-breakpoint` · Móvil</sub>
- **Ubicación:** `shell.js:53-89 NavItem (title at :58, label hidden at :76, badge hidden at :78)`
- **Problema:** When collapsed (the only state the CSS allows on mobile, per finding 1), NavItem hides the text label entirely (`{!collapsed && <span>…}` shell.js:76) and the count/alert badges (shell.js:78), falling back to a native `title={item.label}` tooltip (shell.js:58). Native `title` tooltips require hover and do NOT appear on touch devices, so a phone user sees seven unlabeled icons with no way to learn each destination, and loses the mentions-count and active-alerts badges.
- **Evidencia:** `shell.js:58 `title={collapsed ? item.label : undefined}`; shell.js:76 `{!collapsed && <> <span…>{item.label}</span> …`; shell.js:78 `{item.badge != null && …}``
- **Arreglo:** Use the off-canvas expanded drawer on mobile (finding 2) so labels+badges render normally. If a rail is kept, render a small text label beneath each icon (flex-direction:column) via a CSS class so labels are always visible without hover; do not rely on `title`.

**4. 🟠 P1 · Header — period selector 'bag'** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `shell.js:332-351 Header PERIODS bag`
- **Problema:** The period control is a single `display:flex` rounded pill holding nine fixed buttons ['1D','5D','7D','30D','90D','3M','6M','1A','Max'] (shell.js:273) with NO flex-wrap. Its intrinsic width is ~312px + 6px container padding ≈ 318px. Available width at 375px after the header's 28px×2 padding is ~319px, and only ~264px at 320px (iPhone SE). The header parent wraps this bag onto its own line as one unit, but the bag itself cannot shrink or wrap, so it overflows its container / the viewport and trips horizontal scroll (`.eco-main` has overflow-x:auto, index.html:273).
- **Evidencia:** `shell.js:273 `const PERIODS = ['1D','5D','7D','30D','90D','3M','6M','1A','Max']`; shell.js:332 `<div style={{display:'flex', …borderRadius:999, padding:3}}>` (no flexWrap); shell.js:344 chip `padding:'4px 10px', fontSize:11``
- **Arreglo:** Mechanism 2 (JS breakpoint): at ≤768px replace the 9-chip bag with a compact native `<select>` (or a 'Período ▾' dropdown) so it occupies one shrinkable control. If keeping chips, move the bag to a CSS class and add `flex-wrap:wrap` at the mobile breakpoint (mechanism 1) — accepting the pill shape breaks into two rows — or reduce to the 3-4 most-used presets on mobile.

**5. 🟠 P1 · Sidebar** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `shell.js:98 Sidebar <aside> height:'100vh'`
- **Problema:** The <aside> is `height:'100vh'`, `position:'sticky'`, `overflow:'hidden'`, with a `flex:1` spacer (shell.js:212) pinning the status/user/collapse controls to the bottom. On mobile browsers the dynamic address bar makes 100vh larger than the visible viewport, so the bottom-pinned controls ('Ingesta en vivo', user block, 'Colapsar') render under the browser chrome and are hard to reach; and because nav overflow is hidden with no scroll, any overflow is silently clipped.
- **Evidencia:** `shell.js:98 `height:'100vh', position:'sticky', top:0, overflow:'hidden'`; shell.js:212 `<div style={{flex:1}} />``
- **Arreglo:** Mechanism 1: move the <aside> sizing to a CSS class using `height:100dvh` (with `100vh` fallback) so it tracks the visible viewport, and give the nav region `overflow-y:auto` instead of clipping. Inline styles can't express dvh reliably across the media boundary, so a class is required.

**6. 🟠 P1 · Header** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `shell.js:292-298 Header <header> padding:'14px 28px'`
- **Problema:** Header padding is a hard-coded inline `14px 28px`, costing 56px of horizontal space on a 375px screen. The mobile media block in index.html (289-295) tightens `.eco-page` padding but NOT the header, because the header is inline-styled and has no class, so its padding never responds to viewport. This both wastes width (aggravating the period-bag overflow) and, with flex-wrap, produces a very tall multi-row header.
- **Evidencia:** `shell.js:296 `padding:'14px 28px'`; index.html:293 only `.eco-page{padding:14px 12px 36px}` is tightened at ≤768px — no header rule exists`
- **Arreglo:** Mechanism 1: add a class (e.g. `.eco-header`) to the <header> and, in index.html, `@media(max-width:768px){.eco-header{padding:10px 12px; gap:8px}}`. Media-query padding cannot live in the inline style object.

**7. 🟠 P1 · Header — period chips & icon buttons** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `shell.js:344 period chip padding / shell.js:420 search btn / shell.js:425 theme-toggle btn`
- **Problema:** Interactive controls are well under the 44px touch minimum. Period chips are `padding:'4px 10px', fontSize:11` ≈ 22px tall (shell.js:344). The `.btn`-based search, calendar and theme-toggle buttons compute to ~30-32px tall (index.html:381 `.btn{padding:7px 14px;font-size:13px}`); the theme toggle (shell.js:425) is an icon-only ~30px square. All are difficult to tap accurately on a phone.
- **Evidencia:** `shell.js:344 `padding:'4px 10px', fontSize:11`; index.html:379-388 `.btn{padding:7px 14px; font-size:13px}`; shell.js:425 icon-only `<button className="btn">` with 14px icon`
- **Arreglo:** Mechanism 1: at ≤768px add `min-height:44px` (and adequate min-width for icon-only) to `.btn` and to the period chips via a class + @media in index.html. Inline padding on the chips can't carry a media query, so promote the chip to a class.

**8. 🟠 P1 · Sidebar — NavItem & collapse toggle** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `shell.js:62 NavItem collapsed padding / shell.js:252-253 collapse toggle`
- **Problema:** In the 56px rail, nav buttons use `padding:'9px 0'` around a 16px icon ≈ 34px tall (shell.js:62) and the collapse toggle uses `padding:'10px 0'` ≈ 34px (shell.js:253) — both below the 44px touch minimum, and the 28px user avatar (shell.js:238) is smaller still. Tightly stacked (`gap:2`, shell.js:199) icon targets on a phone rail are error-prone.
- **Evidencia:** `shell.js:62 `padding: collapsed ? '9px 0' : '9px 12px'`; shell.js:253 `padding: collapsed ? '10px 0' : '10px 14px'`; shell.js:199 nav `gap:2``
- **Arreglo:** Mechanism 1: give the nav buttons and collapse toggle a CSS class with `min-height:44px` at the mobile breakpoint. Because the collapsed padding is derived inline from the JS prop, pair it with the finding-1 breakpoint hook so the class is applied only when the rail is actually the mobile layout.

**9. 🟡 P2 · Header — quick-search button** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `shell.js:420-422 Header search button`
- **Problema:** The header 'Buscar ⌘K' button renders icon + 'Buscar' text + a ⌘K keycap. On a phone this duplicates the sidebar's search entry, the ⌘K keycap is meaningless without a physical keyboard, and the label+keycap consume header width that is already scarce.
- **Evidencia:** `shell.js:421 `<Icons.Search/> <span>Buscar</span> <span className="kbd">⌘K</span>``
- **Arreglo:** Mechanism 1: wrap the label and `.kbd` in a class and `display:none` them at ≤768px (icon-only search), or hide the whole button on mobile since the sidebar/off-canvas already exposes search. Media-driven hiding can't be done from the inline style.

**10. 🟡 P2 · Header — custom-range popover** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `shell.js:368-417 Header calendar popover`
- **Problema:** The date-range popover is `position:'absolute', right:0, minWidth:280` (shell.js:373-374) anchored to the small calendar button's relative wrapper (shell.js:353). After the header flex-wraps on mobile the button can land anywhere on its row; with a hard `minWidth:280` and no `max-width` guard the panel can extend past the left/right viewport edge on a 320px screen (280px panel + button offset).
- **Evidencia:** `shell.js:373-375 `position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:100, padding:14, minWidth:280``
- **Arreglo:** Mechanism 3 (fluid CSS) is enough here: change to `min-width:min(280px, calc(100vw - 24px)); max-width:calc(100vw - 24px)` so the panel never exceeds the viewport, or on mobile render it as a bottom sheet / centered modal (mechanism 2 branch) instead of an absolutely-positioned popover.

**11. 🟡 P2 · Header — agency switcher** <sub>`spacing` · Móvil+Tablet</sub>
- **Ubicación:** `shell.js:325-328 Header agency <select>`
- **Problema:** The agency `<select>` has inline `maxWidth:140` inside a pill; longer agency names are truncated by the native control with no reflow, and the pill (padding 6px 12px ≈ 30px tall, shell.js:320) is also a sub-44px touch target. Minor since the native select is otherwise usable and the item flex-wraps.
- **Evidencia:** `shell.js:326 `<select … style={{ …maxWidth:140 }}>`; shell.js:320 pill `padding:'6px 12px'``
- **Arreglo:** Mechanism 1: on mobile let the agency control take full row width (`max-width:none; flex:1 1 100%`) via a class so the name isn't clipped, and bump the pill to `min-height:44px` at the mobile breakpoint.

### Overlays / drawers / modales
<sub>SPA overlays/drawers/modals (shell.js:432-1519 + index.html overlay CSS)</sub>

*11 hallazgos — P0:0 · P1:3 · P2:8*


**1. 🟠 P1 · MentionsSliceModal** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `shell.js:1199 MentionsSliceModal/mention-row grid`
- **Problema:** Each highlighted-mention row is an inline 5-column grid with four fixed tracks (icon, sentiment pill, engagement, pertinence) totaling 250px + 48px of gaps = ~298px of rigid width. The title column (`1fr` with a minWidth:0 child) is what gives, so on a 94vw≈352px modal minus 48px padding (~304px content) the title track collapses to ~6px and shows only an ellipsis — the primary content of the modal becomes unreadable. Inline styles cannot carry an @media query so this never reflows.
- **Evidencia:** `style={{ display:'grid', gridTemplateColumns:'20px 1fr 90px 70px 70px', gap:12, ... }} (row) with the title cell <div style={{ minWidth:0 }}> using whiteSpace:'nowrap'; textOverflow:'ellipsis'`
- **Arreglo:** Add a JS breakpoint hook (useBreakpoint()/matchMedia) and branch gridTemplateColumns: on 'mobile' use '20px 1fr auto' — keep icon + title, drop/relocate engagement & pertinence into a second meta line under the title (or a right-aligned auto column). Alternatively lift the row to a CSS class in index.html and add @media(max-width:768px){ grid-template-columns:20px 1fr; } hiding the numeric columns.

**2. 🟠 P1 · MentionDrawer** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `index.html:492-494 .drawer (rendered by shell.js:683)`
- **Problema:** The right-anchored detail drawer is `width:560px; max-width:95vw`, so on a 375px phone it renders ~356px wide and never goes full-width, leaving a dead ~19px backdrop sliver on the left and cramming all inner content (metrics grid, AI summary, map, related list) into a narrow rail. Drawers are expected to become full-screen/off-canvas on phones.
- **Evidencia:** `.drawer { position:fixed; top:0; right:0; bottom:0; width:560px; max-width:95vw; ... }`
- **Arreglo:** CSS class + @media: add @media(max-width:768px){ .drawer{ width:100%; max-width:100%; border-left:none; } } so the drawer becomes a full-width sheet on phones; keep 560px on tablet/desktop.

**3. 🟠 P1 · MentionDrawer** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `shell.js:718 MentionDrawer/Métricas grid (cols computed line 714)`
- **Problema:** The metrics block builds an inline grid of up to 4 equal columns (`cols = min(4, metrics.length)`). Inside a 356px drawer minus 48px padding (~308px) minus gaps, four cards each rendering an 18px number like 12,480.toLocaleString overflow their cell / clip. Inline gridTemplateColumns can't reflow via @media.
- **Evidencia:** `const cols = Math.min(4, metrics.length); ... gridTemplateColumns: `repeat(${cols}, 1fr)`, gap:12 with .num fontSize:18`
- **Arreglo:** Intrinsically-fluid grid (no media query needed): gridTemplateColumns:'repeat(auto-fit, minmax(70px, 1fr))' so 4 cards wrap to 2×2 when narrow. Or add a useBreakpoint() hook and cap cols at 2 on 'mobile'.

**4. 🟡 P2 · MentionsSliceModal** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `shell.js:1135 MentionsSliceModal/subcomponents bar rows`
- **Problema:** The metric-subcomponents list uses an inline 3-column grid with a fixed 140px label track and a fixed 60px value track (200px rigid + gaps). On a ~304px content width that leaves the progress-bar `1fr` only ~80px, and a long component label truncates awkwardly against the fixed 140px. Won't reflow (inline).
- **Evidencia:** `gridTemplateColumns: '140px 1fr 60px', gap:10, alignItems:'center', fontSize:11`
- **Arreglo:** JS breakpoint branch to '90px 1fr 44px' on 'mobile', or move to a CSS class with @media(max-width:768px) shrinking the label/value tracks; alternatively stack label above the bar with flex-direction:column.

**5. 🟡 P2 · MentionsSliceModal** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `shell.js:1221 MentionsSliceModal/footer action row`
- **Problema:** Footer flex row holds up to three buttons (primary CTA with a long label e.g. 'Ver tópico · Infraestructura', plus 'Exportar' and 'Crear alerta') with gap:8 and no flex-wrap. Button labels are nowrap inline-flex, so on a ~304px content width the combined intrinsic width exceeds the row and overflows / gets clipped.
- **Evidencia:** `<div style={{ display:'flex', gap:8, paddingTop:8, borderTop:... }}> … three <button className="btn"> … </div> (no flexWrap)`
- **Arreglo:** Intrinsically-fluid: add flexWrap:'wrap' to the container (no media query needed) so secondary buttons drop to a second line; optionally give the CTA flexBasis so it takes a full row on mobile.

**6. 🟡 P2 · MetricInsightModal** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `shell.js:1409 MetricInsightModal/value+band+delta header row`
- **Problema:** The headline row is a flex row (gap:12, no wrap) holding a 36px number, a band label, and a delta string like '▼ -5 vs ventana anterior'. On a narrow modal these three nowrap items exceed the header width and overflow horizontally rather than wrapping.
- **Evidencia:** `<div style={{ marginTop:12, display:'flex', alignItems:'baseline', gap:12 }}> .num fontSize:36 + band + '… vs ventana anterior'`
- **Arreglo:** Add flexWrap:'wrap' to the row (intrinsic, no media query) so the band/delta wrap under the number on phones.

**7. 🟡 P2 · CommandPalette** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `shell.js:537-544 CommandPalette/result buttons`
- **Problema:** Each command/result row button is padding:'9px 12px' with fontSize:13 → ~34px tall, below the 44px touch minimum, making rapid selection error-prone on a phone (the palette is otherwise reachable since .spotlight is max-width:90vw).
- **Evidencia:** `style={{ ... padding:'9px 12px', borderRadius:8, fontSize:13, ... }} on each result <button>`
- **Arreglo:** Give the result buttons a CSS class and add @media(max-width:768px){ min-height:44px; } (media query needed because it's a size change), or bump inline padding to ~12px vertical for all breakpoints.

**8. 🟡 P2 · TweaksPanel** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `index.html:504-506 .tweaks-panel + shell.js:948-959 density buttons`
- **Problema:** The tweaks panel is a fixed 300px floating card pinned bottom-right (16px) with no @media and no max-height. At 300px it technically fits a 375px screen but does not adapt/reposition, can overlap the chat FAB/other bottom-right UI, and has no scroll if the viewport is short (landscape). Its density buttons (padding:'8px 4px', fontSize:11) are ~30px tall — under the touch minimum.
- **Evidencia:** `.tweaks-panel { position:fixed; bottom:16px; right:16px; width:300px; ... } and density button style padding:'8px 4px', fontSize:11`
- **Arreglo:** CSS class + @media(max-width:768px){ .tweaks-panel{ left:12px; right:12px; width:auto; max-height:80vh; overflow:auto; } } to make it a full-width bottom sheet with internal scroll; bump the density/mode buttons to min-height:44px on touch.

**9. 🟡 P2 · MentionDrawer / MentionsSliceModal / MetricInsightModal** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `shell.js:686, 1094, 1426 close buttons (.btn defined index.html:379-388)`
- **Problema:** Every overlay's close control is an icon-only `<button className="btn">` wrapping a 14px Icons.Close. The .btn base is padding:7px 14px, giving ~28-32px tap height/width — below the 44px minimum for a primary dismiss control that phone users tap frequently.
- **Evidencia:** `<button className="btn" onClick={onClose}><Icons.Close size={14} /></button>; .btn { padding:7px 14px; ... }`
- **Arreglo:** Add a .btn-icon utility class (min-width:44px; min-height:44px; justify-content:center) applied to icon-only buttons, or an @media(max-width:768px) rule bumping .btn min dimensions to 44px.

**10. 🟡 P2 · MiniMunicipalityMap** <sub>`map-scale` · Móvil+Tablet</sub>
- **Ubicación:** `shell.js:639 (map container) & 631 (loading placeholder)`
- **Problema:** The Leaflet mini-map wrapper and its loading placeholder are locked to height:140px. It is width-responsive (inset:0 absolute inside the drawer) and all interactions are disabled, so it is usable, but a fixed 140px feels shallow once the drawer becomes full-width on a phone and does not scale with the wider container.
- **Evidencia:** `<div style={{ position:'relative', height:140 }}> … loading placeholder <div style={{ height:140, ... }}>`
- **Arreglo:** Intrinsically-fluid: replace height:140 with aspectRatio:'16 / 7' (or clamp(120px, 32vw, 180px)) on both the container and placeholder so the map grows proportionally with the full-width mobile drawer.

**11. 🟡 P2 · CommandPalette** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `shell.js:528 results scroll area + index.html:466 .spotlight-backdrop padding-top`
- **Problema:** The results list is capped at maxHeight:440 while the backdrop pushes the palette down with padding-top:12vh. The .spotlight itself has no max-height, so header (56px) + 440px list + footer (35px) + 12vh top offset can exceed a short (landscape ~375-430px tall) phone viewport, pushing the footer/hint row off-screen.
- **Evidencia:** `<div style={{ maxHeight:440, overflowY:'auto', padding:8 }}> ... and .spotlight-backdrop { ... padding-top:12vh; }`
- **Arreglo:** Cap the scroll area to the smaller of the two — maxHeight:'min(440px, 55vh)' (intrinsic viewport unit, no media query) — and/or add max-height:85vh to .spotlight so the whole palette stays inside the viewport in landscape.

### Pantalla Overview (landing)
<sub>Overview screen (default landing route /overview) — screens.js:3372-3947</sub>

*7 hallazgos — P0:1 · P1:3 · P2:3*


**1. 🔴 P0 · OverviewScreen (page container / scroll guard)** <sub>`scroll-guard` · Tablet</sub>
- **Ubicación:** `index.html:283-288 (.eco-page min-width) governing screens.js:3483 OverviewScreen root`
- **Problema:** The Overview is the default landing route, and the page-level scroll guard forces its content to a hard minimum width, so the entire landing page scrolls horizontally on any viewport in the 900-1119px band (large tablet landscape / small laptop with the 220px sidebar: e.g. 1024px viewport - 220px sidebar = 804px content area < 900px min-width => ~96px of horizontal scroll). None of the Overview inline grids ever get a chance to reflow because the guard keeps the canvas artificially wide.
- **Evidencia:** `@media (min-width: 900px){ .eco-page { min-width: 900px; } }  @media (min-width: 1120px){ .eco-page { min-width: 1120px; } }  with .eco-main { overflow-x: auto; }`
- **Arreglo:** Mechanism (1) CSS in index.html: delete the two `.eco-page { min-width: … }` scroll-guard rules and let .eco-page be fluid (it is already display:flex/column). Keep .eco-main overflow-x:auto only as a safety net for genuinely wide children (charts/maps), never as the layout strategy. This must be paired with making the Overview inline grids below reflow (findings 2-5); removing the guard alone would let those fixed grids overflow instead of scroll.

**2. 🟠 P1 · OverviewInsights (3-column IA insight cards)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3914 OverviewInsights insights grid`
- **Problema:** Inline `gridTemplateColumns: 'repeat(3, 1fr)'` for three text-heavy insight cards (Negativos / Positivos / Resumen del periodo). On a 375px phone the eco-page content width (~351px) splits into three ~109px cards, each a .card with padding:16 leaving ~77px inner width for 12px body text and bulleted lists — roughly one to two words per line, effectively unreadable. Being inline, it cannot carry an @media query so it never stacks.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>  … three <div className="card" style={{ padding: 16 … }}> with 12px paragraphs/bullet lists`
- **Arreglo:** Mechanism (3) intrinsically-fluid: replace the inline grid with a CSS class in index.html (e.g. `.ov-insights-grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }`). auto-fit + minmax(240px) yields 1 column on phone, 2 on ~500-760px, 3 on desktop with no JS. Alternatively mechanism (1): a class with `@media(max-width:768px){ grid-template-columns:1fr; }`.

**3. 🟠 P1 · OverviewTopicos (topic rows + total footer)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3747 topic row grid (and identical footer grid at screens.js:3780)`
- **Problema:** The topic table renders each row (and the 'Total del periodo' footer) with inline `gridTemplateColumns: '1.4fr 110px 1fr'` — a hard 110px middle column plus 2x16px gaps. Inside the card on a 375px phone (~351px minus 32px row padding = ~319px), 110px + 32px gaps are fixed, leaving only ~177px split 1.4:1 => topic name column ~103px (truncated to ellipsis, unreadable) and distribution bar ~74px. The fixed 110px column and 3-across structure never reflow, so the topic label (the point of the row) is the first thing squeezed out.
- **Evidencia:** `style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 1fr', gap: 16, padding: '14px 16px', … }}  with the topic name div using overflow:hidden; textOverflow:ellipsis; whiteSpace:nowrap`
- **Arreglo:** Mechanism (1) CSS class + @media (a fluid unit alone can't restructure a row into stacked): move the row to `.ov-topic-row` and add `@media(max-width:560px){ .ov-topic-row{ grid-template-columns:1fr auto; } .ov-topic-row .ov-topic-bar{ grid-column:1 / -1; } }` so the topic name gets the full width on line 1 and the count + distribution bar wrap below. Apply the same class to the footer total row. If keeping one line is required, at minimum drop the fixed 110px to `auto` and use `minmax(0,1.4fr) auto minmax(56px,1fr)` so the name column can breathe.

**4. 🟠 P1 · OverviewTermometro (3 sentiment stat cards)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3552 termómetro grid`
- **Problema:** Inline `gridTemplateColumns: 'repeat(3, 1fr)'` for the Negativo/Neutral/Positivo cards. On a 375px phone each card is ~109px wide (~77px inner after padding:16). The 32px display number fits, but the delta line '▲12% vs ventana previa' (fontSize 11, single flex row) wraps to 2-3 ragged lines in that width, and the label row (dot + 'NEGATIVO' uppercase + arrow) is cramped. Being inline it cannot reflow to fewer columns.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>  … delta row: {Math.abs(Math.round(c.delta))}% vs ventana previa`
- **Arreglo:** Mechanism (3): replace with a CSS class using `grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))` so the three cards wrap (2+1, then 1) below ~470px instead of shrinking to 77px. Additionally shorten the delta caption on narrow widths (e.g. drop 'vs ventana previa' to a tooltip) — that can be done with a JS breakpoint hook (mechanism 2) if the full text must stay on desktop.

**5. 🟡 P2 · OverviewHighlights (Riesgo de crisis card + gauge)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3625 crisis card grid (gauge labels at screens.js:3650-3651)`
- **Problema:** The crisis card uses inline `gridTemplateColumns: '160px 1fr'` with a `border-left` divider on the gauge column. It technically fits at 375px (160 + 16 + ~175px gauge), but the left column crams a 28px score + '/1' + a 'CRISIS' pill with marginLeft:auto (risk of wrap), and the 1fr gauge's four space-between labels NORMAL/ELEVADO/ALERTA/CRISIS (fontSize 9 mono) sit in only ~175px and can nearly touch/overlap. The fixed 160px column and the border-left (wrong divider when stacked) don't adapt.
- **Evidencia:** `style={{ padding:16, display:'grid', gridTemplateColumns:'160px 1fr', gap:16, alignItems:'center', … }}  and gauge labels <span>NORMAL</span><span>ELEVADO</span><span>ALERTA</span><span>CRISIS</span> at fontSize 9`
- **Arreglo:** Mechanism (1) CSS class + @media: `.ov-crisis` with `@media(max-width:560px){ grid-template-columns:1fr; }` and swap the gauge column's `border-left` for `border-top` in the same query so the score stacks above a full-width gauge, giving the four scale labels the full row width and removing overlap risk.

**6. 🟡 P2 · OverviewTendencia (MultiLineChart wrapper)** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:3696 MultiLineChart call (height=240)`
- **Problema:** The trend chart is invoked with a hard-coded `height={240}`. The SVG is width-responsive (charts.js measures container), but on a ~350px phone canvas the x-axis renders one label per day; with a 30-day custom period that is ~30 date ticks in 350px and they collide/overlap. The fixed 240px height also isn't reduced on small screens, wasting vertical space relative to the narrowed plot area.
- **Evidencia:** `<MultiLineChart data={chartData} series={series} height={240} onPointClick={onDayClick} smooth={true} />  where chartData length can be 7 (7D) up to 30+ (custom range)`
- **Arreglo:** Mechanism (2) JS breakpoint hook: derive height from a useBreakpoint()/matchMedia value (e.g. 180 on mobile, 240 on desktop) rather than a literal 240. For the tick collision, have charts.js thin the x-axis labels when container width / point count drops below a threshold (show every Nth label or rotate) — a chart-internal fix, but the call site should stop hard-coding height so the chart can pick a responsive value.

**7. 🟡 P2 · OverviewHero (title h1)** <sub>`font-scale` · Móvil</sub>
- **Ubicación:** `screens.js:3527 hero h1 fontSize`
- **Problema:** The hero heading uses a fixed inline `fontSize: 26`. It wraps rather than clipping, but 26px display type combined with the dynamic sentence 'Conversación pública de los últimos N días' pushes to 3-4 lines on a 375px phone, dominating the first screen before any data. There is no fluid scaling.
- **Evidencia:** `<h1 style={{ fontFamily:'var(--ff-display)', fontSize: 26, fontWeight:600, lineHeight:1.2, … }}>Conversación pública de los últimos {data.dailySeries.length} días</h1>`
- **Arreglo:** Mechanism (3) fluid CSS: replace the literal with `fontSize: 'clamp(20px, 5vw, 26px)'` (still valid inside an inline style object since it's a single CSS value, no media query) so the title scales down on phones without a breakpoint hook.

### Pantalla Dashboard / Scorecard
<sub>Dashboard screen (screens.js:1-627 — DashboardScreen + KpiCard + BrandHealthMini + HourActivityCard)</sub>

*10 hallazgos — P0:5 · P1:2 · P2:3*


**1. 🔴 P0 · DashboardScreen — Hero KPI grid** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:354 DashboardScreen / Hero KPIs row`
- **Problema:** Five KPI cards (NSS, Crisis, Volumen, Brand Health, Polarización) are laid out with an inline gridTemplateColumns of five tracks. Inline style objects can't hold @media, so the grid stays 5-up at every width. On a 375px phone each column is ~55-65px; on a 768px tablet (minus the 56px rail) each is ~120px. A card holds a 34px display number, a delta, a 200px sparkline / gauge and an uppercase label — none of which fit, so contents clip (card has overflow:hidden) or the row forces horizontal scroll.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1fr 1fr 1fr', gap: 12 }}>`
- **Arreglo:** Mechanism (1): move the grid to a CSS class in index.html (e.g. .dash-kpi-grid) and add @media rules — repeat(5,1fr) at >=1120px, 2 columns at <=768px (keeping NSS+Crisis as the emphasized first row), 1 column at <=480px. Preferred over the pure-CSS auto-fit option (3) `repeat(auto-fit,minmax(160px,1fr))` only because auto-fit would drop the intentional 1.3fr emphasis on the two hero metrics; if that emphasis is expendable, auto-fit needs no JS and no breakpoints.

**2. 🔴 P0 · DashboardScreen — Executive briefing card** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:287 DashboardScreen / Resumen ejecutivo card`
- **Problema:** The briefing card is an inline 2-track grid ('1.2fr 1fr'): narrative + KPIs on the left, 'Pulso en vivo' list on the right. It never stacks. At 375px the left track is ~195px and the right ~160px, so the 18px display narrative renders 2-3 words per line and the pulse rows (time + dot + text + engagement) truncate to nothing.
- **Evidencia:** `className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'stretch' }}`
- **Arreglo:** Mechanism (1): move to a CSS class + @media(max-width:768px){ grid-template-columns:1fr } to stack the two panels. Pair with the fix for the right column's divider (see next finding).

**3. 🔴 P0 · DashboardScreen — Topics / Sources / Heatmap row** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:435 DashboardScreen / Row 3 grid`
- **Problema:** Three cards (Tópicos emergentes, Fuentes top, Actividad por hora) share an inline 3-track grid ('1.2fr 1fr 1fr') that never reflows. At 768px the third track is ~206px, but its child heatmap needs ~424px, so it overflows even on tablet; at 375px all three columns are unusable (~110px each).
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 12 }}>`
- **Arreglo:** Mechanism (1): CSS class + @media — 2 columns at <=1024px (topics full-width or paired), 1 column at <=768px. Must be combined with making the Heatmap itself scale (separate finding), since a single stacked column at 375px is still narrower than the fixed heatmap.

**4. 🔴 P0 · DashboardScreen — Menciones destacadas table** <sub>`table-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:505 DashboardScreen / recent mentions row`
- **Problema:** Each mention row is an inline 5-track grid with three fixed pixel columns (130px sentiment, 100px engagement, 100px date) plus a 20px icon and 2fr title, gap:12. Fixed tracks alone sum ~350px + 48px gaps = ~398px, exceeding the ~343px content width at 375px. The card has no overflow wrapper, so the overrun bleeds to .eco-main (overflow-x:auto) and forces the whole dashboard to scroll horizontally.
- **Evidencia:** `display: 'grid', gridTemplateColumns: '20px 2fr 130px 100px 100px', gap: 12`
- **Arreglo:** Mechanism (1): CSS class + @media(max-width:640px) collapsing to a 2-column layout (icon+title on row 1; sentiment pill + engagement + relative date on a wrapped second line via a nested flex), or hide the engagement/date columns below 640px. Add overflow-x:auto on the card body as a fallback guard so a wide row scrolls inside its own card instead of the page.

**5. 🔴 P0 · HourActivityCard / Heatmap** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:614 HourActivityCard (Heatmap cellSize=14; charts.js:599 Heatmap)`
- **Problema:** The heatmap is built from fixed 14px cells: 24 cols × 14px + 2px gaps + three 4px shift-break gaps + 28px day label + 30px header offset ≈ 424px of hard width that never scales. It overflows its column in the 3-up row on tablet and overflows a full-width stacked card (~343px) on phone, contributing to horizontal page scroll.
- **Evidencia:** `cellSize={14} ... (charts.js Heatmap renders width:cellSize per cell, 24 hours, no viewBox / no % scaling)`
- **Arreglo:** Mechanism (2)+(3): add a useBreakpoint()/matchMedia hook and pass a smaller cellSize on mobile/tablet (e.g. 9-10px), AND wrap the Heatmap in an overflow-x:auto container inside .card-bd so that even at the smallest cell size a narrow phone scrolls the heatmap within its own card rather than the whole page. Alternatively convert Heatmap to a fluid SVG with viewBox + preserveAspectRatio so it scales to 100% container width.

**6. 🟠 P1 · KpiCard — Sparkline** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:47 KpiCard trendData sparkline`
- **Problema:** KpiCard renders the trend sparkline at a hard width=200 (SVG has an explicit width attribute, no viewBox, no max-width). When a KPI card is narrower than 200px (which it is in the un-reflowed 5-col hero grid on phone/tablet), the sparkline is clipped by the card's overflow:hidden and reads as a truncated line.
- **Evidencia:** `<Sparkline data={trendData} width={200} height={30} color={accent} /> ... (charts.js:81) <svg width={width} height={height} ...>`
- **Arreglo:** Mechanism (3): make Sparkline intrinsically fluid — render the SVG with a viewBox="0 0 200 30", style={{width:'100%', height:30}} and preserveAspectRatio='none', dropping the fixed width attribute. Then it scales to whatever width the KPI card provides once the grid reflows.

**7. 🟠 P1 · HourActivityCard / Heatmap cells (touch)** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:614 HourActivityCard onCellClick / charts.js:620 cell`
- **Problema:** Each clickable heatmap cell is 14×14px (opens a mention slice on tap). That is far below the 44px minimum comfortable touch target, so selecting an hour franja on a phone is nearly impossible and mis-taps adjacent cells.
- **Evidencia:** `cellSize={14} ... onClick={clickable ? () => onCellClick({ day: d, ... hour: h }) }`
- **Arreglo:** Mechanism (2): with the same breakpoint hook, raise cell size on touch/mobile (min ~20px) and/or add invisible padding to enlarge the hit area (e.g. transparent border) while keeping the visual cell small. Accept that a 24-wide grid at 20px needs the overflow-x:auto container from the heatmap-scale fix.

**8. 🟡 P2 · DashboardScreen — briefing right column divider** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `screens.js:335 DashboardScreen / Pulso en vivo column`
- **Problema:** The right (Pulso) column uses an inline borderLeft + paddingLeft:24 to separate it from the left column. Once the parent grid is stacked to a single column (previous finding), a left border + 24px left indent is wrong — it should become a top border with top padding.
- **Evidencia:** `<div style={{ borderLeft: '1px solid var(--hairline)', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>`
- **Arreglo:** Mechanism (1): give this column a CSS class and, in the same @media(max-width:768px) block that stacks the grid, swap borderLeft→borderTop and paddingLeft→paddingTop (e.g. border-top:1px solid var(--hairline); padding-top:16px; padding-left:0).

**9. 🟡 P2 · DashboardScreen — series toggle chips** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:413 DashboardScreen / Evolución multi-métrica series buttons`
- **Problema:** The multi-metric series toggle buttons use padding '4px 9px' with fontSize 10, yielding roughly 22px tall pills — below the 44px touch minimum. They already flex-wrap (good) but remain hard to tap accurately on a phone.
- **Evidencia:** `padding: '4px 9px', borderRadius: 999, fontSize: 10, fontWeight: 600`
- **Arreglo:** Mechanism (1): give the chip a CSS class and, in @media(max-width:768px), bump to min-height:36-44px with larger padding and font-size:11-12px. (The row's flex-wrap already handles reflow, so only the target size needs the media query.)

**10. 🟡 P2 · DashboardScreen — MultiLineChart (Evolución)** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `screens.js:430 DashboardScreen / MultiLineChart`
- **Problema:** The timeline chart is width-responsive (charts.js measures container via ResizeObserver) but is passed a hard height={240}. At 375px the x-axis date ticks and any series values compress and can collide; the fixed 240px height also does not tighten on small screens where vertical space is scarce.
- **Evidencia:** `<MultiLineChart data={D.TIMELINE} series={...} height={240} onPointClick={openTimelineDaySlice} />`
- **Arreglo:** Mechanism (2) or (3): either branch the height prop via a useBreakpoint() hook (e.g. 200 on mobile) or pass a clamp()-derived height; additionally have MultiLineChart thin/rotate x-tick labels (show every Nth) when measured width is below ~420px to prevent tick collision.

### Pantalla Menciones
<sub>Mentions screen (MentionsScreen, QuickMetric, Pagination, MentionsList, MentionsCards, MentionsTable) — screens.js 628-1050</sub>

*11 hallazgos — P0:3 · P1:3 · P2:5*


**1. 🔴 P0 · MentionsScreen quick-metrics row** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:784 MentionsScreen/quick-metrics grid`
- **Problema:** The four QuickMetric cards are laid out with an inline `gridTemplateColumns: 'repeat(4, 1fr)'`. Inline style objects cannot hold @media queries, so this stays 4 columns at every width. On a 375px phone (content box ~267px after the 56px rail + eco-page + card padding), each column is (267 - 3*12gap)/4 ≈ 58px, leaving ~30px inner width after the card's padding:14. The 22px display number (e.g. '3.4M', '1.2M') and the label 'Virales (≥ 5K)' overflow / wrap into an unreadable stack.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>  ... QuickMetric value fontSize: 22 (line 867)`
- **Arreglo:** Mechanism (3) intrinsic fluid grid: replace with `grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))` so it collapses to 2-up then 1-up automatically with no JS. Do it in a CSS class `.mentions-metrics` in index.html (inline can't reflow), and clamp() the QuickMetric number (`fontSize: 'clamp(16px, 5vw, 22px)'`, font-scale) so the value never overruns a narrow tile. If exact stops are wanted use mechanism (1): the class + @media(max-width:768px){repeat(2,1fr)} + @media(max-width:420px){1fr}.

**2. 🔴 P0 · MentionsList header + row grid** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:944 & 953 MentionsList/grid rows`
- **Problema:** Both the header row and every data row use inline `gridTemplateColumns: '20px 2fr 110px 110px 80px 30px'`. The fixed tracks sum to 350px, plus 5 gaps × 12px = 60px = ~410px of guaranteed width before the 2fr 'Mención' column (the primary content) receives anything. On a ~267px mobile content box this overflows by ~150px, and even on tablet the title column is starved. Inline grid can't reflow, so this is a hard table-overflow the moment the viewport drops below the scroll-guard threshold.
- **Evidencia:** `gridTemplateColumns: '20px 2fr 110px 110px 80px 30px' (identical on line 944 header and line 953 row)`
- **Arreglo:** Mechanism (2) JS breakpoint (matchMedia/useBreakpoint) is the cleanest here because the layout must change shape, not just wrap: on 'mobile' branch gridTemplateColumns to '20px 1fr 30px' (icon, title, chevron) and fold Sentimiento/Tópico/Hora into the title cell's existing sub-line (line 957). Alternatively mechanism (1): move both grids to a shared `.mention-list-row` CSS class in index.html and hide the .sent/.topic/.time columns via @media(max-width:768px). Keep header and row using the SAME class so they stay aligned.

**3. 🔴 P0 · eco-page scroll guard (affects this screen)** <sub>`scroll-guard` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:283 .eco-page min-width guards`
- **Problema:** The Mentions page is rendered inside `.eco-page`, which is pinned to `min-width:900px` at ≥900px and `min-width:1120px` at ≥1120px, while `.eco-main` has `overflow-x:auto`. This forces the whole screen (filter bar, metrics, table) to a fixed minimum instead of reflowing, and creates a hard 'cliff' at 900px where the layout suddenly jumps from forced-wide to fluid. It also means the flex-wrap already present on the filter bar never actually engages until below 900px.
- **Evidencia:** `@media (min-width: 900px){ .eco-page { min-width: 900px; } }  @media (min-width: 1120px){ .eco-page { min-width: 1120px; } }  .eco-main { overflow-x:auto; }`
- **Arreglo:** Mechanism (1): drop the `min-width:900/1120` guards (or replace with `max-width` centering) once the inner grids above are made to reflow, and remove the `overflow-x:auto` crutch on .eco-main. The reflow work in the other findings is the prerequisite; the guards are masking those defects rather than fixing them.

**4. 🟠 P1 · MentionsCards grid** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:973 MentionsCards/auto-fill grid`
- **Problema:** `gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))'` looks fluid but its 340px minimum is larger than the mobile content box (~267px on a 375px phone, ~343px is already borderline on the 56px-rail layout). When the track floor exceeds the container, the card is forced to 340px and overflows horizontally instead of shrinking.
- **Evidencia:** `gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))'`
- **Arreglo:** Mechanism (3) fluid, one-token change: `repeat(auto-fill, minmax(min(100%, 300px), 1fr))`. The `min(100%, 300px)` clamps the track floor to the container width so a single card can shrink to fit a phone while still going 2-up/3-up on wider screens. This needs no media query and can stay inline.

**5. 🟠 P1 · MentionsScreen filter bar — sentiment chip group** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:729 MentionsScreen/sentiment chips`
- **Problema:** The outer filter card is flex-wrap (good), but the 4 sentiment chips sit in an inner `display:flex, gap:6` div with NO flex-wrap. As one flex item it drops to its own line when it can't fit, but on that line it stays nowrap; the 4 chips (Todas / Positivo• / Neutral / Negativo•) total ~290px and overflow a ~267px mobile content box, pushing horizontal scroll on the card.
- **Evidencia:** `<div style={{ display: 'flex', gap: 6 }}>  {[{k:'all',l:'Todas'}, {k:'positivo',...}, {k:'neutral',...}, {k:'negativo',...}].map(...)}`
- **Arreglo:** Mechanism (3): add `flexWrap: 'wrap'` to the line-729 div so chips wrap to a second line — cheapest fix, can stay inline. Better UX on mobile: make it a horizontally scrollable segmented control by moving it to a `.sentiment-filter` CSS class with `overflow-x:auto; flex-wrap:nowrap; -webkit-overflow-scrolling:touch` (mechanism 1) so the four options stay on one swipeable row.

**6. 🟠 P1 · MentionsScreen 'Más filtros' popover** <sub>`absolute-pos` · Móvil</sub>
- **Ubicación:** `screens.js:750 MentionsScreen/moreOpen dropdown`
- **Problema:** The Más-filtros panel is `position:absolute; top:calc(100%+6px); left:0; minWidth:260`. After the filter bar wraps, the trigger button can land near the right edge of the row; the panel then extends 260px rightward from the button's left edge and spills past the viewport, getting clipped or forcing horizontal scroll. minWidth:260 alone is ~ the full usable width of a 375px phone.
- **Evidencia:** `style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 80, padding: 12, minWidth: 260, ... }}`
- **Arreglo:** Mechanism (1)/(2): give the panel a CSS class and on @media(max-width:768px) render it full-width as a bottom sheet (`position:fixed; left:12px; right:12px; top:auto; bottom:12px; minWidth:0; maxWidth:none`) or at minimum switch anchoring to `right:0; left:auto` and cap `maxWidth: calc(100vw - 24px)` so it can never exceed the viewport. A JS breakpoint hook can choose the fixed/bottom-sheet variant on mobile.

**7. 🟡 P2 · MentionsTable** <sub>`table-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:1007 & 1024 MentionsTable/overflow container + Título cell`
- **Problema:** The 9-column table (icon, Título, Autor, Dominio, Sentim., Tópico, Subtópico, Municipio, Fecha) with many `whiteSpace:nowrap` cells is wide, but it IS wrapped in its own `<div style={{ overflow:'auto' }}>`, which is the correct responsive pattern (scroll inside its own container, not the page). The only rough edge is the Título cell's fixed `maxWidth: 360`, which on a 375px phone is nearly the whole viewport and makes the horizontal scroll distance large.
- **Evidencia:** `<div style={{ overflow: 'auto' }}> ... <td style={{ ..., maxWidth: 360, ... }}>{mn.title}</td>`
- **Arreglo:** Keep the overflow:auto container (it's the intended table pattern). Mechanism (3): change the Título cap to `maxWidth: 'min(360px, 55vw)'` so the title column tightens on phones and the whole table is less unwieldy to scroll. Optionally give the <table> a `min-width` so columns don't collapse ambiguously narrow.

**8. 🟡 P2 · Pagination buttons** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:891 Pagination/btnStyle`
- **Problema:** Page-number buttons are `minWidth:32, padding:'6px 10px', fontSize:12` → ~32px wide × ~30px tall, below the 44px minimum tap target. The container is flex-wrap (good), so they wrap on narrow screens, but each individual tap target is small and the number buttons sit close together, risking mis-taps on the wrong page.
- **Evidencia:** `const btnStyle = (active, disabled) => ({ minWidth: 32, padding: '6px 10px', ... fontSize: 12, ... })`
- **Arreglo:** Mechanism (1): move btnStyle values to a `.page-btn` CSS class and add `@media(max-width:768px){ .page-btn{ min-width:44px; min-height:44px; } }`. Since btnStyle is a JS function you can also branch it via a useBreakpoint() hook (mechanism 2) to bump minWidth/minHeight to 44 on mobile.

**9. 🟡 P2 · Filter chips & view-mode toggle chips** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:731, 817, 763 chip buttons`
- **Problema:** The `.chip` primitive is `padding:5px 10px; font-size:11px`, giving ~21px tall targets. Used for the sentiment filter (line 731), the list/cards/table view toggle (line 817), and the sort chips inside Más filtros (line 763). All are well under the 44px minimum and are the primary interaction controls on this screen.
- **Evidencia:** `.chip { padding: 5px 10px; font-size: 11px; ... } (index.html:363-366)`
- **Arreglo:** Mechanism (1): add `@media(max-width:768px){ .chip { min-height: 44px; padding: 0 14px; } }` in index.html so every chip becomes tap-friendly on phones without disturbing the dense desktop layout.

**10. 🟡 P2 · Card header view-mode toggle** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `screens.js:809 MentionsScreen/card-hd toggle group`
- **Problema:** .card-hd is `display:flex; justify-content:space-between` with no flex-wrap; the right side holds a nowrap group of three icon+label chips (Lista/Cards/Tabla ≈ 180px). On a phone the title/sub column (flex:1, min-width:0) is squeezed hard against the toggle group, and card-hd-title has no ellipsis so 'Página X de Y · N en total' truncates awkwardly.
- **Evidencia:** `<div style={{ display: 'flex', gap: 6, fontSize: 11 }}> {[{k:'list',l:'Lista'},{k:'cards',l:'Cards'},{k:'table',l:'Tabla'}].map(...)}  inside .card-hd (no flex-wrap)`
- **Arreglo:** Mechanism (1): add `@media(max-width:768px){ .card-hd{ flex-wrap: wrap; } }` so the toggle group drops below the title on phones; consider icon-only chips (hide labels via a CSS class) at the narrowest widths to reclaim room.

**11. 🟡 P2 · Filter bar source select + vertical divider** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `screens.js:736 & 737 MentionsScreen/source select + divider`
- **Problema:** The source `<select>` is a fixed `width:160`, and a decorative 1px×24px vertical divider (line 736) sits between the chip group and the select. Once the filter bar wraps on mobile, the divider floats orphaned on its own wrapped line and the fixed-width select doesn't grow to fill the row, producing an uneven, ragged filter bar.
- **Evidencia:** `<div style={{ width: 1, height: 24, background: 'var(--hairline)' }} />  <select ... style={{ width: 160 }}>`
- **Arreglo:** Mechanism (3): give the select `flex:1; minWidth:140; maxWidth:220` instead of a fixed 160 so it fills the row when wrapped. Hide the vertical divider on wrap via a CSS class + `@media(max-width:768px){ display:none }` (mechanism 1) since a vertical rule is meaningless once items stack.

### Pantalla Sentimiento
<sub>SentimentScreen (screens.js 1051-1414, incl. EmotionsCard)</sub>

*9 hallazgos — P0:1 · P1:6 · P2:2*


**1. 🔴 P0 · SentimentScreen — Charts row (timeline chart + EmotionsCard)** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:1215 SentimentScreen/charts grid`
- **Problema:** Two-column `1.5fr 1fr` inline grid places the stacked-area timeline card and the EmotionsCard side-by-side with no reflow. On tablet and phone the EmotionsCard is squeezed to ~40% of an already narrow row, and its rigid inner ranking grid (22px+120px+64px+12px+gaps ≈ 266px minimum) cannot fit — the 1fr bar collapses to near-zero or the whole card forces horizontal overflow. Being an inline style it can never respond to a media query.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12 }}>`
- **Arreglo:** Mechanism (1): move this row to a CSS class in index.html (e.g. `.sentiment-charts-grid { display:grid; grid-template-columns:1.5fr 1fr; gap:12px }`) and add `@media(max-width:900px){ grid-template-columns:1fr }` so the two cards stack. Alternatively mechanism (2): a useBreakpoint() hook returning 'mobile'|'tablet'|'desktop' and branch to '1fr' when not desktop.

**2. 🟠 P1 · SentimentScreen — Narrative hero (NSS number + donut/legend)** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:1169 SentimentScreen/narrative hero card`
- **Problema:** Hero uses inline `gridTemplateColumns: '1fr auto'`; the `auto` column holds Donut(size=110) + 18px gap + a legend column with `minWidth:160`, i.e. ~290px that never shrinks. At 375px (minus the 56px sidebar rail) the left `1fr` text column is crushed and the NSS narrative paragraph (maxWidth 640) wraps to a sliver. No @media possible inline.
- **Evidencia:** `<div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center' }}>`
- **Arreglo:** Mechanism (1): CSS class + `@media(max-width:768px){ grid-template-columns:1fr }` to stack the donut/legend block under the NSS text. Or mechanism (2): JS breakpoint branching the inline template to '1fr' on mobile/tablet.

**3. 🟠 P1 · SentimentScreen — 'Sentimiento por X' breakdown grid** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:1257 SentimentScreen/group breakdown card-bd`
- **Problema:** The distribution rows use inline `gridTemplateColumns: 'repeat(2, 1fr)'`. On a 375px phone each column is ~150px, so the label (truncated to `calc(100% - 60px)`) plus the fmt(total) count leave the stacked pos/neu/neg bar unreadably short and the 10px pos/neu/neg captions crowd. Fixed 2-up count doesn't reflow to 1-up.
- **Evidencia:** `<div className="card-bd" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>`
- **Arreglo:** Mechanism (3) intrinsically-fluid, no media query needed: replace with `repeat(auto-fit, minmax(220px, 1fr))` (via inline style if the min is acceptable, otherwise a CSS class). It naturally drops to one column below ~460px and keeps two columns on desktop.

**4. 🟠 P1 · EmotionsCard — emotion ranking row** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:1383 EmotionsCard/ranking row button`
- **Problema:** Each ranking row is an inline grid `22px 120px 1fr 64px 12px` with four 12px gaps: ~266px of fixed track before the flexible bar. Because EmotionsCard already lives in the 1fr column of the 1.5fr 1fr charts grid (finding #1), on tablet/phone the available card width can drop below 266px, collapsing the 1fr bar to zero (bar disappears) or pushing the 64px count/arrow columns into horizontal overflow. Inline template can't reflow.
- **Evidencia:** `gridTemplateColumns: '22px 120px 1fr 64px 12px', gap: 12,`
- **Arreglo:** Mechanism (1): move the row to a CSS class and at `@media(max-width:768px)` shrink/relativize the fixed tracks — e.g. drop the 22px rank number, change the 120px label track to `minmax(72px, 1fr)` and shrink the 64px count to auto — so the bar always retains width. Mechanism (3) minmax() on the label column also prevents the collapse without a media query.

**5. 🟠 P1 · SentimentScreen — NSS hero number row** <sub>`font-scale` · Móvil</sub>
- **Ubicación:** `screens.js:1172 SentimentScreen/openNssInsight button`
- **Problema:** The clickable NSS row is a baseline flex (gap 16, no flex-wrap) containing a 56px display number, the 'NSS' label, an ArrowRight, and the delta text '3.2 vs período anterior'. At 375px this fixed 56px number plus the delta string exceeds the available width and, with nowrap, overflows horizontally rather than wrapping.
- **Evidencia:** `style={{ display: 'flex', alignItems: 'baseline', gap: 16, ... }} … fontSize: 56 … <Icons.ArrowDown size={12} /> 3.2 vs período anterior`
- **Arreglo:** Mechanism (3): give the number `fontSize: clamp(36px, 12vw, 56px)` and let the row wrap (`flexWrap: 'wrap'`) so the delta chip drops to a second line on narrow screens. Both can be applied inline (clamp + flex-wrap need no media query).

**6. 🟠 P1 · SentimentScreen — group-breakdown card header + toggle pill** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:1236 SentimentScreen/group card-hd toggle`
- **Problema:** The card header is a `display:flex; justify-content:space-between; gap:12` row with the title/subtitle on the left and a 4-button pill (Fuente/Tópico/Subtópico/Región) on the right, with no flex-wrap. The pill (~4×[padding 4px 10px, 11px text]) plus the title cannot both fit on a 375px row, so the pill overflows the card / clips. Inline flex can't add wrap via media query.
- **Evidencia:** `<div className="card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}> … 4× <button>{o.l}</button> in a borderRadius:999 pill`
- **Arreglo:** Mechanism (1): move the header to a CSS class and `@media(max-width:768px){ flex-wrap:wrap }` (plus `flex-wrap:wrap` on the pill itself) so the toggle drops below the title. The default `.card-hd` is also nowrap flex, so the class override is the reliable fix.

**7. 🟠 P1 · SentimentScreen — group stacked-bar segments** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:1274 SentimentScreen/openGroupSlice segment buttons`
- **Problema:** The primary drill-in control per group is a 12px-tall stacked bar split into pos/neu/neg `<button>` segments. Height 12px is far below the 44px touch minimum, and each segment is also only a fraction of the bar width, so on a phone (where the bars are already halved by the 2-col grid) the neutral/negative slivers are essentially untappable.
- **Evidencia:** `<div style={{ display: 'flex', height: 12, borderRadius: 4, ... }}> … <button ... style={{ width: `${pos}%`, ... padding: 0 }} />`
- **Arreglo:** Mechanism (1): at `@media(max-width:768px)` raise the bar container height (e.g. 20-24px) via a CSS class, and/or wrap each segment button with vertical padding to create a ≥44px hit area without changing the visual bar height. Pair with finding #3's single-column reflow so segments regain width.

**8. 🟡 P2 · SentimentScreen — dimension toggle chips** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:1244 SentimentScreen/GROUP_BY toggle buttons`
- **Problema:** Toggle chips use `padding: '4px 10px'` with 11px text, yielding ~24px tall targets — below the 44px touch minimum. Same undersized pattern as the hero sentiment-legend buttons (padding 4px 6px, screens.js:1200).
- **Evidencia:** `style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 999, ... }}`
- **Arreglo:** Mechanism (1): a CSS class applying `min-height:44px` (or increased vertical padding) at `@media(max-width:768px)` for the toggle chips and legend buttons, so touch targets meet the minimum on phones while staying compact on desktop.

**9. 🟡 P2 · SentimentScreen — 'Sentimiento en el tiempo' StackedAreaChart** <sub>`chart-scale` · Móvil</sub>
- **Ubicación:** `screens.js:1223 SentimentScreen/StackedAreaChart (charts.js:470,493)`
- **Problema:** Chart width is responsive (ResizeObserver), but height is passed as a fixed 260 and the x-axis renders up to 7 date labels with `textAnchor="middle"` and no collision handling. When the card is squeezed into the 1.5fr column on a phone, adjacent date labels (e.g. '12 jul') overlap.
- **Evidencia:** `height={260} … const xTickCount = Math.min(7, data.length); … <text ... textAnchor="middle">{data[idx].date}</text>`
- **Arreglo:** Mechanism (2): thin the tick count by measured width inside StackedAreaChart (e.g. `Math.min(w < 420 ? 4 : 7, data.length)`) so labels never collide; optionally set height via clamp() for shorter charts on mobile. This is a per-component fix in charts.js, applied when SentimentScreen's chart narrows.

### Pantalla Tópicos
<sub>Topics screen (screens.js 1415-2131): TopicsScreen, TopicTreemap, SentimentBar, TopicBubbles, TopicList, TopicDetail, StatBox, TopicCalendar</sub>

*14 hallazgos — P0:1 · P1:9 · P2:4*


**1. 🔴 P0 · TopicCalendar** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:1984 TopicCalendar card-bd grid`
- **Problema:** The calendar body is an inline two-column grid `gridTemplateColumns: '1fr 200px'` with a fixed 200px legend rail on the right. Because it is an inline style it has no @media hook and never stacks. At ~375px the fixed 200px + 20px gap leaves the 7-day calendar column only ~130px, so each `repeat(7,1fr)` day cell is ~18px wide while forced to minHeight 62 — the day number (10px), truncated topic name (9px) and volume (10px) inside each cell are clipped/unreadable. Even at 768px tablet the 200px rail is disproportionate.
- **Evidencia:** `<div className="card-bd" style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 20 }}>`
- **Arreglo:** Mechanism (1): move the card-bd layout to a CSS class in index.html (e.g. `.topic-cal-body { display:grid; grid-template-columns:1fr 200px; gap:20px }`) and add `@media(max-width:768px){ .topic-cal-body{ grid-template-columns:1fr } }` so the legend drops below the calendar and the day grid gets full width. Also flip the legend's `borderLeft`/`paddingLeft` (line 2058) to a `borderTop`/`paddingTop` under the same media query.

**2. 🟠 P1 · TopicCalendar** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `screens.js:2024-2047 TopicCalendar day cell button`
- **Problema:** Each day cell uses `aspectRatio: '1 / 1', minHeight: 62, overflow: 'hidden'` and packs three stacked rows (day number, uppercase topic name truncated at 14 chars, volume). Once the column width drops below 62px the aspect-ratio can't make it square, minHeight wins, and the 9px topic label (wordBreak break-word) wraps into an unreadable stub that the `overflow:hidden` clips. Depends on the full-width fix above but still cramped at 7 columns on a phone (~50px cells).
- **Evidencia:** `aspectRatio: '1 / 1', minHeight: 62, padding: 6, ... overflow: 'hidden'  //  topic name: c.topicName.slice(0,13)+'…' at fontSize 9`
- **Arreglo:** Mechanism (2)/(3): add a JS breakpoint (useBreakpoint()==='mobile') and on mobile drop the volume line and shorten the topic truncation, or move the cell to a class and use `clamp()` for the label font plus a smaller minHeight (~48px). Keep the day-number always visible; the topic label is the expendable line on phones.

**3. 🟠 P1 · TopicTreemap** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:1528 TopicTreemap grid`
- **Problema:** Inline `gridTemplateColumns: 'repeat(4, 1fr)'` is hard-coded to 4 columns at every width, and the first two tiles additionally span 2 cols / 2 rows (lines 1532-1537). At 375px (content ~350px) a single-span tile is ~85px wide, ~57px inner after `padding:14`. That cannot hold the uppercase name + 18px count number + '+N también lo tocan' + the SentimentBar, so content overflows onto neighboring tiles.
- **Evidencia:** `style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: '76px', gap: 4 }}   // span = i<2?2:1; rowSpan = i<2?2:1`
- **Arreglo:** Mechanism (2): add a useBreakpoint() hook and on mobile branch the inline grid to `repeat(2,1fr)` while disabling the 2x2 spans (set span=1). Alternatively mechanism (1): a CSS class with `grid-template-columns:repeat(auto-fit,minmax(140px,1fr))` + a `@media(max-width:768px)` that removes the explicit `grid-column/grid-row: span 2` so tiles never fall below a legible width.

**4. 🟠 P1 · TopicTreemap** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `screens.js:1528 TopicTreemap gridAutoRows`
- **Problema:** `gridAutoRows: '76px'` fixes single-tile height at 76px. With `padding:14` (28px vertical) only ~48px remain for three text rows plus the 6px SentimentBar (which has marginTop 6). The button has no `overflow:hidden`, so on narrow phones the stacked content exceeds 48px and spills below/over the tile.
- **Evidencia:** `gridAutoRows: '76px'  ...  padding: 14, ... justifyContent: 'space-between'  (name + count + secondary + SentimentBar)`
- **Arreglo:** Mechanism (1): move to a class and replace the fixed `gridAutoRows:76px` with `grid-auto-rows:minmax(76px,auto)` (or `min-height`) so tiles grow to fit content on narrow screens instead of clipping/overflowing.

**5. 🟠 P1 · SentimentBar** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:1579-1584 SentimentBar bar + delta minWidth`
- **Problema:** The distribution bar sets `minWidth: 40` and the delta label sets `minWidth: 40` with `whiteSpace:'nowrap'`, plus `gap: 8` — a hard 88px floor. Rendered inside a single-span treemap tile whose inner width is ~57px at 375px, this row cannot shrink and forces horizontal overflow of the tile. This is the concrete mechanism behind the treemap tile spill.
- **Evidencia:** `<div style={{ display:'flex', flex:1, height:6, ... minWidth: 40 }} /> ... <span style={{ ... whiteSpace:'nowrap', minWidth:40, textAlign:'right' }}>{deltaStr}</span>`
- **Arreglo:** Mechanism (1)/(3): move the row to a class and drop the two `minWidth:40` floors (or lower to ~24px) under `@media(max-width:768px)`; the bar already flexes (`flex:1`) so removing the minWidths lets it compress. Keep the delta legible with `clamp()` font sizing rather than a fixed min-width.

**6. 🟠 P1 · TopicBubbles** <sub>`chart-scale` · Móvil</sub>
- **Ubicación:** `screens.js:1595-1646 TopicBubbles SVG viewBox`
- **Problema:** The bubble chart renders into a fixed `viewBox='0 0 960 360'` at `width:100%, height:360`. The SVG scales the whole coordinate space down to fit, so at 375px the horizontal scale is ~0.36 and the in-SVG label text (fontSize 11/14/9 user units) renders at ~4-5px — illegible — while the fixed 360px height leaves a tall, near-empty box with tiny bubbles (r 30-100 → ~11-36px).
- **Evidencia:** `const W = 960, H = 360; ... <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:360 }}>  ... <text fontSize="11"> / fontSize="14" / fontSize="9"`
- **Arreglo:** Mechanism (2): follow the charts.js pattern — measure the container width via a ref and set the viewBox width equal to the measured pixel width (so 1 user-unit = 1px and the 9-14px fonts stay true size), then re-run the pack layout for that width; drive height with `aspect-ratio`/`clamp()` instead of a fixed 360 so the box isn't mostly empty on mobile.

**7. 🟠 P1 · TopicBubbles** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:1647-1651 TopicBubbles legend`
- **Problema:** The color legend is a single-line `display:flex, justifyContent:center, gap:16` with four labeled swatches ('Positivo dominante', 'Negativo dominante', 'Mixto', 'Neutral') and no `flexWrap`. Their combined width far exceeds 375px, so the row overflows the card horizontally on phones.
- **Evidencia:** `<div style={{ display:'flex', justifyContent:'center', gap:16, fontSize:11, ... marginTop:6 }}>  // four inline-flex spans, no flexWrap`
- **Arreglo:** Mechanism (3) intrinsic: add `flexWrap: 'wrap'` (and optionally `rowGap`) to the legend container so the four items wrap onto multiple lines when narrow — no media query needed.

**8. 🟠 P1 · TopicList** <sub>`table-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:1663,1669 TopicList header + row grid`
- **Problema:** Both the header row (1663) and every data row (1669) use the identical inline 7-track grid `24px 2fr 80px 110px 1.2fr 70px 24px` with `gap:12`. The five fixed px tracks total 308px and six gaps add 72px = ~380px hard minimum before the 2fr/1.2fr tracks get any width. At ~350px phone width this overflows the card and forces horizontal scroll of the row (the fixed px tracks can't compress).
- **Evidencia:** `gridTemplateColumns: '24px 2fr 80px 110px 1.2fr 70px 24px', gap: 12  (repeated header line 1663 and row line 1669)`
- **Arreglo:** Mechanism (1): define one CSS class for the row and a `@media(max-width:768px)` variant that collapses to a phone layout — e.g. hide the Distribución (1.2fr) and Δ (70px) columns and drop to `24px 1fr auto auto`, or restructure into a two-line stacked row (name+count on top, pill+bar below). Applying it to both header and rows keeps them aligned.

**9. 🟠 P1 · TopicDetail** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:1772 TopicDetail hero stats grid`
- **Problema:** The detail hero is an inline `gridTemplateColumns: '2fr 1fr 1fr 1fr'` four-column grid holding the topic title (28px) plus three StatBoxes (30px numbers). It never reflows; at 375px each 1fr column is ~80px and the 30px StatBox values (e.g. formatted counts) crowd/overflow while the 28px title in the 2fr cell wraps awkwardly.
- **Evidencia:** `<div className="card" style={{ padding:20, display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:20, alignItems:'center' }}>`
- **Arreglo:** Mechanism (1): move to a class and `@media(max-width:768px){ grid-template-columns:1fr 1fr }` (2x2) or `1fr` (fully stacked) so the title gets a full row and the three stats sit in a 2x2 block; pair with clamp() on StatBox (see StatBox finding).

**10. 🟠 P1 · TopicDetail** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:1831 TopicDetail subtopics row grid`
- **Problema:** Each subtopic row is an inline `gridTemplateColumns: '28px 2fr 110px 110px 1.4fr'` with `gap:12`. Fixed tracks (28+110+110) + four gaps = ~296px minimum before the 2fr name (with description) and 1.4fr bar get width, so on a phone the pill and count columns crowd the name and the row overflows/clips.
- **Evidencia:** `display:'grid', gridTemplateColumns:'28px 2fr 110px 110px 1.4fr', gap:12, ... padding:'14px 18px'`
- **Arreglo:** Mechanism (1): CSS class + `@media(max-width:768px)` that stacks the row — e.g. name+count+pill on the first line and the pos/neg distribution bar full-width beneath — instead of five side-by-side columns.

**11. 🟡 P2 · StatBox** <sub>`font-scale` · Móvil</sub>
- **Ubicación:** `screens.js:1917 StatBox value`
- **Problema:** StatBox renders its value at a fixed `fontSize: 30`. Inside the narrow 1fr cells of the detail hero grid on a phone, multi-digit formatted numbers at 30px can overflow their ~80px column.
- **Evidencia:** `<div className="num" style={{ fontSize: 30, fontWeight: 600, ... }}>{value}</div>`
- **Arreglo:** Mechanism (3): replace the fixed `fontSize:30` with `clamp(20px, 5vw, 30px)` (via a class) so the stat number scales down on narrow columns without a media query. Best done together with the hero-grid reflow fix.

**12. 🟡 P2 · TopicsScreen / TopicCalendar** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:1457 view-toggle chips; screens.js:2062 calendar legend buttons`
- **Problema:** The Treemap/Burbujas/Lista toggle chips use `.chip` (padding 5px 10px, font 11px → ~24px tall) and the calendar legend buttons use `padding:'4px 6px'` with 11px text (~24px tall). Both are well below the 44px minimum comfortable tap target on phones.
- **Evidencia:** `className={`chip ...`} (padding:5px 10px in index.html:365)  //  legend: style={{ ... padding:'4px 6px' ... }}`
- **Arreglo:** Mechanism (1): under `@media(max-width:768px)` add `min-height:44px` (and adequate horizontal padding) to `.chip` and to a class on the legend buttons so each interactive control meets a 44px hit area on touch devices.

**13. 🟡 P2 · TopicsScreen** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:1447-1463 panorámica card-hd view toggle`
- **Problema:** The panoramic card header puts the title/subtitle block and the three-chip view toggle in a `.card-hd` that is `display:flex; justify-content:space-between` with NO flex-wrap (index.html:308-315). The toggle group is ~200px of non-shrinking content, so on a phone the title (flex:1, min-width:0) is squeezed and wraps to several lines beside the chips rather than the toggle dropping to its own row.
- **Evidencia:** `.card-hd { display:flex; align-items:center; justify-content:space-between; gap:12px }  (no flex-wrap) ; toggle = 3 chips at line 1449`
- **Arreglo:** Mechanism (1): add `@media(max-width:768px){ .card-hd{ flex-wrap:wrap } }` in index.html so the toggle group wraps beneath the title on narrow screens, giving the title full width.

**14. 🟡 P2 · TopicDetail** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `screens.js:1865 evolution AreaLineChart height`
- **Problema:** The evolution chart is rendered with a hard-coded `height={200}`. Width is responsive (charts.js measures the container) but the fixed height combined with a narrow phone width can crowd the x-axis date ticks so labels collide. Lower priority than the grid defects but worth normalizing.
- **Evidencia:** `<AreaLineChart data={topic.evolution} accessor={(d)=>d.count} height={200} color="var(--accent)" />`
- **Arreglo:** Mechanism (2)/(3): pass a breakpoint-aware height (e.g. useBreakpoint()==='mobile' ? 160 : 200) or let AreaLineChart accept a `clamp()`/aspect-ratio-based height, and ensure the chart thins x-tick density at narrow widths (an internal charts.js concern to verify).

### Pantalla Geografía (mapa)
<sub>Geography screen (GeographyScreen, screens.js:2132-2260) — Leaflet PR map + Top-municipios / Sentimiento-por-región two-column block</sub>

*7 hallazgos — P0:2 · P1:0 · P2:5*


**1. 🔴 P0 · GeographyScreen — Top municipios / Sentimiento por región block** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:2203 GeographyScreen two-column grid`
- **Problema:** The lower block is a hardcoded inline two-column grid that cannot carry a media query, so it never collapses to one column on a phone. At 375px the page content is ~351px; two `1fr` columns with a 12px gap give ~169px each, and inside each card (border + 16px card-bd padding) only ~135px of inner width remains. The HBarList row it hosts needs a fixed 120px label + 44px number = 164px of non-flexible content alone, so the bar track (flex:1) collapses to ~0 and the number overflows the card's right edge, pushing horizontal scroll.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>  (inline style object — no @media possible)`
- **Arreglo:** Mechanism (3) intrinsic fluid grid: change the inline value to `gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))'`, which needs no @media and reflows to a single column below ~280px per track — keeping the file's inline-only styling constraint. Alternatively (mechanism 1) move to a `.geo-two-col` class in index.html with `@media (max-width:768px){ grid-template-columns:1fr; }`.

**2. 🔴 P0 · Page container (inherited) — .eco-page scroll guard** <sub>`scroll-guard` · Tablet</sub>
- **Ubicación:** `index.html:283-288 .eco-page min-width guards`
- **Problema:** GeographyScreen renders inside `.eco-page`, which is force-widened to min-width:900px (>=900 viewport) and min-width:1120px (>=1120 viewport). Any viewport in the 900-1119px band (large tablet landscape / narrow laptop) is forced to at least 1120px, so the whole map+grid page scrolls horizontally inside `.eco-main`'s overflow-x:auto instead of reflowing. This is the core scroll-guard defect and it governs this screen's tablet behavior.
- **Evidencia:** `@media (min-width: 900px){ .eco-page { min-width: 900px; } }  @media (min-width: 1120px){ .eco-page { min-width: 1120px; } }  + .eco-main { overflow-x: auto; }`
- **Arreglo:** Mechanism (1): remove the min-width scroll guards and let the inner grids reflow (once F1-type fixed grids are made fluid). Replace with a `max-width` centering wrapper rather than a `min-width` floor so content shrinks to the viewport instead of forcing horizontal scroll.

**3. 🟡 P2 · PRMap — Leaflet container height** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:773 PRMap container (and charts.js:763 loading placeholder)`
- **Problema:** The Leaflet container (and its 'Cargando mapa…' placeholder) has a hardcoded 420px height. It is not fluid, and on a narrow phone Leaflet's fitBounds(padding:[24,24], maxZoom:10) over-zooms-out inside a very narrow container, framing PR small with large empty margins. Width is fine (block div at 100%), only height is rigid.
- **Evidencia:** `style={{ height: 420, borderRadius: 8, overflow: 'hidden', ... }}  and placeholder style={{ height: 420, ... }}`
- **Arreglo:** Mechanism (3) fluid CSS: replace the two literal `height: 420` inline values with `height: 'clamp(300px, 58vh, 460px)'` (works with no @media). Also reduce the fitBounds padding on narrow containers (e.g. `padding: containerRef.current.clientWidth < 480 ? [8,8] : [24,24]`) so the map isn't over-zoomed-out on phones.

**4. 🟡 P2 · GeographyScreen — map legend row** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:2193-2199 legend under map`
- **Problema:** The centered legend flex row has gap:20 and no wrap. In 'Sentimiento' mode it shows three labeled dots ('Positivo (>+2)', 'Neutral', 'Negativo (<-2)'). Inside the map card (24px card-bd padding, inner ~301px at 375px) the three items + two 20px gaps sit right at the edge and overflow on ~320px phones, causing horizontal overflow of the legend row.
- **Evidencia:** `<div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 11, ... }}>  — no flexWrap`
- **Arreglo:** Mechanism (3): add `flexWrap: 'wrap'` and `rowGap: 8` to the inline style; wrapping needs no media query and lets the three legend items stack to two rows on narrow phones.

**5. 🟡 P2 · GeographyScreen — map card body padding** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `screens.js:2186 map card-bd inline padding`
- **Problema:** The map card overrides the default `.card-bd { padding:16px }` with an inline `padding: 24`. The mobile media rule `.eco-page > .card { padding: 0 }` targets the card, not this inline card-bd override, so 24px per side survives on phones and eats 48px of a 375px viewport, shrinking the map and legend.
- **Evidencia:** `<div className="card-bd" style={{ padding: 24 }}>  (overrides index.html:320 .card-bd padding:16px; not touched by the max-width:768px rule at index.html:294)`
- **Arreglo:** Mechanism (3): replace with `padding: 'clamp(12px, 3vw, 24px)'` inline so it keeps 24px on desktop and tightens to ~12px on phones without any media query.

**6. 🟡 P2 · GeographyScreen — Volumen/Sentimiento metric toggle chips** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:2181-2183 metric chips (styled by index.html:363 .chip)`
- **Problema:** The two primary metric toggles are `.chip` buttons with padding 5px 10px and font 11px, rendering ~22-24px tall — well under the 44px minimum tap target. These are the main control for switching the whole map between Volumen and Sentimiento.
- **Evidencia:** `.chip { padding: 5px 10px; font-size: 11px; }  (index.html:363-366) used by <button ... className={`chip ...`}> at screens.js:2182`
- **Arreglo:** Mechanism (1): add a `@media (max-width:768px)` block in index.html bumping `.chip` to `min-height:40px; padding:9px 14px`. A shared class change is correct here since chips are reused site-wide.

**7. 🟡 P2 · HBarList — Top municipios rows (clickable drill-down)** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `charts.js:539-554 HBarList clickable row (used at screens.js:2207)`
- **Problema:** Each Top-municipio row is a full-width button but its vertical hit area is only padding '4px 6px' around 12px text (~20-28px tall), below the 44px minimum. These rows are a primary drill-down (they open the municipality slice modal), so the small vertical target matters on phones.
- **Evidencia:** `padding: clickable ? '4px 6px' : 0  (charts.js:543); label width:120 (charts.js:549) + number width:44 (charts.js:553) are also fixed, compounding F1 inside a narrow column`
- **Arreglo:** Mechanism (2) JS breakpoint: branch the row padding on a useBreakpoint()/matchMedia hook to '10px 6px' on mobile so the row reaches ~44px, and consider clamping the 120px label width (e.g. minmax via a CSS class) so the fixed label doesn't starve the bar track in narrow layouts.

### Pantalla Alertas
<sub>Alerts screen (screens.js:2266-2822): CrisisAlertsTab, ReportsTab, AlertsScreen, AlertRuleEditor, AlertsHistory</sub>

*14 hallazgos — P0:3 · P1:8 · P2:3*


**1. 🔴 P0 · Rules table (header + rows)** <sub>`table-overflow` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:2580 & 2584 AlertsScreen/rules-tab`
- **Problema:** The rules list is a 7-column inline grid whose fixed tracks sum to ~510px plus a 2fr name column plus six 12px gaps (~72px). Minimum viable width is ~700px+. On a 375px phone (content ~319px) it overflows massively -> horizontal scroll/clipping; at 768px tablet it barely fits and the name column is squeezed to ~100px. Being an inline template, it cannot reflow via @media.
- **Evidencia:** `gridTemplateColumns: '2fr 80px 80px 80px 120px 120px 30px', gap: 12 (identical on header line 2580 and each row line 2584)`
- **Arreglo:** Mechanism 1 (CSS class + @media): move the template to a .rules-table-row class in index.html; at @media(max-width:768px) switch each row to a stacked card layout (display:block / grid-template-columns:1fr with label spans) or, minimally, wrap the whole table in an overflow-x:auto container with a min-width so the horizontal scroll is confined to the table instead of the page. Inline JSX cannot hold the @media, so the template must leave the style object.

**2. 🔴 P0 · Alerts tab bar** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:2529 AlertsScreen/tab-bar`
- **Problema:** The tab bar is a single flex row with no wrap holding 5 chips ('Feed en vivo', 'Reglas', 'Alertas de crisis', 'Historial', 'Reportes por correo'), a flex:1 spacer, and the 'Nueva regla' button. Combined chip width (~500px+) plus button exceeds a 319px phone content width; flex items don't shrink below content and the spacer collapses to 0, so the whole primary navigation forces page-level horizontal scroll and the trailing tabs/button become hard to reach.
- **Evidencia:** `<div style={{ display: 'flex', gap: 6 }}> ... 5 chips ... <div style={{ flex: 1 }} /> ... <button className="btn btn-primary">Nueva regla</button>`
- **Arreglo:** Mechanism 3 (intrinsically fluid): give the row a .alerts-tabbar class with flex-wrap:wrap and drop/neutralize the flex:1 spacer at <=768px (a spacer forces the button onto its own line and defeats wrapping). Optionally at mobile render the tabs as a horizontally-scrollable chip rail (overflow-x:auto; flex-nowrap on the chips only) so nav scrolls independently of the page.

**3. 🔴 P0 · Scroll guard on page container** <sub>`scroll-guard` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:283-288 .eco-page min-width guards`
- **Problema:** The page wrapper is forced to min-width:900px (>=900px viewport) and min-width:1120px (>=1120px), with .eco-main overflow-x:auto. This guarantees the entire Alerts screen scrolls horizontally rather than reflowing at tablet/laptop widths and is the structural reason the fixed grids below never get a chance to collapse. It is a defect to remove, not baseline behavior.
- **Evidencia:** `@media (min-width: 900px) { .eco-page { min-width: 900px; } } @media (min-width: 1120px) { .eco-page { min-width: 1120px; } } and .eco-main { overflow-x: auto; }`
- **Arreglo:** Mechanism 1: remove the two min-width guards so .eco-page can shrink, then make each wide unit responsible for its own overflow — data tables get an inner overflow-x:auto wrapper, grids switch to auto-fit/minmax or @media stacking. Keeping the guard only masks the un-reflowed grids.

**4. 🟠 P1 · KPI strips (all three Alerts tabs)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:2522 AlertsScreen (also 2300 CrisisAlertsTab, 2420 ReportsTab)`
- **Problema:** Each tab opens with a 4-up KPI grid hard-coded to repeat(4,1fr). On a 375px phone each card is ~72px wide; KpiCard renders a 34px value with overflow:hidden, so multi-word values clip badly — e.g. ReportsTab 'Proximo envio' value 'manana 06:00' and AlertsScreen 'Tiempo mediano respuesta' label are truncated. Same defect repeats at three lines.
- **Evidencia:** `style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }} at 2300, 2420, 2522; KpiCard value fontSize:34 with overflow:hidden (screens.js:19,38)`
- **Arreglo:** Mechanism 3 (fluid, no media query): replace the inline template with a shared .kpi-grid class using grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) so it becomes 2-up around ~330px and 1-up on the narrowest phones. Alternatively Mechanism 1 with @media(max-width:768px){ grid-template-columns:1fr 1fr }. Also consider clamp() on the 34px KpiCard value font (font-scale) so it shrinks with the card.

**5. 🟠 P1 · AlertsHistory detail rows** <sub>`table-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:2809 AlertsHistory/detalle`
- **Problema:** History rows use a 4-column inline grid '120px 140px 1fr 90px'. Fixed tracks alone total 350px plus gaps (~36px) exceed a phone row width (~287px after padding), forcing overflow. Worse, the timestamp column is only 120px but holds a full es-PR toLocaleString datetime (e.g. '22/7/2026, 3:45:00 p. m.') that cannot fit and wraps/clips.
- **Evidencia:** `gridTemplateColumns: '120px 140px 1fr 90px', gap: 12 ... new Date(r.triggeredAt).toLocaleString('es-PR', { timeZone: 'America/Puerto_Rico' })`
- **Arreglo:** Mechanism 1: move to a .history-row class and at @media(max-width:768px) stack to two lines (timestamp+severity on row 1, rule + count on row 2) or single column. Also shorten the timestamp with dateStyle:'short'/timeStyle:'short' so it fits its track. Inline template cannot carry the @media.

**6. 🟠 P1 · AlertRuleEditor form grid** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:2712 AlertRuleEditor/fields`
- **Problema:** Inside the modal (width min(560px,94vw), good) the field pairs Topico/Sentimiento and Pertinencia/Umbral sit in a fixed two-column grid. On a 375px phone the modal is ~352px wide, minus 22px*2 padding -> ~308px, so each select/number field is ~145px — cramped for the select labels and tap-unfriendly. The template is inline so it stays 2-up on the narrowest screens.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}> wrapping the Topico/Sentimiento/Pertinencia/Umbral <label>s`
- **Arreglo:** Mechanism 3: use grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) via a .rule-editor-grid class so the pairs collapse to a single column under ~340px, or Mechanism 1 @media(max-width:480px){ grid-template-columns:1fr }. The fields already using gridColumn:'1 / -1' stay full width.

**7. 🟠 P1 · Feed action buttons row** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:2558 AlertsScreen/feed-item-actions`
- **Problema:** Each feed event's action row is a no-wrap flex holding three chips ('Ver menciones', 'Marcar atendida', 'Silenciar regla 1h', ~320px combined) inside a content column already narrowed by the timeline gutter. On a phone these overflow the card / clip since there is no flex-wrap.
- **Evidencia:** `<div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}> with three <button className="chip"> children`
- **Arreglo:** Mechanism 3: add flex-wrap:wrap (via a small class or inline flexWrap:'wrap' — flexWrap is a valid inline prop) so the chips wrap to a second line on narrow screens. No @media needed.

**8. 🟠 P1 · Rules row controls (toggle, channel icons, More)** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:2591, 2599, 2603 AlertsScreen/rules-row`
- **Problema:** The active/inactive toggle track is 28x16px, channel icon chips are 24x24px, and the row's only overflow action is a bare 14px More icon with no padding. All are well under the 44px minimum tap target, and the More icon has no hit-padding at all, making per-rule actions nearly untappable on touch.
- **Evidencia:** `toggle: width: 28, height: 16 (2591); channels: width: 24, height: 24 (2599); <Icons.More size={14} color="var(--text-3)" /> (2603)`
- **Arreglo:** Mechanism 1/2: at mobile wrap each control in a >=44px hit area (padding + min-width/min-height) via a .row-action class; make the More icon a real <button> with 44px min touch area. Toggle can keep its 28px visual but needs an enlarged transparent hit box.

**9. 🟠 P1 · Tab/feed chip touch targets** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:2530-2534 & 2559-2568 AlertsScreen chips`
- **Problema:** .chip is padding:5px 10px at font-size:11px giving ~24px height. The tab chips are the primary screen navigation and the feed chips are the acknowledge/mute actions, so sub-44px height makes core interactions hard to hit on phones.
- **Evidencia:** `.chip { padding: 5px 10px; font-size: 11px } (index.html:363-366); used for all tab buttons (2530-2534) and feed actions (2559-2568)`
- **Arreglo:** Mechanism 1: add a @media(max-width:768px) rule bumping .chip min-height:40px and vertical padding so tab and action chips clear the touch minimum; keep desktop compact.

**10. 🟠 P1 · ReportsTab config iframe** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:2468 ReportsTab/iframe`
- **Problema:** The embedded /settings/reports form is given a hard height:1200px. When that Next.js page reflows on mobile its fields stack and the content grows taller than 1200px, so the bottom (save button / recipients) gets clipped with no inner scroll surfaced; on desktop an over-tall value leaves dead whitespace. width:100% is correct but the fixed px height is brittle across breakpoints.
- **Evidencia:** `src="/settings/reports?embed=1" style={{ width: '100%', height: 1200, border: 'none', ... }}`
- **Arreglo:** Mechanism 2 (JS): use postMessage from the embedded page to report its scrollHeight and set the iframe height dynamically (the embed already opts in via ?embed=1). Failing that, raise the height and/or allow the iframe to scroll; a fixed px height cannot track the mobile-reflowed content.

**11. 🟠 P1 · CrisisAlertsTab config iframe** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:2348 CrisisAlertsTab/iframe`
- **Problema:** Same pattern as ReportsTab: the crisis-alert config iframe is pinned to height:1100px. A mobile reflow of the embedded /settings/alerts form grows past 1100px and its lower controls clip; on wide screens it may leave empty space.
- **Evidencia:** `src="/settings/alerts?embed=1" style={{ width: '100%', height: 1100, border: 'none', ... }}`
- **Arreglo:** Mechanism 2 (JS): postMessage-driven auto-height from the embedded page, same as the ReportsTab iframe. Do not rely on a fixed px height for embedded, independently-reflowing content.

**12. 🟡 P2 · Feed item header row** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:2552 AlertsScreen/feed-item-header`
- **Problema:** The header flex row (severity pill + rule name + time-with-marginLeft:auto) does not wrap and the rule name span has no truncation, so a long rule name pushes the timestamp off the right edge or forces the row wider than the card on narrow screens.
- **Evidencia:** `<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}> ... <span style={{ fontSize: 13, fontWeight: 600 }}>{a.rule}</span> ... <span style={{ marginLeft: 'auto', ... }}>{a.time}</span>`
- **Arreglo:** Mechanism 3: allow flexWrap:'wrap' on the row and add min-width:0 + white-space/text-overflow ellipsis on the rule-name span so the timestamp stays visible on phones.

**13. 🟡 P2 · AlertsHistory day bar chart** <sub>`chart-scale` · Móvil</sub>
- **Ubicación:** `screens.js:2793 AlertsHistory/bar-chart`
- **Problema:** The per-day mini bar chart uses repeat(days.length,1fr) with a fixed height:110px. The 1fr grid is fluid so width is fine, but for a 1M/30-day period on a ~287px phone bars become ~8px and the only x-axis labels are first/last day — dense periods are hard to read, and the fixed 110px height doesn't scale down for very short mobile viewports.
- **Evidencia:** `gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 2, height: 110`
- **Arreglo:** Mechanism 3: keep the fluid 1fr grid but use height:clamp(80px,18vw,120px); on mobile consider thinning to weekly buckets or reducing gap. Low priority — the fluid grid already prevents overflow.

**14. 🟡 P2 · AlertsScreen toast** <sub>`absolute-pos` · Móvil</sub>
- **Ubicación:** `screens.js:2624-2632 AlertsScreen/toast`
- **Problema:** The toast is fixed at bottom:24 right:24 with no max-width. A longer error message ('No se pudo guardar la regla') plus icon can exceed a 375px viewport minus 24px insets, overflowing off-screen right on phones.
- **Evidencia:** `position: 'fixed', bottom: 24, right: 24, ... padding: '10px 16px' (no maxWidth/left constraint)`
- **Arreglo:** Mechanism 3: add maxWidth: 'calc(100vw - 32px)' (inline, valid) or at @media(max-width:768px) pin left:12/right:12 so the toast spans the width and wraps instead of overflowing.

### Pantalla Configuración / Usuarios
<sub>Settings screen (SettingsScreen / UsersAdmin / UserDrawer / Field / AlertsPrefs)</sub>

*12 hallazgos — P0:3 · P1:4 · P2:5*


**1. 🔴 P0 · UsersAdmin** <sub>`table-overflow` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:3037 UsersAdmin users-table header row`
- **Problema:** The users-table header uses a fixed inline grid whose three 110px columns + 40px chevron + 12px gaps + 36px horizontal padding require ~466px before the 1.6fr/1.2fr fractional columns can claim any width. Inline styles cannot hold @media, so it never reflows: on a ~440px tablet content column it already overflows (horizontal scroll via .eco-main overflow-x:auto), and at 375px it is far wider than the viewport.
- **Evidencia:** `gridTemplateColumns: '1.6fr 1.2fr 110px 110px 110px 40px', gap: 12, padding: '10px 18px'`
- **Arreglo:** Mechanism (2) JS breakpoint hook (useBreakpoint()==='mobile'): on mobile hide this uppercase column header entirely and render each user as a stacked label/value card; on tablet branch the template to drop to fewer columns (e.g. 'user role status'). The row structure is data-driven, so a JS branch is cleaner than a CSS class here.

**2. 🔴 P0 · UsersAdmin** <sub>`table-overflow` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:3052 UsersAdmin users-table body row`
- **Problema:** Each user row repeats the same fixed 6-track template as the header, so every data row overflows on phone/tablet and forces horizontal scrolling of primary content. Name/email cells already ellipsize, but Agencia/Rol/Estado/actividad columns are fixed and cannot collapse.
- **Evidencia:** `gridTemplateColumns: '1.6fr 1.2fr 110px 110px 110px 40px', gap: 12, padding: '12px 18px', alignItems: 'center'`
- **Arreglo:** Mechanism (2) JS breakpoint: on mobile switch the row to display:flex/flex-direction:column (avatar+name+email header, then labeled meta rows for agency/role/status/lastSeen, chevron top-right). Keep the desktop grid for >=900px. Must match the header fix in screens.js:3037 so the two stay in sync.

**3. 🔴 P0 · UsersAdmin** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:3014 UsersAdmin roles-at-a-glance grid`
- **Problema:** The four role cards are laid out with a fixed repeat(4,1fr) inline grid that never collapses. In a ~440px tablet content column each card is ~110px (title, description and up to 4 permission pills crushed and wrapping); at 375px inside the squeezed content column each card is ~30-60px wide and the content is illegible. The vertical borderRight dividers also assume a permanently horizontal layout.
- **Evidencia:** `display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 ... borderRight: i < ROLES.length - 1 ? '1px solid var(--hairline)' : 'none'`
- **Arreglo:** Mechanism (3) intrinsically-fluid CSS: move to a class in index.html using grid-template-columns: repeat(auto-fit, minmax(180px,1fr)) with a real gap, and replace the per-card borderRight (which only works horizontally) with a card border or gap so cards read correctly when they wrap to 2 or 1 columns.

**4. 🟠 P1 · SettingsScreen** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:2831 SettingsScreen root layout`
- **Problema:** The screen is a fixed '220px 1fr' inline grid: a 220px section-nav column plus content. Inline styles cannot reflow, so on a 375px phone the 220px rail consumes ~59% of the width and leaves the entire UsersAdmin/AlertsPrefs content column only ~135px, compounding every downstream overflow. The nav holds just two items and does not need a permanent 220px sidebar on small screens.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>`
- **Arreglo:** Mechanism (2) JS breakpoint (or (1) CSS class + @media(max-width:768px){grid-template-columns:1fr}): on mobile/tablet stack to a single column and render the two sections as a horizontal tab strip (flex-wrap) above the content instead of a side rail.

**5. 🟠 P1 · UserDrawer** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3119 UserDrawer identity form grid`
- **Problema:** The identity fields (Nombre, Correo, Agencia, Estado) use a fixed inline '1fr 1fr' grid. Inside the drawer (max-width:95vw ≈ 356px on a 375px phone, minus 24px padding each side ≈ 308px content), each column is only ~148px, which cramps the two-line Field label plus input and truncates the 'nombre@agencia.pr.gov' email placeholder.
- **Evidencia:** `<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>`
- **Arreglo:** Mechanism (2) JS breakpoint to branch gridTemplateColumns to '1fr' on mobile, or (1) move to a CSS class with @media(max-width:520px){grid-template-columns:1fr}. Keep 2-up on tablet/desktop where width allows.

**6. 🟠 P1 · UserDrawer** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3217 UserDrawer recent-activity grid`
- **Problema:** The activity-log rows use a fixed '100px 1fr 120px' inline grid (timestamp / action / IP). The 100px+120px fixed tracks + 16px gaps + 24px padding consume ~244px of a ~308px drawer content area, leaving the action text (e.g. 'Exportó reporte semanal') ~64px, which wraps to several lines while the IP column stays wastefully wide.
- **Evidencia:** `gridTemplateColumns: '100px 1fr 120px', gap: 8, padding: '10px 12px'`
- **Arreglo:** Mechanism (1) CSS class + @media(max-width:520px): collapse to two rows — first row 'auto 1fr' (timestamp + action), IP on its own line below in muted mono — or drop the IP column on mobile. A JS breakpoint branch of the template also works.

**7. 🟠 P1 · AlertsPrefs** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:3336 AlertsPrefs channel toggle button`
- **Problema:** The channel on/off toggle is the primary control on this screen but its hit area is only 36x20px, well under the 44x44 minimum for reliable tapping; the moving knob is 16px. On a phone this is easy to miss and there is no adjacent label click target (the destination input is separate).
- **Evidencia:** `style={{ width: 36, height: 20, borderRadius: 999, ... position: 'relative', cursor: 'pointer', padding: 0 }}`
- **Arreglo:** Mechanism (2)/(3): keep the 36x20 track as an inner <span>, but give the <button> a min 44x44 hit area via padding (e.g. padding: '12px' with the track centered) or wrap it; alternatively make the whole channel row / status label also toggle. Ensure the enlarged hit area does not disturb the grid cell alignment.

**8. 🟡 P2 · UserDrawer** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3178 UserDrawer data-scope agency grid`
- **Problema:** The 'Alcance de datos' agency checkboxes use a fixed repeat(2,1fr) inline grid. Inside the ~308px drawer content minus 12px padding, each column is ~140px — borderline for labels like 'Educación' with a checkbox, and rigidly two-up even on the narrowest phones.
- **Evidencia:** `display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8`
- **Arreglo:** Mechanism (3) intrinsically-fluid: replace with grid-template-columns: repeat(auto-fit, minmax(120px,1fr)) in a CSS class so it drops to a single column when the drawer is very narrow.

**9. 🟡 P2 · UserDrawer** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:3163 UserDrawer role-picker permissions row`
- **Problema:** Inside each role option, the permission pills sit in a flex row with no wrap, alongside the role title in another nowrap flex row. The 'admin' role carries 4 pills (read/write/admin/billing); next to 'Administrador' in a narrow drawer these overflow their label card rather than wrapping.
- **Evidencia:** `<div style={{ display: 'flex', gap: 4 }}> {r.perms.map(p => <span ... className="pill" ...) } (parent row: display:'flex', alignItems:'center', gap:8)`
- **Arreglo:** Mechanism (3): add flexWrap:'wrap' to the perms container (and allow the title/perms parent row to wrap) so the pills flow to a second line on narrow drawers instead of overflowing. Pure inline change, no media query needed.

**10. 🟡 P2 · UserDrawer** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:3228 UserDrawer footer actions row`
- **Problema:** In edit mode the footer holds three buttons in a nowrap flex row: a flex:1 primary ('Guardar cambios' + icon), plus 'Eliminar' and 'Cancelar'. On a ~308px drawer these three icon+text buttons can exceed the width; with no wrap they either overflow or squeeze the primary label.
- **Evidencia:** `<div style={{ display: 'flex', gap: 8, paddingTop: 8, ... }}> (primary flex:1, plus Eliminar and Cancelar buttons)`
- **Arreglo:** Mechanism (3): add flexWrap:'wrap' to the actions container so the secondary buttons drop to a second line on narrow screens; optionally give the primary a min-width so it stays legible when wrapped.

**11. 🟡 P2 · UserDrawer** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:3112 UserDrawer close button`
- **Problema:** The drawer close control is an icon-only .btn (Icons.Close size 14). With .btn padding 7px 14px the tappable box is roughly 42x30px — under the 44x44 touch minimum, and it is the primary way to dismiss the drawer on mobile.
- **Evidencia:** `<button className="btn" onClick={onClose}><Icons.Close size={14} /></button>  (.btn { padding: 7px 14px; font-size:13px } index.html:381)`
- **Arreglo:** Mechanism (1): add an icon-button modifier class (e.g. .btn-icon { min-width:44px; min-height:44px; justify-content:center; }) in index.html and apply it here, so icon-only buttons meet the touch minimum without affecting text buttons.

**12. 🟡 P2 · AlertsPrefs** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:3314 AlertsPrefs channel row grid`
- **Problema:** Each channel row is a '1fr auto 40px' inline grid (label+input / status text / toggle). The template itself is mostly fluid, but the 'auto' ACTIVO/INACTIVO text (~55px) + 40px toggle + gaps leave the 1fr destination input very narrow once this whole card is squeezed inside the 220px-nav-constrained SettingsScreen content column on a phone.
- **Evidencia:** `display: 'grid', gridTemplateColumns: '1fr auto 40px', alignItems: 'center', gap: 12, padding: '12px 14px'`
- **Arreglo:** Primarily resolved by fixing the SettingsScreen parent grid (screens.js:2831). Additionally, mechanism (1)/(2): on mobile move the status label onto its own line (grid-template-columns:'1fr 40px', status text under the input) so the destination input keeps usable width.

### Pantalla Narrativas (SPA)
<sub>Narratives screen (SPA) — screens.js:3952-4635</sub>

*12 hallazgos — P0:1 · P1:8 · P2:3*


**1. 🔴 P0 · NarrativeScreen (entire subtree)** <sub>`no-breakpoint` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:4077 NarrativeScreen root .narrative-screen (+ .narrative-menu 4078, .narrative-canvas 4138, .narrative-analysis 4222)`
- **Problema:** Every layout class the screen renders has NO backing CSS anywhere, so the intended two-pane (aside menu + main analysis canvas) never lays out — it collapses to default block flow. There is nothing responsive because there is no CSS at all; grep confirms 0 `.narrative-` selectors in index.html, all prototype JS, and dist. The screen is live (routed /narrative, app.js:340), not dead code.
- **Evidencia:** `screens.js:4077 `<div className="narrative-screen">` wrapping `<aside className="narrative-menu">` (4078) + `<main className="narrative-canvas">` (4138); `grep -rn '\.narrative-' index.html *.js dist/` => 0 matches; index.html <style> spans lines 12-583 with no narrative rule; no`
- **Arreglo:** Author the full `.narrative-*` CSS in index.html's <style> block, responsive from the start (mechanism 1: CSS classes + @media). `.narrative-screen{display:flex}` with `.narrative-menu` a fixed-basis column (flex:0 0 300px) on desktop, collapsing under `@media(max-width:768px)` to a full-width single-pane master-detail (mechanism 2: a useBreakpoint()/matchMedia hook toggling list vs. analysis, driven by the existing focusedId state) so the list and analysis don't both fight ~319px next to the app's 56px rail.

**2. 🟠 P1 · NarrativeStreamgraph SVG** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:4496 .narrative-stream-svg (viewBox 0 0 1080 240, preserveAspectRatio xMidYMid meet); w=1080 at 4422; label fontSize 10 at 4541 (pico) and 4553 (month ticks)`
- **Problema:** The streamgraph is drawn in a fixed 1080-unit-wide coordinate system and scales as one unit to fill the container, so all text (month ticks, pico) is sized in viewBox units. At 375px CSS width the scale factor is ~0.347, rendering fontSize 10 labels at ~3.5px — illegible; at 768px still ~7px. Margins (left/right 24) and tick spacing are also frozen to the 1080 grid.
- **Evidencia:** `screens.js:4422 `const w = 1080;`, 4496 `viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet"`, 4553 `<text ... fontSize="10">{month/year}</text>`, 4541 pico `<text ... fontSize="10">`.`
- **Arreglo:** Stop scaling the whole graphic. Measure the container width with a ref (mirror the pattern already in charts.js) and set the viewBox width = measured px so font sizes stay in real pixels; OR branch geometry on a JS breakpoint (mechanism 2) to shrink margins, bump relative font size, and thin ticks further on mobile.

**3. 🟠 P1 · NarrativeStreamgraph SVG height** <sub>`fixed-height` · Móvil</sub>
- **Ubicación:** `screens.js:4423 const h = 240 rendered via viewBox+preserveAspectRatio meet at 4496 (.narrative-stream-svg has no CSS height)`
- **Problema:** With no CSS on .narrative-stream-svg and preserveAspectRatio meet + implicit width:100%, height is locked to the 1080:240 (4.5:1) ratio. At 375px width the SVG renders only ~83px tall, squashing the three stacked sentiment bands into an unreadable sliver.
- **Evidencia:** `screens.js:4423 `const h = 240;` inside `viewBox="0 0 1080 240"` (4496); no `.narrative-stream-svg{height:...}` rule anywhere.`
- **Arreglo:** Decouple height from width: give the SVG a CSS height like `height:clamp(160px,40vh,240px)` (mechanism 3, fluid) and recompute the viewBox width from a measured container width (mechanism 2) so the aspect ratio isn't frozen at 4.5:1 when narrow.

**4. 🟠 P1 · NarrativeStreamgraph day hit-targets** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:4510-4517 per-day rect width Math.max(1, x1 - x0) (midpoints across innerW=1032 units)`
- **Problema:** Clicking a day column is the ONLY way to open the NarrativeDayDrawer. Each clickable rect spans innerW/N viewBox units; for a ~90-day timeline that is ~11 units, i.e. ~4px on a 375px screen — far below the 44px touch minimum, so the day-drill interaction is effectively untappable on phones.
- **Evidencia:** `screens.js:4506 `const x1 = next ? (p.x + next.x) / 2 : p.x + 2;`, 4513 `width={Math.max(1, x1 - x0)}`, innerW = 1080-48 = 1032 (4425); onClick at 4516 is the sole trigger for onSelectDay.`
- **Arreglo:** On mobile switch the interaction model (mechanism 2, JS breakpoint): use a single full-width transparent overlay that maps a tap x to the nearest day index, and/or bucket the timeline to weekly points on small screens so each target is wide enough. Add a visible focus affordance sized >=44px.

**5. 🟠 P1 · Analysis panel grids (.narrative-grid-3 / .narrative-grid-2)** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:4263 .narrative-grid-3 (Sentimiento/Top voces/Plataformas); 4330 .narrative-grid-2 (Primera mencion / Voz influyente)`
- **Problema:** These wrappers imply 3-column and 2-column panel grids but have no CSS, so on desktop they don't form a grid at all, and once authored the obvious repeat(3,1fr)/repeat(2,1fr) would not reflow on narrow screens (inline objects can't hold @media).
- **Evidencia:** `screens.js:4263 `<div className="narrative-grid-3">` holds three .narrative-panel children; 4330 `<div className="narrative-grid-2">` holds two; no CSS defines either.`
- **Arreglo:** Author them intrinsically fluid (mechanism 3, no media query): `.narrative-grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}` and `.narrative-grid-2{...minmax(260px,1fr)}` so they degrade 3->2->1 and 2->1 automatically.

**6. 🟠 P1 · NarrativeAnalysis header (.narrative-header / .narrative-header-metrics)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `screens.js:4223 .narrative-header; 4224 .narrative-header-main; 4240 .narrative-header-metrics (3 metric tiles)`
- **Problema:** The header pairs a title/summary/keywords block beside a 3-tile metrics block. With no CSS and once styled as a side-by-side row, the long narrative title plus the three metric tiles (Menciones/Vel.24h/Engagement) will overflow or crush at ~319px.
- **Evidencia:** `screens.js:4223-4254: .narrative-header contains .narrative-header-main (title h2 at 4229 + summary + keyword tags) and .narrative-header-metrics (three .narrative-metric tiles).`
- **Arreglo:** Author `.narrative-header{display:flex;flex-wrap:wrap;gap:16px}` and let .narrative-header-metrics wrap below the title under 768px (mechanism 3 flex-wrap, or a @media stack). Ensure metric tiles are min-width:0 so long numbers don't force overflow.

**7. 🟠 P1 · Status filter chips (.narrative-status-filters)** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:4085-4107 seven btn-chip status filters (dot + label + count) inside the menu aside`
- **Problema:** Seven filter chips render in the narrow menu pane with no CSS to guarantee wrapping or a tappable height. Without flex-wrap they overflow the menu; btn-chip height is likely <44px for touch.
- **Evidencia:** `screens.js:4086-4106 map over NARRATIVE_STATUS_ORDER (6) + the Todas chip = 7 btn-chip buttons in `<div className="narrative-status-filters">` (4085); no CSS on the container.`
- **Arreglo:** `.narrative-status-filters{display:flex;flex-wrap:wrap;gap:6px}` (mechanism 3) and give .btn-chip `min-height:36px` (>=44px on coarse pointers via `@media(pointer:coarse)`) so chips wrap and are tappable.

**8. 🟠 P1 · NarrativeDayDrawer panel (.narrative-day-panel / .narrative-day-overlay)** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `screens.js:4581 .narrative-day-drawer; 4582 .narrative-day-overlay; 4583 .narrative-day-panel`
- **Problema:** The day drill-in is a slide-in overlay panel with no CSS. The app's other drawers use a fixed px width (e.g. .drawer 560px) capped by max-width; if this panel is authored the same way without a viewport cap it will overflow a 375px screen.
- **Evidencia:** `screens.js:4581-4583 `<div className="narrative-day-drawer"><div className="narrative-day-overlay"/><div className="narrative-day-panel">`; no CSS defines a width or max-width for any of them.`
- **Arreglo:** Author `.narrative-day-panel{width:460px;max-width:95vw;margin-left:auto;height:100%}` (mechanism 3, vw cap) so it never exceeds the viewport, and full-width it under `@media(max-width:768px)`.

**9. 🟠 P1 · .eco-page scroll-guard / padding hosting the two-pane** <sub>`scroll-guard` · Tablet</sub>
- **Ubicación:** `index.html:284 .eco-page{min-width:900px} and 287 {min-width:1120px}; app.js:366 mounts ScreenComponent inside main.eco-page (padding 20px 28px 48px, flex-column, index.html:277-280)`
- **Problema:** The narrative two-pane inherits .eco-page's min-width:900/1120 scroll guard and its column+padding model. In the ~900-956px band the 56px app rail leaves <900px so .eco-main (overflow-x:auto) scrolls horizontally; and the column/padding wrapper fights an app-style full-height two-pane that wants to break out and own its own scroll.
- **Evidencia:** `index.html:283-288 the @media min-width guards; 269-274 .eco-main{overflow-x:auto}; 276-281 .eco-page padding+column; app.js:366-376 screen mounts inside .eco-page.`
- **Arreglo:** Reconsider the min-width guard globally (shell-level), and give the narrative screen a full-bleed modifier that escapes the .eco-page padding/column (negative inline margins + height:calc(100vh - header)) so its own responsive two-pane governs layout instead of the desktop-only scroll guard (mechanism 1: CSS class + @media).

**10. 🟡 P2 · NarrativeDayDrawer close button (.narrative-day-close)** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `screens.js:4590 button.narrative-day-close containing the close glyph`
- **Problema:** The drawer's only close control is a bare glyph button with no CSS, which will render around the glyph's ~20px box — below the 44px touch minimum.
- **Evidencia:** `screens.js:4590 `<button className="narrative-day-close" onClick={onClose} aria-label="Cerrar">×</button>`; no CSS sets its hit area.`
- **Arreglo:** `.narrative-day-close{min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center}` (mechanism 3).

**11. 🟡 P2 · Recent-mention / related meta rows** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `screens.js:4383 .narrative-mention-meta (author + pageType tag + sentiment chip + date + link); also 4361 .narrative-init-meta`
- **Problema:** Each mention meta row is a single horizontal run of author name + page-type tag + sentiment chip + date + link arrow. With no CSS to wrap, long author names push this past the panel width on narrow screens.
- **Evidencia:** `screens.js:4383-4389 .narrative-mention-meta renders `<span>{m.author}</span>`, .narrative-tag-mini, .narrative-sentiment-mini, date span and link inline.`
- **Arreglo:** `.narrative-mention-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}` (mechanism 3 flex-wrap) and min-width:0/ellipsis on the author span.

**12. 🟡 P2 · NarrativeSparkline** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `screens.js:3989-4001 (w=64, h=18, viewBox with preserveAspectRatio none, class .narrative-sparkline)`
- **Problema:** The list-item sparkline uses preserveAspectRatio none with a 64x18 viewBox and no CSS width, so in a flex list row it can stretch/distort non-uniformly (and the 1.2px stroke smears) since its rendered box is undefined without CSS.
- **Evidencia:** `screens.js:3997 `<svg className="narrative-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">`, w=64/h=18 at 3991-3992; no CSS sizes .narrative-sparkline.`
- **Arreglo:** Give `.narrative-sparkline{width:64px;height:18px;flex:0 0 auto}` (mechanism 3, fixed intrinsic slot) so it keeps its aspect and doesn't distort in the flex row.

### Primitivas de gráficas (charts.js)
<sub>Chart primitives (apps/web/public/eco-prototype/charts.js)</sub>

*16 hallazgos — P0:1 · P1:3 · P2:12*


**1. 🔴 P0 · Heatmap** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `charts.js:599 Heatmap cell grid`
- **Problema:** The hour x weekday heatmap is laid out with fixed-pixel flex cells and no container measurement, so its intrinsic width vastly exceeds a phone viewport and forces horizontal scrolling of primary content. Each row = 28px day label + 24 cells x 16px (=384) + 24 gaps x 2px (=48) + 3 shift-break extraGaps x 4px (=12) ≈ 472px; the header row adds marginLeft:30. At 375px (minus card padding, ~300px usable) the grid overflows by ~170px.
- **Evidencia:** `function Heatmap({ ..., cellSize = 16, gap = 2, hours = 24, days = 7 }) ... width: cellSize (line 625), and the row div is plain flex with no overflow/wrap; cellSize never derives from container width.`
- **Arreglo:** Add a ResizeObserver ref on the outer div (mechanism 2, JS breakpoint/measurement) and compute cellSize = Math.floor((containerW - dayLabelW) / hours) - gap, OR (mechanism 3, intrinsic CSS) move the grid to a CSS class in index.html using display:grid; grid-template-columns:28px repeat(24, minmax(0,1fr)); with cells given aspect-ratio:1 so 24 columns always fit the container width. Prefer the CSS-grid route since cells are DOM elements, not SVG.

**2. 🟠 P1 · Heatmap** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `charts.js:625 Heatmap cell button`
- **Problema:** Each clickable heatmap cell is 16x16px — far below the 44px tap minimum — and its only affordance/feedback is a mouse hover (scale(1.4) + outline) that never fires on touch, so the cells are effectively untappable and give no touch feedback.
- **Evidencia:** `style={{ width: cellSize, height: cellSize (=16), ... }} with onMouseEnter/onMouseLeave transform:scale(1.4) (lines 624-642); role='button' but no touch/active state.`
- **Arreglo:** When the CSS-grid fluid layout is applied, on mobile enlarge effective cellSize toward ~24-28px by dropping to a 12-column (2-hour bucket) view via a JS breakpoint (mechanism 2), and replace the :hover-only feedback with an :active/pressed state in a CSS class (mechanism 1). A 24x24 minimum cell plus an invisible larger hit area keeps the grid narrow enough to fit while remaining tappable.

**3. 🟠 P1 · MultiLineChart** <sub>`horizontal-overflow` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:392 MultiLineChart last-point value tags`
- **Problema:** The right-edge value tags are drawn at translate(innerW + 4) with a 46px rect, needing 50px to the right of the plot, but padding.r is only 20px. Absolute right edge = padding.l + innerW + 50 = w + 30, so the tag (and even its centered text at ~w+7) is clipped by the SVG's own width. This is present at all widths and gets proportionally worse as the chart narrows on mobile.
- **Evidencia:** `const padding = { t: 28, r: 20, b: 34, l: 44 } (line 176); tag: transform={`translate(${innerW + 4}, ${y})`} with <rect width={46}> (lines 397-398); svg width={w} clips overflow.`
- **Arreglo:** Increase padding.r to >=52 so innerW leaves room for the tag (mechanism: adjust the inline padding constant), and/or on mobile drop the right-edge tags entirely via a JS breakpoint (mechanism 2) since the top value-strip legend already shows the latest value. Alternatively anchor the tag inside the plot (translate(innerW - 50)) so it never exceeds w.

**4. 🟠 P1 · StackedAreaChart** <sub>`chart-scale` · Móvil</sub>
- **Ubicación:** `charts.js:487 StackedAreaChart x-axis labels`
- **Problema:** X-axis date-label count is fixed at min(7, data.length) and is NOT adaptive to width (unlike MultiLineChart, which computes floor(innerW/50)). At ~236px innerW on a phone, 7 labels get ~34px each while date strings ('12 jul') need ~40px, so labels overlap/collide.
- **Evidencia:** `const xTickCount = Math.min(7, data.length); (line 487) with fontSize=10 textAnchor='middle' (line 493); no width term.`
- **Arreglo:** Mirror MultiLineChart's adaptive density: const maxLabels = Math.max(2, Math.floor(innerW / 50)); const xTickCount = Math.min(maxLabels, data.length); (mechanism 3, intrinsic — derives from the already-measured innerW). Dedupe indices as MultiLineChart does.

**5. 🟡 P2 · StackedAreaChart** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:437 StackedAreaChart height default`
- **Problema:** Height is a fixed 220px default that never scales to the viewport; on a phone this is proportionally tall relative to the reduced width, and on desktop it cannot grow to use available space.
- **Evidencia:** `function StackedAreaChart({ ..., height = 220, ... }) (line 437); svg height={height} (line 470).`
- **Arreglo:** Accept a fluid height: either compute height from measured width with an aspect ratio (e.g. height = Math.round(w * 0.45), mechanism 2) or expose the height via a CSS var and set it with clamp(180px, 40vw, 260px) in index.html (mechanism 1/3).

**6. 🟡 P2 · MultiLineChart** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:165 MultiLineChart height default`
- **Problema:** Default height 260 is a fixed pixel value; combined with the wrapping top value-strip legend (which grows taller as it wraps on narrow screens) the block gets tall on mobile, and the plot itself never scales height to width.
- **Evidencia:** `function MultiLineChart({ ..., height = 260, ... }) (line 165); innerH = height - padding.t - padding.b (line 178); svg height={height} (line 260).`
- **Arreglo:** Derive height from the measured width with an aspect ratio (height = clamp via Math.min/Math.max around w*0.5, mechanism 2), or move height to a CSS-var-driven class using clamp()/aspect-ratio (mechanism 1). Keep a floor so the plot stays legible when the legend wraps.

**7. 🟡 P2 · MultiLineChart** <sub>`chart-scale` · Móvil</sub>
- **Ubicación:** `charts.js:351 MultiLineChart hover tooltip`
- **Problema:** The floating tooltip is a fixed 180px-wide rect. At narrow innerW (~236px on phone) it occupies most of the plot, and the left/right flip logic can still push it partly off-canvas (tooltipX = xPos - 188 goes negative when hovering near the left edge), clipping the tooltip.
- **Evidencia:** `const tooltipW = 180; const tooltipX = xPos + tooltipW + 8 > innerW ? xPos - tooltipW - 8 : xPos + 8; (lines 351-353).`
- **Arreglo:** Make tooltipW responsive — tooltipW = Math.min(180, innerW - 16) (mechanism 3, intrinsic from measured innerW) — and clamp tooltipX into [0, innerW - tooltipW] so it can never leave the plot. On touch/mobile consider suppressing the crosshair tooltip entirely since there is no hover.

**8. 🟡 P2 · AreaLineChart** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:89 AreaLineChart height default`
- **Problema:** Fixed 180px height default; height never scales with the ResizeObserver-measured width, so the aspect ratio distorts across breakpoints (very flat on desktop, proportionally tall on mobile).
- **Evidencia:** `function AreaLineChart({ ..., height = 180, ... }) (line 89); svg width={w} height={height} (line 124).`
- **Arreglo:** Compute height from measured w with a target aspect ratio (mechanism 2) or drive it from a CSS var with clamp() in index.html (mechanism 1).

**9. 🟡 P2 · AreaLineChart** <sub>`chart-scale` · Móvil</sub>
- **Ubicación:** `charts.js:119 AreaLineChart x-tick count`
- **Problema:** X-axis tick count is fixed at min(6, data.length) regardless of width (fontSize 10), so at narrow phone widths the 6 date labels can collide, and at wide desktop widths it under-labels.
- **Evidencia:** `const xTickCount = Math.min(6, data.length); (line 119); label text at fontSize='10' (line 143).`
- **Arreglo:** Make it width-adaptive like MultiLineChart: xTickCount = Math.min(Math.max(2, Math.floor(innerW / 50)), data.length) (mechanism 3, uses the already-measured innerW).

**10. 🟡 P2 · Donut** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:503 Donut svg`
- **Problema:** The donut renders at a fixed pixel size (default 120) with width={size} height={size} and NO viewBox, so it cannot fluidly scale down to a narrow container or up on desktop — it is locked to whatever the caller passes.
- **Evidencia:** `function Donut({ data, size = 120, ... }) { ... return <svg width={size} height={size}> (lines 503, 509) — no viewBox attribute.`
- **Arreglo:** Add viewBox={`0 0 ${size} ${size}`} and render with style={{ width:'100%', height:'auto', maxWidth: size }} (mechanism 3, intrinsic) so the geometry stays crisp while the element shrinks to fit narrow columns; wrap in a container the caller can size responsively.

**11. 🟡 P2 · RadialGauge** <sub>`chart-scale` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:562 RadialGauge svg`
- **Problema:** Same fixed-size, no-viewBox pattern as Donut (default size 120). The gauge is locked to a pixel size and cannot scale to its container on small screens.
- **Evidencia:** `function RadialGauge({ value, max = 3, size = 120, ... }) { ... return <svg width={size} height={size}> (lines 562, 585) — no viewBox.`
- **Arreglo:** Add viewBox={`0 0 ${size} ${size}`} plus style={{ width:'100%', height:'auto', maxWidth:size }} (mechanism 3) so the gauge scales fluidly within its card.

**12. 🟡 P2 · HBarList** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `charts.js:549 HBarList label/value columns`
- **Problema:** Each row reserves a fixed 120px label column and a fixed 44px value column; only the bar track flexes. On a ~300px-wide phone card that leaves ~116px for the bar and truncates labels aggressively at 120px, wasting the responsive potential of the row.
- **Evidencia:** `<div style={{ width: 120, ...overflow:'hidden', textOverflow:'ellipsis' }}> (line 549) and <div className='num' style={{ width: 44, ... }}> (line 553).`
- **Arreglo:** Replace the fixed 120px with a fluid clamp/percentage label width (e.g. flex:'0 1 40%' with min-width, mechanism 3) or move the row to a CSS grid class (grid-template-columns: minmax(0, 40%) 1fr auto) in index.html (mechanism 1) so labels/bars rebalance at narrow widths.

**13. 🟡 P2 · HBarList** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `charts.js:539 HBarList clickable row`
- **Problema:** When clickable, each row is a button whose height is roughly trackHeight(6) + fontSize(12) + 8px padding ≈ 26px tall — under the 44px touch minimum. The row is full-width so horizontally tappable, but the vertical hit height is cramped for touch.
- **Evidencia:** `padding: clickable ? '4px 6px' : 0 (line 543) around a 12px font / 6px track row.`
- **Arreglo:** On mobile increase vertical padding to reach a >=44px row height via a CSS class + @media (min-height rule) in index.html (mechanism 1), or branch the padding on a JS breakpoint (mechanism 2).

**14. 🟡 P2 · PRMap** <sub>`map-scale` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:773 PRMap Leaflet container`
- **Problema:** The Leaflet map container (and its loading placeholder) is a hard-coded 420px tall. Width fills the parent (block div) so it is width-responsive, but height never adapts — 420px is a large fixed block on a phone and cannot grow on desktop.
- **Evidencia:** `style={{ height: 420, ... }} on the real container (line 773) and the placeholder (line 763).`
- **Arreglo:** Use a fluid height such as clamp(280px, 55vh, 460px) via a CSS class in index.html (mechanism 1) or set the height from measured width/viewport in JS (mechanism 2). Call map.invalidateSize() after any resize so Leaflet re-lays-out tiles. Keep both the placeholder and the live container in sync.

**15. 🟡 P2 · PRMapLegacy** <sub>`absolute-pos` · Móvil</sub>
- **Ubicación:** `charts.js:921 PRMapLegacy overlay panels`
- **Problema:** The legacy SVG map scales (viewBox 900x400 + width:100%), but its absolutely-positioned chrome does not: the layer-toggle panel (top/right 10) and zoom buttons overlay a map that shrinks to ~166px tall on a 375px screen, so fixed-size overlays crowd the tiny map, and the 28px zoom buttons are below the 44px touch target. Note this component is NOT in the window.ECO_CHARTS export (only PRMap is), so it appears to be dead/unused code — verify before investing.
- **Evidencia:** `viewBox scales (line 828) but layer panel position:absolute top:10 right:10 (line 921) and 28x28 zoom buttons (lines 903-906); export lists only PRMap (line 939), omitting PRMapLegacy.`
- **Arreglo:** If unused, delete it. If retained, gate overlay visibility/size on a JS breakpoint (mechanism 2) — hide the layer panel and enlarge zoom buttons to >=44px on mobile — or convert overlays to a responsive CSS class (mechanism 1).

**16. 🟡 P2 · Sparkline** <sub>`fixed-height` · Móvil+Tablet</sub>
- **Ubicación:** `charts.js:71 Sparkline svg`
- **Problema:** Sparkline is fixed at width 80 x height 24 with no viewBox. This is acceptable for an inline micro-chart, but because callers pass fixed pixel dimensions it cannot stretch to fill a variable-width table cell or KPI tile on different breakpoints.
- **Evidencia:** `function Sparkline({ data, width = 80, height = 24, ... }) with <svg width={width} height={height}> (lines 71, 81) — no viewBox.`
- **Arreglo:** Low priority: add viewBox={`0 0 ${width} ${height}`} and allow style width:'100%' when a caller wants it to fill its container (mechanism 3). Otherwise leave as-is since the fixed micro-size is intentional.

### Drawer de chat
<sub>Chat drawer (chat-drawer.js + chat-* CSS)</sub>

*6 hallazgos — P0:0 · P1:4 · P2:2*


**1. 🟠 P1 · ChatDrawer — conversation list delete button** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:543 .chat-del + :547 .chat-list-item:hover .chat-del (chat CSS lives in PR #76 branch b670a4e, absent from main); rendered at chat-drawer.js:288`
- **Problema:** The per-conversation delete (trash) button is opacity:0 by default and only revealed by a desktop :hover on the row. Touch devices have no persistent hover, so on phone and tablet the delete affordance never appears — users cannot delete conversations. It is also only a ~16px hit area (12px icon + 2px padding), far below the 44px touch minimum.
- **Evidencia:** `.chat-del { ... opacity: 0; transition: opacity .15s; padding: 2px } and .chat-list-item:hover .chat-del { opacity: 1 }; Icons.Trash size 12`
- **Arreglo:** Add a touch-detection media rule (CSS class + @media(hover:none), pointer:coarse — or the app's max-width:768px block) that sets .chat-del{opacity:1} and pads it to a >=44px square. Do not gate the only delete control behind :hover; hover-reveal should be a desktop-only progressive enhancement.

**2. 🟠 P1 · ChatDrawer — composer textarea** <sub>`font-scale` · Móvil</sub>
- **Ubicación:** `index.html:564-570 .chat-input (PR #76 branch, absent from main); rendered at chat-drawer.js:310-315`
- **Problema:** The composer input font-size is 13px. On iOS Safari, focusing any input/textarea under 16px triggers an automatic viewport zoom-in, which on the full-screen (100vw) mobile drawer shifts and distorts the whole layout every time the user taps to type.
- **Evidencia:** `.chat-input { ... font-size: 13px; ... min-height: 40px; max-height: 140px }`
- **Arreglo:** Bump the input to 16px at the mobile breakpoint via CSS class + @media(max-width:768px){ .chat-input{ font-size:16px } }, or use font-size:max(16px,13px). Purely a mobile override; desktop can stay 13px.

**3. 🟠 P1 · ChatDrawer — desktop squeeze vs eco-page scroll guard** <sub>`scroll-guard` · Tablet</sub>
- **Ubicación:** `index.html:518-521 .eco-app[data-chat-open="true"]{padding-right:var(--chat-w)} + :577 @media(max-width:1100px) (PR #76 branch)`
- **Problema:** On viewports above the 1100px full-width breakpoint (e.g. iPad Pro 12.9" landscape at 1366px, small laptops), opening the chat applies padding-right:460px to shrink the content column, but .eco-page still carries its min-width:1120px scroll guard. The squeezed column (viewport − 460px) drops below 1120px, so the primary dashboard content is forced into horizontal scroll the moment the chat opens.
- **Evidencia:** `.eco-app[data-chat-open="true"]{ padding-right: var(--chat-w) /*460px*/ } while the full-width override only starts at @media(max-width:1100px); .eco-page min-width:1120px is keyed to viewport, not the shrunken container`
- **Arreglo:** Either raise the full-width/no-squeeze breakpoint so the drawer goes overlay before the squeezed column can undercut the guard (e.g. @media(max-width:1400px) → width:100vw, padding-right:0), or — preferably — remove the .eco-page min-width scroll guards and let the content grids reflow (fluid CSS), which fixes this at the root. Mechanism: adjust the @media threshold and/or drop the min-width guard.

**4. 🟠 P1 · ChatDrawer — governing CSS is unmerged** <sub>`no-breakpoint` · Móvil+Tablet</sub>
- **Ubicación:** `index.html (main working tree, 695 lines) has 0 chat rules; all .chat-* CSS is only in commit b670a4e (branch feat/correos-tipos / worktree-chat-drawer)`
- **Problema:** chat-drawer.js ships in main but every layout rule it depends on (.chat-drawer fixed positioning, width, the @media(max-width:1100px) full-width override, composer/msgs flex) exists only in the unmerged PR #76 branch. In main's index.html the <aside class="chat-drawer"> has no CSS at all, so if mounted it renders as a static block in document flow with no width, no fixed positioning and no scroll containment — a full layout break at every breakpoint. Any responsive fix must be written where this base CSS actually lands.
- **Evidencia:** `grep -c chat-drawer on apps/web/public/eco-prototype/index.html (main) = 0; the :505-580 chat block exists only in git show b670a4e:.../index.html`
- **Arreglo:** Confirm PR #76's chat CSS is merged into main's index.html before/with any responsive work, and add the mobile @media overrides (findings above) into that same :505-580 block. Do not add responsive rules to a file that lacks the base component styles.

**5. 🟡 P2 · ChatDrawer — send / close / title / new controls** <sub>`touch-target` · Móvil+Tablet</sub>
- **Ubicación:** `index.html:571-575 .chat-send + :379-388 .btn + :526-531 .chat-title-btn (PR #76 branch); rendered at chat-drawer.js:266-276 (title/new/close) and 316-319 (send)`
- **Problema:** The send button is a 38x38px square; the header new/close buttons are icon-only .btn (~28-30px tall from 7px padding + 14px icon); the conversation-switcher pill is ~24px tall (4px padding + 12px font). All are under the 44px touch minimum. The close (X) matters most: on the full-screen mobile drawer it is the only exit (Esc is unavailable on phones).
- **Evidencia:** `.chat-send { width:38px; height:38px }; .btn { padding:7px 14px; font-size:13px }; .chat-title-btn { padding:4px 10px; font-size:12px }`
- **Arreglo:** At @media(max-width:768px) enlarge these to >=44px tap targets: .chat-send{width:44px;height:44px} and add min-width/min-height:44px to the header .btn instances and .chat-title-btn (CSS class + @media). Keep desktop sizes as-is.

**6. 🟡 P2 · ChatDrawer — full-screen mobile overlay** <sub>`absolute-pos` · Móvil</sub>
- **Ubicación:** `index.html:506-517 .chat-drawer + :577-580 @media(max-width:1100px){width:100vw} (PR #76 branch)`
- **Problema:** At <=1100px the drawer becomes a fixed 100vw/100vh overlay (z-index:1999) with no backdrop and no body scroll-lock. Because it deliberately omits a backdrop, momentum/rubber-band scrolling and taps can bleed to the dashboard underneath while the user is chatting full-screen, and the underlying page scroll position can shift behind the overlay.
- **Evidencia:** `.chat-drawer { position:fixed; inset via top/right/bottom; z-index:1999 } with @media(max-width:1100px){ .chat-drawer{ width:100vw } } and no overflow:hidden applied to body/.eco-app when data-chat-open`
- **Arreglo:** When the drawer is full-screen (mobile breakpoint), lock background scroll — add body/.eco-app { overflow:hidden } via the data-chat-open attribute inside @media(max-width:1100px), or toggle it in JS on open/close (JS breakpoint hook). Optional: a lightweight backdrop under the drawer at that breakpoint.

### Páginas Next.js + globals.css
<sub>Next.js pages + global CSS (sign-in, narratives, narratives components, settings alerts/reports, globals.css)</sub>

*16 hallazgos — P0:1 · P1:11 · P2:4*


**1. 🔴 P0 · ReportsSettingsPage — HistoryTable** <sub>`table-overflow` · Móvil+Tablet</sub>
- **Ubicación:** `settings/reports/page.tsx:401-460 HistoryTable`
- **Problema:** The 7-column send-history Table has NO `scroll` prop. Fixed column widths alone sum to 630px (Fecha 170 + Estado 130 + Tipo 90 + Trigger 100 + Menciones 140) plus two unbounded flexible columns (Destinatarios renders a comma-joined list of up to 20 emails; Error up to 80 chars). Natural width easily exceeds 900px. Without `scroll={{x}}` Ant does not give the table its own overflow container, so it overflows the Card and forces the WHOLE PAGE to scroll horizontally on tablet and phone.
- **Evidencia:** `<Table<HistoryEntry> ... size="small" pagination={false} columns={[{...width:170},{...width:130},{...width:90},{...width:100},{title:'Destinatarios', render:(r)=>r.join(', ')},{...width:140},{title:'Error',...}]} /> — no `scroll` prop anywhere.`
- **Arreglo:** Add `scroll={{ x: 'max-content' }}` so the table scrolls inside its own container instead of the page (self-contained overflow). Additionally tag low-priority columns with Ant's native column breakpoint prop, e.g. Trigger/Error `responsive: ['lg']` and Tipo `responsive: ['md']`, and cap the Destinatarios cell (fixed width + ellipsis, or render a count/tag) so a 20-email join can't blow out the row.

**2. 🟠 P1 · globals.css (app-wide stylesheet)** <sub>`no-breakpoint` · Móvil+Tablet</sub>
- **Ubicación:** `globals.css:1-172 entire file`
- **Problema:** The global stylesheet for all Next.js-rendered pages (sign-in, narratives, settings) contains ZERO @media queries and no responsive utility classes. Every layout in these pages is expressed as either an Ant component or an inline style object; inline objects cannot hold @media, so there is no CSS layer able to reflow the many inline `display:flex` rows and fixed-width panels found in the settings/narratives pages. Custom classes here (.eco-sidebar-section-label padding 16px 24px, .eco-period-selector inline-flex non-wrapping, .eco-stat-card) are all fixed with no small-screen variant.
- **Evidencia:** `File header comment: 'This file contains only reset, layout, and custom sidebar styles.' — grep for '@media' returns nothing across all 172 lines.`
- **Arreglo:** Mechanism (1) move-to-CSS-class + @media: add a small responsive utility layer to globals.css (e.g. .eco-form-row { display:flex; gap:16px } with @media(max-width:768px){ .eco-form-row{ flex-direction:column } }) so the settings form rows can reflow, and give overlays/cards fluid padding via clamp(). Alternatively standardize on Ant's Grid (Row/Col xs/sm/md) and Space `wrap` per-component. At minimum globals.css needs a documented breakpoint set (e.g. 768/1120) so page-level fixes are consistent.

**3. 🟠 P1 · ReportsSettingsPage — ConfigForm (hora + zona row)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `settings/reports/page.tsx:308-315 Space display:flex`
- **Problema:** Two Form.Items are locked side-by-side by an inline `<Space style={{ width:'100%', display:'flex' }}>` with flex:1 and flex:2. Ant Space does not wrap without the `wrap` prop, so on a 375px screen the two selects share ~319px at a 1:2 ratio (~106px / ~213px). The Zona horaria select shows long labels ('San Juan · Puerto Rico (AST, UTC-4 sin DST)') that truncate, and the Hora select is squeezed. Because the layout is inline flex it cannot media-query to stack.
- **Evidencia:** `<Space size={16} style={{ width: '100%', display: 'flex' }}> ... <Form.Item ... style={{ flex: 1 }}> ... <Form.Item ... style={{ flex: 2 }}> ...`
- **Arreglo:** Replace the Space+flex with Ant responsive grid: `<Row gutter={16}><Col xs={24} sm={8}>hora</Col><Col xs={24} sm={16}>zona</Col></Row>` — Col's xs/sm breakpoints stack the fields at <576px and split them above. (Mechanism: Ant Grid responsive breakpoints, which is the media-query-capable equivalent of the inline flex.)

**4. 🟠 P1 · ReportsSettingsPage — ConfigForm (weekly 3-column row)** <sub>`fixed-grid` · Móvil+Tablet</sub>
- **Ubicación:** `settings/reports/page.tsx:323-339 Space display:flex`
- **Problema:** Three Form.Items (Resumen semanal Switch + long `extra` text, Día de envío Select, Hora local del semanal Select) are forced into one inline-flex row at flex:1 each. At 375px each column is ~90-100px: the 'Día de envío' / 'Hora local del semanal' labels wrap awkwardly, the selects become too narrow to read, and the multi-line `extra` under the switch collides. Cramped even at tablet (~245px/col). No wrap, no media-query possible on inline flex.
- **Evidencia:** `<Space size={16} style={{ width: '100%', display: 'flex' }}> with three `<Form.Item ... style={{ flex: 1 }}>` (weeklyEnabled Switch, weeklySendDow Select, weeklySendHourLocal Select).`
- **Arreglo:** Convert to `<Row gutter={16}>` with `<Col xs={24} sm={12} md={8}>` per field so it is 3-up on desktop, 2-up on tablet, stacked on phone. (Mechanism: Ant Grid responsive Col.)

**5. 🟠 P1 · ReportsSettingsPage — ConfigForm (remitente row)** <sub>`fixed-grid` · Móvil</sub>
- **Ubicación:** `settings/reports/page.tsx:370-377 Space display:flex`
- **Problema:** 'Nombre del remitente' and 'Correo del remitente' Inputs are pinned side-by-side via inline `Space display:flex` flex:1 each; at 375px they shrink to ~150px, making the email field too narrow to see the address. Cannot reflow (inline flex, no wrap).
- **Evidencia:** `<Space size={16} style={{ width: '100%', display: 'flex' }}> ... <Form.Item ... style={{ flex: 1 }}>fromName</Form.Item> <Form.Item ... style={{ flex: 1 }}>fromEmail</Form.Item>`
- **Arreglo:** Use `<Row gutter={16}><Col xs={24} sm={12}>...</Col><Col xs={24} sm={12}>...</Col></Row>` to stack on phone. (Mechanism: Ant Grid responsive Col.)

**6. 🟠 P1 · ReportsSettingsPage — action buttons** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `settings/reports/page.tsx:387-391 Space (3 buttons)`
- **Problema:** A non-wrapping `<Space>` holds three buttons ('Guardar cambios', 'Probar diario', 'Probar semanal'), together ~390px of content, exceeding the ~319px content width at 375px. Ant Space does not wrap by default, so the row overflows / clips the last button.
- **Evidencia:** `<Space><Button ...>Guardar cambios</Button><Button ...>Probar diario</Button><Button ...>Probar semanal</Button></Space>`
- **Arreglo:** Add the `wrap` prop: `<Space wrap>` so buttons flow onto a second line on narrow screens (Mechanism: intrinsically-fluid flex-wrap via Ant Space `wrap`). Optionally make them `block` inside a Col stack on xs.

**7. 🟠 P1 · ReportsSettingsPage — page Header** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `settings/reports/page.tsx:208-213 Layout.Header`
- **Problema:** Standalone (non-embed) header is a fixed-height 64px Ant Header with `display:flex` (no wrap): back-link + Title level 4 'Configuración · Reportes por correo' (~20px font, ~330px wide) + 56px padding exceeds 375px, forcing horizontal page scroll and/or clipping the title.
- **Evidencia:** `<Header style={{ ... padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16 }}><Link>Panel</Link><Title level={4}>Configuración · Reportes por correo</Title></Header>`
- **Arreglo:** Move the header to a CSS class with `@media(max-width:768px){ font-size / flex-wrap:wrap; height:auto }` in globals.css, or drop the Title to level 5 and add `ellipsis`/`flex-wrap:wrap` so it wraps under the back link on phone. (Mechanism: CSS class + @media, since the height/font are inline and can't media-query.)

**8. 🟠 P1 · AlertsCrisisSettingsPage — page Header** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `settings/alerts/page.tsx:121-126 Layout.Header`
- **Problema:** Same pattern as reports: fixed 64px flex Header, no wrap, back-link + Title level 4 'Configuración · Alertas de crisis' overflows 375px width and forces horizontal scroll / title clip in standalone mode.
- **Evidencia:** `<Header style={{ ... padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16 }}><Link>Panel</Link><Title level={4}>Configuración · Alertas de crisis</Title></Header>`
- **Arreglo:** Shared CSS class + @media(max-width:768px) to allow the header to wrap (flex-wrap:wrap, height:auto) and shrink the title; or reduce to Title level 5 with ellipsis. (Mechanism: CSS class + @media.)

**9. 🟠 P1 · AlertsCrisisSettingsPage — save row** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `settings/alerts/page.tsx:346-353 Space (button + long text)`
- **Problema:** A non-wrapping `<Space>` places the 'Guardar configuración' button beside a long helper Text ('Los cambios aplican desde el siguiente ciclo de evaluación (≤ 10 min).'). Combined width far exceeds 375px; Space does not wrap so the text overflows horizontally.
- **Evidencia:** `<Space><Button ...>Guardar configuración</Button><Text ...>Los cambios aplican desde el siguiente ciclo de evaluación (≤ 10 min).</Text></Space>`
- **Arreglo:** Add `wrap` to the Space (`<Space wrap>`), or switch to `<Space direction="vertical">` on mobile via a breakpoint so the helper text drops below the button. (Mechanism: flex-wrap via Space `wrap`.)

**10. 🟠 P1 · NarrativesPage — Layout.Header** <sub>`horizontal-overflow` · Móvil</sub>
- **Ubicación:** `narratives/page.tsx:168-197 Header`
- **Problema:** The 64px flex Header (no wrap) holds a left cluster (icon + 'Narrativas' Title + info icon ≈150px) and a right cluster with a status `<Select style={{ minWidth: 240 }}>` + reload icon (≈266px). Total ~416px + 48px padding exceeds 375px, forcing horizontal scroll of the whole page. The Select's 240px min-width is the hard constraint.
- **Evidencia:** `<Header style={{ ... justifyContent: 'space-between', padding: '0 24px' }}> ... <Select mode="multiple" ... style={{ minWidth: 240 }} maxTagCount="responsive" />`
- **Arreglo:** On mobile move the filter out of the header: use `Grid.useBreakpoint()` to, on `xs`, drop `minWidth` (let it be `width:'100%'`) and render the Select on its own row below the title (or in a collapsible filter bar). Alternatively wrap the header via a CSS class + @media (flex-wrap:wrap, height:auto). (Mechanism: JS breakpoint hook + full-width Select, since minWidth is inline.)

**11. 🟠 P1 · NarrativesPage — detail Drawer** <sub>`fixed-width-panel` · Móvil</sub>
- **Ubicación:** `narratives/page.tsx:278-294 Drawer width=520`
- **Problema:** The right-side Drawer is hard-coded `width={520}`. Ant Design's Drawer does NOT clamp width to the viewport (unlike the prototype's custom .drawer which uses max-width:95vw), so at 375px the 520px panel extends ~145px off the left edge, pushing NarrativeDetail content partly off-screen.
- **Evidencia:** `<Drawer open={drawerOpen} ... width={520} placement="right" ...>`
- **Arreglo:** Make the width responsive: `width={screens.md ? 520 : '100%'}` using `Grid.useBreakpoint()` (or `Math.min(520, vw)`). Ant Drawer accepts a percentage string. (Mechanism: JS breakpoint hook branching the `width` prop.)

**12. 🟠 P1 · TimelineSlider — month marks** <sub>`font-scale` · Móvil</sub>
- **Ubicación:** `narratives components/TimelineSlider.tsx:26-44 marks`
- **Problema:** For 90-365 day ranges the slider emits a 1-month mark for every month (up to 12 marks e.g. 'ene 25','feb 25'…). On a phone-width slider (~300px minus card padding) 12 horizontal month labels overlap into an unreadable smear. Mark density is derived only from time span, not available pixel width.
- **Evidencia:** `const stepMonths = totalDays > 365 ? 3 : totalDays > 90 ? 1 : 0; ... out[cursor.getTime()] = cursor.toLocaleDateString('es', { month: 'short', year: '2-digit' });`
- **Arreglo:** Factor viewport width into `stepMonths`: via `Grid.useBreakpoint()` force `stepMonths` to 3 (quarterly) or show only start/end marks when `!screens.md`. (Mechanism: JS breakpoint hook adjusting mark step.) Optionally rotate labels with a CSS class for the marks container.

**13. 🟡 P2 · AlertsCrisisSettingsPage — CrisisSlider marks** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `settings/alerts/page.tsx:362-381 CrisisSlider`
- **Problema:** Two threshold sliders render five text marks at 0/0.25/0.40/0.60/1. The 'elevado' (0.25) and 'alerta' (0.40) labels sit only 15% apart; on a narrow phone slider (~300px) these horizontal labels overlap and become unreadable. Mark labels are fixed and inline, no reflow.
- **Evidencia:** `marks={{ 0:'sin crisis', 0.25:'elevado', 0.40:'alerta', 0.60:'crisis', 1:'' }}`
- **Arreglo:** Reduce mark density on small screens via a JS breakpoint (antd `Grid.useBreakpoint()`): on `xs` show only endpoints {0:'sin crisis',1:'crisis'} and keep full marks on `md+`. (Mechanism: JS breakpoint hook branching the `marks` object.)

**14. 🟡 P2 · AlertsCrisisSettingsPage — email add row** <sub>`touch-target` · Móvil</sub>
- **Ubicación:** `settings/alerts/page.tsx:317-341 Space.Compact + native input`
- **Problema:** The recipient email input is a native input hard-coded to height 32px, paired with a 32px 'Añadir' button; the removable email Tags (line 301-308) are ~24px tall. All are below the 44px comfortable touch-target minimum on phones.
- **Evidencia:** `style={{ ... height: 32 }} on the native input; <Tag closable style={{ padding: '4px 8px', fontSize: 12 }}> for chips.`
- **Arreglo:** On mobile bump the input/button/Tag min-height to 40-44px. Simplest: give the input `size` parity with an Ant `<Input>` at `size="large"` on xs, or a CSS class `.eco-touch { min-height:44px }` gated by @media(max-width:768px) in globals.css. (Mechanism: CSS class + @media, or antd size prop via breakpoint.)

**15. 🟡 P2 · NarrativeDetail — Top voces Table** <sub>`table-overflow` · Móvil</sub>
- **Ubicación:** `narratives components/NarrativeDetail.tsx:153-164 Table`
- **Problema:** 3-column Table (Autor ellipsis, Menc. width 70, Eng. width 90) sits inside the 520px Drawer. When the drawer is forced full-width on a small phone the two fixed columns (160px) plus author leave little room; no `scroll` prop, but the Autor ellipsis mostly absorbs it, so impact is minor. Worth a scroll guard for very narrow drawers.
- **Evidencia:** `<Table size="small" ... columns={[{title:'Autor', ellipsis:true},{title:'Menc.', width:70},{title:'Eng.', width:90}]} /> — no `scroll`.`
- **Arreglo:** Add `scroll={{ x: 'max-content' }}` as a cheap guard so the table scrolls within the drawer rather than squeezing/overflowing on very narrow phones. (Mechanism: Ant Table self-contained overflow.)

**16. 🟡 P2 · SignInPage — card wrapper** <sub>`spacing` · Móvil</sub>
- **Ubicación:** `(auth)/sign-in/page.tsx:204-220 wrapper + Card`
- **Problema:** The centering wrapper (flex, minHeight 100vh) has no horizontal padding, and the Card is `width:'100%', maxWidth:420`. At <420px the card border sits flush against both screen edges with zero gutter, which looks broken on phones (the card body's internal 24px padding is the only breathing room).
- **Evidencia:** `outer div style {{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', backgroundColor:'#F4F7FA' }} (no padding); Card style {{ width:'100%', maxWidth:420 }}.`
- **Arreglo:** Add fluid padding to the wrapper: `padding: 'clamp(16px, 4vw, 32px)'` (intrinsically-fluid, no media query needed) so the card keeps a gutter on phones while staying centered on desktop. (Mechanism: clamp() fluid spacing.)
