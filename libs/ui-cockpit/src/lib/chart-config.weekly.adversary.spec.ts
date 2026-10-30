import { type ChartPoint, chartConfig, readTheme } from './chart-config';

type ChartTheme = ReturnType<typeof readTheme>;
type Loose = any;

const theme: ChartTheme = {
  amber: '#ffb000',
  bg: '#101010',
  font: 'sans-serif',
  labelSize: 12,
  line: '#333333',
  text: '#ffffff',
  textSecondary: '#aaaaaa',
};

const cfg = (
  points: ChartPoint[],
  lastLabel = true,
  horizontal = false,
  language: 'ro' | 'en' = 'ro',
): Loose =>
  chartConfig(
    'bar',
    points,
    'count',
    language,
    theme,
    true,
    horizontal,
    undefined,
    lastLabel,
  );

const label = (config: Loose) => config.options.plugins['mf-last-label'];

describe('the shared chart newest-bar label and value-less points', () => {
  // @traces 1397-FR-009
  it('writes the last non-null value when trailing points are null', () => {
    const config = cfg([
      { label: 'a', value: 5 },
      { label: 'b', value: 1240 },
      { label: 'c', value: null },
    ]);

    expect(label(config)).toEqual(
      expect.objectContaining({ index: 1, text: '1.240' }),
    );
  });

  // @traces 1397-FR-009
  it('writes a zero on the newest bar', () => {
    const config = cfg([
      { label: 'a', value: 5 },
      { label: 'b', value: 0 },
    ]);

    expect(label(config)).toEqual(
      expect.objectContaining({ index: 1, text: '0' }),
    );
  });

  // @traces 1397-FR-009
  it('writes no label when every point is null, and labels once values arrive', () => {
    const config = cfg([
      { label: 'a', value: null },
      { label: 'b', value: null },
    ]);

    expect(label(config)).toBeUndefined();
    const ctx = {
      fillText: jest.fn(),
      measureText: () => ({ width: 2 }),
      restore: jest.fn(),
      save: jest.fn(),
    };
    const chart = { ctx, getDatasetMeta: jest.fn(), width: 100 };
    config.plugins[0].afterDatasetsDraw(chart, {}, {});
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(chart.getDatasetMeta).not.toHaveBeenCalled();

    const filled = cfg([
      { label: 'a', value: null },
      { label: 'b', value: 7 },
    ]);
    chart.getDatasetMeta.mockReturnValue({ data: [undefined, { x: 1, y: 9 }] });
    config.plugins[0].afterDatasetsDraw(chart, {}, label(filled));
    expect(ctx.fillText).toHaveBeenCalledWith('7', 1, 5);
  });

  // @traces 1397-FR-009
  it('adds no label for an empty list of points', () => {
    const config = cfg([]);

    expect(label(config)).toBeUndefined();
    expect(config.data.labels).toEqual([]);
  });

  // @traces 1397-FR-009
  it('adds no label and no plugin when the flag is off', () => {
    const config = cfg([{ label: 'a', value: 3 }], false);

    expect(label(config)).toBeUndefined();
    expect(config.plugins ?? []).toEqual([]);
  });

  // @traces 1397-FR-009
  it('writes no label on a horizontal chart', () => {
    const config = cfg([{ label: 'a', value: 3 }], true, true);

    expect(label(config)).toBeUndefined();
  });

  // @traces 1397-FR-009
  it('writes the label with the language grouping', () => {
    const points = [{ label: 'a', value: 1240 }];

    expect(label(cfg(points, true, false, 'en')).text).toBe('1,240');
    expect(label(cfg(points, true, false, 'ro')).text).toBe('1.240');
  });

  // @traces 1397-FR-009
  it('keeps a null point as null data so no bar is drawn', () => {
    const config = cfg([
      { label: 'a', value: null },
      { label: 'b', value: 2 },
    ]);

    expect(config.data.datasets[0].data).toEqual([null, 2]);
  });

  // @traces 1397-FR-004 1397-FR-009
  it('uses the point tooltip text as the whole line and falls back to label and value', () => {
    const config = cfg([
      { label: 'a', tooltip: 'custom line', value: 4 },
      { label: 'b', value: 6 },
    ]);
    const callback = config.options.plugins.tooltip.callbacks.label;

    expect(callback({ dataIndex: 0, dataset: {}, label: 'a', raw: 4 })).toBe(
      'custom line',
    );
    expect(callback({ dataIndex: 1, dataset: {}, label: 'b', raw: 6 })).toBe(
      'b · 6',
    );
  });

  // @traces 1397-FR-004 1397-FR-009
  it('shows no tooltip for a null point even when it carries tooltip text', () => {
    const config = cfg([{ label: 'a', tooltip: 'custom', value: null }]);
    const filter = config.options.plugins.tooltip.filter;

    expect(filter({ raw: null })).toBe(false);
    expect(filter({ raw: 0 })).toBe(true);
  });

  // @traces 1397-FR-009
  it('produces the same configuration with and without the flag when no extension is used', () => {
    const points = [
      { label: 'a', value: 1 },
      { label: 'b', value: 2 },
    ];
    const strip = (c: Loose) =>
      JSON.stringify(c, (_k, v) => (typeof v === 'function' ? 'fn' : v));

    const off = strip(cfg(points, false));
    const unset = strip(chartConfig('bar', points, 'count', 'ro', theme, true));

    expect(off).toBe(unset);
  });
});
