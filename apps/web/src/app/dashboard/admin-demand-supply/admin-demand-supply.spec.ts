// @traces 1416-FR-001 1416-FR-002 1416-FR-003 1416-FR-004 1416-FR-005 1416-FR-006
// @traces 1416-FR-007 1416-FR-008 1416-FR-009 1416-FR-010 1416-FR-012
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const YESTERDAY_AT_ONE = '2026-10-29T23:00:00.000Z';

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

describe('the demand and supply table, its rows', () => {
  it('heads the table and states what it counts', async () => {
    const { el } = await open();

    expect(text(el.querySelector('h2'))).toBe('Cerere și ofertă');
    expect(text(el.querySelector('.subtitle'))).toBe(
      'Unde caută șoferii o marcă și câte service‑uri o primesc, ultimele 30 de zile',
    );
    expect([...el.querySelectorAll('th')].map((th) => text(th))).toEqual([
      'Marcă și zonă',
      'Fără ofertă',
      'Stare',
    ]);
    expect(el.querySelector('table')?.getAttribute('aria-label')).toBe(
      'Cerere și ofertă pe marcă și zonă',
    );
  });

  it('shows the BMW and Tesla rows in Romanian, the lamp on Tesla alone', async () => {
    const { el } = await open();

    expect(rowsOf(el)).toEqual([
      {
        figures:
          '420 căutări · 96 cereri · 4 service‑uri · 24 cereri pe service',
        lamp: null,
        name: 'BMW · Sector 3',
        unmet: '12 fără ofertă',
      },
      {
        figures: '85 căutări · 0 cereri · 0 service‑uri · —',
        lamp: 'lipsesc service‑uri',
        name: 'Tesla · Cluj-Napoca',
        unmet: '0 fără ofertă',
      },
    ]);
    expect(el.querySelector('mf-lamp')?.getAttribute('data-state')).toBe('red');
  });

  it('shows the same rows in English', async () => {
    const { el } = await open('en');

    expect(text(el.querySelector('h2'))).toBe('Demand and supply');
    expect(rowsOf(el)).toEqual([
      {
        figures:
          '420 searches · 96 requests · 4 garages · 24 requests per garage',
        lamp: null,
        name: 'BMW · Sector 3',
        unmet: '12 without a quote',
      },
      {
        figures: '85 searches · 0 requests · 0 garages · —',
        lamp: 'no garages take it',
        name: 'Tesla · Cluj-Napoca',
        unmet: '0 without a quote',
      },
    ]);
  });

  it('writes the singular for one, in both languages', async () => {
    const one: AdminDemandSupplyRowDto = {
      ...BMW,
      requests: 1,
      requestsPerGarage: 1,
      searches: 1,
      supply: 1,
      unmet: 1,
    };
    answer = async () => supply([one]);

    const ro = await open();
    expect(rowsOf(ro.el)[0]).toMatchObject({
      figures: '1 căutare · 1 cerere · 1 service · 1 cerere pe service',
      unmet: '1 fără ofertă',
    });
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(rowsOf(en.el)[0]).toMatchObject({
      figures: '1 search · 1 request · 1 garage · 1 request per garage',
      unmet: '1 without a quote',
    });
  });

  it('groups large numbers in the interface language', async () => {
    answer = async () => supply([{ ...BMW, searches: 12_400 }]);

    const ro = await open();
    expect(rowsOf(ro.el)[0].figures).toMatch(/^12\.400 căutări/);
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(rowsOf(en.el)[0].figures).toMatch(/^12,400 searches/);
  });

  it('names the dash that stands for no garages', async () => {
    const ro = await open();
    const dash = ro.el
      .querySelectorAll('tbody tr')[1]
      .querySelector('[role="img"]');
    expect(text(dash)).toBe('—');
    expect(dash?.getAttribute('aria-label')).toBe('fără service‑uri');
    expect(
      ro.el.querySelectorAll('tbody tr')[0].querySelector('[role="img"]'),
    ).toBeNull();
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(
      en.el.querySelector('[role="img"]')?.getAttribute('aria-label'),
    ).toBe('no garages');
  });

  it('lights no lamp for a row nobody searched, and shows unmet above requests as answered', async () => {
    answer = async () =>
      supply([
        {
          ...TESLA,
          requests: 2,
          searches: 0,
          unmet: 5,
        },
      ]);

    const { el } = await open();

    expect(rowsOf(el)).toEqual([
      {
        figures: '0 căutări · 2 cereri · 0 service‑uri · —',
        lamp: null,
        name: 'Tesla · Cluj-Napoca',
        unmet: '5 fără ofertă',
      },
    ]);
  });

  it('translates the unknown area', async () => {
    answer = async () => supply([{ ...BMW, area: UNKNOWN }]);

    const ro = await open();
    expect(rowsOf(ro.el)[0].name).toBe('BMW · Zonă necunoscută');
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(rowsOf(en.el)[0].name).toBe('BMW · Unknown area');
  });

  it('keeps the order the answer gives', async () => {
    answer = async () => supply([TESLA, BMW]);

    const { el } = await open();

    expect(rowsOf(el).map((r) => r.name)).toEqual([
      'Tesla · Cluj-Napoca',
      'BMW · Sector 3',
    ]);
  });

  it('states a run of today by its time', async () => {
    const ro = await open();
    expect(text(ro.el.querySelector('.updated'))).toBe(
      'actualizat azi la 01:00',
    );
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(text(en.el.querySelector('.updated'))).toBe(
      'updated today at 01:00',
    );
  });

  it('states a run of another day by its day and month', async () => {
    answer = async () => supply([BMW], YESTERDAY_AT_ONE);

    const ro = await open();
    expect(text(ro.el.querySelector('.updated'))).toBe(
      'actualizat 30 oct. la 01:00',
    );
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(text(en.el.querySelector('.updated'))).toBe(
      'updated 30 Oct at 01:00',
    );
  });

  it('omits the line before the first nightly run', async () => {
    answer = async () => supply([BMW], null);

    const { el } = await open();

    expect(el.querySelector('.updated')).toBeNull();
  });

  it('switches language without reading again', async () => {
    const { el } = await open();
    expect(calls).toHaveLength(1);

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(rowsOf(el)[0].name).toBe('BMW · Sector 3');
    expect(rowsOf(el)[1].lamp).toBe('no garages take it');
    expect(calls).toHaveLength(1);
  });
});

