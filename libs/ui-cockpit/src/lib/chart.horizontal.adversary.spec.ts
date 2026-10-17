import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Chart } from 'chart.js';

import { BarChart } from './chart';
import { type ChartPoint, chartConfig } from './chart-config';

const THEME = {
  amber: '#8a5e00',
  bg: '#ffffff',
  font: 'sans-serif',
  line: '#dddddd',
  text: '#111111',
  textSecondary: '#555555',
};

const points = (n: number): ChartPoint[] =>
  Array.from({ length: n }, (_, i) => ({ label: `Marca ${i}`, value: n - i }));

@Component({
  imports: [BarChart],
  template: `
    <mf-bar-chart
      title="Cereri"
      unit="count"
      [points]="points()"
      [horizontal]="horizontal()"
      [loading]="loading()"
      [error]="error()"
      [empty]="empty()"
      (retry)="retried = retried + 1"
    />
  `,
})
class Host {
  readonly points = signal<readonly ChartPoint[]>(points(3));
  readonly horizontal = signal(true);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly empty = signal<string | undefined>(undefined);
  retried = 0;
}

async function render(setup: (h: Host) => void = () => {}) {
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  return [fixture, fixture.nativeElement as HTMLElement] as const;
}

const plot = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('.mf-chart-plot');
const chartOf = (el: HTMLElement) => {
  const canvas = el.querySelector('canvas');
  return canvas ? Chart.getChart(canvas) : undefined;
};

afterEach(async () => {
  document.body.replaceChildren();
  await TestBed.inject(I18n).use('ro');
});

describe('chartConfig with the horizontal layout', () => {
  // @traces 103-FR-006
  it('leaves the vertical layout alone when the argument is false or missing', () => {
    const missing = chartConfig('bar', points(2), 'count', 'ro', THEME, false);
    const off = chartConfig(
      'bar',
      points(2),
      'count',
      'ro',
      THEME,
      false,
      false,
    );

    expect(JSON.stringify(off)).toBe(JSON.stringify(missing));
    expect(missing.options?.indexAxis).toBeUndefined();
    expect(missing.options?.interaction?.axis).toBe('x');
  });

  // @traces 103-FR-006
  it('reads categories down the y axis and counts along x, grouped by language', () => {
    const config = chartConfig(
      'bar',
      points(2),
      'count',
      'en',
      THEME,
      false,
      true,
    );
    const scales = config.options?.scales as Record<string, any>;

    expect(config.options?.indexAxis).toBe('y');
    expect(config.options?.interaction?.axis).toBe('y');
    expect(scales['y'].grid.display).toBe(false);
    expect(scales['x'].beginAtZero).toBe(true);
    expect(scales['x'].ticks.callback(1234)).toBe('1,234');
    expect(scales['y'].beginAtZero).toBeUndefined();
  });

  // @traces 103-FR-009
  it('formats the tooltip count in the language of the chart in the horizontal layout', () => {
    const config = chartConfig(
      'bar',
      points(1),
      'count',
      'ro',
      THEME,
      false,
      true,
    );
    const callbacks = config.options?.plugins?.tooltip?.callbacks as any;
    const label = callbacks.label;

    expect(label({ label: 'Dacia', raw: 2140 })).toBe('Dacia · 2.140');
  });

  // @traces 103-FR-006
  it('keeps every label and value, in order, with no points or one point', () => {
    const none = chartConfig('bar', [], 'count', 'ro', THEME, false, true);
    const one = chartConfig(
      'bar',
      points(1),
      'count',
      'ro',
      THEME,
      false,
      true,
    );

    expect(none.data.labels).toEqual([]);
    expect(none.data.datasets[0].data).toEqual([]);
    expect(one.data.labels).toEqual(['Marca 0']);
    expect(one.data.datasets[0].data).toEqual([1]);
  });
});

describe('BarChart horizontal and empty inputs', () => {
  // @traces 103-FR-006
  it.each([
    [1, 200],
    [6, 200],
    [7, 220],
    [10, 304],
    [100, 2824],
  ])('makes the plot as tall as its rows for %i points', async (n, height) => {
    const [, el] = await render((h) => h.points.set(points(n)));

    expect(plot(el)?.style.height).toBe(`${height}px`);
  });

  // @traces 103-FR-006
  it('sets no inline plot height in the vertical layout', async () => {
    const [, el] = await render((h) => h.horizontal.set(false));

    expect(plot(el)?.style.height).toBe('');
    expect(chartOf(el)?.options.indexAxis).toBe('x');
  });

  // @traces 103-FR-006
  it('switches a drawn chart between layouts without a new canvas', async () => {
    const [fixture, el] = await render();
    const canvas = el.querySelector('canvas');
    expect(chartOf(el)?.options.indexAxis).toBe('y');

    fixture.componentInstance.horizontal.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('canvas')).toBe(canvas);
    expect(chartOf(el)?.options.indexAxis).toBe('x');
  });

  // @traces 103-FR-010
  it('shows the host words for no points and the shared text when none are given', async () => {
    const [fixture, el] = await render((h) => {
      h.points.set([]);
      h.empty.set('Încă nu sunt cereri.');
    });
    expect(el.querySelector('.mf-chart-message')?.textContent?.trim()).toBe(
      'Încă nu sunt cereri.',
    );

    fixture.componentInstance.empty.set(undefined);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('.mf-chart-message')?.textContent?.trim()).toBe(
      'Încă nu sunt date',
    );
  });

  // @traces 103-FR-010
  it('prefers the skeleton and the error over the host empty text', async () => {
    const [fixture, el] = await render((h) => {
      h.points.set([]);
      h.empty.set('Nimic');
      h.loading.set(true);
    });
    expect(el.querySelector('.mf-chart-skeleton')).not.toBeNull();
    expect(el.textContent).not.toContain('Nimic');

    fixture.componentInstance.loading.set(false);
    fixture.componentInstance.error.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.textContent).not.toContain('Nimic');
    expect(
      [...el.querySelectorAll('button')].map((b) => b.textContent?.trim()),
    ).toEqual(['Reîncearcă']);
  });

  // @traces 103-FR-013
  it('moves focus to the panel heading when retry is pressed and emits one retry', async () => {
    const [fixture, el] = await render((h) => h.error.set(true));
    const retry = el.querySelector('button') as HTMLButtonElement;
    retry.focus();

    retry.click();

    expect(fixture.componentInstance.retried).toBe(1);
    expect(document.activeElement).toBe(el.querySelector('h2'));
  });

  // @traces 103-FR-009
  it('rewrites the table counts when the language changes', async () => {
    const [fixture, el] = await render((h) =>
      h.points.set([{ label: 'Dacia', value: 2140 }]),
    );
    (el.querySelector('mf-bar-chart button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector('tbody td:last-child')?.textContent?.trim()).toBe(
      '2.140',
    );

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(el.querySelector('tbody td:last-child')?.textContent?.trim()).toBe(
      '2,140',
    );
  });
});
