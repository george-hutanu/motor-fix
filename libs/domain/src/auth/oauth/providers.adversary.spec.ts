import { generateKeyPairSync } from 'node:crypto';

import type { AppEnv } from '@motor-fix/contracts';

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
const WEB = { PUBLIC_WEB_URL: 'https://web.example.test' };
const STAND_IN = 'http://127.0.0.1:3026';

describe('oauthSettings under hostile input', () => {
  it('configures nothing from an empty source', () => {
    expect(oauthSettings('production', {})).toEqual({});
  });

  it('ignores keys that are only inherited from a prototype', () => {
    const source = Object.create({ ...GOOGLE, ...APPLE, ...WEB });

    expect(oauthSettings('production', source)).toEqual({});
  });

  it('treats a whitespace-only web address as unset', () => {
    expect(
      oauthSettings('production', {
        ...GOOGLE,
        ...APPLE,
        PUBLIC_WEB_URL: ' \t',
      }),
    ).toEqual({});
  });

  it('treats an empty string key as unset', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      ...WEB,
      GOOGLE_CLIENT_SECRET: '',
    });

    expect(settings.google).toBeUndefined();
  });

  it('treats an undefined key as unset', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      ...WEB,
      GOOGLE_CLIENT_ID: undefined,
    });

    expect(settings.google).toBeUndefined();
  });

  it('strips every trailing slash of the web address from the return address', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      PUBLIC_WEB_URL: 'https://web.example.test///',
    });

    expect(settings.google?.redirectUri).toBe(
      'https://web.example.test/api/v1/auth/oauth/google/callback',
    );
  });

  it('trims a web address padded with whitespace', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      PUBLIC_WEB_URL: '  https://web.example.test/ ',
    });

    expect(settings.google?.redirectUri).toBe(
      'https://web.example.test/api/v1/auth/oauth/google/callback',
    );
  });

  it('keeps the same web address for both providers', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      ...APPLE,
      ...WEB,
    });

    expect(settings.apple?.redirectUri).toBe(
      'https://web.example.test/api/v1/auth/oauth/apple/callback',
    );
    expect(settings.google?.redirectUri).toBe(
      'https://web.example.test/api/v1/auth/oauth/google/callback',
    );
  });

  it('uses the real issuer in development when the override is blank', () => {
    const settings = oauthSettings('development', {
      ...GOOGLE,
      ...WEB,
      GOOGLE_ISSUER: '   ',
    });

    expect(settings.google?.issuer).toBe('https://accounts.google.com');
    expect(settings.google?.issuers).toEqual([
      'https://accounts.google.com',
      'accounts.google.com',
    ]);
  });

  it('strips repeated trailing slashes from an issuer override', () => {
    const settings = oauthSettings('test', {
      ...GOOGLE,
      ...WEB,
      GOOGLE_ISSUER: `${STAND_IN}///`,
    });

    expect(settings.google?.issuer).toBe(STAND_IN);
  });

  it('applies each provider override to its own provider only', () => {
    const settings = oauthSettings('test', {
      ...GOOGLE,
      ...APPLE,
      ...WEB,
      GOOGLE_ISSUER: STAND_IN,
    });

    expect(settings.google?.issuer).toBe(STAND_IN);
    expect(settings.apple?.issuer).toBe('https://appleid.apple.com');
  });

  it('does not let an override alone configure a provider', () => {
    const settings = oauthSettings('test', { ...WEB, GOOGLE_ISSUER: STAND_IN });

    expect(settings).toEqual({});
  });

  it.each(['preview', 'Production', 'TEST', '', 'prod'])(
    'ignores the overrides in the unknown environment "%s"',
    (appEnv) => {
      const settings = oauthSettings(appEnv as AppEnv, {
        ...GOOGLE,
        ...APPLE,
        ...WEB,
        APPLE_ISSUER: STAND_IN,
        GOOGLE_ISSUER: STAND_IN,
      });

      expect(settings.google?.issuer).toBe('https://accounts.google.com');
      expect(settings.apple?.issuer).toBe('https://appleid.apple.com');
    },
  );

  it('keeps the real issuers list in staging even with an override set', () => {
    const settings = oauthSettings('staging', {
      ...GOOGLE,
      ...WEB,
      GOOGLE_ISSUER: STAND_IN,
    });

    expect(settings.google?.issuers).toEqual([
      'https://accounts.google.com',
      'accounts.google.com',
    ]);
  });

  it('returns a fresh issuers list each time so a caller cannot poison the next one', () => {
    const first = oauthSettings('production', { ...GOOGLE, ...WEB });
    first.google?.issuers.push('https://evil.test');

    const second = oauthSettings('production', { ...GOOGLE, ...WEB });

    expect(second.google?.issuers).toEqual([
      'https://accounts.google.com',
      'accounts.google.com',
    ]);
  });

  it('turns every \\n escape of the Apple key into a line break', () => {
    const settings = oauthSettings('production', {
      ...APPLE,
      ...WEB,
      APPLE_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nAAA\\nBBB\\n-----END PRIVATE KEY-----\\n',
    });

    expect(settings.apple?.apple?.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nAAA\nBBB\n-----END PRIVATE KEY-----\n',
    );
  });

  it('leaves a key that already holds real line breaks unchanged', () => {
    const settings = oauthSettings('production', { ...APPLE, ...WEB });

    expect(settings.apple?.apple?.privateKey).toBe(appleKey);
  });

  it('never carries a key value in a field the web could read', () => {
    const settings = oauthSettings('production', {
      ...GOOGLE,
      ...APPLE,
      ...WEB,
    });

    const { clientSecret: _s, ...google } = settings.google ?? {};
    const { apple: _a, ...apple } = settings.apple ?? {};
    const exposed = JSON.stringify([google, apple]);

    expect(exposed).not.toContain('g-secret');
    expect(exposed).not.toContain('BEGIN PRIVATE KEY');
  });

  it('does not mutate its source', () => {
    const source = { ...GOOGLE, ...WEB, APPLE_PRIVATE_KEY: 'a\\nb' };
    const copy = { ...source };

    oauthSettings('test', source);

    expect(source).toEqual(copy);
  });

  it('answers the same twice for the same source', () => {
    const source = { ...GOOGLE, ...APPLE, ...WEB };

    expect(oauthSettings('production', source)).toEqual(
      oauthSettings('production', source),
    );
  });

  it('handles non-ASCII client ids without altering them', () => {
    const settings = oauthSettings('production', {
      ...WEB,
      GOOGLE_CLIENT_ID: 'clíent-ăîșț-😀',
      GOOGLE_CLIENT_SECRET: 's',
    });

    expect(settings.google?.clientId).toBe('clíent-ăîșț-😀');
  });
});
