import { readEnv } from './env';

describe('readEnv under hostile input', () => {
  it.each([
    'Production',
    ' production',
    'production ',
    'PRODUCTION',
    '',
    'prod',
    'development,test',
    'constructor',
    '__proto__',
    'produção',
  ])('refuses APP_ENV %j', (value) => {
    expect(() => readEnv([], { APP_ENV: value })).toThrow(
      'APP_ENV must be one of development, test, staging, production',
    );
  });

  it('refuses an APP_ENV that is undefined', () => {
    expect(() => readEnv([], { APP_ENV: undefined })).toThrow('APP_ENV');
  });

  it.each([
    'development',
    'test',
    'staging',
    'production',
  ])('accepts APP_ENV %s', (value) => {
    expect(readEnv([], { APP_ENV: value }).APP_ENV).toBe(value);
  });

  it('does not echo a bad APP_ENV value in the error', () => {
    expect(() => readEnv([], { APP_ENV: 'hunter2-secret' })).not.toThrow(
      /hunter2/,
    );
  });

  it('defaults RELEASE_SHA to dev when it is empty or undefined', () => {
    expect(readEnv([], { APP_ENV: 'test', RELEASE_SHA: '' }).RELEASE_SHA).toBe(
      'dev',
    );
    expect(
      readEnv([], { APP_ENV: 'test', RELEASE_SHA: undefined }).RELEASE_SHA,
    ).toBe('dev');
  });

  it('keeps a RELEASE_SHA with unicode untouched', () => {
    expect(
      readEnv([], { APP_ENV: 'test', RELEASE_SHA: 'ß-✓' }).RELEASE_SHA,
    ).toBe('ß-✓');
  });

  it('does not copy variables that were not asked for', () => {
    const env = readEnv(['REDIS_URL'], {
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://user:secret@db',
      REDIS_URL: 'redis://r',
    });

    expect(Object.keys(env).sort()).toEqual(
      ['APP_ENV', 'RELEASE_SHA', 'REDIS_URL'].sort(),
    );
  });

  it('reports the first missing variable by name when several are missing', () => {
    expect(() => readEnv(['A_URL', 'B_URL'], { APP_ENV: 'test' })).toThrow(
      'A_URL',
    );
  });

  it('treats a name that exists on Object.prototype as missing', () => {
    expect(() => readEnv(['toString'], { APP_ENV: 'test' })).toThrow(
      'toString',
    );
    expect(() => readEnv(['constructor'], { APP_ENV: 'test' })).toThrow(
      'constructor',
    );
  });

  it('treats a variable that is undefined as missing', () => {
    expect(() =>
      readEnv(['REDIS_URL'], { APP_ENV: 'test', REDIS_URL: undefined }),
    ).toThrow('REDIS_URL');
  });

  it('returns a result that does not change when the source changes later', () => {
    const source: Record<string, string | undefined> = {
      APP_ENV: 'test',
      REDIS_URL: 'redis://a',
    };
    const env = readEnv(['REDIS_URL'], source);

    source['REDIS_URL'] = 'redis://b';

    expect(env.REDIS_URL).toBe('redis://a');
  });

  it('reads process.env when no source is given', () => {
    const saved = { ...process.env };
    process.env['APP_ENV'] = 'staging';
    process.env['ADVERSARY_URL'] = 'x://y';
    delete process.env['RELEASE_SHA'];
    try {
      expect(readEnv(['ADVERSARY_URL'])).toEqual({
        ADVERSARY_URL: 'x://y',
        APP_ENV: 'staging',
        RELEASE_SHA: 'dev',
      });
    } finally {
      process.env = saved;
    }
  });
});
