import { randomUUID } from 'node:crypto';

import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

async function setting(status: JobStatus = 'in_work') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    status,
    { mechanicId: dinamo.plainMechanic.id },
  );
  const other = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    status,
    { mechanicId: dinamo.plainMechanic.id },
  );
  return {
    desk: bearer(dinamo.receptionist, 'receptionist'),
    dinamo,
    hand: bearer(dinamo.plain, 'mechanic'),
    job,
    other,
    otherSteps: `/garage/jobs/${other.id}/steps`,
    owner: bearer(dinamo.owner, 'garage'),
    steps: `/garage/jobs/${job.id}/steps`,
  };
}
type Setting = Awaited<ReturnType<typeof setting>>;

let keys = 0;
const add = (path: string, auth: string, text: unknown, key?: string) =>
  send('post', path, auth, { text } as object, {
    'Idempotency-Key': key ?? `h${++keys}`,
  });

async function seed(jobId: string, count: number) {
  const have = await prisma.jobStep.count({ where: { jobId } });
  await prisma.jobStep.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      jobId,
      label: `Pas ${have + i + 1}`,
      position: have + i + 1,
    })),
  });
  return written(jobId);
}

const written = (jobId: string) =>
  prisma.jobStep.findMany({ orderBy: { position: 'asc' }, where: { jobId } });

const positions = async (jobId: string) =>
  (await written(jobId)).map((r) => r.position);

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({ where: { subjectId } });

describe('reordering with an order that is not the steps', () => {
  const mismatch = (s: Setting) => [
    ['an id twice', (ids: string[]) => [ids[0], ids[0], ids[2]]],
    ['a step left out', (ids: string[]) => [ids[2], ids[0]]],
    ['an unknown step', (ids: string[]) => [ids[0], ids[1], randomUUID()]],
    ['a step of another job', (ids: string[]) => [ids[0], ids[1], s.other.id]],
    ['an empty list', () => []],
  ];

  it.each([0, 1, 2, 3, 4])('refuses the mismatch number %i', async (n) => {
    const s = await setting();
    const rows = await seed(s.job.id, 3);
    const ids = rows.map((r) => r.id);
    const [, build] = mismatch(s)[n] as [string, (i: string[]) => string[]];

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: build(ids),
    });

    expect(res.status).toBe(400);
    expect((await written(s.job.id)).map((r) => r.id)).toEqual(ids);
  });

  it('names a valid but incomplete list not_a_permutation', async () => {
    const s = await setting();
    const [a, b] = await seed(s.job.id, 3);

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: [b.id, a.id],
    });

    expect(res.body.errors).toEqual([
      expect.objectContaining({ code: 'not_a_permutation', field: 'stepIds' }),
    ]);
  });

  it('refuses a step that was removed a moment ago', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 3);
    await send('delete', `${s.steps}/${rows[1].id}`, s.owner);

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: rows.map((r) => r.id),
    });

    expect(res.status).toBe(400);
    expect(await positions(s.job.id)).toEqual([1, 2]);
  });

  it('refuses 21 ids and ids that are not uuids', async () => {
    const s = await setting();
    await seed(s.job.id, 20);

    const many = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: Array.from({ length: 21 }, () => randomUUID()),
    });
    const junk = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: ['1', 'two'],
    });
    const nil = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: [null],
    });

    expect([many.status, junk.status, nil.status]).toEqual([400, 400, 400]);
  });

  it('reorders a full job of 20 and leaves positions 1 to 20', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 20);

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: rows.map((r) => r.id).reverse(),
    });

    expect(res.status).toBe(204);
    expect(await positions(s.job.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect((await written(s.job.id))[0].id).toBe(rows[19].id);
  });

  it('accepts the order it already has and answers 204', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 2);

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: rows.map((r) => r.id),
    });

    expect(res.status).toBe(204);
  });
});

