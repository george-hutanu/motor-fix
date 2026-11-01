import { generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { liveVideoConfig } from './live-video.module';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const base = {
  CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct',
  CLOUDFLARE_STREAM_API_TOKEN: 'secret-api-token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'kid-1',
};
const withKey = (key: string) => ({
  ...base,
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: key,
});

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

// @traces 1250-FR-001
describe('which live video provider is chosen for odd signing keys', () => {
  it('has none when the key is an RSA public key', () => {
    const pub = rsa.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();

    expect(liveVideoConfig('production', withKey(pub))).toEqual({
      provider: 'none',
    });
  });

  it('has none when the key is an elliptic-curve key, which cannot sign RS256', () => {
    const key = ec.privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString();

    expect(liveVideoConfig('production', withKey(key))).toEqual({
      provider: 'none',
    });
  });

  it('has none when the key is an empty PEM frame', () => {
    expect(
      liveVideoConfig(
        'production',
        withKey('-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----'),
      ),
    ).toEqual({ provider: 'none' });
  });

  it('has none when the key is base64 of random bytes', () => {
    expect(
      liveVideoConfig(
        'production',
        withKey(Buffer.alloc(300, 7).toString('base64')),
      ),
    ).toEqual({ provider: 'none' });
  });

  it('reads a PKCS#1 RSA private key', () => {
    const key = rsa.privateKey
      .export({ format: 'pem', type: 'pkcs1' })
      .toString();

    expect(liveVideoConfig('production', withKey(key)).provider).toBe(
      'cloudflare',
    );
  });

  it('reads a key whose line breaks are Windows line breaks', () => {
    expect(
      liveVideoConfig('production', withKey(pem.replace(/\n/g, '\r\n')))
        .provider,
    ).toBe('cloudflare');
  });

  it('reads a key whose line breaks were pasted as the two characters backslash and n', () => {
    expect(
      liveVideoConfig('production', withKey(pem.trim().replace(/\n/g, '\\n')))
        .provider,
    ).toBe('cloudflare');
  });

  it('reads a base64 key wrapped over several lines', () => {
    const wrapped = (
      Buffer.from(pem)
        .toString('base64')
        .match(/.{1,64}/g) ?? []
    ).join('\n');

    expect(liveVideoConfig('production', withKey(wrapped)).provider).toBe(
      'cloudflare',
    );
  });

  it('logs the unreadable-key warning without any part of the key or token', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    liveVideoConfig('production', withKey('QUJDREVGR0hJSktMTU5PUA=='));

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('QUJDREVGR0hJSktMTU5PUA');
    expect(logged).not.toContain('secret-api-token');
  });

  it('falls back to the stand-in in tests when the key cannot be read', () => {
    expect(liveVideoConfig('test', withKey('nope'))).toEqual({
      provider: 'fake',
    });
  });
});
