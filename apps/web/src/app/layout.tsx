import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ECO — Social Listening',
  description: 'Plataforma de Social Listening del Gobierno de Puerto Rico',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
