import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type GarageProfileDto,
  GaragesService,
  PublicHolidaysService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  type ProfileEditData,
  ProfileEditDialog,
  type ProfileGroup,
} from './profile-edit-dialog';

const GARAGE = 'garage-1';
const WEEKDAY: string[][] = [['08:00', '17:00']];
const HOURS = {
  fri: WEEKDAY,
  mon: WEEKDAY,
  sat: [],
  sun: [],
  thu: WEEKDAY,
  tue: WEEKDAY,
  wed: WEEKDAY,
};

const profile = (over: Partial<GarageProfileDto> = {}): GarageProfileDto =>
  ({
    address: 'Str. Atelierului 14, Militari',
    brandNote: null,
    businessKind: 'company',
    closedDays: [{ day: '2026-12-01', reason: 'holiday' }],
    description: 'Diesel german și cutii de viteze.',
    doesNotTake: [],
    facilities: ['waiting_area'],
    facilitiesNote: 'Cafea',
    hours: HOURS,
    id: GARAGE,
    jobTypes: [],
    name: 'Service Auto Militari',
    paymentMethods: { card: true, cash: true, transfer: false },
    phone: '+40722123456',
    photos: [],
    prices: [],
    rating: null,
    refusalPhrase: null,
    responseRate: { state: 'new' },
    reviewCount: 0,
    slug: 'service-auto-militari',
    storedClosedDays: [{ day: '2026-12-27', note: 'Inventar' }],
    verifiedAt: null,
    version: '3',
    worksOn: [],
    ...over,
  }) as GarageProfileDto;

@Component({
  template: '<button type="button" id="opener">Modifică profilul</button>',
})
class Host {
  readonly overlays = inject(Overlays);
}

