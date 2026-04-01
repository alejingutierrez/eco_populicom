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

export function signIn(email: string, password: string): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    const user = new CognitoUser({ Username: email, Pool: pool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(authDetails, {
      onSuccess: (session: CognitoUserSession) => {
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
        });
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => reject(new Error('New password required')),
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
