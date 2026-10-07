// The brand list MotorFix keeps. A brand is matched by its `key` across
// loads, so a key never changes once shipped; renaming a brand changes only
// its name. A brand removed from this list is retired, never deleted.
export interface BrandRecord {
  key: string;
  name: string;
  // 1 is the most popular; an unranked brand sorts after every ranked one.
  popularity?: number;
}

export const BRANDS: readonly BrandRecord[] = [
  { key: 'bmw', name: 'BMW', popularity: 1 },
  { key: 'mini', name: 'Mini', popularity: 2 },
  { key: 'mercedes-benz', name: 'Mercedes-Benz', popularity: 3 },
  { key: 'audi', name: 'Audi', popularity: 4 },
  { key: 'volkswagen', name: 'Volkswagen', popularity: 5 },
  { key: 'skoda', name: 'Škoda', popularity: 6 },
  { key: 'dacia', name: 'Dacia', popularity: 7 },
  { key: 'renault', name: 'Renault', popularity: 8 },
  { key: 'ford', name: 'Ford', popularity: 9 },
  { key: 'toyota', name: 'Toyota', popularity: 10 },
  { key: 'hyundai', name: 'Hyundai', popularity: 11 },
  { key: 'tesla', name: 'Tesla', popularity: 12 },
];

export class BrandFileError extends Error {}

export const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

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
