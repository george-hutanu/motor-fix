import { dropSearches } from './garage-search.cache';

const redis = () => ({ incr: jest.fn().mockResolvedValue(1) });

describe('dropSearches under odd audiences', () => {
  it('leaves the generation alone for an empty audience', async () => {
    const r = redis();
    await dropSearches(r, []);
    expect(r.incr).not.toHaveBeenCalled();
  });

  it.each([['public:garage:abc'], ['public:search'], ['public:search:abc']])(
    'advances the generation for %s',
    async (key) => {
      const r = redis();
      await dropSearches(r, [key]);
      expect(r.incr).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['public:searches'],
    ['public:searching:abc'],
    ['public:garages'],
    ['public:garageX'],
    ['public:mechanic:abc'],
    ['user:abc'],
    ['private:public:garage:abc'],
    [' public:search'],
    ['public:search\n'],
    ['PUBLIC:SEARCH'],
    [''],
  ])('leaves the generation alone for %j', async (key) => {
    const r = redis();
    await dropSearches(r, [key]);
    expect(r.incr).not.toHaveBeenCalled();
  });

  it('advances once when many keys match', async () => {
    const r = redis();
    await dropSearches(r, [
      'user:1',
      'public:garage:a',
      'public:search:b',
      'public:search',
    ]);
    expect(r.incr).toHaveBeenCalledTimes(1);
  });

  it('advances the same key each time', async () => {
    const r = redis();
    await dropSearches(r, ['public:search']);
    await dropSearches(r, ['public:garage:a']);
    expect(r.incr.mock.calls[0]).toEqual(r.incr.mock.calls[1]);
  });

  it('rejects when Redis refuses the drop', async () => {
    const r = { incr: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(dropSearches(r, ['public:search'])).rejects.toThrow('down');
  });
});
