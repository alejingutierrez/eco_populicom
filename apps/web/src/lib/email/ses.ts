/**
 * Envío de correo transaccional desde la app web (hoy: la bienvenida al activar
 * la cuenta). Los reportes y las alertas los manda su propio Lambda; esto es
 * para lo que nace de una acción del usuario dentro del panel.
 *
 * Remitente: `alerts@citizenecho.com` — la ÚNICA identidad con SPF y DKIM
 * propios. Enviar por SES desde @populicom.com falla las dos comprobaciones
 * (ese dominio está en Google Workspace) y acaba en spam. Reply-To apunta a una
 * persona real porque nadie lee el buzón de alerts@.
 *
 * Import dinámico con webpackIgnore, igual que cognito-admin: `next build` no
 * empaca el SDK y Node lo resuelve en runtime dentro del contenedor.
 */

import { log } from '@/lib/log';

export const EMAIL_FROM = process.env.ECO_EMAIL_FROM || 'alerts@citizenecho.com';
export const EMAIL_FROM_NAME = process.env.ECO_EMAIL_FROM_NAME || 'ECO Radar';
export const EMAIL_REPLY_TO = process.env.ECO_EMAIL_REPLY_TO || 'agutierrez@populicom.com';
/** Base pública del panel — CTAs y assets de los correos. */
export const APP_BASE_URL = (process.env.ECO_APP_BASE_URL || 'https://citizenecho.com').replace(/\/$/, '');

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Envía y devuelve el MessageId de SES. Lanza si el envío falla. */
export async function sendEmail(msg: OutgoingEmail): Promise<string> {
  // @ts-ignore — dep resuelta en runtime dentro del contenedor.
  const mod = await import(/* webpackIgnore: true */ '@aws-sdk/client-ses');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = mod as any;
  const client = new m.SESClient({});
  const res = await client.send(
    new m.SendEmailCommand({
      Source: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
      Destination: { ToAddresses: [msg.to] },
      ReplyToAddresses: [EMAIL_REPLY_TO],
      Message: {
        Subject: { Data: msg.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: msg.html, Charset: 'UTF-8' },
          Text: { Data: msg.text, Charset: 'UTF-8' },
        },
      },
    }),
  );
  const id = res?.MessageId as string | undefined;
  log.info('email.send', 'enviado', { to: msg.to, messageId: id ?? null });
  return id ?? '';
}
