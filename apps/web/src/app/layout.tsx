'use client';

import { Providers } from '@/components/providers/Providers';
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
