import { fold } from '@motor-fix/contracts';

// The generic car body shapes a brand without a licensed model is drawn as.
export type BodyStyle =
  | 'saloon'
  | 'hatchback'
  | 'suv'
  | 'crossover'
  | 'estate'
  | 'fastback';

// The brand list MotorFix keeps. A brand is matched by its `key` across
// loads, so a key never changes once shipped; renaming a brand changes only
// its name. A brand removed from this list is retired, never deleted.
export interface BrandRecord {
  key: string;
  name: string;
  // 1 is the most popular; an unranked brand sorts after every ranked one.
  popularity?: number;
  // The generic body drawn when the brand has no licensed car; absent is a saloon.
  bodyStyle?: BodyStyle;
  // "Your <brand>" in Romanian, its hyphen non-breaking (U+2011) so the
  // brand never breaks from its article.
  roPossessive?: string;
}

export const BRANDS: readonly BrandRecord[] = [
  { key: 'bmw', name: 'BMW', popularity: 1, roPossessive: 'BMW\u2011ul tău' },
  {
    key: 'mini',
    name: 'Mini',
    popularity: 2,
    roPossessive: 'Mini\u2011ul tău',
  },
  {
    key: 'mercedes-benz',
    name: 'Mercedes-Benz',
    popularity: 3,
    roPossessive: 'Mercedesul tău',
  },
  {
    key: 'audi',
    name: 'Audi',
    popularity: 4,
    roPossessive: 'Audi\u2011ul tău',
  },
  {
    bodyStyle: 'hatchback',
    key: 'volkswagen',
    name: 'Volkswagen',
    popularity: 5,
    roPossessive: 'VW\u2011ul tău',
  },
  {
    bodyStyle: 'estate',
    key: 'skoda',
    name: 'Škoda',
    popularity: 6,
    roPossessive: 'Škoda ta',
  },
  {
    bodyStyle: 'suv',
    key: 'dacia',
    name: 'Dacia',
    popularity: 7,
    roPossessive: 'Dacia ta',
  },
  {
    key: 'renault',
    name: 'Renault',
    popularity: 8,
    roPossessive: 'Renault\u2011ul tău',
  },
  {
    bodyStyle: 'fastback',
    key: 'ford',
    name: 'Ford',
    popularity: 9,
    roPossessive: 'Fordul tău',
  },
  {
    bodyStyle: 'crossover',
    key: 'toyota',
    name: 'Toyota',
    popularity: 10,
    roPossessive: 'Toyota ta',
  },
  {
    key: 'hyundai',
    name: 'Hyundai',
    popularity: 11,
    roPossessive: 'Hyundai\u2011ul tău',
  },
  { key: 'tesla', name: 'Tesla', popularity: 12, roPossessive: 'Tesla ta' },
  {
    key: 'alfa-romeo',
    name: 'Alfa Romeo',
    roPossessive: 'Alfa Romeo\u2011ul tău',
  },
  { key: 'citroen', name: 'Citroën', roPossessive: 'Citroënul tău' },
  { key: 'opel', name: 'Opel', roPossessive: 'Opelul tău' },
];

export class BrandFileError extends Error {}

export const slugOf = (name: string) =>
  fold(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function validateFile(records: readonly BrandRecord[]) {
  const seen = {
    key: new Map<string, string>(),
    name: new Map<string, string>(),
    slug: new Map<string, string>(),
  };
  for (const record of records) {
    refuseMalformed(record);
    const values = {
      key: record.key,
      name: record.name,
      slug: slugOf(record.name),
    };
    for (const kind of ['key', 'name', 'slug'] as const) {
      const holder = seen[kind].get(values[kind]);
      if (holder !== undefined) {
        throw new BrandFileError(
          `duplicate ${kind} "${values[kind]}": ${holder}, ${record.key}`,
        );
      }
      seen[kind].set(values[kind], record.key);
    }
  }
}

// A key or name that folds to nothing would give an empty key or slug, and a
// rank that is not a whole number from 1 breaks "1 is the most popular".
function refuseMalformed(record: BrandRecord) {
  const { key, name, popularity } = record;
  if (key.trim() === '' || slugOf(name) === '') {
    throw new BrandFileError(`brand "${key}" needs a key and a name`);
  }
  if (
    popularity !== undefined &&
    !(Number.isInteger(popularity) && popularity >= 1)
  ) {
    throw new BrandFileError(
      `brand "${key}" has popularity ${popularity}; it must be a whole number from 1`,
    );
  }
}
