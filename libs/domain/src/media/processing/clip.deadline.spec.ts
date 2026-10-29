import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';

import { MEDIA_LIMITS } from '@motor-fix/contracts';

import { convertClip } from './clip';

// ffprobe and ffmpeg stood in for: each run takes `took` of a clock the test
// owns, then answers. Every run's `timeout` is recorded.
const calls: { tool: string; timeout: number }[] = [];
let took: number[] = [];
let now = 0;

jest.mock('node:child_process', () => ({
  spawn: (tool: string, args: string[], options: { timeout: number }) => {
    calls.push({ timeout: options.timeout, tool });
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      stdout: new PassThrough(),
    });
    setImmediate(() => {
      now += took.shift() ?? 0;
      if (tool === 'ffprobe') child.stdout.write('5.0\n');
      else writeFileSync(args[args.length - 1] as string, 'converted');
      child.emit('close', 0);
    });
    return child;
  },
}));

const LIMIT = MEDIA_LIMITS.conversionTimeoutMs;
const MINUTE = 60_000;

beforeEach(() => {
  calls.length = 0;
  took = [];
  now = 1_000_000;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

// @traces 333-FR-007
describe('the time one conversion has', () => {
  it('is one budget for the whole attempt, each run given only what is left', async () => {
    took = [2 * MINUTE, 5 * MINUTE, 1 * MINUTE];

    await convertClip(Buffer.from('a clip'), { maxSeconds: 60 });

    expect(calls.map((c) => c.tool)).toEqual(['ffprobe', 'ffmpeg', 'ffmpeg']);
    expect(calls.map((c) => c.timeout)).toEqual([
      LIMIT,
      LIMIT - 2 * MINUTE,
      LIMIT - 7 * MINUTE,
    ]);
  });

  it('stops before the next run once the budget is spent', async () => {
    took = [3 * MINUTE, LIMIT - 3 * MINUTE];

    await expect(
      convertClip(Buffer.from('a clip'), { maxSeconds: 60 }),
    ).rejects.toThrow(/time/);
    expect(calls).toHaveLength(2);
  });
});
