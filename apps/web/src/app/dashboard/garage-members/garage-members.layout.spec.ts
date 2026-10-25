// @traces 102-FR-012
// QA lap 1 (#551): the Persoane cu acces panel is a card in the Setări column like its neighbours,
// its rows a card list on the 4 px grid, one-line rows centred.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = (name: string) =>
  readFileSync(join(__dirname, '..', name, `${name}.css`), 'utf8');
const rule = (text: string, selector: string) => {
  const match = new RegExp(
    `(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`,
  ).exec(text);
  return match?.[2] ?? '';
};
const decl = (body: string, prop: string) =>
  new RegExp(`(^|[;\\s])${prop}:\\s*([^;]+);`).exec(body)?.[2].trim();

describe('garage members panel layout', () => {
  const members = css('garage-members');
  const switches = css('feature-switches');

  it.each(['margin', 'padding', 'border', 'border-radius'])(
    'the panel card has the Funcții card %s',
    (prop) => {
      expect(decl(rule(members, '.panel'), prop)).toBe(
        decl(rule(switches, 'section'), prop),
      );
    },
  );

  it('keeps every gap on the 4 px grid', () => {
    expect(members).not.toMatch(/gap:\s*[\d.]+ch/);
    expect(members).not.toMatch(/gap:\s*[\d.]+px/);
  });

  it('centres one-line rows instead of leaving a band under the text', () => {
    expect(decl(rule(members, '.row'), 'align-items')).toBe('center');
  });

  it('titles the panel as a card, not a small label', () => {
    const h2Rules = members
      .split('}')
      .filter((block) => /(^|[\s,])h2[\s,{]/.test(block.split('{')[0] + '{'));
    expect(h2Rules.length).toBeGreaterThan(0);
    for (const block of h2Rules)
      expect(block).not.toMatch(/text-transform|font-size/);
  });
});
