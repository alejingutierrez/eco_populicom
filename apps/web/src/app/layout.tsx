'use client';

import { Providers } from '@/components/providers/Providers';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <title>ECO - Escucha Ciudadana Online</title>
        <meta
          name="description"
          content="Plataforma de monitoreo de medios y redes del Gobierno de Puerto Rico"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
