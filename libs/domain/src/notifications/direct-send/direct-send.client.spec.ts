import { observeQueue, observeWorker } from '@motor-fix/observability';
import { Logger } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';

import { DIRECT_SEND_QUEUE, DIRECT_SEND_WAIT_MS } from './direct-send';
import { DirectSend } from './direct-send.client';
import { DirectSendModule } from './direct-send.module';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  QueueEvents: jest.fn(),
  Worker: jest.fn(() => ({ on: jest.fn() })),
}));
jest.mock('@motor-fix/observability', () => ({
  ...jest.requireActual('@motor-fix/observability'),
  observeQueue: jest.fn(),
  observeWorker: jest.fn(),
}));

const TO = '+40710000001';

function client(
  add: () => Promise<unknown>,
  wait?: (events: unknown, ttl: number) => Promise<unknown>,
) {
  const waitUntilFinished = jest.fn(wait ?? (async () => null));
  const remove = jest.fn(async () => undefined);
  const queue = {
    add: jest.fn(async () => {
      await add();
      return { remove, waitUntilFinished };
    }),
    close: jest.fn(async () => undefined),
    getBackend: () => ({ publishEvent: async () => '7-0' }),
  };
  const events = {
    close: jest.fn(async () => undefined),
    waitUntilReady: jest.fn(async () => undefined),
  };
  const listen = jest.fn(() => events);
  const send = new DirectSend(queue as never, listen as never);
  return { events, listen, queue, remove, send, waitUntilFinished };
}

const code = (s: DirectSend) =>
  s.whatsapp('SIGN_IN_CODE', 'ro', { code: '123456', minutes: 10 }, TO);

afterEach(() => jest.useRealTimers());

// @traces 1379-FR-001
// @traces 1379-FR-004
// @traces 1379-FR-005
describe('DirectSend', () => {
  it('adds one job with one attempt, removed soon after it ends', async () => {
    const c = client(async () => undefined);

    expect(await code(c.send)).toBeNull();
    expect(c.queue.add).toHaveBeenCalledTimes(1);
    expect(c.queue.add).toHaveBeenCalledWith(
      'whatsapp',
      {
        language: 'ro',
        template: 'SIGN_IN_CODE',
        to: TO,
        values: { code: '123456', minutes: 10 },
      },
      {
        attempts: 1,
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 60 },
      },
    );
    expect(c.waitUntilFinished).toHaveBeenCalledWith(
      c.events,
      DIRECT_SEND_WAIT_MS,
    );
  });

  it('adds an e-mail job with the recipient’s name', async () => {
    const c = client(async () => undefined);

    await c.send.email(
      'STAFF_INVITE.mechanic',
      'en',
      { link: 'x' },
      {
        email: 'ana@example.test',
        name: 'Ana',
      },
    );

    expect(c.queue.add.mock.calls[0]).toEqual([
      'email',
      {
        language: 'en',
        name: 'Ana',
        template: 'STAFF_INVITE.mechanic',
        to: 'ana@example.test',
        values: { link: 'x' },
      },
      expect.objectContaining({ attempts: 1 }),
    ]);
  });

  it('answers the worker’s result: null when sent, the kind when not', async () => {
    const c = client(
      async () => undefined,
      async () => 'template_missing',
    );

    expect(await code(c.send)).toBe('template_missing');
  });

  it('removes the job once its answer is read, sent or not', async () => {
    const sent = client(async () => undefined);
    const failed = client(
      async () => undefined,
      async () => {
        throw new Error('provider_timeout');
      },
    );

    await code(sent.send);
    await code(failed.send);

    expect(sent.remove).toHaveBeenCalledTimes(1);
    expect(failed.remove).toHaveBeenCalledTimes(1);
  });

  it('answers the failed job’s reason, provider_error when it is no kind', async () => {
    const refused = client(
      async () => undefined,
      async () => {
        throw new Error('provider_timeout');
      },
    );
    const odd = client(
      async () => undefined,
      async () => {
        throw new Error('Cannot read properties of undefined');
      },
    );

    expect(await code(refused.send)).toBe('provider_timeout');
    expect(await code(odd.send)).toBe('provider_error');
  });

  it('answers queue_unavailable when the job cannot be added, and adds it once', async () => {
    const c = client(async () => {
      throw new Error('Connection is closed.');
    });

    expect(await code(c.send)).toBe('queue_unavailable');
    expect(c.queue.add).toHaveBeenCalledTimes(1);
  });

  it('answers timeout at the cap when no finish arrives, never re-adding', async () => {
    jest.useFakeTimers();
    const c = client(
      async () => undefined,
      () => new Promise(() => undefined),
    );

    const answer = code(c.send);
    await jest.advanceTimersByTimeAsync(DIRECT_SEND_WAIT_MS);

    expect(await answer).toBe('timeout');
    expect(c.queue.add).toHaveBeenCalledTimes(1);
  });

  it('answers timeout at the cap when the broker never takes the job', async () => {
    jest.useFakeTimers();
    const c = client(() => new Promise(() => undefined));

    const answer = code(c.send);
    await jest.advanceTimersByTimeAsync(DIRECT_SEND_WAIT_MS);

    expect(await answer).toBe('timeout');
  });

  it('answers timeout when BullMQ’s own wait runs out', async () => {
    const c = client(
      async () => undefined,
      async () => {
        throw new Error(
          'Job wait whatsapp timed out before finishing, no finish notification arrived after 8000ms (id=1)',
        );
      },
    );

    expect(await code(c.send)).toBe('timeout');
  });

  it('logs nothing: the callers log the kind', async () => {
    const spies = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level),
    );
    const c = client(async () => {
      throw new Error('down');
    });

    await code(c.send);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('closes the queue and the listener on shutdown', async () => {
    const c = client(async () => undefined);
    await code(c.send);

    await c.send.onApplicationShutdown();

    expect(c.queue.close).toHaveBeenCalled();
    expect(c.events.close).toHaveBeenCalled();
  });

  it('builds the listener on the first send only, and once', async () => {
    const queue = { add: jest.fn(), close: jest.fn(async () => undefined) };
    const listen = jest.fn();
    const idle = new DirectSend(queue as never, listen);

    await idle.onApplicationShutdown();

    expect(listen).not.toHaveBeenCalled();
    expect(queue.close).toHaveBeenCalled();

    const c = client(async () => undefined);
    await code(c.send);
    await code(c.send);
    expect(c.listen).toHaveBeenCalledTimes(1);
  });

  it('listens from a mark written before the first job, so no answer is missed', async () => {
    const order: string[] = [];
    const c = client(async () => {
      order.push('add');
    });
    c.listen.mockImplementation(((mark: string) => {
      order.push(`listen ${mark}`);
      return c.events;
    }) as never);

    await code(c.send);

    expect(order).toEqual(['listen 7-0', 'add']);
  });

  it('answers queue_unavailable when the mark cannot be written, and tries again next time', async () => {
    const c = client(async () => undefined);
    const publishEvent = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue('8-0');
    (c.queue as { getBackend: unknown }).getBackend = () => ({ publishEvent });

    expect(await code(c.send)).toBe('queue_unavailable');
    expect(c.queue.add).not.toHaveBeenCalled();
    await code(c.send);
    expect(c.listen).toHaveBeenCalledWith('8-0');
  });
});

