import { ReviewsModule } from './reviews.module';
import { quotesApp } from '../quotes/quotes-api.testing';

// @traces 154-FR-015

const { bearer, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;

// Andrei's finished job at Atelier Dinamo, his e-mail confirmed.
async function setting(mechanic: boolean) {
  const andrei = await world.account('Andrei Marin', ['driver']);
  await prisma.account.update({
    data: { email: `${andrei}@example.ro`, emailVerifiedAt: new Date() },
    where: { id: andrei },
  });
  const dinamo = await team('Atelier Dinamo');
  const { booking } = await world.chain(andrei, dinamo.garage.id);
  const job = await world.job(booking.id, 'done', {
    mechanicId: mechanic ? dinamo.plainMechanic.id : undefined,
  });
  return { as: bearer(andrei, 'driver'), dinamo, job };
}

describe("a posted review on the garage's public page", () => {
  it.each([
    ['names a mechanic', true],
    ['names no mechanic', false],
  ])(
    'leaves a review.posted row for the public page when the job %s',
    async (_, mechanic) => {
      const s = await setting(mechanic);

      const posted = await send('post', '/reviews', s.as, {
        jobId: s.job.id,
        rating: 5,
      });

      expect(posted.status).toBe(201);
      const rows = await prisma.outboxEvent.findMany({
        where: { kind: 'review.posted', subjectId: posted.body.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.audience).toContain(
        `public:garage:${s.dinamo.garage.id}`,
      );
    },
  );
});
