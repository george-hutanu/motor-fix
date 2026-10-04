import { fileProblems } from './check';

const ro = (text: string) => fileProblems('garage', { a: text }, { a: 'x' });

describe('hyphen rule adversarial', () => {
  it('accepts the non-breaking hyphen between letters', () => {
    expect(ro('service‑ul s‑a într‑o')).toEqual([]);
  });

  it('reports a plain hyphen between letters naming area and key', () => {
    const problems = ro('service-ul');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('garage.a');
  });

  it('reports a short word hyphen such as s-a', () => {
    expect(ro('s-a')).toHaveLength(1);
  });

  it('reports Romanian letters with diacritics around the hyphen', () => {
    expect(ro('într-o')).toHaveLength(1);
    expect(ro('ță-ră')).toHaveLength(1);
  });

  it('reports an uppercase and a mixed-case hyphenated word', () => {
    expect(ro('SERVICE-UL')).toHaveLength(1);
    expect(ro('Service-Ul')).toHaveLength(1);
  });

  it('reports a hyphen in the middle of a longer sentence', () => {
    expect(ro('Aducem mașina la service-ul nostru azi')).toHaveLength(1);
  });

  it('reports a hyphen in a nested key naming the full key', () => {
    const problems = fileProblems(
      'garage',
      { a: { b: 'service-ul' } },
      { a: { b: 'x' } },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('garage.a.b');
  });

  it('reports each offending key once', () => {
    const problems = fileProblems(
      'garage',
      { a: 'service-ul', b: 'ok', c: 'a-b și c-d' },
      { a: 'x', b: 'x', c: 'x' },
    );
    expect(problems).toHaveLength(2);
    expect(problems.some((p) => p.includes('garage.a'))).toBe(true);
    expect(problems.some((p) => p.includes('garage.c'))).toBe(true);
  });

  it('reports a hyphen inside a plural form', () => {
    const problems = fileProblems(
      'garage',
      { n: { few: 'f', one: '1 service-ul', other: 'n' } },
      { n: { one: '1', other: 'n' } },
    );
    expect(problems.some((p) => p.includes('garage.n.one'))).toBe(true);
  });

  it('does not check English texts', () => {
    expect(fileProblems('garage', { a: 'x' }, { a: 'well-known' })).toEqual([]);
  });

  it('allows a hyphen between a letter and a digit', () => {
    expect(ro('A-1')).toEqual([]);
    expect(ro('1-A')).toEqual([]);
    expect(ro('2024-2025')).toEqual([]);
    expect(ro('10-20 km')).toEqual([]);
  });

  it('allows a hyphen next to a space', () => {
    expect(ro('- listă')).toEqual([]);
    expect(ro('mașină - nouă')).toEqual([]);
    expect(ro('Atenție -')).toEqual([]);
  });

  it('allows a leading or trailing hyphen', () => {
    expect(ro('-ul')).toEqual([]);
    expect(ro('service-')).toEqual([]);
  });

  it('allows en and em dashes and the minus sign between letters', () => {
    expect(ro('a–b a—b a−b')).toEqual([]);
  });

  it('reports a plain hyphen when another word in the text already uses the non-breaking one', () => {
    expect(ro('service‑ul și s-a')).toHaveLength(1);
  });

  it('reports each of several plain hyphens in one text only once for that key', () => {
    expect(ro('service-ul s-a într-o')).toHaveLength(1);
  });
});
