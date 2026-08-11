import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * WS-F9 — un solo sistema de diseño.
 *
 * Este archivo declaraba un producto DISTINTO del dashboard: primario
 * `#0A7EA4` (turquesa) contra el `#FF6A3D` (naranja) de la SPA, fondos
 * `#FFFFFF` fijos SIN `darkAlgorithm`, radios 8/14/6 contra los 4/6/10 de los
 * tokens, `controlHeight: 36` (bajo el mínimo táctil de 44) y `fontFamily` de
 * fuentes del sistema con el comentario "no external loading" — así que estas
 * páginas nunca iban a recibir Besley/Krub.
 *
 * Y no es una pantalla aparte: se EMBEBEN por iframe dentro de la SPA
 * (screens.js:2938 y 3060), así que el panel de configuración aparecía como una
 * isla clara de otra marca dentro de un dashboard oscuro.
 *
 * Ahora los valores se derivan de `tokens.css` — la misma fuente que consume la
 * SPA. Los hex están duplicados aquí porque Ant Design necesita literales en
 * tiempo de configuración y no puede leer custom properties; el comentario de
 * cada uno dice de qué token viene, y `globals.css` importa `tokens.css` para
 * que todo lo que NO sea Ant use la variable directamente.
 */

export const ecoTheme: ThemeConfig = {
  // MISMO modo que la SPA. Sin esto los paneles embebidos por iframe salían en
  // claro dentro de un dashboard oscuro.
  algorithm: antdTheme.darkAlgorithm,
  token: {
    // Colores — derivados de tokens.css (tema mando, modo oscuro)
    colorPrimary: '#FF6A3D',        // --accent
    colorSuccess: '#3FD47A',        // --pos
    colorError: '#FF5470',          // --neg  (ya separado de --accent)
    colorWarning: '#FFC043',        // --warn
    colorInfo: '#58A6FF',           // --info
    colorBgLayout: '#060A10',       // --bg
    colorBgContainer: '#0E1620',    // --canvas
    colorBgElevated: '#16202C',     // --surface-raised
    colorText: '#E6ECF3',           // --text
    colorTextSecondary: '#A2ACBA',  // --text-2   (7.92:1)
    colorTextTertiary: '#7C8798',   // --text-3   (5.00:1, antes fallaba AA)
    colorTextQuaternary: '#525B68', // --text-disabled
    colorBorder: 'rgba(255,255,255,0.12)',   // --hairline-strong
    colorBorderSecondary: 'rgba(255,255,255,0.06)', // --hairline

    // Radios — --r-md / --r-lg / --r-sm. Antes 8/14/6, que no coincidía con
    // ningún token y hacía que las cards embebidas tuvieran otra curvatura.
    borderRadius: 6,
    borderRadiusLG: 10,
    borderRadiusSM: 4,

    // Elevación — --shadow / --shadow-lg
    boxShadow: '0 1px 0 rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
    boxShadowSecondary: '0 24px 64px -24px rgba(0,0,0,0.8)',

    // Tipografía — las MISMAS familias que la SPA. Se cargan en layout.tsx.
    fontFamily: "'Krub', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 14,       // --fs-body. Antes el default de Ant (14) coincidía por azar.
    fontSizeSM: 12,     // --fs-caption, el piso de legibilidad
    fontSizeLG: 15,     // --fs-body-lg
    fontSizeHeading3: 20,
    fontSizeHeading4: 17,

    // Tamaño de control: 44px es el mínimo táctil (WCAG 2.1 AAA SC 2.5.5) y 24
    // el mínimo AA (WCAG 2.2 SC 2.5.8). Antes 36/40/28 — el SM quedaba bajo AA
    // en algunos temas.
    controlHeight: 40,
    controlHeightLG: 44,
    controlHeightSM: 32,
  },
  components: {
    Layout: {
      headerBg: '#0E1620',        // --canvas
      headerHeight: 56,
      siderBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(255,106,61,0.18)',  // --rail-active-bg
      darkItemSelectedColor: '#FFFFFF',             // --rail-fg-active
      darkItemColor: 'rgba(255,255,255,0.44)',      // --rail-fg
      darkItemHoverColor: 'rgba(255,255,255,0.7)',
      darkItemHoverBg: 'rgba(255,255,255,0.05)',
    },
    Card: {
      borderRadiusLG: 10,   // --r-lg
      paddingLG: 20,        // --pad-card-lg
      colorBgContainer: '#0E1620',
    },
    Table: {
      headerBg: '#091018',                       // --canvas-2
      rowHoverBg: '#16202C',                     // --surface-raised
      borderColor: 'rgba(255,255,255,0.06)',     // --hairline
    },
    Select: {
      borderRadius: 4,      // --r-sm
    },
    Button: {
      borderRadius: 4,      // --r-sm
      // El primario es naranja y el texto encima va OSCURO: blanco sobre
      // --accent da 2.85:1 y falla AA. Es la misma regla --on-accent de la SPA.
      primaryColor: '#1A0A04',
      primaryShadow: 'none',
    },
    Tag: {
      borderRadiusSM: 4,
    },
    Input: {
      borderRadius: 4,
      colorBgContainer: '#070C13',   // --surface-inset
    },
    Modal: {
      contentBg: '#1B2632',          // --surface-overlay
      headerBg: '#1B2632',
      borderRadiusLG: 10,
    },
    Drawer: {
      colorBgElevated: '#1B2632',
    },
    Tooltip: {
      colorBgSpotlight: '#1B2632',
      colorTextLightSolid: '#E6ECF3',
    },
  },
};