// @traces 1379-FR-007
// @traces 1379-FR-010
describe('DirectSendModule.register', () => {
  it('builds the queue and its listener on the broker, never retrying a command forever', () => {
    const module = DirectSendModule.register('redis://valkey.test:6379/2');
    for (const provider of module.providers ?? []) {
      const { useFactory, useValue } = provider as {
        useFactory?: () => unknown;
        useValue?: unknown;
      };
      useFactory?.();
      if (typeof useValue === 'function') useValue('0-0');
    }

    const connection = {
      maxRetriesPerRequest: null,
      url: 'redis://valkey.test:6379/2',
    };
    expect(Queue).toHaveBeenCalledWith(
      DIRECT_SEND_QUEUE,
      expect.objectContaining({ connection }),
    );
    expect(QueueEvents).toHaveBeenCalledWith(
      DIRECT_SEND_QUEUE,
      expect.objectContaining({ connection, lastEventId: '0-0' }),
    );
    expect(module.exports).toContain(DirectSend);
  });
});

// @traces 1379-FR-009
// @traces 1379-FR-010
describe('DirectSendModule.registerWorker', () => {
  it('consumes the queue with its metrics and gauges, never retrying a command forever', () => {
    const module = DirectSendModule.registerWorker({
      email: { apiUrl: 'http://brevo.test' } as never,
      phone: {} as never,
      redisUrl: 'redis://valkey.test:6379/2',
    });
    for (const provider of module.providers ?? []) {
      const factory = (provider as { useFactory?: () => unknown }).useFactory;
      factory?.();
    }

    expect(Worker).toHaveBeenCalledWith(
      DIRECT_SEND_QUEUE,
      expect.any(Function),
      expect.objectContaining({
        autorun: false,
        connection: {
          maxRetriesPerRequest: null,
          url: 'redis://valkey.test:6379/2',
        },
      }),
    );
    expect(observeWorker).toHaveBeenCalled();
    expect(observeQueue).toHaveBeenCalled();
  });
});
