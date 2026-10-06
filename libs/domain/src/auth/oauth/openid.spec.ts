import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';

import {
  appleClientSecret,
  authorizationUrl,
  OpenIdError,
  pkce,
  verifyIdToken,
} from './openid';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS = [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'k1' }];
const NOW = 1_800_000_000_000;
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function token(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' },
  key = rsa.privateKey,
) {
  const data = `${encode(header)}.${encode(claims)}`;
  return `${data}.${createSign('sha256').update(data).sign(key).toString('base64url')}`;
}

const CLAIMS = {
  aud: 'client-1',
  email: 'Elena@Example.test',
  email_verified: true,
  exp: NOW / 1000 + 300,
  iss: 'https://issuer.test',
  name: 'Elena Pop',
  nonce: 'n-1',
  sub: 'sub-1',
};
const CHECK = {
  audience: 'client-1',
  issuers: ['https://issuer.test'],
  keys: KEYS,
  nonce: 'n-1',
  now: NOW,
};

describe('verifyIdToken', () => {
  it('answers the subject, e-mail, whether it is verified, and the name', () => {
    expect(verifyIdToken(token(CLAIMS), CHECK)).toEqual({
      email: 'Elena@Example.test',
      emailVerified: true,
      name: 'Elena Pop',
      subject: 'sub-1',
    });
  });

  it('reads Apple\'s "true" string as verified, and anything else as not', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, email_verified: 'true' }), CHECK)
        .emailVerified,
    ).toBe(true);
    expect(
      verifyIdToken(token({ ...CLAIMS, email_verified: 'false' }), CHECK)
        .emailVerified,
    ).toBe(false);
    const { email_verified: _, ...unsaid } = CLAIMS;
    expect(verifyIdToken(token(unsaid), CHECK).emailVerified).toBe(false);
  });

  it('accepts an audience given as a list that holds the client', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, aud: ['other', 'client-1'] }), CHECK)
        .subject,
    ).toBe('sub-1');
  });

  it.each([
    ['another issuer', token({ ...CLAIMS, iss: 'https://evil.test' })],
    ['another audience', token({ ...CLAIMS, aud: 'client-2' })],
    ['another nonce', token({ ...CLAIMS, nonce: 'n-2' })],
    ['no nonce', token({ ...CLAIMS, nonce: undefined })],
    ['an expired token', token({ ...CLAIMS, exp: NOW / 1000 - 61 })],
    ['no subject', token({ ...CLAIMS, sub: '' })],
    ['a foreign signature', token(CLAIMS, undefined, stranger.privateKey)],
    ['an unknown key id', token(CLAIMS, { alg: 'RS256', kid: 'k9' })],
    ['the none algorithm', token(CLAIMS, { alg: 'none', kid: 'k1' })],
    ['an HMAC algorithm', token(CLAIMS, { alg: 'HS256', kid: 'k1' })],
    ['three dots', `${token(CLAIMS)}.x`],
    ['a non-token', 'not-a-token'],
  ])('refuses %s', (_, idToken) => {
    expect(() => verifyIdToken(idToken, CHECK)).toThrow(OpenIdError);
  });

  it('refuses a token naming no key, even when a published key names none', () => {
    const { kid: _kid, ...unnamed } = KEYS[0];
    expect(() =>
      verifyIdToken(token(CLAIMS, { alg: 'RS256' }), {
        ...CHECK,
        keys: [unnamed],
      }),
    ).toThrow(new OpenIdError('unknown signing key'));
  });

  it('allows a minute of clock skew on the expiry', () => {
    expect(
      verifyIdToken(token({ ...CLAIMS, exp: NOW / 1000 - 30 }), CHECK).subject,
    ).toBe('sub-1');
  });
});

describe('pkce', () => {
  it('pairs a fresh verifier with its S256 challenge', () => {
    const one = pkce();
    const two = pkce();

    expect(one.verifier).toMatch(/^[\w-]{43,128}$/);
    expect(one.challenge).toBe(
      createHash('sha256').update(one.verifier).digest('base64url'),
    );
    expect(two.verifier).not.toBe(one.verifier);
  });
});

describe('authorizationUrl', () => {
  const base = {
    challenge: 'ch',
    clientId: 'client-1',
    endpoint: 'https://issuer.test/authorize?x=1',
    nonce: 'n-1',
    redirectUri: 'https://web.test/api/v1/auth/oauth/google/callback',
    state: 's-1',
  };

  it('asks Google for a code with PKCE, state and nonce', () => {
    const url = new URL(authorizationUrl('google', base));

    expect(url.origin + url.pathname).toBe('https://issuer.test/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      nonce: 'n-1',
      redirect_uri: base.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: 's-1',
      x: '1',
    });
  });

  it('asks Apple to post the answer, with the name and e-mail scopes', () => {
    const url = new URL(authorizationUrl('apple', base));

    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('scope')).toBe('openid email name');
  });
});

describe('appleClientSecret', () => {
  it('is an ES256 token Apple can check with the key, valid five minutes', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const secret = appleClientSecret({
      audience: 'https://appleid.apple.com',
      clientId: 'ro.motorfix.web',
      keyId: 'KEY123',
      now: NOW,
      privateKey: ec.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString(),
      teamId: 'TEAM123',
    });
    const [header, claims, signature] = secret.split('.');
    const read = (part: string) =>
      JSON.parse(Buffer.from(part, 'base64url').toString());

    expect(read(header)).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(read(claims)).toEqual({
      aud: 'https://appleid.apple.com',
      exp: NOW / 1000 + 300,
      iat: NOW / 1000,
      iss: 'TEAM123',
      sub: 'ro.motorfix.web',
    });
    expect(
      createVerify('sha256')
        .update(`${header}.${claims}`)
        .verify(
          { dsaEncoding: 'ieee-p1363', key: ec.publicKey },
          Buffer.from(signature, 'base64url'),
        ),
    ).toBe(true);
  });
});