describe('the demand and supply table, its filters', () => {
  it('reads once on open with no filter', async () => {
    await open();

    expect(calls).toEqual([{}]);
  });

  it('offers every area of the answer after "Toate", the unknown one translated', async () => {
    const ro = await open();
    expect(options(ro.el, 'area')).toEqual([
      { label: 'Toate', value: '' },
      { label: 'Sector 3', value: 'sector-3' },
      { label: 'Cluj-Napoca', value: 'cluj-napoca' },
      { label: 'Zonă necunoscută', value: 'unknown' },
    ]);
    TestBed.resetTestingModule();

    const en = await open('en');
    expect(options(en.el, 'area').map((o) => o.label)).toEqual([
      'All',
      'Sector 3',
      'Cluj-Napoca',
      'Unknown area',
    ]);
  });

  it('labels both filters', async () => {
    const { el } = await open();

    expect(text(select(el, 'brand').closest('label'))).toMatch(/^Marcă/);
    expect(text(select(el, 'area').closest('label'))).toMatch(/^Zonă/);
  });

  it('offers each brand once, in the order it first appears', async () => {
    answer = async () =>
      supply([TESLA, BMW, { ...BMW, area: CLUJ }, { ...TESLA, area: UNKNOWN }]);

    const { el } = await open();

    expect(options(el, 'brand')).toEqual([
      { label: 'Toate', value: '' },
      { label: 'Tesla', value: 'Tesla' },
      { label: 'BMW', value: 'BMW' },
    ]);
  });

  it('sends the chosen brand, the chosen area, both, and neither for "Toate"', async () => {
    const { el } = await open();

    await choose(el, 'brand', 'BMW');
    await choose(el, 'area', 'sector-3');
    await choose(el, 'brand', '');
    await choose(el, 'area', '');

    expect(calls).toEqual([
      {},
      { brand: 'BMW' },
      { area: 'sector-3', brand: 'BMW' },
      { area: 'sector-3' },
      {},
    ]);
  });

  it('sends a brand by its exact name', async () => {
    answer = async () =>
      supply([
        { ...BMW, brand: 'Mercedes-Benz' },
        { ...BMW, brand: 'Citroën' },
      ]);
    const { el } = await open();

    await choose(el, 'brand', 'Mercedes-Benz');
    await choose(el, 'brand', 'Citroën');

    expect(calls.slice(1)).toEqual([
      { brand: 'Mercedes-Benz' },
      { brand: 'Citroën' },
    ]);
  });

  it('keeps every brand on offer once one is chosen', async () => {
    const { el } = await open();
    answer = async () => supply([BMW]);

    await choose(el, 'brand', 'BMW');

    expect(options(el, 'brand').map((o) => o.value)).toEqual([
      '',
      'BMW',
      'Tesla',
    ]);
    expect(select(el, 'brand').value).toBe('BMW');
  });

  it('keeps a chosen brand the list no longer holds, last, until "Toate"', async () => {
    const { el, fixture } = await open();
    answer = async () => supply([]);

    fixture.componentInstance['chooseBrand']('Lada');
    await settle();

    expect(options(el, 'brand').map((o) => o.value)).toEqual([
      '',
      'BMW',
      'Tesla',
      'Lada',
    ]);
    expect(select(el, 'brand').value).toBe('Lada');

    await choose(el, 'brand', '');
    expect(options(el, 'brand').map((o) => o.value)).toEqual(['']);
  });

  it('shows only the answer to the latest read', async () => {
    const { el } = await open();
    const reads = pending();

    await choose(el, 'brand', 'BMW');
    await choose(el, 'brand', 'Tesla');
    reads[1].resolve(supply([TESLA]));
    await settle();
    reads[0].resolve(supply([BMW]));
    await settle();

    expect(rowsOf(el).map((r) => r.name)).toEqual(['Tesla · Cluj-Napoca']);
    expect(select(el, 'brand').value).toBe('Tesla');
  });

  it('keeps the filters while the answer changes', async () => {
    const { el } = await open();

    await choose(el, 'area', 'cluj-napoca');
    await choose(el, 'brand', 'Tesla');

    expect(select(el, 'area').value).toBe('cluj-napoca');
    expect(select(el, 'brand').value).toBe('Tesla');
  });
});

