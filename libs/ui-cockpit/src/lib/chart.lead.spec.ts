import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { BarChart } from './chart';
import type { ChartPoint } from './chart-config';

// @traces 404-FR-008 404-FR-012

const PAIRS: ChartPoint[] = [
  { label: 'Dacia', lead: 8900, value: 2140 },
  { label: 'Renault', lead: 0, value: 412 },
  { label: 'BMW', lead: 2600, value: 0 },
];

@Component({
  imports: [BarChart],
  template: `
    <mf-bar-chart
      title="Căutări și cereri pe marcă, 30 de zile"
      unit="count"
      horizontal
      labelHeading="Marcă"
      [leadHeading]="leadHeading()"
      [valueHeading]="valueHeading()"
      [points]="points()"
    />
  `,
})
class Host {
  readonly points = signal<readonly ChartPoint[]>(PAIRS);
  readonly leadHeading = signal<string | undefined>('Căutări');
  readonly valueHeading = signal<string | undefined>('Cereri');
}

async function render(setup: (h: Host) => void = () => {}) {
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  return [fixture, fixture.nativeElement as HTMLElement] as const;
}

const showTable = async (
  fixture: Awaited<ReturnType<typeof render>>[0],
  el: HTMLElement,
) => {
  [...el.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === 'Vezi ca tabel')
    ?.click();
  fixture.detectChanges();
  await fixture.whenStable();
  const table = el.querySelector('table');
  return {
    heads: [...(table?.querySelectorAll('th') ?? [])].map((th) =>
      th.textContent?.trim(),
    ),
    rows: [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
    ),
  };
};

afterEach(() => TestBed.inject(I18n).use('ro'));

describe('a bar chart with a lead figure', () => {
  it('puts the lead figure in its own column before the value in the table', async () => {
    const [fixture, el] = await render();

    expect(await showTable(fixture, el)).toEqual({
      heads: ['Marcă', 'Căutări', 'Cereri'],
      rows: [
        ['Dacia', '8.900', '2.140'],
        ['Renault', '0', '412'],
        ['BMW', '2.600', '0'],
      ],
    });
  });

  it('names both figures of the highest and the lowest row in the image summary', async () => {
    const [, el] = await render();
    const summary = el.querySelector('canvas')?.getAttribute('aria-label');

    expect(summary).toContain('Căutări și cereri pe marcă, 30 de zile');
    expect(summary).toMatch(
      /Dacia[^.]*8\.900[^.]*2\.140|8\.900[^.]*2\.140[^.]*Dacia/,
    );
    expect(summary).toMatch(
      /BMW[^.]*2\.600[^.]*\b0\b|2\.600[^.]*\b0\b[^.]*BMW/,
    );
  });

  it('gives each row room for its name and both figures', async () => {
    const six = [...PAIRS, ...PAIRS].map((p, i) => ({ ...p, label: `${i}` }));
    const [, el] = await render((h) => h.points.set(six));

    // Three 12 px lines at Chart.js's 1.2 line height take 43.2 px; a 60 px
    // row leaves a clear gap before the next name.
    expect(el.querySelector<HTMLElement>('.mf-chart-plot')?.style.height).toBe(
      `${6 * 60 + 24}px`,
    );
  });

  it('grows every row by a 15 px line when a name wraps onto a second line', async () => {
    const [, el] = await render((h) =>
      h.points.set([
        { label: 'Schimb de ulei și filtre', lead: 3, value: 2 },
        ...PAIRS,
        ...PAIRS,
      ]),
    );

    expect(el.querySelector<HTMLElement>('.mf-chart-plot')?.style.height).toBe(
      `${7 * 75 + 24}px`,
    );
  });

  it('grows a one-figure row from 28 to 43 px when its name wraps', async () => {
    const [, el] = await render((h) => {
      h.points.set(
        Array.from({ length: 9 }, (_, i) => ({
          label: i ? `${i}` : 'Schimb de ulei și filtre',
          value: i,
        })),
      );
      h.leadHeading.set(undefined);
      h.valueHeading.set(undefined);
    });

    expect(el.querySelector<HTMLElement>('.mf-chart-plot')?.style.height).toBe(
      `${9 * 43 + 24}px`,
    );
  });

  it('keeps one value column and 28 px rows when no point has a lead', async () => {
    const [fixture, el] = await render((h) => {
      h.points.set(
        [...PAIRS, ...PAIRS, ...PAIRS].map(({ value }, i) => ({
          label: `${i}`,
          value,
        })),
      );
      h.leadHeading.set(undefined);
      h.valueHeading.set(undefined);
    });

    expect(el.querySelector<HTMLElement>('.mf-chart-plot')?.style.height).toBe(
      `${9 * 28 + 24}px`,
    );
    expect((await showTable(fixture, el)).heads).toEqual(['Marcă', 'Valoare']);
  });
});
