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

// @traces 1247-FR-011 1247-FR-012 1247-FR-013

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

describe('the brands dialog under hostile input', () => {
  it('keeps the last ticked fuel on, however many times it is pressed, and sends it', async () => {
    await open();

    await press(fuel('BMW', 'Diesel'));
    await press(fuel('BMW', 'Benzină'));
    await press(fuel('BMW', 'Benzină'));
    expect(ticked('BMW')).toEqual(['Benzină']);
    await press(button('Salvează'));

    expect(sent().body.brands[0].fuels).toEqual(['petrol']);
  });

  it('leaves a brand out of the write once it is cycled back to unstated', async () => {
    await open();

    await press(chip('BMW'));
    await press(chip('BMW'));
    await press(button('Salvează'));

    expect(
      sent().body.brands.map((b: { brandId: string }) => b.brandId),
    ).toEqual([TESLA.id, TRABANT.id]);
  });

  it.each([
    ['a suspended garage', 410],
    ['a garage that is not the owner’s', 404],
    ['a receptionist', 403],
    ['an ended session', 401],
  ])(
    'shows the retry text and no Save when the read answers for %s',
    async (_, code) => {
      await open(Promise.reject(status(code)));

      expect(panel().querySelector('[data-load-failed]')).not.toBeNull();
      expect(button('Salvează')).toBeUndefined();
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it('opens on an empty answer with nothing marked and saves an empty set that clears the texts', async () => {
    await open(
      stored({
        brandNote: null,
        doesNotTake: [],
        priceList: [],
        refusalPhrase: null,
        worksOn: [],
      }),
    );

    await press(button('Salvează'));

    expect(sent().body).toEqual({
      brandNote: '',
      brands: [],
      refusalPhrase: '',
    });
  });

  it('sends only job ids that are on the price list, dropping a stale tick', async () => {
    await open(
      stored({
        worksOn: [{ ...ref(BMW), fuels: ['petrol'], jobs: [OIL, id(999)] }],
      }),
    );

    await press(button('Salvează'));

    expect(sent().body.brands[0].jobs).toEqual([OIL]);
  });

  it('sends an empty jobs list with the fuels kept when every job is unticked, and still saves', async () => {
    await open();

    const boxes = [
      ...row('BMW').querySelectorAll<HTMLInputElement>('.jobs input'),
    ].filter((box) => box.checked);
    for (const box of boxes) {
      box.click();
      await settle();
    }
    await press(button('Salvează'));

    expect(sent().body.brands[0]).toEqual({
      brandId: BMW.id,
      fuels: ['petrol', 'diesel'],
      jobs: [],
      stance: 'works_on',
    });
  });

  it('puts a refusal of an empty fuel list at the top, naming the brand', async () => {
    await open();
    replace.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'fuels_empty', field: 'brands[0].fuels' }],
        status: 400,
      }),
    );

    await press(button('Salvează'));

    expect(await still()).toBe('open');
    expect(text(panel().querySelector('[data-brand-problems]'))).toContain(
      'BMW',
    );
  });

  it('survives a refusal naming a brand index it never sent, keeping the dialog open', async () => {
    await open();
    replace.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'unknown_brand', field: 'brands[99].brandId' }],
        status: 400,
      }),
    );

    await press(button('Salvează'));

    expect(await still()).toBe('open');
    expect(button('Salvează')?.getAttribute('aria-busy')).not.toBe('true');
  });

  it('sends again after a lost connection, and closes with the answer on the second try', async () => {
    await open();
    replace.mockRejectedValueOnce(status(0));

    await press(button('Salvează'));
    expect(await still()).toBe('open');
    await press(button('Salvează'));

    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace.mock.calls[1][0]).toEqual(replace.mock.calls[0][0]);
    await expect(result).resolves.toEqual(ANSWER);
  });

  it('keeps the dialog open and stores nothing when the save answers 410', async () => {
    await open();
    replace.mockRejectedValueOnce(status(410, { code: 'gone', status: 410 }));

    await press(button('Salvează'));

    expect(await still()).toBe('open');
    expect(
      panel().querySelector('[data-problem], [data-brand-problems]'),
    ).not.toBeNull();
  });

  it('closes on the backdrop without sending', async () => {
    await open();
    await press(chip('Dacia'));

    const backdrop = document.querySelector<HTMLElement>(
      '.cdk-overlay-backdrop',
    );
    backdrop?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a 140-letter note with comma-below diacritics whole', async () => {
    await open();

    await write('brandNote', 'ș'.repeat(140));
    await press(button('Salvează'));

    expect(sent().body.brandNote).toBe('ș'.repeat(140));
  });

  it('opens two taken brands with the same fuel line independently', async () => {
    await open(
      stored({
        worksOn: [
          { ...ref(BMW), fuels: ['petrol'], jobs: [OIL] },
          { ...ref(DACIA), fuels: ['petrol', 'electric'], jobs: [] },
        ],
      }),
    );

    await press(fuel('Dacia', 'Electric'));

    expect(ticked('Dacia')).toEqual(['Benzină']);
    expect(ticked('BMW')).toEqual(['Benzină']);
  });
});