describe('the words of a step', () => {
  it.each([
    ['two characters', 'ab'],
    ['romanian letters', 'Ștergere și țevi'],
    ['inner spaces kept', 'a   b'],
    ['eighty characters among padding', `  ${'z'.repeat(80)}  `],
  ])('takes %s', async (_name, text) => {
    const s = await setting();

    const res = await add(s.steps, s.owner, text);

    expect(res.status).toBe(201);
    expect(res.body.label).toBe(text.trim());
    expect(res.body.customerLabel).toBe(text.trim());
  });

  it.each([
    ['tabs and new lines around', '\t\n Pas bun \r\n', 'Pas bun'],
    ['non-breaking spaces around', '  Pas bun ', 'Pas bun'],
  ])('trims %s', async (_name, text, expected) => {
    const s = await setting();
    const [row] = await seed(s.job.id, 1);

    const added = await add(s.steps, s.owner, text);
    const renamed = await send('patch', `${s.steps}/${row.id}`, s.owner, {
      text,
    });

    expect(added.body.label).toBe(expected);
    expect(renamed.body).toMatchObject({
      customerLabel: expected,
      label: expected,
    });
  });

  it.each([
    ['only non-breaking spaces', '   '],
    ['only new lines', '\n\n\n'],
    ['one character padded', '   a   '],
    ['eighty one after trimming', ` ${'z'.repeat(81)} `],
    ['empty', ''],
  ])('refuses %s', async (_name, text) => {
    const s = await setting();

    const res = await add(s.steps, s.owner, text);

    expect(res.status).toBe(400);
    expect(await written(s.job.id)).toHaveLength(0);
  });

  it.each([[null], [undefined], [['Pas bun']], [{ a: 1 }], [true]])(
    'refuses the text %j that is not a string',
    async (text) => {
      const s = await setting();
      const [row] = await seed(s.job.id, 1);

      const added = await add(s.steps, s.owner, text);
      const renamed = await send('patch', `${s.steps}/${row.id}`, s.owner, {
        text,
      } as object);

      expect([added.status, renamed.status]).toEqual([400, 400]);
      expect((await written(s.job.id)).map((r) => r.label)).toEqual(['Pas 1']);
    },
  );

  it('refuses an array in place of the body', async () => {
    const s = await setting();

    const res = await send(
      'post',
      s.steps,
      s.owner,
      [{ text: 'Pas bun' }] as unknown as object,
      { 'Idempotency-Key': 'arr' },
    );

    expect(res.status).toBe(400);
  });

  it('renames a step to the words it already has and keeps it where it is', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 3);

    const res = await send('patch', `${s.steps}/${rows[1].id}`, s.owner, {
      text: 'Pas 2',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: rows[1].id, position: 2 });
  });

  it('keeps the tick on a step that is renamed', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 1);
    await send('put', `${s.steps}/${row.id}/done`, s.owner, { done: true });

    const res = await send('patch', `${s.steps}/${row.id}`, s.owner, {
      text: 'Alt nume',
    });

    expect(res.body.doneBy).toBe(s.dinamo.owner);
    expect(res.body.doneAt).not.toBeNull();
  });
});

describe('a resent add', () => {
  it('answers the first step even when the job has since reached 20', async () => {
    const s = await setting();
    const first = await add(s.steps, s.owner, 'Primul', 'resend');
    await seed(s.job.id, 19);

    const again = await add(s.steps, s.owner, 'Primul', 'resend');

    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await written(s.job.id)).toHaveLength(20);
  });

  it('answers the first step when the resend carries invalid text of its own', async () => {
    const s = await setting();
    const first = await add(s.steps, s.owner, 'Primul', 'resend');

    const again = await add(s.steps, s.owner, 'x', 'resend');

    expect([again.status, again.body.id]).toEqual([400, undefined]);
    expect(await written(s.job.id)).toHaveLength(1);
    expect(first.status).toBe(201);
  });

  it('does not hand a step of one job to the same key sent to another', async () => {
    const s = await setting();
    const first = await add(s.steps, s.owner, 'Primul', 'shared');

    const second = await add(s.otherSteps, s.owner, 'Al doilea', 'shared');

    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await written(s.other.id)).toHaveLength(1);
  });

  it('takes a key of 64 characters and refuses an empty one', async () => {
    const s = await setting();

    const ok = await add(s.steps, s.owner, 'Pas bun', 'k'.repeat(64));
    const empty = await add(s.steps, s.owner, 'Pas bun', '');

    expect([ok.status, empty.status]).toEqual([201, 400]);
    expect(await written(s.job.id)).toHaveLength(1);
  });

  it('makes one step and one event of ten simultaneous sends', async () => {
    const s = await setting();

    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        add(s.steps, s.owner, 'Primul', 'burst'),
      ),
    );

    expect(new Set(answers.map((a) => a.status))).toEqual(new Set([201]));
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect(await written(s.job.id)).toHaveLength(1);
    expect(await events(s.job.id)).toHaveLength(1);
  });
});

