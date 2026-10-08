import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { setRoute } from '@motor-fix/observability';
import type { Express } from 'express';

import { reportServerError } from './render-error/render-error';

const READY_TIMEOUT_MS = 2_000;

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
    const upstream = send(
      {
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
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.on('close', () => {
          if (!answer.complete) res.destroy();
        });
        answer.pipe(res);
      },
    );
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    upstream.on('error', (error) => {
      reportServerError(error);
      if (res.headersSent) res.destroy();
      else res.status(502).end();
    });
    req.pipe(upstream);
  });
}