describe('the demand and supply table, its states', () => {
  it('shows five busy skeleton rows while the read is on its way, the filters still usable', async () => {
    const reads = pending();
    const { el } = await open();

    const skeletons = el.querySelector('.skeletons');
    expect(skeletons?.getAttribute('aria-busy')).toBe('true');
    expect(skeletons?.getAttribute('aria-label')).toBe('Se încarcă tabelul');
    expect(el.querySelectorAll('.skeleton-row')).toHaveLength(5);
    expect(el.querySelector('table')).toBeNull();
    expect(el.querySelector('.updated')).toBeNull();
    expect(select(el, 'brand').disabled).toBe(false);
    expect(select(el, 'area').disabled).toBe(false);
    expect(options(el, 'brand')).toEqual([{ label: 'Toate', value: '' }]);

    reads[0].resolve(supply([BMW]));
    await settle();
    expect(el.querySelector('.skeletons')).toBeNull();
  });

  it('keeps the same select in the page through a filtered read', async () => {
    const { el } = await open();
    const brand = select(el, 'brand');
    pending();

    await choose(el, 'brand', 'BMW');

    expect(el.querySelector('.skeletons')).not.toBeNull();
    expect(select(el, 'brand')).toBe(brand);
  });

  it('says there is no data yet when nothing is filtered', async () => {
    answer = async () => supply([]);

    const { el } = await open();

    const empty = el.querySelector('.empty');
    expect(text(empty)).toBe('Încă nu sunt date pentru ultimele 30 de zile.');
    expect(empty?.getAttribute('role')).toBe('status');
    expect(options(el, 'brand')).toEqual([{ label: 'Toate', value: '' }]);
    expect(options(el, 'area').map((o) => o.value)).toEqual([
      '',
      'sector-3',
      'cluj-napoca',
      'unknown',
    ]);
  });

  it('says nothing matches when a filter is chosen', async () => {
    const { el } = await open();
    answer = async () => supply([]);

    await choose(el, 'area', 'sector-3');

    expect(text(el.querySelector('.empty'))).toBe('Nimic pentru filtrul ales.');
    expect(select(el, 'area').value).toBe('sector-3');
    expect(options(el, 'area')).toHaveLength(4);
  });

  it('says so in English', async () => {
    answer = async () => supply([]);

    const { el } = await open('en');

    expect(text(el.querySelector('.empty'))).toBe(
      'No data for the last 30 days yet.',
    );
  });

  it('offers a retry on a failed read, which reads again with the filters chosen', async () => {
    const { el } = await open();
    answer = async () => {
      throw new Error('down');
    };

    await choose(el, 'brand', 'BMW');

    const failed = el.querySelector('.failed');
    expect(failed?.getAttribute('role')).toBe('alert');
    expect(text(failed?.querySelector('p'))).toBe(
      'Tabelul nu a putut fi citit.',
    );
    const retry = failed?.querySelector('button');
    expect(text(retry)).toBe('Reîncearcă');
    expect(select(el, 'brand').value).toBe('BMW');

    const reads = pending();
    retry?.click();
    await settle();
    expect(el.querySelector('.skeletons')).not.toBeNull();
    reads[0].resolve(supply([BMW]));
    await settle();

    expect(calls.at(-1)).toEqual({ brand: 'BMW' });
    expect(rowsOf(el).map((r) => r.name)).toEqual(['BMW · Sector 3']);
  });

  it('names the retry in English', async () => {
    answer = async () => {
      throw new Error('down');
    };

    const { el } = await open('en');

    expect(text(el.querySelector('.failed p'))).toBe(
      'The table could not be read.',
    );
    expect(text(el.querySelector('.failed button'))).toBe('Retry');
  });
});

