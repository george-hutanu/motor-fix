import { signAccessToken, verifyAccessToken } from './access-token';

const secret = 'test-secret';
const now = Date.UTC(2026, 9, 4, 12, 0, 0);
const claims = {
  accountId: '0b6c4c8e-0f0c-4f53-9d53-0d5b8a4f1e11',
  role: 'garage',
} as const;

describe('access tokens', () => {
  it('carries the account and the role in use', () => {
    const token = signAccessToken(claims, secret, now);

    expect(verifyAccessToken(token, secret, now)).toMatchObject(claims);
  });

  it('tells when the token expires', () => {
    const token = signAccessToken(claims, secret, now, 15);

    expect(verifyAccessToken(token, secret, now)?.expiresAt).toBe(
      now + 15 * 60_000,
    );
  });

  it('is a three-part HS256 token', () => {
    const [header] = signAccessToken(claims, secret, now).split('.');

    expect(
      JSON.parse(Buffer.from(header ?? '', 'base64url').toString()),
    ).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
  });

  it('lives 15 minutes by default', () => {
    const token = signAccessToken(claims, secret, now);

    expect(
      verifyAccessToken(token, secret, now + 15 * 60_000 - 1),
    ).toMatchObject(claims);
    expect(verifyAccessToken(token, secret, now + 15 * 60_000)).toBeNull();
  });

  it('refuses a token signed with another key', () => {
    const token = signAccessToken(claims, 'other-secret', now);

    expect(verifyAccessToken(token, secret, now)).toBeNull();
  });

  it('refuses a token whose payload was changed', () => {
    const [header, , signature] = signAccessToken(claims, secret, now).split(
      '.',
    );
    const forged = Buffer.from(
      JSON.stringify({
        exp: now / 1000 + 900,
        role: 'admin',
        sub: claims.accountId,
      }),
    ).toString('base64url');

    expect(
      verifyAccessToken(`${header}.${forged}.${signature}`, secret, now),
    ).toBeNull();
  });

  it.each([
    '',
    'abc',
    'a.b',
    'a.b.c',
    'a.b.c.d',
  ])('refuses the malformed token %p', (token) => {
    expect(verifyAccessToken(token, secret, now)).toBeNull();
  });

  it('refuses a token naming a role that does not exist', () => {
    const token = signAccessToken(
      { accountId: claims.accountId, role: 'owner' as never },
      secret,
      now,
    );

    expect(verifyAccessToken(token, secret, now)).toBeNull();
  });
});
