// @traces 430-FR-007 430-FR-004
import { bunnyConfig, originSecrets } from './env';

describe('originSecrets under hostile input', () => {
  it.each([
    [undefined, []],
    ['', []],
    ['   ', []],
    [',', []],
    [' , ,, ', []],
    ['a', ['a']],
    ['a,b', ['a', 'b']],
    [' a , b ', ['a', 'b']],
    ['a,,b,', ['a', 'b']],
    ['a\n,b\t', ['a', 'b']],
    ['sécret,密码', ['sécret', '密码']],
    ['a b,c', ['a b', 'c']],
  ])('reads %j as %j', (value, expected) => {
    expect(originSecrets({ ORIGIN_SECRET: value })).toEqual(expected);
  });

  it('reads null as no secret', () => {
    expect(
      originSecrets({ ORIGIN_SECRET: null as unknown as undefined }),
    ).toEqual([]);
  });

  it('ignores a differently-cased variable name', () => {
    expect(originSecrets({ origin_secret: 'a' })).toEqual([]);
  });

  it('reads a very long list in order', () => {
    const values = Array.from({ length: 10_000 }, (_, i) => `v${i}`);

    expect(originSecrets({ ORIGIN_SECRET: values.join(',') })).toEqual(values);
  });

  it('reads the same answer twice and leaves the source alone', () => {
    const source = { ORIGIN_SECRET: ' a,b ' };

    expect(originSecrets(source)).toEqual(originSecrets(source));
    expect(source).toEqual({ ORIGIN_SECRET: ' a,b ' });
  });

  it('reads the process environment by default', () => {
    const before = process.env['ORIGIN_SECRET'];
    process.env['ORIGIN_SECRET'] = 'x,y';
    try {
      expect(originSecrets()).toEqual(['x', 'y']);
    } finally {
      if (before === undefined) delete process.env['ORIGIN_SECRET'];
      else process.env['ORIGIN_SECRET'] = before;
    }
  });
});

describe('bunnyConfig under hostile input', () => {
  it('returns both values when both are set', () => {
    expect(
      bunnyConfig({ BUNNY_API_KEY: 'k', BUNNY_PULL_ZONE_ID: '42' }),
    ).toEqual({ apiKey: 'k', pullZoneId: '42' });
  });

  it.each([
    [{}],
    [{ BUNNY_API_KEY: 'k' }],
    [{ BUNNY_PULL_ZONE_ID: '42' }],
    [{ BUNNY_API_KEY: '', BUNNY_PULL_ZONE_ID: '42' }],
    [{ BUNNY_API_KEY: 'k', BUNNY_PULL_ZONE_ID: '' }],
    [{ BUNNY_API_KEY: '  ', BUNNY_PULL_ZONE_ID: '42' }],
    [{ BUNNY_API_KEY: 'k', BUNNY_PULL_ZONE_ID: '\n' }],
  ])('returns nothing for %j', (source) => {
    expect(bunnyConfig(source)).toBeUndefined();
  });

  it('trims both values', () => {
    expect(
      bunnyConfig({ BUNNY_API_KEY: ' k\n', BUNNY_PULL_ZONE_ID: ' 42 ' }),
    ).toEqual({ apiKey: 'k', pullZoneId: '42' });
  });

  it('returns nothing for null values', () => {
    expect(
      bunnyConfig({
        BUNNY_API_KEY: null as unknown as undefined,
        BUNNY_PULL_ZONE_ID: null as unknown as undefined,
      }),
    ).toBeUndefined();
  });

  it('returns only the two named fields', () => {
    expect(
      Object.keys(
        bunnyConfig({
          BUNNY_API_KEY: 'k',
          BUNNY_PULL_ZONE_ID: '1',
          ORIGIN_SECRET: 'leak',
        }) ?? {},
      ).sort(),
    ).toEqual(['apiKey', 'pullZoneId']);
  });

  it('refuses a pull zone that is not a number', () => {
    expect(
      bunnyConfig({ BUNNY_API_KEY: 'k', BUNNY_PULL_ZONE_ID: '42/../../x' }),
    ).toBeUndefined();
  });
});
