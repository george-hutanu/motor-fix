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
