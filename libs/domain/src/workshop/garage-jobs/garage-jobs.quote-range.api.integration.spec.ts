import { quotesApp } from '../../quotes/quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

// One garage's job, the plain mechanic's, booked from a quote of the given
// bounds, and a second garage to read it from.
async function setting(fromBani: number, toBani: number) {
  const driver = await world.account('Andrei Marin');
  const dinamo = await team('Atelier Dinamo');
  const militari = await team('Service Militari');
  const chain = await world.chain(driver, dinamo.garage.id);
  await prisma.quote.update({
    data: { fromBani, toBani },
    where: { id: chain.quote.id },
  });
  const job = await world.job(chain.booking.id, 'done', {
    mechanicId: dinamo.plainMechanic.id,
  });
  return { dinamo, job, militari };
}

// @traces 1404-FR-001
// @traces 1404-FR-002
// @traces 1404-FR-006
describe('the accepted quote’s range on GET /garage/jobs/:id', () => {
  it('gives the owner, the receptionist and the job’s mechanic the quote’s bounds', async () => {
    const s = await setting(89_000, 140_000);

    for (const auth of [
      bearer(s.dinamo.owner, 'garage'),
      bearer(s.dinamo.receptionist, 'receptionist'),
      bearer(s.dinamo.plain, 'mechanic'),
    ]) {
      const res = await get(`/garage/jobs/${s.job.id}`, auth);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        finalPriceBani: null,
        id: s.job.id,
        quoteFromBani: 89_000,
        quoteToBani: 140_000,
      });
      expect(res.body.steps).toEqual([]);
      expect(res.body.stages).toEqual([]);
    }
  });

  it('gives both bounds when the quote names one amount', async () => {
    const s = await setting(120_000, 120_000);

    const res = await get(
      `/garage/jobs/${s.job.id}`,
      bearer(s.dinamo.owner, 'garage'),
    );

    expect(res.body.quoteFromBani).toBe(120_000);
    expect(res.body.quoteToBani).toBe(120_000);
  });

  it('keeps refusing another garage and another mechanic', async () => {
    const s = await setting(89_000, 140_000);

    const other = await get(
      `/garage/jobs/${s.job.id}`,
      bearer(s.militari.owner, 'garage'),
    );
    const fixer = await get(
      `/garage/jobs/${s.job.id}`,
      bearer(s.dinamo.answering, 'mechanic'),
    );

    expect(other.status).toBe(404);
    expect(other.body).not.toHaveProperty('quoteToBani');
    expect(fixer.status).toBe(403);
    expect(fixer.body).not.toHaveProperty('quoteToBani');
  });
});

// @traces 1404-FR-003
describe('the garage’s job list', () => {
  it('carries no quote bounds on its items', async () => {
    const s = await setting(89_000, 140_000);

    const res = await get('/garage/jobs', bearer(s.dinamo.owner, 'garage'));

    expect(res.body.items.map((i: { id: string }) => i.id)).toContain(s.job.id);
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('quoteFromBani');
      expect(item).not.toHaveProperty('quoteToBani');
    }
  });
});
