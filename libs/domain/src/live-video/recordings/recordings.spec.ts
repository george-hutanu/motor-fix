import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import {
  LIVE_RECORDINGS_CONSUMER,
  LiveRecordings,
  type LiveStoppedJob,
} from './recordings';
import { FakeLiveVideo } from '../providers/fake-live-video.provider';
import { NONE } from '../providers/live-video.provider';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const total = (name: string, labels?: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

const SESSION = '0b6c3d7e-2f41-4a8e-9c1d-5e7f8a9b0c1d';
const INPUT = 'input-uid-1';

let provider: FakeLiveVideo;
let findUnique: jest.Mock;
let logger: Logger;

beforeEach(() => {
  provider = new FakeLiveVideo();
  findUnique = jest
    .fn()
    .mockResolvedValue({ provider: 'fake', providerInputId: INPUT });
  logger = new Logger('LiveRecordings');
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const recordings = (p = provider as typeof provider | typeof NONE) =>
  new LiveRecordings({ liveSession: { findUnique } } as never, p, logger);

const stoppedJob = (
  payload: Record<string, unknown>,
  attemptsMade = 0,
): LiveStoppedJob => ({
  attemptsMade,
  data: {
    id: '41',
    kind: 'live.stopped',
    payload: { jobId: 'job-1', liveSessionId: SESSION, ...payload },
  },
  opts: { attempts: 3 },
});

// @traces 1251-FR-013
describe('deleting a discarded recording in the worker', () => {
  it('consumes live.stopped, three tries a minute apart', () => {
    expect(LIVE_RECORDINGS_CONSUMER).toMatchObject({
      jobs: { attempts: 3, backoff: { delay: 60_000, type: 'fixed' } },
      kinds: ['live.stopped'],
      queue: 'live-recordings',
    });
  });

  it('deletes the recording of a session stopped with keep off, by its input', async () => {
    const before = await total('motorfix_live_recordings_total', {
      outcome: 'discarded',
    });

    await recordings().onEvent(
      stoppedJob({ keep: false, reason: 'job_closed' }),
    );

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SESSION } }),
    );
    expect(provider.deleted).toEqual([INPUT]);
    expect(
      await total('motorfix_live_recordings_total', { outcome: 'discarded' }),
    ).toBe(before + 1);
  });

  it('makes the one empty call after a discard the API already completed', async () => {
    const recording = recordings();

    await recording.onEvent(stoppedJob({ keep: false, reason: 'sender' }));
    await recording.onEvent(stoppedJob({ keep: false, reason: 'sender' }));

    expect(provider.deleted).toEqual([INPUT, INPUT]);
  });

  it('throws on a failed delete so the queue tries again, counting only the last try', async () => {
    jest
      .spyOn(provider, 'deleteRecording')
      .mockRejectedValue(new Error('recording delete failed: 500'));
    const before = await total('motorfix_live_recordings_total', {
      outcome: 'discard_failed',
    });

    await expect(
      recordings().onEvent(stoppedJob({ keep: false, reason: 'idle' }, 0)),
    ).rejects.toThrow('recording delete failed');
    expect(
      await total('motorfix_live_recordings_total', {
        outcome: 'discard_failed',
      }),
    ).toBe(before);

    await expect(
      recordings().onEvent(stoppedJob({ keep: false, reason: 'idle' }, 2)),
    ).rejects.toThrow('recording delete failed');
    expect(
      await total('motorfix_live_recordings_total', {
        outcome: 'discard_failed',
      }),
    ).toBe(before + 1);
    expect(logger.warn).toHaveBeenCalledWith(
      `live recording discard failed: session ${SESSION} input ${INPUT} try 3 of 3`,
    );
  });

  it('never deletes a recording the session kept', async () => {
    await recordings().onEvent(stoppedJob({ keep: true, reason: 'sender' }));

    expect(findUnique).not.toHaveBeenCalled();
    expect(provider.deleted).toEqual([]);
  });

  it('leaves a session of another provider, or none configured, alone', async () => {
    findUnique.mockResolvedValue({
      provider: 'cloudflare',
      providerInputId: INPUT,
    });
    await recordings().onEvent(stoppedJob({ keep: false, reason: 'sender' }));
    findUnique.mockResolvedValue({ provider: 'fake', providerInputId: INPUT });
    await expect(
      recordings(NONE).onEvent(stoppedJob({ keep: false, reason: 'sender' })),
    ).resolves.toBeUndefined();

    expect(provider.deleted).toEqual([]);
  });

  it('ignores a session gone, another kind and a payload with no session', async () => {
    findUnique.mockResolvedValue(null);
    await recordings().onEvent(stoppedJob({ keep: false }));
    await recordings().onEvent({
      ...stoppedJob({ keep: false }),
      data: { id: '42', kind: 'media.added', payload: {} },
    });
    await recordings().onEvent(stoppedJob({ keep: false, liveSessionId: 7 }));

    expect(provider.deleted).toEqual([]);
  });
});

// @traces 1251-FR-003
describe('counting a kept recording once its stop committed', () => {
  it('counts a visible live item for a session stopped with keep on', async () => {
    const labels = { kind: 'live', outcome: 'visible' };
    const before = await total('motorfix_media_items_total', labels);

    await recordings().onEvent(
      stoppedJob({ keep: true, reason: 'job_closed' }),
    );

    expect(await total('motorfix_media_items_total', labels)).toBe(before + 1);
  });

  it('counts nothing for a discarded one', async () => {
    const labels = { kind: 'live', outcome: 'visible' };
    const before = await total('motorfix_media_items_total', labels);

    await recordings().onEvent(stoppedJob({ keep: false, reason: 'sender' }));

    expect(await total('motorfix_media_items_total', labels)).toBe(before);
  });
});
