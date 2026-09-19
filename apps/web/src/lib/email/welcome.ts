/**
 * Correo de BIENVENIDA — se manda UNA vez, cuando la persona activa su cuenta.
 *
 * Son dos correos y en este orden: Cognito manda la INVITACIÓN (contraseña
 * temporal) al crear la cuenta, y esto manda la BIENVENIDA en el primer ingreso
 * exitoso. Antes de ago-2026 el segundo se escribía y se enviaba a mano.
 *
 * La marca `users.welcome_email_sent_at` es el candado: se estampa al
 * RECLAMARLA —antes de llamar a SES— para que dos peticiones simultáneas de
 * /api/auth/me no manden dos correos, y se devuelve a NULL si el envío falla,
 * para reintentarlo en el próximo ingreso. La migración 0007 la estampó para
 * todas las cuentas que ya existían: esto solo alcanza a las nuevas.
 */

import { getDb, users, agencies, reportConfigs, reportSendLog } from '@eco/database';
import { and, eq, isNull } from 'drizzle-orm';
import {
  renderWelcomeHtml,
  renderWelcomeText,
  welcomeSubject,
  type WelcomeRenderData,
} from '@eco/shared/src/email/render-welcome';
import { log } from '@/lib/log';
import { APP_BASE_URL, EMAIL_FROM, sendEmail } from './ses';

/** template_key del histórico (/settings/reports). Ver TEMPLATE_KEY_TO_KIND. */
const TEMPLATE_KEY = 'welcome-v1';

