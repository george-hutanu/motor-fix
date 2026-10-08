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
// chunk by chunk.
function injectTag(tag: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let held = '';
  let done = false;
  return new TransformStream({
    flush(controller) {
      const rest = held + decoder.decode();
      if (rest) controller.enqueue(encoder.encode(rest));
    },
    transform(chunk, controller) {
      if (done) {
        controller.enqueue(chunk);
        return;
      }
      held += decoder.decode(chunk, { stream: true });
      const at = held.search(HEAD_END);
      if (at >= 0) {
        done = true;
        controller.enqueue(
          encoder.encode(`${held.slice(0, at)}${tag}${held.slice(at)}`),
        );
        held = '';
        return;
      }
      if (held.length > KEEP) {
        // Never cut between the two halves of a character like an emoji.
        let cut = held.length - KEEP;
        const code = held.charCodeAt(cut - 1);
        if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
        controller.enqueue(encoder.encode(held.slice(0, cut)));
        held = held.slice(cut);
      }
    },
  });
}

// Tells the browser where to send its telemetry, for which release and
// environment, in one tag before `</head>` of a rendered page. With no collector set the page
// carries no tag and the browser loads no telemetry at all.
export async function withTelemetryMeta(
  response: Response,
  collector: { environment: string; url: string; version: string } | undefined,
): Promise<Response> {
  const html = response.headers.get('content-type')?.startsWith('text/html');
  if (!collector || !html || !response.body) return response;
  const tag = `<meta name="mf-telemetry" content="${attribute(collector.url)}" data-version="${attribute(collector.version)}" data-environment="${attribute(collector.environment)}">`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(response.body.pipeThrough(injectTag(tag)), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
