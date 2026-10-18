import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chartConfig, nameLines, readTheme } from './chart-config';

type ChartTheme = ReturnType<typeof readTheme>;

const css = readFileSync(join(__dirname, '../styles/cockpit.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--mf-[\w-]+)\s*:\s*([^;]+);/g)].map(([, n, v]) => [
      n,
      v.trim(),
    ]),
  );
}

const darkTokens = tokens(css.slice(0, css.indexOf('@media')));
const lightTokens = tokens(
  css.slice(css.indexOf('@media (prefers-color-scheme: light)')),
);

const themeOf = (t: Record<string, string>): ChartTheme => ({
  amber: t['--mf-amber-ink'],
  bg: t['--mf-bg'],
  font: t['--mf-font-body'],
  // The size tokens sit in the root block only; no scheme overrides them.
  labelSize: Number.parseFloat(darkTokens['--mf-size-label']),
  line: t['--mf-line'],
  text: t['--mf-text'],
  textSecondary: t['--mf-text-secondary'],
});

const dark = themeOf(darkTokens);
const light = themeOf(lightTokens);

const MONTHS = [
  { label: 'Ianuarie 2027', value: 50000 },
  { label: 'Februarie 2027', value: 200000 },
  { label: 'Martie 2027', value: 125000 },
];

// Chart.js option trees are deeply optional unions; the tests read them loosely.
type Loose = any;

const bar = (theme = dark, reducedMotion = false): Loose =>
  chartConfig('bar', MONTHS, 'lei', 'ro', theme, reducedMotion);
const line = (theme = dark): Loose =>
  chartConfig('line', MONTHS, 'count', 'ro', theme, false);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function gradientStops(dataset: Loose) {
  const stops: [number, string][] = [];
  const area = { bottom: 210, left: 0, right: 300, top: 10 };
  const gradient = {
    addColorStop: (offset: number, colour: string) =>
      stops.push([offset, colour]),
  };
  const args: number[][] = [];
  const ctx = {
    createLinearGradient: (...a: number[]) => {
      args.push(a);
      return gradient;
    },
  };
  const fill = dataset.backgroundColor({ chart: { chartArea: area, ctx } });
  return { args, fill, gradient, stops };
}