const DOW_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** 6 → "6:00 AM"; 15 → "3:00 PM". */
function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix}`;
}

/** Siglas de la agencia para el asunto. Mismas reglas que el weekly-report. */
function agencyShortName(slug: string): string {
  if (slug.startsWith('ddec')) return 'DDEC';
  if (slug.startsWith('dtop')) return 'DTOP';
  if (slug.startsWith('dac')) return 'DACo';
  if (slug.startsWith('aaa')) return 'AAA';
  if (slug.startsWith('sgpr')) return 'SGPR';
  return slug.toUpperCase().slice(0, 6);
}

/** "del Departamento…" / "de la Autoridad…" — misma regla de artículo que el
 *  template: la terminación de la primera palabra acierta en todas las
 *  agencias monitoreadas. Sin esto sale "reporte semanal de Departamento de…". */
function ofAgency(agencyName: string): string {
  const first = agencyName.trim().split(/\s+/)[0] ?? '';
  return /a$/i.test(first) ? `de la ${agencyName}` : `del ${agencyName}`;
}

/** "Verónica Pérez" → "Verónica"; sin nombre, la parte local del correo. */
function firstNameOf(name: string | null, email: string): string {
  const n = (name ?? '').trim();
  if (n) return n.split(/\s+/)[0];
  const local = email.split('@')[0].split(/[._-]+/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'hola';
}

/**
 * Qué correo automático recibe de verdad esta persona. `null` = ninguno, y
 * entonces el correo NO promete nada: en ago-2026 hubo que borrar dos promesas
 * falsas del texto (crear alertas y el reporte diario) porque el rol no las
 * tenía. Las dos fuentes son la lista del config (diario + semanal, es una
 * sola) y el opt-in por usuario, que refleja las reglas EventBridge dirigidas.
 */
function scheduledReportFor(
  agencyName: string,
  cfg: { recipients: string[]; isActive: boolean; sendHourLocal: number; weeklyEnabled: boolean; weeklySendDow: number; weeklySendHourLocal: number } | null,
  email: string,
  weeklyOptin: boolean,
): WelcomeRenderData['scheduledReport'] {
  const inConfig = !!cfg && cfg.isActive && cfg.recipients.some((r) => r.toLowerCase() === email.toLowerCase());
  const weekly = (inConfig && !!cfg?.weeklyEnabled) || weeklyOptin;
  const daily = inConfig;
  if (!daily && !weekly) return null;

  const dow = DOW_ES[cfg?.weeklySendDow ?? 5] ?? 'viernes';
  const weeklyAt = hourLabel(cfg?.weeklySendHourLocal ?? 15);
  const dailyAt = hourLabel(cfg?.sendHourLocal ?? 6);

  if (daily && weekly) {
    return {
      title: 'Dos correos, y no tienes que pedirlos',
      body: `Cada mañana a las <strong>${dailyAt}</strong> te llega el pulso diario ${ofAgency(agencyName)}, y los ${dow} a las <strong>${weeklyAt}</strong> el comparativo de la semana: qué subió, qué bajó y qué lo explica. No hace falta que entres para enterarte.`,
    };
  }
  if (weekly) {
    return {
      title: `Un correo los ${dow}`,
      body: `Cada ${dow} a las <strong>${weeklyAt}</strong> te llega el reporte semanal ${ofAgency(agencyName)}: la semana comparada contra la anterior — qué subió, qué bajó y qué lo explica. No hace falta que entres para enterarte.`,
    };
  }
  return {
    title: 'Un correo cada mañana',
    body: `Cada mañana a las <strong>${dailyAt}</strong> te llega el pulso diario ${ofAgency(agencyName)}: cómo viene la conversación de los últimos siete días. No hace falta que entres para enterarte.`,
  };
}

/**
 * Manda la bienvenida si a esta cuenta todavía le toca. Idempotente y
 * best-effort: cualquier fallo se logea y se traga — que no salga un correo
 * nunca puede tumbar el login.
 */
export async function sendWelcomeEmailIfPending(cognitoSub: string): Promise<void> {
  const db = getDb();

  // Reclamo atómico: solo una petición se lleva la fila con la marca en NULL.
  const [claimed] = await db
    .update(users)
    .set({ welcomeEmailSentAt: new Date() })
    .where(and(eq(users.cognitoSub, cognitoSub), isNull(users.welcomeEmailSentAt)))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      agencyId: users.agencyId,
      weeklyReportOptin: users.weeklyReportOptin,
    });
  if (!claimed) return;

  try {
    const [agency] = await db
      .select({ name: agencies.name, slug: agencies.slug })
      .from(agencies)
      .where(eq(agencies.id, claimed.agencyId))
      .limit(1);
    if (!agency) throw new Error(`agency ${claimed.agencyId} not found`);

    const [cfg] = await db
      .select({
        recipients: reportConfigs.recipients,
        isActive: reportConfigs.isActive,
        sendHourLocal: reportConfigs.sendHourLocal,
        weeklyEnabled: reportConfigs.weeklyEnabled,
        weeklySendDow: reportConfigs.weeklySendDow,
        weeklySendHourLocal: reportConfigs.weeklySendHourLocal,
      })
      .from(reportConfigs)
      .where(eq(reportConfigs.agencyId, claimed.agencyId))
      .limit(1);

    const data: WelcomeRenderData = {
      firstName: firstNameOf(claimed.name, claimed.email),
      agencyName: agency.name,
      agencyShortName: agencyShortName(agency.slug),
      signInUrl: `${APP_BASE_URL}/sign-in`,
      assetsBaseUrl: `${APP_BASE_URL}/emails/welcome/`,
      scheduledReport: scheduledReportFor(agency.name, cfg ?? null, claimed.email, claimed.weeklyReportOptin),
    };

    const messageId = await sendEmail({
      to: claimed.email,
      subject: welcomeSubject(data),
      html: renderWelcomeHtml(data),
      text: renderWelcomeText(data),
    });

    await db.insert(reportSendLog).values({
      agencyId: claimed.agencyId,
      recipients: [claimed.email],
      fromEmail: EMAIL_FROM,
      templateKey: TEMPLATE_KEY,
      trigger: 'scheduled',
      status: 'sent',
      messageId: messageId || null,
    });
    log.info('email.welcome', 'bienvenida enviada', { email: claimed.email, agency: agency.slug });
  } catch (err) {
    const msg = (err as Error).message;
    // Se libera la marca para reintentar en el próximo ingreso: es preferible
    // un correo tarde a ninguno, y el reclamo atómico evita el duplicado.
    await db
      .update(users)
      .set({ welcomeEmailSentAt: null })
      .where(eq(users.id, claimed.id))
      .catch(() => {});
    await db
      .insert(reportSendLog)
      .values({
        agencyId: claimed.agencyId,
        recipients: [claimed.email],
        fromEmail: EMAIL_FROM,
        templateKey: TEMPLATE_KEY,
        trigger: 'scheduled',
        status: 'failed',
        error: msg,
      })
      .catch(() => {});
    log.error('email.welcome', 'no se pudo enviar la bienvenida', { email: claimed.email, msg });
  }
}
