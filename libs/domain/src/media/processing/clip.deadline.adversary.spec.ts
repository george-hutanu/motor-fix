import { EventEmitter } from 'node:events';
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

import { MEDIA_LIMITS } from '@motor-fix/contracts';

import { convertClip } from './clip';

const calls: { tool: string; timeout: number }[] = [];
let took: number[] = [];
let now = 0;
let jump: (() => void) | undefined;

jest.mock('node:child_process', () => ({
  spawn: (tool: string, args: string[], options: { timeout: number }) => {
    calls.push({ timeout: options.timeout, tool });
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      stdout: new PassThrough(),
    });
    setImmediate(() => {
      now += took.shift() ?? 0;
      jump?.();
      if (tool === 'ffprobe') child.stdout.write('5.0\n');
      else writeFileSync(args[args.length - 1] as string, 'converted');
      child.emit('close', 0);
    });
    return child;
  },
}));

const LIMIT = MEDIA_LIMITS.conversionTimeoutMs;
const mediaDirs = () =>
  readdirSync(tmpdir()).filter((name) => name.startsWith('media-'));

beforeEach(() => {
  calls.length = 0;
  took = [];
  jump = undefined;
  now = 1_000_000;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

// @traces 333-FR-007
describe('the conversion deadline under hostile timing', () => {
  it('runs no ffmpeg when the probe alone spends the whole budget', async () => {
    took = [LIMIT];

    await expect(
      convertClip(Buffer.from('a clip'), { maxSeconds: 60 }),
    ).rejects.toThrow(/no time left to run ffmpeg/);
    expect(calls.map((c) => c.tool)).toEqual(['ffprobe']);
  });

  it('runs the last run with one millisecond left, not zero', async () => {
    took = [LIMIT - 1];

    await expect(
      convertClip(Buffer.from('a clip'), { maxSeconds: 60 }),
    ).resolves.toMatchObject({ seconds: 5 });
    expect(calls[1]).toEqual({ timeout: 1, tool: 'ffmpeg' });
  });

  it('stops before the poster run when the transcode spent the budget', async () => {
    took = [0, LIMIT];

    await expect(
      convertClip(Buffer.from('a clip'), { maxSeconds: 60 }),
    ).rejects.toThrow(/no time left to run ffmpeg/);
    expect(calls.map((c) => c.tool)).toEqual(['ffprobe', 'ffmpeg']);
  });

  it('rejects when the budget is overspent by a run that overshot', async () => {
    took = [LIMIT + 5 * 60_000];

    await expect(
      convertClip(Buffer.from('a clip'), { maxSeconds: 60 }),
    ).rejects.toThrow(/no time left/);
    expect(calls).toHaveLength(1);
  });

  it('never hands a run more than the whole budget when the wall clock steps back', async () => {
    let wall = 5_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => wall);
    jump = () => {
      wall -= 10 * 60_000;
    };

    await convertClip(Buffer.from('a clip'), { maxSeconds: 60 });

    expect(Math.max(...calls.map((c) => c.timeout))).toBeLessThanOrEqual(LIMIT);
  });

  it('gives a retry a fresh budget after an attempt spent its own', async () => {
    took = [LIMIT];
    await convertClip(Buffer.from('a clip'), {}).catch(() => undefined);
    calls.length = 0;

    await convertClip(Buffer.from('a clip'), {});

    expect(calls[0]).toEqual({ timeout: LIMIT, tool: 'ffprobe' });
  });

  it('gives two clips converting at once a budget each', async () => {
    await Promise.all([
      convertClip(Buffer.from('a'), {}),
      convertClip(Buffer.from('b'), {}),
    ]);

    expect(
      calls.filter((c) => c.tool === 'ffprobe').map((c) => c.timeout),
    ).toEqual([LIMIT, LIMIT]);
  });

  it('spends one probe on a clip that is too long and starts no ffmpeg', async () => {
    await expect(
      convertClip(Buffer.from('a clip'), { maxSeconds: 1 }),
    ).rejects.toMatchObject({ name: 'ClipTooLong' });
    expect(calls.map((c) => c.tool)).toEqual(['ffprobe']);
  });

  it('removes its working folder when the budget runs out', async () => {
    const before = mediaDirs();
    took = [LIMIT];

    await convertClip(Buffer.from('a clip'), {}).catch(() => undefined);

    expect(mediaDirs()).toEqual(before);
  });
});
