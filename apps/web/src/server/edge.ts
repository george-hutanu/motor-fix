import {
  type ClientRequest,
  request as httpRequest,
  type IncomingHttpHeaders,
} from 'node:http';
import { request as httpsRequest } from 'node:https';

import { logEntry, setRoute } from '@motor-fix/observability';
import { scrub } from '@motor-fix/observability/scrub';
import type { Express } from 'express';

import { reportServerError } from './render-error/render-error';

const READY_TIMEOUT_MS = 2_000;

// Whether a connection stays open, and for how long, is each connection's own:
// the API's word on its connection to this server is not passed on, so the
// browser hears this server's (keep-alive/keep-alive.ts).
const HOP_BY_HOP = new Set(['connection', 'keep-alive']);
const ownHeaders = (headers: IncomingHttpHeaders) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name)),
  );

// The browser reaches the API on the web app's own address. Answers are piped
// as they arrive, never buffered, so server-sent events stream through.
export function mountEdge(app: Express, apiUrl: string) {
  const api = new URL(apiUrl);
  const send = api.protocol === 'https:' ? httpsRequest : httpRequest;

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  // Ready only while the API is: asked on every probe, never cached.
  app.get('/health/ready', async (_req, res) => {
    const ready = await fetch(new URL('/health/ready', api), {
      signal: AbortSignal.timeout(READY_TIMEOUT_MS),
    }).then(
      (answer) => {
        // Only the status counts; the body is let go so the socket is freed.
        void answer.body?.cancel().catch(() => undefined);
        return answer.ok;
      },
      () => false,
    );
    if (ready) res.json({ status: 'ok' });
    else res.status(503).json({ status: 'unavailable' });
  });

  app.use('/api/', (req, res) => {
    setRoute('/api');
    const caller = req.socket.remoteAddress ?? '';
    const given = req.headers['x-forwarded-for'];
    // Built only for a failure: the masks are not run on every request.
    const where = () => ({
      method: req.method,
      path: scrub(req.originalUrl.split('?')[0] ?? ''),
    });
    // Any failure before a byte comes back, most often a pooled socket the
    // API has already closed: a GET or HEAD is sent once more on a fresh one.
    // A body is never replayed.
    const retriable = req.method === 'GET' || req.method === 'HEAD';
    let retried = false;
    // The browser went away: nothing is retried or reported.
    let left = false;
    // The API cut the answer after its headers and the proxy cut the browser.
    let failed = false;
    let upstream: ClientRequest | undefined;
    const cut = () => {
      if (failed) return;
      failed = true;
      logEntry(
        'warn',
        'api proxy: upstream closed before the response was complete',
        where(),
      );
      res.destroy();
    };
    const refused = (error: Error) => {
      if (left) return;
      if (res.headersSent) return cut();
      if (retriable && !retried) {
        retried = true;
        return attempt(true);
      }
      reportServerError(error, 'api proxy: upstream request failed', where());
      res.status(502).end();
    };
    const attempt = (fresh: boolean) => {
      const sent = send(
        {
          ...(fresh && { agent: false }),
          headers: {
            ...req.headers,
            host: api.host,
            // The API limits sign-in attempts per caller.
            'x-forwarded-for': given ? `${given}, ${caller}` : caller,
          },
          hostname: api.hostname,
          method: req.method,
          path: req.originalUrl,
          port: api.port,
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, ownHeaders(answer.headers));
          answer.on('close', () => {
            if (!answer.complete && !left && !res.writableFinished) cut();
          });
          answer.pipe(res);
        },
      );
      sent.on('error', refused);
      if (fresh) sent.end();
      else req.pipe(sent);
      upstream = sent;
    };
    res.on('close', () => {
      if (res.writableFinished || failed) return;
      left = true;
      upstream?.destroy();
    });
    attempt(false);
  });
}
