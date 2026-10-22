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
    {} as never,
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

// @traces 398-FR-007
describe('the tool gate', () => {
  it('reads a feature through the one check: a stored row, or on when there is none', async () => {
    const rows: Record<string, { enabled: boolean }> = {
      'garage-1:lift_schedule': { enabled: false },
    };
    const prisma = {
      garageFeature: {
        findUnique: async ({
          where,
        }: {
          where: { garageId_key: { garageId: string; key: string } };
        }) =>
          rows[`${where.garageId_key.garageId}:${where.garageId_key.key}`] ??
          null,
      },
    };
    const gate = new TransportController(
      {} as McpActorService,
      [],
      { issuer: 'http://issuer.test', mcpUrl: 'http://127.0.0.1:3002/mcp' },
      prisma as never,
      {} as never,
      { on: async () => false },
      {} as never,
    ) as unknown as {
      ctx: { featureOn(garageId: string, key: string): Promise<boolean> };
    };

    await expect(gate.ctx.featureOn('garage-1', 'lift_schedule')).resolves.toBe(
      false,
    );
    await expect(gate.ctx.featureOn('garage-1', 'whatsapp')).resolves.toBe(
      true,
    );
  });
});
