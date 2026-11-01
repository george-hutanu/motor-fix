// @traces 1416-FR-002 1416-FR-003 1416-FR-004 1416-FR-005 1416-FR-006 1416-FR-007 1416-FR-008 1416-FR-009
import { TestBed } from '@angular/core/testing';
import {
  type AdminAreaDto,
  type AdminDemandSupplyDto,
  type AdminDemandSupplyRowDto,
  AdminService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { AdminDemandSupply } from './admin-demand-supply';

type Params = { brand?: string; area?: string } | undefined;

const SECTOR_3: AdminAreaDto = {
  code: 'sector-3',
  kind: 'sector',
  name: 'Sector 3',
};
const CLUJ: AdminAreaDto = {
  code: 'cluj-napoca',
  kind: 'city',
  name: 'Cluj-Napoca',
};
const UNKNOWN: AdminAreaDto = {
  code: 'unknown',
  kind: 'unknown',
  name: 'Zonă necunoscută',
};

const BMW: AdminDemandSupplyRowDto = {
  area: SECTOR_3,
  brand: 'BMW',
  requests: 96,
  requestsPerGarage: 24,
  searches: 420,
  supply: 4,
  unmet: 12,
};
const TESLA: AdminDemandSupplyRowDto = {
  area: CLUJ,
  brand: 'Tesla',
  requests: 0,
  requestsPerGarage: null,
  searches: 85,
  supply: 0,
  unmet: 0,
};

// 31 October 2026, noon in Bucharest (UTC+2 since 25 October).
const NOW = new Date('2026-10-31T10:00:00Z');
const TODAY_AT_ONE = '2026-10-30T23:00:00.000Z';

const supply = (
  rows: AdminDemandSupplyRowDto[],
  writtenAt: string | null = TODAY_AT_ONE,
): AdminDemandSupplyDto => ({
  areas: [SECTOR_3, CLUJ, UNKNOWN],
  firstDay: '2026-10-02',
  lastDay: '2026-10-31',
  rows,
  writtenAt,
});

let answer: (params: Params) => Promise<AdminDemandSupplyDto>;
let calls: Params[];

beforeEach(() => {
  calls = [];
  answer = async () => supply([BMW, TESLA]);
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
    now: NOW,
  });
});

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

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
          demandControllerSupply: (params: Params) => {
            calls.push(params);
            return answer(params);
          },
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(AdminDemandSupply);
  document.body.replaceChildren(fixture.nativeElement);
  await settle();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}

const text = (node: Element | null | undefined) =>
  node?.textContent?.replace(/\s+/g, ' ').trim();

const rowsOf = (el: HTMLElement) =>
  [...el.querySelectorAll('tbody tr')].map((tr) => ({
    figures: text(tr.querySelector('.figures')),
    lamp: text(tr.querySelector('mf-lamp')) ?? null,
    name: text(tr.querySelector('.name')),
    unmet: text(tr.querySelector('td.count')),
  }));

const select = (el: HTMLElement, filter: 'brand' | 'area') => {
  const found = el.querySelector<HTMLSelectElement>(
    `select[data-filter="${filter}"]`,
  );
  if (!found) throw new Error(`no ${filter} select`);
  return found;
};

const options = (el: HTMLElement, filter: 'brand' | 'area') =>
  [...select(el, filter).options].map((o) => ({
    label: o.textContent?.trim(),
    value: o.value,
  }));

async function choose(
  el: HTMLElement,
  filter: 'brand' | 'area',
  value: string,
) {
  const box = select(el, filter);
  box.value = value;
  box.dispatchEvent(new Event('change'));
  await settle();
}

// A read that answers only when the test says so.
function pending() {
  const reads: {
    params: Params;
    resolve: (a: AdminDemandSupplyDto) => void;
    reject: (e: unknown) => void;
  }[] = [];
  answer = (params) =>
    new Promise((resolve, reject) => reads.push({ params, reject, resolve }));
  return reads;
}

