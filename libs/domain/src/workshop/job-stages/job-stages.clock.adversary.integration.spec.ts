import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

type Team = Awaited<ReturnType<typeof team>>;

async function jobOf(t: Team, driverId: string, status: JobStatus) {
  const { booking } = await world.chain(driverId, t.garage.id, {
    request: status === 'done' ? 'done' : 'booked',
  });
  const job = await world.job(booking.id, status);
  return prisma.job.update({
    data: { mechanicId: t.plainMechanic.id, receivedAt: new Date() },
    where: { id: job.id },
  });
}

async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  return {
    andrei,
    dinamo,
    hand: bearer(dinamo.plain, 'mechanic'),
    owner: bearer(dinamo.owner, 'garage'),
  };
}

type Setting = Awaited<ReturnType<typeof setting>>;

const stage = (jobId: string, verb: string, auth: string) =>
  send('post', `/garage/jobs/${jobId}/${verb}`, auth);

const reread = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

const entries = (jobId: string) =>
  prisma.jobStageEntry.count({ where: { jobId } });

const ago = (jobId: string, ms: number) =>
  prisma.job.update({
    data: { inWorkSince: new Date(Date.now() - ms) },
    where: { id: jobId },
  });

async function running(s: Setting, status: JobStatus = 'to_do') {
  const job = await jobOf(s.dinamo, s.andrei, status);
  return job;
}

// @traces 122-FR-002 122-FR-003 122-FR-004
describe('the job clock under repeated and crossed calls', () => {
  it('keeps the open stretch and the time when start is sent to a job already in work', async () => {
    const s = await setting();
    const job = await running(s);
    await stage(job.id, 'start', s.hand);
    await ago(job.id, 61_000);
    const before = await reread(job.id);

    const again = await stage(job.id, 'start', s.hand);

    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(await reread(job.id)).toMatchObject({
      inWorkSince: before.inWorkSince,
      workedSeconds: before.workedSeconds,
    });
    expect(await entries(job.id)).toBe(1);
  });

  it('adds the time once when pause is sent twice', async () => {
    const s = await setting();
    const job = await running(s);
    await stage(job.id, 'start', s.hand);
    await ago(job.id, 120_500);
    await stage(job.id, 'pause', s.hand);

    const second = await stage(job.id, 'pause', s.hand);

    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await reread(job.id)).toMatchObject({
      inWorkSince: null,
      status: 'paused',
      workedSeconds: 120,
    });
  });

  it('adds the time once when a pause and a finish arrive together', async () => {
    const s = await setting();
    const job = await running(s);
    await stage(job.id, 'start', s.hand);
    await ago(job.id, 100_500);

    const [a, b] = await Promise.all([
      stage(job.id, 'pause', s.hand),
      stage(job.id, 'finish', s.owner),
    ]);

    expect([a.status, b.status].filter((c) => c === 200)).toHaveLength(
      (await entries(job.id)) - 1,
    );
    const after = await reread(job.id);
    expect(after.inWorkSince).toBeNull();
    expect(after.workedSeconds).toBeLessThan(105);
    expect(after.workedSeconds).toBeGreaterThanOrEqual(100);
  });

  it('adds nothing on a finish from paused whatever the clock held', async () => {
    const s = await setting();
    const job = await running(s);
    await stage(job.id, 'start', s.hand);
    await ago(job.id, 50_500);
    await stage(job.id, 'pause', s.hand);

    const res = await stage(job.id, 'finish', s.hand);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      inWorkSince: null,
      status: 'done',
      workedSeconds: 50,
    });
  });

  it('keeps a finished job’s clock cleared and refuses resume on it', async () => {
    const s = await setting();
    const job = await running(s);
    await stage(job.id, 'start', s.hand);
    await stage(job.id, 'finish', s.hand);
    const before = await reread(job.id);

    const res = await stage(job.id, 'resume', s.hand);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await reread(job.id)).toMatchObject({
      inWorkSince: null,
      workedSeconds: before.workedSeconds,
    });
  });

  it('pauses a job in work whose clock was never filled without losing or inventing time', async () => {
    const s = await setting();
    const job = await running(s, 'in_work');
    await prisma.job.update({
      data: { inWorkSince: null, workedSeconds: 7 },
      where: { id: job.id },
    });

    const res = await stage(job.id, 'pause', s.hand);

    expect(res.status).toBe(200);
    expect(await reread(job.id)).toMatchObject({
      inWorkSince: null,
      workedSeconds: 7,
    });
  });

  it('adds three spells in work to the whole seconds of each', async () => {
    const s = await setting();
    const job = await running(s);
    for (const ms of [10_900, 20_900, 30_900]) {
      await stage(job.id, 'resume', s.hand).then(async (r) =>
        r.status === 200 ? r : stage(job.id, 'start', s.hand),
      );
      await ago(job.id, ms);
      await stage(job.id, 'pause', s.hand);
    }

    expect((await reread(job.id)).workedSeconds).toBe(10 + 20 + 30);
  });

  it('starts two jobs of one mechanic at once and leaves one in work with the other paused', async () => {
    const s = await setting();
    const one = await running(s);
    const two = await running(s);

    const [a, b] = await Promise.all([
      stage(one.id, 'start', s.hand),
      stage(two.id, 'start', s.hand),
    ]);

    const jobs = [await reread(one.id), await reread(two.id)];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(jobs.map((j) => j.status).sort()).toEqual(['in_work', 'paused']);
    const open = jobs.filter((j) => j.status === 'in_work');
    expect(open).toHaveLength(1);
    expect(open[0].inWorkSince).toEqual(expect.any(Date));
    expect(jobs.find((j) => j.status === 'paused')?.inWorkSince).toBeNull();
  });

  it('shows the same clock on the job list and on the single read', async () => {
    const s = await setting();
    const job = await running(s);
    const idle = await running(s);
    await stage(job.id, 'start', s.hand);
    const { inWorkSince } = await reread(job.id);

    const list = await get('/garage/jobs', s.owner);
    const one = await get(`/garage/jobs/${job.id}`, s.owner);

    const rows: { id: string; inWorkSince: string | null }[] =
      list.body.items ?? list.body;
    expect(rows.find((r) => r.id === job.id)?.inWorkSince).toBe(
      inWorkSince?.toISOString(),
    );
    expect(rows.find((r) => r.id === idle.id)?.inWorkSince).toBeNull();
    expect(one.body.inWorkSince).toBe(inWorkSince?.toISOString());
  });

  it('does not touch the clock when a refused stage call is made by a stranger', async () => {
    const s = await setting();
    const job = await running(s);
    await stage(job.id, 'start', s.hand);
    const before = await reread(job.id);
    const stranger = bearer(
      await world.account('Pe Alt', ['driver']),
      'driver',
    );

    const res = await stage(job.id, 'pause', stranger);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await reread(job.id)).toMatchObject({
      inWorkSince: before.inWorkSince,
      status: 'in_work',
    });
  });
});