let update: jest.Mock;
let read: jest.Mock;
let result: Promise<OverlayResult<GarageProfileDto>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  group: ProfileGroup,
  start: GarageProfileDto = profile(),
  language: 'ro' | 'en' = 'ro',
) {
  update = jest.fn(async () => profile({ version: '4' }));
  read = jest.fn(async () => profile({ version: '5' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          garageProfileControllerRead: read,
          garageProfileControllerUpdate: update,
        },
      },
      {
        provide: PublicHolidaysService,
        useValue: {
          publicHolidaysControllerList: jest.fn(async ({ year }) =>
            year === 2026
              ? [
                  {
                    day: '2026-12-01',
                    nameEn: 'National Day',
                    nameRo: 'Ziua Națională',
                  },
                ]
              : [],
          ),
        },
      },
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
    GarageProfileDto,
    ProfileEditData
  >(ProfileEditDialog, {
    confirmDiscard: false,
    data: { garageId: GARAGE, group, profile: start },
    shape: 'dialog',
    title: `garage.profile.edit.title.${group}`,
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
const still = async () =>
  Promise.race([result, new Promise((r) => setTimeout(() => r('open'), 20))]);
const status = (code: number, body?: unknown) =>
  new HttpErrorResponse({
    error: body,
    status: code,
    statusText: String(code),
  });

async function choose(name: string, value: string) {
  const select = panel().querySelector<HTMLSelectElement>(
    `select[name="${name}"]`,
  );
  if (!select) throw new Error(`no ${name}`);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await settle();
}

async function typeInto(selector: string, value: string) {
  const input = panel().querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

beforeEach(() => {
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
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: new Date('2026-10-30T09:00:00Z'),
  });
});

afterEach(() => {
  jest.useRealTimers();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 1246-FR-012 1246-FR-013 1246-FR-014
describe('the profile dialog: hours and closed days', () => {
  it('reuses the hours step with the week and the stored closed days, and no facilities, note or payments', async () => {
    await open('hours');

    expect(text(panel().querySelector('h2'))).toBe('Program și zile închise');
    const step = panel().querySelector('mf-hours-step');
    expect(step).not.toBeNull();
    expect(step?.querySelector('[data-row="weekdays"]')).not.toBeNull();
    expect(text(step?.querySelector('.closed-days'))).toContain('Inventar');
    expect(step?.querySelector('.facilities')).toBeNull();
    expect(step?.querySelector('input[name="facilitiesNote"]')).toBeNull();
    expect(step?.querySelector('.payments')).toBeNull();
    expect(button('Salvează')?.type).toBe('submit');
    expect(button('Renunță')?.type).toBe('button');
  });

  it('sends the week and every closed day with the stamp, and closes with the answer, reading nothing', async () => {
    await open('hours');
    await choose('weekdays-close', '18:00');

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      body: {
        closedDays: [{ day: '2026-12-27', note: 'Inventar' }],
        hours: {
          ...HOURS,
          fri: [['08:00', '18:00']],
          mon: [['08:00', '18:00']],
          thu: [['08:00', '18:00']],
          tue: [['08:00', '18:00']],
          wed: [['08:00', '18:00']],
        },
        version: '3',
      },
      garageId: GARAGE,
    });
    await expect(result).resolves.toEqual(profile({ version: '4' }));
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a legal holiday as a closed day with the step text, and never sends it', async () => {
    await open('hours');
    await typeInto('input[name="closedDay"]', '2026-12-01');
    panel().querySelector<HTMLButtonElement>('button.add-closed')?.click();
    await settle();

    expect(text(panel().querySelector('.closed-error'))).toBe(
      'E deja zi liberă legală',
    );
    expect(update).not.toHaveBeenCalled();

    button('Salvează')?.click();
    await settle();

    expect(update.mock.calls[0][0].body.closedDays).toEqual([
      { day: '2026-12-27', note: 'Inventar' },
    ]);
  });

  it('is busy while the save is on its way, and a second press sends nothing more', async () => {
    await open('hours');
    let answer: (value: GarageProfileDto) => void = () => undefined;
    update.mockImplementationOnce(
      () => new Promise<GarageProfileDto>((resolve) => (answer = resolve)),
    );

    button('Salvează')?.click();
    await settle();
    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(button('Salvează')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Salvează')?.getAttribute('aria-disabled')).toBe('true');
    answer(profile({ version: '4' }));
    await settle();
    await expect(result).resolves.toMatchObject({ version: '4' });
  });

  it("shows the server's refusal of the week under it, the dialog kept open", async () => {
    await open('hours');
    update.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'weeklyHours', field: 'hours' }],
        status: 400,
      }),
    );

    button('Salvează')?.click();
    await settle();

    const error = panel().querySelector('#profile-edit-hours-error');
    expect(text(error)).toBe('Programul nu este valid. Verifică orele.');
    expect(await still()).toBe('open');
  });

  it('says the profile changed meanwhile, and Reîncarcă reads it into the dialog and nothing else', async () => {
    await open('hours');
    update.mockRejectedValueOnce(
      status(409, { code: 'profile_changed', status: 409 }),
    );
    read.mockResolvedValueOnce(
      profile({
        hours: { ...HOURS, sat: [['09:00', '13:00']] },
        storedClosedDays: [],
        version: '5',
      }),
    );

    button('Salvează')?.click();
    await settle();

    expect(text(panel().querySelector('[data-stale]'))).toContain(
      'Profilul a fost modificat între timp. Reîncarcă.',
    );
    button('Reîncarcă')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(update).toHaveBeenCalledTimes(1);
    expect(panel().querySelector('[data-stale]')).toBeNull();
    expect(
      panel().querySelector<HTMLSelectElement>('select[name="sat-open"]')
        ?.value,
    ).toBe('09:00');
    expect(panel().querySelector('.closed-days')).toBeNull();

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0].body).toMatchObject({
      closedDays: [],
      version: '5',
    });
  });

  it('keeps the line when the reload fails, and a second press reads again', async () => {
    await open('hours');
    update.mockRejectedValueOnce(
      status(409, { code: 'profile_changed', status: 409 }),
    );
    read.mockRejectedValueOnce(status(0));

    button('Salvează')?.click();
    await settle();
    button('Reîncarcă')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(text(panel().querySelector('[data-stale]'))).toContain(
      'Profilul a fost modificat între timp. Reîncarcă.',
    );
    expect(button('Reîncarcă')?.getAttribute('aria-busy')).toBeNull();
    expect(await still()).toBe('open');

    button('Reîncarcă')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(panel().querySelector('[data-stale]')).toBeNull();
  });

  it('says it in English', async () => {
    await open('hours', profile(), 'en');
    update.mockRejectedValueOnce(
      status(409, { code: 'profile_changed', status: 409 }),
    );

    button('Save')?.click();
    await settle();

    expect(text(panel().querySelector('h2'))).toBe('Hours and closed days');
    expect(text(panel().querySelector('[data-stale]'))).toContain(
      'The profile was changed meanwhile. Reload.',
    );
    expect(button('Reload')).toBeDefined();
  });

  it.each([
    ['a network failure', status(0)],
    ['a server failure', status(503)],
  ])(
    'keeps the dialog and the typed week after %s, with a retry text and Save free again',
    async (_, failure) => {
      await open('hours');
      await choose('weekdays-close', '18:00');
      update.mockRejectedValueOnce(failure);

      button('Salvează')?.click();
      await settle();

      expect(await still()).toBe('open');
      expect(
        panel().querySelector<HTMLSelectElement>(
          'select[name="weekdays-close"]',
        )?.value,
      ).toBe('18:00');
      expect(text(panel().querySelector('[data-problem]'))).toMatch(
        /încearcă din nou/i,
      );
      expect(button('Salvează')?.getAttribute('aria-busy')).toBeNull();
    },
  );

  it('closes on Renunță without sending, and gives the focus back to the control that opened it', async () => {
    const { opener } = await open('hours');

    expect(
      document.activeElement?.closest('[role="dialog"]')?.contains(panel()),
    ).toBe(true);
    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(update).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape without sending or asking', async () => {
    await open('hours');
    await choose('weekdays-close', '18:00');

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(update).not.toHaveBeenCalled();
  });
});

