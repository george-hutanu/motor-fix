import { HttpErrorResponse } from '@angular/common/http';

// The status an api call failed with; 0 when it never got an answer.
export const httpStatus = (error: unknown) =>
  error instanceof HttpErrorResponse ? error.status : 0;
