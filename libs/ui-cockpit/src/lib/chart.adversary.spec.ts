import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Chart } from 'chart.js';

import { BarChart, LineChart } from './chart';
import {
  type ChartPoint,
  type ChartUnit,
  chartConfig,
  formatValue,
  readTheme,
} from './chart-config';

const THEME = {
  amber: '#8a5e00',
  bg: '#ffffff',
  font: 'sans-serif',
  line: '#dddddd',
  text: '#111111',
  textSecondary: '#555555',
};

const POINTS: ChartPoint[] = [
  { label: 'Ianuarie 2027', value: 50000 },
  { label: 'Februarie 2027', value: 200000 },
  { label: 'Martie 2027', value: 125000 },
];

@Component({
  imports: [BarChart, LineChart],
  template: `
    @if (kind() === 'bar') {
      <mf-bar-chart
        [title]="title()"
        [unit]="unit()"
        [points]="points()"
        [loading]="loading()"
        [error]="error()"
        (retry)="retried = retried + 1"
      />
    } @else {
      <mf-line-chart
        [title]="title()"
        [unit]="unit()"
        [points]="points()"
        [loading]="loading()"
        [error]="error()"
        (retry)="retried = retried + 1"
      />
    }
  `,
})
class Host {
  readonly kind = signal<'bar' | 'line'>('bar');
  readonly title = signal('Cheltuieli');
  readonly unit = signal<ChartUnit>('lei');
  readonly points = signal<readonly ChartPoint[]>(POINTS);
  readonly loading = signal(false);
  readonly error = signal(false);
  retried = 0;
}

async function render(
  setup: (host: Host) => void = () => {},
): Promise<[ComponentFixture<Host>, HTMLElement]> {
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  return [fixture, fixture.nativeElement as HTMLElement];
}

async function settle(fixture: ComponentFixture<Host>) {
  fixture.detectChanges();
  await fixture.whenStable();
}

