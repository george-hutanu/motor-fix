import { inRomania } from '@motor-fix/contracts/place-section';

import { FakePlaces } from './fake-places.provider';

describe('the stand-in address search', () => {
  const places = new FakePlaces();

  it('answers the same addresses for the same text, inside Romania', async () => {
    const first = await places.search('Strada', 'ro');
    const again = await places.search('Strada', 'ro');

    expect(first).toEqual(again);
    if (!('items' in first)) throw new Error('expected items');
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThanOrEqual(5);
    for (const item of first.items) {
      expect(inRomania(item.lat, item.lng)).toBe(true);
      expect(Object.keys(item).sort()).toEqual(['label', 'lat', 'lng']);
    }
  });

  it('matches without regard to case or diacritics', async () => {
    const found = await places.search('stefan cel mare', 'ro');

    if (!('items' in found)) throw new Error('expected items');
    expect(found.items[0].label).toContain('Ștefan cel Mare');
  });

  it('finds nothing for its one text that finds nothing', async () => {
    expect(await places.search('Strada NICAIERI 7', 'ro')).toEqual({
      items: [],
    });
  });

  it('offers the typed text in Bucharest when nothing in its list matches', async () => {
    expect(await places.search('Bulevardul Florilor 7', 'ro')).toEqual({
      items: [
        {
          label: 'Bulevardul Florilor 7, București',
          lat: 44.4268,
          lng: 26.1025,
        },
      ],
    });
  });
});
