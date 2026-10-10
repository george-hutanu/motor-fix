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

// @traces 001-FR-014
describe('FailureLog', () => {
  let lines: unknown[];

  beforeEach(() => {
    lines = [];
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        lines.push(message);
      });
  });

  afterEach(() => jest.restoreAllMocks());

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

  it.each([401, 403, 404, 500])(
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
