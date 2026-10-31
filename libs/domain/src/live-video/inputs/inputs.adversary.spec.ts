import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import { LiveInputs } from './inputs';
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

let findUnique: jest.Mock;
let closeInput: jest.Mock;
let warn: jest.Mock;
let log: jest.Mock;

beforeEach(() => {
  findUnique = jest
    .fn()
    .mockResolvedValue({ provider: 'fake', providerInputId: 'in-1' });
  closeInput = jest.fn().mockResolvedValue(undefined);
  warn = jest.fn();
  log = jest.fn();
});

const inputs = () =>
  new LiveInputs(
    { liveSession: { findUnique } } as never,
    { closeInput, name: 'fake' } as never,
    { log, warn },
  );

const job = (
  payload: unknown,
  attemptsMade = 0,
  opts: { attempts?: number } = { attempts: 3 },
  kind = 'live.stopped',
) =>
  ({
    attemptsMade,
    data: { id: '1', kind, payload },
    opts,
  }) as unknown as LiveStoppedJob;

// @traces 1390-FR-001 1390-FR-003
describe('the live input consumer against hostile jobs', () => {
  it.each([
    ['a number', 42],
    ['null', null],
    ['an object', { a: 1 }],
    ['an array', [SESSION]],
    ['undefined', undefined],
  ])('skips a job whose liveSessionId is %s', async (_n, id) => {
    await inputs().onEvent(job({ liveSessionId: id }));

    expect(findUnique).not.toHaveBeenCalled();
    expect(closeInput).not.toHaveBeenCalled();
  });

  it('skips a job with a null payload', async () => {
    await expect(inputs().onEvent(job(null))).resolves.toBeUndefined();
    expect(closeInput).not.toHaveBeenCalled();
  });

  it('does not close for another event kind', async () => {
    await inputs().onEvent(
      job({ liveSessionId: SESSION }, 0, undefined, 'job.closed'),
    );

    expect(closeInput).not.toHaveBeenCalled();
  });

  it('does not count a skipped session as closed', async () => {
    const before = await closes('closed');
    findUnique.mockResolvedValue(null);

    await inputs().onEvent(job({ liveSessionId: SESSION }));

    expect(await closes('closed')).toBe(before);
    expect(closeInput).not.toHaveBeenCalled();
  });

  it('propagates a database failure without closing or counting', async () => {
    const before = await closes('close_failed');
    findUnique.mockRejectedValue(new Error('connection lost'));

    await expect(
      inputs().onEvent(job({ liveSessionId: SESSION })),
    ).rejects.toThrow('connection lost');

    expect(closeInput).not.toHaveBeenCalled();
    expect(await closes('close_failed')).toBe(before);
  });

  it.each([
    [0, 3, false],
    [1, 3, false],
    [2, 3, true],
    [3, 3, true],
    [0, 1, true],
  ])(
    'with %i tries made of %i, counts close_failed: %s',
    async (made, attempts, counted) => {
      const before = await closes('close_failed');
      closeInput.mockRejectedValue(new Error('live input close failed: 500'));

      await expect(
        inputs().onEvent(job({ liveSessionId: SESSION }, made, { attempts })),
      ).rejects.toThrow('live input close failed: 500');

      expect(await closes('close_failed')).toBe(before + (counted ? 1 : 0));
    },
  );

  it('treats a job with no attempts option as its only try', async () => {
    const before = await closes('close_failed');
    closeInput.mockRejectedValue(new Error('live input close failed: 500'));

    await expect(
      inputs().onEvent(job({ liveSessionId: SESSION }, 0, {})),
    ).rejects.toThrow();

    expect(await closes('close_failed')).toBe(before + 1);
  });

  it('warns without the url or message of an error that carries no reason token', async () => {
    closeInput.mockRejectedValue(
      new Error('fetch failed https://api.cloudflare.com/x?token=abc'),
    );

    await expect(
      inputs().onEvent(job({ liveSessionId: SESSION })),
    ).rejects.toThrow();

    const line = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).not.toMatch(/cloudflare|token|https?:/);
    expect(line).toContain(SESSION);
    expect(line).toContain('in-1');
  });

  it('rethrows a non-Error rejection and still warns once', async () => {
    closeInput.mockRejectedValue('boom https://x.test/?k=1');

    await expect(
      inputs().onEvent(job({ liveSessionId: SESSION })),
    ).rejects.toBe('boom https://x.test/?k=1');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/https?:/);
  });

  it('runs the same job twice, closing the same input both times', async () => {
    const before = await closes('closed');

    await inputs().onEvent(job({ liveSessionId: SESSION }));
    await inputs().onEvent(job({ liveSessionId: SESSION }));

    expect(closeInput.mock.calls).toEqual([['in-1'], ['in-1']]);
    expect(await closes('closed')).toBe(before + 2);
  });

  it('looks the session up by its id and selects only provider and input', async () => {
    await inputs().onEvent(job({ liveSessionId: SESSION }));

    expect(findUnique).toHaveBeenCalledWith({
      select: { provider: true, providerInputId: true },
      where: { id: SESSION },
    });
  });

  it.each([null, ''])(
    'does not report a close for a session whose input id is %p',
    async (providerInputId) => {
      const before = await closes('closed');
      findUnique.mockResolvedValue({ provider: 'fake', providerInputId });

      await inputs().onEvent(job({ liveSessionId: SESSION }));

      expect(closeInput).not.toHaveBeenCalledWith(providerInputId);
      expect(await closes('closed')).toBe(before);
    },
  );
});