describe('the demand and supply table under hostile answers', () => {
  it('shows a zero requests-per-garage as 0, not as the dash', async () => {
    answer = async () =>
      supply([{ ...BMW, requests: 0, requestsPerGarage: 0, supply: 3 }]);
    const { el } = await open();

    expect(rowsOf(el)[0].figures).toBe(
      '420 căutări · 0 cereri · 3 service‑uri · 0 cereri pe service',
    );
    expect(el.querySelector('[role="img"]')).toBeNull();
  });

  it('keeps the dash and the lamp for a row with requests, no garages and searches', async () => {
    answer = async () =>
      supply([{ ...TESLA, requests: 5, requestsPerGarage: null, unmet: 5 }]);
    const { el } = await open();

    expect(rowsOf(el)[0]).toMatchObject({
      figures: '85 căutări · 5 cereri · 0 service‑uri · —',
      lamp: 'lipsesc service‑uri',
    });
  });

  it('lights no lamp for an unmet-only row with zero searches and zero garages', async () => {
    answer = async () =>
      supply([{ ...TESLA, requests: 3, searches: 0, unmet: 3 }]);
    const { el } = await open();

    expect(el.querySelectorAll('mf-lamp')).toHaveLength(0);
    expect(rowsOf(el)[0].figures).toBe(
      '0 căutări · 3 cereri · 0 service‑uri · —',
    );
  });

  it('lights no lamp when one garage takes a searched brand', async () => {
    answer = async () =>
      supply([{ ...TESLA, requestsPerGarage: 0, supply: 1 }]);
    const { el } = await open();

    expect(el.querySelectorAll('mf-lamp')).toHaveLength(0);
  });

  it('writes the singular for one only, never for 11 or 101', async () => {
    answer = async () =>
      supply([
        {
          ...BMW,
          requests: 101,
          requestsPerGarage: 1,
          searches: 11,
          supply: 21,
        },
      ]);
    const { el } = await open();

    expect(rowsOf(el)[0].figures).toBe(
      '11 căutări · 101 cereri · 21 service‑uri · 1 cerere pe service',
    );
  });

  it('writes the plural for zero in English', async () => {
    answer = async () =>
      supply([{ ...BMW, requestsPerGarage: null, supply: 0, unmet: 0 }]);
    const { el } = await open('en');

    expect(rowsOf(el)[0]).toMatchObject({
      figures: '420 searches · 96 requests · 0 garages · —',
      unmet: '0 without a quote',
    });
  });

  it('renders markup in a brand or area name as plain text', async () => {
    const evil = '<img src=x onerror="document.title=1">';
    answer = async () =>
      supply([
        {
          ...BMW,
          area: { code: 'x', kind: 'city', name: '<b>bold</b>' },
          brand: evil,
        },
      ]);
    const { el } = await open();

    expect(el.querySelector('table img')).toBeNull();
    expect(el.querySelector('table b')).toBeNull();
    expect(rowsOf(el)[0].name).toBe(`${evil} · <b>bold</b>`);
    expect(options(el, 'brand')[1]).toEqual({ label: evil, value: evil });
  });

  it('sends a brand with accents, a slash and an ampersand untouched', async () => {
    answer = async () =>
      supply([
        { ...BMW, brand: 'Citroën' },
        { ...TESLA, brand: 'Alfa/Romeo & Co' },
      ]);
    const { el } = await open();
    await choose(el, 'brand', 'Alfa/Romeo & Co');
    await choose(el, 'brand', 'Citroën');

    expect(calls.slice(1)).toEqual([
      { brand: 'Alfa/Romeo & Co' },
      { brand: 'Citroën' },
    ]);
  });

  it('offers one option for a brand that repeats across areas and keeps case variants distinct', async () => {
    answer = async () =>
      supply([BMW, { ...BMW, area: CLUJ }, { ...BMW, brand: 'bmw' }, TESLA]);
    const { el } = await open();

    expect(options(el, 'brand').map((o) => o.value)).toEqual([
      '',
      'BMW',
      'bmw',
      'Tesla',
    ]);
  });

  it('does not re-sort rows whose unmet counts ascend', async () => {
    answer = async () =>
      supply([
        { ...BMW, brand: 'A', unmet: 1 },
        { ...BMW, brand: 'B', unmet: 9 },
        { ...BMW, brand: 'C', unmet: 5 },
      ]);
    const { el } = await open();

    expect(rowsOf(el).map((r) => r.name?.charAt(0))).toEqual(['A', 'B', 'C']);
  });

  it('keeps two identical rows as two rows', async () => {
    answer = async () => supply([BMW, BMW]);
    const { el } = await open();

    expect(rowsOf(el)).toHaveLength(2);
  });

  it('renders three hundred rows with every figure intact', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      ...BMW,
      brand: `Brand ${i}`,
      searches: i,
    }));
    answer = async () => supply(many);
    const { el } = await open();

    expect(el.querySelectorAll('tbody tr')).toHaveLength(300);
    expect(options(el, 'brand')).toHaveLength(301);
    expect(rowsOf(el)[299].figures).toContain('299 căutări');
  });

  it('groups millions in English with commas', async () => {
    answer = async () => supply([{ ...BMW, searches: 1_234_567 }]);
    const { el } = await open('en');

    expect(rowsOf(el)[0].figures).toContain('1,234,567 searches');
  });
});