const canvasOf = (el: HTMLElement) => el.querySelector('canvas');
const chartOf = (el: HTMLElement) => {
  const canvas = canvasOf(el);
  return canvas ? Chart.getChart(canvas) : undefined;
};
const buttonNamed = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const liveCharts = () => Object.keys(Chart.instances).length;
const cells = (el: HTMLElement) =>
  [...el.querySelectorAll('table tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
  );
const tooltipLines = (chart: Chart, index: number) => {
  const active = [{ datasetIndex: 0, index }];
  chart.setActiveElements(active);
  chart.tooltip?.setActiveElements(active, { x: 0, y: 0 });
  chart.update('none');
  return chart.tooltip?.body.flatMap((b) => b.lines);
};

afterEach(() => TestBed.inject(I18n).use('ro'));

describe('the chart components under hostile input', () => {
  it('draw negative values below zero and write them with a minus sign', async () => {
    const [fixture, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: -125000 },
        { label: 'B', value: 50000 },
      ]),
    );
    fixture.componentInstance.points();
    const chart = chartOf(el) as Chart;

    expect(chart.data.datasets[0].data).toEqual([-125000, 50000]);
    expect(chart.scales['y'].min).toBeLessThanOrEqual(-1250 * 100);
    expect(canvasOf(el)?.getAttribute('aria-label')).toContain(
      'Cea mai mică: -1.250 lei, A',
    );
  });

  it('keep a range that starts at zero when every value is zero', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: 0 },
        { label: 'B', value: 0 },
      ]),
    );
    const chart = chartOf(el) as Chart;

    expect(chart.scales['y'].min).toBe(0);
    expect(chart.scales['y'].max).toBeGreaterThan(0);
  });

  it('keep a range that starts at zero when every value is the same positive number', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: 700 },
        { label: 'B', value: 700 },
      ]),
    );

    expect((chartOf(el) as Chart).scales['y'].min).toBe(0);
  });

  it('name highest and lowest as the same value for all-equal points', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: 700 },
        { label: 'B', value: 700 },
      ]),
    );

    expect(canvasOf(el)?.getAttribute('aria-label')).toMatch(
      /^Cheltuieli, A – B\. Cea mai mare valoare: 7 lei, [AB]\. Cea mai mică: 7 lei, [AB]\.$/,
    );
  });

  it('write a summary without NaN or Infinity when no value is a finite number', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: Number.NaN },
        { label: 'B', value: Number.POSITIVE_INFINITY },
        { label: 'C', value: Number.NEGATIVE_INFINITY },
      ]),
    );
    const name = canvasOf(el)?.getAttribute('aria-label') ?? '';

    expect(name).not.toMatch(/NaN|Infinity|undefined|null/);
    expect(name).toContain('Cheltuieli, A – C.');
  });

  it('show the missing-value dash in the table for values that are not finite', async () => {
    const [fixture, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: Number.NaN },
        { label: 'B', value: Number.POSITIVE_INFINITY },
        { label: 'C', value: 10000 },
      ]),
    );
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);

    expect(cells(el)).toEqual([
      ['A', '—'],
      ['B', '—'],
      ['C', '100 lei'],
    ]);
  });

  it('show the missing-value dash in the tooltip for a value that is not a number', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: Number.NaN },
        { label: 'B', value: 10000 },
      ]),
    );

    expect(tooltipLines(chartOf(el) as Chart, 0)).toEqual(['A · —']);
  });

  it('leave non-finite values out of highest and lowest when finite ones exist', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'A', value: Number.POSITIVE_INFINITY },
        { label: 'B', value: 20000 },
        { label: 'C', value: Number.NEGATIVE_INFINITY },
        { label: 'D', value: 30000 },
      ]),
    );

    expect(canvasOf(el)?.getAttribute('aria-label')).toBe(
      'Cheltuieli, A – D. Cea mai mare valoare: 300 lei, D. Cea mai mică: 200 lei, B.',
    );
  });

  it('draw ten thousand points as one chart with every point in the table', async () => {
    const many = Array.from({ length: 10000 }, (_, i) => ({
      label: `L${i}`,
      value: i,
    }));
    const [fixture, el] = await render((h) => h.points.set(many));
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);

    expect(liveCharts()).toBe(1);
    expect(chartOf(el)?.data.datasets[0].data).toHaveLength(10000);
    expect(el.querySelectorAll('table tbody tr')).toHaveLength(10000);
    expect(canvasOf(el)?.getAttribute('aria-label')).toContain(
      'L0 – L9999. Cea mai mare valoare: 99,99 lei, L9999. Cea mai mică: 0 lei, L0.',
    );
  });

  it('keep two points that share a label as two rows and two bars', async () => {
    const [fixture, el] = await render((h) =>
      h.points.set([
        { label: 'Martie', value: 10000 },
        { label: 'Martie', value: 20000 },
      ]),
    );
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);

    expect(chartOf(el)?.data.datasets[0].data).toEqual([10000, 20000]);
    expect(cells(el)).toEqual([
      ['Martie', '100 lei'],
      ['Martie', '200 lei'],
    ]);
    expect(canvasOf(el)?.getAttribute('aria-label')).toContain(
      'Cea mai mare valoare: 200 lei, Martie. Cea mai mică: 100 lei, Martie.',
    );
  });

  it('show label text with markup as plain text', async () => {
    const [fixture, el] = await render((h) =>
      h.points.set([{ label: '<b>x</b><img src=x>', value: 100 }]),
    );
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);

    expect(el.querySelector('table b, table img')).toBeNull();
    expect(cells(el)).toEqual([['<b>x</b><img src=x>', '1 lei']]);
  });

  it('show a single point as one bar with the label as the period', async () => {
    const [, el] = await render((h) =>
      h.points.set([{ label: 'Martie 2027', value: 125000 }]),
    );

    expect(chartOf(el)?.data.datasets[0].data).toEqual([125000]);
    expect(canvasOf(el)?.getAttribute('aria-label')).toContain(
      'Cheltuieli, Martie 2027. Cea mai mare',
    );
  });
});

