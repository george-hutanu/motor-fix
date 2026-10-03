import { createServer as createHttpServer } from 'node:http';

export function createServer() {
  return createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404).end();
  });
}
