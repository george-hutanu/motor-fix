import { type ArgumentsHost, HttpException, Logger } from '@nestjs/common';

import { ProblemFilter } from './problem.filter';

function send(exception: unknown) {
  const res = {
    body: undefined as Record<string, unknown> | undefined,
    json(body: Record<string, unknown>) {
      this.body = body;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    statusCode: 0,
    type() {
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return res;
}

describe('ProblemFilter inviteId pass-through', () => {
  it('passes a string inviteId next to the code', () => {
    const res = send(
      new HttpException({ code: 'invite_open', inviteId: 'abc' }, 409),
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'invite_open', inviteId: 'abc' });
  });

  it.each([
    ['a number', 42],
    ['an object', { a: 1 }],
    ['an array', ['x']],
    ['null', null],
    ['a boolean', true],
  ])('drops an inviteId that is %s', (_, inviteId) => {
    const res = send(new HttpException({ code: 'x', inviteId }, 409));
    expect(res.body).not.toHaveProperty('inviteId');
  });

  it('never lets members other than inviteId through', () => {
    const res = send(
      new HttpException(
        { code: 'x', inviteId: 'a', secret: 's', token: 't' },
        409,
      ),
    );
    expect(res.body).not.toHaveProperty('secret');
    expect(res.body).not.toHaveProperty('token');
  });

  it('keeps the status and code of the refusal when inviteId is hostile text', () => {
    const res = send(
      new HttpException(
        { code: 'invite_open', inviteId: '"},"code":"ok","status":200' },
        409,
      ),
    );
    expect(res.body?.code).toBe('invite_open');
    expect(res.body?.status).toBe(409);
  });

  it('carries no inviteId for a plain string refusal', () => {
    const res = send(new HttpException('nope', 409));
    expect(res.body).not.toHaveProperty('inviteId');
    expect(res.body?.code).toBe('conflict');
  });

  it('carries no inviteId on an unknown error', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('boom'), { inviteId: 'a' });
    const res = send(err);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toHaveProperty('inviteId');
  });
});
