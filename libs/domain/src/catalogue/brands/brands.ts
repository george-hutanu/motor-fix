import { type BodyStyle, fold } from '@motor-fix/contracts';

// The generic car body shapes a brand without a licensed model is drawn as,
// kept once in contracts beside the 3D answer that names them.
export type { BodyStyle };

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
  { key: 'opel', name: 'Opel', popularity: 13, roPossessive: 'Opelul tău' },
  {
    key: 'peugeot',
    name: 'Peugeot',
    popularity: 14,
    roPossessive: 'Peugeot\u2011ul tău',
  },
  {
    key: 'seat',
    name: 'SEAT',
    popularity: 15,
    roPossessive: 'SEAT\u2011ul tău',
  },
  { key: 'fiat', name: 'Fiat', popularity: 16, roPossessive: 'Fiatul tău' },
  {
    key: 'daewoo',
    name: 'Daewoo',
    popularity: 17,
    roPossessive: 'Daewoo\u2011ul tău',
  },
  {
    key: 'nissan',
    name: 'Nissan',
    popularity: 18,
    roPossessive: 'Nissanul tău',
  },
  {
    key: 'suzuki',
    name: 'Suzuki',
    popularity: 19,
    roPossessive: 'Suzuki\u2011ul tău',
  },
  {
    key: 'volvo',
    name: 'Volvo',
    popularity: 20,
    roPossessive: 'Volvo\u2011ul tău',
  },
  { key: 'mazda', name: 'Mazda', popularity: 21, roPossessive: 'Mazda ta' },
  {
    key: 'citroen',
    name: 'Citroën',
    popularity: 22,
    roPossessive: 'Citroënul tău',
  },
  { key: 'kia', name: 'Kia', popularity: 23, roPossessive: 'Kia ta' },
  {
    key: 'mitsubishi',
    name: 'Mitsubishi',
    popularity: 24,
    roPossessive: 'Mitsubishi\u2011ul tău',
  },
  {
    key: 'chevrolet',
    name: 'Chevrolet',
    popularity: 25,
    roPossessive: 'Chevrolet\u2011ul tău',
  },
  {
    key: 'land-rover',
    name: 'Land Rover',
    popularity: 26,
    roPossessive: 'Land Roverul tău',
  },
  { key: 'honda', name: 'Honda', popularity: 27, roPossessive: 'Honda ta' },
  {
    key: 'oltcit',
    name: 'Oltcit',
    popularity: 28,
    roPossessive: 'Oltcitul tău',
  },
  {
    key: 'alfa-romeo',
    name: 'Alfa Romeo',
    popularity: 29,
    roPossessive: 'Alfa Romeo\u2011ul tău',
  },
  { key: 'smart', name: 'Smart', popularity: 30, roPossessive: 'Smartul tău' },
  { key: 'aro', name: 'ARO', popularity: 31, roPossessive: 'ARO\u2011ul tău' },
  { key: 'jeep', name: 'Jeep', popularity: 32, roPossessive: 'Jeepul tău' },
  {
    key: 'porsche',
    name: 'Porsche',
    popularity: 33,
    roPossessive: 'Porsche\u2011ul tău',
  },
  {
    key: 'ssangyong',
    name: 'SsangYong',
    popularity: 34,
    roPossessive: 'SsangYongul tău',
  },
  { key: 'lada', name: 'Lada', popularity: 35, roPossessive: 'Lada ta' },
  { key: 'lexus', name: 'Lexus', popularity: 36, roPossessive: 'Lexusul tău' },
  {
    key: 'subaru',
    name: 'Subaru',
    popularity: 37,
    roPossessive: 'Subaru\u2011ul tău',
  },
  {
    key: 'trabant',
    name: 'Trabant',
    popularity: 38,
    roPossessive: 'Trabantul tău',
  },
  {
    key: 'jaguar',
    name: 'Jaguar',
    popularity: 39,
    roPossessive: 'Jaguarul tău',
  },
  {
    key: 'daihatsu',
    name: 'Daihatsu',
    popularity: 40,
    roPossessive: 'Daihatsu\u2011ul tău',
  },
  { key: 'mg', name: 'MG', popularity: 41, roPossessive: 'MG\u2011ul tău' },
  { key: 'lancia', name: 'Lancia', popularity: 42, roPossessive: 'Lancia ta' },
  { key: 'rover', name: 'Rover', popularity: 43, roPossessive: 'Roverul tău' },
  { key: 'saab', name: 'Saab', popularity: 44, roPossessive: 'Saabul tău' },
  {
    key: 'chrysler',
    name: 'Chrysler',
    popularity: 45,
    roPossessive: 'Chryslerul tău',
  },
  { key: 'cupra', name: 'Cupra', popularity: 46, roPossessive: 'Cupra ta' },
  {
    key: 'vauxhall',
    name: 'Vauxhall',
    popularity: 47,
    roPossessive: 'Vauxhallul tău',
  },
  {
    key: 'dodge',
    name: 'Dodge',
    popularity: 48,
    roPossessive: 'Dodge\u2011ul tău',
  },
  {
    key: 'wartburg',
    name: 'Wartburg',
    popularity: 49,
    roPossessive: 'Wartburgul tău',
  },
  { key: 'ds', name: 'DS', popularity: 50, roPossessive: 'DS\u2011ul tău' },
  {
    key: 'moskvich',
    name: 'Moskvich',
    popularity: 51,
    roPossessive: 'Moskvichul tău',
  },
  {
    key: 'infiniti',
    name: 'Infiniti',
    popularity: 52,
    roPossessive: 'Infiniti\u2011ul tău',
  },
  {
    key: 'maserati',
    name: 'Maserati',
    popularity: 53,
    roPossessive: 'Maserati\u2011ul tău',
  },
  {
    key: 'bentley',
    name: 'Bentley',
    popularity: 54,
    roPossessive: 'Bentley\u2011ul tău',
  },
  { key: 'byd', name: 'BYD', popularity: 55, roPossessive: 'BYD\u2011ul tău' },
  {
    key: 'isuzu',
    name: 'Isuzu',
    popularity: 56,
    roPossessive: 'Isuzu\u2011ul tău',
  },
  {
    key: 'ferrari',
    name: 'Ferrari',
    popularity: 57,
    roPossessive: 'Ferrari\u2011ul tău',
  },
  {
    key: 'lamborghini',
    name: 'Lamborghini',
    popularity: 58,
    roPossessive: 'Lamborghini\u2011ul tău',
  },
  {
    key: 'rolls-royce',
    name: 'Rolls-Royce',
    popularity: 59,
    roPossessive: 'Rolls\u2011Royce\u2011ul tău',
  },
  {
    key: 'lynk-co',
    name: 'Lynk & Co',
    popularity: 60,
    roPossessive: 'Lynk & Co\u2011ul tău',
  },
  {
    key: 'leapmotor',
    name: 'Leapmotor',
    popularity: 61,
    roPossessive: 'Leapmotorul tău',
  },
  {
    key: 'aston-martin',
    name: 'Aston Martin',
    popularity: 62,
    roPossessive: 'Aston Martinul tău',
  },
  {
    key: 'mclaren',
    name: 'McLaren',
    popularity: 63,
    roPossessive: 'McLarenul tău',
  },
  { key: 'lotus', name: 'Lotus', popularity: 64, roPossessive: 'Lotusul tău' },
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
