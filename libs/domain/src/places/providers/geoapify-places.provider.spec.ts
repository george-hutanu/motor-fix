import { Logger } from '@nestjs/common';

import { GeoapifyPlaces } from './geoapify-places.provider';

const KEY = 'secret-key-123';

const answer = (body: unknown, status = 200) =>
  jest.fn<Promise<Response>, [string, RequestInit?]>(
    async () =>
      ({
        json: async () => body,
        ok: status >= 200 && status < 300,
        status,
      }) as Response,
  );

const result = (formatted: string, lat: number, lon: number) => ({
  formatted,
  lat,
  lon,
});

describe('the Geoapify address search', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('asks for at most five addresses in Romania, in the language asked', async () => {
    const fetch = answer({ results: [] });

    await new GeoapifyPlaces(KEY, fetch).search('Strada Exemplu 1', 'en');

    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(
      'https://api.geoapify.com/v1/geocode/autocomplete',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      apiKey: KEY,
      filter: 'countrycode:ro',
      format: 'json',
      lang: 'en',
      limit: '5',
      text: 'Strada Exemplu 1',
    });
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns the answer into label, latitude and longitude', async () => {
    const fetch = answer({
      results: [
        result('Strada Ștefan cel Mare 12, Sector 2, București', 44.45, 26.12),
        result('Strada Ștefan cel Mare 12, Iași', 47.17, 27.58),
      ],
    });

    expect(
      await new GeoapifyPlaces(KEY, fetch).search('Ștefan cel Mare 12', 'ro'),
    ).toEqual({
      items: [
        {
          label: 'Strada Ștefan cel Mare 12, Sector 2, București',
          lat: 44.45,
          lng: 26.12,
        },
        { label: 'Strada Ștefan cel Mare 12, Iași', lat: 47.17, lng: 27.58 },
      ],
    });
  });

  it('leaves out places outside Romania and malformed rows, and keeps five', async () => {
    const inside = Array.from({ length: 6 }, (_, n) =>
      result(`Strada ${n}`, 45 + n * 0.1, 25),
    );
    const fetch = answer({
      results: [
        result('Wien', 48.2, 16.37),
        { formatted: 'no position' },
        { lat: 45, lon: 25 },
        ...inside,
      ],
    });

    const found = await new GeoapifyPlaces(KEY, fetch).search('Strada', 'ro');

    expect(found).toEqual({
      items: inside.slice(0, 5).map((row) => ({
        label: row.formatted,
        lat: row.lat,
        lng: row.lon,
      })),
    });
  });

  it.each([
    ['an error status', answer({ message: 'nope' }, 401), '401'],
    ['a server error', answer({}, 503), '503'],
    [
      'a body that is not the expected shape',
      answer({ features: [] }),
      'malformed',
    ],
  ])('is unavailable on %s, and logs only why', async (_, fetch, reason) => {
    expect(await new GeoapifyPlaces(KEY, fetch).search('Strada', 'ro')).toEqual(
      { unavailable: reason },
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(reason);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('Strada');
  });

  it('gives up after three seconds', async () => {
    jest.useFakeTimers();
    try {
      const fetch = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            ),
          ),
      );
      const search = new GeoapifyPlaces(KEY, fetch).search('Strada', 'ro');

      await jest.advanceTimersByTimeAsync(3_000);

      expect(await search).toEqual({ unavailable: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('is unavailable when the network fails, without the key in the log', async () => {
    const fetch = jest.fn(async () => {
      throw new TypeError(`fetch failed for apiKey=${KEY}`);
    });

    expect(await new GeoapifyPlaces(KEY, fetch).search('Strada', 'ro')).toEqual(
      { unavailable: 'network' },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY);
  });
});
