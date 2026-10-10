import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  type AdminAccountDto,
  type AdminAccountsPageDto,
  type AdminAccountsSummaryDto,
  AdminService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminUsers } from './admin-users';

const VIEW = '/app/admin/users';

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
type Read = {
  cursor?: string;
  q?: string;
  role?: string[];
  status?: string;
};

let list: (cursor?: string, read?: Read) => Promise<AdminAccountsPageDto>;
let cursors: (string | undefined)[];
let reads: Read[];
let seen: (() => void) | undefined;
let inView: boolean;

// The list asks for more when its sentinel comes into view; the test says when.
class Observer {
  constructor(private readonly callback: IntersectionObserverCallback) {
    seen = () =>
      this.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  // A sentinel already in view reports so soon after it is observed,
  // never inside the observe() call, as the browser does.
  observe() {
    if (inView) queueMicrotask(() => seen?.());
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  cursors = [];
  reads = [];
  seen = undefined;
  inView = false;
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

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro', url = VIEW) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: AdminUsers, path: 'app/admin/users' }]),
      provideLocationMocks(),
      {
        provide: AdminService,
        useValue: {
          adminAccountsControllerList: (read: Read = {}) => {
            cursors.push(read.cursor);
            reads.push(read);
            return list(read.cursor, read);
          },
          adminAccountsControllerSummary: () => summary(),
          adminOverviewControllerGrowth: async () => ({ months: [] }),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const harness = await RouterTestingHarness.create();
  // A booted app listens for the back button; the test bed does not boot one.
  TestBed.inject(Router).setUpLocationChangeListener();
  await harness.navigateByUrl(url);
  document.body.append(harness.fixture.nativeElement);
  await settle();
  return harness.routeNativeElement as HTMLElement;
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

  it('chains the next pages while the sentinel stays in view, with no new intersection', async () => {
    inView = true;
    list = async (cursor) =>
      cursor === undefined
        ? pageOf(0, 20, 'c1')
        : cursor === 'c1'
          ? pageOf(20, 20, 'c2')
          : pageOf(40, 5, null);
    const el = await open();
    await settle();

    expect(cursors).toEqual([undefined, 'c1', 'c2']);
    expect(rows(el)).toHaveLength(45);
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

const box = (el: HTMLElement) =>
  el.querySelector('input[type="search"]') as HTMLInputElement;
const type = (el: HTMLElement, value: string) => {
  box(el).value = value;
  box(el).dispatchEvent(new Event('input'));
};
const state = (el: HTMLElement) =>
  el.querySelector('select.state') as HTMLSelectElement;
const choose = (el: HTMLElement, value: string) => {
  state(el).value = value;
  state(el).dispatchEvent(new Event('change'));
};
const found = (el: HTMLElement) => el.querySelector('.found');
const url = () => TestBed.inject(Router).url;
const names = (el: HTMLElement) =>
  rows(el).map((r) => text(r.querySelector('.name')));
const named = (...list: string[]) => ({
  items: list.map((name, n) => item(n, { id: `id-${name}`, name })),
  nextCursor: null,
  total: list.length,
});
const fakeClock = () =>
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
  });
// The search box commits its text 300 ms after the last key.
async function search(el: HTMLElement, value: string) {
  fakeClock();
  type(el, value);
  jest.advanceTimersByTime(300);
  jest.useRealTimers();
  await settle();
}

// @traces 002-find-account-search-FR-009
describe('searching the accounts', () => {
  it('reads once, 300 ms after the last key, a key within the wait restarting it', async () => {
    const el = await open();
    fakeClock();

    type(el, 'an');
    jest.advanceTimersByTime(200);
    type(el, 'andrei');
    jest.advanceTimersByTime(299);
    expect(reads).toHaveLength(1);

    jest.advanceTimersByTime(1);
    jest.useRealTimers();
    await settle();
    expect(reads).toHaveLength(2);
    expect(reads[1]).toMatchObject({ q: 'andrei' });
    expect(reads[1].cursor).toBeUndefined();
  });

  it('sends fewer than 2 characters as no search and reads the whole list again', async () => {
    const el = await open('ro', `${VIEW}?q=dinamo`);
    expect(reads[0]).toMatchObject({ q: 'dinamo' });

    await search(el, ' a ');

    expect(reads.at(-1)?.q).toBeUndefined();
    expect(url()).toBe(VIEW);
  });

  it('never shows a read that a newer one replaced', async () => {
    const pending = new Map<string, (page: AdminAccountsPageDto) => void>();
    const el = await open();
    list = (_cursor, read) =>
      new Promise((resolve) => pending.set(read?.q ?? '', resolve));

    await search(el, 'ma');
    await search(el, 'marin');
    pending.get('marin')?.(named('Andrei Marin'));
    await settle();
    pending.get('ma')?.(named('Maria Pop', 'Mara Ion'));
    await settle();

    expect(names(el)).toEqual(['Andrei Marin']);
  });

  it('drops a next page still loading when the search changes', async () => {
    let release: (page: AdminAccountsPageDto) => void = () => {};
    list = async (cursor, read) =>
      read?.q
        ? named('Atelier Dinamo')
        : cursor === undefined
          ? pageOf(0, 20, 'c1')
          : new Promise((resolve) => {
              release = resolve;
            });
    const el = await open();

    seen?.();
    await settle();
    await search(el, 'dinamo');
    release(pageOf(20, 5, null));
    await settle();

    expect(names(el)).toEqual(['Atelier Dinamo']);
  });

  it('pages within the search, sending it with the cursor', async () => {
    list = async (cursor) =>
      cursor === undefined
        ? { ...pageOf(0, 20, 'c1'), total: 23 }
        : { ...pageOf(20, 3, null), total: 23 };
    const el = await open('ro', `${VIEW}?q=marin&role=driver`);

    seen?.();
    await settle();

    expect(reads[1]).toMatchObject({
      cursor: 'c1',
      q: 'marin',
      role: ['driver'],
    });
    expect(rows(el)).toHaveLength(23);
  });

  // @traces 002-find-account-search-FR-012
  it('shows the skeleton rows while a search reads, the controls still usable, and retries the same search after a failure', async () => {
    const el = await open();
    list = () => new Promise(() => {});

    await search(el, 'dinamo');

    expect(el.querySelector('[aria-busy="true"] .skeleton-row')).not.toBeNull();
    expect(box(el).disabled).toBe(false);

    list = failure;
    choose(el, 'active');
    await settle();
    expect(text(el.querySelector('.failed'))).toContain(
      'Lista nu s‑a încărcat',
    );

    list = async () => named('Atelier Dinamo');
    button(el, 'Reîncearcă')?.click();
    await settle();
    expect(reads.at(-1)).toMatchObject({ q: 'dinamo', status: 'active' });
    expect(names(el)).toEqual(['Atelier Dinamo']);
  });
});

// @traces 002-find-account-search-FR-011
describe('the count line', () => {
  it('counts what a search found in the Romanian plural forms, in a live region', async () => {
    list = async () => ({ ...pageOf(0, 20, 'c1'), total: 37 });
    const el = await open('ro', `${VIEW}?q=marin`);

    expect(text(found(el))).toBe('37 de conturi găsite');
    expect(found(el)?.getAttribute('aria-live')).toBe('polite');
  });

  it.each([
    [1, '1 cont găsit'],
    [3, '3 conturi găsite'],
    [1234, '1.234 de conturi găsite'],
  ])('reads %i as "%s"', async (total, line) => {
    list = async () => ({ ...pageOf(0, 1, null), total });
    const el = await open('ro', `${VIEW}?status=active`);

    expect(text(found(el))).toBe(line);
  });

  it('counts in English', async () => {
    list = async () => ({ ...pageOf(0, 1, null), total: 1234 });
    const el = await open('en', `${VIEW}?role=mechanic`);

    expect(text(found(el))).toBe('1,234 accounts found');
  });

  it('is not there for the whole list', async () => {
    const el = await open();

    expect(found(el)).toBeNull();
  });
});

// @traces 002-find-account-search-FR-012
describe('a search with no match', () => {
  it('says so and clears the search and filters, reading the whole list and putting focus in the box', async () => {
    list = async (_cursor, read) =>
      read?.q || read?.role || read?.status
        ? { items: [], nextCursor: null, total: 0 }
        : pageOf(0, 3, null);
    const el = await open(
      'ro',
      `${VIEW}?city=cluj-napoca&q=zzz&role=mechanic&status=active`,
    );

    expect(text(el.querySelector('.empty'))).toBe(
      'Niciun cont nu se potrivește.',
    );
    const clear = button(el, 'Șterge filtrele');
    expect(clear?.getAttribute('type')).toBe('button');
    clear?.click();
    await settle();

    expect(url()).toBe(`${VIEW}?city=cluj-napoca`);
    expect(reads.at(-1)).toEqual({});
    expect(rows(el)).toHaveLength(3);
    expect(box(el).value).toBe('');
    expect(state(el).value).toBe('');
    expect(document.activeElement).toBe(box(el));
  });

  it('reads in English', async () => {
    list = async () => ({ items: [], nextCursor: null, total: 0 });
    const el = await open('en', `${VIEW}?q=zzz`);

    expect(text(el.querySelector('.empty'))).toBe('No account matches.');
    expect(button(el, 'Clear the filters')).toBeDefined();
  });
});

// @traces 002-find-account-search-FR-010
describe('the search on the address', () => {
  it('fills the controls from the address and reads the narrowed list', async () => {
    const el = await open('ro', `${VIEW}?q=dinamo&role=mechanic&status=active`);

    expect(reads).toEqual([
      { q: 'dinamo', role: ['mechanic'], status: 'active' },
    ]);
    expect(box(el).value).toBe('dinamo');
    expect(state(el).value).toBe('active');
    expect(text(el.querySelector('button.roles'))).toBe('mecanic');
  });

  it('reads several roles written with commas', async () => {
    await open('ro', `${VIEW}?role=mechanic,driver`);

    expect(reads[0].role).toEqual(['driver', 'mechanic']);
  });

  it('drops an unknown role or state from the address, in place, and never sends it', async () => {
    await open(
      'ro',
      `${VIEW}?city=cluj-napoca&role=pilot,mechanic&status=deleted`,
    );

    expect(reads.at(-1)).toEqual({ role: ['mechanic'] });
    expect(reads.some((r) => r.status || r.role?.includes('pilot'))).toBe(
      false,
    );
    expect(url()).toBe(`${VIEW}?city=cluj-napoca&role=mechanic`);
    expect(
      TestBed.inject(Router).lastSuccessfulNavigation()?.extras.replaceUrl,
    ).toBe(true);
  });

  it('keeps the first 80 characters of a longer search on the address', async () => {
    await open('ro', `${VIEW}?q=${'a'.repeat(90)}`);

    expect(reads.at(-1)?.q).toBe('a'.repeat(80));
  });

  it('writes each applied change as its own history entry, keeping the shell keys', async () => {
    const el = await open('ro', `${VIEW}?city=cluj-napoca&period=7d`);

    choose(el, 'active');
    await settle();
    expect(url()).toBe(`${VIEW}?city=cluj-napoca&period=7d&status=active`);

    await search(el, 'dinamo');
    expect(url()).toBe(
      `${VIEW}?city=cluj-napoca&period=7d&q=dinamo&status=active`,
    );
    expect(reads.at(-1)).toEqual({ q: 'dinamo', status: 'active' });

    TestBed.inject(Location).back();
    await settle();
    expect(url()).toBe(`${VIEW}?city=cluj-napoca&period=7d&status=active`);
    expect(box(el).value).toBe('');
    expect(reads.at(-1)).toEqual({ status: 'active' });

    TestBed.inject(Location).back();
    await settle();
    expect(url()).toBe(`${VIEW}?city=cluj-napoca&period=7d`);
    expect(reads.at(-1)).toEqual({});
  });

  it('writes the roles comma-separated in their fixed order', async () => {
    const el = await open();

    (el.querySelector('button.roles') as HTMLButtonElement).click();
    await settle();
    const tick = (name: string) =>
      (
        [
          ...document.querySelectorAll<HTMLInputElement>(
            'fieldset[aria-label="Roluri"] input[type="checkbox"]',
          ),
        ].find(
          (c) => c.closest('label')?.textContent?.trim() === name,
        ) as HTMLInputElement
      ).click();
    tick('mecanic');
    await settle();
    tick('șofer');
    await settle();

    expect(url()).toBe(`${VIEW}?role=driver,mechanic`);
    expect(reads.at(-1)).toEqual({ role: ['driver', 'mechanic'] });
  });
});
