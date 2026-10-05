import { randomUUID } from 'node:crypto';

import { Queue, Worker } from 'bullmq';

import { ObjectTimers, type TimerKind } from './timers';
import { redisUrlFor } from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(4);
const queue = new Queue('timers-test', { connection: { url: redisUrl } });

const fired: string[] = [];
let overdue: string[] = [];
const expiry: TimerKind = {
  fire: async (id) => {
    fired.push(id);
  },
  name: 'request-expiry',
  overdue: async () => overdue,
};

let timers: ObjectTimers;

afterAll(() => queue.close());

beforeEach(async () => {
  await queue.obliterate({ force: true });
  fired.length = 0;
  overdue = [];
  timers = new ObjectTimers(queue, [expiry]);
});

const NOW = new Date('2026-11-10T09:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('a per-object timer', () => {
  it('is one job with the stable id request-expiry-<id>', async () => {
    const id = randomUUID();
    await timers.set('request-expiry', id, minutes(30), NOW);

    const job = await queue.getJob(`request-expiry-${id}`);
    expect(job).toMatchObject({ data: { id }, name: 'request-expiry' });
    expect(job?.opts.delay).toBe(30 * 60_000);
  });

  it('is replaced, not doubled, when it is set again', async () => {
    const id = randomUUID();
    await timers.set('request-expiry', id, minutes(30), NOW);
    await timers.set('request-expiry', id, minutes(90), NOW);

    const jobs = await queue.getJobs(['delayed', 'waiting']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].opts.delay).toBe(90 * 60_000);
  });

  it('never fires once it is cleared', async () => {
    const id = randomUUID();
    await timers.set('request-expiry', id, minutes(0), NOW);
    await timers.clear('request-expiry', id);

    expect(await queue.getJob(`request-expiry-${id}`)).toBeUndefined();
  });

  it('fires its kind for its object when its time comes', async () => {
    const id = randomUUID();
    const worker = new Worker('timers-test', (job) => timers.handle(job), {
      connection: { maxRetriesPerRequest: null, url: redisUrl },
    });
    const done = new Promise((resolve) => worker.on('completed', resolve));
    await timers.set('request-expiry', id, new Date(), new Date());
    await done;
    await worker.close();
    expect(fired).toEqual([id]);
  });

  it('refuses a kind it does not know', async () => {
    await expect(
      timers.set('quote-expiry', randomUUID(), minutes(5), NOW),
    ).rejects.toThrow(/quote-expiry/);
  });
});

describe('the sweep', () => {
  it('runs each overdue object once', async () => {
    const lost = randomUUID();
    overdue = [lost];
    expect(await timers.sweep(NOW)).toBe(1);
    expect(fired).toEqual([lost]);
  });

  it('runs every 5 minutes', async () => {
    await timers.startSweep();
    const [scheduler] = await queue.getJobSchedulers();
    expect(scheduler).toMatchObject({ every: 5 * 60_000, name: 'sweep' });
  });

  it('is run by the same handler as the timers', async () => {
    overdue = [randomUUID()];
    await timers.handle({ data: {}, name: 'sweep' } as never);
    expect(fired).toEqual(overdue);
  });
});
