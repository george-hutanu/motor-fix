// @traces 106-FR-006 106-FR-008 106-FR-014
import { quotesApp } from '../../../quotes/quotes-api.testing';
import { AREAS, AreaLoader } from '../../areas/areas';
import { DemandModule } from '../demand.module';

const { bearer, get, team, world } = quotesApp([DemandModule]);
const { prisma } = world;

const PATH = '/admin/demand/supply';

beforeAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE area');
  await new AreaLoader(prisma).load(AREAS);
});

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE demand_daily'));

async function admin(status: 'active' | 'suspended' = 'active') {
  const id = await world.account('Ana Admin', ['admin']);
  if (status === 'suspended')
    await prisma.account.update({ data: { status }, where: { id } });
  return bearer(id, 'admin');
}

describe('GET /admin/demand/supply', () => {
  it("answers an admin the window, the areas and a row per brand and area, with no person's data", async () => {
    const { garage } = await team('Service Titan');
    await prisma.$executeRaw`UPDATE garage SET position = ST_SetSRID(ST_MakePoint(${26.17}, ${44.415}), 4326)::geography WHERE id = ${garage.id}::uuid`;
    const brand = await prisma.brand.create({
      data: { key: 'bmw', name: 'BMW', slug: 'bmw' },
    });
    await prisma.garageBrand.create({
      data: { brandId: brand.id, garageId: garage.id, stance: 'works_on' },
    });
    await prisma.searchLog.create({
      data: { areaCell: 'sxfse', at: new Date(), brandId: brand.id },
    });

    const res = await get(PATH, await admin());

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'areas',
      'firstDay',
      'lastDay',
      'rows',
      'writtenAt',
    ]);
    expect(res.body.writtenAt).toBeNull();
    expect(res.body.firstDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.areas).toHaveLength(48);
    expect(res.body.rows).toEqual([
      {
        area: { code: 'sector-3', kind: 'sector', name: 'Sector 3' },
        brand: 'BMW',
        requests: 0,
        requestsPerGarage: 0,
        searches: 1,
        supply: 1,
        unmet: 0,
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(
      new RegExp(`${garage.id}|Service Titan|Ana Admin`),
    );
  });

  it('keeps the rows of the brand and the area asked for', async () => {
    const res = await get(`${PATH}?brand=BMW&area=unknown`, await admin());

    expect([res.status, res.body.rows]).toEqual([200, []]);
  });

  it.each([
    ['an empty brand', '?brand='],
    ['a brand over 80 characters', `?brand=${'a'.repeat(81)}`],
    ['a malformed area', '?area=Sector%203'],
    ['an area that is not one', '?area=nowhere'],
    ['an unknown key', '?city=cluj-napoca'],
  ])('answers 400 to %s', async (_, query) => {
    const res = await get(`${PATH}${query}`, await admin());

    // The API's problem filter names it validation_failed (apps/api).
    expect(res.status).toBe(400);
  });

  it('answers 404 to every role but admin', async () => {
    const { answering, owner, receptionist } = await team('Service Titan');
    const driver = await world.account('Dan Driver');

    for (const auth of [
      bearer(driver, 'driver'),
      bearer(owner, 'garage'),
      bearer(receptionist, 'receptionist'),
      bearer(answering, 'mechanic'),
    ]) {
      const res = await get(PATH, auth);
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
  });

  it('answers 401 without a session and 403 to a suspended admin', async () => {
    const anonymous = await get(PATH);
    const suspended = await get(PATH, await admin('suspended'));

    expect([anonymous.status, anonymous.body.code]).toEqual([
      401,
      'sign_in_required',
    ]);
    expect([suspended.status, suspended.body.code]).toEqual([
      403,
      'account_suspended',
    ]);
  });
});
