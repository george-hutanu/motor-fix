const ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};
const attribute = (value: string) =>
  value.replace(/["&<>]/g, (char) => ESCAPES[char] ?? char);

// Tells the browser where to send its telemetry, and for which release, in
// one tag before `</head>` of a rendered page. With no collector set the page
// carries no tag and the browser loads no telemetry at all.
export async function withTelemetryMeta(
  response: Response,
  collector: { url: string; version: string } | undefined,
): Promise<Response> {
  const html = response.headers.get('content-type')?.startsWith('text/html');
  if (!collector || !html || !response.body) return response;
  const tag = `<meta name="mf-telemetry" content="${attribute(collector.url)}" data-version="${attribute(collector.version)}">`;
  const page = (await response.text()).replace(
    /<\/head>/i,
    (end) => `${tag}${end}`,
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(page, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
