import type { Redis } from 'ioredis';

import { raceListWrite } from './brands.testing';

// AuthModule's maintenance switch writes to the same Redis whenever its own
// key has expired: a race on the first write of any key changed the list
// before the search read it, and failed a lap of CI's integration run.
describe('raceListWrite', () => {
  const fake = () => {
    const writes: string[] = [];
    const cache = {
      set: async (key: string) => {
        writes.push(key);
        return 'OK';
      },
    };
    return { cache: cache as unknown as Redis, writes };
  };

  it('lets other writes through and races the brand list only, once', async () => {
    const { cache, writes } = fake();
    const changes: string[] = [];
    const race = raceListWrite(cache, async () => {
      changes.push(`change after ${writes.length}`);
    });

    await cache.set('maintenance', '0');
    expect(race.raced).toBe(false);
    await cache.set('brands:active:7', '[]');
    await cache.set('brands:active:8', '[]');

    expect(race.raced).toBe(true);
    expect(changes).toEqual(['change after 1']);
    expect(writes).toEqual([
      'maintenance',
      'brands:active:7',
      'brands:active:8',
    ]);
  });
});
