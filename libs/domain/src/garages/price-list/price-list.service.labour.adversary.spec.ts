import { PriceListService } from './price-list.service';
import type { Actor } from '../../auth/policy';

const GARAGE = 'g1';
const owner = { accountId: 'a1', garageId: GARAGE, role: 'garage' } as Actor;

function build(garage: Record<string, unknown> | null) {
  const findUnique = jest.fn().mockResolvedValue(garage);
  const prisma = { garage: { findUnique } };
  const service = new PriceListService(
    prisma as never,
    { record: jest.fn() } as never,
    { record: jest.fn() } as never,
    { take: jest.fn() } as never,
  );
  return { findUnique, service };
}

const garageWith = (labourFromBani: unknown, labourToBani: unknown) => ({
  labourFromBani,
  labourToBani,
  prices: [],
  rarActivities: [],
});

// @traces 172-FR-006
describe('the owner read labour range, adversarial', () => {
  it('carries both ends when both are set', async () => {
    const { service } = build(garageWith(18_000, 24_000));

    expect(await service.read(owner, GARAGE)).toEqual({
      items: [],
      labour: { fromBani: 18_000, toBani: 24_000 },
    });
  });

  it('omits labour when only the low end is set', async () => {
    const { service } = build(garageWith(18_000, null));

    const result = await service.read(owner, GARAGE);
    expect(result).toEqual({ items: [] });
    expect('labour' in result).toBe(false);
  });

  it('omits labour when only the high end is set', async () => {
    const { service } = build(garageWith(null, 24_000));

    expect('labour' in (await service.read(owner, GARAGE))).toBe(false);
  });

  it('omits labour when neither end is set', async () => {
    const { service } = build(garageWith(null, null));

    expect(await service.read(owner, GARAGE)).toEqual({ items: [] });
  });

  it('counts a zero end as set', async () => {
    const { service } = build(garageWith(0, 0));

    expect((await service.read(owner, GARAGE)).labour).toEqual({
      fromBani: 0,
      toBani: 0,
    });
  });

  it('keeps equal ends as they are', async () => {
    const { service } = build(garageWith(20_000, 20_000));

    expect((await service.read(owner, GARAGE)).labour).toEqual({
      fromBani: 20_000,
      toBani: 20_000,
    });
  });

  it('answers 404 for a garage that is gone, with no labour in the answer', async () => {
    const { service } = build(null);

    await expect(service.read(owner, GARAGE)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("refuses another garage's id before reading anything", async () => {
    const { findUnique, service } = build(garageWith(1, 2));

    await expect(service.read(owner, 'other')).rejects.toBeDefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('reads the labour ends in the same query as the prices', async () => {
    const { findUnique, service } = build(garageWith(1, 2));

    await service.read(owner, GARAGE);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.calls[0][0].select).toMatchObject({
      labourFromBani: true,
      labourToBani: true,
    });
  });
});
