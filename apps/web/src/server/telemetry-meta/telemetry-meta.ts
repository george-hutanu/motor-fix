const ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};
const attribute = (value: string) =>
  value.replace(/["&<>]/g, (char) => ESCAPES[char] ?? char);

const HEAD_END = /<\/head>/i;
// Long enough to hold a `</head>` split across two chunks.
const KEEP = '</head>'.length - 1;

// Adds `tag` before the first `</head>` as the page streams through: only
// what precedes the head's end is held, and everything after it passes on
// chunk by chunk, each character whole.
export function injectTag(
  tag: string,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let held = '';
  let done = false;
  // What can leave while the head's end is still to come: all but the last
  // few characters, never cut between the two halves of one like an emoji.
  const release = () => {
    if (held.length <= KEEP) return '';
    let cut = held.length - KEEP;
    const code = held.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    const out = held.slice(0, cut);
    held = held.slice(cut);
    return out;
  };
  const pass = (text: string) => {
    if (done) return text;
    held += text;
    const at = held.search(HEAD_END);
    if (at < 0) return release();
    done = true;
    const out = `${held.slice(0, at)}${tag}${held.slice(at)}`;
    held = '';
    return out;
  };
  return new TransformStream({
    flush(controller) {
      const rest = held + decoder.decode();
      if (rest) controller.enqueue(encoder.encode(rest));
    },
    // A character split across two chunks is only whole once decoded.
    transform(chunk, controller) {
      const out = pass(decoder.decode(chunk, { stream: true }));
      if (out) controller.enqueue(encoder.encode(out));
    },
  });
}

// Tells the browser where to send its telemetry, for which release and
// environment, and which domain its analytics count for, in tags before
// `</head>` of a rendered page. With neither set the page carries no tag: the
// browser loads no telemetry, and analytics stay off whatever the visitor
// chose.
export async function withTelemetryMeta(
  response: Response,
  collector: { environment: string; url: string; version: string } | undefined,
  analytics?: string,
): Promise<Response> {
  const html = response.headers.get('content-type')?.startsWith('text/html');
  if ((!collector && !analytics) || !html || !response.body) return response;
  const tag =
    (collector
      ? `<meta name="mf-telemetry" content="${attribute(collector.url)}" data-version="${attribute(collector.version)}" data-environment="${attribute(collector.environment)}">`
      : '') +
    (analytics
      ? `<meta name="mf-analytics" content="${attribute(analytics)}">`
      : '');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(response.body.pipeThrough(injectTag(tag)), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
