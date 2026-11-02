import { generateKeyPairSync } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { LiveVideoModule, liveVideoConfig } from './live-video.module';
import {
  LIVE_VIDEO_PROVIDER,
  type LiveVideoProvider,
} from './providers/live-video.provider';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const secrets = {
  CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct',
  CLOUDFLARE_STREAM_API_TOKEN: 'secret-api-token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'kid-1',
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: Buffer.from(pem).toString('base64'),
};

// @traces 1250-FR-001 1250-FR-012
describe('which live video provider the api uses', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses Cloudflare whenever all five values are set', () => {
    expect(liveVideoConfig('production', secrets)).toEqual({
      provider: 'cloudflare',
      secrets,
    });
    expect(liveVideoConfig('test', secrets)).toEqual({
      provider: 'cloudflare',
      secrets,
    });
  });

  it('takes the signing key as a raw PEM too', () => {
    const raw = { ...secrets, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pem };

    expect(liveVideoConfig('production', raw).provider).toBe('cloudflare');
  });

  it('uses the stand-in in tests when a value is missing', () => {
    expect(liveVideoConfig('test', {})).toEqual({ provider: 'fake' });
  });

  it.each(['development', 'staging', 'production'] as const)(
    'has none in %s with a value missing',
    (appEnv) => {
      expect(
        liveVideoConfig(appEnv, {
          ...secrets,
          CLOUDFLARE_STREAM_CUSTOMER_CODE: ' ',
        }),
      ).toEqual({ provider: 'none' });
    },
  );

  it('has none when the signing key cannot be read, and never logs it', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const broken = {
      ...secrets,
      CLOUDFLARE_STREAM_SIGNING_KEY_PEM: 'bm90IGEga2V5',
    };

    expect(liveVideoConfig('production', broken)).toEqual({
      provider: 'none',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('bm90IGEga2V5');
  });
});

describe('the live video module', () => {
  afterEach(() => vi.restoreAllMocks());

  const providerOf = (
    config: Parameters<typeof LiveVideoModule.register>[0],
  ) => {
    const found = LiveVideoModule.register(config).providers?.find(
      (p) =>
        typeof p === 'object' &&
        'provide' in p &&
        p.provide === LIVE_VIDEO_PROVIDER,
    ) as { useValue: LiveVideoProvider };
    return found.useValue;
  };

  it('answers unavailable with no provider configured, and says so once at boot', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const provider = providerOf({ provider: 'none' });

    expect(provider.name).toBe('none');
    expect(await provider.createInput({ id: 'session' })).toEqual({
      unavailable: 'not_configured',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('CLOUDFLARE_STREAM');
  });

  it('names the provider it chose without its secrets', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    expect(providerOf({ provider: 'cloudflare', secrets }).name).toBe(
      'cloudflare',
    );
    expect(providerOf({ provider: 'fake' }).name).toBe('fake');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('secret-api-token');
    expect(logged).not.toContain(secrets.CLOUDFLARE_STREAM_SIGNING_KEY_PEM);
  });
});
