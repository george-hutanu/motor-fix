import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { LIVE_INPUTS_CONSUMER, LiveInputs } from './inputs';
import { FakeLiveVideo } from '../providers/fake-live-video.provider';
import { NONE } from '../providers/live-video.provider';
import type { LiveStoppedJob } from '../recordings/recordings';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const closes = (outcome: 'closed' | 'close_failed') =>
  counterTotal(memory.metricReader, 'motorfix_live_input_closes_total', {
    outcome,
  });

const SESSION = '5d2a1c7e-8b3f-4e6a-9d0c-1f2e3a4b5c6d';
const INPUT = 'input-uid-7';

let provider: FakeLiveVideo;
let findUnique: jest.Mock;
let logger: Logger;

beforeEach(() => {
  provider = new FakeLiveVideo();
  findUnique = jest
    .fn()
    .mockResolvedValue({ provider: 'fake', providerInputId: INPUT });
  logger = new Logger('LiveInputs');
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const inputs = (p = provider as typeof provider | typeof NONE) =>
  new LiveInputs({ liveSession: { findUnique } } as never, p, logger);

const stoppedJob = (
  payload: Record<string, unknown>,
  attemptsMade = 0,
): LiveStoppedJob => ({
  attemptsMade,
  data: {
    id: '77',
    kind: 'live.stopped',
    payload: { jobId: 'job-1', liveSessionId: SESSION, ...payload },
  },
  opts: { attempts: 3 },
});

// @traces 1390-FR-001 1390-FR-003 1390-FR-005
describe('closing the provider input after a live stop', () => {
  it('consumes live.stopped on its own queue, three tries a minute apart', () => {
    expect(LIVE_INPUTS_CONSUMER).toEqual({
      jobs: {
        attempts: 3,
        backoff: { delay: 60_000, type: 'fixed' },
        removeOnComplete: true,
        removeOnFail: true,
      },
      kinds: ['live.stopped'],
      queue: 'live-inputs',
    });
  });

  it.each([
    ['job_closed', false],
    ['feature_off', true],
    ['sender', false],
    ['idle', true],
  ])(
    'closes the input of a session stopped as %s, whatever it kept',
    async (reason, keep) => {
      const before = await closes('closed');

      await inputs().onEvent(stoppedJob({ keep, reason }));

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SESSION } }),
      );
      expect(provider.closed).toEqual([INPUT]);
      expect(provider.deleted).toEqual([]);
      expect(await closes('closed')).toBe(before + 1);
      expect(logger.log).toHaveBeenCalledWith(
        `live input closed: session ${SESSION} input ${INPUT}`,
      );
    },
  );

  it('throws on a failed close so the queue tries again, counting only the last try', async () => {
    jest
      .spyOn(provider, 'closeInput')
      .mockRejectedValue(new Error('live input close failed: 503'));
    const before = await closes('close_failed');

    await expect(
      inputs().onEvent(stoppedJob({ reason: 'job_closed' }, 0)),
    ).rejects.toThrow('live input close failed');
    expect(await closes('close_failed')).toBe(before);
    expect(logger.warn).toHaveBeenLastCalledWith(
      `live input close failed: session ${SESSION} input ${INPUT} try 1 of 3: 503`,
    );

    await expect(
      inputs().onEvent(stoppedJob({ reason: 'job_closed' }, 2)),
    ).rejects.toThrow('live input close failed');
    expect(await closes('close_failed')).toBe(before + 1);
    expect(logger.warn).toHaveBeenLastCalledWith(
      `live input close failed: session ${SESSION} input ${INPUT} try 3 of 3: 503`,
    );
  });

  it('logs only the error class when the failure carries no reason token', async () => {
    jest
      .spyOn(provider, 'closeInput')
      .mockRejectedValue(new TypeError('https://secret.example/?token=abc'));

    await expect(
      inputs().onEvent(stoppedJob({ reason: 'sender' }, 0)),
    ).rejects.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      `live input close failed: session ${SESSION} input ${INPUT} try 1 of 3: TypeError`,
    );
  });

  it('counts a close that succeeds on the last try as closed only', async () => {
    const failed = await closes('close_failed');
    const closed = await closes('closed');

    await inputs().onEvent(stoppedJob({ reason: 'feature_off' }, 2));

    expect(await closes('close_failed')).toBe(failed);
    expect(await closes('closed')).toBe(closed + 1);
  });

  it('leaves a session of another provider, or none configured, alone', async () => {
    findUnique.mockResolvedValue({
      provider: 'cloudflare',
      providerInputId: INPUT,
    });
    await inputs().onEvent(stoppedJob({ reason: 'sender' }));
    findUnique.mockResolvedValue({ provider: 'fake', providerInputId: INPUT });
    const none = jest.spyOn(NONE, 'closeInput');
    await inputs(NONE).onEvent(stoppedJob({ reason: 'sender' }));

    expect(provider.closed).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });

  it('ignores a session gone, another kind and a payload with no session', async () => {
    findUnique.mockResolvedValue(null);
    await inputs().onEvent(stoppedJob({}));
    await inputs().onEvent({
      ...stoppedJob({}),
      data: { id: '78', kind: 'media.added', payload: {} },
    });
    await inputs().onEvent(stoppedJob({ liveSessionId: 7 }));

    expect(provider.closed).toEqual([]);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
