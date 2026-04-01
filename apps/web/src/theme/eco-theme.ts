import type { ThemeConfig } from 'antd';

export const ecoTheme: ThemeConfig = {
  token: {
    // Colors — Mar Caribe palette
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
    colorTextQuaternary: '#CBD5E1',
    colorBorder: '#E2E8F0',
    colorBorderSecondary: '#EEF2F6',

    // Border radius
    borderRadius: 8,
    borderRadiusLG: 14,
    borderRadiusSM: 6,

    // Shadows
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    boxShadowSecondary: '0 4px 12px rgba(0,0,0,0.08)',

    // Typography — system fonts, no external loading
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",

    // Sizing
    controlHeight: 36,
    controlHeightLG: 40,
    controlHeightSM: 28,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      headerHeight: 56,
      siderBg: 'transparent',
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(10,126,164,0.2)',
      darkItemSelectedColor: '#FFFFFF',
      darkItemColor: 'rgba(255,255,255,0.45)',
      darkItemHoverColor: 'rgba(255,255,255,0.7)',
      darkItemHoverBg: 'rgba(255,255,255,0.05)',
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
    Breadcrumb: {
      fontSize: 12,
      separatorColor: '#CBD5E1',
    },
    Input: {
      borderRadius: 8,
    },
    DatePicker: {
      borderRadius: 8,
    },
    Skeleton: {
      borderRadiusSM: 6,
    },
  },
};
