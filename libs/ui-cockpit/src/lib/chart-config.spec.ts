import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chartConfig, readTheme } from './chart-config';

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
      expect(ticks.font).toMatchObject({ family: dark.font, size: 12 });
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
      bodyFont: { family: dark.font, size: 12, weight: 600 },
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
    for (const [name, value] of Object.entries(lightTokens))
      el.style.setProperty(name, value);
    el.style.setProperty('--mf-font-body', 'system-ui');
    document.body.append(el);

    expect(readTheme(el)).toEqual({ ...light, font: 'system-ui' });
    el.remove();
  });
});
