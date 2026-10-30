import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  BrandsService,
  type GarageBrandOwnerAnswerDto,
  type GarageBrandOwnerReadDto,
  GaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { type BrandsEditData, BrandsEditDialog } from './brands-edit-dialog';

// @traces 1247-FR-011 1247-FR-012 1247-FR-013 1247-FR-015

const GARAGE = 'garage-1';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const brand = (name: string, n: number) => ({
  id: id(n),
  name,
  popularity: n,
  slug: name.toLowerCase(),
});
const BMW = brand('BMW', 1);
const DACIA = brand('Dacia', 2);
const TESLA = brand('Tesla', 3);
const AUDI = brand('Audi', 4);
// Marked by the garage, gone from the catalogue since.
const TRABANT = brand('Trabant', 90);
const OIL = id(101);
const BRAKES = id(102);
const PRICE_LIST = [
  { jobTypeId: OIL, nameEn: 'Oil change', nameRo: 'Schimb de ulei' },
  { jobTypeId: BRAKES, nameEn: 'Brakes', nameRo: 'Frâne' },
];
const ref = ({ id, name, slug }: typeof BMW) => ({ id, name, slug });

const stored = (
  over: Partial<GarageBrandOwnerReadDto> = {},
): GarageBrandOwnerReadDto => ({
  brandNote: 'Doar germane',
  doesNotTake: [ref(TESLA), ref(TRABANT)],
  priceList: PRICE_LIST,
  refusalPhrase: null,
  worksOn: [{ ...ref(BMW), fuels: ['petrol', 'diesel'], jobs: [OIL] }],
  ...over,
});
const ANSWER: GarageBrandOwnerAnswerDto = {
  brandNote: 'Doar germane',
  doesNotTake: [ref(TESLA)],
  refusalPhrase: null,
  worksOn: [{ ...ref(BMW), fuels: ['petrol'], jobs: [OIL] }],
};

@Component({
  template: '<button type="button" id="opener">Modifică profilul</button>',
})
class Host {
  readonly overlays = inject(Overlays);
}

let read: jest.Mock;
let replace: jest.Mock;
let profileRead: jest.Mock;
let search: jest.Mock;
let navigate: jest.Mock;
let result: Promise<OverlayResult<GarageBrandOwnerAnswerDto>>;

