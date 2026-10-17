import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import { FailureLog } from './failure-log';

function answer(url: string, status: number, method = 'GET') {
  const req = { method, originalUrl: url } as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: status,
  }) as unknown as Response;
  new FailureLog().use(req, res, jest.fn());
  res.emit('finish');
  return res;
}

let warns: unknown[];
let infos: unknown[];

beforeEach(() => {
  warns = [];
  infos = [];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => {
    warns.push(m);
  });
  jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
    infos.push(m);
  });
});

afterEach(() => jest.restoreAllMocks());

// @traces 1345-FR-018
describe('FailureLog at the edges of the status classes', () => {
  it.each([400, 402, 404, 409, 422, 429, 499])(
    'logs a %s as a warning and not at info',
    (status) => {
      answer('/api/v1/admin/accounts', status);

      expect(warns).toHaveLength(1);
      expect(infos).toEqual([]);
    },
  );

  it.each([500, 502, 503, 599])(
    'logs a %s as a warning and not at info',
    (status) => {
      answer('/api/v1/admin/accounts', status);

      expect(warns).toHaveLength(1);
      expect(infos).toEqual([]);
    },
  );

  it.each([100, 199, 200, 204, 301, 302, 304, 399])(
    'logs nothing for a %s',
    (status) => {
      answer('/api/v1/admin/accounts', status);

      expect(warns).toEqual([]);
      expect(infos).toEqual([]);
    },
  );

  it('logs a 401 on any method with the method in the route', () => {
    answer('/api/v1/admin/accounts/abc/suspend', 401, 'POST');

    expect(infos).toEqual([
      {
        message: 'admin accounts request failed',
        route: 'POST /api/v1/admin/accounts/abc/suspend',
        status: 401,
      },
    ]);
  });

  it('keeps a search out of the 401 entry even behind an encoded question mark', () => {
    answer('/api/v1/admin/accounts%3Fcursor=secret?q=ana%40example.com', 401);

    expect(JSON.stringify(infos)).not.toMatch(/ana|example\.com/);
  });

  it('writes nothing at all for a 401 on a request that never finishes', () => {
    const req = { method: 'GET', originalUrl: '/x' } as Request;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 401,
    }) as unknown as Response;
    new FailureLog().use(req, res, jest.fn());

    expect(infos).toEqual([]);
    expect(warns).toEqual([]);
  });
});
