/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { createServer, type Server } from 'node:http';
import { type AddressInfo, connect, type Socket } from 'node:net';

import express from 'express';

import { keepAlive, mountKeepAlive } from './keep-alive';

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Holds the one thread this process has, as a page being rendered holds the
// server's: no timer runs and no socket is read until it returns.
function busyUntil(time: number) {
  while (Date.now() < time) {
    // Nothing: the point is that nothing else runs.
  }
}

describe('the web server keeping a connection open between requests', () => {
  let server: Server | undefined;
  let socket: Socket | undefined;

  afterEach(async () => {
    socket?.destroy();
    if (server) await close(server);
    server = undefined;
    socket = undefined;
  });

  it("answers a request sent on a connection left idle past Node's default, while the server was busy, rather than resetting it", async () => {
    const app = express();
    mountKeepAlive(app);
    app.get('/', (_req, res) => {
      res.type('text/plain').send('ok');
    });
    // Built the way the dev server and app.listen build theirs: Node's
    // defaults, which close an idle connection after keepAliveTimeout plus
    // keepAliveTimeoutBuffer.
    server = createServer(app);
    const defaults = createServer();
    const idle = defaults.keepAliveTimeout + defaults.keepAliveTimeoutBuffer;
    const port = await listen(server);

    // One kept-alive connection, as Playwright's request context and a
    // proxy in front hold theirs: reused for as long as it stays open.
    const client = connect(port, '127.0.0.1');
    socket = client;
    client.setEncoding('utf8');
    let received = '';
    let expected = 0;
    let settle: (outcome: string) => void = () => undefined;
    const answers = () => received.split('\r\n\r\nok').length - 1;
    client.on('data', (chunk: string) => {
      received += chunk;
      if (answers() >= expected) settle('answered');
    });
    client.on('error', (error: NodeJS.ErrnoException) =>
      settle(error.code ?? error.message),
    );
    client.on('end', () => settle('closed'));
    const ask = () => {
      expected++;
      const outcome = new Promise<string>((resolve) => {
        settle = resolve;
      });
      client.write(`GET / HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\n\r\n`);
      return outcome;
    };

    expect(await ask()).toBe('answered');
    const last = Date.now();
    // Idle until just before Node's default would close the connection,
    await pause(idle - 300);
    // then send the next request from the check phase and stay busy past
    // that moment. The event loop runs due timers before it reads sockets,
    // so a server that closes at Node's default closes with the request
    // unread, and the kernel answers the client with a reset.
    await new Promise((resolve) => setImmediate(resolve));
    const second = ask();
    busyUntil(last + idle + 300);

    expect(await second).toBe('answered');
  }, 15_000);

  it('outlasts the 60 s a proxy in front commonly keeps an idle connection, and waits longer still for headers', () => {
    const tuned = createServer();

    keepAlive(tuned);

    expect(tuned.keepAliveTimeout).toBeGreaterThan(60_000);
    expect(tuned.headersTimeout).toBeGreaterThan(tuned.keepAliveTimeout);
    expect(tuned.requestTimeout).toBeGreaterThanOrEqual(tuned.headersTimeout);
  });
});
