import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// The floors the full runs set; a floor may only rise.
const floors: Record<string, [string, number]> = {
  api: ['apps/api', 95],
  contracts: ['libs/contracts', 95],
  domain: ['libs/domain', 0],
  i18n: ['libs/i18n', 85],
  mcp: ['apps/mcp', 95],
  media: ['libs/media', 85],
  overlays: ['libs/overlays', 76],
  scripts: ['scripts', 46],
  'ui-cockpit': ['libs/ui-cockpit', 66],
  web: ['apps/web', 79],
  worker: ['apps/worker', 0],
};

describe('every project floor', () => {
  it.each(Object.entries(floors))(
    '%s keeps an integer floor no lower than recorded, at most 100, low under high',
    (_name, [dir, recorded]) => {
      const { thresholds } = JSON.parse(read(`${dir}/stryker.config.json`));

      expect(Number.isInteger(thresholds.break)).toBe(true);
      expect(thresholds.break).toBeGreaterThanOrEqual(recorded);
      expect(thresholds.break).toBeLessThanOrEqual(100);
      expect(thresholds.low).toBeLessThan(thresholds.high);
    },
  );
});
