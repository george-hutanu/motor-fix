/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { withSiteOrigin } from './site-origin';

const page = '<html><head><title>MotorFix</title></head><body></body></html>';

const html = (init: ResponseInit = {}) =>
  new Response(page, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
    status: 200,
    ...init,
  });

// @traces 385-FR-002
describe('withSiteOrigin', () => {
  it("names the site's origin in a tag before the head ends, on a page the browser renders too", async () => {
    const res = await withSiteOrigin(html(), 'https://motorfix.ro');

    expect(await res.text()).toBe(
      '<html><head><title>MotorFix</title>' +
        '<meta name="mf-site" content="https://motorfix.ro">' +
        '</head><body></body></html>',
    );
  });

  it('keeps the status and drops a length that no longer holds', async () => {
    const res = await withSiteOrigin(
      html({
        headers: { 'content-length': '10', 'content-type': 'text/html' },
        status: 410,
      }),
      'https://motorfix.ro',
    );

    expect(res.status).toBe(410);
    expect(res.headers.get('content-length')).toBeNull();
  });

  it('escapes the origin for an attribute', async () => {
    const res = await withSiteOrigin(html(), 'https://a.test/"><b>');

    expect(await res.text()).toContain(
      '<meta name="mf-site" content="https://a.test/&quot;&gt;&lt;b&gt;">',
    );
  });

  it('leaves a page alone with no origin, and anything that is not a page', async () => {
    const plain = html();
    const json = new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });

    expect(await withSiteOrigin(plain, undefined)).toBe(plain);
    expect(await withSiteOrigin(json, 'https://motorfix.ro')).toBe(json);
  });
});
