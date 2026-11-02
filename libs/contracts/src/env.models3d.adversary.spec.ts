import { models3dBaseUrl } from './env';

// @traces 035-FR-006

describe('models3dBaseUrl, hostile values', () => {
  it.each([
    'HTTP://',
    'http:///models',
    'https://cdn.motorfix.ro/models 3d',
    'https://cdn.motorfix.ro/\nmodels',
    'data:text/html,x',
    'file:///etc/passwd',
    'ws://cdn.motorfix.ro',
    '/\\evil.example',
    '/models\n',
    ' /models',
    ' https://cdn.motorfix.ro',
    'models-3d',
    '\\\\evil.example',
  ])('refuses %j', (value) => {
    expect(() => models3dBaseUrl({ MODELS_3D_BASE_URL: value })).toThrow(
      /MODELS_3D_BASE_URL/,
    );
  });

  it('strips one trailing slash and no more', () => {
    expect(
      models3dBaseUrl({ MODELS_3D_BASE_URL: 'https://cdn.motorfix.ro/a//' }),
    ).toBe('https://cdn.motorfix.ro/a/');
  });

  it('keeps a port and a nested path', () => {
    expect(
      models3dBaseUrl({ MODELS_3D_BASE_URL: 'http://localhost:9000/a/b/c' }),
    ).toBe('http://localhost:9000/a/b/c');
  });

  it('takes the default for an unset value and ignores the image base', () => {
    expect(models3dBaseUrl({ IMAGE_BASE_URL: 'https://img.example/x' })).toBe(
      '/api/v1/car-models-3d/files',
    );
  });

  it('gives the same answer twice', () => {
    const source = { MODELS_3D_BASE_URL: 'https://cdn.motorfix.ro/m/' };
    expect(models3dBaseUrl(source)).toBe(models3dBaseUrl(source));
  });
});
