# ECO Design System — Spec

**Fecha:** 2026-03-31
**Autor:** Alejandro Gutierrez + Claude
**Estado:** Draft

---

## 1. Contexto

ECO es una plataforma de social listening para el Gobierno de Puerto Rico (~120 agencias). El MVP actual tiene un dashboard funcional construido con Tailwind CSS 4.0 + componentes custom + dark mode hardcoded. La UI es funcional pero carece de identidad visual, consistencia entre páginas, y componentes profesionales (tablas sin sorting, forms sin validación, loading states básicos).

**Objetivo:** Reemplazar completamente Tailwind CSS y los componentes custom por un sistema de diseño basado en Ant Design, con paleta de colores inspirada en Puerto Rico (Mar Caribe), light mode, y componentes profesionales que soporten tanto ejecutivos de gobierno como analistas de comunicaciones que usan la herramienta diariamente.

**Estrategia de implementación:** Theme-first — configurar el theme de Ant Design primero, crear componentes wrapper del sistema de diseño, luego migrar página por página.

---

## 2. Dependencias

### Agregar
| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `antd` | ^5.x (última estable) | Librería de componentes UI |
| `@ant-design/icons` | ^5.x | Iconos de Ant Design (complementa Lucide) |
| `@ant-design/cssinjs` | incluida en antd 5 | CSS-in-JS engine de Ant Design |

### Mantener
| Paquete | Propósito |
|---------|-----------|
| `recharts` ^2.15.0 | Gráficos y visualización de datos |
| `lucide-react` ^0.475.0 | Iconos principales (navegación, UI, acciones) |
| `date-fns` ^4.1.0 | Utilidades de fecha |
| `@tanstack/react-query` ^5.75.0 | Gestión de estado servidor (activar uso real) |
| `clsx` | Utilidad de clases (para casos edge fuera de Ant) |

### Eliminar
| Paquete | Razón |
|---------|-------|
| `tailwindcss` | Reemplazo completo por Ant Design |
| `@tailwindcss/postcss` | Ya no necesario |
| `tailwind-merge` | Ya no necesario |
| `postcss` | Ya no necesario (Ant usa CSS-in-JS) |

### Archivos a eliminar
- `apps/web/postcss.config.mjs`
- `apps/web/src/app/globals.css` (reemplazar por theme config)
- `apps/web/src/lib/utils.ts` (la función `cn()` ya no es necesaria)

---

## 3. Paleta de Colores — "Mar Caribe"

Inspirada en la costa de Puerto Rico: azul océano, verde manglar, arena, coral.

### Colores primarios
| Token | Hex | Uso |
|-------|-----|-----|
| `colorPrimary` | `#0A7EA4` | Azul océano — acción principal, links, sidebar active, botones primarios |
| `colorPrimaryHover` | `#0991B8` | Hover de primario |
| `colorPrimaryActive` | `#086E8F` | Active/pressed de primario |
| `colorPrimaryBg` | `#E6F7FC` | Background sutil de primario (badges, highlights) |

### Colores de acento
| Token | Hex | Uso |
|-------|-----|-----|
| Accent verde | `#2E8B6A` | Verde manglar — tendencias positivas, engagement, secondary actions |
| Accent ámbar | `#F5A623` | Ámbar sol — warnings, alcance, métricas neutras-importantes |
| Accent violeta | `#8B5CF6` | Violeta — categorías extra en gráficos (Instagram, etc.) |

### Colores semánticos (sentimiento)
| Token | Hex | Uso |
|-------|-----|-----|
| `colorSuccess` | `#52C47A` | Verde — sentimiento positivo en gráficos y badges |
| `colorSuccessBg` | `#ECFDF5` | Background de badge positivo |
| `colorError` | `#E86452` | Rojo coral — sentimiento negativo, alertas, destructive |
| `colorErrorBg` | `#FEF2F2` | Background de badge negativo |
| `colorWarning` | `#F5A623` | Ámbar — warnings, atención requerida |
| `colorWarningBg` | `#FFF8E6` | Background de warning |
| Neutral sentiment | `#CBD5E1` | Gris — sentimiento neutral en gráficos |
| Neutral sentiment bg | `#F1F5F9` | Background de badge neutral |

