import {
  checkPanels,
  mergeLayout,
  panelKeysOf,
} from './dashboard-layouts.panels';

const ADMIN = panelKeysOf('admin') ?? [];
const all = (keys: readonly string[]) =>
  keys.map((key) => ({ key, visible: true }));

// @traces 1263-admin-dashboard-customise-FR-002
describe('the admin section list', () => {
  it('is the sections the admin overview draws today, in the brief order', () => {
    expect(ADMIN).toEqual([
      'numbers',
      'verification',
      'growth',
      'demand',
      'log',
    ]);
  });

  it('serves no driver or owner list', () => {
    for (const role of ['driver', 'owner']) {
      expect(panelKeysOf(role)).toBeUndefined();
    }
  });
});

// @traces 1263-admin-dashboard-customise-FR-003
// @traces 1263-admin-dashboard-customise-FR-009
describe('the merge on read', () => {
  it('answers the default with nothing saved', () => {
    expect(mergeLayout(ADMIN, null)).toEqual(all(ADMIN));
  });

  it('answers the default for an empty saved list', () => {
    expect(mergeLayout(ADMIN, [])).toEqual(all(ADMIN));
  });

  it('keeps the saved order and visibility', () => {
    const saved = [
      { key: 'log', visible: false },
      { key: 'demand', visible: true },
      { key: 'growth', visible: false },
      { key: 'verification', visible: true },
      { key: 'numbers', visible: true },
    ];

    expect(mergeLayout(ADMIN, saved)).toEqual(saved);
  });

  it('appends a key the record lacks, visible, in the list order', () => {
    const saved = [
      { key: 'log', visible: false },
      { key: 'numbers', visible: false },
    ];

    expect(mergeLayout(ADMIN, saved)).toEqual([
      { key: 'log', visible: false },
      { key: 'numbers', visible: false },
      { key: 'verification', visible: true },
      { key: 'growth', visible: true },
      { key: 'demand', visible: true },
    ]);
  });

  it('leaves out a key the list no longer holds', () => {
    const saved = [
      { key: 'retired', visible: true },
      { key: 'log', visible: false },
    ];

    expect(mergeLayout(ADMIN, saved).map((p) => p.key)).toEqual([
      'log',
      'numbers',
      'verification',
      'growth',
      'demand',
    ]);
  });

  it('ignores a malformed stored entry', () => {
    const saved = [{ key: 'log' }, 'numbers', null] as unknown[];

    expect(mergeLayout(ADMIN, saved)).toEqual(all(ADMIN));
  });
});

// @traces 1263-admin-dashboard-customise-FR-004
// @traces 1263-admin-dashboard-customise-FR-009
describe('the check of a save', () => {
  it('accepts every key once, in any order', () => {
    expect(checkPanels(ADMIN, [...all(ADMIN)].reverse())).toBeNull();
  });

  it('accepts a list that lacks some keys', () => {
    expect(checkPanels(ADMIN, [{ key: 'log', visible: false }])).toBeNull();
  });

  it('refuses a key not in the list', () => {
    expect(checkPanels(ADMIN, [{ key: 'reported', visible: true }])).toBe(
      'unknown_key',
    );
  });

  it('compares keys exactly, case and all', () => {
    expect(checkPanels(ADMIN, [{ key: 'Log', visible: true }])).toBe(
      'unknown_key',
    );
  });

  it('refuses a key listed twice', () => {
    expect(
      checkPanels(ADMIN, [
        { key: 'log', visible: true },
        { key: 'log', visible: false },
      ]),
    ).toBe('duplicate_key');
  });
});
