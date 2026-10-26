import { HttpException, type HttpStatus } from '@nestjs/common';

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
