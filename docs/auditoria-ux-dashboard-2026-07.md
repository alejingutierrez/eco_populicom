# Auditoría UX/UI del dashboard ECO — julio 2026

**Alcance**: todos los átomos, moléculas, organismos, plantillas y páginas del dashboard en producción (`origin/main` bf85cf2, 7 jul 2026): la SPA `apps/web/public/eco-prototype/` (~9,400 líneas: shell, 13 pantallas, 9 tipos de chart, chat) y la superficie Next.js que convive con ella (sign-in, `/settings/alerts`, `/settings/reports`).
**Método**: análisis de código por capa (7 pasadas paralelas con evidencia archivo:línea), verificación cruzada contra las rutas API, y navegación real de todas las pantallas (con datos vía fixtures y sin datos) midiendo contraste, foco, targets y responsive en el navegador. Las líneas citadas corresponden a `origin/main`.

---

## Veredicto general

El sistema tiene **cimientos correctos**: tokens CSS por tema, primitivas (`.card`, `.pill`, `.chip`, `.btn`, `.skeleton`), un shell coherente, formato legible `display/deltaDisplay` compartido con los correos, y varios patrones bien resueltos (KpiCard accesible, empty states honestos en data.js, ExecStateWrap, deep-links de tópicos). El problema no es la ausencia de sistema sino su **erosión**: cada pantalla re-implementa piezas que ya existen, el color perdió su semántica en el tema de producción, y conviven dos productos visuales (SPA mando dark + Ant Design light). De ~190 hallazgos con evidencia, el 80% se explica por **10 causas sistémicas** — atacarlas de raíz rinde mucho más que corregir hallazgo por hallazgo.

---

## 1 · Inventario del sistema (atomic design)

| Nivel | Piezas | Estado |
|---|---|---|
| **Tokens** (index.html:13–216) | 3 temas × 2 modos (solo mando está en producción; costa/gaceta son peso muerto), radii, 4 familias tipográficas, colores semánticos pos/neg/warn/info, rail | ⚠️ `--accent` = `--neg` en mando (colisión); sin `--danger`, sin paleta categórica de dataviz, sin tokens `--z-*` |
| **Átomos CSS** | `.card .pill .chip .btn .input .kbd .skeleton .tt .dot .bar-track .row-hover .section-eyebrow .num .mono` | ✔️ Base sana, pero re-implementada inline en decenas de sitios (eyebrow ×10, input ×3, toast ×2) |
| **Átomos JS** | ~70 iconos (icons.js), DeltaBadge, Sparkline, StatBox, HL, RankDelta, SentimentSplitBar | ⚠️ `ArrowLeft` duplicado; 4 implementaciones de la barra pos/neu/neg; 3 semánticas de color para "delta" |
| **Moléculas** | KpiCard, QuickMetric, Field, Pagination, ViewToggle, SortChips, SourceSelect, HeaderSearch, MiniMunicipalityMap, ExecCompositeStrip | ⚠️ KpiCard vs QuickMetric duplican anatomía; Field sin `<label>`; SortChips existe y no se usa donde se necesita |
| **Organismos** | Sidebar, Header, CommandPalette, MentionDrawer, MentionsSliceModal, MetricInsightModal, ChatDrawer, TweaksPanel (muerto), 3 renderers de mención, tablas admin, formularios (AlertRuleEditor, UserDrawer), 9 charts + PRMap | ⚠️ Sin primitiva Overlay (5 copias de Escape, sin focus trap); 3 sistemas de tooltip; librería de charts con API dispar |
| **Plantillas/Páginas** | 13 pantallas SPA (Overview, Scorecard, Menciones, Búsqueda, Sentimiento, Tópicos, Narrativas, Geografía, Alertas, Configuración, 3 ejecutivas) + 3 páginas Next (sign-in, settings×2) | ⚠️ Búsqueda ≈ Menciones (80% duplicado); Narrativas existe 2 veces (SPA + Next congelada); settings fragmentado en 4 lugares y 2 estéticas |

---

## 2 · Diez temas sistémicos (la raíz del 80% de los hallazgos)