describe('chartConfig', () => {
  it('draws thin amber bars with rounded tops and a square base', () => {
    const [dataset] = bar().data.datasets;

    expect(bar().type).toBe('bar');
    expect(dataset.data).toEqual([50000, 200000, 125000]);
    expect(bar().data.labels).toEqual([
      'Ianuarie 2027',
      'Februarie 2027',
      'Martie 2027',
    ]);
    expect(dataset).toMatchObject({
      backgroundColor: dark.amber,
      barThickness: 8,
      borderRadius: 4,
      borderSkipped: 'start',
      hoverBackgroundColor: dark.amber,
    });
  });

  it('draws one 2 px amber line with a fill fading from 25% to nothing', () => {
    const [dataset] = line().data.datasets;

    expect(line().type).toBe('line');
    expect(dataset).toMatchObject({
      borderCapStyle: 'round',
      borderColor: dark.amber,
      borderJoinStyle: 'round',
      borderWidth: 2,
      fill: 'origin',
      pointRadius: 0,
    });

    const { args, fill, gradient, stops } = gradientStops(dataset);
    expect(fill).toBe(gradient);
    expect(args).toEqual([[0, 10, 0, 210]]);
    expect(stops).toEqual([
      [0, 'rgba(255, 176, 0, 0.25)'],
      [1, 'rgba(255, 176, 0, 0)'],
    ]);
  });

  it('fades the light line from the light amber', () => {
    const { stops } = gradientStops(line(light).data.datasets[0]);

    expect(stops[0]).toEqual([0, 'rgba(138, 94, 0, 0.25)']);
  });

  it('has nothing to fill before the chart is laid out', () => {
    const [dataset] = line().data.datasets;

    expect(dataset.backgroundColor({ chart: {} })).toBeUndefined();
  });

  it('leaves the line unfilled rather than failing when the amber token is missing', () => {
    const [dataset] = line({ ...dark, amber: '' }).data.datasets;

    expect(gradientStops(dataset).fill).toBeUndefined();
  });

  it('shows one value axis with hairline grid lines and no legend', () => {
    const { scales, plugins } = bar().options;

    expect(scales.y.grid).toMatchObject({ color: dark.line, lineWidth: 1 });
    expect(scales.y.border).toMatchObject({ display: false });
    expect(scales.y.beginAtZero).toBe(true);
    expect(scales.x.grid).toMatchObject({ display: false });
    expect(scales.x.border).toMatchObject({ display: false });
    expect(plugins.legend).toBeUndefined();
  });

  it('writes axis labels at 12 px in the secondary text colour, thinning instead of rotating', () => {
    for (const axis of ['x', 'y']) {
      const { ticks } = bar().options.scales[axis];
      expect(ticks.color).toBe(dark.textSecondary);
      expect(ticks.font).toMatchObject({
        family: dark.font,
        size: dark.labelSize,
      });
    }
    expect(bar().options.scales.x.ticks).toMatchObject({
      autoSkip: true,
      maxRotation: 0,
      minRotation: 0,
    });
  });

  it('writes value-axis labels with the shared formats for the unit and language', () => {
    const tick = (unit: 'lei' | 'km' | 'count', language: 'ro' | 'en') =>
      (
        chartConfig('bar', MONTHS, unit, language, dark, false) as Loose
      ).options.scales.y.ticks.callback(125000);

    expect(tick('lei', 'ro')).toBe('1.250 lei');
    expect(tick('lei', 'en')).toBe('1,250 lei');
    expect(tick('km', 'ro')).toBe('125.000 km');
    expect(tick('count', 'en')).toBe('125,000');
  });

  it('shows a one-line tooltip with the label and the formatted value', () => {
    const tooltip = (language: 'ro' | 'en') =>
      (chartConfig('bar', MONTHS, 'lei', language, dark, false) as Loose)
        .options.plugins.tooltip;
    const item = { label: 'Martie 2027', raw: 125000 };

    expect(tooltip('ro').callbacks.label(item)).toBe('Martie 2027 · 1.250 lei');
    expect(
      tooltip('en').callbacks.label({ ...item, label: 'March 2027' }),
    ).toBe('March 2027 · 1,250 lei');
    expect(tooltip('ro').callbacks.title()).toBe('');
    expect(tooltip('ro')).toMatchObject({
      backgroundColor: dark.text,
      bodyColor: dark.bg,
      bodyFont: { family: dark.font, size: dark.labelSize, weight: 600 },
      displayColors: false,
    });
  });

  it('answers a hover or a tap anywhere over a column', () => {
    const { options } = bar();

    expect(options.interaction).toMatchObject({
      axis: 'x',
      intersect: false,
      mode: 'nearest',
    });
    expect(options.maintainAspectRatio).toBe(false);
  });

  it('grows in over one second, and not at all with reduced motion', () => {
    expect(bar().options.animation).toEqual({
      duration: 1000,
      easing: 'easeOutQuart',
    });
    expect(bar(dark, true).options.animation).toBe(false);
  });

  it('takes every colour from the theme it is given', () => {
    const [dataset] = bar(light).data.datasets;
    const { scales, plugins } = bar(light).options;

    expect(dataset.backgroundColor).toBe('#8a5e00');
    expect(scales.y.grid.color).toBe(light.line);
    expect(scales.y.ticks.color).toBe(light.textSecondary);
    expect(plugins.tooltip.backgroundColor).toBe(light.text);
    expect(plugins.tooltip.bodyColor).toBe(light.bg);
  });

  it.each([
    ['dark', darkTokens],
    ['light', lightTokens],
  ])(
    'keeps the %s chart amber at 3:1 or more against the panel and the page',
    (_, t) => {
      expect(
        contrast(t['--mf-amber-ink'], t['--mf-panel']),
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(t['--mf-amber-ink'], t['--mf-bg']),
      ).toBeGreaterThanOrEqual(3);
      expect(contrast(t['--mf-text'], t['--mf-bg'])).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

describe('readTheme', () => {
  it('reads the chart colours and font from the tokens on an element', () => {
    // jsdom drops a quoted font list, so this element's font token is bare.
    const el = document.createElement('div');
    for (const [name, value] of Object.entries({
      ...darkTokens,
      ...lightTokens,
    }))
      el.style.setProperty(name, value);
    el.style.setProperty('--mf-font-body', 'system-ui');
    document.body.append(el);

    expect(readTheme(el)).toEqual({ ...light, font: 'system-ui' });
    el.remove();
  });

  // @traces 975-FR-005
  // @traces 975-FR-008
  it('reads the label size from the label token, as a number of pixels', () => {
    const el = document.createElement('div');
    el.style.setProperty('--mf-size-label', '12px');
    document.body.append(el);

    expect(readTheme(el).labelSize).toBe(12);
    el.remove();
  });

  it('leaves the label size to Chart.js when the token is missing', () => {
    const el = document.createElement('div');
    document.body.append(el);

    expect(readTheme(el).labelSize).toBeUndefined();
    el.remove();
  });
});

// @traces 103-FR-006 103-FR-011
describe('chartConfig laid on its side', () => {
  const BRANDS = [
    { label: 'Dacia', value: 412 },
    { label: 'Volkswagen', value: 288 },
  ];
  const side = (): Loose =>
    chartConfig('bar', BRANDS, 'count', 'ro', dark, false, true);

  it('runs the bars across, one category per row', () => {
    const { options } = side();

    expect(options.indexAxis).toBe('y');
    expect(options.interaction).toMatchObject({ axis: 'y', intersect: false });
    expect(side().data.labels).toEqual(['Dacia', 'Volkswagen']);
  });

  it('steps a count axis in whole numbers, so 2 requests never read 0,5', () => {
    expect(side().options.scales.x.ticks.precision).toBe(0);
    expect(
      (chartConfig('line', BRANDS, 'lei', 'ro', dark, false) as Loose).options
        .scales.y.ticks.precision,
    ).toBeUndefined();
  });

  it('puts the counts on the across axis with hairlines and the names down the side at 12 px', () => {
    const { scales } = side().options;

    expect(scales.x).toMatchObject({
      beginAtZero: true,
      grid: { color: dark.line, lineWidth: 1 },
    });
    expect(scales.x.ticks.maxTicksLimit).toBe(5);
    expect(scales.x.ticks.callback(1250)).toBe('1.250');
    expect(scales.y.grid).toMatchObject({ display: false });
    expect(scales.y.ticks).toMatchObject({
      autoSkip: true,
      color: dark.textSecondary,
      font: { family: dark.font, size: dark.labelSize },
    });
    expect(scales.y.ticks.callback).toBeUndefined();
  });

  // @traces 404-FR-008
  it('wraps a name longer than 16 characters onto lines of at most 16, so the side axis never clips it', () => {
    const jobs = [
      { label: 'Schimb de ulei și filtre', value: 2 },
      { label: 'Frâne', value: 1 },
      { label: 'Diagnosticareelectronică', value: 1 },
    ];
    const { data } = chartConfig(
      'bar',
      jobs,
      'count',
      'ro',
      dark,
      false,
      true,
    ) as Loose;

    expect(data.labels).toEqual([
      ['Schimb de ulei', 'și filtre'],
      'Frâne',
      ['Diagnosticareele', 'ctronică'],
    ]);
    expect(data.labels.flat().every((line: string) => line.length <= 16)).toBe(
      true,
    );
  });

  it('counts the lines a name takes down the side', () => {
    expect(nameLines('Dacia')).toEqual(['Dacia']);
    expect(nameLines('Schimb de ulei și filtre')).toEqual([
      'Schimb de ulei',
      'și filtre',
    ]);
    expect(nameLines('  Reparații   caroserie și vopsitorie  ')).toEqual([
      'Reparații',
      'caroserie și',
      'vopsitorie',
    ]);
    expect(nameLines('')).toEqual(['']);
  });

  it('puts both figures under every line of a wrapped name', () => {
    const { data } = chartConfig(
      'bar',
      [{ label: 'Schimb de ulei și filtre', lead: 3, value: 2 }],
      'count',
      'ro',
      dark,
      false,
      true,
      { leadHeading: 'Căutări', valueHeading: 'Cereri' },
    ) as Loose;

    expect(data.labels).toEqual([
      ['Schimb de ulei', 'și filtre', 'Căutări 3', 'Cereri 2'],
    ]);
  });

  it('names a wrapped point on one line in its tooltip', () => {
    const { options } = chartConfig(
      'bar',
      [{ label: 'Schimb de ulei și filtre', value: 2 }],
      'count',
      'ro',
      dark,
      false,
      true,
    ) as Loose;

    expect(
      options.plugins.tooltip.callbacks.label({
        dataIndex: 0,
        label: 'Schimb de ulei,și filtre',
        raw: 2,
      }),
    ).toBe('Schimb de ulei și filtre · 2');
  });

  it('keeps a long name whole when the bars stand upright', () => {
    const { data } = chartConfig(
      'bar',
      [{ label: 'Schimb de ulei și filtre', value: 2 }],
      'count',
      'ro',
      dark,
      false,
    ) as Loose;

    expect(data.labels).toEqual(['Schimb de ulei și filtre']);
  });

  it('stays upright when not asked to lie down', () => {
    const { options } = chartConfig(
      'bar',
      BRANDS,
      'count',
      'ro',
      dark,
      false,
    ) as Loose;

    expect(options.indexAxis).toBeUndefined();
    expect(options.interaction.axis).toBe('x');
  });
});

// @traces 404-FR-008 404-FR-011
describe('chartConfig with a lead figure', () => {
  const PAIRS = [
    { label: 'Dacia', lead: 8900, value: 2140 },
    { label: 'BMW', lead: 2600, value: 0 },
  ];
  const headings = { leadHeading: 'Căutări', valueHeading: 'Cereri' };
  const pairs = (theme = dark): Loose =>
    chartConfig('bar', PAIRS, 'count', 'ro', theme, false, true, headings);

  it('draws the lead bar first in the half-strength amber, then the amber value bar', () => {
    const [lead, value] = pairs().data.datasets;

    expect(pairs().data.datasets).toHaveLength(2);
    expect(lead).toMatchObject({
      backgroundColor: 'rgba(255, 176, 0, 0.5)',
      barThickness: 8,
      data: [8900, 2600],
      label: 'Căutări',
    });
    expect(value).toMatchObject({
      backgroundColor: dark.amber,
      barThickness: 8,
      data: [2140, 0],
      label: 'Cereri',
    });
  });

  it('writes both figures as text under each name', () => {
    expect(pairs().data.labels).toEqual([
      ['Dacia', 'Căutări 8.900', 'Cereri 2.140'],
      ['BMW', 'Căutări 2.600', 'Cereri 0'],
    ]);
  });

  it('shows both figures under the name in one tooltip', () => {
    const { interaction, plugins } = pairs().options;
    const { callbacks } = plugins.tooltip;

    expect(interaction).toMatchObject({ axis: 'y', mode: 'index' });
    expect(callbacks.title([{ dataIndex: 0 }])).toBe('Dacia');
    expect(callbacks.label({ dataset: { label: 'Căutări' }, raw: 8900 })).toBe(
      'Căutări · 8.900',
    );
    expect(callbacks.label({ dataset: { label: 'Cereri' }, raw: 2140 })).toBe(
      'Cereri · 2.140',
    );
  });

  it('takes the lead colour from the theme it is given', () => {
    const [lead] = pairs(light).data.datasets;

    expect(lead.backgroundColor).not.toBe(light.amber);
    expect(lead.backgroundColor).toMatch(/^rgba\(.+, 0\.5\)$/);
  });

  it('draws a chart without a lead figure as it did before', () => {
    const plain = [
      { label: 'Dacia', value: 2140 },
      { label: 'BMW', value: 0 },
    ];

    const { data, options } = chartConfig(
      'bar',
      plain,
      'count',
      'ro',
      dark,
      false,
      true,
    ) as Loose;
    expect(data.datasets).toHaveLength(1);
    expect(data.labels).toEqual(['Dacia', 'BMW']);
    expect(options.interaction.mode).toBe('nearest');
  });
});

// @traces 404-FR-008
describe('chartConfig with a lead figure under odd input', () => {
  const headings = { leadHeading: 'Căutări', valueHeading: 'Cereri' };
  const build = (
    points: { label: string; value: number; lead?: number }[],
    language: 'ro' | 'en' = 'ro',
    withHeadings: typeof headings | null = headings,
  ): Loose =>
    chartConfig(
      'bar',
      points,
      'count',
      language,
      dark,
      false,
      true,
      withHeadings ?? undefined,
    );

  it('draws an empty chart with no points as one empty series', () => {
    const { data } = build([]);

    expect(data.labels).toEqual([]);
    expect(data.datasets).toHaveLength(1);
    expect(data.datasets[0].data).toEqual([]);
  });

  it('draws one plain series when points carry a lead but no headings were given', () => {
    const { data } = build([{ label: 'Dacia', lead: 5, value: 2 }], 'ro', null);

    expect(data.datasets).toHaveLength(1);
    expect(data.labels).toEqual(['Dacia']);
  });

  it('treats a point without a lead as a lead of 0 when another point has one', () => {
    const { data } = build([
      { label: 'Dacia', lead: 5, value: 2 },
      { label: 'BMW', value: 3 },
    ]);

    expect(data.datasets[0].data).toEqual([5, 0]);
    expect(data.labels[1]).toEqual(['BMW', 'Căutări 0', 'Cereri 3']);
  });

  it('keeps a lead of 0 on every point as two series', () => {
    const { data } = build([{ label: 'Dacia', lead: 0, value: 0 }]);

    expect(data.datasets).toHaveLength(2);
    expect(data.labels[0]).toEqual(['Dacia', 'Căutări 0', 'Cereri 0']);
  });

  it('groups a lead of a million in the English format', () => {
    const { data } = build(
      [{ label: 'Dacia', lead: 1234567, value: 1000 }],
      'en',
      { leadHeading: 'Searches', valueHeading: 'Requests' },
    );

    expect(data.labels[0]).toEqual([
      'Dacia',
      'Searches 1,234,567',
      'Requests 1,000',
    ]);
  });

  it('keeps a markup name as a plain label string', () => {
    const { data } = build([{ label: '<b>x</b>\nQ', lead: 1, value: 1 }]);

    expect(data.labels[0][0]).toBe('<b>x</b>\nQ');
  });

  it('returns the tooltip title as empty for an index outside the points', () => {
    const { options } = build([{ label: 'Dacia', lead: 1, value: 1 }]);

    expect(options.plugins.tooltip.callbacks.title([{ dataIndex: 9 }])).toBe(
      '',
    );
    expect(options.plugins.tooltip.callbacks.title([])).toBe('');
  });

  it('draws the lead bar in the same colour whether or not the value is 0', () => {
    const { data } = build([
      { label: 'A', lead: 1, value: 0 },
      { label: 'B', lead: 0, value: 1 },
    ]);

    expect(data.datasets[0].backgroundColor).toBe('rgba(255, 176, 0, 0.5)');
  });
});
