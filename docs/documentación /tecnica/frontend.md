# Frontend

La app web es un proyecto **Next.js (App Router)** en `apps/web`, servido por ECS
Fargate detrás del ALB (puerto 3000). Conviven dos capas de UI: las páginas
Next.js (React, server + client components) y un **prototipo SPA** servido como
estáticos desde `public/eco-prototype/`.

## Estructura

```
apps/web/src/
  app/
    page.tsx              → redirect('/overview')
    overview, dashboard, mentions, sentiment, topics,
    geography, alerts, settings, narratives   (rutas del dashboard)
    api/                  → Route Handlers (ver api-interna.md)
  components/narratives/  → NarrativeGraph, NarrativeDetail,
                            NarrativeStatusBadge, TimelineSlider
  contexts/AgencyContext.tsx
  lib/                    → session, agency, rate-limit, bedrock-client,
                            auth/{cognito,require-admin}, log
  middleware.ts
  public/eco-prototype/   → SPA estática (index.html + *.js + dist/)
```

`page.tsx` redirige a `/overview` (`apps/web/src/app/page.tsx:3-5`).

---

## Páginas del dashboard (Next.js)

Rutas protegidas por el middleware: `/overview`, `/dashboard`, `/mentions`,
`/sentiment`, `/topics`, `/geography`, `/alerts`, `/settings`, `/narratives`
(`middleware.ts:6-27`, `99-129`). Consumen los endpoints `/api/*` descritos en
[API interna](api-interna.md).

La página de **narrativas** (`app/narratives/page.tsx`) es un client component que
usa **Ant Design** (Layout, Select, Drawer, Card, Tag, Tooltip…),
**`@tanstack/react-query`** para fetch/caché, `next/link` y el `AgencyContext`. Lee
`/api/narratives` y `/api/narratives/edges` y muestra el grafo + un Drawer de
detalle (`narratives/page.tsx:1-28`).

### Componentes de narrativas (`components/narratives/`)

- **`NarrativeGraph.tsx`**: grafo de fuerza con **`react-force-graph-2d`**
  (importado dinámicamente, `ssr:false`, porque usa canvas/window). Radio de nodo
  ∝ `sqrt(mentionCount)` clamp 4–28; color por estado de ciclo de vida
  (`STATUS_COLORS`); grosor de arista ∝ `strength`; etiquetas al hacer zoom; click
  abre el detalle (`NarrativeGraph.tsx:35-106`).
- **`NarrativeDetail.tsx`**: panel/Drawer con resumen, keywords, iniciadores,
  estado y métricas de la narrativa seleccionada.
- **`NarrativeStatusBadge.tsx`**: badge de estado del ciclo de vida + el mapa
  `STATUS_COLORS` (emerging/active/peaking/declining/dormant/revived).
- **`TimelineSlider.tsx`**: control temporal que filtra el grafo por ventana,
  consumiendo `/api/narrative/[id]/day`.

---

## Contexto de agencia

`apps/web/src/contexts/AgencyContext.tsx` provee la agencia activa al árbol React
(slug, nombre, logo). El servidor resuelve la agencia desde el JWT (header
`x-eco-user-agency` que inyecta el middleware), con fallback a `?agency=` y a la
primera agencia activa (`apps/web/src/lib/agency.ts:26-48`). Esto es lo que hace la
plataforma multi-tenant: un usuario solo ve los datos de su `agency_slug`.

---

## Prototipo SPA (`public/eco-prototype/`)

Un prototipo de dashboard servido como **HTML + JS estáticos** (no es React/Next):

- `index.html` (`public/eco-prototype/index.html`): shell con `<head>` que carga
  Google Fonts (Instrument Sans/Serif, Newsreader, IBM Plex), **Leaflet** (CSS+JS
  desde unpkg) y un `<style>` con un sistema de theming por variables CSS
  (`index.html:12-...`).
- JS: `app.js` (arranque), `shell.js` (layout/navegación), `screens.js` (las
  pantallas, el más grande ~235 KB), `charts.js` (gráficos), `data.js` (datos),
  `icons.js` (iconos). Hay además una carpeta `dist/` con los mismos archivos
  (build).

### Theming

El `<head>` define múltiples temas por `data-theme`/`data-mode` (p. ej. `costa`,
light/dark) usando variables CSS `--bg`, `--text`, `--accent`, `--pos/neg/warn`,
fuentes y radios (`index.html:13-...`). El cambio de tema/modo se hace alternando
los atributos en el elemento raíz.

### Mapa

La geografía usa **Leaflet** con basemaps de CARTO y tiles de OpenStreetMap; la CSP
del middleware permite esos orígenes (`middleware.ts:44`).

---

## Notas de UI mock / en evolución

Coherente con la [Guía de Usuario], parte del frontend muestra datos no
persistentes:

- **Consola de alertas**: los KPIs, el feed en vivo y las acciones de triage son
  maqueta. El array `ALERTS` de `/api/eco-data` trae
  `priority:'media'/triggered:0/lastFired:'—'` hardcodeados
  (`eco-data/route.ts:1069-1077`). Las **reglas** y el **historial** sí son reales
  (`/api/alerts`, `/api/alerts/history`).

Las rutas de notificación reales son `eco-alerts` (SQS) y las alertas de crisis de
`eco-metrics-calculator` (SES). Ver
[Pipeline de datos](pipeline-datos.md#alertas-real-vs-mock).

---

## CSP y externals

El middleware fija una CSP que habilita exactamente los externals que el dashboard
necesita (`middleware.ts:39-52`): scripts de unpkg (React, Leaflet), estilos de
unpkg y Google Fonts, fuentes de gstatic, imágenes de CARTO/OSM, `connect-src` a
Cognito IDP. `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` permiten
embeber `/settings/reports` same-origin pero bloquean clickjacking cross-origin.
Detalle en [Autenticación y seguridad](autenticacion-seguridad.md).

---

## Build / contenedor

La imagen se construye desde `apps/web/Dockerfile` (`compute-stack.ts:80-86`) con
build args de Cognito y se publica al ECR `eco-web`. El contenedor expone el puerto
3000 y tiene health check `curl /api/health`. ARM64/Graviton.