### Colores de superficie
| Token | Hex | Uso |
|-------|-----|-----|
| `colorBgLayout` | `#F4F7FA` | Fondo general de la app (gris-azulado) |
| `colorBgContainer` | `#FFFFFF` | Cards, modales, drawers, tablas |
| `colorBgElevated` | `#FFFFFF` | Popovers, dropdowns (con sombra) |
| `colorBgSpotlight` | `#FAFBFD` | Filas de tabla hover, items de lista |
| Sidebar bg | `linear-gradient(180deg, #0E1E2C, #162D3E, #1A3548)` | Sidebar oscuro (CSS custom, no token de Ant) |
| Sidebar text | `rgba(255,255,255,0.45)` | Texto inactivo del sidebar |
| Sidebar active bg | `rgba(10,126,164,0.2)` | Background del item activo |
| Sidebar active border | `#48B8D0` | Border-left del item activo |

### Colores de texto
| Token | Hex | Uso |
|-------|-----|-----|
| `colorText` | `#0E1E2C` | Texto principal (headings, valores KPI) |
| `colorTextSecondary` | `#64748B` | Texto secundario (labels, descripciones) |
| `colorTextTertiary` | `#94A3B8` | Texto terciario (placeholders, captions, breadcrumbs) |
| `colorTextQuaternary` | `#CBD5E1` | Texto muy sutil (disabled, grid lines) |

### Colores de borde
| Token | Hex | Uso |
|-------|-----|-----|
| `colorBorder` | `#E2E8F0` | Bordes principales (cards, inputs, dividers) |
| `colorBorderSecondary` | `#EEF2F6` | Bordes sutiles (separadores internos) |

### Paleta de datos para gráficos (Recharts)
Secuencia ordenada para gráficos que NO son de sentimiento:
1. `#0A7EA4` — Azul océano (primario)
2. `#2E8B6A` — Verde manglar
3. `#F5A623` — Ámbar sol
4. `#8B5CF6` — Violeta
5. `#48B8D0` — Azul cielo (variante clara)
6. `#E07A5F` — Coral
7. `#7BC89C` — Verde claro
8. `#F9C96B` — Ámbar claro

---

## 4. Tipografía

**Font stack:** Ant Design default — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

No se carga ninguna fuente web externa. Rendimiento óptimo.

### Escala tipográfica
| Uso | Tamaño | Weight | Color |
|-----|--------|--------|-------|
| Page title | 20px | 700 | `colorText` |
| Section title (card headers) | 14px | 700 | `colorText` |
| KPI value | 28px | 800 | `colorText` o color semántico |
| Body text | 14px | 400 | `colorText` |
| Label / caption | 12px | 500 | `colorTextSecondary` |
| Small caption | 11px | 400 | `colorTextTertiary` |
| Badge text | 12px | 600 | color semántico |
| Breadcrumb | 12px | 400 | `colorTextTertiary` → `colorTextSecondary` (actual) |

---

## 5. Espaciado y Bordes

### Border radius
| Token | Valor | Uso |
|-------|-------|-----|
| `borderRadius` | 8px | Default (botones, inputs, selects) |
| `borderRadiusLG` | 14px | Cards, contenedores grandes |
| `borderRadiusSM` | 6px | Badges, pills, tags pequeños |

### Espaciado
Seguir el sistema de 4px de Ant Design:
- Padding de cards: 20px
- Gap entre cards en grid: 14px
- Padding de content area: 24px horizontal, 22px vertical
- Padding del header: 14px vertical, 28px horizontal

