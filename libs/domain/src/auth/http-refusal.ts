import { HttpException, type HttpStatus } from '@nestjs/common';

export const refusal = (
  status: HttpStatus,
  code: string,
  message: string,
  errors?: { code: string; field: string }[],
) => new HttpException({ code, message, ...(errors && { errors }) }, status);
