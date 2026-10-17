import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { FailureLog } from './failure-log';

// A request through the middleware, ended with the status the route (or the
// guard in front of it) answered.
function answer(url: string, status: number) {
  const req = { method: 'GET', originalUrl: url } as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: status,
  }) as unknown as Response;
  const next = jest.fn();
  new FailureLog().use(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  res.emit('finish');
}

let lines: unknown[];
let infos: unknown[];

beforeEach(() => {
  lines = [];
  infos = [];
  jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation((message: unknown) => {
      lines.push(message);
    });
  jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    infos.push(message);
  });
});

afterEach(() => jest.restoreAllMocks());

// @traces 001-FR-014
describe('FailureLog', () => {
  it('writes one line with the route and status when a request fails, never the cursor', () => {
    answer('/api/v1/admin/accounts?cursor=secret', 400);

    expect(lines).toEqual([
      {
        message: 'admin accounts request failed',
        route: 'GET /api/v1/admin/accounts',
        status: 400,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('secret');
  });

  // @traces 002-FR-007
  it('never writes the search, an e-mail or a phone from the address', () => {
    answer(
      '/api/v1/admin/accounts?q=andrei%40gmail.com&role=driver&q=0722123456',
      400,
    );

    expect(lines).toEqual([
      {
        message: 'admin accounts request failed',
        route: 'GET /api/v1/admin/accounts',
        status: 400,
      },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/andrei|gmail|0722/);
  });

  it.each([403, 404, 500])(
    'logs a %s, including a refusal the guard answers before the route runs',
    (status) => {
      answer('/api/v1/admin/accounts/summary', status);

      expect(lines).toEqual([
        {
          message: 'admin accounts request failed',
          route: 'GET /api/v1/admin/accounts/summary',
          status,
        },
      ]);
    },
  );

  it('writes nothing when the request succeeds', () => {
    answer('/api/v1/admin/accounts', 200);

    expect(lines).toEqual([]);
  });
});

// @traces 1345-FR-018
describe('FailureLog and the session a visitor lacks', () => {
  it('logs a 401 once at info, with the route and status and never the cursor', () => {
    answer('/api/v1/admin/accounts?cursor=secret', 401);

    expect(infos).toEqual([
      {
        message: 'admin accounts request failed',
        route: 'GET /api/v1/admin/accounts',
        status: 401,
      },
    ]);
    expect(lines).toEqual([]);
    expect(JSON.stringify(infos)).not.toContain('secret');
  });

  it.each([403, 500])('logs a %s as a warning, not at info', (status) => {
    answer('/api/v1/admin/accounts', status);

    expect(lines).toHaveLength(1);
    expect(infos).toEqual([]);
  });

  it.each([200, 304, 399])('logs nothing for a %s', (status) => {
    answer('/api/v1/admin/accounts', status);

    expect(lines).toEqual([]);
    expect(infos).toEqual([]);
  });
});
