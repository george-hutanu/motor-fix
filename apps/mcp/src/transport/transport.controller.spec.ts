import type { Response } from 'express';

import { TransportController } from './transport.controller';
import type { McpActorService } from '../auth/auth.actor';
import type { AuthedRequest } from '../auth/auth.middleware';

function response() {
  const res = {
    body: undefined as unknown,
    getHeader: (name: string) => res.headers[name],
    headers: { 'X-Request-Id': 'request-1' } as Record<string, string>,
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    statusCode: 200,
  };
  return res;
}

function controller(failure: Error) {
  const actors = {
    caller: () => Promise.reject(failure),
  } as unknown as McpActorService;
  return new TransportController(
    actors,
    [],
    { issuer: 'http://issuer.test', mcpUrl: 'http://127.0.0.1:3002/mcp' },
    {} as never,
    {} as never,
    { on: async () => false },
  );
}

const request = { auth: { clientId: 'c', scopes: [], token: 't' } };

describe('the MCP endpoint while the database is down', () => {
  // @traces 365-FR-009
  // @traces 365-FR-017
  it('answers service_unavailable before the account can be loaded', async () => {
    const down = Object.assign(new Error('Cannot reach the database'), {
      name: 'PrismaClientInitializationError',
    });
    const res = response();
    await controller(down).handle(
      request as unknown as AuthedRequest,
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      code: 'service_unavailable',
      message: expect.stringMatching(/later/i),
    });
    expect(JSON.stringify(res.body)).not.toContain('database');
  });

  it('lets any other failure through', async () => {
    const res = response();
    await expect(
      controller(new Error('boom')).handle(
        request as unknown as AuthedRequest,
        res as unknown as Response,
      ),
    ).rejects.toThrow('boom');
  });
});
