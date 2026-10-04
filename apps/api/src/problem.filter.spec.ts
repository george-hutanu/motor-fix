import {
  type ArgumentsHost,
  HttpException,
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
});