### Sombras
| Uso | Valor |
|-----|-------|
| Card default | `0 1px 3px rgba(0,0,0,0.05)` |
| Card hover | `0 4px 12px rgba(0,0,0,0.08)` |
| Dropdown/popover | `0 6px 16px rgba(0,0,0,0.08)` |
| Sidebar logo icon | `0 2px 8px rgba(10,126,164,0.35)` |

---

## 6. Layout

### Estructura general
```
┌──────────────────────────────────────────────────────┐
│ Ant Layout                                           │
│ ┌─────────┬────────────────────────────────────────┐ │
│ │ Sider   │ Layout                                 │ │
│ │ (dark)  │ ┌────────────────────────────────────┐ │ │
│ │         │ │ Header (white, shadow)             │ │ │
│ │ Logo    │ │ breadcrumbs | agency | date | user │ │ │
│ │         │ ├────────────────────────────────────┤ │ │
│ │ Menu    │ │ Content (scrollable)               │ │ │
│ │ items   │ │                                    │ │ │
│ │         │ │ [KPI cards row]                    │ │ │
│ │         │ │ [Charts row]                       │ │ │
│ │         │ │ [Bottom row]                       │ │ │
│ │         │ │                                    │ │ │
│ │ ──────  │ └────────────────────────────────────┘ │ │
│ │ Collapse│                                        │ │
│ └─────────┴────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Sidebar (Ant `Layout.Sider`)
- **Ancho expandido:** 220px
- **Ancho colapsado:** 64px (solo iconos)
- **Fondo:** Gradiente CSS custom (no token de Ant)
- **Colapsable:** Sí, con `collapsible` prop nativa
- **Secciones:** "Análisis" (Dashboard, Menciones, Sentimiento, Tópicos, Geografía, Alertas) + "Sistema" (Configuración)
- **Item activo:** `border-left: 3px solid #48B8D0` + `background: rgba(10,126,164,0.2)`
- **Logo:** Icono con gradiente (`#0A7EA4` → `#48B8D0`) + texto "ECO" + subtítulo "SOCIAL LISTENING"
- **Usuario:** Avatar con iniciales (gradiente `#0A7EA4` → `#2E8B6A`) + nombre + rol, en la parte inferior
- **Iconos:** Lucide React (LayoutDashboard, MessageSquare, Activity, Hash, MapPin, Bell, Settings)

### Header (Ant `Layout.Header`)
- **Fondo:** Blanco con `box-shadow: 0 1px 0 #E8EDF2`
- **Izquierda:** Breadcrumbs (Ant `Breadcrumb`) + título de página
- **Derecha:** Selector de agencia (Ant `Select`) + Date range picker (Ant `DatePicker.RangePicker`) + Avatar de usuario (Ant `Avatar`)
- **Selector de agencia:** Icono Home + nombre corto + nombre completo + chevron
- **Date range picker:** Icono Calendar + rango formateado

### Content (Ant `Layout.Content`)
- **Background:** `#F4F7FA`
- **Padding:** 24px horizontal, 22px vertical
- **Scroll:** vertical auto

---

## 7. Componentes del Sistema de Diseño

### 7.1 KPI Card (`EcoStatCard`)
Componente wrapper sobre `Ant Card` para métricas principales.

**Props:**
- `title: string` — Label de la métrica
- `value: string | number` — Valor principal
- `icon: ReactNode` — Icono Lucide
- `trend?: { value: number; direction: 'up' | 'down' | 'flat' }` — Tendencia vs periodo anterior
- `accentColor: string` — Color del borde izquierdo y fondo del icono
- `sparklineData?: number[]` — Datos para mini sparkline

**Diseño:**
- Borde izquierdo de 3px con gradiente del `accentColor`
- Icono en badge cuadrado (28x28px, background 6% opacity del accentColor)
- Valor en 28px weight 800
- Sparkline SVG debajo del valor (16px height, opacity 0.4-0.5)
- Trend con icono ChevronUp/ChevronDown/Minus + porcentaje + texto "vs mes anterior"

### 7.2 Chart Container (`EcoChartCard`)
Wrapper sobre `Ant Card` para gráficos de Recharts.