### T1 — El color perdió su semántica: `--accent` = `--neg` (ALTA)
En mando (el único tema en producción) el naranja de marca ES el color de "negativo": `#FF6A3D` dark / `#C83A1E` light (index.html:167,172,198,203). Consecuencias reales: NSS (marca) y Riesgo de Crisis (peligro) llevan el mismo borde naranja en el Scorecard (screens.js:430,437); el número protagonista de Sentimiento se pinta "de alarma" (1626); el resaltado de búsqueda `<mark>` parece negativo (1118); el pin del mapa usa `--neg` decorativo (shell.js:912). Encima hay paletas paralelas hardcodeadas: hex de sentimiento del calendario ≠ tokens (`#2E8B6A/#C2412F` en 2454 vs `--pos/--neg`), paleta de tópicos triplicada (311, 1998, 2448), morado `#8B5CF6` sin token (263), banda ALERTA `#E0662E` (34), leyenda del heatmap **azul** con celdas **naranjas** (674 vs 688 — la clave de lectura siempre miente), colores de estado de narrativas heredados de AntD (4601–4608).
**Oportunidad**: (1) separar `--danger` de `--accent` en mando; (2) crear paleta categórica `--viz-1..6` + `--status-*` y migrar todos los hex; (3) leyenda/rampa derivadas de tokens con `color-mix`.

### T2 — Datos fabricados o engañosos presentados como reales (ALTA — confianza)
Para un producto de gobierno esto es lo más grave que encontró la auditoría:
- Histograma "Volumen por hora" es una **curva seno** con jitter, en 3 pantallas (screens.js:272–275, 1574–1577, 2003–2007) — el API ya soporta el dato real (`hour`).
- El drill-in de municipio **fabrica** la mezcla de sentimiento con ratios fijos 55/25/20 (`splitSentiment`, 2653–2664 → 2713).
- El hero de Sentimiento lleva una narrativa **hardcodeada** ("deterioro acelerado por discurso sobre infraestructura vial… frustración y enojo", 1640–1642) que se muestra igual con datos en cero (verificado en navegador).
- "Actividad reciente" del UserDrawer es un log inventado idéntico para todos, con IP fija (3956–3961).
- La tabla de Reglas muestra placeholders constantes como dato (`triggered: 0`, `lastFired: '—'` — api/eco-data:1053–1061) que el tab Historial contradice al lado.
- Las "Olas temáticas" del Radar ejecutivo siempre dicen "· estable" (`volumeDelta` hardcodeado a 0 en exec-overview:396–399) — falsa calma para la Gobernadora (verificado en navegador).
- "Tópicos emergentes · ordenados por crecimiento" muestra top-volumen sin re-ordenar (516–520); "Fuentes top · 30d" con período hardcodeado (540); "78 municipios monitoreados" fijo aunque el filtro cambie el set (2755).
**Oportunidad**: política de producto "solo datos reales o etiquetados como ejemplo"; una sola decisión elimina la clase entera.

### T3 — Accesibilidad sistémica, no puntual (ALTA — cumplimiento en gobierno)
- **8 atributos `aria-*` en ~5,900 líneas** de screens.js; ninguna visualización SVG tiene rol/título/alternativa.
- Contraste medido en navegador: `--text-3` 2.65:1 (dark) y 3.21:1 (light) sobre canvas — falla WCAG AA y es el color de todos los eyebrows, metadatos y ejes; `--warn` 3.86:1 en light; texto blanco sobre chips activos ~2.9:1 (index.html:377).
- Teclado: filas de mención, tópicos, burbujas, nodos del grafo, días del streamgraph y celdas del calendario son `div/g/rect onClick` sin `tabIndex/role/onKeyDown`; y donde sí se hizo bien (KpiCard 74–79) el foco es invisible porque `:focus-visible` global solo cubre `button/input/select/a` (index.html:254).
- Overlays sin `role="dialog"`/focus trap/scroll lock (5 overlays); **colapsado, el sidebar pierde todos los nombres accesibles** (verificado: 9 botones sin etiqueta).
- Móvil: targets de 34×23px, header que apila 271px antes del contenido (verificado a 375px).
- Daltonismo: sentimiento codificado solo con verde/naranja-rojo (contraste mutuo 1.48:1) sin redundancia de forma/orden.
**Oportunidad**: definición-de-hecho de a11y para toda pieza nueva + barrido en 4 frentes (contraste de tokens, trío role/tabIndex/keydown, primitiva de diálogo, focus-visible para `[tabindex]`).