describe('simultaneous writes', () => {
  it('stops at 20 steps when 25 adds arrive together', async () => {
    const s = await setting();

    const answers = await Promise.all(
      Array.from({ length: 25 }, (_, i) => add(s.steps, s.owner, `Pas ${i}x`)),
    );

    const codes = answers.map((a) => a.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(20);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect(await positions(s.job.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('closes the gaps when several steps are removed together', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 6);

    const answers = await Promise.all(
      [0, 2, 3, 5].map((i) =>
        send('delete', `${s.steps}/${rows[i].id}`, s.owner),
      ),
    );

    expect(answers.map((a) => a.status)).toEqual([204, 204, 204, 204]);
    expect(await positions(s.job.id)).toEqual([1, 2]);
    expect((await written(s.job.id)).map((r) => r.label)).toEqual([
      'Pas 2',
      'Pas 5',
    ]);
  });

  it('applies an add and a removal together without a gap or a clash', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 3);

    await Promise.all([
      add(s.steps, s.owner, 'Nou pas'),
      send('delete', `${s.steps}/${rows[0].id}`, s.owner),
      add(s.steps, s.owner, 'Alt pas'),
    ]);

    expect(await positions(s.job.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('removing a step', () => {
  it('answers 404 to the second removal of the same step', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 2);

    const first = await send('delete', `${s.steps}/${row.id}`, s.owner);
    const second = await send('delete', `${s.steps}/${row.id}`, s.owner);

    expect([first.status, second.status]).toEqual([204, 404]);
    expect(await positions(s.job.id)).toEqual([1]);
  });

  it('lets an add take the next place after the last step is removed', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 1);
    await send('delete', `${s.steps}/${row.id}`, s.owner);

    const res = await add(s.steps, s.owner, 'Pas nou');

    expect(res.body.position).toBe(1);
  });

  it('frees a place on a job at 20', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 20);
    await send('delete', `${s.steps}/${rows[7].id}`, s.owner);

    const res = await add(s.steps, s.owner, 'Pas nou');

    expect([res.status, res.body.position]).toEqual([201, 20]);
  });
});

describe('ticking', () => {
  it('keeps the first person and time when someone else ticks it again', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 1);
    const path = `${s.steps}/${row.id}/done`;
    const first = await send('put', path, s.hand, { done: true });

    const again = await send('put', path, s.owner, { done: true });

    expect(again.status).toBe(200);
    expect(again.body.doneBy).toBe(s.dinamo.plain);
    expect(again.body.doneAt).toBe(first.body.doneAt);
    expect(
      (await events(s.job.id)).filter((e) => e.kind === 'job.step_done'),
    ).toHaveLength(1);
  });

  it('answers an untick of an open step as it is and records nothing', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 1);

    const res = await send('put', `${s.steps}/${row.id}/done`, s.owner, {
      done: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ doneAt: null, doneBy: null });
    expect(await events(s.job.id)).toHaveLength(0);
  });

  it('refuses an untick while the job has not started', async () => {
    const s = await setting('to_do');
    const [row] = await seed(s.job.id, 1);
    await prisma.jobStep.update({
      data: { doneAt: new Date() },
      where: { id: row.id },
    });

    const res = await send('put', `${s.steps}/${row.id}/done`, s.owner, {
      done: false,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('job_not_started');
    expect(
      (await prisma.jobStep.findUniqueOrThrow({ where: { id: row.id } }))
        .doneAt,
    ).not.toBeNull();
  });

  it('ignores an Idempotency-Key, so one key ticks two steps', async () => {
    const s = await setting();
    const [a, b] = await seed(s.job.id, 2);

    const one = await send(
      'put',
      `${s.steps}/${a.id}/done`,
      s.owner,
      { done: true },
      { 'Idempotency-Key': 'tick' },
    );
    const two = await send(
      'put',
      `${s.steps}/${b.id}/done`,
      s.owner,
      { done: true },
      { 'Idempotency-Key': 'tick' },
    );

    expect([one.body.id, two.body.id]).toEqual([a.id, b.id]);
    expect(two.body.doneAt).not.toBeNull();
  });

  it('ticks a step while the job is paused and leaves the stage alone', async () => {
    const s = await setting('paused');
    const [row] = await seed(s.job.id, 1);

    const res = await send('put', `${s.steps}/${row.id}/done`, s.hand, {
      done: true,
    });

    expect(res.status).toBe(200);
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: s.job.id } })).status,
    ).toBe('paused');
  });

  it.each([[{ done: null }], [{}], [{ done: 1 }], [{ done: 'true' }]])(
    'refuses the body %j',
    async (body) => {
      const s = await setting();
      const [row] = await seed(s.job.id, 1);

      const res = await send('put', `${s.steps}/${row.id}/done`, s.owner, body);

      expect(res.status).toBe(400);
      expect(
        (await prisma.jobStep.findUniqueOrThrow({ where: { id: row.id } }))
          .doneAt,
      ).toBeNull();
    },
  );

  it('counts the ticked steps in the list and the job', async () => {
    const s = await setting();
    const rows = await seed(s.job.id, 3);
    await send('put', `${s.steps}/${rows[0].id}/done`, s.owner, { done: true });
    await send('put', `${s.steps}/${rows[2].id}/done`, s.hand, { done: true });
    await send('delete', `${s.steps}/${rows[0].id}`, s.owner);

    const list = await get('/garage/jobs', s.owner);
    const detail = await get(`/garage/jobs/${s.job.id}`, s.owner);

    const item = list.body.items.find((i: { id: string }) => i.id === s.job.id);
    expect([item.stepsDone, item.stepsTotal]).toEqual([1, 2]);
    expect([detail.body.stepsDone, detail.body.stepsTotal]).toEqual([1, 2]);
    expect(
      detail.body.steps.map((x: { position: number }) => x.position),
    ).toEqual([1, 2]);
  });
});

