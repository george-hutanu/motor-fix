import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { outbox } from '../../events/event.port';
import type { JobStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, send, team, world } = quotesApp();
const { prisma } = world;

// One job at Atelier Dinamo, the plain mechanic's, and a second garage.
async function setting(status: JobStatus = 'to_do') {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const job = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    status,
    { mechanicId: dinamo.plainMechanic.id },
  );
  const owner = bearer(dinamo.owner, 'garage');
  const hand = bearer(dinamo.plain, 'mechanic');
  const steps = `/garage/jobs/${job.id}/steps`;
  return { andrei, dinamo, hand, job, militari, owner, steps };
}

let keys = 0;
const add = (path: string, auth: string, text: string, key?: string) =>
  send(
    'post',
    path,
    auth,
    { text },
    { 'Idempotency-Key': key ?? `k${++keys}` },
  );

async function written(jobId: string) {
  return prisma.jobStep.findMany({
    orderBy: { position: 'asc' },
    where: { jobId },
  });
}

const events = (subjectId: string) =>
  prisma.outboxEvent.findMany({ orderBy: { id: 'asc' }, where: { subjectId } });

const audits = (jobId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { jobId } });

const FIVE = [
  'Mașina pe elevator, roțile jos',
  'Etriere demontate',
  'Discuri și plăcuțe noi',
  'Lichid verificat și aerisit',
  'Probă pe drum',
];

async function five(s: Awaited<ReturnType<typeof setting>>) {
  const ids: string[] = [];
  for (const text of FIVE)
    ids.push((await add(s.steps, s.owner, text)).body.id);
  return ids;
}

