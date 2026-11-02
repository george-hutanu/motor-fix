import { imageBaseUrl, models3dBaseUrl, photoConfig } from './env';

// @traces 1192-FR-011 1192-FR-008

const allOf = (value: string | undefined) => ({
  PHOTO_JOB_ATTEMPTS: value,
  PHOTO_JOB_KEEP_FAILED: value,
  PHOTO_MAX_INPUT_PIXELS: value,
  PHOTO_WORKER_CONCURRENCY: value,
});

describe('photoConfig, hostile values', () => {
  it.each([
    '1e3',
    '0x10',
    '+5',
    '007',
    '5 ',
    ' 5',
    '5\n',
    '٣',
    '３',
    'Infinity',
    'NaN',
    '',
    '-0',
    '5,000',
    '1_000',
  ])('falls back to the default for %p', (value) => {
    expect(photoConfig(allOf(value))).toEqual(photoConfig({}));
  });

  it('falls back for a number too large to count exactly', () => {
    expect(photoConfig(allOf('99999999999999999999'))).toEqual(photoConfig({}));
  });

  it('takes 1 as the smallest valid value', () => {
    expect(photoConfig(allOf('1'))).toEqual({
      attempts: 1,
      concurrency: 1,
      keepFailed: 1,
      maxInputPixels: 1,
    });
  });

  it('reads each variable on its own, leaving the others at their defaults', () => {
    expect(photoConfig({ PHOTO_JOB_ATTEMPTS: '9' })).toEqual({
      ...photoConfig({}),
      attempts: 9,
    });
    expect(
      photoConfig({ PHOTO_JOB_ATTEMPTS: 'x', PHOTO_WORKER_CONCURRENCY: '4' }),
    ).toEqual({ ...photoConfig({}), concurrency: 4 });
  });

  it('ignores unrelated and extra keys', () => {
    expect(photoConfig({ ATTEMPTS: '9', PHOTO_OTHER: '7' })).toEqual(
      photoConfig({}),
    );
  });

  it('defaults concurrency to a positive whole number', () => {
    const { concurrency } = photoConfig({});
    expect(Number.isInteger(concurrency) && concurrency >= 1).toBe(true);
  });
});

describe('imageBaseUrl, hostile values', () => {
  const refusal = new Error(
    'IMAGE_BASE_URL must be an http(s) URL or a path starting with /',
  );

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://',
    'https:///only-path',
    'http://',
    ' https://img.motorfix.ro',
    '\\\\img.motorfix.ro',
    '//',
    'images',
    './images',
    'https://exa mple.com',
    'file:///etc/passwd',
  ])('refuses %p', (value) => {
    expect(() => imageBaseUrl({ IMAGE_BASE_URL: value })).toThrow(refusal);
  });

  it('strips every trailing slash of a path', () => {
    expect(imageBaseUrl({ IMAGE_BASE_URL: '/images///' })).toBe('/images');
  });

  it('keeps a port and a path on an absolute address', () => {
    expect(
      imageBaseUrl({ IMAGE_BASE_URL: 'https://img.motorfix.ro:8443/v1/' }),
    ).toBe('https://img.motorfix.ro:8443/v1');
  });

  it('gives the same answer twice', () => {
    const source = { IMAGE_BASE_URL: 'https://img.motorfix.ro/' };
    expect(imageBaseUrl(source)).toBe(imageBaseUrl(source));
  });

  it('accepts an upper-case scheme, as URL schemes are case-insensitive', () => {
    expect(imageBaseUrl({ IMAGE_BASE_URL: 'HTTPS://img.motorfix.ro' })).toBe(
      'HTTPS://img.motorfix.ro',
    );
  });
});

// @traces 035-FR-006
describe('models3dBaseUrl', () => {
  it('defaults to the API file route', () => {
    expect(models3dBaseUrl({})).toBe('/api/v1/car-models-3d/files');
  });

  it.each([
    ['https://cdn.motorfix.ro/models-3d', 'https://cdn.motorfix.ro/models-3d'],
    ['https://cdn.motorfix.ro/models-3d/', 'https://cdn.motorfix.ro/models-3d'],
    ['http://localhost:9000/models-3d', 'http://localhost:9000/models-3d'],
    ['/files/3d', '/files/3d'],
    ['/files/3d/', '/files/3d'],
  ])('takes %j as %j', (value, base) => {
    expect(models3dBaseUrl({ MODELS_3D_BASE_URL: value })).toBe(base);
  });

  it.each([
    'cdn.motorfix.ro/models-3d',
    '//cdn.motorfix.ro/models-3d',
    'ftp://cdn.motorfix.ro',
    'javascript:alert(1)',
    'https://',
  ])('refuses %j', (value) => {
    expect(() => models3dBaseUrl({ MODELS_3D_BASE_URL: value })).toThrow(
      /MODELS_3D_BASE_URL/,
    );
  });
});
