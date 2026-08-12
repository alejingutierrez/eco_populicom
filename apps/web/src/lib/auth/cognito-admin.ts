import { log } from '@/lib/log';
import type { Role } from './roles';

const POOL_ID =
  process.env.COGNITO_USER_POOL_ID || process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '';

/** Rol → grupo Cognito. viewer no necesita grupo (es el default sin privilegios). */
function groupForRole(role: Role): string | null {
  return role === 'viewer' ? null : role; // admin/editor/analyst → grupo homónimo
}

/**
 * Crea (o detecta) una cuenta Cognito para `email`, dispara el correo de
 * invitación (contraseña temporal) y la añade al grupo del rol. Devuelve el
 * `sub` real, o `null` si no se pudo provisionar (SDK ausente, sin permisos,
 * pool no configurado, o el usuario ya existe). En `null` el caller usa el
 * placeholder `invited:<email>` y el JIT provisioning lo reconcilia al primer
 * login — así el invitar nunca falla en duro.
 *
 * Import dinámico con webpackIgnore: `next build` no intenta empacar
 * @aws-sdk/client-cognito-identity-provider (puede no estar instalado en local);
 * en el contenedor desplegado, con la dep en package.json, se resuelve en runtime.
 */
export async function provisionCognitoUser(email: string, role: Role): Promise<string | null> {
  if (!POOL_ID) return null;
  try {
    // @ts-ignore — dep opcional resuelta en runtime dentro del contenedor (en
    // package.json; puede no estar en node_modules local). webpackIgnore deja la
    // resolución a Node en runtime para no romper `next build`.
    const mod = await import(/* webpackIgnore: true */ '@aws-sdk/client-cognito-identity-provider');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = mod as any;
    const client = new m.CognitoIdentityProviderClient({});

    let sub: string | null = null;
    try {
      const res = await client.send(
        new m.AdminCreateUserCommand({
          UserPoolId: POOL_ID,
          Username: email,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attrs: Array<{ Name?: string; Value?: string }> = res?.User?.Attributes || [];
      sub = attrs.find((a) => a.Name === 'sub')?.Value || null;
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'UsernameExistsException') {
        log.warn('cognito.provision', 'user already exists in Cognito', { email });
        return null; // el JIT reclamará la fila por email en el próximo login
      }
      throw e;
    }

    const group = groupForRole(role);
    if (group) {
      try {
        await client.send(
          new m.AdminAddUserToGroupCommand({ UserPoolId: POOL_ID, Username: email, GroupName: group }),
        );
      } catch {
        log.warn('cognito.provision', 'no se pudo añadir al grupo (¿grupo inexistente?)', { email, group });
      }
    }
    return sub;
  } catch (err) {
    log.warn('cognito.provision', 'SDK admin no disponible o sin permisos — fallback a placeholder', {
      msg: (err as Error).message,
    });
    return null;
  }
}
