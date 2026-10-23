// @traces 520-FR-001 520-FR-002 520-FR-003 520-FR-005
import { Logger } from '@nestjs/common';

import { NotificationsConsumer } from './consumer';
import type { PrismaClient } from '../../generated/prisma/client';
import type { Brevo, KeyStatus } from '../brevo/brevo';
import {
  keyRetryDelay,
  NotificationsProcessor,
} from '../notifications.processor';
import type { NotificationsService } from '../notifications.service';
import { testConfig, testPhoneConfig } from '../notifications.testing';

type Outcome = KeyStatus;

const unreachable: Outcome = {
  outcome: 'unreachable',
  reason: 'provider_503',
};

function processorAnswering(...outcomes: Outcome[]) {
  const keyStatus = jest.fn(async () => outcomes.shift() ?? unreachable);
  const processor = new NotificationsProcessor(
    {} as PrismaClient,
    {} as NotificationsService,
    { keyStatus } as unknown as Brevo,
    testConfig('http://brevo.test'),
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
  );
  const delays: number[] = [];
  processor.sleep = async (ms) => {
    delays.push(ms);
  };
  return { delays, keyStatus, processor };
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  error = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('the delay before the next key check', () => {
  it('starts at a second and doubles up to a minute', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(keyRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });
});

describe('the start-up key check', () => {
  it('waits out an unreachable Brevo and passes once it answers', async () => {
    const { delays, keyStatus, processor } = processorAnswering(
      unreachable,
      { outcome: 'unreachable', reason: 'provider_unreachable' },
      unreachable,
      { outcome: 'passed' },
    );

    await expect(processor.ready()).resolves.toBe(true);

    expect(keyStatus).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(3);
    const logged = warn.mock.calls.map(([line]) => String(line));
    expect(logged[0]).toMatch(/attempt 1\b.*provider_503.*1 s/);
    expect(logged[1]).toMatch(/attempt 2\b.*provider_unreachable.*2 s/);
    expect(logged[2]).toMatch(/attempt 3\b.*4 s/);
    for (const line of logged) expect(line).not.toContain('test-key');
  });

  it('keeps retrying a minute apart once the delay reaches its cap', async () => {
    const { delays, processor } = processorAnswering(
      ...Array<Outcome>(9).fill(unreachable),
      { outcome: 'passed' },
    );

    await expect(processor.ready()).resolves.toBe(true);

    expect(delays.slice(-3)).toEqual([60_000, 60_000, 60_000]);
  });

  it('gives up at once on a refused key, with one error', async () => {
    const { delays, keyStatus, processor } = processorAnswering({
      outcome: 'refused',
      status: 401,
    });

    await expect(processor.ready()).resolves.toBe(false);

    expect(keyStatus).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops retrying when the worker shuts down', async () => {
    const { keyStatus, processor } = processorAnswering();
    const stop = new AbortController();
    processor.sleep = async () => stop.abort();

    await expect(processor.ready(stop.signal)).resolves.toBe(false);

    expect(keyStatus).toHaveBeenCalledTimes(1);
  });
});

describe('the notifications consumer', () => {
  const worker = () => ({ close: jest.fn(async () => undefined) });

  it('starts consuming as soon as the check passes, without a restart', async () => {
    let pass!: (ok: boolean) => void;
    const ready = jest.fn(
      () => new Promise<boolean>((resolve) => (pass = resolve)),
    );
    const started = worker();
    const start = jest.fn(async () => started);
    const consumer = new NotificationsConsumer(ready, start);

    const running = consumer.start();
    expect(consumer.ready()).toBe(false);
    expect(start).not.toHaveBeenCalled();

    pass(true);
    await running;

    expect(start).toHaveBeenCalledTimes(1);
    expect(consumer.ready()).toBe(true);
    await consumer.close();
    expect(started.close).toHaveBeenCalledTimes(1);
    expect(consumer.ready()).toBe(false);
  });

  it('never consumes when the check does not pass', async () => {
    const start = jest.fn(async () => worker());
    const consumer = new NotificationsConsumer(async () => false, start);

    await consumer.start();

    expect(start).not.toHaveBeenCalled();
    expect(consumer.ready()).toBe(false);
  });

  it('starts no consumer once the worker has shut down', async () => {
    let pass!: (ok: boolean) => void;
    let signal: AbortSignal | undefined;
    const consumer = new NotificationsConsumer(
      (given) => {
        signal = given;
        return new Promise<boolean>((resolve) => (pass = resolve));
      },
      jest.fn(async () => worker()),
    );

    const running = consumer.start();
    await consumer.close();
    expect(signal?.aborted).toBe(true);
    pass(true);
    await running;

    expect(consumer.ready()).toBe(false);
  });

  it('closes a consumer that finished opening during shutdown', async () => {
    let opened!: (w: ReturnType<typeof worker>) => void;
    let opening!: () => void;
    const asked = new Promise<void>((resolve) => (opening = resolve));
    const late = worker();
    const consumer = new NotificationsConsumer(
      async () => true,
      () =>
        new Promise((resolve) => {
          opened = resolve;
          opening();
        }),
    );

    const running = consumer.start();
    await asked;
    await consumer.close();
    opened(late);
    await running;

    expect(late.close).toHaveBeenCalledTimes(1);
    expect(consumer.ready()).toBe(false);
  });
});
