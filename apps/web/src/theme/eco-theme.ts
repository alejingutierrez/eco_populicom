import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * Tema de Ant Design para las páginas Next.js (sign-in / activación y los
 * paneles de Configuración que la SPA embebe por iframe) — dirección B
 * «Instrumento», la misma de `public/eco-prototype/tokens.css`.
 *
 * Dos reglas de la dirección que aquí se notan:
 *   1. La acción es GRAFITO, no un color de marca: el botón primario es casi
 *      negro en claro y se INVIERTE en oscuro (claro con texto oscuro).
 *   2. El color solo codifica dato; en estas páginas eso deja el croma para
 *      éxito, error y aviso (estados del formulario), nada más.
 *
 * El MODO sigue a la SPA (`eco.mode.v2`, ver Providers.tsx): los paneles se
 * embeben dentro del dashboard, y con un modo fijo aparecían como una isla de
 * otro color. Claro por defecto.
 *
 * Los hex están duplicados porque Ant necesita literales en tiempo de
 * configuración y no lee custom properties; cada uno dice de qué token viene.
 * Lo que NO es Ant usa `var(--…)` directamente (globals.css importa tokens.css).
 */

export type EcoMode = 'light' | 'dark';

const PALETTE = {
  light: {
    action: '#14171C',        // --action
    actionHover: '#2A2F38',   // --action-hover
    actionActive: '#05070A',  // --action-active
    onFill: '#FFFFFF',        // --on-fill
    pos: '#087443',           // --pos
    neg: '#C01A34',           // --neg
    warn: '#845100',          // --warn
    info: '#1F4FD8',          // --info
    bg: '#F4F5F7',            // --bg
    canvas: '#FFFFFF',        // --canvas
    canvas2: '#FAFBFC',       // --canvas-2
    pop: '#FFFFFF',           // --surface-pop
    control: '#FFFFFF',       // --control-bg
    controlHover: '#F4F5F7',  // --control-bg-hover
    text: '#0B0D10',          // --text
    text2: '#4B5563',         // --text-2
    text3: '#626975',         // --text-3
    textDisabled: '#9CA3AF',  // --text-disabled
    hairline: '#E5E7EB',      // --hairline
    hairlineStrong: '#CBD2D9',// --hairline-strong
    shadowPop: '0 8px 24px -8px rgba(11, 13, 16, 0.18), 0 0 0 1px rgba(11, 13, 16, 0.04)',
    shadowModal: '0 24px 64px -16px rgba(11, 13, 16, 0.28)',
  },
  dark: {
    action: '#ECEFF3',
    actionHover: '#FFFFFF',
    actionActive: '#D4D9E0',
    onFill: '#0C0E11',
    pos: '#2FBE72',
    neg: '#FF6B85',
    warn: '#E0A22A',
    info: '#6E9BFF',
    bg: '#0C0E11',
    canvas: '#14171C',
    canvas2: '#0F1215',
    pop: '#1B1F26',
    control: '#1B1F26',
    controlHover: '#242A33',
    text: '#ECEFF3',
    text2: '#A8B0BB',
    text3: '#8A93A0',
    textDisabled: '#5B6472',
    hairline: '#262B33',
    hairlineStrong: '#3A414C',
    shadowPop: '0 8px 24px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04)',
    shadowModal: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
  },
} as const;

export function ecoThemeFor(mode: EcoMode): ThemeConfig {
  const c = PALETTE[mode];
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: c.action,
      colorPrimaryHover: c.actionHover,
      colorPrimaryActive: c.actionActive,
      colorTextLightSolid: c.onFill,
      colorSuccess: c.pos,
      colorError: c.neg,
      colorWarning: c.warn,
      colorInfo: c.info,
      // Enlace = texto + subrayado, no color (ver `.link` en la SPA).
      colorLink: c.text,
      colorLinkHover: c.text2,
      colorLinkActive: c.text,
      linkDecoration: 'underline',
      linkHoverDecoration: 'underline',

      colorBgLayout: c.bg,
      colorBgContainer: c.canvas,
      colorBgElevated: c.pop,
      colorText: c.text,
      colorTextSecondary: c.text2,
      colorTextTertiary: c.text3,
      colorTextQuaternary: c.textDisabled,
      colorTextPlaceholder: c.text3,
      colorBorder: c.hairlineStrong,
      colorBorderSecondary: c.hairline,
      // Foco grafito (regla 3 de la dirección): el anillo azul por defecto de Ant
      // sería el único cromo con croma en pantalla.
      controlOutline: mode === 'dark' ? 'rgba(236, 239, 243, 0.24)' : 'rgba(20, 23, 28, 0.18)',
      controlOutlineWidth: 2,

      // Radios — --r-md / --r-lg / --r-sm.
      borderRadius: 4,
      borderRadiusLG: 6,
      borderRadiusSM: 3,

      // La tarjeta se define por su BORDE; la sombra es solo de lo que flota.
      boxShadow: 'none',
      boxShadowSecondary: c.shadowPop,
      boxShadowTertiary: 'none',

      fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontFamilyCode: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
      fontSize: 14,          // --fs-body
      fontSizeSM: 13,        // --fs-body-sm: el PISO del texto (era 12)
      fontSizeLG: 15,        // --fs-body-lg
      fontSizeHeading3: 24,  // --fs-display-md
      fontSizeHeading4: 18,  // --fs-title-lg
      fontWeightStrong: 600,

      // --control-h-sm / --control-h / --control-h-lg.
      controlHeight: 36,
      controlHeightLG: 44,
      controlHeightSM: 28,

      motionEaseOut: 'cubic-bezier(0.16, 1, 0.3, 1)',  // --ease
      motionDurationMid: '0.2s',                       // --dur
      motionDurationFast: '0.12s',                     // --dur-fast
    },
    components: {
      Layout: {
        headerBg: c.canvas,
        headerHeight: 56,
        bodyBg: c.bg,
        siderBg: 'transparent',
      },
      Card: {
        borderRadiusLG: 6,
        paddingLG: 24,
        colorBgContainer: c.canvas,
      },
      Table: {
        headerBg: c.canvas2,
        rowHoverBg: c.controlHover,
        borderColor: c.hairline,
      },
      Button: {
        primaryColor: c.onFill,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
        defaultBorderColor: c.hairlineStrong,
        fontWeight: 500,
      },
      Input: {
        colorBgContainer: c.control,
        activeShadow: 'none',
        activeBorderColor: c.action,
        hoverBorderColor: c.text3,
      },
      Select: {
        colorBgContainer: c.control,
        activeOutlineColor: 'transparent',
      },
      Modal: {
        contentBg: c.pop,
        headerBg: c.pop,
        borderRadiusLG: 6,
        boxShadow: c.shadowModal,
      },
      Drawer: {
        colorBgElevated: c.pop,
      },
      Tooltip: {
        colorBgSpotlight: mode === 'dark' ? c.pop : c.action,
        colorTextLightSolid: mode === 'dark' ? c.text : c.onFill,
      },
      Alert: {
        // El aviso de estado lleva el color del estado; nada más en la página.
        borderRadiusLG: 4,
      },
    },
  };
}

/** Compatibilidad: el tema claro, por defecto. */
export const ecoTheme = ecoThemeFor('light');
