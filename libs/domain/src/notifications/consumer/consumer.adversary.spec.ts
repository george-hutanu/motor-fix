import { Logger } from '@nestjs/common';
import type { MockInstance } from 'vitest';

import { NotificationsConsumer } from './consumer';
import type { PrismaClient } from '../../generated/prisma/client';
import { Brevo, type KeyStatus } from '../brevo/brevo';
import { BrevoMock } from '../brevo/brevo-mock.testing';
import {
  keyRetryDelay,
  NotificationsProcessor,
} from '../notifications.processor';
import type { NotificationsService } from '../notifications.service';
import { testConfig, testPhoneConfig } from '../notifications.testing';

const unreachable = (reason = 'provider_503'): KeyStatus => ({
  outcome: 'unreachable',
  reason,
});

let warn: MockInstance;
let error: MockInstance;

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  error = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const build = (
  keyStatus: (signal?: AbortSignal) => Promise<KeyStatus>,
  email: Record<string, string> = {},
  phone: Record<string, string> = { PHONE_SENDING: 'off', WHATSAPP_SENDER: '' },
) => {
  const fn = vi.fn(keyStatus);
  const processor = new NotificationsProcessor(
    {} as PrismaClient,
    {} as NotificationsService,
    { keyStatus: fn } as unknown as Brevo,
    testConfig('http://brevo.test', email),
    testPhoneConfig(phone),
  );
  const delays: number[] = [];
  processor.sleep = async (ms) => {
    delays.push(ms);
  };
  return { delays, keyStatus: fn, processor };
};

const loggedLines = () =>
  [...warn.mock.calls, ...error.mock.calls].map(([line]) => String(line));

// @traces 520-FR-002
describe('the delay before the next key check at its limits', () => {
  it.each([
    [1, 1_000],
    [6, 32_000],
    [7, 60_000],
    [8, 60_000],
    [1_023, 60_000],
    [1_024, 60_000],
    [1_000_000, 60_000],
  ])('is %i failed attempts then %i ms', (failed, expected) => {
    expect(keyRetryDelay(failed)).toBe(expected);
  });

  it('never shrinks and never passes the cap over 200 attempts', () => {
    let last = 0;
    for (let n = 1; n <= 200; n++) {
      const d = keyRetryDelay(n);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeLessThanOrEqual(60_000);
      last = d;
    }
  });
});

