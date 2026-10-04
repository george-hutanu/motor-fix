import { HttpErrorResponse } from '@angular/common/http';

import { httpStatus } from './http-status';

describe('httpStatus', () => {
  it('reads the status of an http error', () => {
    expect(httpStatus(new HttpErrorResponse({ status: 429 }))).toBe(429);
  });

  it('is 0 for anything else', () => {
    expect(httpStatus(new Error('offline'))).toBe(0);
    expect(httpStatus(undefined)).toBe(0);
  });
});