**Props:**
- `title: string`
- `subtitle?: string` — Descripción breve
- `extra?: ReactNode` — Controles en la esquina (period selector, etc.)
- `children: ReactNode` — El chart de Recharts

**Diseño:**
- Card con `borderRadius: 14px`, padding 20px, sombra sutil
- Título 14px bold + subtítulo 12px gris debajo
- `extra` alineado a la derecha del título

### 7.3 Period Selector (`EcoPeriodSelector`)
Selector de periodo temporal tipo pill.

**Props:**
- `options: { label: string; value: string }[]` — Opciones (7D, 30D, 90D)
- `value: string` — Opción activa
- `onChange: (value: string) => void`

**Diseño:**
- Container con background `#F4F7FA`, border-radius 8px, padding 3px
- Opción activa: background blanco, sombra sutil, font-weight 600
- Opciones inactivas: color `#64748B`

### 7.4 Sentiment Badge (`EcoSentimentBadge`)
Badge de sentimiento para tablas y listas.

**Props:**
- `sentiment: 'positivo' | 'negativo' | 'neutral'`
- `size?: 'small' | 'default'`

**Diseño:**
- Pill con border-radius 6px, padding 3px 8px
- Positivo: bg `#ECFDF5`, text `#2E8B6A`
- Negativo: bg `#FEF2F2`, text `#E86452`
- Neutral: bg `#F1F5F9`, text `#64748B`
- Font-size 12px, weight 600

### 7.5 Source Badge (`EcoSourceBadge`)
Badge con icono de plataforma social.

**Props:**
- `source: 'facebook' | 'twitter' | 'instagram' | 'youtube' | 'news' | string`

**Diseño:**
- Icono en badge cuadrado 20x20px con background sutil del color asignado
- Cada fuente tiene color asignado de la paleta de datos

### 7.6 Mention Drawer (`EcoMentionDrawer`)
Drawer de detalle de mención usando Ant `Drawer`.

**Props:**
- `open: boolean`
- `mention: Mention | null`
- `onClose: () => void`

**Diseño:**
- Ancho: 520px
- Posición: derecha
- Secciones en orden:
  1. **Header** — Fuente (SourceBadge) + fecha + link a original (Ant `Button` ghost)
  2. **Texto completo** — Contenido de la mención
  3. **Sentimiento** — SentimentBadge + score de confianza + comparación Brandwatch vs Claude
  4. **Emociones** — Tags de las 7 emociones con intensidad (Ant `Tag`)
  5. **Tópicos** — Tags de tópicos/subtópicos con scores (Ant `Tag`)
  6. **Municipio** — Nombre + región
  7. **Pertinencia** — Badge (alta/media/baja)
  8. **Engagement** — Likes, shares, comments en una fila
  9. **Acciones** — Botones: Marcar revisado, Archivar, Agregar nota (Ant `Space` + `Button`)

### 7.7 Mentions Table (`EcoMentionsTable`)
Tabla rica de menciones usando Ant `Table`.

**Columnas:**
1. Fuente (SourceBadge)
2. Texto (truncado, 2 líneas max)
3. Sentimiento (SentimentBadge)
4. Pertinencia (Tag)
5. Engagement (número)
6. Fecha (relativa)

**Features de Ant Table:**
- Sorting por sentimiento, engagement, fecha
- Filtros por columna (sentimiento, fuente, pertinencia)
- Paginación nativa
- Row click → abre MentionDrawer
- Row hover → background `#FAFBFD`
- Loading → Skeleton rows

### 7.8 Filter Bar (`EcoFilterBar`)
Barra de filtros para páginas de datos.

**Componentes Ant usados:**
- `Select` para sentimiento, fuente, pertinencia
- `DatePicker.RangePicker` para rango de fechas
- `Input.Search` para búsqueda de texto
- `Space` para layout horizontal

---

## 8. Recharts Theme

### Configuración global de Recharts
Definir constantes de theme para todos los gráficos:

```typescript
// Paleta de datos (no-sentimiento)
export const CHART_COLORS = [
  '#0A7EA4', '#2E8B6A', '#F5A623', '#8B5CF6',
  '#48B8D0', '#E07A5F', '#7BC89C', '#F9C96B',
];

// Sentimiento (fijo, convención universal)
export const SENTIMENT_COLORS = {
  positivo: '#52C47A',
  neutral: '#CBD5E1',
  negativo: '#E86452',
};

// Config compartida
export const CHART_THEME = {
  grid: { stroke: '#F0F4F8', strokeDasharray: 'none' },
  axis: { stroke: '#E2E8F0', fontSize: 11, fill: '#94A3B8' },
  tooltip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    fontSize: 12,
  },
};
```

### Gráficos por página
| Página | Gráficos | Tipo Recharts |
|--------|----------|---------------|
| Dashboard | Timeline menciones | `AreaChart` con gradiente |
| Dashboard | Sentimiento donut | `PieChart` (inner radius) |
| Dashboard | Top fuentes | Barras horizontales con gradiente |
| Sentiment | Timeline sentimiento | `AreaChart` stacked |
| Sentiment | Sentimiento por fuente | `BarChart` grouped |
| Sentiment | Emociones | `RadarChart` |
| Sentiment | Brandwatch vs Claude | `BarChart` comparación |
| Topics | Distribución | Grid visual (custom, no Recharts) |
| Geography | Municipios | `BarChart` horizontal |

---

## 9. Iconografía

**Librería principal:** Lucide React (ya instalada)
**Librería complementaria:** `@ant-design/icons` (para iconos específicos de Ant como Loading)

**Regla:** Cero emojis en toda la aplicación. Todo icono es SVG profesional.

### Asignación de iconos
| Contexto | Icono Lucide |
|----------|-------------|
| Dashboard | `LayoutDashboard` |
| Menciones | `MessageSquare` |
| Sentimiento | `Activity` |
| Tópicos | `Hash` |
| Geografía | `MapPin` |
| Alertas | `Bell` |
| Configuración | `Settings` |
| KPI: Total menciones | `MessageSquare` |
| KPI: Negativas | `AlertTriangle` |
| KPI: Engagement | `Heart` |
| KPI: Alcance | `Globe` |
| Trend up | `ChevronUp` |
| Trend down | `ChevronDown` |
| Trend flat | `Minus` |
| Fuente: Facebook | `Facebook` (Lucide) |
| Fuente: Twitter/X | `Twitter` (Lucide) |
| Fuente: Instagram | `Instagram` (Lucide) |
| Fuente: YouTube | `Youtube` (Lucide) |
| Fuente: Noticias | `Globe` (Lucide) |
| Agencia selector | `Building2` |
| Calendario | `Calendar` |
| Colapsar sidebar | `ChevronsLeft` |
| Expandir sidebar | `ChevronsRight` |
| Logout | `LogOut` |
| Buscar | `Search` |
| Filtrar | `Filter` |
| Abrir link externo | `ExternalLink` |
| Archivar | `Archive` |
| Marcar revisado | `CheckCircle` |
| Agregar nota | `StickyNote` |

---

## 10. Loading States

### Estrategia: Skeletons everywhere
Usar Ant Design `Skeleton` para todos los estados de carga.

| Componente | Skeleton |
|------------|----------|
| KPI Card | `Skeleton.Input` (para valor) + `Skeleton` (para sparkline) |
| Chart Card | `Skeleton` paragraph con rows=4 |
| Table | `Skeleton` rows según `pageSize` |
| Drawer | `Skeleton` con avatar + paragraphs |
| Mention list | `Skeleton` card repetido 3x |
| Sidebar | No skeleton (siempre visible, datos estáticos) |
| Header | `Skeleton.Input` para agency selector si carga |

### Empty States
Usar Ant `Empty` con ilustración custom y mensaje en español:
- "No hay menciones para los filtros seleccionados"
- "No hay datos para el periodo seleccionado"
- "No hay alertas configuradas"

