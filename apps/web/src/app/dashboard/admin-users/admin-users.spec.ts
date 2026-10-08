import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type AdminAccountDto,
  type AdminAccountsPageDto,
  type AdminAccountsSummaryDto,
  AdminService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminUsers } from './admin-users';

@Component({ imports: [AdminUsers], template: '<mf-admin-users />' })
class Host {}

const TOTALS: AdminAccountsSummaryDto = {
  activeDrivers: 12480,
  garagesListed: 214,
  mechanics: 531,
};

const item = (n: number, extra: Partial<AdminAccountDto> = {}) =>
  ({
    carsCount: 2,
    count: { kind: 'requests', value: 4 },
    createdAt: '2026-03-12T09:14:00.000Z',
    garageName: null,
    id: `id-${n}`,
    name: `Cont ${n}`,
    roles: ['driver'],
    since: '2026-03-12T09:14:00.000Z',
    status: 'active',
    ...extra,
  }) as AdminAccountDto;

const pageOf = (from: number, size: number, next: string | null) => ({
  items: Array.from({ length: size }, (_, i) => item(from + i)),
  nextCursor: next,
});

const failure = () => Promise.reject(new HttpErrorResponse({ status: 500 }));

let summary: () => Promise<AdminAccountsSummaryDto>;
let list: (cursor?: string) => Promise<AdminAccountsPageDto>;
let cursors: (string | undefined)[];
let seen: (() => void) | undefined;

// The list asks for more when its sentinel comes into view; the test says when.
class Observer {
  constructor(private readonly callback: IntersectionObserverCallback) {
    seen = () =>
      this.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  cursors = [];
  seen = undefined;
  summary = async () => TOTALS;
  list = async () => pageOf(0, 3, null);
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    Observer;
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
          adminAccountsControllerList: ({
            cursor,
          }: {
            cursor?: string;
          } = {}) => {
            cursors.push(cursor);
            return list(cursor);
          },
          adminAccountsControllerSummary: () => summary(),
          adminOverviewControllerGrowth: async () => ({ months: [] }),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('li.row')];
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);

describe('the totals line', () => {
  it('reads the three totals in Romanian plural forms, grouped', async () => {
    const el = await open();

    expect(text(el.querySelector('.totals'))).toBe(
      '12.480 de șoferi activi · 214 service‑uri · 531 de mecanici',
    );
  });

  it('reads them in English', async () => {
    const el = await open('en');

    expect(text(el.querySelector('.totals'))).toBe(
      '12,480 active drivers · 214 garages · 531 mechanics',
    );
  });

  it('uses the singular forms for one', async () => {
    summary = async () => ({
      activeDrivers: 1,
      garagesListed: 1,
      mechanics: 1,
    });
    const el = await open();

    expect(text(el.querySelector('.totals'))).toBe(
      '1 șofer activ · 1 service · 1 mecanic',
    );
  });

  it('shows a skeleton line while the totals load', async () => {
    summary = () => new Promise(() => {});
    const el = await open();

    const totals = el.querySelector('.totals');
    expect(totals?.getAttribute('aria-busy')).toBe('true');
    expect(totals?.querySelector('.skeleton')).not.toBeNull();
  });

  it('shows a dash and the reason when the totals cannot be read, never 0', async () => {
    summary = failure;
    const el = await open();

    const totals = el.querySelector('.totals');
    expect(text(totals)).toContain('—');
    expect(text(totals)).not.toContain('0');
    expect(totals?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Cifrele nu au putut fi citite',
    );
  });
});

