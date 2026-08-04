'use client';

import { Providers } from '@/components/providers/Providers';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-mode="dark" para que los tokens de tokens.css resuelvan igual que en
    // la SPA. Sin esto las páginas Next.js caían en el modo claro y aparecían
    // como una isla clara dentro del dashboard oscuro que las embebe por iframe.
    <html lang="es" data-theme="mando" data-mode="dark">
      <head>
        <title>ECO - Escucha Ciudadana Online</title>
        <meta
          name="description"
          content="Plataforma de monitoreo de medios y redes del Gobierno de Puerto Rico"
        />
        {/* WS-F9: las MISMAS familias que la SPA. `ecoTheme` las declara en
            `fontFamily`, pero si no se cargan aquí Ant cae al stack del sistema. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Besley:ital,wght@0,400..800;1,400..600&family=Krub:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
