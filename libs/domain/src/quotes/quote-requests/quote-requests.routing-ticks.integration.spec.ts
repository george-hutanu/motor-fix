import { randomUUID } from 'node:crypto';

import { AuditService } from '../../audit/audit.service';
import { writeGarageBrands } from '../../garages/garage-brands/write-garage-brands';
import { quotesApp } from '../quotes-api.testing';

const { bearer, post, team, world } = quotesApp();
const { prisma } = world;

const HOUR = 3_600_000;

// Atelier Dinamo listed with oil change and front brakes and the proposed
// "Reglaj faruri" on its price list, oil change unticked for the car's brand.
async function scene() {
  const driver = await world.account('Andrei Marin');
  const car = await world.car(driver);
  const oil = await world.jobType();
  const brakes = await world.jobType('Frâne față', 'Front brakes');
  const lights = await prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: 'Reglaj faruri',
      nameRo: 'Reglaj faruri',
      status: 'pending',
    },
  });
  const dinamo = await team('Atelier Dinamo');
  await prisma.$transaction((tx) =>
    writeGarageBrands(
      tx,
      dinamo.garage.id,
      {
        brands: [
          {
            brandId: car.brandId,
            name: 'Mini',
            stance: 'works_on',
            unticked: [oil.id],
          },
        ],
      },
      {
        actorId: dinamo.owner,
        audit: new AuditService(),
        jobs: [
          { jobTypeId: oil.id },
          { jobTypeId: brakes.id },
          { jobTypeId: lights.id, name: 'Reglaj faruri' },
        ],
      },
    ),
  );
  const ask = (jobTypeIds: string[]) =>
    post(
      '/quote-requests',
      {
        carId: car.id,
        description: 'Scârțâie la frânare pe față',
        garageIds: [dinamo.garage.id],
        jobTypeIds,
        sources: ['profile_direct'],
      },
      bearer(driver, 'driver'),
      randomUUID(),
    );
  return { ask, brakes, dinamo, lights, oil };
}

// @traces 412-FR-011
describe('routing a request by the jobs a garage ticked when it listed', () => {
  it('refuses the garage for a job it left unticked for the brand', async () => {
    const { ask, dinamo, oil } = await scene();

    const res = await ask([oil.id]);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'garage_cannot_receive',
      garageId: dinamo.garage.id,
      reason: 'jobs',
    });
  });

  it('sends the request when one asked job is ticked, and the quote leaves the unticked one out', async () => {
    const { ask, brakes, dinamo, oil } = await scene();

    const res = await ask([oil.id, brakes.id]);

    expect(res.status).toBe(201);
    const asked = await prisma.requestJob.findMany({
      select: { id: true, jobTypeId: true },
      where: { requestId: res.body.id },
    });
    const idOf = (jobTypeId: string) =>
      asked.find((j) => j.jobTypeId === jobTypeId)?.id;
    const quote = await post(
      '/quotes',
      {
        durationMinutes: 120,
        fromLei: 650,
        requestId: res.body.id,
        slot: new Date(Date.now() + 48 * HOUR).toISOString(),
        toLei: 800,
      },
      bearer(dinamo.owner, 'garage'),
      randomUUID(),
    );
    expect(quote.status).toBe(201);
    expect(quote.body.jobs).toEqual(
      expect.arrayContaining([
        { included: false, requestJobId: idOf(oil.id) },
        { included: true, requestJobId: idOf(brakes.id) },
      ]),
    );
  });

  it('keeps the ticks when a proposed job is approved', async () => {
    const { dinamo, lights } = await scene();
    const before = await prisma.garageBrandJob.findMany({
      where: { garageId: dinamo.garage.id },
    });

    await prisma.jobType.update({
      data: { status: 'approved' },
      where: { id: lights.id },
    });

    expect(
      await prisma.garageBrandJob.findMany({
        where: { garageId: dinamo.garage.id },
      }),
    ).toEqual(before);
    expect(before.map((r) => r.jobTypeId)).toContain(lights.id);
  });
});