### T4 — Dos productos en una sola app (ALTA — identidad)
El usuario cruza 3 identidades: sign-in con gradiente azul propio (`#1B3A4B→#3B82F6`, color que no existe en ninguna paleta del repo), dashboard mando dark naranja, y settings Ant Design light "Mar Caribe" azul. La pestaña Alertas es el punto de máxima fricción: KPIs mando dark arriba + **iframe AntD blanco** abajo (screens.js:2938–2951, 3060–3068), con altura fija 1100px (doble scroll), botón "Recargar" que destruye ediciones, pie del form ilegible sobre fondo oscuro, y **el selector de agencia del iframe roto** (espera `data.agencies`, el API devuelve array plano — settings/reports:113, alerts:65): es imposible editar crisis/reportes de AAA/Gobernadora/SGPR desde la UI. "Configuración" vive en 4 lugares con 3 patrones de navegación distintos. Además: `AgencyContext` con key distinta (`eco-agency` vs `eco.agency`) y 0 consumidores, `chart-theme.ts`/`constants.ts`/`globals.css .eco-*` muertos, locales es-CO/es-ES/es-PR mezclados.
**Oportunidad**: portar los 2 formularios al SPA (elimina iframes, drift de agencia, doble estética) o, mínimo, derivar un ThemeConfig AntD oscuro de los tokens mando + pasar `?agency&mode` al iframe. Sign-in re-tematizado con la identidad real.

### T5 — No existe la primitiva Overlay (ALTA — interacción)
Cinco overlays copian a mano el listener de Escape (shell.js:580,749,997,1101,1447) y el Escape global de app.js:316 cierra **todas las capas a la vez** (drawer + modal apilados colapsan juntos); z-index literales con empate 2001 vs 2001 (drawer vs slice modal — quién tapa a quién depende del orden de montaje); ningún overlay bloquea el scroll del body ni trapea/restaura foco. Y el **error boundary vive solo en la raíz**: un crash de render en una pantalla tumba el dashboard entero (demostrado en vivo durante la auditoría: un dato inesperado en el calendario dejó toda la app en "Error de render").
**Oportunidad**: `<Overlay>`/`useDialog` único (stack de capas, Escape del tope, trap+restauración de foco, scroll lock, `--z-*` tokenizados) + boundary por pantalla con retry local. Resuelve ~10 hallazgos de una vez.

### T6 — El estado global se gestiona con recargas de página (MEDIA-ALTA)
Cambiar período o agencia hace `window.location.reload()` (app.js:296,303; shell.js:342 para rango custom): se pierde scroll, drawer abierto, filtros de búsqueda y borrador del chat en cada ajuste. Encima conviven **4 vocabularios de período**: header `1D/5D/7D/30D/3M/6M/1A/Max`, palette con "Último mes (**1M**)" (setea un valor que el header no tiene → ningún chip activo, verificado), default `'1M'` en getPeriodParams vs `'7D'` en app.js, y el set legacy `24h/7d/30d/90d` de data.js. Narrativas ignora el período global por completo (4821–4822) y MetricInsightModal no envía from/to en custom (shell.js:1464 → interpretación de otra ventana).
**Oportunidad**: constante única de períodos; refetch de `/api/eco-data` sin recarga; y por pantalla: o consume el período o declara explícitamente que no aplica.

