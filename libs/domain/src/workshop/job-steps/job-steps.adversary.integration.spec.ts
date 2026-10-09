import { randomUUID } from 'node:crypto';

import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, send, team, world } = quotesApp();
const { prisma } = world;

// Two garages, each with a job for its plain mechanic and one step on it.
async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const ours = await world.job(
    (await world.chain(andrei, dinamo.garage.id)).booking.id,
    'in_work',
    { mechanicId: dinamo.plainMechanic.id },
  );
  const theirs = await world.job(
    (await world.chain(andrei, militari.garage.id)).booking.id,
    'in_work',
    { mechanicId: militari.plainMechanic.id },
  );
  const [ourStep, theirStep] = await Promise.all(
    [ours, theirs].map((job) =>
      prisma.jobStep.create({
        data: { jobId: job.id, label: 'Etriere demontate', position: 1 },
      }),
    ),
  );
  return { dinamo, militari, ourStep, ours, theirStep, theirs };
}

// @traces 424-FR-002 424-FR-003 424-FR-005
describe('job steps, from the outside', () => {
  it('will not reach another job’s step through this job’s address', async () => {
    const s = await setting();
    const owner = bearer(s.dinamo.owner, 'garage');
    const path = `/garage/jobs/${s.ours.id}/steps/${s.theirStep.id}`;

    const answers = [
      await send('patch', path, owner, { text: 'Furat' }),
      await send('delete', path, owner),
      await send('put', `${path}/done`, owner, { done: true }),
    ];

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404]);
    expect(
      await prisma.jobStep.findUniqueOrThrow({ where: { id: s.theirStep.id } }),
    ).toMatchObject({ doneAt: null, label: 'Etriere demontate' });
  });

  it('will not let a mechanic write the job of another garage', async () => {
    const s = await setting();
    const hand = bearer(s.dinamo.plain, 'mechanic');
    const steps = `/garage/jobs/${s.theirs.id}/steps`;

    const answers = [
      await send(
        'post',
        steps,
        hand,
        { text: 'Pas' },
        { 'Idempotency-Key': 'a' },
      ),
      await send('put', `${steps}/${s.theirStep.id}/done`, hand, {
        done: true,
      }),
      await send('put', `${steps}/order`, hand, { stepIds: [s.theirStep.id] }),
    ];

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404]);
    expect(await prisma.jobStep.count({ where: { jobId: s.theirs.id } })).toBe(
      1,
    );
  });

  it.each([
    ['post', 'not-a-uuid/steps'],
    ['patch', `${randomUUID()}/steps/not-a-uuid`],
    ['delete', `${randomUUID()}/steps/not-a-uuid`],
    ['put', `${randomUUID()}/steps/not-a-uuid/done`],
  ] as const)('answers 400 to a malformed id: %s %s', async (method, path) => {
    const s = await setting();

    const res = await send(
      method,
      `/garage/jobs/${path}`,
      bearer(s.dinamo.owner, 'garage'),
      method === 'delete' ? undefined : { done: true, text: 'Pas bun' },
      { 'Idempotency-Key': 'k' },
    );

    expect(res.status).toBe(400);
  });

  it('reads `order` as the order, never as a step id', async () => {
    const s = await setting();

    const res = await send(
      'put',
      `/garage/jobs/${s.ours.id}/steps/order`,
      bearer(s.dinamo.owner, 'garage'),
      { stepIds: [s.ourStep.id] },
    );

    expect(res.status).toBe(204);
  });

  it.each([
    [{ extra: true, text: 'Pas bun' }],
    [{ text: 42 }],
    [{ stepIds: 'all' }],
    [{ done: 'yes' }],
  ])('refuses an unexpected body %j', async (body) => {
    const s = await setting();
    const owner = bearer(s.dinamo.owner, 'garage');
    const steps = `/garage/jobs/${s.ours.id}/steps`;

    const res =
      'stepIds' in body
        ? await send('put', `${steps}/order`, owner, body)
        : 'done' in body
          ? await send('put', `${steps}/${s.ourStep.id}/done`, owner, body)
          : await send('post', steps, owner, body, { 'Idempotency-Key': 'b' });

    expect(res.status).toBe(400);
    expect(await prisma.jobStep.count({ where: { jobId: s.ours.id } })).toBe(1);
  });
});
