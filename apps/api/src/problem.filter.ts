import { STATUS_CODES } from 'node:http';

import {
  codeForStatus,
  type FieldProblem,
  fieldProblems,
  type Problem,
  type ProblemBrand,
} from '@motor-fix/contracts';
import { countRateLimitRefusal, systemLog } from '@motor-fix/domain';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Request, Response } from 'express';

export function sendProblem(
  res: Response,
  status: number,
  code: string,
  detail?: string,
  errors?: FieldProblem[],
  extensions: Pick<
    Problem,
    | 'attemptsLeft'
    | 'retryAfterSeconds'
    | 'entity'
    | 'currentStatus'
    | 'to'
    | 'rule'
    | 'warnings'
    | 'brand'
  > & {
    field?: string;
    inviteId?: string;
    garageId?: string;
    garageName?: string;
    reason?: string;
    decidedBy?: string;
    decidedAt?: string;
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
    // The JSON parser refuses an oversized body before any route runs, with
    // an error of its own rather than an HttpException.
    if (tooLarge(exception)) {
      sendProblem(res, 413, 'payload_too_large');
      return;
    }
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception);
      // The request span ends in error with the cause, when one is recorded.
      const span = trace.getActiveSpan();
      span?.recordException(
        exception instanceof Error ? exception : String(exception),
      );
      span?.setStatus({ code: SpanStatusCode.ERROR });
      void systemLog.write('server_error', 'api', routeOf(host));
      sendProblem(res, 500, 'internal_error');
      return;
    }
    const status = exception.getStatus();
    if (status === 429) countRefusal(host);
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
      // the wait before a limit lifts, what a refused move was about, and
      // the garage a refused quote request names, the one field a refused
      // re-check marks, and the notes a refused listing check keeps beside
      // its errors, and the current brand a stale save is refused with.
      // Nothing else an exception holds leaves.
      {
        ...(typeof own.inviteId === 'string' && { inviteId: own.inviteId }),
        ...brand(own.brand),
        ...warnings(own.warnings),
        ...attemptsLeft(own.attemptsLeft),
        ...retryAfter(own.retryAfterSeconds),
        ...stringMembers(own),
      },
    );
  }
}

// The method and the route template an unexpected error happened on, never
// the path itself, which may hold ids; `unknown` when no route matched, or
// when the error came from outside an HTTP request.
function routeOf(host: ArgumentsHost) {
  const req = host.switchToHttp().getRequest<Partial<Request> | undefined>();
  const path = (req?.route as { path?: unknown } | undefined)?.path;
  return {
    method: typeof req?.method === 'string' ? req.method : 'unknown',
    route:
      typeof path === 'string' ? `${req?.baseUrl ?? ''}${path}` : 'unknown',
  };
}

// A call refused past a limit, by its method and route template; `unknown`
// alone when no route matched.
function countRefusal(host: ArgumentsHost) {
  const { method, route } = routeOf(host);
  countRateLimitRefusal(route === 'unknown' ? route : `${method} ${route}`);
}

const tooLarge = (exception: unknown) =>
  typeof exception === 'object' &&
  exception !== null &&
  (exception as { type?: unknown }).type === 'entity.too.large';

// How many tries a sign-in code has left, when the refusal says so.
function attemptsLeft(value: unknown): Pick<Problem, 'attemptsLeft'> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? { attemptsLeft: value }
    : {};
}

// The field notes that do not stop a move, when the refusal names any.
function warnings(value: unknown): Pick<Problem, 'warnings'> {
  const list = fieldProblems(value);
  return list ? { warnings: list } : {};
}

// The seconds until a limit lifts, when the refusal says so.
function retryAfter(value: unknown): Pick<Problem, 'retryAfterSeconds'> {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? { retryAfterSeconds: value }
    : {};
}

// The brand as it is now, when a stale save is refused with it: its listed
// fields only, and none of it unless every one has its type.
function brand(value: unknown): Pick<Problem, 'brand'> {
  if (typeof value !== 'object' || value === null) return {};
  const b = value as Record<keyof ProblemBrand, unknown>;
  const whole =
    typeof b.id === 'string' &&
    typeof b.name === 'string' &&
    typeof b.slug === 'string' &&
    (b.state === 'active' || b.state === 'retired') &&
    Number.isInteger(b.garages) &&
    Number.isInteger(b.cars) &&
    typeof b.updatedAt === 'string' &&
    (typeof b.updatedBy === 'string' || b.updatedBy === null);
  if (!whole) return {};
  const { cars, garages, id, name, slug, state, updatedAt, updatedBy } =
    b as ProblemBrand;
  return {
    brand: { cars, garages, id, name, slug, state, updatedAt, updatedBy },
  };
}

function detail(message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  return Array.isArray(message) ? message.join('; ') : undefined;
}

// The string members of a refused move (`invalid_transition`, and who
// decided a verification file first), of a garage that cannot receive a
// request (`garage_cannot_receive`), and the approved job a name clashes with
// (`exists`).
const STRING_MEMBERS = [
  'entity',
  'field',
  'currentStatus',
  'to',
  'rule',
  'garageId',
  'garageName',
  'reason',
  'decidedBy',
  'decidedAt',
  'jobTypeId',
  'nameRo',
] as const;

function stringMembers(
  own: Record<string, unknown>,
): Partial<Record<(typeof STRING_MEMBERS)[number], string>> {
  return Object.fromEntries(
    STRING_MEMBERS.filter((key) => typeof own[key] === 'string').map((key) => [
      key,
      own[key],
    ]),
  );
}
