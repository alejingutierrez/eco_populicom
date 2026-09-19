/**
 * Preview local del correo de BIENVENIDA (el que llega al ACTIVAR la cuenta).
 *
 * Uso: tsx scripts/preview-welcome.ts
 *      → apps/web/public/emails/welcome-preview.html          (con semanal)
 *      → apps/web/public/emails/welcome-sin-reporte-preview.html (sin correos)
 *
 * Los GIFs se sirven desde la app: arranca `npm run dev -w apps/web` y abre
 * http://localhost:3000/emails/welcome-preview.html para verlos en movimiento.
 */

import { renderWelcomeHtml, renderWelcomeText, welcomeSubject } from '../packages/shared/src/email/render-welcome.ts';
import type { WelcomeRenderData } from '../packages/shared/src/email/render-welcome.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'apps', 'web', 'public', 'emails');

const base: WelcomeRenderData = {
  firstName: 'Leslie',
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyShortName: 'DDEC',
  signInUrl: 'https://citizenecho.com/sign-in',
  // Relativa a propósito: así el preview funciona igual abierto como archivo
  // suelto que servido por el dev server en /emails/welcome-preview.html.
  assetsBaseUrl: 'welcome/',
  scheduledReport: {
    title: 'Un correo los viernes',
    body: 'Cada viernes a las <strong>3:00 PM</strong> te llega el reporte semanal del Departamento de Desarrollo Económico y Comercio: la semana comparada contra la anterior — qué subió, qué bajó y qué lo explica. No hace falta que entres para enterarte.',
  },
};

const conSemanal = join(outDir, 'welcome-preview.html');
writeFileSync(conSemanal, renderWelcomeHtml(base), 'utf8');
console.log(`Preview escrito: ${conSemanal}`);
console.log(`  asunto: ${welcomeSubject(base)}`);

const sinReporte = join(outDir, 'welcome-sin-reporte-preview.html');
writeFileSync(sinReporte, renderWelcomeHtml({ ...base, firstName: 'Ana', scheduledReport: null }), 'utf8');
console.log(`Preview escrito: ${sinReporte}`);

console.log('\n--- texto plano ---\n');
console.log(renderWelcomeText(base));