### T7 — La librería de charts es 9 dialectos, no un sistema (MEDIA-ALTA)
Matriz de API: 3 vocabularios de datos (`accessor` / `series[]` / `items`), 4 de color (string, array posicional, `colorFn` con 3 firmas), 4 nombres de click con 3 payloads, 3 sistemas de tooltip (SVG fijo 180px, `title` nativo, Leaflet HTML) + 3 charts sin ninguno, leyenda integrada solo en 1/9, y 4 estrategias ante vacío (mensaje, silencio, **crash** — AreaLineChart:107 —, nada). Deshonestidad visual: el modo default de MultiLineChart normaliza **cada serie a su propio min/max sin eje Y** (209–215, 278–290) — los cruces de líneas del gráfico insignia no significan nada; el strip pinta subidas de "Negativo" en **verde** (252–260); delta % con baseline negativa invierte el signo (252); burbujas con área ∝ r² sobre-representan 2–3×. La cobertura real es tan corta que las pantallas fabricaron ≥10 mini-viz propias (NarrativeSparkline duplica Sparkline, gauges de banda ×3, split-bars ×4, histograma ad-hoc). RadialGauge está muerto y con umbrales de una escala vieja.
**Oportunidad**: charts v2 con contrato único (`{data, series[{key,label,color,format}]}`, `onSelect`, `<ChartTooltip>` HTML compartido, `<Legend>`, prop `scale` explícita con badge "escala relativa"), paleta `--viz-*`, y absorber las mini-viz huérfanas.

### T8 — Estados de carga/error en 4 dialectos, y errores que se disfrazan (MEDIA-ALTA)
Skeleton (modal), texto plano "Cargando…" (Overview/Narrativas/Exec), spinner inline, y **nada** (palette: `searching` se setea y jamás se renderiza — shell.js:500–517). Errores: la landing muere en "ERROR · HTTP 404" sin retry local (verificado); Menciones sí tiene error+retry pero Virales convierte 401 en "0" (860–863); eco-geo falla en silencio dejando el mapa con datos stale del filtro anterior (2704–2708); TopicDetail pinta un 500 como "Sin menciones" (2648–2650); UsersAdmin setea `loading/error` y nunca los renderiza — durante la carga se lee "Sin resultados · ajusta los filtros" (3600–3607 vs 3787). Dos vías de fetch conviven: `ecoFetchAuthed` (refresh 401 + error tipado) vs `fetch` crudo con catch silencioso — la resiliencia de sesión depende de qué pantalla te encuentre.
**Oportunidad**: hook único `useEcoFetch` (authed + abort + loading/error/empty tipados) y 3 componentes de estado estándar (skeleton por sección, error con retry, empty honesto). El trío de MentionsScreen (981–991) es el patrón a generalizar.

### T9 — Duplicación estructural (MEDIA — velocidad y drift)
Búsqueda ≈ Menciones (~80%: misma API, facetas, vistas, debounce; popover copiado con divergencias ya visibles). Tres renderers de mención + una 4ª copia en el Scorecard, cuadruplicando el mapa fuente→icono y sentimiento→pill, divergiendo en columnas/hover/bordes (neutral con borde ámbar de warning en Cards — 1167). KpiCard vs QuickMetric. Dos pipelines paralelos de insight IA (`/api/eco-metric-insight` con polling vs `/api/ai/metric-insight` con caché — el primero tiene su caller muerto, 237–257). Dos sistemas de toast (AlertsScreen local vs `ecoToast` global). Narrativas implementada 2 veces (SPA + Next congelada). Resolución de agencia repetida con 3 precedencias distintas (una invertida: 562). Validación de email en 3 niveles de rigor.
**Oportunidad**: consolidar Menciones/Búsqueda en una pantalla parametrizada; extraer `MentionRow`, `sourceIcon()`, `sentimentPill()`, `<TriBar>`, `<Delta>`, `ecoActiveAgency()`, `notify()`; decidir la Narrativas canónica antes de descongelar.

