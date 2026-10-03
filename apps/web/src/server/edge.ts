import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { Express } from 'express';

// The browser reaches the API on the web app's own address. Answers are piped
// as they arrive, never buffered, so server-sent events stream through.
export function mountEdge(app: Express, apiUrl: string) {
  const api = new URL(apiUrl);
  const send = api.protocol === 'https:' ? httpsRequest : httpRequest;

  const ok = (_req: unknown, res: { json: (body: unknown) => void }) =>
    res.json({ status: 'ok' });
  app.get('/health/live', ok);
  app.get('/health/ready', ok);

  app.use('/api/', (req, res) => {
    const upstream = send(
      {
        headers: { ...req.headers, host: api.host },
        hostname: api.hostname,
        method: req.method,
        path: req.originalUrl,
        port: api.port,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.on('aborted', () => res.destroy());
        answer.pipe(res);
      },
    );
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else res.status(502).end();
    });
    req.pipe(upstream);
  });
}
