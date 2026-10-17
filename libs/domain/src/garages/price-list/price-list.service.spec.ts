import { PriceListService } from './price-list.service';
import type { Actor } from '../../auth/policy';

const GARAGE = 'g1';
const pair = { brandId: 'b1', garageId: GARAGE, jobTypeId: 'j1' };
const actor = {
  accountId: 'a1',
  garageId: GARAGE,
  role: 'garage',
} as Actor;

// A removal that commits between the write's read and its own statement
// leaves the write's update or delete touching no row.
function world(rows: { brandId: string | null; id: string }[]) {
  const garagePrice = {
    create: jest.fn().mockResolvedValue({ id: 'new' }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findFirst: jest.fn().mockResolvedValue({
      brand: { slug: 'bmw' },
      fromBani: 100_000,
      garage: { slug: 'nord' },
      id: 'own',
      toBani: 150_000,
    }),
    findMany: jest.fn().mockResolvedValue(
      rows.map((row) => ({
        fromBani: 89_000,
        position: 3,
        toBani: 140_000,
        ...row,
      })),
    ),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    $transaction: (work: (tx: unknown) => unknown) => work({ garagePrice }),
    brand: { findUnique: jest.fn().mockResolvedValue({ slug: 'bmw' }) },
    garage: {
      findUnique: jest.fn().mockResolvedValue({
        brands: [{ stance: 'works_on' }],
        slug: 'nord',
      }),
    },
    garagePrice,
  };
  const audit = { record: jest.fn() };
  const events = { record: jest.fn() };
  const cache = { take: jest.fn() };
  const service = new PriceListService(
    prisma as never,
    audit as never,
    events as never,
    cache as never,
  );
  return { audit, cache, events, garagePrice, service };
}

// @traces 386-FR-005
// @traces 386-FR-009
describe('a brand range write racing a removal', () => {
  it('stores the range anew when the row it would change is gone', async () => {
    const w = world([
      { brandId: null, id: 'default' },
      { brandId: 'b1', id: 'own' },
    ]);

    const saved = await w.service.setBrandRange(actor, pair, {
      fromBani: 110_000,
      toBani: 170_000,
    });

    expect(saved).toMatchObject({ fromBani: 110_000, toBani: 170_000 });
    expect(w.garagePrice.create).toHaveBeenCalledTimes(1);
    expect(w.audit.record).toHaveBeenCalledTimes(1);
    expect(w.audit.record.mock.calls[0][1]).toMatchObject({
      action: 'create',
      subjectId: 'new',
    });
    expect(w.events.record).toHaveBeenCalledTimes(1);
  });

  it('answers not found and records nothing when the row is already removed', async () => {
    const w = world([{ brandId: null, id: 'default' }]);

    await expect(w.service.removeBrandRange(actor, pair)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(w.audit.record).not.toHaveBeenCalled();
    expect(w.events.record).not.toHaveBeenCalled();
    expect(w.cache.take).not.toHaveBeenCalled();
  });
});

// The owner's read carries the garage's hourly labour range when both ends
// are set, and no labour otherwise.
function reading(garage: Record<string, unknown> | null) {
  const findUnique = jest.fn().mockResolvedValue(garage);
  const service = new PriceListService(
    { garage: { findUnique } } as never,
    { record: jest.fn() } as never,
    { record: jest.fn() } as never,
    { take: jest.fn() } as never,
  );
  return { findUnique, service };
}

const stored = (
  labourFromBani: number | null,
  labourToBani: number | null,
) => ({
  labourFromBani,
  labourToBani,
  prices: [],
  rarActivities: [],
});

// @traces 172-price-list-states-FR-006
describe("the owner's price list read and the labour range", () => {
  it('gives the hourly labour range when both ends are set', async () => {
    const { findUnique, service } = reading(stored(18_000, 24_000));

    await expect(service.read(actor, GARAGE)).resolves.toEqual({
      items: [],
      labour: { fromBani: 18_000, toBani: 24_000 },
    });
    expect(findUnique.mock.calls[0][0].select).toMatchObject({
      labourFromBani: true,
      labourToBani: true,
    });
  });

  it.each([
    [null, null],
    [18_000, null],
    [null, 24_000],
  ])('gives no labour when its ends are %p and %p', async (from, to) => {
    const { service } = reading(stored(from, to));

    const list = await service.read(actor, GARAGE);

    expect(list).toEqual({ items: [] });
    expect('labour' in list).toBe(false);
  });

  it('answers not found for a garage that is gone', async () => {
    const { service } = reading(null);

    await expect(service.read(actor, GARAGE)).rejects.toMatchObject({
      status: 404,
    });
  });
});
