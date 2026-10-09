/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { withTelemetryMeta } from './telemetry-meta';

const collector = {
  environment: 'production',
  url: 'https://faro.example/collect/key',
  version: 'abc1234',
};
const html = (body: string, type = 'text/html; charset=utf-8') =>
  new Response(body, { headers: { 'content-type': type }, status: 200 });
const tags = (s: string) => s.match(/<meta name="mf-telemetry"/g) ?? [];

describe('withTelemetryMeta under hostile pages', () => {
  it('adds nothing to a page with no head to close', async () => {
    const res = await withTelemetryMeta(
      html('<html><body>x</body></html>'),
      collector,
    );

    expect(await res.text()).toBe('<html><body>x</body></html>');
  });

  it('adds nothing to an empty body', async () => {
    const res = await withTelemetryMeta(html(''), collector);

    expect(await res.text()).toBe('');
  });

  it('inserts exactly one tag when the closing head appears twice', async () => {
    const res = await withTelemetryMeta(
      html('<head></head><body><script>"</head>"</script></body>'),
      collector,
    );

    expect(tags(await res.text())).toHaveLength(1);
  });

  it('inserts one tag at the first closing head', async () => {
    const body = await (
      await withTelemetryMeta(html('<head>a</head><p></head></p>'), collector)
    ).text();

    expect(body.indexOf('mf-telemetry')).toBeLessThan(
      body.indexOf('</head><p>'),
    );
  });

  it('leaves JSON, text and a missing content type untouched', async () => {
    for (const type of ['application/json', 'text/plain']) {
      const res = await withTelemetryMeta(
        html('<head></head>', type),
        collector,
      );
      expect(await res.text()).toBe('<head></head>');
    }
    const bare = await withTelemetryMeta(
      new Response('<head></head>'),
      collector,
    );
    expect(tags(await bare.text())).toHaveLength(0);
  });

  it('returns a response with no body unchanged', async () => {
    const res = await withTelemetryMeta(
      new Response(null, {
        headers: { 'content-type': 'text/html' },
        status: 204,
      }),
      collector,
    );

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('cannot be broken out of the attribute by a hostile url or version', async () => {
    const res = await withTelemetryMeta(html('<head></head>'), {
      environment: '"><svg onload=1>',
      url: 'https://f.example/"><script>alert(1)</script>',
      version: '"><img src=x onerror=1>',
    });
    const out = await res.text();

    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<svg');
  });

  it('keeps multi-byte characters in a large page intact', async () => {
    const page = `<head></head><body>${'ăâîșț€😀'.repeat(200_000)}</body>`;
    const out = await (await withTelemetryMeta(html(page), collector)).text();

    expect(out.endsWith(`<body>${'ăâîșț€😀'.repeat(200_000)}</body>`)).toBe(
      true,
    );
    expect(tags(out)).toHaveLength(1);
  });

  it('applies twice without a second tag from the same input', async () => {
    const a = await (
      await withTelemetryMeta(html('<head></head>'), collector)
    ).text();
    const b = await (
      await withTelemetryMeta(html('<head></head>'), collector)
    ).text();

    expect(a).toBe(b);
  });

  it('keeps the head-end case-insensitive', async () => {
    const out = await (
      await withTelemetryMeta(html('<HEAD></HEAD>'), collector)
    ).text();

    expect(tags(out)).toHaveLength(1);
  });
});
