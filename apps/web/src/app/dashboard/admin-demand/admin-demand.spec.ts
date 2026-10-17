// @traces 103-FR-006 103-FR-007 103-FR-008 103-FR-009 103-FR-010 103-FR-013
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

const BRANDS = [
  'Dacia',
  'Volkswagen',
  'Renault',
  'Ford',
  'Skoda',
  'Opel',
  'BMW',
  'Toyota',
  'Audi',
  'Hyundai',
  'Mercedes-Benz',
  'Peugeot',
].map((name, i) => ({ name, requests: 2140 - i * 100 }));

const JOBS = [
  { key: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne', requests: 1200 },
  { key: 'oil', nameEn: 'Oil change', nameRo: 'Schimb ulei', requests: 800 },
];

const FULL: AdminDemandDto = {
  brands: BRANDS,
  firstDay: '2026-09-18',
  jobs: JOBS,
  lastDay: '2026-10-17',
  requests: BRANDS.reduce((sum, b) => sum + b.requests, 0),
};

let answer: () => Promise<AdminDemandDto>;
let reads: number;

beforeEach(() => {
  reads = 0;
  answer = async () => FULL;
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener: () => {},
      matches: false,
      media: query,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
});

afterEach(() => TestBed.resetTestingModule());

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  options: { overview?: boolean; language?: 'ro' | 'en' } = {},
) {
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
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.overview.set(options.overview ?? false);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const charts = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('mf-bar-chart'),
];
const titles = (el: HTMLElement) =>
  charts(el).map((c) => c.querySelector('h2')?.textContent?.trim());
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
// The rows a reader sees: a hidden list shows none.
const listOf = (chart: HTMLElement) =>
  [...chart.querySelectorAll('ol:not([hidden]) li')].map((li) =>
    [...li.querySelectorAll('span')].map((s) => s.textContent?.trim()),
  );

