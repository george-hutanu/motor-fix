import { Logger } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';

import { DIRECT_SEND_QUEUE, DIRECT_SEND_WAIT_MS } from './direct-send';
import { DirectSend } from './direct-send.client';
import { DirectSendModule } from './direct-send.module';

jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  QueueEvents: jest.fn(),
  Worker: jest.fn(),
}));

const TO = '+40710000001';

function client(
  add: () => Promise<unknown>,
  wait?: (events: unknown, ttl: number) => Promise<unknown>,
) {
  const waitUntilFinished = jest.fn(wait ?? (async () => null));
  const queue = {
    add: jest.fn(async () => {
      await add();
      return { waitUntilFinished };
    }),
    close: jest.fn(async () => undefined),
  };
  const events = {
    close: jest.fn(async () => undefined),
    waitUntilReady: jest.fn(async () => undefined),
  };
  const send = new DirectSend(queue as never, events as never);
  return { events, queue, send, waitUntilFinished };
}

const code = (s: DirectSend) =>
  s.whatsapp('SIGN_IN_CODE', 'ro', { code: '123456', minutes: 10 }, TO);

afterEach(() => jest.useRealTimers());

// @traces 1379-provider-calls-worker-FR-001
// @traces 1379-provider-calls-worker-FR-004
// @traces 1379-provider-calls-worker-FR-005
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

    await c.send.onApplicationShutdown();

    expect(c.queue.close).toHaveBeenCalled();
    expect(c.events.close).toHaveBeenCalled();
  });
});

// @traces 1379-provider-calls-worker-FR-007
// @traces 1379-provider-calls-worker-FR-010
describe('DirectSendModule.register', () => {
  it('builds the queue and its listener on the broker, never retrying a command forever', () => {
    const module = DirectSendModule.register('redis://valkey.test:6379/2');
    for (const provider of module.providers ?? []) {
      const factory = (provider as { useFactory?: () => unknown }).useFactory;
      factory?.();
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
      expect.objectContaining({ connection }),
    );
    expect(module.exports).toContain(DirectSend);
  });
});
