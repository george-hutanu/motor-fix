// Each tile's limits, in its own units. The values live in configuration only.
const FIELDS = {
  api: ['amber_ms', 'red_ms'],
  backup: ['amber_h', 'red_h'],
  email: ['amber_ms', 'red_ms', 'amber_share', 'red_share'],
  maps: ['amber_ms', 'red_ms'],
  notifications: ['amber_age_s', 'red_age_s', 'amber_share', 'red_share'],
  search: ['amber_ms', 'red_ms'],
} as const;

type Fields = typeof FIELDS;
export type Thresholds = {
  [Tile in keyof Fields]: Record<Fields[Tile][number], number>;
};
export type Limits = Partial<Record<Fields[keyof Fields][number], number>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const fail = (why: string): never => {
  throw new Error(`STATUS_THRESHOLDS ${why}`);
};

const read = (raw: string | undefined): unknown => {
  if (!raw) return fail('is not set');
  try {
    return JSON.parse(raw);
  } catch {
    return fail('is not JSON');
  }
};

const checkTile = (
  tile: string,
  fields: readonly string[],
  limits: unknown,
) => {
  if (!isObject(limits) || !sameKeys(limits, fields)) {
    return fail(`${tile} must name exactly ${fields.join(', ')}`);
  }
  for (const field of fields) {
    const limit = limits[field];
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      fail(`${tile}.${field} must be a number of 0 or more`);
    }
    if (field.endsWith('_share') && (limit as number) > 1) {
      fail(`${tile}.${field} is a share and must be 1 or less`);
    }
  }
};

export function parseThresholds(raw: string | undefined): Thresholds {
  const value = read(raw);
  if (!isObject(value)) return fail('is not an object');
  if (!sameKeys(value, Object.keys(FIELDS))) {
    return fail(`must name exactly ${Object.keys(FIELDS).join(', ')}`);
  }
  for (const [tile, fields] of Object.entries(FIELDS)) {
    checkTile(tile, fields, value[tile]);
  }
  return value as Thresholds;
}
