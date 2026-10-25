import type { Redis } from 'ioredis';

// Runs change() as the search is about to write the brand list it read, then
// lets that write through: the race a cache must survive. Only the list's own
// write counts; AuthModule's maintenance switch writes to this Redis too.
export function raceListWrite(cache: Redis, change: () => Promise<unknown>) {
  const set = cache.set.bind(cache);
  const race = { raced: false };
  const write = jest
    .spyOn(cache, 'set')
    .mockImplementation(async (...args: Parameters<Redis['set']>) => {
      if (race.raced || !String(args[0]).startsWith('brands:active:'))
        return set(...args);
      write.mockRestore();
      race.raced = true;
      await change();
      return set(...args);
    });
  return race;
}
