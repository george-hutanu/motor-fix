import { STATUS_CODES } from 'node:http';

import {
  codeForStatus,
  type FieldProblem,
  fieldProblems,
} from '@motor-fix/contracts';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export function sendProblem(
  res: Response,
  status: number,
  code: string,
  detail?: string,
  errors?: FieldProblem[],
  extensions: Record<string, string> = {},
) {
  res
    .status(status)
    .type('application/problem+json')
    .json({
      ...extensions,
      code,
      ...(detail && { detail }),
      ...(errors && { errors }),
      status,
      title: STATUS_CODES[status],
      type: 'about:blank',
    });
}

// Every error leaves the API as RFC 9457 problem details with a stable `code`
// the front end translates, and the field errors an exception names. Unknown
// errors keep their cause in the log only.
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception);
      sendProblem(res, 500, 'internal_error');
      return;
    }
    const status = exception.getStatus();
    const body = exception.getResponse();
    const own = (typeof body === 'object' ? body : {}) as Record<
      string,
      unknown
    >;
    sendProblem(
      res,
      status,
      typeof own.code === 'string' ? own.code : codeForStatus(status),
      detail(typeof body === 'string' ? body : own.message),
      fieldProblems(own.errors),
      extensionsOf(own),
    );
  }
}

// Members beyond the problem shape a refusal may carry for the front end to
// act on, named here so nothing else an exception holds leaves the API.
const EXTENSIONS = ['inviteId'] as const;

function extensionsOf(own: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of EXTENSIONS) {
    const value = own[name];
    if (typeof value === 'string') kept[name] = value;
  }
  return kept;
}

function detail(message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  return Array.isArray(message) ? message.join('; ') : undefined;
}