### T10 — Copy e i18n para el usuario real (MEDIA)
El usuario es un director de comunicaciones hispanohablante: "Operations Console", "Overview", "Scorecard", "Cards", "mixed" como pill visible, "Engagement rate", "click un día/segmento/municipio" (vs el correcto "haz clic"), "Sentim.", jerga sin explicar ("Vel. 24h", "Co-ocurrencia 82%", "Compuesto ponderado" sin definir la ponderación). Fecha en formato US "07/15/26, 11:20 a. m." en Alertas (verificado); ejes con ISO crudo ("2026-07-13"); tooltip con "2026-07-01T00:00:00.000Z"; locales `es`/`es-CO`/`es-ES`/`es-PR` mezclados; TZ PR aplicada en unas fechas y no en otras (mismo evento, horas distintas); errores de Cognito en inglés en el sign-in ("Incorrect username or password."). Mensajes contradictorios de frescura: sidebar "Ingesta en vivo" (dot verde pulsante) vs header "Datos al cierre de ayer" (shell.js:238–246 vs 355–363).
**Oportunidad**: glosario ES-PR + formatter único de fecha/número con TZ PR + mapa de errores Cognito + resolver la señal de frescura (mostrar el último run real de ingesta).

---

## 3 · Hallazgos clave por pantalla

| Pantalla | Lo más importante |
|---|---|
| **Overview** (landing) | Orden correcto para "¿cómo amanecimos?", pero: error terminal sin retry; verde para subida de Negativo en el strip (T2/T7); insights IA sin procedencia/evidencia clickeable; click de tópico depende de matching por nombre contra otro dataset (fallo silencioso, 4141–4146); "últimos N días" miente en rango custom |
| **Scorecard** | 5 KPIs hero sólidos (display words + DeltaBadge ✔), pero NSS y Crisis con el mismo naranja; multi-métrica sin eje Y ni aviso de escala; senoide horaria; "emergentes" = top-volumen; etiquetas de banda desalineadas de los umbrales reales (447–449); heatmap desborda su card entre 1120–1430px |
| **Menciones** | Trío error/empty/retry ✔; pero orden enterrado en "Más filtros" (que no cierra con Escape/click-fuera); se ofrece ordenar por engagement que ninguna vista muestra; 3 "totales" distintos conviven; falta filtro `blog` que el API soporta; timestamps solo relativos ("hace 25 d") imposibles de citar |
| **Búsqueda** | El flujo más completo en estados ✔; duplica Menciones al 80%; recientes contaminadas por prefijos de tecleo (guarda "hu", "hurac"…); placeholder promete buscar por autor y el API no lo hace; filtros no viajan en la URL |
| **Sentimiento** | Narrativa del hero **hardcodeada** (T2); NSS naranja=negativo al lado del donut (T1); insight NSS roto en rango custom (400); `--neu` inválido en el acento del slice de emociones (1560); donut sin leyenda/interacción/a11y |
| **Tópicos** | Deep-link `/topics/<slug>` robusto ✔; "treemap" que no codifica área; Δ volumen en rojo=sube (semántica invertida vs KPIs); el detalle mezcla conteo primario (hero) con total all (tabla) y la nota promete un toggle que no existe; calendario con hex propios y leyenda de dots grises sin significado; "período seleccionado" que en realidad son mín. 35 días |
| **Narrativas** | Ignora el período global; grafo sin teclado/táctil y que ignora los filtros del sidebar (parece bug); streamgraph sin eje Y y sin fechas visibles en narrativas jóvenes; azul hardcodeado de selección; jerga sin explicar; edges fallan en silencio |
| **Geografía** | Mapa Leaflet bien tematizado dark ✔, pero re-monta marcadores y resetea zoom en cada render del padre (835 + lambdas inline); sentimiento del drill-in **fabricado** (T2); leyenda sin escala (la misma burbuja significa 40 o 4,000 según filtros); "78 municipios" fijo; errores → datos stale silenciosos |
| **Alertas** | El toggle Activa/Inactiva **no persiste** (3086–3090) — riesgo operacional directo; la regla recién creada no aparece (la tabla lee el snapshot del boot); columnas placeholder como dato; historial sin drill-in pese a tener `mentionIds`; editor descarta emails inválidos en silencio y no valida rango del umbral; fecha formato US |
| **Configuración** | UsersAdmin sin loading/error renderizados; `saveUser` no comprueba `res.ok` → "Usuario guardado" en fallos; rol default `'analista'` no existe (invita viewers por accidente); email editable que se ignora; "Eliminar" que en realidad suspende; actividad reciente inventada; roles con `r.count` inexistente |
| **Vistas ejecutivas** | ExecStateWrap (loading/error/403/empty) es el patrón bueno ✔; pero olas "· estable" fijas (T2); ALERTA y CRISIS colapsan al mismo pill; carets "▾" de orden falso; sin drill-down a la agencia (el flujo natural "veo AAA en rojo → quiero verla" no existe); "Compuesto ponderado" sin explicar; ranking sin salvaguarda de volumen mínimo |
| **Sign-in / Settings Next** | Tercera identidad visual; errores Cognito en inglés; selector de agencia roto (contrato); "← Panel" lleva a Scorecard y el login a `/dashboard` mientras `/` va a `/overview`; recursión SPA-en-iframe para no-admins; formularios sin wrap <600px; botones de prueba comparten spinner y envían a toda la lista sin confirmar |

