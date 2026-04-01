'use client';

import { ConfigProvider, App as AntApp } from 'antd';
import esES from 'antd/locale/es_ES';
import { ecoTheme } from '@/theme/eco-theme';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <title>ECO — Social Listening</title>
        <meta
          name="description"
          content="Plataforma de Social Listening del Gobierno de Puerto Rico"
        />
      </head>
      <body>
        <ConfigProvider theme={ecoTheme} locale={esES}>
          <AntApp>{children}</AntApp>
        </ConfigProvider>
      </body>
    </html>
  );
}
