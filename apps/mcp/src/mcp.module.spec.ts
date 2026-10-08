import { connect } from 'node:net';

import type { INestApplication } from '@nestjs/common';

import { bootMcp } from './boot.testing';

// @traces 365-FR-001
describe('mcp server', () => {
  let app: INestApplication;
  let base: string;
  let port: number;

  beforeAll(async () => {
    ({ app, base, port } = await bootMcp());
  });

  afterAll(() => app.close());

  it('answers live', async () => {
    const res = await fetch(`${base}/health/live`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('survives a request line no URL parser accepts', async () => {
    const answer = await new Promise<string>((resolve) => {
      const socket = connect(port, '127.0.0.1', () =>
        socket.write('GET http://[ HTTP/1.1\r\nHost: x\r\n\r\n'),
      );
      socket.once('data', (chunk) => {
        resolve(String(chunk));
        socket.destroy();
      });
    });

    expect(answer).toMatch(/^HTTP\/1\.1 4\d\d/);
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
  });

  it('answers 404 elsewhere', async () => {
    expect((await fetch(`${base}/health/ready`)).status).toBe(404);
  });

  it('asks an MCP call without a token to sign in, before reading anything', async () => {
    const res = await fetch(`${base}/mcp`, {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'sign_in_required' });
  });
});
