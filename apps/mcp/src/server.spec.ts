import type { AddressInfo } from 'node:net';

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

  it('answers 404 elsewhere', async () => {
    expect((await fetch(`${base}/health/ready`)).status).toBe(404);
  });
});