---

## 4 · Bugs funcionales detectados de paso (arreglos independientes del rediseño)

1. **Selector de agencia de settings roto** — espera `data.agencies`, el API devuelve array plano (reports:113, alerts:65). Bloquea editar crisis/reportes de 3 agencias.
2. **Toggle de reglas de alerta no persiste** (screens.js:3086–3090) — el usuario cree apagar/encender alertas y no.
3. **`saveUser`/`deleteUser` sin `res.ok`** (3628–3677) — errores del servidor se reportan como éxito.
4. **Regla creada no aparece en la lista** (3183 + 3146) — existe `GET /api/alerts` sin consumir.
5. **Rol default `'analista'` inexistente** → invita `viewer` silenciosamente (3696 vs ROLES).
6. **Insight NSS con rango custom → 400** (1536: manda `period=custom` sin from/to; mismo gap en MetricInsightModal shell.js:1464).
7. **XSS potencial en insights IA**: `dangerouslySetInnerHTML` sin sanitizar (shell.js:1237) y sanitizador que permite `<strong onmouseover=…>` (shell.js:1476, screens.js:206) — cadena mención hostil → LLM → HTML. Usar el `renderRich` seguro del chat (chat-drawer.js:10–39).
8. **`var(--neu)` inválido** como acento del slice de emociones (1560) — el fix documentado en 1762–1776 no se aplicó al click.
9. **Filtro `blog` ausente** de SOURCE_OPTIONS (709–716) — menciones de blogs inalcanzables por UI.
10. **RBAC**: tabs embebidos visibles para editores pero la página exige admin (recursión SPA-en-iframe); atajos de teclado saltan `ecoCanSeePage` (app.js:319); `ecoHasCap` fail-open antes de cargar sesión (shell.js:70–74).
11. **Palette**: "Último mes (1M)" deja el header sin chip activo; `searching` nunca se muestra; selección ↑↓ se sale del viewport sin `scrollIntoView` (581–604).
12. **Export CSV del slice** exporta solo las 20 cargadas aunque diga "de 3,400" (shell.js:1361–1383).
13. **Boundary raíz**: un crash de pantalla tumba toda la app (app.js:123) — demostrado en vivo.
14. **PRMap** resetea zoom/pan en cada render (charts.js:835) y `attributionControl:false` (shell.js:665) viola la licencia OSM/CARTO en el mini-mapa.
15. **AreaLineChart crashea con data vacía** (charts.js:107); Donut NaN con suma 0; HBarList crashea con `value` null.

---

## 5 · Plan de rediseño priorizado

