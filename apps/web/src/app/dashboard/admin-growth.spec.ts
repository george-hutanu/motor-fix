import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminGrowth } from './admin-growth';

@Component({ imports: [AdminGrowth], template: '<mf-admin-growth />' })
class Host {}

interface Month {
  month: string;
  activeDrivers?: number;
  garagesListed?: number;
}

const MONTHS = [
  '2025-11',
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
];
const DRIVERS = [
  6120, 6700, 7300, 8400, 9870, 10200, 10650, 11000, 11400, 11800, 12168, 12480,
];
const LISTED = [96, 104, 118, 130, 141, 152, 163, 170, 181, 190, 205, 214];

const TWELVE: Month[] = MONTHS.map((month, i) => ({
  activeDrivers: DRIVERS[i],
  garagesListed: LISTED[i],
  month,
}));

let answer: () => Promise<{ months: Month[] }>;
let reads: number;

beforeEach(() => {
  reads = 0;
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

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGrowth: () => {
            reads += 1;
            return answer();
          },
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const charts = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('mf-line-chart'),
];
const texts = (el: HTMLElement, selector: string) =>
  [...el.querySelectorAll(selector)].map((e) => e.textContent?.trim());
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
const buttonsNamed = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === name,
  );

describe('AdminGrowth', () => {
  it('shows a section titled by the growth title, holding the drivers chart then the garages chart', async () => {
    answer = async () => ({ months: TWELVE });
    const el = await open();

    const section = el.querySelector('section[aria-labelledby]');
    const heading = section?.getAttribute('aria-labelledby');
    expect(el.querySelector(`[id="${heading}"]`)?.textContent?.trim()).toBe(
      'Creștere, ultimele 12 luni',
    );
    expect(
      charts(el).map((c) => c.querySelector('h2')?.textContent?.trim()),
    ).toEqual(['Șoferi activi', 'Service‑uri listate']);
  });

  it('writes the latest values grouped and the first and last month under each chart', async () => {
    answer = async () => ({ months: TWELVE });
    const el = await open();

    expect(texts(el, '.latest')).toEqual(['12.480', '214']);
    expect(texts(el, '.range')).toEqual([
      'nov. 2025 – oct. 2026',
      'nov. 2025 – oct. 2026',
    ]);
  });

  it('labels every point with the full month name and year, and the table groups the value', async () => {
    answer = async () => ({ months: TWELVE });
    const el = await open();

    const rows = await tableOf(charts(el)[0]);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual(['noiembrie 2025', '6.120']);
    expect(rows[4]).toEqual(['martie 2026', '9.870']);
  });

  it('reads in English', async () => {
    answer = async () => ({ months: TWELVE });
    const el = await open('en');

    expect(el.querySelector('section h2')?.textContent?.trim()).toBe(
      'Growth, last 12 months',
    );
    expect(
      charts(el).map((c) => c.querySelector('h2')?.textContent?.trim()),
    ).toEqual(['Active drivers', 'Garages listed']);
    expect(texts(el, '.latest')).toEqual(['12,480', '214']);
    expect(texts(el, '.range')[0]).toBe('Nov 2025 – Oct 2026');
    expect((await tableOf(charts(el)[0]))[4]).toEqual(['March 2026', '9,870']);
  });

  it('re-writes the labels and values when the language changes, without a new read', async () => {
    answer = async () => ({ months: TWELVE });
    const el = await open();

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(texts(el, '.latest')).toEqual(['12,480', '214']);
    expect(texts(el, '.range')[1]).toBe('Nov 2025 – Oct 2026');
    expect((await tableOf(charts(el)[1]))[0]).toEqual(['November 2025', '96']);
    expect(reads).toBe(1);
  });

  it('leaves a month without a figure as a gap with a dash in the table, keeping the twelve months', async () => {
    const months = TWELVE.map((m) =>
      m.month === '2026-06' ? { month: m.month } : m,
    );
    answer = async () => ({ months });
    const el = await open();

    const [drivers, garages] = charts(el);
    const rows = await tableOf(drivers);
    expect(rows).toHaveLength(12);
    expect(rows[7]).toEqual(['iunie 2026', '—']);
    expect(rows.map(([, value]) => value)).not.toContain('0');
    expect(await tableOf(garages)).toHaveLength(12);
  });

  it('starts the line at the first month with a figure', async () => {
    const months = TWELVE.map((m, i) => (i < 5 ? { month: m.month } : m));
    answer = async () => ({ months });
    const el = await open();

    const values = (await tableOf(charts(el)[1])).map(([, value]) => value);
    expect(values).toEqual([
      ...Array(5).fill('—'),
      ...LISTED.slice(5).map(String),
    ]);
    expect(texts(el, '.range')[1]).toBe('nov. 2025 – oct. 2026');
  });

  it('says there is no data yet when only the live month has figures, still writing the latest values', async () => {
    const months = TWELVE.map((m, i) => (i < 11 ? { month: m.month } : m));
    answer = async () => ({ months });
    const el = await open();

    expect(texts(el, 'mf-line-chart .mf-chart-message')).toEqual([
      'Încă nu sunt date',
      'Încă nu sunt date',
    ]);
    expect(el.querySelector('canvas')).toBeNull();
    expect(texts(el, '.latest')).toEqual(['12.480', '214']);
  });

  it('shows the chart skeleton in both charts while the read is on its way', async () => {
    answer = () => new Promise(() => {});
    const el = await open();

    expect(
      el.querySelectorAll('mf-line-chart .mf-chart-skeleton'),
    ).toHaveLength(2);
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('shows retry on both charts when the read fails, and one press reads once and redraws both', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open();

    const retries = buttonsNamed(el, 'Reîncearcă');
    expect(retries).toHaveLength(2);
    expect(el.querySelector('canvas')).toBeNull();

    answer = async () => ({ months: TWELVE });
    retries[1].click();
    await settle();

    expect(reads).toBe(2);
    expect(el.querySelectorAll('canvas')).toHaveLength(2);
    expect(buttonsNamed(el, 'Reîncearcă')).toHaveLength(0);
    expect(texts(el, '.latest')).toEqual(['12.480', '214']);
  });

  it('reads the growth once on opening and never again by itself', async () => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'queueMicrotask'] });
    try {
      answer = async () => ({ months: TWELVE });
      await open();

      jest.advanceTimersByTime(60 * 60 * 1000);
      await settle();

      expect(reads).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
