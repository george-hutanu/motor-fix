// The edge keeps a public page a minute and purges it by its tag; the
// browser revalidates every time, so a purge reaches it at once.
export const PAGE_CACHE_CONTROL =
  'public, max-age=0, s-maxage=60, must-revalidate';

// Dashboards and the pages a link sent to one person opens: never shared.
const PRIVATE_PAGE =
  /^\/(app(\/|$|\?)|[a-z]{2}\/(reset-password|confirm-email|unsubscribe|invite)\/|[a-z]{2}\/sign-in\/return|[a-z]{2}\/account(\/|$|\?))/;

// A rendered public page with the edge's lifetime and its purge tag: the one
// it set itself (a garage profile), else `search`. A dashboard, a page for
// one person, an answer setting a cookie, a server error (the maintenance
// page among them) or one that is not HTML is returned as it came.
export function withPageCache(path: string, response: Response): Response {
  if (
    PRIVATE_PAGE.test(path) ||
    response.headers.has('set-cookie') ||
    response.status >= 500 ||
    !isHtml(response.headers.get('content-type'))
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', PAGE_CACHE_CONTROL);
  if (!headers.get('CDN-Tag')?.trim()) headers.set('CDN-Tag', 'search');
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

// `text/html`, in any case, with or without parameters.
function isHtml(type: string | null) {
  return type?.split(';')[0]?.trim().toLowerCase() === 'text/html';
}
