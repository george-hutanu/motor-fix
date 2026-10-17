import { DRIVER_PANELS, type LayoutEntry, panelsToDraw } from './driver-panels';

const show = (...keys: string[]): LayoutEntry[] =>
  keys.map((key) => ({ hidden: false, key }));
const hide = (...keys: string[]): LayoutEntry[] =>
  keys.map((key) => ({ hidden: true, key }));

const DEFAULT = ['active_request', 'quotes', 'cars', 'history', 'saved'];

// @traces 029-FR-010
describe('the panel registry', () => {
  it('lists the eight keys once each in the default order', () => {
    expect(DRIVER_PANELS.map((p) => p.key)).toEqual([
      'active_request',
      'live',
      'quotes',
      'cars',
      'mileage',
      'spend',
      'history',
      'saved',
    ]);
  });

  it('marks only live, mileage and spend as unreleased', () => {
    expect(DRIVER_PANELS.filter((p) => !p.released).map((p) => p.key)).toEqual([
      'live',
      'mileage',
      'spend',
    ]);
  });
});

// @traces 029-FR-011
describe('the layout merge', () => {
  it('returns the released panels for no layout', () => {
    expect(panelsToDraw(null)).toEqual(DEFAULT);
  });

  it('treats an empty layout like none', () => {
    expect(panelsToDraw([])).toEqual(DEFAULT);
  });

  it('draws a layout naming only unreleased panels as the default', () => {
    expect(panelsToDraw(show('live', 'mileage', 'spend'))).toEqual(DEFAULT);
  });

  it('never draws an unreleased panel the layout shows', () => {
    expect(panelsToDraw(show('spend', 'cars', 'live'))).not.toContain('spend');
  });

  it('draws nothing for a layout hiding every released panel', () => {
    expect(panelsToDraw(hide(...DEFAULT))).toEqual([]);
  });

  it('keeps a hidden panel out and does not reinsert it as omitted', () => {
    expect(panelsToDraw(hide('history'))).toEqual(
      DEFAULT.filter((k) => k !== 'history'),
    );
  });

  it('counts a repeated key once at its first place', () => {
    expect(
      panelsToDraw(show('saved', 'cars', 'saved', 'history', 'quotes')),
    ).toEqual(['active_request', 'saved', 'cars', 'history', 'quotes']);
  });

  it('keeps a key hidden at its first entry hidden when repeated shown', () => {
    expect(panelsToDraw([...hide('cars'), ...show('cars')])).not.toContain(
      'cars',
    );
  });

  it('keeps a key shown at its first entry when repeated hidden', () => {
    expect(panelsToDraw([...show('cars'), ...hide('cars')])).toContain('cars');
  });

  it('places omitted panels after their nearest default predecessor held', () => {
    expect(panelsToDraw(show('saved', 'cars'))).toEqual([
      'active_request',
      'quotes',
      'saved',
      'cars',
      'history',
    ]);
  });

  it('puts an omitted panel first when nothing before it is held', () => {
    expect(panelsToDraw(show('history', 'saved'))[0]).toBe('active_request');
  });

  it('places an omitted panel after an unreleased predecessor skipped over', () => {
    expect(panelsToDraw(show('active_request', 'cars'))).toEqual([
      'active_request',
      'quotes',
      'cars',
      'history',
      'saved',
    ]);
  });

  it('ignores keys no panel has, including prototype names', () => {
    expect(
      panelsToDraw(
        show(
          '__proto__',
          'constructor',
          'toString',
          'CARS',
          ' cars',
          '',
          'cars',
        ),
      ),
    ).toEqual(['active_request', 'quotes', 'cars', 'history', 'saved']);
  });

  it('returns a stable result for the same layout twice', () => {
    const layout = show('saved', 'cars');
    expect(panelsToDraw(layout)).toEqual(panelsToDraw(layout));
  });

  it('does not modify a frozen layout or the registry', () => {
    const layout = Object.freeze(show('saved', 'cars'));
    const before = JSON.stringify(DRIVER_PANELS);
    panelsToDraw(layout);
    expect(JSON.stringify(DRIVER_PANELS)).toBe(before);
  });

  it('puts cars first and drops history for the spec example', () => {
    const out = panelsToDraw([...show('cars'), ...hide('history')]);
    expect(out[0]).toBe('active_request');
    expect(out).not.toContain('history');
  });

  it('handles a layout of ten thousand entries', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => ({
      hidden: false,
      key: `k${i}`,
    }));
    expect(panelsToDraw(big)).toEqual(DEFAULT);
  });
});
