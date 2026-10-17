import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseThresholds } from './thresholds';

// Fixture limits: not the build team's defaults.
const fixture = {
  api: { amber_ms: 10, red_ms: 20 },
  backup: { amber_h: 1, red_h: 2 },
  email: { amber_ms: 11, amber_share: 0.2, red_ms: 21, red_share: 0.4 },
  maps: { amber_ms: 12, red_ms: 22 },
  notifications: {
    amber_age_s: 13,
    amber_share: 0.3,
    red_age_s: 23,
    red_share: 0.6,
  },
  search: { amber_ms: 14, red_ms: 24 },
};

const without = (tile: keyof typeof fixture, field?: string) => {
  const copy: Record<string, Record<string, number>> = structuredClone(fixture);
  if (field) delete copy[tile]?.[field];
  else delete copy[tile];
  return JSON.stringify(copy);
};

const withValue = (value: unknown) =>
  JSON.stringify({ ...fixture, api: { ...fixture.api, red_ms: value } });

// @traces 294-FR-001
// @traces 294-FR-005
describe('the STATUS_THRESHOLDS setting', () => {
  it('reads every tile and limit of a full value', () => {
    expect(parseThresholds(JSON.stringify(fixture))).toEqual(fixture);
  });

  it('accepts zero as a limit', () => {
    expect(parseThresholds(withValue(0)).api.red_ms).toBe(0);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not JSON', '{api:'],
    ['not an object', '[1,2]'],
    ['null', 'null'],
    ['missing a tile', without('backup')],
    ['missing a field', without('email', 'red_share')],
    ['a tile not an object', JSON.stringify({ ...fixture, api: 5 })],
    [
      'an unknown tile',
      JSON.stringify({ ...fixture, weather: { amber_ms: 1, red_ms: 2 } }),
    ],
    [
      'an unknown field',
      JSON.stringify({ ...fixture, api: { ...fixture.api, amber_h: 1 } }),
    ],
    ['a string limit', withValue('20')],
    ['a negative limit', withValue(-1)],
    ['a null limit', withValue(null)],
    ['a non-finite limit', '{"api":{"amber_ms":10,"red_ms":1e999}}'],
  ])('refuses a value that is %s, naming the setting', (_, raw) => {
    expect(() => parseThresholds(raw)).toThrow(/STATUS_THRESHOLDS/);
  });

  it('keeps no limit in the product code: every value comes from the setting', () => {
    const dir = __dirname;
    for (const file of ['thresholds.ts', 'tiles.ts', 'run.ts']) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source).not.toMatch(/(amber|red)_(ms|share|age_s|h)\s*:\s*\d/);
    }
  });
});
