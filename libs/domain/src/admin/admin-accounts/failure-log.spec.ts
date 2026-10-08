import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Logger,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import { FailureLog } from './failure-log';

function context(path: string, url: string): ExecutionContext {
  const request = { method: 'GET', originalUrl: url, route: { path }, url };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const handler = (result: () => unknown): CallHandler => ({
  handle: () => result() as ReturnType<CallHandler['handle']>,
});

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

  it('writes one line with the route and status when a request fails, and rethrows', async () => {
    const error = new BadRequestException({ code: 'invalid_cursor' });
    const call = new FailureLog().intercept(
      context('/api/v1/admin/accounts', '/api/v1/admin/accounts?cursor=secret'),
      handler(() => throwError(() => error)),
    );

    await expect(lastValueFrom(call)).rejects.toBe(error);
    expect(lines).toEqual([
      {
        message: 'admin accounts request failed',
        route: 'GET /api/v1/admin/accounts',
        status: 400,
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('secret');
  });

  it('counts an error that is not an HTTP one as a 500', async () => {
    const call = new FailureLog().intercept(
      context(
        '/api/v1/admin/accounts/summary',
        '/api/v1/admin/accounts/summary',
      ),
      handler(() => throwError(() => new Error('db down'))),
    );

    await expect(lastValueFrom(call)).rejects.toThrow('db down');
    expect(lines).toEqual([
      {
        message: 'admin accounts request failed',
        route: 'GET /api/v1/admin/accounts/summary',
        status: 500,
      },
    ]);
  });

  it('writes nothing when the request succeeds', async () => {
    const call = new FailureLog().intercept(
      context('/api/v1/admin/accounts', '/api/v1/admin/accounts'),
      handler(() => of({ items: [] })),
    );

    await expect(lastValueFrom(call)).resolves.toEqual({ items: [] });
    expect(lines).toEqual([]);
  });
});
