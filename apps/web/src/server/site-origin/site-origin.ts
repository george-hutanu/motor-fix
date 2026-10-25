import { attribute, injectTag } from '../telemetry-meta/telemetry-meta';

// Names the site's origin in a tag before `</head>` of every page, the ones the
// browser renders alone included, so an address the page gives away (a shared
// link) is the site's own and never the host the request came through.
export async function withSiteOrigin(
  response: Response,
  origin: string | undefined,
): Promise<Response> {
  const html = response.headers.get('content-type')?.startsWith('text/html');
  if (!origin || !html || !response.body) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(
    response.body.pipeThrough(
      injectTag(`<meta name="mf-site" content="${attribute(origin)}">`),
    ),
    { headers, status: response.status, statusText: response.statusText },
  );
}