// @traces 520-FR-002 520-FR-003 520-FR-005
describe('the start-up key check through the processor', () => {
  it('asks no one when sending is off everywhere', async () => {
    const { keyStatus, processor } = build(async () => unreachable(), {
      EMAIL_SENDING: 'off',
    });
    await expect(processor.ready()).resolves.toBe(true);
    expect(keyStatus).not.toHaveBeenCalled();
    expect(loggedLines()).toEqual([]);
  });

  it('passes the first time with no wait and no log', async () => {
    const { delays, keyStatus, processor } = build(async () => ({
      outcome: 'passed',
    }));
    await expect(processor.ready()).resolves.toBe(true);
    expect(keyStatus).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(loggedLines()).toEqual([]);
  });

  it('does not ask when the API key is missing and logs one error', async () => {
    const { keyStatus, processor } = build(async () => unreachable(), {
      BREVO_API_KEY: '',
    });
    await expect(processor.ready()).resolves.toBe(false);
    expect(keyStatus).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not ask when the sender is missing and logs one error', async () => {
    const { keyStatus, processor } = build(async () => unreachable(), {
      EMAIL_FROM: '',
    });
    await expect(processor.ready()).resolves.toBe(false);
    expect(keyStatus).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the web URL is missing and logs one error', async () => {
    const { keyStatus, processor } = build(async () => unreachable(), {
      PUBLIC_WEB_URL: '',
    });
    await expect(processor.ready()).resolves.toBe(false);
    expect(keyStatus).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the web URL is not a URL', async () => {
    const { keyStatus, processor } = build(async () => unreachable(), {
      PUBLIC_WEB_URL: 'not a url',
    });
    await expect(processor.ready()).resolves.toBe(false);
    expect(keyStatus).not.toHaveBeenCalled();
  });

  it('checks the key when only phone sending is on', async () => {
    const { keyStatus, processor } = build(
      async () => ({ outcome: 'passed' }),
      { EMAIL_SENDING: 'off' },
      {},
    );
    await expect(processor.ready()).resolves.toBe(true);
    expect(keyStatus).toHaveBeenCalledTimes(1);
  });

  it('follows the doubling then the cap, one warning per failed attempt', async () => {
    const outcomes: KeyStatus[] = [
      ...Array.from({ length: 10 }, () => unreachable()),
      { outcome: 'passed' },
    ];
    const { delays, keyStatus, processor } = build(
      async () => outcomes.shift() as KeyStatus,
    );
    await expect(processor.ready()).resolves.toBe(true);
    expect(keyStatus).toHaveBeenCalledTimes(11);
    expect(delays).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
      60_000,
    ]);
    expect(warn).toHaveBeenCalledTimes(10);
    expect(error).not.toHaveBeenCalled();
    warn.mock.calls.forEach(([line], i) => {
      expect(String(line)).toMatch(new RegExp(`attempt ${i + 1}\\b`));
      expect(String(line)).toContain(`${delays[i] / 1000} s`);
    });
  });

  it('waits only after an attempt has ended, never before the first', async () => {
    const events: string[] = [];
    const outcomes: KeyStatus[] = [unreachable(), { outcome: 'passed' }];
    const { processor } = build(async () => {
      events.push('ask');
      return outcomes.shift() as KeyStatus;
    });
    processor.sleep = async () => {
      events.push('sleep');
    };
    await processor.ready();
    expect(events).toEqual(['ask', 'sleep', 'ask']);
  });

  it('hands the shutdown signal to every wait', async () => {
    const stop = new AbortController();
    const outcomes: KeyStatus[] = [unreachable(), { outcome: 'passed' }];
    const { processor } = build(async () => outcomes.shift() as KeyStatus);
    const seen: (AbortSignal | undefined)[] = [];
    processor.sleep = async (_ms, signal) => {
      seen.push(signal);
    };
    await processor.ready(stop.signal);
    expect(seen).toEqual([stop.signal]);
  });

  it('stops at a refusal that follows unreachable attempts', async () => {
    const outcomes: KeyStatus[] = [
      unreachable(),
      unreachable('provider_429'),
      { outcome: 'refused', status: 403 },
      { outcome: 'passed' },
    ];
    const { keyStatus, processor } = build(
      async () => outcomes.shift() as KeyStatus,
    );
    await expect(processor.ready()).resolves.toBe(false);
    expect(keyStatus).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('never logs the API key, refused or unreachable', async () => {
    const outcomes: KeyStatus[] = [
      unreachable(),
      { outcome: 'refused', status: 401 },
    ];
    const { processor } = build(async () => outcomes.shift() as KeyStatus);
    await processor.ready();
    for (const line of loggedLines()) expect(line).not.toContain('test-key');
  });

  it('asks no one when already shut down', async () => {
    const stop = new AbortController();
    stop.abort();
    const { keyStatus, processor } = build(async () => ({
      outcome: 'passed',
    }));
    await expect(processor.ready(stop.signal)).resolves.toBe(false);
    expect(keyStatus).not.toHaveBeenCalled();
  });

  it('ends the real wait between two attempts at shutdown', async () => {
    const stop = new AbortController();
    const { keyStatus, processor } = build(async () => unreachable());
    processor.sleep = new NotificationsProcessor(
      {} as PrismaClient,
      {} as NotificationsService,
      {} as Brevo,
      testConfig('http://brevo.test'),
      testPhoneConfig(),
    ).sleep;
    setTimeout(() => stop.abort(), 50);
    const started = Date.now();
    await expect(processor.ready(stop.signal)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(900);
    expect(keyStatus).toHaveBeenCalledTimes(1);
  });
});

// @traces 520-FR-001 520-FR-003
describe('the start-up key check against a real Brevo stand-in', () => {
  const mock = new BrevoMock();
  beforeAll(() => mock.start());
  afterAll(() => mock.stop());
  beforeEach(() => mock.reset());

  const against = () => {
    const processor = new NotificationsProcessor(
      {} as PrismaClient,
      {} as NotificationsService,
      new Brevo({ apiKey: 'test-key', apiUrl: mock.url, timeoutMs: 200 }),
      testConfig(mock.url),
      testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
    );
    const delays: number[] = [];
    processor.sleep = async (ms) => {
      delays.push(ms);
    };
    return { delays, processor };
  };

  it('retries a 503, a 429 and a timeout then passes on the fourth ask', async () => {
    mock.answer({ status: 503 }, { status: 429 }, { hang: true, status: 200 });
    const { delays, processor } = against();
    await expect(processor.ready()).resolves.toBe(true);
    expect(mock.calls.map((c) => c.path)).toEqual([
      '/v3/account',
      '/v3/account',
      '/v3/account',
      '/v3/account',
    ]);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    const lines = warn.mock.calls.map(([line]) => String(line));
    expect(lines[0]).toContain('provider_503');
    expect(lines[1]).toContain('provider_429');
    expect(lines[2]).toContain('provider_timeout');
  });

  it.each([400, 401, 403, 404])(
    'asks once on a %i and gives up',
    async (status) => {
      mock.answer({ status }, { status: 200 });
      const { delays, processor } = against();
      await expect(processor.ready()).resolves.toBe(false);
      expect(mock.calls).toHaveLength(1);
      expect(delays).toEqual([]);
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(String(status));
    },
  );
});

// @traces 520-FR-002 520-FR-003 520-FR-004
describe('the notifications consumer at its edges', () => {
  const worker = () => ({ close: vi.fn(async () => undefined) });

  it('is not ready before it starts', () => {
    const consumer = new NotificationsConsumer(
      async () => true,
      async () => worker(),
    );
    expect(consumer.ready()).toBe(false);
  });

  it('opens one consumer when started twice', async () => {
    const open = vi.fn(async () => worker());
    const consumer = new NotificationsConsumer(async () => true, open);
    await consumer.start();
    await consumer.start();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('closes the consumer once when closed twice', async () => {
    const w = worker();
    const consumer = new NotificationsConsumer(
      async () => true,
      async () => w,
    );
    await consumer.start();
    await consumer.close();
    await consumer.close();
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it('closes the consumer once when closed twice at the same time', async () => {
    const w = worker();
    const consumer = new NotificationsConsumer(
      async () => true,
      async () => w,
    );
    await consumer.start();
    await Promise.all([consumer.close(), consumer.close()]);
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it('opens nothing when closed before it starts', async () => {
    const open = vi.fn(async () => worker());
    const consumer = new NotificationsConsumer(async () => true, open);
    await consumer.close();
    await consumer.start();
    expect(open).not.toHaveBeenCalled();
    expect(consumer.ready()).toBe(false);
  });

  it('closes a consumer that finished opening after the shutdown', async () => {
    let finish!: (w: ReturnType<typeof worker>) => void;
    const late = worker();
    const consumer = new NotificationsConsumer(
      async () => true,
      () =>
        new Promise<ReturnType<typeof worker>>((resolve) => {
          finish = resolve;
        }),
    );
    const running = consumer.start();
    await new Promise((resolve) => setImmediate(resolve));
    await consumer.close();
    finish(late);
    await running;
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(consumer.ready()).toBe(false);
  });

  it('stays not ready and rejects when the check throws', async () => {
    const open = vi.fn(async () => worker());
    const consumer = new NotificationsConsumer(async () => {
      throw new Error('boom');
    }, open);
    await expect(consumer.start()).rejects.toThrow('boom');
    expect(open).not.toHaveBeenCalled();
    expect(consumer.ready()).toBe(false);
  });

  it('stays not ready and rejects when opening the queue fails', async () => {
    const consumer = new NotificationsConsumer(
      async () => true,
      async () => {
        throw new Error('redis down');
      },
    );
    await expect(consumer.start()).rejects.toThrow('redis down');
    expect(consumer.ready()).toBe(false);
  });

  it('reports not ready the moment it closes, even if the worker closes slowly', async () => {
    let release!: () => void;
    const w = {
      close: vi.fn(() => new Promise<void>((resolve) => (release = resolve))),
    };
    const consumer = new NotificationsConsumer(
      async () => true,
      async () => w,
    );
    await consumer.start();
    expect(consumer.ready()).toBe(true);
    const closing = consumer.close();
    expect(consumer.ready()).toBe(false);
    release();
    await closing;
  });

  it('runs through the processor: outage then recovery gives a ready consumer', async () => {
    const outcomes: KeyStatus[] = [
      unreachable(),
      unreachable('provider_unreachable'),
      { outcome: 'passed' },
    ];
    const { processor } = build(async () => outcomes.shift() as KeyStatus);
    const w = worker();
    const consumer = new NotificationsConsumer(
      (signal) => processor.ready(signal),
      async () => w,
    );
    await consumer.start();
    expect(consumer.ready()).toBe(true);
    await consumer.close();
    expect(w.close).toHaveBeenCalledTimes(1);
  });

  it('runs through the processor: a pass landing after shutdown opens nothing', async () => {
    const stop = { release: () => undefined as unknown };
    const { processor } = build(
      () =>
        new Promise<KeyStatus>((resolve) => {
          stop.release = () => resolve({ outcome: 'passed' });
        }),
    );
    const open = vi.fn(async () => worker());
    const consumer = new NotificationsConsumer(
      (signal) => processor.ready(signal),
      open,
    );
    const running = consumer.start();
    await new Promise((resolve) => setImmediate(resolve));
    await consumer.close();
    stop.release();
    await running;
    expect(open).not.toHaveBeenCalled();
    expect(consumer.ready()).toBe(false);
  });

  it('runs through the processor: a refused key leaves it off and not ready', async () => {
    const { keyStatus, processor } = build(async () => ({
      outcome: 'refused',
      status: 401,
    }));
    const open = vi.fn(async () => worker());
    const consumer = new NotificationsConsumer(
      (signal) => processor.ready(signal),
      open,
    );
    await consumer.start();
    expect(open).not.toHaveBeenCalled();
    expect(consumer.ready()).toBe(false);
    expect(keyStatus).toHaveBeenCalledTimes(1);
  });
});