const control = (id: string) =>
  panel().querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#${id}`,
  ) as HTMLInputElement;

async function fill(id: string, value: string) {
  const input = control(id);
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function leave(id: string) {
  control(id).dispatchEvent(new Event('blur'));
  await settle();
}

// @traces 1246-FR-013 1246-FR-014 1246-FR-003
describe('the profile dialog: name and description', () => {
  it('holds the name and description as read, their limits under them, and the address read only with its note', async () => {
    await open('texts');

    expect(text(panel().querySelector('h2'))).toBe('Nume și descriere');
    expect(text(panel().querySelector('label[for="profile-edit-name"]'))).toBe(
      'Nume',
    );
    expect(control('profile-edit-name').value).toBe('Service Auto Militari');
    expect(control('profile-edit-name').tagName).toBe('INPUT');
    expect(
      text(panel().querySelector('label[for="profile-edit-description"]')),
    ).toBe('Descriere');
    expect(control('profile-edit-description').tagName).toBe('TEXTAREA');
    expect(control('profile-edit-description').value).toBe(
      'Diesel german și cutii de viteze.',
    );
    expect(text(panel().querySelector('#profile-edit-name-hint'))).toBe(
      'Între 2 și 80 de caractere',
    );
    expect(text(panel().querySelector('#profile-edit-description-hint'))).toBe(
      'Cel mult 1.000 de caractere',
    );
    expect(
      control('profile-edit-name').getAttribute('aria-describedby'),
    ).toContain('profile-edit-name-hint');
    const address = panel().querySelector('[data-address]');
    expect(text(address)).toContain('Str. Atelierului 14, Militari');
    expect(text(address)).toContain('Schimbarea adresei trece pe la un admin.');
    expect(address?.querySelector('input, textarea')).toBeNull();
    expect(panel().querySelector('mf-hours-step')).toBeNull();
  });

  it.each([
    ['one letter', 'S'],
    ['spaces around one letter', '   S   '],
    ['81 letters', 'S'.repeat(81)],
  ])(
    'says a name of %s is out of bounds as she leaves it, and sends nothing',
    async (_, name) => {
      await open('texts');
      await fill('profile-edit-name', name);

      expect(text(panel().querySelector('#profile-edit-name-error'))).toBe('');
      await leave('profile-edit-name');

      expect(text(panel().querySelector('#profile-edit-name-error'))).toBe(
        'Numele trebuie să aibă între 2 și 80 de caractere.',
      );
      expect(control('profile-edit-name').getAttribute('aria-invalid')).toBe(
        'true',
      );
      expect(
        control('profile-edit-name').getAttribute('aria-describedby'),
      ).toContain('profile-edit-name-error');

      button('Salvează')?.click();
      await settle();

      expect(update).not.toHaveBeenCalled();
      expect(await still()).toBe('open');
    },
  );

  it('takes 2 and 80 letters, and a fixed name drops its error', async () => {
    await open('texts');
    await fill('profile-edit-name', 'S');
    await leave('profile-edit-name');
    await fill('profile-edit-name', 'SA');

    expect(text(panel().querySelector('#profile-edit-name-error'))).toBe('');
    expect(
      control('profile-edit-name').getAttribute('aria-invalid'),
    ).toBeNull();

    await fill('profile-edit-name', 'S'.repeat(80));
    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('says a description past 1,000 letters is too long as she leaves it, and sends nothing', async () => {
    await open('texts');
    await fill('profile-edit-description', 'd'.repeat(1001));
    await leave('profile-edit-description');

    expect(text(panel().querySelector('#profile-edit-description-error'))).toBe(
      'Descrierea poate avea cel mult 1.000 de caractere.',
    );
    button('Salvează')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
  });

  it('sends the trimmed name and description with the stamp, never the address, and closes with the answer', async () => {
    await open('texts');
    await fill('profile-edit-name', '  Service Militari  ');
    await fill('profile-edit-description', ' '.concat('d'.repeat(1000), ' '));

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: {
        description: 'd'.repeat(1000),
        name: 'Service Militari',
        version: '3',
      },
      garageId: GARAGE,
    });
    await expect(result).resolves.toMatchObject({ version: '4' });
    expect(read).not.toHaveBeenCalled();
  });

  it('sends an emptied description as empty, which clears it', async () => {
    await open('texts');
    await fill('profile-edit-description', '   ');

    button('Salvează')?.click();
    await settle();

    expect(update.mock.calls[0][0].body).toEqual({
      description: '',
      name: 'Service Auto Militari',
      version: '3',
    });
  });

  it("shows the server's refusal of the name under the name and focuses it", async () => {
    await open('texts');
    update.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'nameWithin', field: 'name' }],
        status: 400,
      }),
    );

    button('Salvează')?.click();
    await settle();

    expect(text(panel().querySelector('#profile-edit-name-error'))).toBe(
      'Numele trebuie să aibă între 2 și 80 de caractere.',
    );
    expect(document.activeElement).toBe(control('profile-edit-name'));
  });

  it('shows a mobile mechanic no address', async () => {
    await open(
      'texts',
      profile({ address: undefined, businessKind: 'mobile' }),
    );

    expect(panel().querySelector('[data-address]')).toBeNull();
  });

  it('speaks English in English', async () => {
    await open('texts', profile(), 'en');
    await fill('profile-edit-name', 'S');
    await leave('profile-edit-name');

    expect(text(panel().querySelector('h2'))).toBe('Name and description');
    expect(
      text(panel().querySelector('label[for="profile-edit-description"]')),
    ).toBe('Description');
    expect(text(panel().querySelector('#profile-edit-name-error'))).toBe(
      'The name must be 2 to 80 characters.',
    );
    expect(text(panel().querySelector('[data-address]'))).toContain(
      'An address change goes through an admin.',
    );
  });
});