describe('the demand and supply table, the nightly run line', () => {
  it('calls 00:00 Bucharest today and 23:59 the day before another day', async () => {
    answer = async () => supply([BMW], '2026-10-30T22:00:00.000Z');
    const today = await open();
    expect(text(today.el.querySelector('.updated'))).toBe(
      'actualizat azi la 00:00',
    );
    TestBed.resetTestingModule();

    answer = async () => supply([BMW], '2026-10-30T21:59:59.000Z');
    const before = await open('en');
    expect(text(before.el.querySelector('.updated'))).toBe(
      'updated 30 Oct at 23:59',
    );
  });

  it('reads a run just before midnight UTC in Bucharest time, not UTC', async () => {
    answer = async () => supply([BMW], '2026-10-31T21:59:00.000Z');
    const { el } = await open();

    expect(text(el.querySelector('.updated'))).toBe('actualizat azi la 23:59');
  });

  it('states a run from another month and a single-digit day without a year', async () => {
    answer = async () => supply([BMW], '2026-01-05T07:05:00.000Z');
    const ro = await open();
    expect(text(ro.el.querySelector('.updated'))).toBe(
      'actualizat 5 ian. la 09:05',
    );
    TestBed.resetTestingModule();
    const en = await open('en');
    expect(text(en.el.querySelector('.updated'))).toBe(
      'updated 5 Jan at 09:05',
    );
  });

  it('states a run in the summer offset on its Bucharest hour', async () => {
    answer = async () => supply([BMW], '2026-07-14T22:30:00.000Z');
    const { el } = await open('en');

    expect(text(el.querySelector('.updated'))).toBe('updated 15 Jul at 01:30');
  });

  it('omits the line for an unparseable writtenAt rather than printing Invalid Date', async () => {
    answer = async () => supply([BMW], 'not a date');
    const { el } = await open();

    expect(el.querySelector('.updated')).toBeNull();
    expect(el.textContent).not.toContain('Invalid');
    expect(el.textContent).not.toContain('NaN');
  });

  it('omits the line for an empty-string writtenAt', async () => {
    answer = async () => supply([BMW], '');
    const { el } = await open();

    expect(el.querySelector('.updated')).toBeNull();
  });
});

