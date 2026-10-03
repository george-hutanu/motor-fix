import { readEnv } from './env';

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

  it('requires APP_ENV to be one of the four environments', () => {
    expect(() => readEnv([], {})).toThrow('APP_ENV');
    expect(() => readEnv([], { APP_ENV: 'prod' })).toThrow(
      'APP_ENV must be one of development, test, staging, production',
    );
  });
});