// @traces 1246-FR-013
describe('the profile dialog: phone', () => {
  it('holds the stored phone, marked as not public', async () => {
    await open('contact');

    expect(text(panel().querySelector('h2'))).toBe('Telefon');
    expect(text(panel().querySelector('label[for="profile-edit-phone"]'))).toBe(
      'Telefon nu apare public',
    );
    expect(control('profile-edit-phone').value).toBe('+40722123456');
    expect(control('profile-edit-phone').type).toBe('tel');
    expect(control('profile-edit-phone').getAttribute('autocomplete')).toBe(
      'tel',
    );
  });

  it.each([
    ['a foreign number', '+44 20 7946 0958'],
    ['letters', 'telefon'],
    ['too few digits', '0722 123'],
  ])(
    "says the listing's phone error for %s as she leaves it, and sends nothing",
    async (_, phone) => {
      await open('contact');
      await fill('profile-edit-phone', phone);
      await leave('profile-edit-phone');

      expect(text(panel().querySelector('#profile-edit-phone-error'))).toBe(
        'Momentan acceptăm doar numere din România',
      );
      expect(control('profile-edit-phone').getAttribute('aria-invalid')).toBe(
        'true',
      );
      button('Salvează')?.click();
      await settle();

      expect(update).not.toHaveBeenCalled();
    },
  );

  it('asks for a number when she empties it', async () => {
    await open('contact');
    await fill('profile-edit-phone', '  ');
    await leave('profile-edit-phone');

    expect(text(panel().querySelector('#profile-edit-phone-error'))).toBe(
      'Adaugă un număr de telefon',
    );
  });

  it('writes a typed number in its normalised form as she leaves it, and sends that alone', async () => {
    await open('contact');
    await fill('profile-edit-phone', '0722 123 457');
    await leave('profile-edit-phone');

    expect(control('profile-edit-phone').value).toBe('+40722123457');
    expect(text(panel().querySelector('#profile-edit-phone-error'))).toBe('');
    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { phone: '+40722123457', version: '3' },
      garageId: GARAGE,
    });
  });

  it('speaks English in English', async () => {
    await open('contact', profile(), 'en');
    await fill('profile-edit-phone', 'phone');
    await leave('profile-edit-phone');

    expect(text(panel().querySelector('label[for="profile-edit-phone"]'))).toBe(
      'Phone not shown publicly',
    );
    expect(text(panel().querySelector('#profile-edit-phone-error'))).toBe(
      'We only take Romanian numbers for now',
    );
  });
});

