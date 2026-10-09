import {
  type ArgumentsHost,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import { ProblemFilter } from './problem.filter';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();
const tracer = provider.getTracer('spec');

function send(exception: unknown) {
  const res = {
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    json(body: unknown) {
      this.body = body;
      return this;
    },
    set(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    statusCode: 0,
    type() {
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return res;
}

// @traces 876-FR-007
describe('ProblemFilter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the code an exception carries', () => {
    const res = send(
      new HttpException(
        { code: 'sign_in_required', message: 'Sign in to continue' },
        401,
      ),
    );

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required', status: 401 });
  });

  it('forwards the tries a sign-in code has left', () => {
    const res = send(
      new HttpException(
        { attemptsLeft: 3, code: 'code_invalid', message: 'Wrong code' },
        401,
      ),
    );

    expect(res.body).toMatchObject({ attemptsLeft: 3, code: 'code_invalid' });
  });

  it('forwards the wait a refusal names, as the body member and Retry-After', () => {
    const res = send(
      new HttpException(
        {
          code: 'link_already_sent',
          message: 'Wait',
          retryAfterSeconds: 1200,
        },
        429,
      ),
    );

    expect(res.body).toMatchObject({
      code: 'link_already_sent',
      retryAfterSeconds: 1200,
    });
    expect(res.headers['Retry-After']).toBe('1200');
  });

  it('drops a wait that is not a positive whole count, and sends no header', () => {
    for (const retryAfterSeconds of [0, -5, 2.5, '60', null]) {
      const res = send(
        new HttpException({ code: 'x', retryAfterSeconds }, 429),
      );

      expect(res.body).not.toHaveProperty('retryAfterSeconds');
      expect(res.headers).toEqual({});
    }
  });

  it('drops an attemptsLeft that is not a whole count', () => {
    for (const attemptsLeft of [-1, 1.5, '2', null]) {
      const res = send(
        new HttpException({ attemptsLeft, code: 'code_invalid' }, 401),
      );

      expect(res.body).not.toHaveProperty('attemptsLeft');
    }
  });

  it('still maps a status without a code', () => {
    expect(send(new NotFoundException()).body).toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('maps a conflict without a code', () => {
    expect(send(new HttpException('Taken', 409)).body).toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('keeps the named extension members a refusal carries, and only those', () => {
    const res = send(
      new HttpException(
        {
          code: 'invite_open',
          internal: 'secret',
          inviteId: 'invite-9',
          message: 'open',
        },
        409,
      ),
    );

    expect(res.body).toMatchObject({
      code: 'invite_open',
      inviteId: 'invite-9',
    });
    expect(res.body).not.toHaveProperty('internal');
  });

  it('drops an extension member that is not a string', () => {
    const res = send(
      new HttpException({ code: 'invite_open', inviteId: { id: 1 } }, 409),
    );

    expect(res.body).not.toHaveProperty('inviteId');
  });

  // @traces 220-FR-015
  it('keeps the entity, current status, asked status and rule of a refused move', () => {
    const res = send(
      new HttpException(
        {
          code: 'invalid_transition',
          currentStatus: 'confirmed',
          entity: 'booking',
          rule: 'one_booking_per_quote',
          to: 'awaiting_confirmation',
        },
        409,
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'confirmed',
      entity: 'booking',
      rule: 'one_booking_per_quote',
      status: 409,
      to: 'awaiting_confirmation',
    });
  });

  it('drops a refused move member that is not a string', () => {
    const res = send(
      new HttpException(
        { code: 'invalid_transition', currentStatus: 3, entity: { a: 1 } },
        409,
      ),
    );

    expect(res.body).not.toHaveProperty('currentStatus');
    expect(res.body).not.toHaveProperty('entity');
  });

  it('keeps the field errors an exception carries', () => {
    const errors = [{ code: 'email_taken', field: 'email' }];
    const res = send(
      new HttpException({ code: 'validation_failed', errors }, 400),
    );

    expect(res.body).toMatchObject({ code: 'validation_failed', errors });
  });

  it('keeps the cause of an unknown error in the log only', () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const cause = new Error('connection reset');

    const res = send(cause);

    expect(log).toHaveBeenCalledWith(cause);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(res.body)).not.toContain('connection reset');
  });

  it('joins a list of messages into one detail', () => {
    const body = { message: ['name is empty', 'email is taken'] };

    expect(send(new HttpException(body, 400)).body).toMatchObject({
      detail: 'name is empty; email is taken',
    });
  });

  it('sends no detail for an object body without a message', () => {
    expect(
      send(new HttpException({ code: 'validation_failed' }, 400)).body,
    ).not.toHaveProperty('detail');
  });

  it.each([
    ['no list', { code: 'validation_failed' }],
    ['a malformed list', { code: 'validation_failed', errors: [{ x: 1 }] }],
    ['a list that is not one', { code: 'validation_failed', errors: 'email' }],
  ])('sends no field errors for %s', (_, body) => {
    expect(send(new HttpException(body, 400)).body).not.toHaveProperty(
      'errors',
    );
  });

  it('records an unknown error on the request span, which ends in error status', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    exporter.reset();
    const error = new Error('database unreachable');

    tracer.startActiveSpan('GET /api/v1/probe', (span) => {
      send(error);
      span.end();
    });

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events[0]).toMatchObject({
      attributes: expect.objectContaining({
        'exception.message': 'database unreachable',
      }),
      name: 'exception',
    });
  });

  it('leaves the request span alone for a refusal the client caused', () => {
    exporter.reset();

    tracer.startActiveSpan('GET /api/v1/probe', (span) => {
      send(new NotFoundException());
      span.end();
    });

    const [span] = exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(span?.events).toEqual([]);
  });
});