describe('AdminDemand, the view', () => {
  it('opens with the subtitle, then the brand report and the job report, each a labelled section', async () => {
    const el = await open();

    expect(el.querySelector('.subtitle')?.textContent?.trim()).toBe(
      'Ce au cerut șoferii în ultimele 30 de zile',
    );
    expect(titles(el)).toEqual([
      'Cereri pe marcă, 30 de zile',
      'Cereri pe lucrare, 30 de zile',
    ]);
    for (const chart of charts(el))
      expect(chart.querySelector('section[aria-labelledby]')).not.toBeNull();
    expect(el.querySelector('.subtitle')).toBe(el.querySelector('p, h2'));
  });

  it('draws the top 10 brands most first, grouping the counts', async () => {
    const el = await open();

    const rows = await tableOf(charts(el)[0]);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual(['Dacia', '2.140']);
    expect(rows[9]).toEqual(['Hyundai', '1.240']);
  });

  it('heads each table by what it lists, in either language', async () => {
    const heads = async (chart: HTMLElement) => {
      await tableOf(chart);
      return [...chart.querySelectorAll('th')].map((th) =>
        th.textContent?.trim(),
      );
    };
    const ro = await open();
    expect(await heads(charts(ro)[0])).toEqual(['Marcă', 'Valoare']);
    expect(await heads(charts(ro)[1])).toEqual(['Lucrare', 'Valoare']);
    TestBed.resetTestingModule();

    const en = await open({ language: 'en' });
    expect(await heads(charts(en)[0])).toEqual(['Brand', 'Value']);
    expect(await heads(charts(en)[1])).toEqual(['Job', 'Value']);
  });

  it('names each job in the interface language', async () => {
    const el = await open();

    expect(await tableOf(charts(el)[1])).toEqual([
      ['Frâne', '1.200'],
      ['Schimb ulei', '800'],
    ]);
  });

  it('offers the full brand list behind a button, and hides it again', async () => {
    const el = await open();
    const [brands, jobs] = charts(el);
    const all = buttonsNamed(brands, 'Vezi toate mărcile')[0];

    expect(all.getAttribute('aria-expanded')).toBe('false');
    expect(listOf(brands)).toEqual([]);
    expect(buttonsNamed(jobs, 'Vezi toate lucrările')).toHaveLength(0);

    all.click();
    await settle();

    expect(all.textContent?.trim()).toBe('Arată mai puține');
    expect(all.getAttribute('aria-expanded')).toBe('true');
    const list = listOf(brands);
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual(['Dacia', '2.140']);
    expect(list[11]).toEqual(['Peugeot', '1.040']);
    const controlled = all.getAttribute('aria-controls');
    expect(controlled && el.querySelector(`[id="${controlled}"]`)).toBeTruthy();

    all.click();
    await settle();

    expect(all.textContent?.trim()).toBe('Vezi toate mărcile');
    expect(listOf(brands)).toEqual([]);
  });

  it('offers the full job list when there are more than 10 jobs', async () => {
    const jobs = Array.from({ length: 11 }, (_, i) => ({
      key: `job-${String(i).padStart(2, '0')}`,
      nameEn: `Job ${i}`,
      nameRo: `Lucrare ${i}`,
      requests: 100 - i,
    }));
    answer = async () => ({ ...FULL, brands: BRANDS.slice(0, 3), jobs });
    const el = await open();
    const [brands, jobChart] = charts(el);

    expect(buttonsNamed(brands, 'Vezi toate mărcile')).toHaveLength(0);
    buttonsNamed(jobChart, 'Vezi toate lucrările')[0].click();
    await settle();

    expect(listOf(jobChart)).toHaveLength(11);
    expect(listOf(jobChart)[10]).toEqual(['Lucrare 10', '90']);
  });

  it('reads in English and re-writes in the other language without a new read', async () => {
    const el = await open({ language: 'en' });

    expect(el.querySelector('.subtitle')?.textContent?.trim()).toBe(
      'What drivers asked for in the last 30 days',
    );
    expect(titles(el)).toEqual([
      'Requests by brand, 30 days',
      'Requests by job, 30 days',
    ]);
    expect((await tableOf(charts(el)[0]))[0]).toEqual(['Dacia', '2,140']);
    expect(buttonsNamed(el, 'See all brands')).toHaveLength(1);

    await TestBed.inject(I18n).use('ro');
    await settle();

    expect((await tableOf(charts(el)[1]))[0]).toEqual(['Frâne', '1.200']);
    expect(reads).toBe(1);
  });

  it('shows the skeleton in both reports while the read is on its way', async () => {
    answer = () => new Promise(() => {});
    const el = await open();

    expect(el.querySelectorAll('mf-bar-chart .mf-chart-skeleton')).toHaveLength(
      2,
    );
    expect(buttonsNamed(el, 'Vezi toate mărcile')).toHaveLength(0);
  });

  it('shows retry on both reports when the read fails, and one press reads once and redraws both', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open();
    const retries = buttonsNamed(el, 'Reîncearcă');
    expect(retries).toHaveLength(2);

    answer = async () => FULL;
    retries[0].click();
    await settle();

    expect(reads).toBe(2);
    expect(el.querySelectorAll('canvas')).toHaveLength(2);
    expect(buttonsNamed(el, 'Reîncearcă')).toHaveLength(0);
  });

  it('says there are no requests yet in both reports for an empty window', async () => {
    answer = async () => ({ ...FULL, brands: [], jobs: [], requests: 0 });
    const el = await open();

    expect(
      [...el.querySelectorAll('mf-bar-chart .mf-chart-message')].map((m) =>
        m.textContent?.trim(),
      ),
    ).toEqual([
      'Încă nu sunt cereri în ultimele 30 de zile.',
      'Încă nu sunt cereri în ultimele 30 de zile.',
    ]);
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('reads once on opening and never again by itself', async () => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'queueMicrotask'] });
    try {
      await open();
      jest.advanceTimersByTime(60 * 60 * 1000);
      await settle();

      expect(reads).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AdminDemand, the overview panel', () => {
  it('shows only the brand report, with the top 8 brands and no full list', async () => {
    const el = await open({ overview: true });

    expect(titles(el)).toEqual(['Cereri pe marcă, 30 de zile']);
    expect(el.querySelector('.subtitle')).toBeNull();
    const rows = await tableOf(charts(el)[0]);
    expect(rows).toHaveLength(8);
    expect(rows[7]).toEqual(['Toyota', '1.440']);
    expect(buttonsNamed(el, 'Vezi toate mărcile')).toHaveLength(0);
  });

  it('has the same loading, failed and empty states', async () => {
    answer = () => new Promise(() => {});
    let el = await open({ overview: true });
    expect(el.querySelectorAll('.mf-chart-skeleton')).toHaveLength(1);
    TestBed.resetTestingModule();

    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    el = await open({ overview: true });
    expect(buttonsNamed(el, 'Reîncearcă')).toHaveLength(1);
    TestBed.resetTestingModule();

    answer = async () => ({ ...FULL, brands: [], jobs: [], requests: 0 });
    el = await open({ overview: true });
    expect(el.textContent).toContain(
      'Încă nu sunt cereri în ultimele 30 de zile.',
    );
  });
});
