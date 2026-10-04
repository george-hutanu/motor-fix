import { type ArgumentsHost, HttpException } from '@nestjs/common';

import { ProblemFilter } from './problem.filter';

function send(exception: unknown) {
  const res = {
    body: undefined as Record<string, unknown> | undefined,
    contentType: '',
    json(body: Record<string, unknown>) {
      this.body = body;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    statusCode: 0,
    type(value: string) {
      this.contentType = value;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return res;
}

describe('ProblemFilter field errors under hostile bodies', () => {
  it('sends no errors member for an empty list', () => {
    const res = send(new HttpException({ code: 'x', errors: [] }, 400));
    expect(res.body).not.toHaveProperty('errors');
    expect(res.body?.code).toBe('x');
  });

  it('drops the whole list when one entry is malformed', () => {
    const res = send(
      new HttpException(
        {
          code: 'validation_failed',
          errors: [{ code: 'a', field: 'b' }, { code: 'a' }],
        },
        400,
      ),
    );
    expect(res.body).not.toHaveProperty('errors');
    expect(res.body?.code).toBe('validation_failed');
  });

  it('keeps errors next to an array message from the validation pipe', () => {
    const errors = [{ code: 'required', field: 'name' }];
    const res = send(
      new HttpException(
        { errors, message: ['name should not be empty', 'x'], statusCode: 400 },
        400,
      ),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('validation_failed');
    expect(res.body?.errors).toEqual(errors);
  });

  it('answers an array message without errors with no errors member', () => {
    const res = send(
      new HttpException({ message: ['a', 'b'], statusCode: 400 }, 400),
    );
    expect(res.body?.code).toBe('validation_failed');
    expect(res.body).not.toHaveProperty('errors');
  });

  it('treats a string body as no errors', () => {
    const res = send(new HttpException('Taken', 409));
    expect(res.body?.code).toBe('conflict');
    expect(res.body).not.toHaveProperty('errors');
    expect(res.contentType).toBe('application/problem+json');
  });

  it('strips extra members from each entry', () => {
    const res = send(
      new HttpException(
        { errors: [{ code: 'a', field: 'b', secret: 'x' }] },
        400,
      ),
    );
    expect(res.body?.errors).toEqual([{ code: 'a', field: 'b' }]);
  });

  it('never leaks errors for a non-HTTP exception', () => {
    const err = Object.assign(new Error('boom'), {
      errors: [{ code: 'a', field: 'b' }],
    });
    const res = send(err);
    expect(res.statusCode).toBe(500);
    expect(res.body?.code).toBe('internal_error');
    expect(res.body).not.toHaveProperty('errors');
  });

  it('ignores errors that is a string', () => {
    const res = send(new HttpException({ code: 'x', errors: 'email' }, 400));
    expect(res.body).not.toHaveProperty('errors');
  });
});