describe('the chart components across state changes', () => {
  it('create exactly one chart when loading ends with data', async () => {
    const [fixture, el] = await render((h) => h.loading.set(true));

    expect(liveCharts()).toBe(0);
    fixture.componentInstance.loading.set(false);
    await settle(fixture);

    expect(liveCharts()).toBe(1);
    expect(el.querySelectorAll('canvas')).toHaveLength(1);
    expect(el.querySelector('.mf-chart-skeleton')).toBeNull();
  });

  it('destroy the chart when loading starts again and make a fresh one after', async () => {
    const [fixture, el] = await render();
    const first = canvasOf(el) as HTMLCanvasElement;

    fixture.componentInstance.loading.set(true);
    await settle(fixture);
    expect(Chart.getChart(first)).toBeUndefined();
    expect(liveCharts()).toBe(0);

    fixture.componentInstance.loading.set(false);
    await settle(fixture);
    expect(liveCharts()).toBe(1);
    expect(chartOf(el)?.data.datasets[0].data).toEqual([50000, 200000, 125000]);
  });

  it('draw the chart when an error clears and data are there', async () => {
    const [fixture, el] = await render((h) => h.error.set(true));

    expect(liveCharts()).toBe(0);
    fixture.componentInstance.error.set(false);
    await settle(fixture);

    expect(liveCharts()).toBe(1);
    expect(buttonNamed(el, 'Reîncearcă')).toBeUndefined();
  });

  it('destroy the chart when the points go empty and draw one again when they return', async () => {
    const [fixture, el] = await render();
    const canvas = canvasOf(el) as HTMLCanvasElement;

    fixture.componentInstance.points.set([]);
    await settle(fixture);
    expect(Chart.getChart(canvas)).toBeUndefined();
    expect(liveCharts()).toBe(0);
    expect(el.textContent).toContain('Încă nu sunt date');

    fixture.componentInstance.points.set(POINTS);
    await settle(fixture);
    expect(liveCharts()).toBe(1);

    fixture.componentInstance.points.set([]);
    await settle(fixture);
    expect(liveCharts()).toBe(0);
    expect(canvasOf(el)).toBeNull();
  });

  it('show the no-data text and no axis after loading ends with no points', async () => {
    const [fixture, el] = await render((h) => {
      h.loading.set(true);
      h.points.set([]);
    });
    fixture.componentInstance.loading.set(false);
    await settle(fixture);

    expect(el.textContent).toContain('Încă nu sunt date');
    expect(liveCharts()).toBe(0);
  });

  it('hide the table toggle state with the chart gone and keep no stale table', async () => {
    const [fixture, el] = await render();
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);

    fixture.componentInstance.points.set([]);
    await settle(fixture);

    expect(cells(el)).toEqual([]);
  });

  it('tell the host once per press of the retry button', async () => {
    const [fixture, el] = await render((h) => h.error.set(true));
    const retry = buttonNamed(el, 'Reîncearcă');

    retry?.click();
    expect(fixture.componentInstance.retried).toBe(1);
    retry?.click();
    retry?.click();
    expect(fixture.componentInstance.retried).toBe(3);
  });

  it('offer retry on the line chart too', async () => {
    const [fixture, el] = await render((h) => {
      h.kind.set('line');
      h.error.set(true);
    });

    buttonNamed(el, 'Reîncearcă')?.click();

    expect(fixture.componentInstance.retried).toBe(1);
    expect(liveCharts()).toBe(0);
  });

  it('not tell the host anything while the chart shows data', async () => {
    const [fixture, el] = await render();

    expect(buttonNamed(el, 'Reîncearcă')).toBeUndefined();
    expect(fixture.componentInstance.retried).toBe(0);
  });

  it('keep the chart when only the title changes and rename the summary', async () => {
    const [fixture, el] = await render();
    const chart = chartOf(el);

    fixture.componentInstance.title.set('Venituri');
    await settle(fixture);

    expect(chartOf(el)).toBe(chart);
    expect(el.querySelector('mf-panel h2')?.textContent?.trim()).toBe(
      'Venituri',
    );
    expect(canvasOf(el)?.getAttribute('aria-label')).toMatch(/^Venituri, /);
  });

  it('reformat the table, summary and tooltip when the unit changes at runtime', async () => {
    const [fixture, el] = await render();
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);

    fixture.componentInstance.unit.set('km');
    await settle(fixture);

    expect(cells(el)[1]).toEqual(['Februarie 2027', '200.000 km']);
    expect(canvasOf(el)?.getAttribute('aria-label')).toContain(
      'Cea mai mare valoare: 200.000 km',
    );
    expect(tooltipLines(chartOf(el) as Chart, 1)).toEqual([
      'Februarie 2027 · 200.000 km',
    ]);

    fixture.componentInstance.unit.set('count');
    await settle(fixture);

    expect(cells(el)[1]).toEqual(['Februarie 2027', '200.000']);
    expect(tooltipLines(chartOf(el) as Chart, 1)).toEqual([
      'Februarie 2027 · 200.000',
    ]);
  });

  it('reformat the value axis when the unit changes at runtime', async () => {
    const [fixture, el] = await render();
    fixture.componentInstance.unit.set('km');
    await settle(fixture);
    const chart = chartOf(el) as Chart;
    const labels = chart.scales['y'].ticks.map((t) => t.label);

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/ km$/);
  });

  it('reformat the tooltip, the table and the axis when the language switches', async () => {
    const [fixture, el] = await render();
    buttonNamed(el, 'Vezi ca tabel')?.click();
    await settle(fixture);
    expect(tooltipLines(chartOf(el) as Chart, 1)).toEqual([
      'Februarie 2027 · 2.000 lei',
    ]);

    await TestBed.inject(I18n).use('en');
    await settle(fixture);

    expect(tooltipLines(chartOf(el) as Chart, 1)).toEqual([
      'Februarie 2027 · 2,000 lei',
    ]);
    expect(cells(el)[1]).toEqual(['Februarie 2027', '2,000 lei']);
    expect(
      buttonNamed(el, 'Hide table') ?? buttonNamed(el, 'View as table'),
    ).toBeDefined();
    for (const tick of (chartOf(el) as Chart).scales['y'].ticks) {
      expect(tick.label).toMatch(/^[\d,]+ lei$/);
    }
  });

  it('keep the same chart across a language switch', async () => {
    const [fixture, el] = await render();
    const chart = chartOf(el);

    await TestBed.inject(I18n).use('en');
    await settle(fixture);

    expect(chartOf(el)).toBe(chart);
    expect(liveCharts()).toBe(1);
  });

  it('show the empty text in English after a language switch with no points', async () => {
    const [fixture, el] = await render((h) => h.points.set([]));

    await TestBed.inject(I18n).use('en');
    await settle(fixture);

    expect(el.textContent).toContain('No data yet');
    expect(el.textContent).not.toContain('Încă nu sunt date');
  });

  it('swap from a bar chart to a line chart without leaking a chart', async () => {
    const [fixture, el] = await render();

    fixture.componentInstance.kind.set('line');
    await settle(fixture);
    expect(liveCharts()).toBe(1);

    fixture.componentInstance.kind.set('bar');
    await settle(fixture);
    expect(liveCharts()).toBe(1);
    expect((chartOf(el)?.config as { type?: string }).type).toBe('bar');
  });

  it('leave no chart behind when the host is destroyed while loading or in error', async () => {
    const [fixture] = await render((h) => h.error.set(true));
    fixture.destroy();

    expect(liveCharts()).toBe(0);
  });
});