// @traces 424-FR-002 424-FR-003 424-FR-004
// @traces 424-FR-005 424-FR-009 424-FR-010
describe('writing a job’s steps', () => {
  it('adds steps at the end, trimmed, in both labels, with one event and audit entry each', async () => {
    const s = await setting();

    const first = await add(s.steps, s.hand, `  ${FIVE[0]}  `);
    for (const text of FIVE.slice(1)) await add(s.steps, s.hand, text);

    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      customerLabel: FIVE[0],
      doneAt: null,
      doneBy: null,
      id: expect.any(String),
      label: FIVE[0],
      position: 1,
    });
    const rows = await written(s.job.id);
    expect(rows.map((r) => [r.position, r.label, r.customerLabel])).toEqual(
      FIVE.map((t, i) => [i + 1, t, t]),
    );
    const kinds = (await events(s.job.id)).map((e) => e.kind);
    expect(kinds).toEqual(Array(5).fill('job.steps_changed'));
    const entries = await audits(s.job.id);
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: s.dinamo.plain,
      actorRole: 'mechanic',
      garageId: s.dinamo.garage.id,
      isKeyChange: false,
      newValue: FIVE[0],
      subjectType: 'job_step',
    });
  });

  it('answers a resent add with the step it first made', async () => {
    const s = await setting();

    const one = await add(s.steps, s.owner, 'Etriere demontate', 'same');
    const two = await add(s.steps, s.owner, 'Alt text', 'same');

    expect(two.status).toBe(201);
    expect(two.body).toEqual(one.body);
    expect(await written(s.job.id)).toHaveLength(1);
    expect(await events(s.job.id)).toHaveLength(1);
  });

  it.each([[undefined], ['x'.repeat(65)]])(
    'refuses an add whose Idempotency-Key is %s',
    async (key) => {
      const s = await setting();

      const res = await send(
        'post',
        s.steps,
        s.owner,
        { text: 'Probă pe drum' },
        key === undefined ? {} : { 'Idempotency-Key': key },
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'validation_failed',
        errors: [{ code: 'required', field: 'idempotency-key' }],
      });
    },
  );

  it.each([['x'], ['x'.repeat(81)], ['      '], ['  a  ']])(
    'refuses the text %j',
    async (text) => {
      const s = await setting();
      const [id] = await five(s);

      const added = await add(s.steps, s.owner, text);
      const renamed = await send('patch', `${s.steps}/${id}`, s.owner, {
        text,
      });

      // The API's problem filter names it validation_failed (apps/api).
      expect([added.status, renamed.status]).toEqual([400, 400]);
      expect(await written(s.job.id)).toHaveLength(5);
    },
  );

  it('takes 80 characters, and refuses the 21st step', async () => {
    const s = await setting();
    await prisma.jobStep.createMany({
      data: Array.from({ length: 19 }, (_, i) => ({
        jobId: s.job.id,
        label: `Pas ${i + 1}`,
        position: i + 1,
      })),
    });

    expect((await add(s.steps, s.owner, 'y'.repeat(80))).status).toBe(201);
    const over = await add(s.steps, s.owner, 'Încă unul');

    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({
      code: 'too_many_steps',
      message: 'Cel mult 20 de pași',
    });
    expect(await written(s.job.id)).toHaveLength(20);
  });

  it('renames a step and records the old and the new words', async () => {
    const s = await setting();
    const [, id] = await five(s);

    const res = await send('patch', `${s.steps}/${id}`, s.hand, {
      text: 'Etriere scoase',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      customerLabel: 'Etriere scoase',
      id,
      label: 'Etriere scoase',
      position: 2,
    });
    const last = (await audits(s.job.id)).at(-1);
    expect(last).toMatchObject({
      action: 'update',
      field: 'label',
      newValue: 'Etriere scoase',
      oldValue: 'Etriere demontate',
      subjectId: id,
    });
    expect((await events(s.job.id)).at(-1)?.kind).toBe('job.steps_changed');
  });

  it('reorders every step in one go and records the order', async () => {
    const s = await setting();
    const ids = await five(s);
    const order = [ids[0], ids[1], ids[2], ids[4], ids[3]];

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: order,
    });

    expect(res.status).toBe(204);
    const rows = await written(s.job.id);
    expect(rows.map((r) => r.id)).toEqual(order);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    expect((await audits(s.job.id)).at(-1)).toMatchObject({
      field: 'steps_order',
      newValue: order,
      oldValue: ids,
      subjectType: 'job',
    });
  });

  it.each([
    ['misses one', (ids: string[]) => ids.slice(1)],
    ['repeats one', (ids: string[]) => [...ids.slice(1), ids[1]]],
    ['names another', (ids: string[]) => [...ids.slice(1), randomUUID()]],
  ])('refuses an order that %s', async (_name, order) => {
    const s = await setting();
    const ids = await five(s);

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: order(ids),
    });

    expect(res.status).toBe(400);
    expect((await written(s.job.id)).map((r) => r.id)).toEqual(ids);
  });

  it('names the order that is not every step once', async () => {
    const s = await setting();
    const ids = await five(s);

    const res = await send('put', `${s.steps}/order`, s.owner, {
      stepIds: ids.slice(1),
    });

    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'not_a_permutation', field: 'stepIds' }],
    });
  });

  it('removes a step, ticked or not, and closes the gap', async () => {
    const s = await setting('in_work');
    const ids = await five(s);
    await send('put', `${s.steps}/${ids[1]}/done`, s.owner, { done: true });

    const one = await send('delete', `${s.steps}/${ids[1]}`, s.owner);
    const two = await send('delete', `${s.steps}/${ids[3]}`, s.hand);

    expect([one.status, two.status]).toEqual([204, 204]);
    const rows = await written(s.job.id);
    expect(rows.map((r) => [r.id, r.position])).toEqual([
      [ids[0], 1],
      [ids[2], 2],
      [ids[4], 3],
    ]);
    expect((await audits(s.job.id)).at(-1)).toMatchObject({
      action: 'delete',
      oldValue: FIVE[3],
      subjectId: ids[3],
    });
  });

  it('keeps the positions 1 to n through adds, removals and moves', async () => {
    const s = await setting();
    const ids = await five(s);
    await send('delete', `${s.steps}/${ids[0]}`, s.owner);
    const sixth = (await add(s.steps, s.owner, 'Spălare')).body.id;
    await send('put', `${s.steps}/order`, s.owner, {
      stepIds: [sixth, ids[4], ids[3], ids[2], ids[1]],
    });
    await send('delete', `${s.steps}/${ids[3]}`, s.owner);

    const rows = await written(s.job.id);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.id)).toEqual([sixth, ids[4], ids[2], ids[1]]);
  });

  it('answers 404 to a step that is not on the job', async () => {
    const s = await setting();
    const [id] = await five(s);
    await send('delete', `${s.steps}/${id}`, s.owner);
    const other = await setting();
    const [elsewhere] = await five(other);

    for (const stepId of [id, elsewhere, randomUUID()]) {
      const res = await send('patch', `${s.steps}/${stepId}`, s.owner, {
        text: 'Altceva',
      });
      expect(res.status).toBe(404);
    }
  });
});