---

## 11. Ant Design Theme Configuration

Configurar via `ConfigProvider` con token customization:

```typescript
const ecoTheme: ThemeConfig = {
  token: {
    // Colors
    colorPrimary: '#0A7EA4',
    colorSuccess: '#52C47A',
    colorError: '#E86452',
    colorWarning: '#F5A623',
    colorInfo: '#0A7EA4',
    colorBgLayout: '#F4F7FA',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorText: '#0E1E2C',
    colorTextSecondary: '#64748B',
    colorTextTertiary: '#94A3B8',
    colorBorder: '#E2E8F0',
    colorBorderSecondary: '#EEF2F6',

    // Border radius
    borderRadius: 8,
    borderRadiusLG: 14,
    borderRadiusSM: 6,

    // Shadows
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    boxShadowSecondary: '0 4px 12px rgba(0,0,0,0.08)',

    // Typography
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",

    // Sizing
    controlHeight: 36,
    controlHeightLG: 40,
    controlHeightSM: 28,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      headerHeight: 56,
      siderBg: 'transparent', // Custom gradient via CSS
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(10,126,164,0.2)',
      darkItemSelectedColor: '#FFFFFF',
      darkItemColor: 'rgba(255,255,255,0.45)',
      darkItemHoverColor: 'rgba(255,255,255,0.7)',
    },
    Card: {
      borderRadiusLG: 14,
      paddingLG: 20,
    },
    Table: {
      headerBg: '#FAFBFD',
      rowHoverBg: '#FAFBFD',
      borderColor: '#EEF2F6',
    },
    Select: {
      borderRadius: 8,
    },
    Button: {
      borderRadius: 8,
      primaryShadow: '0 2px 4px rgba(10,126,164,0.2)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Drawer: {
      borderRadius: 0,
    },
  },
};
```

---

## 12. Estructura de Archivos

```
apps/web/src/
├── theme/
│   ├── eco-theme.ts          # ThemeConfig de Ant Design
│   ├── chart-theme.ts         # Constantes de Recharts (colores, config)
│   └── constants.ts           # Colores semánticos, sentiment colors
│
├── components/
│   ├── layout/
│   │   ├── EcoLayout.tsx      # Layout principal (Sider + Header + Content)
│   │   ├── EcoSidebar.tsx     # Sidebar con Menu de Ant + gradiente custom
│   │   └── EcoHeader.tsx      # Header con breadcrumbs + agencia + date + user
│   │
│   ├── data-display/
│   │   ├── EcoStatCard.tsx    # KPI card con sparkline
│   │   ├── EcoChartCard.tsx   # Container para gráficos
│   │   ├── EcoMentionsTable.tsx # Tabla rica de menciones
│   │   └── EcoMentionDrawer.tsx # Drawer de detalle
│   │
│   ├── ui/
│   │   ├── EcoSentimentBadge.tsx  # Badge de sentimiento
│   │   ├── EcoSourceBadge.tsx     # Badge de fuente social
│   │   ├── EcoPeriodSelector.tsx  # Selector 7D/30D/90D
│   │   └── EcoFilterBar.tsx       # Barra de filtros reutilizable
│   │
│   └── feedback/
│       ├── EcoSkeleton.tsx    # Skeletons pre-configurados por tipo
│       └── EcoEmpty.tsx       # Empty states con mensajes en español
│
├── app/
│   ├── layout.tsx             # Root layout con ConfigProvider + theme
│   ├── (auth)/
│   │   └── sign-in/page.tsx   # Login con Ant Form
│   └── (dashboard)/
│       ├── layout.tsx         # Dashboard layout con EcoLayout
│       ├── dashboard/page.tsx
│       ├── mentions/page.tsx
│       ├── sentiment/page.tsx
│       ├── topics/page.tsx
│       ├── geography/page.tsx
│       ├── alerts/page.tsx
│       └── settings/page.tsx
```

