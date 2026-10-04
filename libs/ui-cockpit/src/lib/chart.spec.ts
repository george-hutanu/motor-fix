import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Chart } from 'chart.js';

import { BarChart, LineChart } from './chart';
import type { ChartPoint } from './chart-config';

let schemeListeners: (() => void)[] = [];

beforeEach(() => {
  schemeListeners = [];
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener: (_: string, listener: () => void) => {
        if (query.includes('color-scheme')) schemeListeners.push(listener);
      },
      matches: false,
      media: query,
      removeEventListener: (_: string, listener: () => void) => {
        schemeListeners = schemeListeners.filter((l) => l !== listener);
      },
    }) as unknown as MediaQueryList;
});

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
        title="Cheltuieli"
        unit="lei"
        [points]="points()"
        [loading]="loading()"
        [error]="error()"
        (retry)="retried = retried + 1"
      />
    } @else {
      <mf-line-chart title="Garaje noi" unit="count" [points]="points()" />
    }
    <p class="outside">în afara graficului</p>
  `,
})
class Host {
  readonly kind = signal<'bar' | 'line'>('bar');
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

describe('the bar and line charts', () => {
  it('sit in a panel titled by the chart title', async () => {
    const [, el] = await render();

    expect(el.querySelector('mf-panel h2')?.textContent?.trim()).toBe(
      'Cheltuieli',
    );
  });

  it('draw a bar chart and a line chart of the points', async () => {
    const [fixture, el] = await render();

    expect((chartOf(el)?.config as { type?: string })?.type).toBe('bar');
    expect(chartOf(el)?.data.datasets[0].data).toEqual([50000, 200000, 125000]);
    expect(chartOf(el)?.data.labels).toEqual(POINTS.map((p) => p.label));

    fixture.componentInstance.kind.set('line');
    await settle(fixture);

    expect((chartOf(el)?.config as { type?: string })?.type).toBe('line');
  });

  it('name the chart image with a one-line summary in the language', async () => {
    const [fixture, el] = await render();
    const canvas = () => canvasOf(el);

    expect(canvas()?.getAttribute('role')).toBe('img');
    expect(canvas()?.getAttribute('aria-label')).toBe(
      'Cheltuieli, Ianuarie 2027 – Martie 2027. Cea mai mare valoare: 2.000 lei, Februarie 2027. Cea mai mică: 500 lei, Ianuarie 2027.',
    );

    await TestBed.inject(I18n).use('en');
    await settle(fixture);

    expect(canvas()?.getAttribute('aria-label')).toBe(
      'Cheltuieli, Ianuarie 2027 – Martie 2027. Highest: 2,000 lei, Februarie 2027. Lowest: 500 lei, Ianuarie 2027.',
    );
  });

  it('give one period for one point, and leave values that are not numbers out of the extremes', async () => {
    const [fixture, el] = await render((h) =>
      h.points.set([{ label: 'Martie 2027', value: 125000 }]),
    );

    expect(canvasOf(el)?.getAttribute('aria-label')).toBe(
      'Cheltuieli, Martie 2027. Cea mai mare valoare: 1.250 lei, Martie 2027. Cea mai mică: 1.250 lei, Martie 2027.',
    );

    fixture.componentInstance.points.set([
      { label: 'Ianuarie 2027', value: Number.NaN },
      { label: 'Februarie 2027', value: 30000 },
      { label: 'Martie 2027', value: 10000 },
    ]);
    await settle(fixture);

    expect(canvasOf(el)?.getAttribute('aria-label')).toBe(
      'Cheltuieli, Ianuarie 2027 – Martie 2027. Cea mai mare valoare: 300 lei, Februarie 2027. Cea mai mică: 100 lei, Martie 2027.',
    );
  });

  it('redraw new points in place, without a new chart or the entry animation', async () => {
    const [fixture, el] = await render();
    const chart = chartOf(el);
    const update = jest.spyOn(chart as Chart, 'update');

    fixture.componentInstance.points.set([
      ...POINTS,
      { label: 'Aprilie 2027', value: 80000 },
    ]);
    await settle(fixture);

    expect(chartOf(el)).toBe(chart);
    expect(update).toHaveBeenCalledWith('none');
    expect(chart?.data.datasets[0].data).toEqual([
      50000, 200000, 125000, 80000,
    ]);
  });

  it('show the no-data text instead of an empty axis', async () => {
    const [, el] = await render((h) => h.points.set([]));

    expect(el.textContent).toContain('Încă nu sunt date');
    expect(canvasOf(el)).toBeNull();
  });

  it('show a skeleton while loading, before an error or the data', async () => {
    const [, el] = await render((h) => {
      h.loading.set(true);
      h.error.set(true);
    });

    expect(el.querySelector('.mf-chart-skeleton')).not.toBeNull();
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(canvasOf(el)).toBeNull();
    expect(buttonNamed(el, 'Reîncearcă')).toBeUndefined();
  });

  it('offer a retry after an error, before the no-data text, and tell the host', async () => {
    const [fixture, el] = await render((h) => {
      h.error.set(true);
      h.points.set([]);
    });
    const retry = buttonNamed(el, 'Reîncearcă');

    expect(el.textContent).not.toContain('Încă nu sunt date');
    expect(canvasOf(el)).toBeNull();
    retry?.click();
    expect(fixture.componentInstance.retried).toBe(1);
  });

  it('show and hide the values as a table', async () => {
    const [fixture, el] = await render();
    const toggle = buttonNamed(el, 'Vezi ca tabel');

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('table')).toBeNull();

    toggle?.click();
    await settle(fixture);

    const table = el.querySelector('table');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-controls')).toBe(table?.id);
    expect(
      [...(table?.querySelectorAll('th') ?? [])].map((th) =>
        th.textContent?.trim(),
      ),
    ).toEqual(['Perioadă', 'Valoare']);
    expect(
      [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
      ),
    ).toEqual([
      ['Ianuarie 2027', '500 lei'],
      ['Februarie 2027', '2.000 lei'],
      ['Martie 2027', '1.250 lei'],
    ]);

    toggle?.click();
    await settle(fixture);
    expect(el.querySelector('table')).toBeNull();
  });

  it('hide the tooltip when the person taps outside the chart', async () => {
    const [, el] = await render();
    const chart = chartOf(el) as Chart;
    const active = [{ datasetIndex: 0, index: 1 }];
    const show = () => {
      chart.setActiveElements(active);
      chart.tooltip?.setActiveElements(active, { x: 0, y: 0 });
    };
    const tap = (target: Element) =>
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    const update = jest.spyOn(chart, 'update');

    tap(el.querySelector('.outside') as Element);
    expect(update).not.toHaveBeenCalled();

    show();
    tap(canvasOf(el) as HTMLCanvasElement);
    expect(chart.tooltip?.getActiveElements()).toHaveLength(1);

    tap(el.querySelector('.outside') as Element);
    expect(chart.tooltip?.getActiveElements()).toHaveLength(0);
    expect(chart.getActiveElements()).toHaveLength(0);
  });

  it('redraw in the new theme colours when the device switches theme', async () => {
    const [fixture, el] = await render();
    const canvas = canvasOf(el) as HTMLCanvasElement;
    canvas.style.setProperty('--mf-amber-ink', '#8a5e00');

    for (const listener of schemeListeners) listener();
    await settle(fixture);

    expect(chartOf(el)?.data.datasets[0].backgroundColor).toBe('#8a5e00');
  });

  it('let the chart and its listeners go with the component', async () => {
    const [fixture, el] = await render();
    const canvas = canvasOf(el) as HTMLCanvasElement;

    expect(schemeListeners).not.toHaveLength(0);
    fixture.destroy();

    expect(Chart.getChart(canvas)).toBeUndefined();
    expect(schemeListeners).toHaveLength(0);
  });
});
