import { log } from '@/lib/log';
import type { Role } from './roles';

const POOL_ID =
  process.env.COGNITO_USER_POOL_ID || process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '';

/** Rol → grupo Cognito. viewer no necesita grupo (es el default sin privilegios). */
function groupForRole(role: Role): string | null {
  return role === 'viewer' ? null : role; // admin/editor/analyst → grupo homónimo
}

/**
 * Qué pasó con el correo de invitación (el de la contraseña temporal):
 *  - `sent`: cuenta nueva, Cognito mandó la invitación.
 *  - `resent`: la cuenta ya existía sin activar (FORCE_CHANGE_PASSWORD); se
 *    reenvió la invitación con una contraseña temporal NUEVA (la anterior deja
 *    de servir — y si había vencido, esta es la única forma de entrar).
 *  - `already_active`: la cuenta ya existía y la persona ya creó su clave; no
 *    hay invitación que mandar (usa «¿Olvidaste tu contraseña?»).
 *  - `not_sent`: no se pudo hablar con Cognito (SDK, permisos, pool).
 */
export type InvitationOutcome = 'sent' | 'resent' | 'already_active' | 'not_sent';

export interface ProvisionResult {
  /** `sub` real de Cognito, o null si no se pudo conocer. */
  sub: string | null;
  invitation: InvitationOutcome;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function subOf(attrs: Array<{ Name?: string; Value?: string }> | undefined): string | null {
  return (attrs || []).find((a) => a.Name === 'sub')?.Value || null;
}

/**
 * Núcleo de la provisión, con el cliente y los comandos inyectados para poder
 * probarlo sin el SDK. Ver `provisionCognitoUser`.
 */
export async function provisionWithClient(
  client: { send: (cmd: any) => Promise<any> },
  m: any,
  poolId: string,
  email: string,
  role: Role,
): Promise<ProvisionResult> {
  const createInput = {
    UserPoolId: poolId,
    Username: email,
    DesiredDeliveryMediums: ['EMAIL'],
  };
  let sub: string | null = null;
  let invitation: InvitationOutcome;
  try {
    const res = await client.send(
      new m.AdminCreateUserCommand({
        ...createInput,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
    sub = subOf(res?.User?.Attributes);
    invitation = 'sent';
  } catch (e) {
    if ((e as { name?: string })?.name !== 'UsernameExistsException') throw e;
    // La cuenta ya existe. Antes aquí se devolvía null SIN reenviar nada: la
    // persona reinvitada nunca recibía correo (y si su contraseña temporal
    // había vencido, no tenía forma de entrar). RESEND solo es válido mientras
    // la cuenta sigue en FORCE_CHANGE_PASSWORD; si ya tiene clave propia,
    // Cognito responde UnsupportedUserStateException.
    try {
      const res = await client.send(
        new m.AdminCreateUserCommand({ ...createInput, MessageAction: 'RESEND' }),
      );
      sub = subOf(res?.User?.Attributes);
      invitation = 'resent';
      log.info('cognito.provision', 'invitación reenviada a cuenta existente', { email });
    } catch (e2) {
      if ((e2 as { name?: string })?.name !== 'UnsupportedUserStateException') throw e2;
      invitation = 'already_active';
      log.info('cognito.provision', 'la cuenta ya está activa; no se reenvía invitación', { email });
      try {
        const got = await client.send(new m.AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
        sub = subOf(got?.UserAttributes);
      } catch {
        /* sin sub: el caller reconcilia por email */
      }
    }
  }

  const group = groupForRole(role);
  if (group) {
    try {
      await client.send(
        new m.AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: email, GroupName: group }),
      );
    } catch {
      log.warn('cognito.provision', 'no se pudo añadir al grupo (¿grupo inexistente?)', { email, group });
    }
  }
  return { sub, invitation };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Crea (o detecta) una cuenta Cognito para `email`, dispara —o REENVÍA, si la
 * cuenta ya existía sin activar— el correo de invitación (contraseña temporal)
 * y la añade al grupo del rol. Nunca lanza: si no se puede provisionar (SDK
 * ausente, sin permisos, pool no configurado) devuelve `not_sent` y el caller
 * usa el placeholder `invited:<email>`, que el JIT reconcilia al primer login.
 *
 * Import dinámico con webpackIgnore: `next build` no intenta empacar
 * @aws-sdk/client-cognito-identity-provider (puede no estar instalado en local);
 * en el contenedor desplegado, con la dep en package.json, se resuelve en runtime.
 */
export async function provisionCognitoUser(email: string, role: Role): Promise<ProvisionResult> {
  if (!POOL_ID) return { sub: null, invitation: 'not_sent' };
  try {
    // @ts-ignore — dep opcional resuelta en runtime dentro del contenedor (en
    // package.json; puede no estar en node_modules local). webpackIgnore deja la
    // resolución a Node en runtime para no romper `next build`.
    const mod = await import(/* webpackIgnore: true */ '@aws-sdk/client-cognito-identity-provider');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = mod as any;
    const client = new m.CognitoIdentityProviderClient({});
    return await provisionWithClient(client, m, POOL_ID, email, role);
  } catch (err) {
    log.warn('cognito.provision', 'SDK admin no disponible o sin permisos — fallback a placeholder', {
      email,
      msg: (err as Error).message,
    });
    return { sub: null, invitation: 'not_sent' };
  }
}
