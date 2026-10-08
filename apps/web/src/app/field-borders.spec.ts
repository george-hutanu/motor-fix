import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// ST-954 FR-005: a text field's border is what shows where to type, so it
// needs 3:1 against the colour behind it. `--mf-line-strong` is the token
// that reaches it; `--mf-line` is the decorative divider and does not.
const FIELD = /(^|[\s,>+~(])(input|select|textarea)\b/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

function fieldRulesOnFaintLine(css: string): string[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const [, selector, body] of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const fields = selector
      .split(',')
      .map((part) => part.trim())
      .filter((part) => {
        const own = part.replace(/:not\([^)]*\)/g, '');
        return FIELD.test(own) && !/type=["']?(checkbox|radio)/.test(own);
      });
    if (!fields.length) continue;
    if (/border(-color)?\s*:[^;]*var\(--mf-line\)/.test(body)) {
      found.push(fields.join(', '));
    }
  }
  return found;
}

describe('field borders (ST-954 FR-005)', () => {
  it('finds a field rule drawn with the faint line', () => {
    expect(
      fieldRulesOnFaintLine(
        'select,\ninput { border: 1px solid var(--mf-line); }',
      ),
    ).toEqual(['select, input']);
    expect(
      fieldRulesOnFaintLine(
        'input { border: 1px solid var(--mf-line-strong); }',
      ),
    ).toEqual([]);
    expect(
      fieldRulesOnFaintLine('.manual { border: 1px solid var(--mf-line); }'),
    ).toEqual([]);
    expect(
      fieldRulesOnFaintLine(
        'input:not([type="checkbox"]) { border: 1px solid var(--mf-line); }\ninput[type="checkbox"] { border: 1px solid var(--mf-line); }',
      ),
    ).toEqual(['input:not([type="checkbox"])']);
  });

  it('draws every web app field border with --mf-line-strong', () => {
    const root = join(__dirname);
    const offenders = cssFiles(root).flatMap((file) =>
      fieldRulesOnFaintLine(readFileSync(file, 'utf8')).map(
        (selector) => `${relative(root, file)}: ${selector}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
