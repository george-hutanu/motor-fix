/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { withTelemetryMeta } from './telemetry-meta';

const page = '<html><head><title>MotorFix</title></head><body></body></html>';
const collector = {
  environment: 'staging',
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
  // @traces 879-FR-002
  it('puts the collector, the release and the environment in one tag just before the head ends', async () => {
    const res = await withTelemetryMeta(html(), collector);

    expect(await res.text()).toBe(
      '<html><head><title>MotorFix</title>' +
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234" data-environment="staging">' +
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
      environment: 'a&b',
      url: 'https://faro.example/collect/key?a=1&b="2"',
      version: '<dev>',
    });

    const body = await res.text();
    expect(body).toContain(
      'content="https://faro.example/collect/key?a=1&amp;b=&quot;2&quot;"',
    );
    expect(body).toContain('data-version="&lt;dev&gt;"');
    expect(body).toContain('data-environment="a&amp;b"');
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

  it('streams the page: the head with its tag goes out before the body ends', async () => {
    const encoder = new TextEncoder();
    let finish: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('<html><HEAD><title>M</title></he'));
        controller.enqueue(encoder.encode('ad><body>first'));
        finish = () => {
          controller.enqueue(encoder.encode(' last</body></html>'));
          controller.close();
        };
      },
    });

    const res = await withTelemetryMeta(html(body as never), collector);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let early = '';
    while (!early.includes('first')) {
      const { value } = await reader.read();
      early += decoder.decode(value, { stream: true });
    }

    expect(early).toBe(
      '<html><HEAD><title>M</title>' +
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234" data-environment="staging">' +
        '</head><body>first',
    );
    finish();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
    }
    expect(rest).toBe(' last</body></html>');
  });

  it('passes a page with no head end through whole', async () => {
    const res = await withTelemetryMeta(html('<p>no head</p>'), collector);

    expect(await res.text()).toBe('<p>no head</p>');
  });

  it('keeps a character split across chunks whole', async () => {
    const bytes = new TextEncoder().encode(
      '<html><head><title>Mașină 🚗 ok</title></head><body></body></html>',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });

    const res = await withTelemetryMeta(html(body as never), collector);

    expect(await res.text()).toBe(
      '<html><head><title>Mașină 🚗 ok</title>' +
        '<meta name="mf-telemetry" content="https://faro.example/collect/key" data-version="abc1234" data-environment="staging">' +
        '</head><body></body></html>',
    );
  });
});