// @traces 1416-FR-010 1416-FR-011
describe('the demand and supply table, its row style', () => {
  const own = (ext: string) =>
    readFileSync(join(__dirname, `admin-demand-supply.${ext}`), 'utf8');
  const brandList = readFileSync(
    join(__dirname, '..', 'admin-brands', 'admin-brands.css'),
    'utf8',
  );
  const rule = (css: string, selector: string) =>
    new RegExp(`\\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(
      css,
    )?.[1];

  it('keeps its template and styles in files of its own folder', () => {
    expect(own('ts')).toContain("templateUrl: './admin-demand-supply.html'");
    expect(own('ts')).toContain("styleUrl: './admin-demand-supply.css'");
    expect(own('ts')).not.toMatch(/\btemplate:|\bstyles:/);
  });

  it('draws its skeleton rows and header as the brand list does', () => {
    for (const selector of ['.skeleton-row', '.skeleton', 'th', 'td'])
      expect(rule(own('css'), selector)).toBe(rule(brandList, selector));
  });

  it('turns each row into a card below 768 px, wrapping long names', () => {
    expect(own('css')).toContain('@media (max-width: 767px)');
    expect(own('css')).toContain('overflow-wrap: anywhere');
    expect(rule(own('css'), '.tools label')).toContain('flex: 1 1 12rem');
  });
});
