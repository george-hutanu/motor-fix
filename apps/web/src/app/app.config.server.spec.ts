/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server;
let base: string;
let connections: number;

beforeAll(async () => {
  server = createServer((_req, res) => res.end('{}'));
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  connections = 0;
});

// The server render's HttpClient (withFetch) calls the API through Node's
// global fetch, whose one undici dispatcher keeps connections alive.
// @traces 1188-FR-001
describe("the server render's connection to the API", () => {
  it('reuses its kept-alive connections across calls one after another', async () => {
    for (let call = 0; call < 10; call += 1) {
      const response = await fetch(`${base}/api/v1/home`);
      await response.text();
    }

    // undici may open a second socket while the first is being handed back
    // to the pool; without keep-alive each of the ten calls opens its own.
    expect(connections).toBeLessThanOrEqual(2);
  });
});