describe('the demand and supply table, reads in flight', () => {
  it('shows the second answer when the first of two reads comes back last', async () => {
    const reads = pending();
    const { el } = await open();
    await choose(el, 'brand', 'BMW');
    expect(reads).toHaveLength(2);

    reads[1].resolve(supply([TESLA]));
    await settle();
    reads[0].resolve(supply([BMW]));
    await settle();

    expect(rowsOf(el).map((r) => r.name)).toEqual(['Tesla · Cluj-Napoca']);
    expect(el.querySelector('.skeletons')).toBeNull();
  });

  it('ignores a stale failure that arrives after the latest answer', async () => {
    const reads = pending();
    const { el } = await open();
    await choose(el, 'area', 'unknown');

    reads[1].resolve(supply([TESLA]));
    await settle();
    reads[0].reject(new Error('late'));
    await settle();

    expect(el.querySelector('.failed')).toBeNull();
    expect(rowsOf(el)).toHaveLength(1);
  });

  it('ignores a stale answer that arrives while the latest read has failed', async () => {
    const reads = pending();
    const { el } = await open();
    await choose(el, 'area', 'unknown');

    reads[1].reject(new Error('boom'));
    await settle();
    reads[0].resolve(supply([BMW]));
    await settle();

    expect(el.querySelector('.failed')).not.toBeNull();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('survives a read that resolves after the view is destroyed', async () => {
    const reads = pending();
    const { fixture } = await open();
    fixture.destroy();

    reads[0].resolve(supply([BMW]));
    await settle();

    expect(reads).toHaveLength(1);
  });

  it('survives a read that rejects after the view is destroyed', async () => {
    const reads = pending();
    const { fixture } = await open();
    fixture.destroy();

    reads[0].reject(new Error('gone'));
    await settle();

    expect(reads).toHaveLength(1);
  });

  it('shows the failed state for a rejection that is not an Error', async () => {
    answer = () => Promise.reject(null);
    const { el } = await open();

    expect(text(el.querySelector('.failed p'))).toBe(
      'Tabelul nu a putut fi citit.',
    );
    expect(el.querySelector('.failed button')).not.toBeNull();
  });

  it('shows the failed state when the read throws synchronously', async () => {
    answer = () => {
      throw new Error('sync');
    };
    const { el } = await open();

    expect(el.querySelector('.failed')).not.toBeNull();
    expect(el.querySelector('.skeletons')).toBeNull();
  });

  it('retries repeatedly, one read per press, until it answers', async () => {
    answer = () => Promise.reject(new Error('down'));
    const { el } = await open();
    for (let i = 0; i < 3; i++) {
      el.querySelector<HTMLButtonElement>('.failed button')?.click();
      await settle();
    }
    expect(calls).toHaveLength(4);

    answer = async () => supply([BMW]);
    el.querySelector<HTMLButtonElement>('.failed button')?.click();
    await settle();

    expect(calls).toHaveLength(5);
    expect(el.querySelector('.failed')).toBeNull();
    expect(rowsOf(el)).toHaveLength(1);
  });

  it('keeps the chosen area across a failed read and sends it on retry', async () => {
    const { el } = await open();
    answer = () => Promise.reject(new Error('down'));
    await choose(el, 'area', 'cluj-napoca');
    expect(select(el, 'area').value).toBe('cluj-napoca');
    expect(select(el, 'area').disabled).toBe(false);

    answer = async () => supply([TESLA]);
    el.querySelector<HTMLButtonElement>('.failed button')?.click();
    await settle();

    expect(calls.at(-1)).toEqual({ area: 'cluj-napoca' });
  });

  it('keeps the selects enabled and focused while a read is in flight', async () => {
    const { el } = await open();
    const reads = pending();
    const box = select(el, 'area');
    box.focus();
    await choose(el, 'area', 'sector-3');

    expect(reads).toHaveLength(1);
    expect(el.querySelector('.skeletons')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(select(el, 'area')).toBe(box);
    expect(box.disabled).toBe(false);
    expect(document.activeElement).toBe(box);
  });

  it('reads once per visit and starts each visit with "Toate" in both filters', async () => {
    const first = await open();
    await choose(first.el, 'brand', 'Tesla');
    first.fixture.destroy();
    TestBed.resetTestingModule();
    calls = [];

    const second = await open();

    expect(calls).toEqual([{}]);
    expect(select(second.el, 'brand').value).toBe('');
    expect(select(second.el, 'area').value).toBe('');
  });
});

describe('the demand and supply table, options and empty states', () => {
  it('lists areas on an empty filtered answer so the area can be changed back', async () => {
    const { el } = await open();
    answer = async () => ({ ...supply([]), areas: [SECTOR_3, UNKNOWN] });
    await choose(el, 'area', 'sector-3');

    expect(text(el.querySelector('.empty'))).toBe('Nimic pentru filtrul ales.');
    expect(options(el, 'area').map((o) => o.value)).toEqual([
      '',
      'sector-3',
      'unknown',
    ]);
    expect(select(el, 'area').value).toBe('sector-3');
  });

  it('keeps a chosen area that the next answer no longer lists, rather than snapping to "Toate"', async () => {
    const { el } = await open();
    answer = async () => ({ ...supply([]), areas: [] });
    await choose(el, 'area', 'cluj-napoca');

    expect(calls.at(-1)).toEqual({ area: 'cluj-napoca' });
    expect(text(el.querySelector('.empty'))).toBe('Nimic pentru filtrul ales.');
    expect(select(el, 'area').value).toBe('cluj-napoca');
  });

  it('shows the unfiltered empty text in English with a status role and no table', async () => {
    answer = async () => supply([]);
    const { el } = await open('en');
    expect(text(el.querySelector('.empty'))).toBe(
      'No data for the last 30 days yet.',
    );
    expect(el.querySelector('.empty')?.getAttribute('role')).toBe('status');
    expect(el.querySelector('table')).toBeNull();
  });

  it('returns to the table after an empty filtered answer when "Toate" is chosen', async () => {
    const { el } = await open();
    answer = async () => supply([]);
    await choose(el, 'brand', 'BMW');
    expect(el.querySelector('.empty')).not.toBeNull();

    answer = async () => supply([BMW, TESLA]);
    await choose(el, 'brand', '');

    expect(calls.at(-1)).toEqual({});
    expect(rowsOf(el)).toHaveLength(2);
    expect(el.querySelector('.empty')).toBeNull();
  });

  it('rebuilds the brand list from the unfiltered answer after a filtered one shrank', async () => {
    const { el } = await open();
    answer = async () => supply([BMW]);
    await choose(el, 'area', 'sector-3');
    expect(options(el, 'brand').map((o) => o.value)).toEqual(['', 'BMW']);

    answer = async () => supply([TESLA, { ...BMW, brand: 'Audi' }]);
    await choose(el, 'area', '');

    expect(options(el, 'brand').map((o) => o.value)).toEqual([
      '',
      'Tesla',
      'Audi',
    ]);
  });

  it('shows a row whose area name is empty', async () => {
    answer = async () =>
      supply([{ ...BMW, area: { code: 'z', kind: 'city', name: '' } }]);
    const { el } = await open();

    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(rowsOf(el)[0].name).toContain('BMW');
  });

  it('translates the unknown area by its code even when the answer names it differently', async () => {
    answer = async () =>
      supply([
        {
          ...BMW,
          area: { code: 'unknown', kind: 'unknown', name: 'Necunoscută' },
        },
      ]);
    const ro = await open();
    expect(rowsOf(ro.el)[0].name).toBe('BMW · Zonă necunoscută');
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(rowsOf(en.el)[0].name).toBe('BMW · Unknown area');
  });

  it('does not translate a real area whose name matches the unknown wording', async () => {
    answer = async () =>
      supply([
        {
          ...BMW,
          area: { code: 'unknown-ish', kind: 'city', name: 'Zonă necunoscută' },
        },
      ]);
    const { el } = await open('en');

    expect(rowsOf(el)[0].name).toBe('BMW · Zonă necunoscută');
  });
});