const MOBILE = () =>
  profile({ address: undefined, businessKind: 'mobile', serviceRadiusKm: 35 });

// @traces 1246-FR-011 1246-FR-013
describe('the profile dialog: service radius', () => {
  it('holds the radius in km with its range under it', async () => {
    await open('area', MOBILE());

    expect(text(panel().querySelector('h2'))).toBe('Zona de lucru');
    expect(control('profile-edit-radius').value).toBe('35');
    expect(control('profile-edit-radius').getAttribute('inputmode')).toBe(
      'numeric',
    );
    expect(text(panel().querySelector('#profile-edit-radius-hint'))).toBe(
      'Între 5 și 100 km',
    );
  });

  it('opens on a stored radius under 5 km with no error until she leaves the field', async () => {
    await open('area', profile({ businessKind: 'mobile', serviceRadiusKm: 3 }));

    expect(control('profile-edit-radius').value).toBe('3');
    expect(text(panel().querySelector('#profile-edit-radius-error'))).toBe('');
    expect(
      control('profile-edit-radius').getAttribute('aria-invalid'),
    ).not.toBe('true');

    await leave('profile-edit-radius');

    expect(text(panel().querySelector('#profile-edit-radius-error'))).toBe(
      'Alege raza de deplasare',
    );
  });

  it('starts from 20 km when none is stored', async () => {
    await open('area', profile({ businessKind: 'mobile' }));

    expect(control('profile-edit-radius').value).toBe('20');
  });

  it.each([
    ['4', '4'],
    ['101', '101'],
    ['a fraction', '12.5'],
    ['a fraction with a comma', '12,5'],
    ['a word', 'departe'],
    ['nothing', ''],
  ])(
    'says to choose the travel radius for %s, in error style, and sends nothing',
    async (_, km) => {
      await open('area', MOBILE());
      await fill('profile-edit-radius', km);
      await leave('profile-edit-radius');

      const error = panel().querySelector('#profile-edit-radius-error');
      expect(text(error)).toBe('Alege raza de deplasare');
      expect(error?.classList).toContain('error');
      expect(control('profile-edit-radius').getAttribute('aria-invalid')).toBe(
        'true',
      );
      button('Salvează')?.click();
      await settle();

      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['5', 5],
    ['100', 100],
    [' 42 ', 42],
  ])('sends %s km as a whole number with the stamp', async (km, sent) => {
    await open('area', MOBILE());
    await fill('profile-edit-radius', km);

    button('Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { serviceRadiusKm: sent, version: '3' },
      garageId: GARAGE,
    });
  });

  // One text for the radius everywhere: the listing's own.
  // @traces 1246-FR-023
  it('says it in English', async () => {
    await open('area', MOBILE(), 'en');
    await fill('profile-edit-radius', '4');
    await leave('profile-edit-radius');

    expect(text(panel().querySelector('h2'))).toBe('Service area');
    expect(text(panel().querySelector('#profile-edit-radius-error'))).toBe(
      'Choose how far you travel',
    );
  });
});

