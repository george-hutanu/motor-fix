import {
  type ArgumentsHost,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { ProblemFilter } from './problem.filter';

function send(exception: unknown) {
  const res = {
    body: undefined as unknown,
    json(body: unknown) {
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

describe('ProblemFilter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the code an exception carries', () => {
    const res = send(
      new HttpException(
        { code: 'sign_in_required', message: 'Sign in to continue' },
        401,
      ),
    );

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required', status: 401 });
  });

  it('still maps a status without a code', () => {
    expect(send(new NotFoundException()).body).toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('maps a conflict without a code', () => {
    expect(send(new HttpException('Taken', 409)).body).toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('keeps the field errors an exception carries', () => {
    const errors = [{ code: 'email_taken', field: 'email' }];
    const res = send(
      new HttpException({ code: 'validation_failed', errors }, 400),
    );

    expect(res.body).toMatchObject({ code: 'validation_failed', errors });
  });

  it('keeps the cause of an unknown error in the log only', () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const cause = new Error('connection reset');

    const res = send(cause);

    expect(log).toHaveBeenCalledWith(cause);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(res.body)).not.toContain('connection reset');
  });

  it('joins a list of messages into one detail', () => {
    const body = { message: ['name is empty', 'email is taken'] };

    expect(send(new HttpException(body, 400)).body).toMatchObject({
      detail: 'name is empty; email is taken',
    });
  });

  it('sends no detail for an object body without a message', () => {
    expect(
      send(new HttpException({ code: 'validation_failed' }, 400)).body,
    ).not.toHaveProperty('detail');
  });

  it.each([
    ['no list', { code: 'validation_failed' }],
    ['a malformed list', { code: 'validation_failed', errors: [{ x: 1 }] }],
    ['a list that is not one', { code: 'validation_failed', errors: 'email' }],
  ])('sends no field errors for %s', (_, body) => {
    expect(send(new HttpException(body, 400)).body).not.toHaveProperty(
      'errors',
    );
  });
});
