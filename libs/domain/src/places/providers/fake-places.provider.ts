import type {
  PlaceSuggestion,
  PlacesAnswer,
  PlacesProvider,
} from './places.provider';

const PLACES: readonly PlaceSuggestion[] = [
  {
    label: 'Strada Ștefan cel Mare 12, Sector 2, București',
    lat: 44.4512,
    lng: 26.1207,
  },
  { label: 'Strada Ștefan cel Mare 12, Iași', lat: 47.1702, lng: 27.5786 },
  {
    label: 'Strada Exemplu 1, Sector 3, București',
    lat: 44.4268,
    lng: 26.1025,
  },
  { label: 'Strada Exemplu 2, Cluj-Napoca', lat: 46.7712, lng: 23.6236 },
  { label: 'Bulevardul Eroilor 5, Brașov', lat: 45.6427, lng: 25.5887 },
  { label: 'Strada Mihai Viteazu 3, Timișoara', lat: 45.7537, lng: 21.2257 },
];
// Where the text is offered when nothing in the list matches.
const BUCHAREST = { lat: 44.4268, lng: 26.1025 };

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Stands in for the real search in tests and the end-to-end boot.
export class FakePlaces implements PlacesProvider {
  readonly name = 'fake';

  async search(q: string, _lang?: string): Promise<PlacesAnswer> {
    const words = plain(q)
      .split(' ')
      .filter((word) => word.length > 2 && word !== 'str');
    const found = PLACES.filter((place) => {
      const label = plain(place.label);
      return words.length > 0 && words.every((word) => label.includes(word));
    });
    return {
      items: found.length
        ? found.slice(0, 5)
        : [{ label: `${q}, București`, ...BUCHAREST }],
    };
  }
}
