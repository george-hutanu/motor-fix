import { STATUS_CODES } from 'node:http';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'validation_failed',
  404: 'not_found',
  503: 'service_unavailable',
};

export function sendProblem(
  res: Response,
  status: number,
  code: string,
  detail?: string,
) {
  res
    .status(status)
    .type('application/problem+json')
    .json({
      code,
      ...(detail && { detail }),
      status,
      title: STATUS_CODES[status],
      type: 'about:blank',
    });
}

// Every error leaves the API as RFC 9457 problem details with a stable `code`
// the front end translates. Unknown errors keep their cause in the log only.
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const known = exception instanceof HttpException;
    const status = known ? exception.getStatus() : 500;
    if (!known) this.logger.error(exception);
    sendProblem(
      res,
      status,
      known ? (CODE_BY_STATUS[status] ?? 'error') : 'internal_error',
      known ? this.detail(exception) : undefined,
    );
  }

  private detail(exception: HttpException): string | undefined {
    const body = exception.getResponse();
    const message =
      typeof body === 'object' && 'message' in body ? body.message : body;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
}
