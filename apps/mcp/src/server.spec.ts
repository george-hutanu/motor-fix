import { type AddressInfo, connect } from 'node:net';

import { createServer } from './server';

describe('mcp server', () => {
  const server = createServer();
  let base: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('answers live', async () => {
    const res = await fetch(`${base}/health/live`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('survives a request line no URL parser accepts', async () => {
    const port = (server.address() as AddressInfo).port;
    const answer = await new Promise<string>((resolve) => {
      const socket = connect(port, 'localhost', () =>
        socket.write('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'),
      );
      socket.once('data', (chunk) => {
        resolve(String(chunk));
        socket.destroy();
      });
    });

    expect(answer).toMatch(/^HTTP\/1\.1 404/);
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
  });

  it('answers 404 elsewhere', async () => {
    expect((await fetch(`${base}/health/ready`)).status).toBe(404);
  });
});
