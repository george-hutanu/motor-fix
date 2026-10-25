import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
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
let refresh: jest.Mock<Promise<GarageMechanicDto | undefined>, []>;

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
  refresh = jest.fn(async () => existing);
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    'saved' | 'removed',
    MechanicCardData
  >(MechanicCard, {
    data: { brands: BRANDS, card: existing, garageId: 'garage-1', refresh },
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
const tickNames = () => ticks().map((t) => text(t.closest('label')));

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
        ? !n.matches('.mf-task-sending, .sr-only')
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

const refusal = (status: number, body: object) => ({
  body,
  opts: { status, statusText: 'Refused' },
});

afterEach(() => {
  http?.verify({ ignoreCancelled: true });
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.mocked(toast).mockReset();
  TestBed.resetTestingModule();
});

// @traces 056-FR-016 056-FR-017
describe('the card dialog, adding a mechanic', () => {
  it('offers a labelled field for each part of the card and a tick per brand the garage takes', async () => {
    await open();

    for (const label of [
      'Nume',
      'Rol',
      'Specialități',
      'Certificări',
      'Ani de experiență',
    ]) {
      expect(field(label).value).toBe('');
    }
    expect(tickNames()).toEqual(['Dacia', 'Renault']);
    expect(ticks().every((t) => !t.checked)).toBe(true);
    expect(button('Elimină')).toBeUndefined();
  });

  it('sends the card with the comma-separated tags split, trimmed and the empties dropped', async () => {
    await open();
    await fillElena();
    type(field('Specialități'), ' Frâne,Suspensie, , Geometrie,');

    await save();
    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body).toEqual({
      brandIds: ['brand-dacia', 'brand-renault'],
      certifications: ['Bosch Car Service'],
      name: 'Elena Stan',
      roleTitle: 'Mecanic șef',
      specialties: ['Frâne', 'Suspensie', 'Geometrie'],
      years: 21,
    });
    req.flush(card({ id: 'mechanic-9' }), { status: 201, statusText: 'OK' });
    await settle();

    await expect(result).resolves.toBe('saved');
  });

  it.each(['', 'E'])(
    'refuses a name of %j under the name field and sends nothing',
    async (name) => {
      await open();
      await fillElena();
      type(field('Nume'), name);

      await save();

      http.expectNone(MECHANICS);
      expect(problem(field('Nume'))).toBe('Numele este obligatoriu');
      expect(field('Nume').getAttribute('aria-invalid')).toBe('true');
      expect(panels()).toHaveLength(1);
    },
  );

  it('refuses a name over 80 characters', async () => {
    await open();
    await fillElena();
    type(field('Nume'), 'E'.repeat(81));

    await save();

    http.expectNone(MECHANICS);
    expect(problem(field('Nume'))).toBe('Cel mult 80 de caractere');
  });

  it.each(['61', '-1'])(
    'refuses %s years under the years field',
    async (years) => {
      await open();
      await fillElena();
      type(field('Ani de experiență'), years);

      await save();

      http.expectNone(MECHANICS);
      expect(problem(field('Ani de experiență'))).toBe('Între 0 și 60 de ani');
    },
  );

  it('accepts 0 years', async () => {
    await open();
    await fillElena();
    type(field('Ani de experiență'), '0');

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.years).toBe(0);
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it('refuses a seventh specialty, an eleventh certification and a tag over 40 characters', async () => {
    await open();
    await fillElena();
    type(field('Specialități'), 'a, b, c, d, e, f, g');
    type(
      field('Certificări'),
      Array.from({ length: 11 }, (_, i) => `C${i}`).join(', '),
    );

    await save();

    http.expectNone(MECHANICS);
    expect(problem(field('Specialități'))).toBe('Cel mult 6 specialități');
    expect(problem(field('Certificări'))).toBe('Cel mult 10 certificări');

    type(field('Specialități'), `Frâne, ${'x'.repeat(41)}`);
    type(field('Certificări'), 'Bosch Car Service');
    await save();

    http.expectNone(MECHANICS);
    expect(problem(field('Specialități'))).toBe(
      'Cel mult 40 de caractere pe etichetă',
    );
  });

  it('accepts six specialties of 40 characters each', async () => {
    await open();
    await fillElena();
    type(
      field('Specialități'),
      Array.from({ length: 6 }, (_, i) => `${i}`.padEnd(40, 'x')).join(', '),
    );

    await save();

    const req = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(req.request.body.specialties).toHaveLength(6);
    req.flush(card(), { status: 201, statusText: 'OK' });
    await settle();
  });

  it("shows the server's brand refusal under the ticks, keeps the dialog and says so in a toast", async () => {
    await open();
    await fillElena();

    await save();
    const { body, opts } = refusal(422, {
      code: 'validation_failed',
      errors: [{ code: 'not_taken', field: 'brandIds' }],
    });
    http.expectOne({ method: 'POST', url: MECHANICS }).flush(body, opts);
    await settle();

    expect(text()).toContain('Marcă pe care service‑ul nu o acceptă');
    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
    expect(panels()).toHaveLength(1);
    expect(field('Nume').value.trim()).toBe('Elena Stan');
  });

  it('shows a spinner and disables the fields while saving, then keeps the dialog on no network', async () => {
    await open();
    await fillElena();

    await save();
    const req: TestRequest = http.expectOne({ method: 'POST', url: MECHANICS });
    expect(button('Salvează')?.getAttribute('aria-busy')).toBe('true');
    expect(field('Nume').matches(':disabled')).toBe(true);
    expect(ticks().every((t) => t.matches(':disabled'))).toBe(true);

    req.error(new ProgressEvent('error'));
    await settle();

    expect(button('Salvează')?.getAttribute('aria-busy')).toBeNull();
    expect(field('Nume').matches(':disabled')).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
    expect(panels()).toHaveLength(1);
  });

  // @traces 056-FR-021
  it('starts with the focus inside the dialog and closes on Escape', async () => {
    await open();

    expect(
      document.activeElement?.closest('[role="dialog"], dialog'),
    ).not.toBeNull();
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  // @traces 056-FR-021
  it('ties each field to its own message, marked invalid once refused, and the ticks to theirs', async () => {
    await open();
    const labels = [
      'Nume',
      'Rol',
      'Specialități',
      'Certificări',
      'Ani de experiență',
    ];
    for (const label of labels) {
      const ids = (field(label).getAttribute('aria-describedby') ?? '').split(
        ' ',
      );
      const error = ids.find((id) => id.endsWith('-error'));
      expect(error && document.getElementById(error)).toBeTruthy();
      for (const id of ids) expect(document.getElementById(id)).toBeTruthy();
    }
    const errors = labels.map((label) =>
      field(label)
        .getAttribute('aria-describedby')
        ?.split(' ')
        .find((id) => id.endsWith('-error')),
    );
    expect(new Set(errors).size).toBe(labels.length);
    const brands = panel().querySelector('fieldset');
    expect(brands?.querySelector('legend')).not.toBeNull();
    expect(
      document.getElementById(brands?.getAttribute('aria-describedby') ?? ''),
    ).toBeTruthy();

    type(field('Nume'), 'E');
    button('Salvează')?.click();
    await settle();

    expect(field('Nume').getAttribute('aria-invalid')).toBe('true');
    expect(problem(field('Nume'))).toBe('Numele este obligatoriu');
    expect(field('Rol').getAttribute('aria-invalid')).not.toBe('true');
  });

  // @traces 056-FR-020
  it('reads English', async () => {
    await open(undefined, 'en');

    for (const label of [
      'Name',
      'Role',
      'Specialties',
      'Certifications',
      'Years of experience',
    ]) {
      expect(field(label)).toBeDefined();
    }
    type(field('Name'), 'E');
    type(field('Years of experience'), '61');
    await save('Save');

    expect(problem(field('Name'))).toBe('The name is required');
    expect(problem(field('Years of experience'))).toBe(
      'Between 0 and 60 years',
    );
    expect(text()).not.toMatch(/garage\.mechanicCard\./);
  });
});

// @traces 056-FR-016 056-FR-018
describe('the card dialog, editing a card', () => {
  it('opens filled in with the card, its brands ticked', async () => {
    await open(card());

    expect(field('Nume').value).toBe('Elena Stan');
    expect(field('Rol').value).toBe('Mecanic șef');
    expect(field('Specialități').value).toBe('Frâne, Suspensie');
    expect(field('Certificări').value).toBe('Bosch Car Service');
    expect(field('Ani de experiență').value).toBe('21');
    expect(ticks().map((t) => t.checked)).toEqual([true, false]);
  });

  it('saves the change to the card and closes', async () => {
    await open(card());
    type(field('Specialități'), 'Frâne');
    type(field('Ani de experiență'), '');

    await save();
    const req = http.expectOne({
      method: 'PATCH',
      url: `${MECHANICS}/mechanic-1`,
    });
    expect(req.request.body).toEqual({
      brandIds: ['brand-dacia'],
      certifications: ['Bosch Car Service'],
      name: 'Elena Stan',
      roleTitle: 'Mecanic șef',
      specialties: ['Frâne'],
      years: null,
    });
    req.flush(card({ specialties: ['Frâne'], years: null }));
    await settle();

    await expect(result).resolves.toBe('saved');
  });

  it('lists photo, bio and languages read-only for a card with an account', async () => {
    await open(card({ hasAccount: true }));

    expect(text()).toContain('Le completează mecanicul');
    expect(text()).toMatch(/Fotografie, descriere, limbi/i);
    expect(
      [...panel().querySelectorAll('label')].some((l) =>
        /Fotografie|Descriere|Limbi/i.test(l.textContent ?? ''),
      ),
    ).toBe(false);
  });

  it('has no read-only block for a card with no account', async () => {
    await open(card({ hasAccount: false }));

    expect(text()).not.toContain('Le completează mecanicul');
  });

  it('says the mechanic fills them in, in English', async () => {
    await open(card({ hasAccount: true }), 'en');

    expect(text()).toContain('The mechanic fills these in');
  });

  it("offers no Elimină on the owner's own card, which saves like any other", async () => {
    await open(card({ id: 'owner-row', isOwner: true, name: 'Mihai Ionescu' }));

    expect(button('Elimină')).toBeUndefined();
    type(field('Rol'), 'Proprietar');
    await save();

    const req = http.expectOne({
      method: 'PATCH',
      url: `${MECHANICS}/owner-row`,
    });
    expect(req.request.body.roleTitle).toBe('Proprietar');
    req.flush(
      card({ id: 'owner-row', isOwner: true, roleTitle: 'Proprietar' }),
    );
    await settle();
    await expect(result).resolves.toBe('saved');
  });

  it('removes the card through the confirmation and closes both dialogs', async () => {
    await open(card({ futureBookings: 3 }));

    button('Elimină')?.click();
    await settle();
    const confirmation = panels()[1] as HTMLElement;
    expect(text(confirmation)).toContain(
      'Elena Stan are 3 programări viitoare. Vor trebui realocate.',
    );
    button('Elimină', confirmation)?.click();
    await settle();
    http
      .expectOne({ method: 'DELETE', url: `${MECHANICS}/mechanic-1` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    await expect(result).resolves.toBe('removed');
    expect(panels()).toHaveLength(0);
  });

  it('keeps the card open when the confirmation is cancelled', async () => {
    await open(card());

    button('Elimină')?.click();
    await settle();
    button('Renunță', panels()[1])?.click();
    await settle();

    http.expectNone(`${MECHANICS}/mechanic-1`);
    expect(panels()).toHaveLength(1);
    expect(field('Nume').value).toBe('Elena Stan');
  });

  it('says so in a toast and closes for the list to read again when the card was removed in another tab', async () => {
    await open(card());
    type(field('Rol'), 'Mecanic');

    await save();
    const { body, opts } = refusal(404, { code: 'not_found', title: 'gone' });
    http
      .expectOne({ method: 'PATCH', url: `${MECHANICS}/mechanic-1` })
      .flush(body, opts);
    await settle();

    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
    await expect(result).resolves.toBe('removed');
  });

  // @traces 056-FR-020
  it('shows a name typed with markup as text', async () => {
    await open(card({ name: '<b>Elena</b>', roleTitle: '<i>șef</i>' }));

    expect(panel().querySelector('b, i')).toBeNull();
    expect(field('Nume').value).toBe('<b>Elena</b>');
  });
});

const INVITES = '/api/v1/garages/garage-1/invites';
const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const invited = (
  over: Partial<NonNullable<GarageMechanicDto['invite']>> = {},
) =>
  card({
    invite: {
      email: 'elena@example.ro',
      expiresAt: '2026-11-01T12:00:00.000Z',
      id: 'invite-1',
      phone: null,
      sentAt: '2026-10-25T11:00:00.000Z',
      ...over,
    },
  });

// @traces 1255-FR-013 1255-FR-016
describe('the card dialog, inviting the mechanic', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers Invită on a saved card with no account and no invite', async () => {
    await open(card());

    expect(button('Invită')).toBeDefined();
  });

  it.each([
    ['a new card', undefined],
    ['a card with an account', card({ hasAccount: true })],
    [
      "the owner's own card",
      card({ id: 'owner-row', isOwner: true, name: 'Mihai Ionescu' }),
    ],
  ])('offers no Invită on %s', async (_, existing) => {
    await open(existing);

    expect(button('Invită')).toBeUndefined();
  });

  it('opens the invite dialog for the card, by name', async () => {
    await open(card());

    button('Invită')?.click();
    await settle();

    const dialog = panels()[1] as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent?.trim()).toBe(
      'Invită pe Elena Stan',
    );
    expect(button('Trimite invitația', dialog)).toBeDefined();
  });

  it('shows the open invite with its address and date, and Retrimite and Anulează invitația', async () => {
    await open(invited());

    expect(text()).toContain(
      'Invitație trimisă pe elena@example.ro · expiră 01.11.2026',
    );
    expect(button('Invită')).toBeUndefined();
    expect(button('Retrimite')).toBeDefined();
    expect(button('Anulează invitația')).toBeDefined();
  });

  it('names the phone of an invite sent by WhatsApp', async () => {
    await open(invited({ email: null, phone: '+40722000111' }));

    expect(text()).toContain('Invitație trimisă pe +40722000111');
  });

  it('says an invite past its date has expired, keeping both buttons', async () => {
    await open(invited({ expiresAt: '2026-10-24T12:00:00.000Z' }));

    expect(text()).toContain('a expirat');
    expect(text()).not.toContain('expiră');
    expect(button('Retrimite')).toBeDefined();
    expect(button('Anulează invitația')).toBeDefined();
  });

  it('resends, keeping the dialog open, and refreshes the card', async () => {
    await open(invited());

    button('Retrimite')?.click();
    await settle();
    expect(button('Retrimite')?.disabled).toBe(true);
    button('Retrimite')?.click();
    await settle();
    const req = http.expectOne({
      method: 'POST',
      url: `${INVITES}/invite-1/resend`,
    });
    req.flush({ emailSent: true, id: 'invite-1' });
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(panels()).toHaveLength(1);
    expect(document.activeElement).toBe(button('Retrimite'));
  });

  it('cancels the invite and offers Invită again once refreshed', async () => {
    await open(invited());
    refresh.mockResolvedValueOnce(card());

    button('Anulează invitația')?.click();
    await settle();
    http
      .expectOne({ method: 'POST', url: `${INVITES}/invite-1/revoke` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(button('Anulează invitația')).toBeUndefined();
    expect(button('Invită')).toBeDefined();
  });

  it('refreshes and says so when the invite was answered elsewhere meanwhile', async () => {
    await open(invited());

    button('Anulează invitația')?.click();
    await settle();
    const { body, opts } = refusal(409, {
      code: 'invite_invalid',
      title: 'gone',
    });
    http
      .expectOne({ method: 'POST', url: `${INVITES}/invite-1/revoke` })
      .flush(body, opts);
    await settle();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
  });

  // @traces 1255-FR-013
  it.each([
    ['Retrimite', 'resend'],
    ['Anulează invitația', 'revoke'],
  ])(
    'shows %s busy while in flight, with both buttons disabled',
    async (name, path) => {
      await open(invited());

      button(name)?.click();
      await settle();

      expect(button(name)?.getAttribute('aria-busy')).toBe('true');
      expect(button(name)?.querySelector('.sr-only')).not.toBeNull();
      expect(button('Retrimite')?.disabled).toBe(true);
      expect(button('Anulează invitația')?.disabled).toBe(true);
      const other = name === 'Retrimite' ? 'Anulează invitația' : 'Retrimite';
      expect(button(other)?.getAttribute('aria-busy')).toBeNull();
      http
        .expectOne({ method: 'POST', url: `${INVITES}/invite-1/${path}` })
        .flush(path === 'resend' ? { emailSent: true, id: 'invite-1' } : null, {
          status: path === 'resend' ? 201 : 204,
          statusText: 'OK',
        });
      await settle();

      expect(button(name)?.getAttribute('aria-busy') ?? null).toBeNull();
    },
  );

  // @traces 1255-FR-016
  it('focus returns to Retrimite, enabled again, after a resend', async () => {
    await open(invited());

    button('Retrimite')?.click();
    await settle();
    http
      .expectOne({ method: 'POST', url: `${INVITES}/invite-1/resend` })
      .flush({ emailSent: true, id: 'invite-1' });
    await settle();

    const resend = button('Retrimite');
    expect(resend?.disabled).toBe(false);
    expect(document.activeElement).toBe(resend);
  });

  // @traces 1255-FR-016
  it('focus returns to Invită after a revoke removes the invite block', async () => {
    await open(invited());
    refresh.mockResolvedValueOnce(card());

    button('Anulează invitația')?.click();
    await settle();
    http
      .expectOne({ method: 'POST', url: `${INVITES}/invite-1/revoke` })
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(document.activeElement).toBe(button('Invită'));
  });

  it('reads English', async () => {
    await open(invited(), 'en');

    expect(text()).toContain('Invite sent to elena@example.ro · expires');
    expect(button('Resend')).toBeDefined();
    expect(button('Cancel the invite')).toBeDefined();
  });
});
