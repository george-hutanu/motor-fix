import { faroUrl } from './env';

describe('faroUrl under hostile values', () => {
  it.each([
    ' ',
    'javascript:alert(1)',
    'data:text/plain,x',
    'file:///etc/passwd',
    '//faro.example/collect/secret-key',
    'https://',
    'https:/secret-key',
    'wss://faro.example/secret-key',
  ])('rejects %j without echoing it', (value) => {
    const run = () => faroUrl({ FARO_URL: value });

    expect(run).toThrow(new Error('FARO_URL must be an absolute http(s) URL'));
    expect(run).not.toThrow(/secret-key|alert|passwd/);
  });

  it('returns the normalised href for an uppercase scheme and host', () => {
    expect(faroUrl({ FARO_URL: 'HTTPS://FARO.EXAMPLE/collect/Key' })).toBe(
      'https://faro.example/collect/Key',
    );
  });

  it('keeps a query string on the collector URL', () => {
    expect(faroUrl({ FARO_URL: 'https://faro.example/c?k=1' })).toBe(
      'https://faro.example/c?k=1',
    );
  });

  it('gives the same answer when called twice', () => {
    const env = { FARO_URL: 'https://faro.example/collect/key' };

    expect(faroUrl(env)).toBe(faroUrl(env));
  });

  it('treats a non-string value as not a URL', () => {
    expect(() => faroUrl({ FARO_URL: 42 } as never)).toThrow(
      new Error('FARO_URL must be an absolute http(s) URL'),
    );
  });
});
