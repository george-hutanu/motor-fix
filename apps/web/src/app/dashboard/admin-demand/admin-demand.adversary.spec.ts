import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type AdminDemandDto, AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminDemand } from './admin-demand';

@Component({
  imports: [AdminDemand],
  template: `
    @if (overview()) {
      <mf-admin-demand overview />
    } @else {
      <mf-admin-demand />
    }
  `,
})
class Host {
  readonly overview = signal(false);
}

const brands = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Brand ${String(i).padStart(2, '0')}`,
    requests: 5000 - i,
  }));
const jobs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    key: `job-${String(i).padStart(2, '0')}`,
    nameEn: `Job ${i}`,
    nameRo: `Lucrare ${i}`,
    requests: 3000 - i,
  }));
const dto = (b: number, j: number): AdminDemandDto => ({
  brands: brands(b),
  firstDay: '2026-09-18',
  jobs: jobs(j),
  lastDay: '2026-10-17',
  requests: 1,
});

let answer: () => Promise<AdminDemandDto>;
let reads: number;

beforeEach(() => {
  reads = 0;
  answer = async () => dto(12, 12);
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener: () => {},
      matches: false,
      media: query,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.replaceChildren();
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(options: { overview?: boolean } = {}) {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          demandControllerDemand: () => {
            reads += 1;
            return answer();
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  fixture.componentInstance.overview.set(options.overview ?? false);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const charts = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('mf-bar-chart'),
];
const buttonsNamed = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === name,
  );
const tableOf = async (chart: HTMLElement) => {
  const toggle = [...chart.querySelectorAll('button')].find((b) =>
    ['Vezi ca tabel', 'View as table'].includes(b.textContent?.trim() ?? ''),
  );
  toggle?.click();
  await settle();
  return [...chart.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((td) => td.textContent?.trim()),
  );
};
const listOf = (chart: HTMLElement) =>
  [...chart.querySelectorAll('li')].map((li) =>
    [...li.querySelectorAll('span')].map((s) => s.textContent?.trim()),
  );

describe('AdminDemand under hostile answers', () => {
  // @traces 103-FR-007
  it('shows 10 brands and no full-list button for exactly 10', async () => {
    answer = async () => dto(10, 10);
    const el = await open();

    expect(await tableOf(charts(el)[0])).toHaveLength(10);
    expect(buttonsNamed(el, 'Vezi toate mărcile')).toHaveLength(0);
    expect(buttonsNamed(el, 'Vezi toate lucrările')).toHaveLength(0);
  });

  // @traces 103-FR-007
  it('shows 10 bars and the button for exactly 11, the full list holding 11', async () => {
    answer = async () => dto(11, 11);
    const el = await open();
    const [b, j] = charts(el);

    expect(await tableOf(b)).toHaveLength(10);
    buttonsNamed(b, 'Vezi toate mărcile')[0].click();
    await settle();
    expect(listOf(b)).toHaveLength(11);
    buttonsNamed(b, 'Arată mai puține')[0].click();
    buttonsNamed(j, 'Vezi toate lucrările')[0].click();
    await settle();

    expect(listOf(j)).toHaveLength(11);
  });

  // @traces 103-FR-007
  it('keeps the brand list open when the job list is opened as well', async () => {
    const el = await open();
    const [b, j] = charts(el);

    buttonsNamed(b, 'Vezi toate mărcile')[0].click();
    await settle();
    buttonsNamed(j, 'Vezi toate lucrările')[0].click();
    await settle();

    expect(listOf(b)).toHaveLength(12);
    expect(listOf(j)).toHaveLength(12);
    expect(buttonsNamed(b, 'Arată mai puține')).toHaveLength(1);
  });

  // @traces 103-FR-008
  it('shows 8 brands for exactly 8 and for 9, never a full-list button, even with 30 brands', async () => {
    for (const n of [8, 9, 30]) {
      answer = async () => dto(n, 3);
      const el = await open({ overview: true });
      expect(await tableOf(charts(el)[0])).toHaveLength(8);
      expect(buttonsNamed(el, 'Vezi toate mărcile')).toHaveLength(0);
      TestBed.resetTestingModule();
      document.body.replaceChildren();
    }
  });

  // @traces 103-FR-010
  it('redraws from the second read when the first failed after the second began', async () => {
    let fail: (() => void) | undefined;
    answer = () =>
      new Promise((_, reject) => {
        fail = () => reject(new HttpErrorResponse({ status: 500 }));
      });
    const el = await open();
    expect(el.querySelectorAll('.mf-chart-skeleton')).toHaveLength(2);

    fail?.();
    await settle();
    answer = async () => dto(3, 3);
    buttonsNamed(el, 'Reîncearcă')[0].click();
    await settle();

    expect(el.querySelectorAll('canvas')).toHaveLength(2);
    expect(buttonsNamed(el, 'Reîncearcă')).toHaveLength(0);
  });

  // @traces 103-FR-010
  it('stays on the error when a retry fails again and recovers on the third press', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open();

    buttonsNamed(el, 'Reîncearcă')[0].click();
    await settle();
    expect(buttonsNamed(el, 'Reîncearcă')).toHaveLength(2);
    answer = async () => dto(4, 4);
    buttonsNamed(el, 'Reîncearcă')[1].click();
    await settle();

    expect(reads).toBe(3);
    expect(el.querySelectorAll('canvas')).toHaveLength(2);
  });

  // @traces 103-FR-013
  it('keeps focus inside the page after a retry press, never on the body', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open();
    const retry = buttonsNamed(el, 'Reîncearcă')[0];
    retry.focus();

    retry.click();
    await settle();

    expect(el.contains(document.activeElement)).toBe(true);
  });

  // @traces 103-FR-009
  it('writes a brand name holding markup as text', async () => {
    answer = async () => ({
      ...dto(0, 0),
      brands: [{ name: '<img src=x onerror=alert(1)>', requests: 3 }],
      requests: 3,
    });
    const el = await open();

    expect(el.querySelector('img')).toBeNull();
    expect(await tableOf(charts(el)[0])).toEqual([
      ['<img src=x onerror=alert(1)>', '3'],
    ]);
  });

  // @traces 103-FR-003
  it('labels an empty brand name as stored and keeps its count', async () => {
    answer = async () => ({
      ...dto(0, 0),
      brands: [
        { name: 'Dacia', requests: 3 },
        { name: '', requests: 2 },
      ],
      requests: 5,
    });
    const el = await open();

    expect(await tableOf(charts(el)[0])).toEqual([
      ['Dacia', '3'],
      ['', '2'],
    ]);
  });

  // @traces 103-FR-009
  it('groups counts of a million and above in both languages', async () => {
    answer = async () => ({
      ...dto(0, 0),
      brands: [{ name: 'Dacia', requests: 1234567 }],
      requests: 1234567,
    });
    const el = await open();
    expect(await tableOf(charts(el)[0])).toEqual([['Dacia', '1.234.567']]);

    await TestBed.inject(I18n).use('en');
    await settle();

    const cells = [...charts(el)[0].querySelectorAll('tbody td')].map((td) =>
      td.textContent?.trim(),
    );
    expect(cells).toEqual(['Dacia', '1,234,567']);
  });

  // @traces 103-FR-009
  it('switches the full job list names and numbers with the language without a read', async () => {
    answer = async () => ({
      ...dto(0, 11),
      jobs: jobs(11).map((j, i) => (i === 0 ? { ...j, requests: 2140 } : j)),
    });
    const el = await open();
    const jobsChart = charts(el)[1];
    buttonsNamed(jobsChart, 'Vezi toate lucrările')[0].click();
    await settle();
    expect(listOf(jobsChart)[0]).toEqual(['Lucrare 0', '2.140']);

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(listOf(jobsChart)[0]).toEqual(['Job 0', '2,140']);
    expect(reads).toBe(1);
  });

  // @traces 103-FR-010
  it('shows the empty message in the overview panel for an empty window', async () => {
    answer = async () => dto(0, 0);
    const el = await open({ overview: true });

    expect(el.querySelector('.mf-chart-message')?.textContent?.trim()).toBe(
      'Încă nu sunt cereri în ultimele 30 de zile.',
    );
    expect(el.querySelector('canvas')).toBeNull();
  });

  // @traces 103-FR-013
  it('wires the full-list button to a list that exists and is hidden while closed', async () => {
    const el = await open();
    const button = buttonsNamed(charts(el)[0], 'Vezi toate mărcile')[0];
    const list = el.querySelector(
      `[id="${button.getAttribute('aria-controls')}"]`,
    ) as HTMLElement;

    expect(list.hidden).toBe(true);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  // @traces 103-FR-013
  it('hides the full list by one switch: the closed list already holds its rows', async () => {
    const el = await open();
    const button = buttonsNamed(charts(el)[0], 'Vezi toate mărcile')[0];
    const list = el.querySelector(
      `[id="${button.getAttribute('aria-controls')}"]`,
    ) as HTMLElement;

    expect(list.hidden).toBe(true);
    expect(list.querySelectorAll('li').length).toBeGreaterThan(0);
  });

  // @traces 103-FR-013
  it('keeps the full-list button after its chart in tab order and each chart text alternative', async () => {
    const el = await open();
    const chart = charts(el)[0];

    const labelled = chart.querySelector('canvas')?.getAttribute('aria-label');
    expect(labelled).toMatch(/Dacia|Brand 00/);
    const focusable = [...chart.querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(focusable).toEqual(['Vezi ca tabel', 'Vezi toate mărcile']);
  });
});
