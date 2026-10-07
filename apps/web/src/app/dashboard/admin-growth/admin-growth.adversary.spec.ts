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

const build = (start: string, values: (Partial<Month> | null)[]): Month[] => {
  const [year, month] = start.split('-').map(Number);
  return values.map((v, i) => {
    const index = year * 12 + (month - 1) + i;
    const label = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    return { ...(v ?? {}), month: label };
  });
};

let answer: () => Promise<{ months: Month[] }>;

beforeEach(() => {
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
        useValue: { adminOverviewControllerGrowth: () => answer() },
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

const ramp = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    activeDrivers: (i + 1) * 1000,
    garagesListed: i + 1,
  }));

describe('AdminGrowth at the edges', () => {
  it('labels a window that crosses the year, December and January, in Romanian', async () => {
    answer = async () => ({ months: build('2025-02', ramp(12)) });
    const el = await open();

    expect(texts(el, '.range')[0]).toBe('feb. 2025 – ian. 2026');
    const rows = await tableOf(charts(el)[0]);
    expect(rows[10][0]).toBe('decembrie 2025');
    expect(rows[11][0]).toBe('ianuarie 2026');
  });

  it('labels a window that crosses the year in English', async () => {
    answer = async () => ({ months: build('2025-02', ramp(12)) });
    const el = await open('en');

    expect(texts(el, '.range')[1]).toBe('Feb 2025 – Jan 2026');
    const rows = await tableOf(charts(el)[1]);
    expect(rows[10][0]).toBe('December 2025');
    expect(rows[11][0]).toBe('January 2026');
  });

  it('shows a recorded zero as 0 in the table and the latest value, never a dash', async () => {
    const values = ramp(12);
    values[3] = { activeDrivers: 0, garagesListed: 0 };
    values[11] = { activeDrivers: 0, garagesListed: 0 };
    answer = async () => ({ months: build('2025-11', values) });
    const el = await open();

    const rows = await tableOf(charts(el)[0]);
    expect(rows[3]).toEqual(['februarie 2026', '0']);
    expect(texts(el, '.latest')).toEqual(['0', '0']);
  });

  it('gives each chart its own gaps when only one figure is missing', async () => {
    const values: Partial<Month>[] = ramp(12);
    values[5] = { garagesListed: 6 };
    answer = async () => ({ months: build('2025-11', values) });
    const el = await open();

    const [drivers, garages] = charts(el);
    expect((await tableOf(drivers))[5][1]).toBe('—');
    expect((await tableOf(garages))[5][1]).toBe('6');
  });

  it('breaks the line at a gap in the middle of the history and keeps the dash there', async () => {
    const values: (Partial<Month> | null)[] = ramp(12);
    values[4] = null;
    values[5] = null;
    answer = async () => ({ months: build('2025-11', values) });
    const el = await open();

    const rows = await tableOf(charts(el)[0]);
    expect(rows.map(([, v]) => v).slice(3, 7)).toEqual([
      '4.000',
      '—',
      '—',
      '7.000',
    ]);
  });

  it('shows no data yet on both charts when every month is empty, with the latest value dashed or zero rather than blank', async () => {
    answer = async () => ({ months: build('2025-11', Array(12).fill(null)) });
    const el = await open();

    expect(texts(el, 'mf-line-chart .mf-chart-message')).toEqual([
      'Încă nu sunt date',
      'Încă nu sunt date',
    ]);
    expect(el.querySelector('canvas')).toBeNull();
    expect(texts(el, '.latest')).toEqual(['—', '—']);
  });

  it('shows no data yet in English when only the current month has a figure', async () => {
    const values = Array(12).fill(null);
    values[11] = { activeDrivers: 1500, garagesListed: 12 };
    answer = async () => ({ months: build('2025-11', values) });
    const el = await open('en');

    expect(texts(el, 'mf-line-chart .mf-chart-message')).toEqual([
      'No data yet',
      'No data yet',
    ]);
    expect(texts(el, '.latest')).toEqual(['1,500', '12']);
  });

  it('draws a chart for a single past month plus the live month', async () => {
    const values = Array(12).fill(null);
    values[10] = { activeDrivers: 100, garagesListed: 5 };
    values[11] = { activeDrivers: 120, garagesListed: 6 };
    answer = async () => ({ months: build('2025-11', values) });
    const el = await open();

    expect(el.querySelectorAll('canvas')).toHaveLength(2);
    expect(texts(el, 'mf-line-chart .mf-chart-message')).toEqual([]);
  });

  it('groups large numbers by language', async () => {
    const values = ramp(12);
    values[11] = { activeDrivers: 1234567, garagesListed: 12345 };
    answer = async () => ({ months: build('2025-11', values) });

    const ro = await open();
    expect(texts(ro, '.latest')).toEqual(['1.234.567', '12.345']);
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(texts(en, '.latest')).toEqual(['1,234,567', '12,345']);
  });

  it('shows retry rather than charts when the answer is an empty month list', async () => {
    answer = async () => ({ months: [] });
    const el = await open();

    expect(el.querySelectorAll('canvas')).toHaveLength(0);
    expect(el.querySelector('section')).not.toBeNull();
  });

  it('shows retry on both charts when the read is refused with 404', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 404 });
    };
    const el = await open();

    expect(
      [...el.querySelectorAll('button')].filter(
        (b) => b.textContent?.trim() === 'Reîncearcă',
      ),
    ).toHaveLength(2);
  });

  it('writes the English retry label when the read fails in English', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };
    const el = await open('en');

    expect(
      [...el.querySelectorAll('button')].filter(
        (b) => b.textContent?.trim() === 'Retry',
      ),
    ).toHaveLength(2);
  });
});