// @traces 424-FR-001 424-FR-006 424-FR-007
// @traces 424-FR-008 424-FR-010
describe('ticking a step', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stores who ticked it and when, and clears both on an untick', async () => {
    const s = await setting('in_work');
    const [, id] = await five(s);
    const before = Date.now();

    const ticked = await send('put', `${s.steps}/${id}/done`, s.hand, {
      done: true,
    });

    expect(ticked.status).toBe(200);
    expect(ticked.body).toMatchObject({ doneBy: s.dinamo.plain, id });
    expect(Date.parse(ticked.body.doneAt)).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect((await events(s.job.id)).at(-1)).toMatchObject({
      kind: 'job.step_done',
      payload: { stepId: id },
    });

    const unticked = await send('put', `${s.steps}/${id}/done`, s.owner, {
      done: false,
    });

    expect(unticked.body).toMatchObject({ doneAt: null, doneBy: null, id });
    const step = await prisma.jobStep.findUniqueOrThrow({ where: { id } });
    expect([step.doneAt, step.doneById]).toEqual([null, null]);
    expect((await events(s.job.id)).at(-1)?.kind).toBe('job.step_undone');
    expect((await audits(s.job.id)).at(-1)).toMatchObject({
      field: 'done_at',
      newValue: null,
      subjectId: id,
    });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: s.job.id } });
    expect(job.status).toBe('in_work');
  });

  it('changes nothing when a tick or an untick is sent again', async () => {
    const s = await setting('paused');
    const [id] = await five(s);
    await send('put', `${s.steps}/${id}/done`, s.owner, { done: true });
    const counted = [
      (await events(s.job.id)).length,
      (await audits(s.job.id)).length,
    ];
    const at = (await prisma.jobStep.findUniqueOrThrow({ where: { id } }))
      .doneAt;

    const again = await send('put', `${s.steps}/${id}/done`, s.hand, {
      done: true,
    });

    expect(again.status).toBe(200);
    expect(again.body.doneBy).toBe(s.dinamo.owner);
    expect(again.body.doneAt).toBe(at?.toISOString());
    expect([
      (await events(s.job.id)).length,
      (await audits(s.job.id)).length,
    ]).toEqual(counted);
  });

  it('refuses a tick before the job is started, but lets the steps be written', async () => {
    const s = await setting('to_do');
    const [id] = await five(s);

    const res = await send('put', `${s.steps}/${id}/done`, s.owner, {
      done: true,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'job_not_started',
      message: 'Pornește lucrarea mai întâi',
    });
    expect(
      (await prisma.jobStep.findUniqueOrThrow({ where: { id } })).doneAt,
    ).toBeNull();
  });

  it.each(['done', 'cancelled'] as const)(
    'refuses every step write once the job is %s',
    async (status) => {
      const s = await setting('in_work');
      const ids = await five(s);
      await prisma.job.update({ data: { status }, where: { id: s.job.id } });

      const answers = await Promise.all([
        add(s.steps, s.owner, 'Încă unul'),
        send('patch', `${s.steps}/${ids[0]}`, s.owner, { text: 'Altceva' }),
        send('put', `${s.steps}/order`, s.owner, {
          stepIds: [...ids].reverse(),
        }),
        send('delete', `${s.steps}/${ids[0]}`, s.owner),
        send('put', `${s.steps}/${ids[0]}/done`, s.owner, { done: true }),
      ]);

      for (const res of answers) {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('job_closed');
      }
      expect((await written(s.job.id)).map((r) => r.id)).toEqual(ids);
    },
  );

  it('applies two changes sent at the same moment, one after the other', async () => {
    const s = await setting('in_work');
    await five(s);

    const answers = await Promise.all([
      add(s.steps, s.owner, 'Spălare'),
      add(s.steps, s.hand, 'Aspirare'),
      add(s.steps, s.owner, 'Factură'),
    ]);

    expect(answers.map((a) => a.status)).toEqual([201, 201, 201]);
    const rows = await written(s.job.id);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps who ticked a step after the mechanic is taken off the job', async () => {
    const s = await setting('in_work');
    const [id] = await five(s);
    await send('put', `${s.steps}/${id}/done`, s.hand, { done: true });

    await prisma.job.update({
      data: { mechanicId: s.dinamo.answeringMechanic.id },
      where: { id: s.job.id },
    });

    const res = await get(`/garage/jobs/${s.job.id}`, s.owner);
    expect(res.body.steps[0].doneBy).toBe(s.dinamo.plain);
    const refused = await send('put', `${s.steps}/${id}/done`, s.hand, {
      done: false,
    });
    expect(refused.status).toBe(403);
  });

  // The change, its audit entry and its event are one write.
  it('leaves no tick, audit entry or event when the event cannot be written', async () => {
    const s = await setting('in_work');
    const [, id] = await five(s);
    const audited = (await audits(s.job.id)).length;
    const sent = (await events(s.job.id)).length;
    jest
      .spyOn(outbox, 'record')
      .mockRejectedValueOnce(new Error('outbox down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const refused = await send('put', `${s.steps}/${id}/done`, s.hand, {
      done: true,
    });

    expect(refused.status).toBe(500);
    const step = await prisma.jobStep.findUniqueOrThrow({ where: { id } });
    expect([step.doneAt, step.doneById]).toEqual([null, null]);
    expect(await audits(s.job.id)).toHaveLength(audited);
    expect(await events(s.job.id)).toHaveLength(sent);
  });
});

