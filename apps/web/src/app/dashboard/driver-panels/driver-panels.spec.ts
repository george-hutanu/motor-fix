import { DRIVER_PANELS, panelsToDraw } from './driver-panels';

type LayoutEntry = { hidden: boolean; key: string };

const DEFAULT = ['active_request', 'quotes', 'cars', 'history', 'saved'];

const layout = (...keys: string[]): LayoutEntry[] =>
  keys.map((key) => ({ hidden: false, key }));

// @traces 029-FR-010
describe('the driver’s panel registry', () => {
  it('holds every panel in its default order, with its width and release flag', () => {
    expect(DRIVER_PANELS).toEqual([
      { key: 'active_request', released: true, wide: true },
      { key: 'live', released: false, wide: false },
      { key: 'quotes', released: true, wide: false },
      { key: 'cars', released: true, wide: false },
      { key: 'mileage', released: false, wide: false },
      { key: 'spend', released: false, wide: false },
      { key: 'history', released: true, wide: true },
      { key: 'saved', released: true, wide: true },
    ]);
  });
});

// @traces 029-FR-011
describe('a layout merged onto the registry', () => {
  it('draws the released panels in default order with no layout', () => {
    expect(panelsToDraw(null)).toEqual(DEFAULT);
  });

  it('treats an empty layout as none', () => {
    expect(panelsToDraw([])).toEqual(DEFAULT);
  });

  it('follows a full layout’s order and leaves its hidden panels out', () => {
    expect(
      panelsToDraw([
        { hidden: false, key: 'cars' },
        { hidden: true, key: 'history' },
        { hidden: false, key: 'quotes' },
        { hidden: false, key: 'active_request' },
        { hidden: false, key: 'saved' },
      ]),
    ).toEqual(['cars', 'quotes', 'active_request', 'saved']);
  });

  it('ignores a key no panel has', () => {
    expect(
      panelsToDraw(
        layout(
          'assistant',
          'cars',
          'quotes',
          'active_request',
          'history',
          'saved',
        ),
      ),
    ).toEqual(['cars', 'quotes', 'active_request', 'history', 'saved']);
  });

  it('puts a panel the layout omits right after the nearest one before it in the default order', () => {
    expect(
      panelsToDraw(layout('history', 'saved', 'active_request', 'quotes')),
    ).toEqual(['history', 'saved', 'active_request', 'quotes', 'cars']);
  });

  it('puts an omitted panel first when no panel before it is drawn', () => {
    expect(panelsToDraw(layout('cars', 'quotes', 'history', 'saved'))).toEqual([
      'active_request',
      'cars',
      'quotes',
      'history',
      'saved',
    ]);
  });

  it('never draws a panel behind an off release flag, whatever the layout says', () => {
    expect(panelsToDraw(layout('live', 'mileage', 'spend', 'cars'))).toEqual(
      DEFAULT,
    );
  });

  it('counts a repeated key once, at its first place', () => {
    expect(
      panelsToDraw([
        ...layout('cars', 'quotes'),
        { hidden: true, key: 'cars' },
        ...layout('active_request', 'history', 'saved', 'quotes'),
      ]),
    ).toEqual(['cars', 'quotes', 'active_request', 'history', 'saved']);
  });
});