// Every text of the four dialogs and the view's controls lives in the garage
// area's files, in Romanian and in English, under the same keys.
// @traces 1246-FR-024 1246-FR-027
describe('the profile edit texts in Romanian and English', () => {
  type Texts = { [key: string]: string | Texts };
  const area = (language: 'ro' | 'en') =>
    JSON.parse(
      readFileSync(
        join(
          __dirname,
          `../../../../../../libs/i18n/src/garage/${language}.json`,
        ),
        'utf8',
      ),
    ) as Texts;
  const flat = (texts: Texts, prefix = ''): Record<string, string> =>
    Object.fromEntries(
      Object.entries(texts).flatMap(([key, value]) =>
        typeof value === 'string'
          ? [[`${prefix}${key}`, value]]
          : Object.entries(flat(value, `${prefix}${key}.`)),
      ),
    );
  const edit = (language: 'ro' | 'en') => flat(area(language), 'garage.');
  const used = () =>
    [
      'profile-edit-dialog/profile-edit-dialog.html',
      'profile-edit-dialog/profile-edit-dialog.ts',
      'profile-view/profile-view.html',
      'profile-view/profile-view.ts',
    ]
      .flatMap((file) => [
        ...readFileSync(join(__dirname, '..', file), 'utf8').matchAll(
          /'(garage\.profile\.edit\.[A-Za-z_.]*[A-Za-z_])'/g,
        ),
      ])
      .map((match) => match[1] as string);

  it('has the same keys in both languages, none empty', () => {
    const ro = edit('ro');
    const en = edit('en');
    const keys = (texts: Record<string, string>) =>
      Object.keys(texts)
        .filter((key) => key.startsWith('garage.profile.edit.'))
        .sort();

    expect(keys(en)).toEqual(keys(ro));
    for (const key of keys(ro)) {
      expect(ro[key]?.trim()).not.toBe('');
      expect(en[key]?.trim()).not.toBe('');
    }
  });

  it.each(['ro', 'en'] as const)(
    'holds every key the dialogs and the view use in %s',
    (language) => {
      const texts = edit(language);
      const keys = [
        ...used(),
        ...['hours', 'texts', 'contact', 'area'].map(
          (group) => `garage.profile.edit.title.${group}`,
        ),
      ];

      expect(keys.length).toBeGreaterThan(10);
      expect(keys.filter((key) => !texts[key])).toEqual([]);
    },
  );
});