describe('the chart options builder', () => {
  it('turn the entry animation off for reduced motion and keep it for others', () => {
    const still = chartConfig('bar', POINTS, 'lei', 'ro', THEME, true);
    const moving = chartConfig('bar', POINTS, 'lei', 'ro', THEME, false);
    const stillAnimation = still.options?.animation as
      | false
      | { duration?: number };
    const movingAnimation = moving.options?.animation as {
      duration?: number;
      easing?: string;
    };

    expect(stillAnimation === false || stillAnimation.duration === 0).toBe(
      true,
    );
    expect(movingAnimation.duration).toBe(1000);
    expect(movingAnimation.easing).toBe('easeOutQuart');
  });

  it('give the line chart a 2 px line, and no markers', () => {
    const config = chartConfig('line', POINTS, 'count', 'ro', THEME, false);
    const dataset = config.data.datasets[0] as unknown as Record<
      string,
      unknown
    >;

    expect(config.type).toBe('line');
    expect(dataset['borderWidth']).toBe(2);
    expect(dataset['pointRadius']).toBe(0);
  });

  it('give the bar chart 8 px bars rounded at the top only', () => {
    const config = chartConfig('bar', POINTS, 'count', 'ro', THEME, false);
    const dataset = config.data.datasets[0] as unknown as Record<
      string,
      unknown
    >;

    expect(dataset['barThickness']).toBe(8);
    expect(dataset['borderRadius']).toBeGreaterThan(0);
  });

  it('draw no legend and no category grid lines', async () => {
    const [, el] = await render();
    const chart = chartOf(el) as Chart;

    expect(chart.legend).toBeUndefined();
    expect((chart.scales['x'].options as any).grid.display).toBe(false);
    expect((chart.scales['y'].options as any).grid.display).not.toBe(false);
  });

  it('keep axis labels at 12 px or more without rotation', () => {
    const config = chartConfig('line', POINTS, 'lei', 'ro', THEME, false);
    const scales = config.options?.scales as unknown as Record<
      string,
      { ticks?: { font?: { size?: number }; maxRotation?: number } }
    >;

    for (const axis of ['x', 'y']) {
      expect(scales[axis].ticks?.font?.size).toBeGreaterThanOrEqual(12);
    }
    expect(scales['x'].ticks?.maxRotation).toBe(0);
  });

  it('build a config from an empty list without throwing', () => {
    const config = chartConfig('bar', [], 'lei', 'ro', THEME, false);

    expect(config.data.labels).toEqual([]);
    expect(config.data.datasets[0].data).toEqual([]);
  });

  it('not share option objects between two configs', () => {
    const a = chartConfig('bar', POINTS, 'lei', 'ro', THEME, false);
    const b = chartConfig('bar', POINTS, 'lei', 'en', THEME, false);

    expect(a.options).not.toBe(b.options);
    expect(a.data.datasets[0]).not.toBe(b.data.datasets[0]);
  });

  it('take every colour from the theme it is given', () => {
    const other = {
      ...THEME,
      amber: '#ffb000',
      line: '#222222',
      text: '#eeeeee',
    };
    const config = chartConfig('bar', POINTS, 'lei', 'ro', other, false);
    const json = JSON.stringify(config);

    expect(json).toContain('#ffb000');
    expect(json).not.toContain('#8a5e00');
  });
});

describe('formatValue', () => {
  it.each([
    ['lei', 125000, 'ro', '1.250 lei'],
    ['lei', 125000, 'en', '1,250 lei'],
    ['km', 1250, 'ro', '1.250 km'],
    ['count', 1250, 'en', '1,250'],
    ['count', -1250, 'ro', '-1.250'],
    ['count', Number.NaN, 'ro', '—'],
    ['count', null, 'ro', '—'],
    ['lei', undefined, 'en', '—'],
    ['km', '12', 'ro', '—'],
  ] as const)('write %s value %p in %s as %p', (unit, value, language, out) => {
    expect(formatValue(unit, value, language)).toBe(out);
  });
});

describe('readTheme', () => {
  it('read the tokens from the element it is given', () => {
    const el = document.createElement('div');
    el.style.setProperty('--mf-amber-ink', ' #8a5e00 ');
    el.style.setProperty('--mf-bg', '#ffffff');
    document.body.append(el);

    const theme = readTheme(el);
    el.remove();

    expect(theme.amber).toBe('#8a5e00');
    expect(theme.bg).toBe('#ffffff');
  });

  it('return empty strings rather than throw when the tokens are missing', () => {
    const el = document.createElement('div');

    expect(readTheme(el).amber).toBe('');
  });
});
