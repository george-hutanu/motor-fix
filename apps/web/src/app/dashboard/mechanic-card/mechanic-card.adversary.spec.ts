import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageMechanicDto, MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { MechanicCard, type MechanicCardData } from './mechanic-card';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const MECHANICS = '/api/v1/garages/garage-1/mechanics';
const BRANDS = [
  { id: 'brand-dacia', name: 'Dacia' },
  { id: 'brand-renault', name: 'Renault' },
];

const card = (over: Partial<GarageMechanicDto> = {}): GarageMechanicDto => ({
  brandIds: ['brand-dacia'],
  certifications: ['Bosch Car Service'],
  futureBookings: 0,
  hasAccount: false,
  id: 'mechanic-1',
  invite: null,
  isOwner: false,
  name: 'Elena Stan',
  onProfile: false,
  rating: null,
  reviewCount: 0,
  roleTitle: 'Mecanic șef',
  speciality: 'Frâne, Suspensie',
  specialties: ['Frâne', 'Suspensie'],
  years: 21,
  ...over,
});

const me = {
  garageAccess: [{ features: {}, garageId: 'garage-1', role: 'owner' }],
  garageId: 'garage-1',
  role: 'garage',
} as unknown as MeDto;

let http: HttpTestingController;
let result: Promise<OverlayResult<'saved' | 'removed'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  existing?: GarageMechanicDto,
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: Session,
        useValue: { current: signal(me), shown: signal(me) },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  http = TestBed.inject(HttpTestingController);
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'saved' | 'removed',
    MechanicCardData
  >(MechanicCard, {
    data: { brands: BRANDS, card: existing, garageId: 'garage-1' },
    shape: 'dialog',
    title: 'garage.mechanicCard.title',
  });
  await settle();
}

