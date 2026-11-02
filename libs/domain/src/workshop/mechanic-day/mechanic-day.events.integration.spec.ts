import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, send, team, world } = quotesApp();
const { prisma } = world;

// A confirmed booking of the plain mechanic at Atelier Dinamo with its job.
async function setting() {
  const andrei = await world.account('Andrei Marin', ['driver']);
  const dinamo = await team('Atelier Dinamo');
  const mechanicId = dinamo.plainMechanic.id;
  const bookedJob = async () => {
    const { booking } = await world.chain(andrei, dinamo.garage.id);
    await prisma.booking.update({
      data: { mechanicId },
      where: { id: booking.id },
    });
    const job = await world.job(booking.id, 'to_do', { mechanicId });
    return { booking, job };
  };
  return {
    andrei,
    bookedJob,
    dinamo,
    hand: bearer(dinamo.plain, 'mechanic'),
    mechanicId,
    owner: bearer(dinamo.owner, 'garage'),
  };
}

// @traces 122-FR-011
describe('the mechanic’s channel', () => {
  it('hears every job and booking event of the mechanic’s jobs, and no other mechanic does', async () => {
    const s = await setting();
    const first = await s.bookedJob();
    const second = await s.bookedJob();
    const cancelled = await s.bookedJob();
    const stage = (jobId: string, verb: string, auth = s.hand) =>
      send('post', `/garage/jobs/${jobId}/${verb}`, auth);

    const receive = (jobId: string) =>
      send('post', `/garage/jobs/${jobId}/receive`, s.owner, {
        odometerKm: 86_500,
      });

    const answers = [
      await receive(first.job.id),
      await receive(second.job.id),
      await stage(first.job.id, 'start'),
      await stage(second.job.id, 'start', s.owner),
      await stage(second.job.id, 'pause'),
      await stage(first.job.id, 'resume'),
    ];
    const step = await send(
      'post',
      `/garage/jobs/${first.job.id}/steps`,
      s.owner,
      { text: 'Filtru de ulei' },
      { 'Idempotency-Key': 'step-1' },
    );
    answers.push(
      step,
      await send(
        'put',
        `/garage/jobs/${first.job.id}/steps/${step.body.id}/done`,
        s.hand,
        { done: true },
      ),
      await stage(first.job.id, 'finish'),
      await send('post', `/garage/jobs/${first.job.id}/handover`, s.owner, {
        finalPriceBani: 115_000,
      }),
      await send('patch', `/garage/jobs/${first.job.id}/final-price`, s.owner, {
        finalPriceBani: 110_000,
      }),
      await send(
        'post',
        `/bookings/${cancelled.booking.id}/cancel`,
        bearer(s.andrei, 'driver'),
        { reason: 'found_another_garage' },
      ),
    );

    expect(answers.map((res) => res.status < 300 || res.body)).toEqual(
      answers.map(() => true),
    );
    const rows = await prisma.outboxEvent.findMany({
      orderBy: { id: 'asc' },
      where: {
        OR: [
          { kind: { startsWith: 'job.' } },
          { kind: { startsWith: 'booking.' } },
        ],
        subjectId: {
          in: [first, second, cancelled].flatMap((b) => [
            b.booking.id,
            b.job.id,
          ]),
        },
      },
    });
    expect(new Set(rows.map((row) => row.kind))).toEqual(
      new Set([
        'booking.cancelled',
        'booking.completed',
        'job.done',
        'job.final_price_corrected',
        'job.handed_over',
        'job.paused',
        'job.received',
        'job.resumed',
        'job.started',
        'job.step_done',
        'job.steps_changed',
      ]),
    );
    const mine = `mechanic:${s.mechanicId}`;
    const theirs = `mechanic:${s.dinamo.answeringMechanic.id}`;
    expect(
      rows.filter(
        (row) => !row.audience.includes(mine) || row.audience.includes(theirs),
      ),
    ).toEqual([]);
  });
});
