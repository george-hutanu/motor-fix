import { Logger } from '@nestjs/common';

import { FakePlaces } from './fake-places.provider';
import { GeoapifyPlaces } from './geoapify-places.provider';

const answer = (results: unknown[]) =>
  jest.fn<Promise<Response>, [string, RequestInit?]>(
    async () =>
      ({ json: async () => ({ results }), ok: true, status: 200 }) as Response,
  );

const row = (city: unknown) => ({
  city,
  formatted: 'Strada Exemplu 2, Cluj-Napoca',
  lat: 46.7712,
  lon: 23.6236,
});

// @traces 163-FR-005
describe('the locality of a suggestion', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("carries the Geoapify row's city, trimmed", async () => {
    const places = new GeoapifyPlaces('key', answer([row('  Cluj-Napoca ')]));

    await expect(places.search('Exemplu', 'ro')).resolves.toEqual({
      items: [
        {
          label: 'Strada Exemplu 2, Cluj-Napoca',
          lat: 46.7712,
          lng: 23.6236,
          locality: 'Cluj-Napoca',
        },
      ],
    });
  });

  it.each([
    ['missing', undefined],
    ['not text', 7],
    ['blank', '   '],
    ['longer than 80 characters', 'a'.repeat(81)],
  ])(
    'keeps the suggestion without a locality when the city is %s',
    async (_, city) => {
      const places = new GeoapifyPlaces('key', answer([row(city)]));

      const found = await places.search('Exemplu', 'ro');

      expect(found).toEqual({
        items: [expect.not.objectContaining({ locality: expect.anything() })],
      });
      expect('items' in found && found.items).toHaveLength(1);
    },
  );

  it.each([
    ['Ștefan cel Mare 12 Sector 2', 'București'],
    ['Ștefan cel Mare Iași', 'Iași'],
    ['Exemplu Cluj', 'Cluj-Napoca'],
    ['Eroilor', 'Brașov'],
    ['Mihai Viteazu', 'Timișoara'],
    ['Strada Necunoscută 9', 'București'],
  ])(
    'gives the stand-in suggestion for %s the locality %s',
    async (q, locality) => {
      const { items } = (await new FakePlaces().search(q)) as {
        items: { locality?: string }[];
      };

      expect(items[0]?.locality).toBe(locality);
    },
  );
});