### P0 — Esta semana (bugs + honestidad, sin rediseño)
1. Los 15 bugs de la sección 4 (el #1, #2, #3 y #7 primero: operacionales/seguridad).
2. Retirar los datos fabricados (senoide ×3, splitSentiment, narrativa hardcodeada de Sentimiento, actividad de usuario, "· estable" del Radar, columnas placeholder de Reglas) — o etiquetarlos "ejemplo".
3. Contraste: subir `--text-3` (dark ≥ `#7A8694`) y revisar `--warn` light; extender `:focus-visible` a `[tabindex]`/`[role=button]`.
4. Copy: fecha/número `es-PR` con TZ PR en un helper único; formato US y anglicismos visibles ("Cards"→"Tarjetas", "mixed"→"Mixto", "click"→"haz clic"); errores Cognito en español.

### P1 — Fundacional (2–4 semanas): consolidar el design system
5. **Tokens v2**: `--danger` separado de `--accent`; paleta dataviz `--viz-1..6`; `--status-*` de narrativas; `--z-*`; eliminar temas costa/gaceta del bundle de producción (o flag staff).
6. **Primitiva Overlay** (stack, Escape del tope, focus trap, scroll lock, `role=dialog`) + boundary por pantalla + `ModalFrame` compartido para los 2 modales grandes.
7. **`useEcoFetch`** (authed+refresh+abort) + estados estándar (skeleton/error-retry/empty) en todos los fetch; matar los catch silenciosos.
8. **Átomos consolidados**: `<TriBar>` (4 copias), `<Delta>` (3 semánticas), `MentionRow` + `sourceIcon` + `sentimentPill` (4 copias), `ecoActiveAgency()`, `notify()`, formatter numérico único (fmt vs display vs fmtVal).
9. **Períodos**: constante única, mapear 1M↔30D, refetch sin `location.reload()`.
10. **Charts v2** (contrato único, tooltip HTML compartido, Legend, `scale` explícita con eje Y siempre, r∝√v en burbujas/mapa) — puede ser incremental: primero MultiLine/Stacked que son los visibles.

### P2 — Estructural (1–2 meses): una sola experiencia
11. **Absorber settings al SPA**: portar los 2 formularios AntD (crisis, reportes) a pantallas nativas mando; eliminar iframes, "Recargar", drift de agencia y la doble estética. Re-tematizar sign-in con la identidad real del producto.
12. **Unificar Menciones+Búsqueda** en una pantalla parametrizada (FacetBar compartida, orden visible, engagement visible, filtros en URL).
13. **Móvil real**: hoy es desktop comprimido (header 271px, targets 34px, rail mudo). Definir el caso de uso móvil (¿consulta ejecutiva? → priorizar Overview/alertas) y hacer ese flujo responsive de verdad; chat full-screen ≤768px.
14. **Drill-down ejecutivo**: click en agencia (Tabla/Sala/Radar) → cambia de agencia y aterriza en su Overview; distinguir ALERTA vs CRISIS; explicar el composite; salvaguarda de volumen mínimo en el ranking.
15. **Decidir la Narrativas canónica** (SPA vs Next) antes de descongelar la feature; conectarla al período global o declarar explícitamente su ventana.

### Criterios de éxito medibles
- 0 colores semánticos duplicados (`--accent` ≠ `--danger`); 0 hex de sentimiento fuera de tokens.
- 100% de fetches con estados loading/error/empty renderizados; 0 catch silenciosos con datos stale.
- Contraste AA en todos los textos <14px (auditable con el harness de esta auditoría).
- Todo elemento clicable operable por teclado; overlays con focus trap; nav colapsada con nombres accesibles.
- 1 vocabulario de período; cambiar período/agencia sin recarga de página.
- 0 datos fabricados sin etiqueta.

---

## Anexo · Cómo se verificó

- Fuente auditada: `origin/main` (bf85cf2). El working tree local está ~2 meses atrás con trabajo en progreso encima — cualquier corrección debe partir de un branch fresco de origin/main (ritual de fetch documentado en AGENTS.md).
- Navegación real: prototipo compilado y servido estáticamente con un servidor de fixtures para `/api/*` (16 endpoints simulados a partir de los contratos extraídos del código), lo que permitió verificar estados con datos, sin datos, con API caída, modo claro/oscuro, sidebar colapsado y viewport móvil.
- Contrastes calculados sobre los valores reales de los tokens en el navegador (WCAG 2.1).
- Cada hallazgo cita archivo:línea de origin/main; los marcados "verificado" se reprodujeron en el navegador durante la auditoría.
