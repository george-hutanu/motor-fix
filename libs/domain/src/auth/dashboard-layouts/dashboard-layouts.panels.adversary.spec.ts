import {
  checkPanels,
  mergeLayout,
  panelKeysOf,
} from './dashboard-layouts.panels';

const ADMIN: readonly string[] = panelKeysOf('admin') ?? [];
const DEFAULT = ADMIN.map((key) => ({ key, visible: true }));

// @traces 1263-admin-dashboard-customise-FR-006
describe('panelKeysOf on hostile role names', () => {
  it.each([
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'Admin',
    ' admin',
    'admin ',
    'admin\u0000',
    'аdmin',
    '',
    'driver',
    'garage',
  ])('serves no list for %j', (role) => {
    expect(panelKeysOf(role)).toBeUndefined();
  });

  it('serves the admin list for admin', () => {
    expect(panelKeysOf('admin')).toEqual([
      'numbers',
      'verification',
      'growth',
      'demand',
      'log',
    ]);
  });
});

// @traces 1263-admin-dashboard-customise-FR-003
describe('mergeLayout on hostile saved lists', () => {
  it('answers the default for an empty key list and anything saved', () => {
    expect(mergeLayout([], [{ key: 'log', visible: false }])).toEqual([]);
  });

  it('keeps the first of a key saved twice', () => {
    const merged = mergeLayout(ADMIN, [
      { key: 'log', visible: false },
      { key: 'log', visible: true },
    ]);
    expect(merged[0]).toEqual({ key: 'log', visible: false });
    expect(merged.filter((p) => p.key === 'log')).toHaveLength(1);
  });

  it('ignores null, primitive and array entries and still answers the full list', () => {
    const merged = mergeLayout(ADMIN, [
      null,
      undefined,
      1,
      'log',
      ['log', true],
      { key: 'log' },
      { key: 'log', visible: 'false' },
      { key: 'log', visible: 0 },
      { key: 5, visible: true },
    ]);
    expect(merged).toEqual(DEFAULT);
  });

  it('does not treat prototype names as keys', () => {
    const merged = mergeLayout(ADMIN, [
      { key: '__proto__', visible: false },
      { key: 'constructor', visible: false },
      { key: 'toString', visible: false },
    ]);
    expect(merged).toEqual(DEFAULT);
  });

  it('compares keys exactly: case, spaces and unicode lookalikes are unknown', () => {
    const merged = mergeLayout(ADMIN, [
      { key: 'Log', visible: false },
      { key: ' log', visible: false },
      { key: 'log\n', visible: false },
      { key: 'lоg', visible: false },
    ]);
    expect(merged).toEqual(DEFAULT);
  });

  it('strips extra fields from a stored entry', () => {
    const merged = mergeLayout(ADMIN, [
      { extra: 'x', key: 'log', visible: false },
    ]);
    expect(merged[0]).toStrictEqual({ key: 'log', visible: false });
  });

  it('answers a fresh list each call and never edits what it was given', () => {
    const saved = Object.freeze([
      Object.freeze({ key: 'log', visible: false }),
    ]);
    const first = mergeLayout(ADMIN, saved);
    first[0].visible = true;
    first.pop();
    expect(mergeLayout(ADMIN, saved)).toEqual([
      { key: 'log', visible: false },
      ...ADMIN.filter((k) => k !== 'log').map((key) => ({
        key,
        visible: true,
      })),
    ]);
    expect(ADMIN).toEqual([
      'numbers',
      'verification',
      'growth',
      'demand',
      'log',
    ]);
  });

  it('is idempotent: merging a merged layout changes nothing', () => {
    const once = mergeLayout(ADMIN, [
      { key: 'demand', visible: false },
      { key: 'gone', visible: true },
    ]);
    expect(mergeLayout(ADMIN, once)).toEqual(once);
  });

  it('answers a complete list for ten thousand junk entries', () => {
    const junk = Array.from({ length: 10_000 }, (_, i) => ({
      key: `k${i}`,
      visible: i % 2 === 0,
    }));
    expect(mergeLayout(ADMIN, junk)).toEqual(DEFAULT);
  });

  it('keeps a fully hidden saved layout hidden', () => {
    const hidden = ADMIN.map((key) => ({ key, visible: false }));
    expect(mergeLayout(ADMIN, hidden)).toEqual(hidden);
  });
});

// @traces 1263-admin-dashboard-customise-FR-004
describe('checkPanels on hostile lists', () => {
  it('accepts an empty list', () => {
    expect(checkPanels(ADMIN, [])).toBeNull();
  });

  it('accepts one key', () => {
    expect(checkPanels(ADMIN, [{ key: 'log', visible: false }])).toBeNull();
  });

  it.each(['__proto__', 'constructor', 'toString', 'length', '0'])(
    'refuses the prototype or index name %j as unknown',
    (key) => {
      expect(checkPanels(ADMIN, [{ key, visible: true }])).toBe('unknown_key');
    },
  );

  it.each(['Log', ' log', 'log ', 'LOG', '', 'lоg'])(
    'refuses %j as unknown',
    (key) => {
      expect(checkPanels(ADMIN, [{ key, visible: true }])).toBe('unknown_key');
    },
  );

  it('reports a duplicate of a known key', () => {
    expect(
      checkPanels(ADMIN, [
        { key: 'log', visible: true },
        { key: 'log', visible: true },
      ]),
    ).toBe('duplicate_key');
  });

  it('refuses a list with an unknown key after good ones', () => {
    expect(
      checkPanels(ADMIN, [...DEFAULT, { key: 'performance', visible: true }]),
    ).toBe('unknown_key');
  });

  it('refuses the unshipped sections performance, system and reported', () => {
    for (const key of ['performance', 'system', 'reported'])
      expect(checkPanels(ADMIN, [{ key, visible: true }])).toBe('unknown_key');
  });

  it('accepts the full list in reverse order', () => {
    expect(checkPanels(ADMIN, [...DEFAULT].reverse())).toBeNull();
  });
});
