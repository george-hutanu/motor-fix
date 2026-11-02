import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, send, team, world } = quotesApp();
const { prisma } = world;

// @traces 395-FR-006
describe('two takes of a free job at the same moment', () => {
  it('leave exactly one holder and refuse the other', async () => {
    const andrei = await world.account('Andrei Marin', ['driver']);
    const dinamo = await team('Atelier Dinamo');
    const job = await world.job(
      (await world.chain(andrei, dinamo.garage.id)).booking.id,
      'to_do',
      { mechanicId: dinamo.plainMechanic.id },
    );
    const lock = `/garage/jobs/${job.id}/lock`;

    const answers = await Promise.all([
      send('post', lock, bearer(dinamo.owner, 'garage')),
      send('post', lock, bearer(dinamo.plain, 'mechanic')),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([200, 423]);
    const winner = answers.find((a) => a.status === 200)?.body.holder.accountId;
    expect(
      (await prisma.job.findUniqueOrThrow({ where: { id: job.id } }))
        .lockHolderId,
    ).toBe(winner);
  });
});
