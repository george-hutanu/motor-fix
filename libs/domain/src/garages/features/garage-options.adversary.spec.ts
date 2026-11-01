import { garageOptions, switchesOf } from './garage-options';

type Db = Parameters<typeof garageOptions>[0];

function db(rows: { key: string; enabled: boolean }[], liftCount = 3) {
  return {
    garage: { findUniqueOrThrow: vi.fn().mockResolvedValue({ liftCount }) },
    garageFeature: { findMany: vi.fn().mockResolvedValue(rows) },
    mechanic: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

// @traces 1395-FR-003
describe('the garage options, attacked', () => {
  it('asks only for the two switches of its own garage', async () => {
    const d = db([]);

    await switchesOf(d as unknown as Db, 'g1');

    expect(d.garageFeature.findMany).toHaveBeenCalledWith({
      where: {
        garageId: 'g1',
        key: { in: ['team_mechanics', 'lift_schedule'] },
      },
    });
  });

  it('rejects when the garage does not exist', async () => {
    const d = db([]);
    d.garage.findUniqueOrThrow.mockRejectedValue(new Error('no garage'));

    await expect(garageOptions(d as unknown as Db, 'g1')).rejects.toThrow(
      'no garage',
    );
  });

  it('reports lift count 0 with the lifts on and no lifts stored', async () => {
    const result = await garageOptions(db([], 0) as unknown as Db, 'g1');

    expect(result.liftCount).toBe(0);
  });

  it('keeps the lift count while only the team is off', async () => {
    const d = db([{ enabled: false, key: 'team_mechanics' }]);

    const result = await garageOptions(d as unknown as Db, 'g1');

    expect(result).toEqual({
      liftCount: 3,
      mechanics: [],
      team: false,
    });
    expect(d.mechanic.findMany).not.toHaveBeenCalled();
  });

  it('ignores a row of an unrelated key', async () => {
    const d = db([{ enabled: false, key: 'something_else' }]);

    await expect(switchesOf(d as unknown as Db, 'g1')).resolves.toEqual({
      lifts: true,
      team: true,
    });
  });

  it('rejects when the card read fails rather than answering an empty team', async () => {
    const d = db([]);
    d.mechanic.findMany.mockRejectedValue(new Error('down'));

    await expect(garageOptions(d as unknown as Db, 'g1')).rejects.toThrow(
      'down',
    );
  });
});
