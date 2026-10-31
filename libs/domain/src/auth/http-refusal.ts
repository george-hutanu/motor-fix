import { HttpException, HttpStatus } from '@nestjs/common';

// `reason` names why a refusal whose code covers several causes was given.
export const refusal = (
  status: HttpStatus,
  code: string,
  message: string,
  errors?: { code: string; field: string }[],
  reason?: string,
) =>
  new HttpException(
    { code, message, ...(errors && { errors }), ...(reason && { reason }) },
    status,
  );

// The 404 for a record the caller may not know exists.
export const notFound = (message = 'Not found') =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', message);
