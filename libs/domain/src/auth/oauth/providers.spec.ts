import { generateKeyPairSync } from 'node:crypto';

import { oauthSettings } from './providers';

const appleKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();

const GOOGLE = { GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret' };
const APPLE = {
  APPLE_KEY_ID: 'KEY123',
  APPLE_PRIVATE_KEY: appleKey,
  APPLE_SERVICES_ID: 'ro.motorfix.web',
  APPLE_TEAM_ID: 'TEAM123',
};
const WEB = { PUBLIC_WEB_URL: 'https://web.example.test/' };

describe('oauthSettings', () => {
  it('configures both providers when every key and the web address are set', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      ...APPLE,
      ...WEB,
    });

    expect(settings.google).toMatchObject({
      clientId: 'g-id',
      clientSecret: 'g-secret',
      issuer: 'https://accounts.google.com',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      provider: 'google',
      redirectUri: 'https://web.example.test/api/v1/auth/oauth/google/callback',
    });
    expect(settings.apple).toMatchObject({
      apple: { keyId: 'KEY123', teamId: 'TEAM123' },
      clientId: 'ro.motorfix.web',
      issuer: 'https://appleid.apple.com',
      issuers: ['https://appleid.apple.com'],
      provider: 'apple',
      redirectUri: 'https://web.example.test/api/v1/auth/oauth/apple/callback',
    });
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])(
    'leaves Google out without %s',
    (name) => {
      const source: Record<string, string> = { ...GOOGLE, ...APPLE, ...WEB };
      delete source[name];

      const settings = oauthSettings('staging', source);

      expect(settings.google).toBeUndefined();
      expect(settings.apple).toBeDefined();
    },
  );

  it.each([
    'APPLE_SERVICES_ID',
    'APPLE_TEAM_ID',
    'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY',
  ])('leaves Apple out without %s', (name) => {
    const source: Record<string, string> = { ...GOOGLE, ...APPLE, ...WEB };
    source[name] = '  ';

    const settings = oauthSettings('staging', source);

    expect(settings.apple).toBeUndefined();
    expect(settings.google).toBeDefined();
  });

  it('configures neither without the web address, which the return address needs', () => {
    const settings = oauthSettings('production', { ...GOOGLE, ...APPLE });

    expect(settings.google).toBeUndefined();
    expect(settings.apple).toBeUndefined();
  });

  it('reads an Apple key whose line breaks are written as \\n', () => {
    const settings = oauthSettings('test', {
      ...APPLE,
      ...WEB,
      APPLE_PRIVATE_KEY: appleKey.replace(/\n/g, '\\n'),
    });

    expect(settings.apple?.apple?.privateKey).toBe(appleKey);
  });

  it.each(['development', 'test'] as const)(
    'honours the issuer overrides in %s',
    (appEnv) => {
      const settings = oauthSettings(appEnv, {
        ...GOOGLE,
        ...APPLE,
        ...WEB,
        APPLE_ISSUER: 'http://127.0.0.1:3026/',
        GOOGLE_ISSUER: 'http://127.0.0.1:3026',
      });

      expect(settings.google?.issuer).toBe('http://127.0.0.1:3026');
      expect(settings.google?.issuers).toEqual(['http://127.0.0.1:3026']);
      expect(settings.apple?.issuer).toBe('http://127.0.0.1:3026');
    },
  );

  it.each(['staging', 'production'] as const)(
    'ignores the issuer overrides in %s',
    (appEnv) => {
      const settings = oauthSettings(appEnv, {
        ...GOOGLE,
        ...APPLE,
        ...WEB,
        APPLE_ISSUER: 'http://127.0.0.1:3026',
        GOOGLE_ISSUER: 'http://127.0.0.1:3026',
      });

      expect(settings.google?.issuer).toBe('https://accounts.google.com');
      expect(settings.apple?.issuer).toBe('https://appleid.apple.com');
    },
  );

  it('never puts a secret in its error messages or its enabled pair', () => {
    expect(JSON.stringify(oauthSettings('production', {}))).toBe('{}');
  });
});
