/**
 * La sesión es un ID token de Cognito: debe rechazarse todo lo que no venga
 * firmado por nuestro user pool, para nuestro app client y de tipo `id`.
 */
import { SignJWT, generateKeyPair, UnsecuredJWT } from 'jose';
import { verifyIdToken, __setKeyResolverForTests } from './session';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));

const POOL = 'us-east-1_TESTPOOL';
const CLIENT = 'test-client-id';
const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;

type Keys = Awaited<ReturnType<typeof generateKeyPair>>;
let ours: Keys;
let theirs: Keys;

async function token(
  key: Keys['privateKey'],
  over: Record<string, unknown> = {},
  opts: { iss?: string; aud?: string; exp?: string } = {},
): Promise<string> {
  return new SignJWT({ email: 'ana@ddec.pr.gov', token_use: 'id', 'cognito:groups': ['viewer'], ...over })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setSubject('sub-123')
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? CLIENT)
    .setExpirationTime(opts.exp ?? '1h')
    .sign(key);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = POOL;
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = CLIENT;
  ours = await generateKeyPair('RS256');
  theirs = await generateKeyPair('RS256');
});

beforeEach(() => {
  __setKeyResolverForTests(async () => ours.publicKey, ISSUER);
});

test('acepta un ID token firmado por el pool', async () => {
  const user = await verifyIdToken(await token(ours.privateKey));
  expect(user).toMatchObject({ sub: 'sub-123', email: 'ana@ddec.pr.gov', groups: ['viewer'] });
});

test('rechaza un token sin firma (alg none) con claims de admin', async () => {
  const forged = new UnsecuredJWT({ email: 'agutierrez@populicom.com', token_use: 'id', 'cognito:groups': ['admin'] })
    .setSubject('x')
    .setIssuer(ISSUER)
    .setAudience(CLIENT)
    .setExpirationTime('1h')
    .encode();
  expect(await verifyIdToken(forged)).toBeNull();
});

test('rechaza un token firmado con otra llave', async () => {
  expect(await verifyIdToken(await token(theirs.privateKey))).toBeNull();
});

test('rechaza emisor, audiencia o tipo de token ajenos', async () => {
  expect(await verifyIdToken(await token(ours.privateKey, {}, { iss: 'https://evil.example/pool' }))).toBeNull();
  expect(await verifyIdToken(await token(ours.privateKey, {}, { aud: 'otro-client' }))).toBeNull();
  expect(await verifyIdToken(await token(ours.privateKey, { token_use: 'access' }))).toBeNull();
});

test('rechaza un token vencido', async () => {
  expect(await verifyIdToken(await token(ours.privateKey, {}, { exp: '-1m' }))).toBeNull();
});

test('sin configuración de Cognito no hay sesión válida', async () => {
  const t = await token(ours.privateKey);
  const saved = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  __setKeyResolverForTests(async () => ours.publicKey, ISSUER); // limpia el caché de verificados
  expect(await verifyIdToken(t)).toBeNull();
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = saved;
});
