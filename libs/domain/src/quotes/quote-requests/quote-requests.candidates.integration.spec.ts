import { randomUUID } from 'node:crypto';

import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const BUCHAREST = '44.427,26.103';

// An approved garage at a place, with its row for the brand.
async function placed(
  name: string,
  brandId: string,
  at: [number, number],
  options: {
    jobTypeIds?: string[];
    mobileKm?: number;
    row?: Record<string, unknown>;
  } = {},
) {
  const garage = await prisma.garage.create({
    data: {
      latitude: at[0],
      longitude: at[1],
      name,
      slug: `garage-${randomUUID()}`,
      status: 'approved',
      ...(options.mobileKm && {
        businessKind: 'mobile' as const,
        serviceRadiusKm: options.mobileKm,
      }),
    },
  });
  await prisma.garageBrand.create({
    data: { brandId, garageId: garage.id, stance: 'works_on', ...options.row },
  });
  if (options.jobTypeIds?.length) {
    await prisma.garageBrandJob.createMany({
      data: options.jobTypeIds.map((jobTypeId) => ({
        brandId,
        garageId: garage.id,
        jobTypeId,
      })),
    });
  }
  return garage;
}

async function scene() {
  const driver = await world.account('Andrei Marin');
  const car = await world.car(driver);
  const oil = await world.jobType();
  return { auth: bearer(driver, 'driver'), car, driver, oil };
}

const candidates = (query: string, auth?: string) =>
  get(`/quote-requests/garages?${query}`, auth);

const names = (res: { body: { items: { name: string }[] } }) =>
  res.body.items.map((item) => item.name);

// @traces 221-FR-006
describe('GET /quote-requests/garages', () => {
  it('answers an empty list without a place', async () => {
    const { auth, car } = await scene();
    await placed('Atelier Berceni', car.brandId, [44.382, 26.12]);

    const res = await candidates(`carId=${car.id}`, auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('lists the garages near the place that can take the car, by name', async () => {
    const { auth, car } = await scene();
    const berceni = await placed(
      'Atelier Berceni',
      car.brandId,
      [44.382, 26.12],
    );
    await placed('Auto Pipera', car.brandId, [44.5, 26.12]);
    await placed('Service Mărăști', car.brandId, [46.78, 23.62]);

    const res = await candidates(`carId=${car.id}&near=${BUCHAREST}`, auth);

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Atelier Berceni', 'Auto Pipera']);
    expect(res.body.items[0]).toEqual({
      comesToYou: false,
      distanceKm: expect.any(Number),
      id: berceni.id,
      name: 'Atelier Berceni',
      slug: berceni.slug,
    });
    expect(res.body.items[0].distanceKm).toBeGreaterThan(4);
    expect(res.body.items[0].distanceKm).toBeLessThan(7);
  });

  it('lists a mobile mechanic whose area covers the place, with no distance', async () => {
    const { auth, car } = await scene();
    await placed('Mecanic Mobil', car.brandId, [44.6, 26.1], { mobileKm: 30 });
    await placed('Mecanic Departe', car.brandId, [44.6, 26.1], { mobileKm: 5 });

    const res = await candidates(`carId=${car.id}&near=${BUCHAREST}`, auth);

    expect(res.body.items).toEqual([
      expect.objectContaining({
        comesToYou: true,
        distanceKm: null,
        name: 'Mecanic Mobil',
      }),
    ]);
  });

  it('leaves out the garages routing would refuse, and the profile’s garage', async () => {
    const { auth, car, oil } = await scene();
    const profile = await placed(
      'Service Auto Militari',
      car.brandId,
      [44.435, 26.015],
      {
        jobTypeIds: [oil.id],
      },
    );
    await placed('Ulei Berceni', car.brandId, [44.382, 26.12], {
      jobTypeIds: [oil.id],
    });
    await placed('Fără Ulei', car.brandId, [44.39, 26.12]);
    await placed('Doar Diesel', car.brandId, [44.4, 26.12], {
      jobTypeIds: [oil.id],
      row: { petrol: false },
    });
    await placed('Nu Ia Marca', car.brandId, [44.41, 26.12], {
      jobTypeIds: [oil.id],
      // A brand the garage does not take has no fuel ticked.
      row: {
        diesel: false,
        electric: false,
        hybrid: false,
        petrol: false,
        stance: 'does_not_take',
      },
    });
    const suspended = await placed('Suspendat', car.brandId, [44.42, 26.12], {
      jobTypeIds: [oil.id],
    });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: suspended.id },
    });

    const res = await candidates(
      `carId=${car.id}&near=${BUCHAREST}&jobTypeIds=${oil.id}&exclude=${profile.id}`,
      auth,
    );

    expect(names(res)).toEqual(['Ulei Berceni']);
  });

  it('skips the job check when no job is switched on', async () => {
    const { auth, car } = await scene();
    await placed('Fără Ulei', car.brandId, [44.39, 26.12]);

    const res = await candidates(`carId=${car.id}&near=${BUCHAREST}`, auth);

    expect(names(res)).toEqual(['Fără Ulei']);
  });

  it('lists at most five', async () => {
    const { auth, car } = await scene();
    for (const letter of 'ABCDEFG') {
      await placed(`Atelier ${letter}`, car.brandId, [44.43, 26.1]);
    }

    const res = await candidates(`carId=${car.id}&near=${BUCHAREST}`, auth);

    expect(names(res)).toEqual([
      'Atelier A',
      'Atelier B',
      'Atelier C',
      'Atelier D',
      'Atelier E',
    ]);
  });

  it('answers 404 for another driver’s car', async () => {
    const { auth } = await scene();
    const maria = await world.account('Maria Ionescu');
    const hers = await world.car(maria);

    expect(
      (await candidates(`carId=${hers.id}&near=${BUCHAREST}`, auth)).status,
    ).toBe(404);
  });

  it('answers 400 to a malformed car, place or job', async () => {
    const { auth, car } = await scene();

    for (const query of [
      'carId=logan',
      `carId=${car.id}&near=paris`,
      `carId=${car.id}&jobTypeIds=oil`,
    ]) {
      expect((await candidates(query, auth)).status).toBe(400);
    }
  });

  it('answers 401 without a session and 404 to a garage-role session', async () => {
    const { car } = await scene();
    const { owner } = await team('Atelier Dinamo');

    expect((await candidates(`carId=${car.id}`)).status).toBe(401);
    expect(
      (await candidates(`carId=${car.id}`, bearer(owner, 'garage'))).status,
    ).toBe(404);
  });
});
