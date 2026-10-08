/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { withTelemetryMeta } from './telemetry-meta';

const page = '<html><head><title>MotorFix</title></head><body></body></html>';
const collector = {
  url: 'https://faro.example/collect/key',
  version: 'abc1234',
};

const html = (body = page, init: ResponseInit = {}) =>
  new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status: 200,
    ...init,
  });

describe('withTelemetryMeta', () => {
  it('puts the collector and the release in one tag just before the head ends', async () => {
    const res = await withTelemetryMeta(html(), collector);

    expect(await res.text()).toBe(
      '<html><head><title>MotorFix</title>' +
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234">' +
        '</head><body></body></html>',
    );
  });

  it('keeps the status and headers, dropping a length that no longer holds', async () => {
    const res = await withTelemetryMeta(
      html(page, {
        headers: {
          'cache-control': 'no-cache',
          'content-length': String(page.length),
          'content-type': 'text/html',
        },
        status: 404,
      }),
      collector,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('escapes the values for an attribute', async () => {
    const res = await withTelemetryMeta(html(), {
      url: 'https://faro.example/collect/key?a=1&b="2"',
      version: '<dev>',
    });

    const body = await res.text();
    expect(body).toContain(
      'content="https://faro.example/collect/key?a=1&amp;b=&quot;2&quot;"',
    );
    expect(body).toContain('data-version="&lt;dev&gt;"');
  });

  it('leaves the page untouched when no collector is set', async () => {
    const original = html();

    const res = await withTelemetryMeta(original, undefined);

    expect(res).toBe(original);
    expect(await res.text()).toBe(page);
  });

  it('leaves anything that is not HTML untouched', async () => {
    const json = new Response('{"head":"</head>"}', {
      headers: { 'content-type': 'application/json' },
    });

    const res = await withTelemetryMeta(json, collector);

    expect(res).toBe(json);
  });
});
