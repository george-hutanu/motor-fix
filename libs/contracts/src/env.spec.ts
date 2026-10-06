// @traces 539-FR-003
import { publicWebUrl, readEnv, STORAGE_ENV } from './env';

describe('readEnv', () => {
  it('returns the required variables and defaults the release to dev', () => {
    const env = readEnv(['DATABASE_URL'], {
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://db',
    });

    expect(env).toEqual({
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://db',
      RELEASE_SHA: 'dev',
    });
  });

  it('keeps a release SHA that is set', () => {
    expect(readEnv([], { APP_ENV: 'staging', RELEASE_SHA: 'abc123' })).toEqual({
      APP_ENV: 'staging',
      RELEASE_SHA: 'abc123',
    });
  });

  it('names a missing variable without printing any value', () => {
    const run = () =>
      readEnv(['DATABASE_URL', 'REDIS_URL'], {
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://user:secret@db',
      });

    expect(run).toThrow('REDIS_URL');
    expect(run).not.toThrow(/secret/);
  });

  it('treats an empty variable as missing', () => {
    expect(() =>
      readEnv(['REDIS_URL'], { APP_ENV: 'test', REDIS_URL: '' }),
    ).toThrow('REDIS_URL');
  });

  it('reads the five storage variables', () => {
    const values = {
      STORAGE_ACCESS_KEY_ID: 'key',
      STORAGE_BUCKET: 'motorfix',
      STORAGE_ENDPOINT: 'https://store.example',
      STORAGE_REGION: 'eu-central-1',
      STORAGE_SECRET_ACCESS_KEY: 'secret',
    };

    expect(readEnv(STORAGE_ENV, { APP_ENV: 'test', ...values })).toEqual({
      APP_ENV: 'test',
      RELEASE_SHA: 'dev',
      ...values,
    });
  });

  it.each([
    'STORAGE_ENDPOINT',
    'STORAGE_REGION',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
  ])('refuses to start without %s and prints no value', (missing) => {
    const source: Record<string, string> = {
      APP_ENV: 'test',
      STORAGE_ACCESS_KEY_ID: 'key-value',
      STORAGE_BUCKET: 'bucket-value',
      STORAGE_ENDPOINT: 'endpoint-value',
      STORAGE_REGION: 'region-value',
      STORAGE_SECRET_ACCESS_KEY: 'secret-value',
    };
    delete source[missing];

    const run = () => readEnv(STORAGE_ENV, source);

    expect(run).toThrow(`missing environment variable ${missing}`);
    expect(run).not.toThrow(/-value/);
  });

  it('requires APP_ENV to be one of the four environments', () => {
    expect(() => readEnv([], {})).toThrow('APP_ENV');
    expect(() => readEnv([], { APP_ENV: 'prod' })).toThrow(
      'APP_ENV must be one of development, test, staging, production',
    );
  });
});

describe('publicWebUrl', () => {
  it('parses an absolute URL', () => {
    expect(
      publicWebUrl({ PUBLIC_WEB_URL: 'https://motorfix.ro/' })?.origin,
    ).toBe('https://motorfix.ro');
  });

  it('returns nothing when unset or empty', () => {
    expect(publicWebUrl({})).toBeUndefined();
    expect(publicWebUrl({ PUBLIC_WEB_URL: '' })).toBeUndefined();
  });

  it('names the variable, never the value, when it is not a URL', () => {
    expect(() => publicWebUrl({ PUBLIC_WEB_URL: 'secret-host' })).toThrow(
      new Error('PUBLIC_WEB_URL must be an absolute URL'),
    );
  });
});
