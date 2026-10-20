import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CatalogueService, type JobTypeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  JobPicker,
  type JobPickerData,
  type JobPickerResult,
} from './job-picker';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const job = (id: string, nameRo: string, nameEn: string): JobTypeDto => ({
  id,
  key: id,
  nameEn,
  nameRo,
});

const AC = job('ac', 'Încărcare freon climă', 'Air-con regas');
const OIL = job('oil', 'Schimb de ulei și filtre', 'Oil and filter service');
const BRAKES = job(
  'brakes',
  'Plăcuțe și discuri de frână față',
  'Front brake pads and discs',
);

let search: jest.Mock;
let result: Promise<JobPickerResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(
  answer: (q?: string) => Promise<{ items: JobTypeDto[] }> = async () => ({
    items: [AC, BRAKES],
  }),
  { language = 'ro', listed = ['oil'] } = {},
) {
  search = jest.fn(({ q }: { q?: string; exclude?: string }) => answer(q));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CatalogueService,
        useValue: { jobTypesControllerSearch: search },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<JobPickerResult, JobPickerData>(
    JobPicker,
    { data: { listed }, shape: 'dialog', title: 'garage.prices.picker.title' },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const clean = (node: Element | null) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find((b) => clean(b) === name) as
    | HTMLButtonElement
    | undefined;
const results = () =>
  [...panel().querySelectorAll('[data-result]')].map((b) => clean(b));
const field = () =>
  panel().querySelector<HTMLInputElement>(
    'input[type="search"]',
  ) as HTMLInputElement;

async function type(value: string) {
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  await wait(300);
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 1352-catalogue-job-visibility-FR-001
describe('the job picker: searching the catalogue', () => {
  it('is titled "Adaugă o lucrare", has a labelled search field and lists the catalogue without the jobs already listed', async () => {
    await open();

    expect(search).toHaveBeenCalledWith({ exclude: 'oil' });
    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Adaugă o lucrare',
    );
    expect(field().labels?.[0]?.textContent?.trim()).toBe('Caută o lucrare');
    expect(search).toHaveBeenCalledTimes(1);
    expect(results()).toEqual([
      'Încărcare freon climă',
      'Plăcuțe și discuri de frână față',
    ]);
    expect(
      panel().querySelector('[data-results]')?.getAttribute('aria-label'),
    ).toBe('Lucrări găsite');
  });

  it('searches what is typed, once the typing stops', async () => {
    await open(async (q) => ({
      items: q === 'frana' ? [BRAKES] : [AC, BRAKES],
    }));

    await type('frana');

    expect(search).toHaveBeenLastCalledWith({ exclude: 'oil', q: 'frana' });
    expect(results()).toEqual(['Plăcuțe și discuri de frână față']);
  });

  it('sends each listed job once as exclude and shows every job the search answers, filtering nothing itself', async () => {
    await open(async () => ({ items: [AC, OIL, BRAKES] }), {
      listed: ['oil', 'ac', 'oil'],
    });

    expect(search).toHaveBeenCalledWith({ exclude: 'oil,ac' });
    expect(results()).toEqual([
      'Încărcare freon climă',
      'Schimb de ulei și filtre',
      'Plăcuțe și discuri de frână față',
    ]);
  });

  it('sends no exclude when nothing is listed yet', async () => {
    await open(undefined, { listed: [] });

    expect(search).toHaveBeenCalledWith({});
  });

  it('says it is searching while the search runs', async () => {
    let answer: (value: { items: JobTypeDto[] }) => void = () => undefined;
    await open(() => new Promise((resolve) => (answer = resolve)));

    expect(text()).toContain('Se caută…');
    expect(results()).toEqual([]);

    answer({ items: [AC] });
    await settle();

    expect(text()).not.toContain('Se caută…');
    expect(results()).toEqual(['Încărcare freon climă']);
  });

  it('says no job was found, and still offers the proposal', async () => {
    await open(async () => ({ items: [] }));

    expect(text()).toContain('Nicio lucrare găsită');
    expect(button('Nu găsești lucrarea? Propune‑o')).toBeDefined();

    await type('xyz');

    expect(text()).toContain('Nicio lucrare găsită');
    expect(button('Nu găsești lucrarea? Propune‑o')).toBeDefined();
  });

  it('says the search does not work now when it fails, and still offers the proposal', async () => {
    await open(async () => {
      throw new HttpErrorResponse({ status: 503 });
    });

    expect(text()).toContain('Căutarea nu merge acum');
    expect(results()).toEqual([]);
    expect(button('Nu găsești lucrarea? Propune‑o')).toBeDefined();
  });

  it('reads in English', async () => {
    await open(undefined, { language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe('Add a job');
    expect(results()).toEqual(['Air-con regas', 'Front brake pads and discs']);
    expect(button("Can't find the job? Propose it")).toBeDefined();
  });
});

// @traces 1352-catalogue-job-visibility-FR-001
describe('the job picker: choosing', () => {
  it('closes with the picked job', async () => {
    await open();

    button('Încărcare freon climă')?.click();
    await settle();

    await expect(result).resolves.toEqual({ job: AC });
  });

  it('closes with the proposal on "Propune‑o"', async () => {
    await open();

    button('Nu găsești lucrarea? Propune‑o')?.click();
    await settle();

    await expect(result).resolves.toBe('propose');
  });
});
