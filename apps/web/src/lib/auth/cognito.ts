import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

let userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool {
  if (!userPool) {
    const poolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '';
    const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
    if (!poolId || !clientId) {
      throw new Error('Cognito UserPoolId and ClientId are required');
    }
    userPool = new CognitoUserPool({
      UserPoolId: poolId,
      ClientId: clientId,
    });
  }
  return userPool;
}

export interface AuthResult {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Resultado de `signIn`:
 * - `success`: la sesión está lista (`tokens`).
 * - `newPasswordRequired`: la cuenta fue creada por un admin (estado
 *   FORCE_CHANGE_PASSWORD) y debe fijar su contraseña; se devuelve el
 *   `CognitoUser` para completar el reto con `completeNewPassword`.
 */
export type SignInResult =
  | { kind: 'success'; tokens: AuthResult }
  | { kind: 'newPasswordRequired'; user: CognitoUser };

function sessionToTokens(session: CognitoUserSession): AuthResult {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
  };
}

export function signIn(email: string, password: string): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const user = new CognitoUser({ Username: email, Pool: pool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(authDetails, {
      onSuccess: (session: CognitoUserSession) => {
        resolve({ kind: 'success', tokens: sessionToTokens(session) });
      },
      onFailure: (err) => reject(err),
      // Cuenta creada por admin con contraseña temporal: hay que fijar la
      // contraseña definitiva antes de obtener sesión. Conservamos el mismo
      // CognitoUser para `completeNewPassword`.
      newPasswordRequired: () => {
        resolve({ kind: 'newPasswordRequired', user });
      },
    });
  });
}

/** Completa el reto FORCE_CHANGE_PASSWORD fijando la contraseña definitiva. */
export function completeNewPassword(user: CognitoUser, newPassword: string): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    // No reenviamos atributos requeridos: email ya viene seteado/verificado
    // desde AdminCreateUser, así que un objeto vacío evita el error de
    // "attributes ... cannot be updated".
    user.completeNewPasswordChallenge(
      newPassword,
      {},
      {
        onSuccess: (session: CognitoUserSession) => resolve(sessionToTokens(session)),
        onFailure: (err) => reject(err),
      },
    );
  });
}

/** Dispara el envío del código de recuperación al correo del usuario. */
export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() });
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

/** Confirma el código y fija la nueva contraseña. */
export function confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    try {
      const pool = getUserPool();
      const user = pool.getCurrentUser();
      if (!user) {
        resolve(null);
        return;
      }
      user.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session?.isValid()) {
          resolve(null);
          return;
        }
        resolve(session);
      });
    } catch {
      resolve(null);
    }
  });
}

export function signOut(): void {
  try {
    const pool = getUserPool();
    const user = pool.getCurrentUser();
    user?.signOut();
  } catch {
    // Ignore if pool not initialized
  }
}