const panels = () => [
  ...document.querySelectorAll<HTMLElement>('mf-overlay-panel'),
];
const panel = () => panels()[0] as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string, within: HTMLElement = panel()): HTMLInputElement {
  const found = [...within.querySelectorAll('label')].find((l) =>
    l.textContent?.trim().startsWith(label),
  );
  const input = found?.htmlFor
    ? document.getElementById(found.htmlFor)
    : found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

// The message tied to a field for assistive technology.
// The error is the description that ends in -error; a hint may come first.
const problem = (input: HTMLInputElement) =>
  text(
    document.getElementById(
      (input.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .find((id) => id.endsWith('-error')) ?? '',
    ),
  );

const ticks = () => [
  ...panel().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
];

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function tick(input: HTMLInputElement) {
  input.click();
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// A button's own label: the busy button's spoken "sending" line is not it.
const labelOf = (b: HTMLButtonElement) =>
  [...b.childNodes]
    .filter((n) =>
      n instanceof HTMLElement
        ? !n.matches('.mf-task-sending')
        : n.nodeType === Node.TEXT_NODE,
    )
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();

const button = (name: string, within: HTMLElement = panel()) =>
  [...within.querySelectorAll('button')].find((b) => labelOf(b) === name) as
    | HTMLButtonElement
    | undefined;

async function save(name = 'Salvează') {
  button(name)?.click();
  await settle();
}

async function fillElena() {
  type(field('Nume'), '  Elena Stan ');
  type(field('Rol'), 'Mecanic șef');
  type(field('Specialități'), 'Frâne, Suspensie, Geometrie');
  type(field('Certificări'), 'Bosch Car Service');
  type(field('Ani de experiență'), '21');
  for (const t of ticks()) tick(t);
  await settle();
}

afterEach(() => {
  http?.verify({ ignoreCancelled: true });
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.mocked(toast).mockReset();
  TestBed.resetTestingModule();
});

describe('the card dialog under awkward input', () => {
  it('counts characters, not UTF-16 units: a name of eighty emoji is sent', async () => {
    await open();
    type(field('Nume'), '🔧'.repeat(80));

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.name).toBe('🔧'.repeat(80));
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('counts characters in a tag: forty emoji are one tag at the limit', async () => {
    await open();
    type(field('Nume'), 'Elena Stan');
    type(field('Specialități'), '🔧'.repeat(40));

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.specialties).toEqual(['🔧'.repeat(40)]);
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('refuses a name of spaces only and sends nothing', async () => {
    await open();
    type(field('Nume'), '     ');

    await save();

    http.expectNone(MECHANICS);
    expect(problem(field('Nume'))).toBe('Numele este obligatoriu');
  });

  it('takes a name of eighty characters padded with spaces to eighty-five', async () => {
    await open();
    type(field('Nume'), `  ${'E'.repeat(80)}   `);

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.name).toBe('E'.repeat(80));
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('refuses a year that is not whole and sends nothing', async () => {
    await open();
    type(field('Nume'), 'Elena Stan');
    type(field('Ani de experiență'), '2.5');

    await save();

    http.expectNone(MECHANICS);
    expect(field('Ani de experiență').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(panels()).toHaveLength(1);
  });

  it.each(['60', '0'])('sends %s years as a number', async (years) => {
    await open();
    type(field('Nume'), 'Elena Stan');
    type(field('Ani de experiență'), years);

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.years).toBe(Number(years));
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('sends an empty list for a specialties input of commas and spaces only', async () => {
    await open();
    type(field('Nume'), 'Elena Stan');
    type(field('Specialități'), ' , ,, ');

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.specialties ?? []).toEqual([]);
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('keeps a duplicate tag as typed', async () => {
    await open();
    type(field('Nume'), 'Elena Stan');
    type(field('Specialități'), 'Frâne, Frâne');

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.specialties).toEqual(['Frâne', 'Frâne']);
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('sends one request when Salvează is pressed twice at once', async () => {
    await open();
    await fillElena();

    button('Salvează')?.click();
    button('Salvează')?.click();
    await settle();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
    await expect(result).resolves.toBe('saved');
  });

  it('puts a server field refusal for the role under the role field', async () => {
    await open();
    type(field('Nume'), 'Elena Stan');

    await save();
    http.expectOne({ method: 'POST', url: MECHANICS }).flush(
      {
        code: 'validation_failed',
        errors: [{ code: 'too_long', field: 'roleTitle' }],
      },
      { status: 422, statusText: 'Refused' },
    );
    await settle();

    expect(problem(field('Rol'))).not.toBe('');
    expect(field('Rol').getAttribute('aria-invalid')).toBe('true');
    expect(problem(field('Nume'))).toBe('');
    expect(panels()).toHaveLength(1);
  });

  it('keeps the dialog and tells the person on a 403 for a mechanic-owned field', async () => {
    await open(card());

    await save();
    http
      .expectOne({ method: 'PATCH', url: `${MECHANICS}/mechanic-1` })
      .flush(
        { code: 'mechanic_owned_field', title: 'no' },
        { status: 403, statusText: 'Forbidden' },
      );
    await settle();

    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
    expect(panels()).toHaveLength(1);
  });
});

describe('the card dialog on a card the garage has moved on from', () => {
  it('drops a brand the garage no longer takes from the saved card', async () => {
    await open(card({ brandIds: ['brand-dacia', 'brand-gone'] }));

    await save();

    const req = http.expectOne({
      method: 'PATCH',
      url: `${MECHANICS}/mechanic-1`,
    });
    expect(req.request.body.brandIds).toEqual(['brand-dacia']);
    req.flush(card());
    await settle();
  });

  it('sends empty lists and nulls when every field is cleared, so the server clears them', async () => {
    await open(card());
    type(field('Rol'), '');
    type(field('Specialități'), '');
    type(field('Certificări'), '');
    type(field('Ani de experiență'), '');
    for (const t of ticks()) if (t.checked) tick(t);
    await settle();

    await save();

    const req = http.expectOne({
      method: 'PATCH',
      url: `${MECHANICS}/mechanic-1`,
    });
    expect(req.request.body).toEqual({
      brandIds: [],
      certifications: [],
      name: 'Elena Stan',
      roleTitle: null,
      specialties: [],
      years: null,
    });
    req.flush(card());
    await settle();
  });

  it('fills in a card whose role and years are null with empty fields, not the word null', async () => {
    await open(
      card({
        certifications: [],
        roleTitle: null,
        specialties: [],
        years: null,
      }),
    );

    expect(field('Rol').value).toBe('');
    expect(field('Ani de experiență').value).toBe('');
    expect(field('Specialități').value).toBe('');
    expect(field('Certificări').value).toBe('');
  });

  it('shows a card with a markup tag as text in the tag list', async () => {
    await open(card({ specialties: ['<img src=x onerror=alert(1)>'] }));

    expect(panel().querySelector('img')).toBeNull();
  });
});

describe('removing from the card dialog under refusal', () => {
  async function confirm() {
    button('Elimină')?.click();
    await settle();
    return panels()[1] as HTMLElement;
  }

  it('sends one DELETE when Elimină is pressed twice in the confirmation', async () => {
    await open(card());
    const confirmation = await confirm();

    button('Elimină', confirmation)?.click();
    button('Elimină', confirmation)?.click();
    await settle();

    http
      .expectOne({ method: 'DELETE', url: `${MECHANICS}/mechanic-1` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    await expect(result).resolves.toBe('removed');
  });

  it('keeps the card dialog and says so on a 409 owner_row', async () => {
    await open(card());
    const confirmation = await confirm();

    button('Elimină', confirmation)?.click();
    await settle();
    http
      .expectOne({ method: 'DELETE', url: `${MECHANICS}/mechanic-1` })
      .flush(
        { code: 'owner_row', title: 'no' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();

    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
    expect(field('Nume').value).toBe('Elena Stan');
  });

  it('closes for the list to read again when the card was already removed (404)', async () => {
    await open(card());
    const confirmation = await confirm();

    button('Elimină', confirmation)?.click();
    await settle();
    http
      .expectOne({ method: 'DELETE', url: `${MECHANICS}/mechanic-1` })
      .flush(
        { code: 'not_found', title: 'gone' },
        { status: 404, statusText: 'Not Found' },
      );
    await settle();

    await expect(result).resolves.toBe('removed');
  });
});
