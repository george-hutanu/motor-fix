/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
// @traces 430-FR-002 430-FR-003 430-FR-005
import { PAGE_CACHE_CONTROL, withPageCache } from './page-cache';

const page = (headers: Record<string, string> = {}, status = 200) =>
  new Response('<html><body>page</body></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    status,
  });

describe('withPageCache', () => {
  it('lets the edge keep a public page for a minute and the browser not at all', async () => {
    const answer = withPageCache('/ro', page());

    expect(PAGE_CACHE_CONTROL).toBe(
      'public, max-age=0, s-maxage=60, must-revalidate',
    );
    expect(answer.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe('<html><body>page</body></html>');
  });

  it('tags a page with no tag of its own as a search page', () => {
    expect(withPageCache('/en', page()).headers.get('cdn-tag')).toBe('search');
  });

  it('keeps the tag a page set itself', () => {
    const answer = withPageCache(
      '/ro/garages/service-titan',
      page({ 'CDN-Tag': 'garage:g-1' }),
    );

    expect(answer.headers.get('cdn-tag')).toBe('garage:g-1');
  });

  it('caches a not-found page under the search tag, keeping its status', () => {
    const answer = withPageCache('/ro/garages/nobody', page({}, 404));

    expect(answer.status).toBe(404);
    expect(answer.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
    expect(answer.headers.get('cdn-tag')).toBe('search');
  });

  it.each([500, 503])(
    'leaves a %s, such as the maintenance page, for the origin to answer again',
    (status) => {
      const original = page({}, status);

      expect(withPageCache('/ro', original)).toBe(original);
      expect(original.headers.get('cache-control')).toBeNull();
    },
  );

  it.each(['/app', '/app/', '/app/driver', '/app/garage/quotes?x=1'])(
    'leaves a dashboard page (%s) as it was',
    (path) => {
      const original = page();
      const answer = withPageCache(path, original);

      expect(answer).toBe(original);
      expect(answer.headers.get('cache-control')).toBeNull();
      expect(answer.headers.get('cdn-tag')).toBeNull();
    },
  );

  it.each([
    '/ro/reset-password/t-1',
    '/en/confirm-email/t-1',
    '/ro/unsubscribe/t-1',
    '/ro/invite/t-1',
    '/ro/sign-in/return?code=x',
    '/ro/account',
  ])('leaves a page for one person (%s) as it was', (path) => {
    const original = page();

    expect(withPageCache(path, original)).toBe(original);
    expect(original.headers.get('cache-control')).toBeNull();
  });

  it('does not take an address that only starts like the dashboards for one', () => {
    expect(
      withPageCache('/application', page()).headers.get('cache-control'),
    ).toBe(PAGE_CACHE_CONTROL);
  });

  it('leaves an answer that sets a cookie as it was', () => {
    const original = page({ 'set-cookie': 'mf_refresh=x; HttpOnly' });

    expect(withPageCache('/ro', original)).toBe(original);
    expect(original.headers.get('cache-control')).toBeNull();
  });

  it('leaves an answer that is not a page as it was', () => {
    const original = new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });

    expect(withPageCache('/ro', original)).toBe(original);
    expect(original.headers.get('cache-control')).toBeNull();
  });
});
