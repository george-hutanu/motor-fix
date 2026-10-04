import { createServer as createHttpServer } from 'node:http';

export function createServer() {
  return createHttpServer((req, res) => {
    const path = (req.url ?? '/').split('?', 1)[0];
    if (req.method === 'GET' && path === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404).end();
  });
}