// @traces 424-FR-002
describe('who may write the steps', () => {
  // The five writes, one after the other, each on the job as it then is.
  async function everyWrite(
    s: Awaited<ReturnType<typeof setting>>,
    auth: string,
  ) {
    const [id, other] = await five(s);
    const answers = [
      await add(s.steps, auth, 'Încă unul'),
      await send('patch', `${s.steps}/${id}`, auth, { text: 'Altceva' }),
    ];
    const order = (await written(s.job.id)).map((r) => r.id).reverse();
    answers.push(
      await send('put', `${s.steps}/order`, auth, { stepIds: order }),
      await send('delete', `${s.steps}/${other}`, auth),
      await send('put', `${s.steps}/${id}/done`, auth, { done: true }),
    );
    return answers;
  }

  it('lets the owner and the job’s mechanic make every write', async () => {
    for (const who of ['owner', 'hand'] as const) {
      const s = await setting('in_work');
      const answers = await everyWrite(s, s[who]);
      expect(answers.map((a) => a.status)).toEqual([201, 200, 204, 204, 200]);
    }
  });

  it.each([
    ['the receptionist', 'receptionist', 'receptionist', 403],
    ['another mechanic of the garage', 'answering', 'mechanic', 403],
  ] as const)(
    'answers %s 403 on every write',
    async (_who, key, role, code) => {
      const s = await setting('in_work');

      const answers = await everyWrite(s, bearer(s.dinamo[key], role));

      expect(answers.map((a) => a.status)).toEqual(Array(5).fill(code));
      expect(answers[0].body.code).toBe('forbidden');
      expect(await written(s.job.id)).toHaveLength(5);
    },
  );

  it('answers 404 to another garage and to a driver', async () => {
    const s = await setting('in_work');
    const [id] = await five(s);

    for (const auth of [
      bearer(s.militari.owner, 'garage'),
      bearer(s.militari.plain, 'mechanic'),
      bearer(s.andrei, 'driver'),
    ]) {
      expect((await add(s.steps, auth, 'Încă unul')).status).toBe(404);
      expect(
        (await send('put', `${s.steps}/${id}/done`, auth, { done: true }))
          .status,
      ).toBe(404);
    }
    expect(
      (await add(`/garage/jobs/${randomUUID()}/steps`, s.owner, 'Pas')).status,
    ).toBe(404);
  });

  it('lets the owner write a job no mechanic holds', async () => {
    const s = await setting('in_work');
    await prisma.job.update({
      data: { mechanicId: null },
      where: { id: s.job.id },
    });

    expect((await add(s.steps, s.owner, 'Probă pe drum')).status).toBe(201);
    expect((await add(s.steps, s.hand, 'Probă pe drum')).status).toBe(403);
  });
});
