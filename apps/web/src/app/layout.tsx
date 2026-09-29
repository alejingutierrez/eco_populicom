'use client';

import { Providers } from '@/components/providers/Providers';
import './globals.css';

// Modo ANTES del primer pintado, con la MISMA clave que la SPA (`eco.mode.v2`,
// ver public/eco-prototype/index.html): claro por defecto, oscuro solo si la
// persona lo eligió. Antes esto era `data-mode="dark"` fijo, que con la SPA en
// claro dejaba los paneles embebidos por iframe como una isla oscura.
const MODE_SCRIPT = `try{var m=localStorage.getItem('eco.mode.v2');if(m==='dark'||m==='light')document.documentElement.setAttribute('data-mode',m)}catch(_){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="mando" data-mode="light" suppressHydrationWarning>
      <head>
        <title>ECO - Escucha Ciudadana Online</title>
        <meta
          name="description"
          content="Plataforma de monitoreo de medios y redes del Gobierno de Puerto Rico"
        />
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
        {/* Las MISMAS familias que la SPA («Instrumento»): Plex Sans para el
            texto, Plex Mono para toda cifra. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
