import { scrub, scrubDeep } from './scrub';

describe('scrub with hostile text', () => {
  it.each([
    ['call +40722123456 now', 'call *** now'],
    ['call 0040 722 123 456 now', 'call *** now'],
    ['call +40 722.123.456 now', 'call *** now'],
    ['call 0722 123 456.', 'call ***.'],
    ['(0722123456)', '(***)'],
    ['tel:0722123456;', 'tel:***;'],
  ])('masks the phone in %j', (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it.each([
    ['plate b 123 abc here', 'plate *** here'],
    ['plate B123ABC here', 'plate *** here'],
    ['plate cj 12 abc here', 'plate *** here'],
    ['plate B 12 ABC,', 'plate ***,'],
    ['{"plate":"B 123 ABC"}', '{"plate":"***"}'],
  ])('masks the plate in %j', (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it.each([
    [
      'https://x.ro/reset?email=ana@example.ro&next=/home',
      'https://x.ro/reset?email=***&next=/home',
    ],
    ['{"email":"ana@example.ro","n":1}', '{"email":"***","n":1}'],
    ['<ana@example.ro>', '<***>'],
    ['ANA.POP@EXAMPLE.RO', '***'],
    ['mailto:ana@example.ro?subject=hi', 'mailto:***?subject=hi'],
    ['ana@example.ro,bob@example.ro', '***,***'],
    ['ană@exemplu.ro wrote', '*** wrote'],
  ])('masks the e-mail in %j', (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '***',
    'status 500 in 1234567 ms',
    'ip 192.168.100.200',
    'at 2026-10-08T10:30:00.123Z',
    'GET /api/v1/garages/9f1c2d3e-7c1e-4a49-9d0e-6c1d2f6f0a11/slots',
    'build abc1234 deployed',
    'unicode \u{1F697} ăîș text',
  ])('leaves %j unchanged', (input) => {
    expect(scrub(input)).toBe(input);
  });

  it('is idempotent', () => {
    const once = scrub('ana@example.ro 0722123456 B 123 ABC');
    expect(once).toBe('*** *** ***');
    expect(scrub(once)).toBe(once);
  });

  it('masks every occurrence in a long message', () => {
    const input = Array.from({ length: 5000 }, () => 'a@b.ro').join(' ');
    expect(scrub(input)).toBe(
      Array.from({ length: 5000 }, () => '***').join(' '),
    );
  });

  it.each([
    ['a long local part without a domain', `${'a'.repeat(200_000)}@`],
    ['many digit groups', '0 '.repeat(100_000)],
    ['many dots', `${'a.'.repeat(100_000)}@`],
    ['many letters and spaces', 'B '.repeat(100_000)],
    ['a long digit run', '1'.repeat(200_000)],
  ])('finishes quickly on %s', (_name, input) => {
    const started = Date.now();
    scrub(input);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('scrubDeep with hostile values', () => {
  it('keeps non-string leaves as they are', () => {
    const date = new Date(0);
    expect(
      scrubDeep({ a: null, b: undefined, c: 0, d: false, e: date, f: 10n }),
    ).toEqual({ a: null, b: undefined, c: 0, d: false, e: date, f: 10n });
  });

  it.each([null, undefined, 7, true])('returns the primitive %p', (value) => {
    expect(scrubDeep(value)).toBe(value);
  });

  it('returns a masked string for a bare string', () => {
    expect(scrubDeep('ana@example.ro')).toBe('***');
  });

  it('masks inside arrays of arrays and objects in arrays', () => {
    expect(scrubDeep([['a@b.ro'], [{ k: ['0722123456', 'ok'] }], []])).toEqual([
      ['***'],
      [{ k: ['***', 'ok'] }],
      [],
    ]);
  });

  it('does not mutate its input', () => {
    const input = {
      email: 'a@b.ro',
      list: ['0722123456'],
      nested: { p: 'B 12 ABC' },
    };
    const copy = structuredClone(input);
    const out = scrubDeep(input);
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
    expect(out).toEqual({ email: '***', list: ['***'], nested: { p: '***' } });
  });

  it('survives a cyclic object and masks the strings in it', () => {
    const node: Record<string, unknown> = { email: 'a@b.ro' };
    node['self'] = node;
    const out = scrubDeep(node) as Record<string, unknown>;
    expect(out['email']).toBe('***');
  });

  it('survives a cycle through an array', () => {
    const list: unknown[] = ['a@b.ro'];
    list.push(list);
    const out = scrubDeep(list) as unknown[];
    expect(out[0]).toBe('***');
  });

  it('handles ten thousand elements', () => {
    const out = scrubDeep(
      Array.from({ length: 10_000 }, () => 'a@b.ro'),
    ) as string[];
    expect(out).toHaveLength(10_000);
    expect(out.every((v) => v === '***')).toBe(true);
  });

  it('handles an object with a null prototype', () => {
    const input = Object.assign(Object.create(null), { email: 'a@b.ro' });
    expect(scrubDeep(input)).toEqual({ email: '***' });
  });

  it('does not pollute prototypes through a __proto__ key', () => {
    const input = JSON.parse('{"__proto__":{"polluted":"a@b.ro"}}');
    scrubDeep(input);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('masks the message of an error object without changing the original', () => {
    const error = new Error('failed for ana@example.ro');
    const out = scrubDeep({ error }) as { error: { message?: string } };
    expect(error.message).toBe('failed for ana@example.ro');
    expect(JSON.stringify(out)).not.toContain('ana@example.ro');
  });
});
