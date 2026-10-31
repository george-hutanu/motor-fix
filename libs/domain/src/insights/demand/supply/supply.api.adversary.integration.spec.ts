// @traces 106-FR-006 106-FR-008 106-FR-012
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

async function admin() {
  const id = await world.account('Ana Admin', ['admin']);
  return bearer(id, 'admin');
}

async function searched(brand: string, times = 1) {
  const row = await prisma.brand.create({
    data: { key: `k-${brand.length}`, name: brand, slug: `s-${brand.length}` },
  });
  await prisma.searchLog.createMany({
    data: Array.from({ length: times }, () => ({
      areaCell: 'sxfse',
      at: new Date(),
      brandId: row.id,
    })),
  });
}

describe('GET /admin/demand/supply under hostile requests', () => {
  it.each([
    ['a repeated brand', '?brand=BMW&brand=Audi'],
    ['a repeated area', '?area=sector-3&area=sector-4'],
    ['a bracketed brand', '?brand[$ne]=x'],
    ['a bracketed area', '?area[]=sector-3'],
    ['an upper-case area', '?area=UNKNOWN'],
    ['an area with an encoded newline', '?area=sector-3%0A'],
    ['an area with an encoded space', '?area=sector%203'],
    ['a brand of 81 characters', `?brand=${'x'.repeat(81)}`],
    ['a brand of 81 accented characters', `?brand=${'%C3%A9'.repeat(81)}`],
    ['a well-formed area in no list', '?area=sector-7'],
    ['an extra key beside valid ones', '?brand=BMW&area=unknown&limit=5'],
  ])('answers 400 validation_failed to %s', async (_, query) => {
    const res = await get(`${PATH}${query}`, await admin());

    expect([res.status, res.body.code]).toEqual([400, 'validation_failed']);
  });

  it('answers a malformed brand with a client error, never a server error', async () => {
    for (const brand of ['BMW%00', '%FF%FE', '%E0%A4%A']) {
      const res = await get(`${PATH}?brand=${brand}`, await admin());

      expect([200, 400]).toContain(res.status);
    }
  });

  it('answers a brand of exactly 80 characters, accented ones included', async () => {
    for (const brand of ['x'.repeat(80), 'é'.repeat(80)]) {
      const res = await get(
        `${PATH}?brand=${encodeURIComponent(brand)}`,
        await admin(),
      );

      expect([res.status, res.body.rows]).toEqual([200, []]);
    }
  });

  it('matches a brand with a diacritic and a space sent percent-encoded, exactly', async () => {
    await searched('Alfa Șoim');

    const hit = await get(
      `${PATH}?brand=${encodeURIComponent('Alfa Șoim')}`,
      await admin(),
    );
    const plus = await get(`${PATH}?brand=Alfa+%C8%98oim`, await admin());
    const miss = await get(`${PATH}?brand=Alfa%20%C8%99oim`, await admin());

    expect(hit.body.rows.map((r: { brand: string }) => r.brand)).toEqual([
      'Alfa Șoim',
    ]);
    expect(plus.body.rows).toEqual(hit.body.rows);
    expect(miss.body.rows).toEqual([]);
  });

  it('answers 404 to a non-admin and 401 to a visitor before it looks at the query', async () => {
    const { owner } = await team('Service Titan');

    const driver = await get(
      `${PATH}?area=NOT%20AN%20AREA`,
      bearer(owner, 'garage'),
    );
    const visitor = await get(`${PATH}?area=NOT%20AN%20AREA`);
    const forged = await get(PATH, 'Bearer not.a.token');

    expect([driver.status, driver.body.code]).toEqual([404, 'not_found']);
    expect([visitor.status, visitor.body.code]).toEqual([
      401,
      'sign_in_required',
    ]);
    expect(forged.status).toBe(401);
  });

  it('answers 401 to a non-bearer authorization scheme', async () => {
    const token = (await admin()).replace('Bearer ', '');

    const res = await get(PATH, `Basic ${token}`);

    expect(res.status).toBe(401);
  });

  it('answers 404 to an account that is no admin whatever role its token claims', async () => {
    const driver = await world.account('Dan Driver');

    const res = await get(PATH, bearer(driver, 'admin'));

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it('keeps the demand read beside it answering as before', async () => {
    const res = await get('/admin/demand', await admin());

    expect(res.status).toBe(200);
    expect(res.body.rows).toBeUndefined();
  });

  it('answers the same body twice, with integer figures and no extra field in a row', async () => {
    await searched('BMW', 3);
    const auth = await admin();

    const a = await get(PATH, auth);
    const b = await get(PATH, auth);

    expect(b.body).toEqual(a.body);
    expect(Object.keys(a.body.rows[0]).sort()).toEqual([
      'area',
      'brand',
      'requests',
      'requestsPerGarage',
      'searches',
      'supply',
      'unmet',
    ]);
    expect(Object.keys(a.body.rows[0].area).sort()).toEqual([
      'code',
      'kind',
      'name',
    ]);
    expect(Number.isInteger(a.body.rows[0].searches)).toBe(true);
  });

  it('answers the 48 areas in code order with unknown last, whatever the filter', async () => {
    const res = await get(`${PATH}?area=unknown&brand=none`, await admin());
    const codes = res.body.areas.map((a: { code: string }) => a.code);

    expect(codes).toHaveLength(48);
    expect(codes.at(-1)).toBe('unknown');
    expect(codes.slice(0, -1)).toEqual([...codes.slice(0, -1)].sort());
    expect(res.body.areas.at(-1)).toEqual({
      code: 'unknown',
      kind: 'unknown',
      name: 'Zonă necunoscută',
    });
  });
});