async function settle() {
  for (let i = 0; i < 8; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  start: GarageBrandOwnerReadDto | Promise<GarageBrandOwnerReadDto> = stored(),
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(() => Promise.resolve(start));
  replace = jest.fn(async () => ANSWER);
  profileRead = jest.fn();
  navigate = jest.fn(async () => true);
  search = jest.fn(async () => ({
    items: [BMW, DACIA, TESLA, AUDI],
    nextCursor: null,
    total: 4,
  }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          garageBrandsControllerRead: read,
          garageBrandsControllerReplace: replace,
          garageProfileControllerRead: profileRead,
        },
      },
      { provide: BrandsService, useValue: { brandsControllerSearch: search } },
      { provide: Router, useValue: { navigateByUrl: navigate } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const host = TestBed.createComponent(Host);
  host.detectChanges();
  const opener = (host.nativeElement as HTMLElement).querySelector(
    '#opener',
  ) as HTMLButtonElement;
  document.body.appendChild(host.nativeElement);
  opener.focus();
  result = host.componentInstance.overlays.open<
    GarageBrandOwnerAnswerDto,
    BrandsEditData
  >(BrandsEditDialog, {
    confirmDiscard: false,
    data: { garageId: GARAGE },
    shape: 'dialog',
    title: 'garage.profile.edit.title.brands',
  });
  await settle();
  return { opener };
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => text(b) === name || text(b).endsWith(` ${name}`),
  ) as HTMLButtonElement | undefined;
const chip = (name: string) => {
  const found = [
    ...panel().querySelectorAll<HTMLButtonElement>('.chips > li > button'),
  ].find((c) => text(c).startsWith(name));
  if (!found) throw new Error(`no chip ${name}`);
  return found;
};
const chipNames = () =>
  [...panel().querySelectorAll<HTMLButtonElement>('.chips > li > button')].map(
    (c) => text(c).split(' ')[0],
  );
const row = (name: string) => chip(name).closest('li') as HTMLElement;
const fuel = (name: string, label: string) => {
  const found = [
    ...row(name).querySelectorAll<HTMLButtonElement>('.fuels button'),
  ].find((f) => text(f).startsWith(`${name}, ${label}`));
  if (!found) throw new Error(`no fuel ${label} under ${name}`);
  return found;
};
const ticked = (name: string) =>
  [...row(name).querySelectorAll<HTMLButtonElement>('.fuels button')]
    .filter((f) => f.getAttribute('aria-pressed') === 'true')
    .map((f) => text(f).replace(`${name}, `, '').split(' ')[0]);
const still = async () =>
  Promise.race([result, new Promise((r) => setTimeout(() => r('open'), 20))]);
const status = (code: number, body?: unknown) =>
  new HttpErrorResponse({
    error: body,
    status: code,
    statusText: String(code),
  });
const sent = () => replace.mock.calls[0][0];

async function press(element: HTMLElement | undefined) {
  element?.click();
  await settle();
}

async function write(name: string, value: string) {
  const input = panel().querySelector<HTMLInputElement>(
    `input[name="${name}"]`,
  ) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the brands dialog, opening', () => {
  it('shows a skeleton while the brand answer loads, then every catalogue brand and the retired one marked', async () => {
    let answer: (value: GarageBrandOwnerReadDto) => void = () => undefined;
    await open(new Promise((resolve) => (answer = resolve)));

    expect(text(panel().querySelector('h2'))).toBe('Mărci și carburanți');
    expect(panel().querySelector('[data-skeleton]')).not.toBeNull();
    expect(panel().querySelector('mf-brands-step')).toBeNull();

    answer(stored());
    await settle();

    expect(panel().querySelector('[data-skeleton]')).toBeNull();
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(profileRead).not.toHaveBeenCalled();
    expect(chipNames()).toEqual(['BMW', 'Dacia', 'Tesla', 'Audi', 'Trabant']);
  });

  it('opens on the stored answer: stances, fuels as stored, jobs ticked per price-list row, the note', async () => {
    await open();

    expect(chip('BMW').getAttribute('aria-pressed')).toBe('true');
    expect(text(chip('BMW'))).toContain('lucrezi pe ea');
    expect(text(chip('Tesla'))).toContain('nu o primești');
    expect(chip('Dacia').getAttribute('aria-pressed')).toBe('false');
    expect(ticked('BMW')).toEqual(['Benzină', 'Diesel']);
    expect(text(row('BMW').querySelector('.jobs summary'))).toBe(
      'Lucrări: 1 din 2',
    );
    const jobs = [
      ...row('BMW').querySelectorAll<HTMLInputElement>('.jobs input'),
    ];
    expect(jobs.map((j) => j.getAttribute('aria-label'))).toEqual([
      'BMW, Schimb de ulei',
      'BMW, Frâne',
    ]);
    expect(jobs.map((j) => j.checked)).toEqual([true, false]);
    expect(
      panel().querySelector<HTMLInputElement>('input[name="brandNote"]')?.value,
    ).toBe('Doar germane');
  });

  it('says the answer could not be read, and reads it again on Reîncearcă', async () => {
    await open(Promise.reject(status(500)));

    expect(text(panel().querySelector('[data-load-failed]'))).toContain(
      'Nu am putut încărca mărcile',
    );
    expect(panel().querySelector('mf-brands-step')).toBeNull();

    read.mockResolvedValueOnce(stored());
    await press(button('Reîncearcă'));

    expect(read).toHaveBeenCalledTimes(2);
    expect(panel().querySelector('mf-brands-step')).not.toBeNull();
  });
});

describe('the brands dialog, saving', () => {
  it('sends every marked brand once, a taken one with its fuels and jobs, and closes with the answer, reading nothing', async () => {
    await open();

    await press(button('Salvează'));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual({
      body: {
        brandNote: 'Doar germane',
        brands: [
          {
            brandId: BMW.id,
            fuels: ['petrol', 'diesel'],
            jobs: [OIL],
            stance: 'works_on',
          },
          { brandId: TESLA.id, stance: 'does_not_take' },
          { brandId: TRABANT.id, stance: 'does_not_take' },
        ],
        refusalPhrase: '',
      },
      garageId: GARAGE,
    });
    await expect(result).resolves.toEqual(ANSWER);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('starts a brand newly taken with all four fuels and every job', async () => {
    await open();

    await press(chip('Dacia'));
    expect(ticked('Dacia')).toEqual([
      'Benzină',
      'Diesel',
      'Hibrid',
      'Electric',
    ]);
    await press(button('Salvează'));

    expect(sent().body.brands).toContainEqual({
      brandId: DACIA.id,
      fuels: ['petrol', 'diesel', 'hybrid', 'electric'],
      jobs: [OIL, BRAKES],
      stance: 'works_on',
    });
  });

  it('drops the ticks of a brand refused, and a brand taken again starts fresh', async () => {
    await open();

    await press(chip('BMW'));
    expect(row('BMW').querySelector('.fuels')).toBeNull();
    await press(chip('BMW'));
    await press(chip('BMW'));
    expect(ticked('BMW')).toEqual(['Benzină', 'Diesel', 'Hibrid', 'Electric']);
    await press(button('Salvează'));

    expect(sent().body.brands).toContainEqual({
      brandId: BMW.id,
      fuels: ['petrol', 'diesel', 'hybrid', 'electric'],
      jobs: [OIL, BRAKES],
      stance: 'works_on',
    });
  });

  it('sends the fuels and jobs as ticked in the dialog', async () => {
    await open();

    await press(fuel('BMW', 'Diesel'));
    const brakes =
      row('BMW').querySelectorAll<HTMLInputElement>('.jobs input')[1];
    brakes.click();
    await settle();
    await press(button('Salvează'));

    expect(sent().body.brands[0]).toEqual({
      brandId: BMW.id,
      fuels: ['petrol'],
      jobs: [OIL, BRAKES],
      stance: 'works_on',
    });
  });

  it('says no requests come for a taken brand with every job unticked, and still saves it', async () => {
    await open();

    for (const job of row('BMW').querySelectorAll<HTMLInputElement>(
      '.jobs input:checked',
    )) {
      job.click();
    }
    await settle();

    expect(text(panel())).toContain('Nu vei primi cereri pentru BMW');
    await press(button('Salvează'));
    expect(sent().body.brands[0]).toMatchObject({
      brandId: BMW.id,
      jobs: [],
      stance: 'works_on',
    });
  });

  it('opens a taken brand stored with no fuel with none ticked and the error, and sends nothing until one is ticked', async () => {
    await open(stored({ worksOn: [{ ...ref(BMW), fuels: [], jobs: [OIL] }] }));

    expect(ticked('BMW')).toEqual([]);
    expect(text(row('BMW').querySelector('.fuel-last'))).toBe(
      'Cel puțin un carburant rămâne bifat',
    );

    await press(button('Salvează'));
    expect(replace).not.toHaveBeenCalled();
    expect(await still()).toBe('open');
    expect(text(panel().querySelector('[data-brand-problems]'))).toBe(
      'Bifează cel puțin un carburant pentru BMW',
    );

    await press(fuel('BMW', 'Electric'));
    await press(button('Salvează'));
    expect(sent().body.brands[0].fuels).toEqual(['electric']);
  });

  it('clears a note of spaces alone, and sends the phrase as written', async () => {
    await open();

    await write('brandNote', '   ');
    await write('refusalPhrase', 'Nu lucrăm pe electrice');
    await press(button('Salvează'));

    expect(sent().body.brandNote).toBe('');
    expect(sent().body.refusalPhrase).toBe('Nu lucrăm pe electrice');
  });

  it('holds the note at 140 and the phrase at 60 letters, counting what is left', async () => {
    await open();

    await write('brandNote', 'a'.repeat(150));
    await write('refusalPhrase', 'b'.repeat(70));
    expect([...panel().querySelectorAll('.left')].map((p) => text(p))).toEqual([
      '0 caractere rămase',
      '0 caractere rămase',
    ]);
    await press(button('Salvează'));

    expect(sent().body.brandNote).toHaveLength(140);
    expect(sent().body.refusalPhrase).toHaveLength(60);
  });

  it('is busy while the save is on its way, and a second press sends nothing more', async () => {
    await open();
    let answer: (value: GarageBrandOwnerAnswerDto) => void = () => undefined;
    replace.mockImplementationOnce(
      () =>
        new Promise<GarageBrandOwnerAnswerDto>((resolve) => (answer = resolve)),
    );

    await press(button('Salvează'));
    await press(button('Salvează'));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(button('Salvează')?.getAttribute('aria-busy')).toBe('true');
    answer(ANSWER);
    await settle();
    await expect(result).resolves.toEqual(ANSWER);
  });

  it('names the brand a refusal is about at the top, the dialog kept open', async () => {
    await open();
    replace.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'unknown_brand', field: 'brands[2].brandId' }],
        status: 400,
      }),
    );

    await press(button('Salvează'));

    expect(await still()).toBe('open');
    const line = panel().querySelector('[data-brand-problems]');
    expect(text(line)).toBe('Trabant nu mai este în catalog.');
    expect(line?.getAttribute('role')).toBe('alert');
  });

  it.each([
    ['a lost connection', status(0)],
    ['a server failure', status(503)],
  ])(
    'keeps the dialog and the ticks on %s, saying to try again',
    async (_, failure) => {
      await open();
      await press(chip('Dacia'));
      replace.mockRejectedValueOnce(failure);

      await press(button('Salvează'));

      expect(await still()).toBe('open');
      expect(ticked('Dacia')).toEqual([
        'Benzină',
        'Diesel',
        'Hibrid',
        'Electric',
      ]);
      expect(text(panel().querySelector('[data-problem]'))).toMatch(
        /încearcă din nou/i,
      );
    },
  );

  it('closes on Renunță without sending, the focus back on the control that opened it', async () => {
    const { opener } = await open();

    await press(button('Renunță'));

    await expect(result).resolves.toBe('cancelled');
    expect(replace).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape without sending', async () => {
    await open();
    await press(chip('Dacia'));

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(replace).not.toHaveBeenCalled();
  });

  it('with no priced job, the jobs link closes the dialog and goes to the price list', async () => {
    await open(
      stored({
        priceList: [],
        worksOn: [{ ...ref(BMW), fuels: ['petrol'], jobs: [] }],
      }),
    );

    await press(button('Adaugă mai întâi lucrări în lista de prețuri'));

    await expect(result).resolves.toBe('cancelled');
    expect(navigate).toHaveBeenCalledWith('/app/garage/prices');
  });
});

describe('the brands dialog in English', () => {
  it('speaks English', async () => {
    await open(stored(), 'en');

    expect(text(panel().querySelector('h2'))).toBe('Brands and fuel types');
    expect(button('Save')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
    expect(text(chip('BMW'))).toContain('you work on it');
  });
});

describe('the brands dialog on a phone', () => {
  const css = readFileSync(join(__dirname, 'brands-edit-dialog.css'), 'utf8');

  it('keeps its buttons at 44 px or more and lets the brands wrap', () => {
    expect(css).toMatch(/button \{[^}]*min-height: (4[4-9]|5\d)px/);
    expect(css).toMatch(/min-width: 0/);
  });
});
