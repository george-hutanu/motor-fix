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
      .filter((block) => /(^|[\s,])h2[\s,{]/.test(`${block.split('{')[0]}{`));
    expect(h2Rules.length).toBeGreaterThan(0);
    for (const block of h2Rules)
      expect(block).not.toMatch(/text-transform|font-size/);
  });

  // QA lap 2: a wrapped phone row never starts its next line with " · ".
  it('keeps each " · " in its own separator span, stacked without it below a tablet', () => {
    const html = readFileSync(join(__dirname, 'garage-members.html'), 'utf8');
    expect(html).not.toMatch(/<span(?! class="sep")[^>]*>\s*·/);
    expect(html.match(/<span class="sep"> · <\/span>/g)?.length).toBe(5);
    const phone =
      /@media \(max-width: 767px\)\s*\{([\s\S]*?)\n\}/.exec(members)?.[1] ?? '';
    expect(
      decl(rule(phone.replace(/\n {2}/g, '\n'), '.row'), 'flex-direction'),
    ).toBe('column');
    expect(rule(phone.replace(/\n {2}/g, '\n'), '.sep')).toMatch(
      /clip-path: inset\(50%\)/,
    );
  });
});
