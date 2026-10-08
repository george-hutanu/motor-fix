import { ADDRESS_MAX, inRomania } from '@motor-fix/contracts/place-section';
import { Logger } from '@nestjs/common';

import { FakePlaces } from './fake-places.provider';
import { GeoapifyPlaces } from './geoapify-places.provider';

const KEY = 'secret-key-123';

const answering = (body: () => unknown, status = 200) =>
  jest.fn<Promise<Response>, [string, RequestInit?]>(
    async () =>
      ({
        json: async () => body(),
        ok: status >= 200 && status < 300,
        status,
      }) as Response,
  );

const row = (formatted: unknown, lat: unknown, lon: unknown) => ({
  formatted,
  lat,
  lon,
});

describe('the Geoapify address search against odd answers', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const search = (body: unknown) =>
    new GeoapifyPlaces(
      KEY,
      answering(() => body),
    ).search('Strada', 'ro');

  it.each([
    ['results null', { results: null }],
    ['results an object', { results: {} }],
    ['results a string', { results: 'none' }],
    ['a null body', null],
    ['an array body', []],
  ])('is unavailable for %s', async (_, body) => {
    expect(await search(body)).toEqual({ unavailable: 'malformed' });
  });

  it('is unavailable when the body is not JSON', async () => {
    const fetch = jest.fn(
      async () =>
        ({
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
          },
          ok: true,
          status: 200,
        }) as unknown as Response,
    );

    expect(await new GeoapifyPlaces(KEY, fetch).search('Strada', 'ro')).toEqual(
      { unavailable: 'malformed' },
    );
  });

  it.each([
    ['a string latitude', row('Strada A', '44.4', 26.1)],
    ['a null longitude', row('Strada A', 44.4, null)],
    ['a numeric label', row(12, 44.4, 26.1)],
    ['an empty label', row('', 44.4, 26.1)],
    ['a blank label', row('   ', 44.4, 26.1)],
    ['a null row', null],
    ['a string row', 'Strada A'],
    ['a latitude just south of the box', row('Strada A', 43.4999, 25)],
    ['a longitude just east of the box', row('Strada A', 45, 29.8001)],
  ])('leaves out a row with %s', async (_, bad) => {
    const good = row('Strada Bună 1', 44.4, 26.1);

    expect(await search({ results: [bad, good] })).toEqual({
      items: [{ label: 'Strada Bună 1', lat: 44.4, lng: 26.1 }],
    });
  });

  it('keeps a row exactly on the corner of the box', async () => {
    expect(await search({ results: [row('Colț', 43.5, 20.2)] })).toEqual({
      items: [{ label: 'Colț', lat: 43.5, lng: 20.2 }],
    });
  });

  it('never offers a label the address field would then refuse', async () => {
    const found = await search({
      results: [row('x'.repeat(ADDRESS_MAX + 50), 44.4, 26.1)],
    });

    if (!('items' in found)) throw new Error('expected items');
    for (const item of found.items) {
      expect(item.label.length).toBeLessThanOrEqual(ADDRESS_MAX);
    }
  });

  it('sends the text as one encoded parameter, whatever it holds', async () => {
    const fetch = answering(() => ({ results: [] }));
    const hostile = 'Str. A&apiKey=evil#frag?x=1 ș%00\n';

    await new GeoapifyPlaces(KEY, fetch).search(hostile, 'ro');

    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('text')).toBe(hostile);
    expect(url.searchParams.getAll('apiKey')).toEqual([KEY]);
    expect(url.hash).toBe('');
  });

  it('reports a failure that is not a timeout as a network failure, not a timeout', async () => {
    const fetch = jest.fn(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND api.geoapify.com');
    });

    expect(await new GeoapifyPlaces(KEY, fetch).search('Strada', 'ro')).toEqual(
      { unavailable: 'network' },
    );
  });

  it('does not log the typed text or the key when the answer is malformed', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');

    await new GeoapifyPlaces(
      KEY,
      answering(() => ({ results: 3 })),
    ).search('Strada Secretă 9', 'ro');

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('Secret');
  });
});

describe('the stand-in address search against odd text', () => {
  const places = new FakePlaces();

  it('has a text that finds nothing, as the end-to-end tests need one', async () => {
    const texts = ['zzzzzz', 'Nicăieri', 'qqq xxx', 'Strada Nicăieri 7'];
    const answers = await Promise.all(texts.map((t) => places.search(t, 'ro')));

    expect(answers).toContainEqual({ items: [] });
  });

  it('never offers a label longer than the address field takes', async () => {
    const found = await places.search('a'.repeat(200), 'ro');

    if (!('items' in found)) throw new Error('expected items');
    for (const item of found.items) {
      expect(item.label.length).toBeLessThanOrEqual(ADDRESS_MAX);
    }
  });

  it.each(['Str', 'str', 'ab', '   ', '!!!', '😀😀😀', '\u0000\u0000\u0000'])(
    'answers a list of at most five places in Romania for %j',
    async (text) => {
      const found = await places.search(text, 'en');

      if (!('items' in found)) throw new Error('expected items');
      expect(found.items.length).toBeLessThanOrEqual(5);
      for (const item of found.items) {
        expect(inRomania(item.lat, item.lng)).toBe(true);
      }
    },
  );

  it('answers the same for either language', async () => {
    expect(await places.search('Exemplu', 'ro')).toEqual(
      await places.search('Exemplu', 'en'),
    );
  });
});
