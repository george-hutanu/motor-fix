// @traces 151-FR-005
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, 'lift-schedule.css'), 'utf8');
const rule = (selector: string) =>
  css.match(
    new RegExp(`(^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`),
  )?.[2] ?? '';

describe('the lift names in the gutter', () => {
  it('read as the board draws them: 14px, weight 600, in the primary ink', () => {
    const names = rule('.names');
    expect(names).toMatch(/font-size:\s*14px;/);
    expect(names).toMatch(/font-weight:\s*600;/);
    expect(names).toMatch(/color:\s*var\(--mf-text\);/);
  });
});
