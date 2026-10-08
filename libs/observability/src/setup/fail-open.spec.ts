import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import express from 'express';

import { routeLabel } from './route-label';
import { startTelemetry } from './start';
import { patchForJest } from '../testing/in-memory';

function listen(server: Server) {
  return new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    );
  });
}

// A collector that refuses every export.
const collector = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.statusCode = 503;
    res.end();
  });
});
const app = express()
  .use(routeLabel())
  .get('/api/v1/garages/:id', (req, res) => {
    res.json({ id: req.params.id });
  });
const server = createServer(app);

// Kept-alive sockets (fetch's, the exporter's) would hold close() open.
afterAll(async () => {
  server.closeAllConnections();
  collector.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => collector.close(resolve));
});

// @traces 876-FR-013
describe('telemetry with an endpoint that fails', () => {
  it('leaves every response unchanged and flushes and shuts down without throwing', async () => {
    const endpoint = await listen(collector);
    const base = await listen(server);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const started = startTelemetry('api', {
      APP_ENV: 'staging',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    });
    patchForJest();

    const statuses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        fetch(`${base}/api/v1/garages/${i}`).then((res) => res.status),
      ),
    );

    expect(statuses).toEqual(Array(20).fill(200));
    const begun = Date.now();
    await expect(started?.flush()).resolves.toBeUndefined();
    await expect(started?.shutdown()).resolves.toBeUndefined();
    expect(Date.now() - begun).toBeLessThan(25_000);
    error.mockRestore();
  }, 30_000);
});