---

## 13. Páginas — Mapeo de componentes Ant Design

### Dashboard
- 4x `EcoStatCard` en grid 4 columnas
- `EcoChartCard` con `AreaChart` (timeline) + `EcoPeriodSelector`
- `EcoChartCard` con `PieChart` (sentimiento donut)
- `EcoChartCard` con barras horizontales custom (top fuentes)
- `Card` de Ant con lista de menciones recientes

### Menciones
- `EcoFilterBar` arriba (Select sentimiento, Select fuente, Select pertinencia, Input.Search)
- `EcoMentionsTable` con paginación
- `EcoMentionDrawer` al hacer click en una fila

### Sentimiento
- `EcoChartCard` con `AreaChart` stacked (timeline sentimiento)
- `EcoChartCard` con `BarChart` grouped (por fuente)
- `EcoChartCard` con `RadarChart` (emociones)
- `EcoChartCard` con `BarChart` (Brandwatch vs Claude)

### Tópicos
- Grid de `Card` (tópicos principales con conteo)
- `Table` de Ant con expansión (tópico → subtópicos)

### Geografía
- `EcoChartCard` con `BarChart` horizontal (top municipios)
- `Collapse` de Ant para regiones con lista de municipios

### Alertas
- `Table` de Ant (reglas de alertas) con `Switch` para toggle
- `Button` "Nueva Regla" → `Modal` con `Form` de Ant
- `Table` de historial de alertas

### Configuración
- `Descriptions` de Ant (display de info read-only)
- Secciones: Agencia, Brandwatch, NLP, Sistema

### Sign-in
- `Card` centrado con `Form` de Ant
- `Input` email + `Input.Password` + `Button` submit
- `Alert` de Ant para errores

---

## 14. Migración de datos fetching

Aprovechar la migración para activar `@tanstack/react-query` (ya instalado, no usado):

- Cada página usa `useQuery` en vez de `useEffect` + `useState` manual
- Beneficios: caching automático, retry, loading/error states, refetch en focus
- Query keys por página: `['dashboard', agencyId, dateRange]`, `['mentions', filters]`, etc.

---

## 15. Accesibilidad

La migración a Ant Design mejora automáticamente la accesibilidad:

- `Table`: roles ARIA, keyboard navigation, screen reader support nativos
- `Form`: labels asociados, error messages con aria-describedby
- `Menu`: keyboard navigation, aria-current
- `Modal`/`Drawer`: focus trap, ESC to close, aria-modal
- `Select`: combobox role, listbox, option roles
- `Button`: focus visible, disabled state

**Adicional a implementar:**
- `lang="es"` en html (ya existe)
- Skip-to-content link
- Alt text en logo
- Announcements de live regions para filtros/loading (Ant `message` lo hace automáticamente)

---

## 16. Verificación

### Funcional
1. Todas las 9 páginas renderizan sin errores
2. Sidebar colapsa/expande correctamente
3. Filtros en Menciones actualizan la tabla
4. Click en mención abre Drawer con datos correctos
5. Selector de agencia y date range picker funcionan
6. Paginación de tabla funciona
7. Toggle de alertas funciona
8. Login con Cognito funciona
9. Logout limpia cookies y redirige

### Visual
1. Paleta Mar Caribe aplicada consistentemente
2. Sin rastros de Tailwind CSS (cero clases `bg-`, `text-`, `flex`, etc.)
3. Skeletons aparecen durante carga
4. Empty states aparecen cuando no hay datos
5. Gráficos usan colores correctos (sentimiento = verde/gris/rojo, otros = paleta Mar Caribe)
6. Responsive: funciona correctamente en 1280px+

### Técnico
1. `npx tsc --noEmit` pasa sin errores
2. No hay imports de Tailwind en ningún archivo
3. `postcss.config.mjs` eliminado
4. `globals.css` reemplazado por theme config
5. Bundle size razonable (Ant Design tree-shaking funciona)
6. No hay emojis en ningún componente
