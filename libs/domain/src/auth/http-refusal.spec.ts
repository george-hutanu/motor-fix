// @traces 105-FR-016
import { HttpException, HttpStatus } from '@nestjs/common';

import { refusal } from './http-refusal';

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
