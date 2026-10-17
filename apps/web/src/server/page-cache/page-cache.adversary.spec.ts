/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
// @traces 430-FR-002 430-FR-003 430-FR-005
import { PAGE_CACHE_CONTROL, withPageCache } from './page-cache';

const page = (
  headers: Record<string, string> = {},
  status = 200,
  body: string | null = '<html></html>',
) =>
  new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    status,
  });

describe('withPageCache under hostile input', () => {
  it.each(['/app?x=1', '/app/?x=/ro', '/app/driver/'])(
    'leaves %s as a private page',
    (path) => {
      const original = page();

      expect(withPageCache(path, original)).toBe(original);
      expect(original.headers.get('cache-control')).toBeNull();
      expect(original.headers.get('cdn-tag')).toBeNull();
    },
  );

  it.each(['/ro?x=1', '/ro/garages/x?utm=/app/', '/', '/ro/app/x'])(
    'caches %s',
    (path) => {
      expect(withPageCache(path, page()).headers.get('cache-control')).toBe(
        PAGE_CACHE_CONTROL,
      );
    },
  );

  it.each(['/ro/account/security', '/en/account/', '/ro/reset-password/'])(
    'leaves a page below a one-person page (%s) as it was',
    (path) => {
      const original = page();

      expect(withPageCache(path, original)).toBe(original);
      expect(original.headers.get('cache-control')).toBeNull();
    },
  );

  it('recognises an upper-case html content type', () => {
    const answer = withPageCache(
      '/ro',
      page({ 'content-type': 'TEXT/HTML; Charset=UTF-8' }),
    );

    expect(answer.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
  });

  it('leaves an answer with no content type as it was', () => {
    const original = new Response('x');
    original.headers.delete('content-type');

    expect(withPageCache('/ro', original)).toBe(original);
    expect(original.headers.get('cache-control')).toBeNull();
  });

  it.each(['text/htmlx', 'application/xhtml+xml', 'image/svg+xml'])(
    'does not take %s for html',
    (type) => {
      const answer = withPageCache('/ro', page({ 'content-type': type }));

      expect(answer.headers.get('cache-control')).toBeNull();
    },
  );

  it('gives a page with an empty tag the search tag', () => {
    expect(
      withPageCache('/ro', page({ 'CDN-Tag': '' })).headers.get('cdn-tag'),
    ).toBe('search');
  });

  it('keeps status, body and every other header', async () => {
    const answer = withPageCache(
      '/ro/x',
      page({ vary: 'accept-language', 'x-trace': 'abc' }, 404, 'gone'),
    );

    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('gone');
    expect(answer.headers.get('x-trace')).toBe('abc');
    expect(answer.headers.get('vary')).toBe('accept-language');
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  // A server error (the maintenance page among them) never reaches the edge's
  // cache: the next request must reach the origin again.
  it.each([500, 503])('leaves a %s page uncached', (status) => {
    expect(
      withPageCache('/ro', page({}, status)).headers.get('cache-control'),
    ).toBeNull();
  });

  it('does not let a page with a Set-Cookie of any case through', () => {
    const original = page();
    original.headers.append('Set-Cookie', 'a=b');
    original.headers.append('set-cookie', 'c=d');

    expect(withPageCache('/ro', original)).toBe(original);
    expect(original.headers.get('cache-control')).toBeNull();
  });

  it('gives the same answer twice for the same page', () => {
    const first = withPageCache('/ro', page());
    const second = withPageCache('/ro', first);

    expect(second.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
    expect(second.headers.get('cdn-tag')).toBe('search');
  });

  it('handles an empty body', async () => {
    const answer = withPageCache('/ro', page({}, 200, null));

    expect(await answer.text()).toBe('');
    expect(answer.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
  });
});
