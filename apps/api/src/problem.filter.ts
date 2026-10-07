import { STATUS_CODES } from 'node:http';

import {
  codeForStatus,
  type FieldProblem,
  fieldProblems,
  type Problem,
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
  extensions: Pick<Problem, 'attemptsLeft' | 'retryAfterSeconds'> & {
    inviteId?: string;
  } = {},
) {
  if (extensions.retryAfterSeconds !== undefined) {
    res.set('Retry-After', String(extensions.retryAfterSeconds));
  }
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
      // The members beyond the problem shape a refusal carries: the open
      // invite a refused send names, the tries a wrong code has left, and
      // the wait before a limit lifts. Nothing else an exception holds leaves.
      {
        ...(typeof own.inviteId === 'string' && { inviteId: own.inviteId }),
        ...attemptsLeft(own.attemptsLeft),
        ...retryAfter(own.retryAfterSeconds),
      },
    );
  }
}

// How many tries a sign-in code has left, when the refusal says so.
function attemptsLeft(value: unknown): Pick<Problem, 'attemptsLeft'> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? { attemptsLeft: value }
    : {};
}

// The seconds until a limit lifts, when the refusal says so.
function retryAfter(value: unknown): Pick<Problem, 'retryAfterSeconds'> {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? { retryAfterSeconds: value }
    : {};
}

function detail(message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  return Array.isArray(message) ? message.join('; ') : undefined;
}
