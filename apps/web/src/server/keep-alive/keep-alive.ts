import { Server } from 'node:http';

import type { Express } from 'express';

// A client that keeps a connection open between requests sends its next one
// on it until the server closes it. When the two happen at the same moment the
// request meets a closing socket and the client gets a reset, not an answer.
// Node's default closes after 5 s idle (plus a 1 s buffer), which Playwright's
// request context, which never closes an idle connection itself, and a proxy
// in front, which pools its connections here, both meet. This server keeps an
// idle connection longer than the 60 s a proxy commonly keeps one, and far
// longer than a test leaves its request context idle, so the client lets it
// go first; a request's headers get longer still.
const KEEP_ALIVE_MS = 65_000;
const HEADERS_MS = 66_000;

export function keepAlive(server: Server) {
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = HEADERS_MS;
}

// The dev server the end-to-end suite runs against is built by the Angular
// CLI, not here, so the app tunes whichever server hands it a request, before
// that request's answer sets the connection's idle timer.
export function mountKeepAlive(app: Express) {
  app.use((req, _res, next) => {
    const { server } = req.socket;
    if (server instanceof Server && server.keepAliveTimeout !== KEEP_ALIVE_MS)
      keepAlive(server);
    next();
  });
}
