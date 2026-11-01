import { garageOptions, switchesOf } from './garage-options';

const GARAGE = '7d3f1c1e-5a0b-4c55-9d7e-2f1b8f5a9c11';
const cards = [{ id: 'c1', name: 'Ștefan Ilie' }];

function db(rows: { key: string; enabled: boolean }[]) {
  return {
    garage: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ liftCount: 3 }),
    },
    garageFeature: { findMany: vi.fn().mockResolvedValue(rows) },
    mechanic: { findMany: vi.fn().mockResolvedValue(cards) },
  };
}

type Db = Parameters<typeof garageOptions>[0];

// @traces 1395-FR-003
// @traces 1395-FR-004
describe('the lifts and cards a garage offers', () => {
  it('has both switches on when the garage has no row for them', async () => {
    await expect(switchesOf(db([]) as unknown as Db, GARAGE)).resolves.toEqual({
      lifts: true,
      team: true,
    });
  });

  it('reads each switch from its own row', async () => {
    const off = db([
      { enabled: false, key: 'lift_schedule' },
      { enabled: true, key: 'team_mechanics' },
    ]);

    await expect(switchesOf(off as unknown as Db, GARAGE)).resolves.toEqual({
      lifts: false,
      team: true,
    });
  });

  it("offers the garage's lifts and its current cards by name, then id", async () => {
    const on = db([]);

    await expect(garageOptions(on as unknown as Db, GARAGE)).resolves.toEqual({
      liftCount: 3,
      mechanics: cards,
      team: true,
    });
    expect(on.mechanic.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
      where: { garageId: GARAGE, removedAt: null },
    });
  });

  it('offers no lift and no card while both switches are off', async () => {
    const off = db([
      { enabled: false, key: 'lift_schedule' },
      { enabled: false, key: 'team_mechanics' },
    ]);

    await expect(garageOptions(off as unknown as Db, GARAGE)).resolves.toEqual({
      liftCount: 0,
      mechanics: [],
      team: false,
    });
    expect(off.mechanic.findMany).not.toHaveBeenCalled();
  });
});
