// @traces 105-FR-016
// @traces 1247-FR-009
import { HttpException, HttpStatus } from '@nestjs/common';

import { notFound, refusal } from './http-refusal';

describe('refusal', () => {
  it('answers with the status, the code and the message', () => {
    const error = refusal(HttpStatus.CONFLICT, 'brand_exists', 'Taken');

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      code: 'brand_exists',
      message: 'Taken',
    });
  });

  it('carries the field errors when there are some', () => {
    const errors = [{ code: 'too_short', field: 'name' }];

    expect(
      refusal(HttpStatus.BAD_REQUEST, 'invalid', 'Bad', errors).getResponse(),
    ).toEqual({ code: 'invalid', errors, message: 'Bad' });
  });
});

describe('notFound', () => {
  it('answers 404 not_found with the plain message', () => {
    const error = notFound();

    expect(error.getStatus()).toBe(404);
    expect(error.getResponse()).toEqual({
      code: 'not_found',
      message: 'Not found',
    });
  });

  it('carries the message its caller names', () => {
    expect(notFound('No such garage').getResponse()).toEqual({
      code: 'not_found',
      message: 'No such garage',
    });
  });
});