describe('who is refused first', () => {
  it('answers a receptionist 403, not 409, on a job not started or closed', async () => {
    for (const status of ['to_do', 'done'] as const) {
      const s = await setting(status);
      const [row] = await seed(s.job.id, 1);

      const answers = [
        await send('put', `${s.steps}/${row.id}/done`, s.desk, { done: true }),
        await add(s.steps, s.desk, 'Pas bun'),
        await send('delete', `${s.steps}/${row.id}`, s.desk),
      ];

      expect(answers.map((a) => a.status)).toEqual([403, 403, 403]);
    }
  });

  it('answers a mechanic taken off the job 403 on every write', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 2);
    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    const answers = [
      await add(s.steps, s.hand, 'Pas bun'),
      await send('patch', `${s.steps}/${row.id}`, s.hand, { text: 'Altul' }),
      await send('put', `${s.steps}/${row.id}/done`, s.hand, { done: true }),
    ];

    expect(answers.map((a) => a.status)).toEqual([403, 403, 403]);
  });

  it('lets a receptionist read the steps she may not write', async () => {
    const s = await setting();
    await seed(s.job.id, 2);

    const res = await get(`/garage/jobs/${s.job.id}`, s.desk);

    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(2);
  });

  it('answers a visitor 401 on every write', async () => {
    const s = await setting();
    const [row] = await seed(s.job.id, 1);
    const base = s.steps;
    const call = (method: 'post' | 'patch' | 'put' | 'delete', path: string) =>
      send(method, path, 'Bearer nonsense', { done: true, text: 'Pas' });

    const answers = [
      await call('post', base),
      await call('patch', `${base}/${row.id}`),
      await call('put', `${base}/order`),
      await call('delete', `${base}/${row.id}`),
      await call('put', `${base}/${row.id}/done`),
    ];

    expect(answers.map((a) => a.status)).toEqual([401, 401, 401, 401, 401]);
    expect(await written(s.job.id)).toHaveLength(1);
  });
});

describe('a closed job and the body', () => {
  it('refuses a malformed body with 400 whatever the job state', async () => {
    const s = await setting('cancelled');

    const res = await add(s.steps, s.owner, 'x');

    expect(res.status).toBe(400);
    expect(await written(s.job.id)).toHaveLength(0);
  });

  it('writes no event or audit entry for a refused write', async () => {
    const s = await setting('done');
    const [row] = await seed(s.job.id, 2);
    const before = await prisma.activityLog.count();

    await add(s.steps, s.owner, 'Pas bun');
    await send('delete', `${s.steps}/${row.id}`, s.owner);
    await send('put', `${s.steps}/${row.id}/done`, s.owner, { done: true });

    expect(await events(s.job.id)).toHaveLength(0);
    expect(await prisma.activityLog.count()).toBe(before);
  });
});