describe('the recent accounts', () => {
  it('shows each account with its detail, a lamp with its state and the count', async () => {
    list = async () => ({
      items: [
        item(1, { name: 'Andrei M.' }),
        item(2, {
          count: { kind: 'age', value: 1 },
          name: 'Radu',
          since: '2026-10-02T10:00:00.000Z',
          status: 'suspended',
        }),
      ],
      nextCursor: null,
    });
    const el = await open();

    const [first, second] = rows(el);
    expect(text(first.querySelector('.name'))).toBe('Andrei M.');
    expect(text(first.querySelector('.detail'))).toBe('șofer · 2 mașini');
    expect(first.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );
    expect(text(first.querySelector('mf-lamp'))).toBe(
      'activ · din martie 2026',
    );
    expect(text(first.querySelector('.count'))).toBe('4 cereri');
    expect(second.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'red',
    );
    expect(text(second.querySelector('mf-lamp'))).toBe(
      'suspendat · din 2 oct. 2026',
    );
    expect(text(second.querySelector('.count'))).toBe('cont de 1 zi');
  });

  it('heads the panel "Conturi recente"', async () => {
    const el = await open();

    expect(text(el.querySelector('mf-panel h2'))).toBe('Conturi recente');
  });

  it('shows skeleton rows while the first page loads', async () => {
    list = () => new Promise(() => {});
    const el = await open();

    const listEl = el.querySelector('[aria-busy="true"] .skeleton-row');
    expect(listEl).not.toBeNull();
    expect(rows(el)).toHaveLength(0);
  });

  it('says so when there is no account at all', async () => {
    list = async () => ({ items: [], nextCursor: null });
    const el = await open();

    expect(text(el.querySelector('.empty'))).toBe('Niciun cont încă.');
  });

  it('offers to read the list again when it did not load', async () => {
    list = failure;
    const el = await open();

    expect(text(el.querySelector('.failed'))).toContain(
      'Lista nu s‑a încărcat',
    );
    list = async () => pageOf(0, 2, null);
    button(el, 'Reîncearcă')?.click();
    await settle();

    expect(rows(el)).toHaveLength(2);
    expect(el.querySelector('.failed')).toBeNull();
  });

  it('switches language without reading the list again', async () => {
    const el = await open();
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(text(rows(el)[0].querySelector('.detail'))).toBe('driver · 2 cars');
    expect(cursors).toHaveLength(1);
  });
});

describe('more rows as the admin scrolls', () => {
  it('appends the next page when the sentinel comes into view, until there is none', async () => {
    list = async (cursor) =>
      cursor === undefined
        ? pageOf(0, 20, 'c1')
        : cursor === 'c1'
          ? pageOf(20, 20, 'c2')
          : pageOf(40, 5, null);
    const el = await open();
    expect(rows(el)).toHaveLength(20);

    seen?.();
    await settle();
    seen?.();
    await settle();
    seen?.();
    await settle();

    expect(rows(el)).toHaveLength(45);
    expect(cursors).toEqual([undefined, 'c1', 'c2']);
    expect(
      new Set(rows(el).map((r) => text(r.querySelector('.name')))).size,
    ).toBe(45);
  });

  it('never asks for the same page twice while one is loading', async () => {
    let release: (page: AdminAccountsPageDto) => void = () => {};
    list = async (cursor) =>
      cursor === undefined
        ? pageOf(0, 20, 'c1')
        : new Promise((resolve) => {
            release = resolve;
          });
    const el = await open();

    seen?.();
    seen?.();
    await settle();
    release(pageOf(20, 1, null));
    await settle();

    expect(cursors).toEqual([undefined, 'c1']);
    expect(rows(el)).toHaveLength(21);
  });

  it('keeps the rows and offers a retry at the foot when a later page fails', async () => {
    list = async (cursor) =>
      cursor === undefined ? pageOf(0, 20, 'c1') : failure();
    const el = await open();

    seen?.();
    await settle();

    expect(rows(el)).toHaveLength(20);
    const retry = button(el, 'Reîncearcă');
    expect(retry).toBeDefined();
    list = async () => pageOf(20, 2, null);
    retry?.click();
    await settle();
    expect(rows(el)).toHaveLength(22);
  });
});

describe('the growth panel', () => {
  it('sits beside the list and shows whatever the list does', async () => {
    list = failure;
    const el = await open();

    expect(el.querySelector('mf-admin-growth')).not.toBeNull();
  });
});
