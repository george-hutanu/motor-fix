import { LIVE_VIDEO_ENV, liveVideoSecrets } from './env';

const full = {
  CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct',
  CLOUDFLARE_STREAM_API_TOKEN: 'token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'kid-1',
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM:
    '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----',
};

// @traces 1250-FR-001
describe('reading the live video secrets', () => {
  it('returns nothing from an empty environment', () => {
    expect(liveVideoSecrets({})).toBeUndefined();
  });

  it.each(LIVE_VIDEO_ENV)('returns nothing when %s is missing', (name) => {
    const { [name]: _gone, ...rest } = full;

    expect(liveVideoSecrets(rest)).toBeUndefined();
  });

  it.each(LIVE_VIDEO_ENV)(
    'returns nothing when %s is only whitespace',
    (name) => {
      expect(liveVideoSecrets({ ...full, [name]: ' \t\r\n ' })).toBeUndefined();
    },
  );

  it.each(LIVE_VIDEO_ENV)(
    'returns nothing when %s is an empty string',
    (name) => {
      expect(liveVideoSecrets({ ...full, [name]: '' })).toBeUndefined();
    },
  );

  it('returns nothing when a value is explicitly undefined', () => {
    expect(
      liveVideoSecrets({ ...full, CLOUDFLARE_STREAM_API_TOKEN: undefined }),
    ).toBeUndefined();
  });

  it('trims the ends of every value and keeps the key’s inner line breaks', () => {
    const padded = Object.fromEntries(
      Object.entries(full).map(([k, v]) => [k, `\n  ${v}\t `]),
    );

    expect(liveVideoSecrets(padded)).toEqual(full);
  });

  it('returns only the five names, never the rest of the environment', () => {
    const secrets = liveVideoSecrets({ ...full, DATABASE_URL: 'postgres://x' });

    expect(Object.keys(secrets ?? {}).sort()).toEqual(
      [...LIVE_VIDEO_ENV].sort(),
    );
  });

  it('does not read process.env when a source is given', () => {
    process.env['CLOUDFLARE_STREAM_ACCOUNT_ID'] = 'from-process';
    try {
      expect(liveVideoSecrets({})).toBeUndefined();
    } finally {
      delete process.env['CLOUDFLARE_STREAM_ACCOUNT_ID'];
    }
  });

  it('keeps unicode values whole', () => {
    expect(
      liveVideoSecrets({ ...full, CLOUDFLARE_STREAM_ACCOUNT_ID: 'cont-ăîșț' })
        ?.CLOUDFLARE_STREAM_ACCOUNT_ID,
    ).toBe('cont-ăîșț');
  });
});
