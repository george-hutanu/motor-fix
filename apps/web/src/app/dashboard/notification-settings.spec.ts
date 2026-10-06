import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationPreferencesDto,
  NotificationsService,
  type StaffNotificationsDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { Live } from './live';
import { NotificationSettings } from './notification-settings';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const GARAGE = 'a3b5c7d9-0000-4000-8000-000000000001';
const OTHER = 'a3b5c7d9-0000-4000-8000-000000000002';

const owner = (
  overrides: Partial<StaffNotificationsDto> = {},
): StaffNotificationsDto => ({
  garageId: GARAGE,
  garageName: 'Atelier Test',
  role: 'owner',
  sections: [
    {
      key: 'requests_quotes',
      types: [
        {
          channels: [
            { channel: 'email', enabled: true, locked: false },
            { channel: 'push', enabled: true, locked: false },
            { channel: 'whatsapp', enabled: false, locked: false },
          ],
          type: 'REQUEST_RECEIVED',
        },
      ],
    },
    {
      key: 'bookings',
      types: [{ channels: [], type: 'DAY_SHEET_OUTDATED' }],
    },
    {
      key: 'account',
      types: [
        {
          channels: [
            { channel: 'email', enabled: true, locked: true },
            { channel: 'push', enabled: false, locked: false },
            { channel: 'whatsapp', enabled: false, locked: false },
          ],
          type: 'VERIFICATION_RESULT',
        },
      ],
    },
  ],
  whatsapp: { available: true, reason: null },
  ...overrides,
});

const answer = (staff: StaffNotificationsDto[]) =>
  ({
    groups: [],
    newsConsent: null,
    preferences: [],
    staff,
  }) as unknown as NotificationPreferencesDto;

let read: jest.Mock;
let save: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;

async function render(
  staff: StaffNotificationsDto[] | Promise<never> = [owner()],
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(() =>
    staff instanceof Promise ? staff : Promise.resolve(answer(staff)),
  );
  save = jest.fn(async () => answer([owner()]));
  events = new Subject();
  resync = new Subject();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: NotificationsService,
        useValue: {
          notificationPreferencesControllerRead: read,
          notificationPreferencesControllerSave: save,
        },
      },
      {
        provide: Live,
        useValue: { events, resync },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(NotificationSettings);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, fixture, settle };
}

const switches = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (element: HTMLElement, name: string) =>
  switches(element).find((s) => s.getAttribute('aria-label') === name);
const text = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const describedBy = (element: HTMLElement, control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => element.querySelector(`#${id}`)?.textContent?.trim());

const event = (kind: string, id: string): LiveMessage =>
  ({ at: '2026-10-06T12:00:00.000Z', id, kind }) as LiveMessage;

afterEach(() => jest.useRealTimers());

describe('NotificationSettings', () => {
  // @traces 198-FR-014
  it('shows skeleton rows while the lists load', async () => {
    let resolve: (value: NotificationPreferencesDto) => void = () => undefined;
    const pending = new Promise<NotificationPreferencesDto>((r) => {
      resolve = r;
    });
    const { element, fixture, settle } = await render();
    read.mockReturnValueOnce(pending);
    fixture.detectChanges();

    const skeleton = element.querySelectorAll('[aria-hidden="true"].skeleton');
    expect(skeleton).toHaveLength(3);
    expect(switches(element)).toHaveLength(0);

    resolve(answer([owner()]));
    await settle();
    expect(element.querySelectorAll('.skeleton')).toHaveLength(0);
  });

  // @traces 198-FR-012
  it('shows each section with one row per type and a switch per channel, named by type and channel', async () => {
    const { element, settle } = await render();
    await settle();

    expect(
      [...element.querySelectorAll('h3')].map((h) => h.textContent?.trim()),
    ).toEqual(['Cereri și oferte', 'Programări', 'Cont și verificare']);
    expect(text(element)).toContain('Cerere de ofertă nouă');
    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual([
      'Cerere de ofertă nouă, E‑mail',
      'Cerere de ofertă nouă, Push',
      'Cerere de ofertă nouă, WhatsApp',
      'Rezultatul verificării, E‑mail',
      'Rezultatul verificării, Push',
      'Rezultatul verificării, WhatsApp',
    ]);
    const email = named(element, 'Cerere de ofertă nouă, E‑mail');
    expect(email?.getAttribute('aria-checked')).toBe('true');
    expect(email?.disabled).toBe(false);
    // Each switch has its channel written beside it, not only in its name.
    const row = email?.closest('li');
    expect(text(row as HTMLElement)).toContain('E‑mail');
    expect(text(row as HTMLElement)).toContain('Push');
    expect(text(row as HTMLElement)).toContain('WhatsApp');
  });

  // @traces 198-FR-012
  it('labels each switch by its own label, never by another switch’s', async () => {
    const { element, settle } = await render();
    await settle();

    const labels = switches(element).map((s) =>
      s.getAttribute('aria-labelledby'),
    );
    expect(new Set(labels).size).toBe(labels.length);
    for (const control of switches(element)) {
      const id = control.getAttribute('aria-labelledby');
      const label = id ? element.querySelector(`[id="${id}"]`) : null;
      expect(label?.contains(control)).toBe(true);
    }
  });

  // @traces 198-FR-012
  it('says a type with no outside channel is shown in the app only', async () => {
    const { element, settle } = await render();
    await settle();

    const row = [...element.querySelectorAll('li')].find((li) =>
      li.textContent?.includes('Foaia zilei s‑a schimbat'),
    );
    expect(row?.querySelector('button[role="switch"]')).toBeNull();
    expect(text(row as HTMLElement)).toContain('Doar în aplicație');
  });

  // @traces 198-FR-013
  it('shows a locked switch on and disabled, and says it is always sent', async () => {
    const { element, settle } = await render();
    await settle();

    const locked = named(element, 'Rezultatul verificării, E‑mail');
    expect(locked?.getAttribute('aria-checked')).toBe('true');
    expect(locked?.disabled).toBe(true);
    expect(describedBy(element, locked as HTMLElement)).toContain(
      'Se trimite mereu',
    );
    expect(named(element, 'Rezultatul verificării, Push')?.disabled).toBe(
      false,
    );
  });

  // @traces 198-FR-013
  it.each([
    ['garage_whatsapp_off', 'WhatsApp este oprit pentru acest service'],
    ['phone_not_verified', 'Adaugă un număr de telefon verificat'],
  ] as const)(
    'turns the WhatsApp switches off and disabled when %s, and says why',
    async (reason, line) => {
      const entry = owner({ whatsapp: { available: false, reason } });
      // A saved WhatsApp choice is still shown off while it cannot be used.
      entry.sections[0].types[0].channels[2].enabled = true;
      const { element, settle } = await render([entry]);
      await settle();

      const whatsapp = named(element, 'Cerere de ofertă nouă, WhatsApp');
      expect(whatsapp?.getAttribute('aria-checked')).toBe('false');
      expect(whatsapp?.disabled).toBe(true);
      expect(describedBy(element, whatsapp as HTMLElement)).toContain(line);
      expect(text(element)).toContain(line);
      expect(named(element, 'Cerere de ofertă nouă, Push')?.disabled).toBe(
        false,
      );
    },
  );

  // @traces 198-FR-014
  it('saves a toggle at once with its garage, and keeps it when the save succeeds', async () => {
    const { element, settle } = await render();
    await settle();
    const saved = owner();
    saved.sections[0].types[0].channels[1].enabled = false;
    let done: (value: NotificationPreferencesDto) => void = () => undefined;
    save.mockReturnValueOnce(
      new Promise<NotificationPreferencesDto>((r) => {
        done = r;
      }),
    );

    named(element, 'Cerere de ofertă nouă, Push')?.click();
    await settle();

    expect(save).toHaveBeenCalledWith({
      body: {
        preferences: [
          {
            channel: 'push',
            enabled: false,
            garageId: GARAGE,
            type: 'REQUEST_RECEIVED',
          },
        ],
      },
    });
    // Optimistic: off before the answer.
    expect(
      named(element, 'Cerere de ofertă nouă, Push')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('false');

    done(answer([saved]));
    await settle();
    expect(
      named(element, 'Cerere de ofertă nouă, Push')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
    expect(toast).not.toHaveBeenCalled();
  });

  // @traces 198-FR-014
  it('keeps a second toggle when the first save answers after it', async () => {
    const { element, settle } = await render();
    await settle();
    let first: (value: NotificationPreferencesDto) => void = () => undefined;
    save.mockReturnValueOnce(
      new Promise<NotificationPreferencesDto>((r) => {
        first = r;
      }),
    );
    save.mockReturnValueOnce(new Promise(() => undefined));
    const before = owner();

    named(element, 'Cerere de ofertă nouă, Push')?.click();
    await settle();
    named(element, 'Cerere de ofertă nouă, E‑mail')?.click();
    await settle();
    // The first save's answer knows nothing of the second toggle.
    before.sections[0].types[0].channels[1].enabled = false;
    first(answer([before]));
    await settle();

    expect(
      named(element, 'Cerere de ofertă nouă, E‑mail')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
  });

  // @traces 198-FR-014
  it('puts the switch back and says so when the save fails', async () => {
    jest.mocked(toast).mockClear();
    const { element, settle } = await render();
    await settle();
    save.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'last_channel' },
        status: 422,
      }),
    );

    named(element, 'Cerere de ofertă nouă, E‑mail')?.click();
    await settle();

    expect(
      named(element, 'Cerere de ofertă nouă, E‑mail')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
  });

  // @traces 198-FR-014
  it('offers to try again when the lists cannot be read, and reads again', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));
    await settle();

    expect(text(element)).toContain('Nu am putut încărca setările');
    const retry = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Reîncearcă',
    );
    expect(retry).toBeDefined();
    read.mockResolvedValueOnce(answer([owner()]));
    retry?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(switches(element)).toHaveLength(6);
    expect(text(element)).not.toContain('Nu am putut încărca setările');
  });

  // @traces 198-FR-012
  it('heads each list with its garage name when there is more than one, and the admin list with its own', async () => {
    const admin: StaffNotificationsDto = {
      garageId: null,
      garageName: null,
      role: 'admin',
      sections: [
        {
          key: 'admin',
          types: [
            {
              channels: [
                { channel: 'email', enabled: true, locked: true },
                { channel: 'push', enabled: true, locked: true },
              ],
              type: 'ADMIN_OUTAGE_ALERT',
            },
          ],
        },
      ],
      whatsapp: { available: true, reason: null },
    };
    const { element, settle } = await render([
      owner(),
      owner({ garageId: OTHER, garageName: 'Service Doi', role: 'mechanic' }),
      admin,
    ]);
    await settle();

    expect(
      [...element.querySelectorAll('h2')].map((h) => h.textContent?.trim()),
    ).toEqual(['Notificări', 'Atelier Test', 'Service Doi', 'Administrator']);
    expect(named(element, 'Alertă de întrerupere, Push')?.disabled).toBe(true);
  });

  it('shows no garage heading for a single list', async () => {
    const { element, settle } = await render();
    await settle();

    expect(
      [...element.querySelectorAll('h2')].map((h) => h.textContent?.trim()),
    ).toEqual(['Notificări']);
  });

  it('shows nothing for a person with no staff list', async () => {
    const { element, settle } = await render([]);
    await settle();

    expect(element.querySelector('section')).toBeNull();
  });

  // @traces 198-FR-015
  it('reads again on a preferences update, a feature change of a shown garage and a resync', async () => {
    jest.useFakeTimers();
    const { settle } = await render();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    events.next(event('notification_preferences.updated', 'event-1'));
    jest.advanceTimersByTime(300);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);

    events.next(event('garage.features_changed', OTHER));
    jest.advanceTimersByTime(300);
    await settle();
    expect(read).toHaveBeenCalledTimes(2);

    events.next(event('garage.features_changed', GARAGE));
    jest.advanceTimersByTime(300);
    await settle();
    expect(read).toHaveBeenCalledTimes(3);

    resync.next();
    await settle();
    expect(read).toHaveBeenCalledTimes(4);
  });

  // @traces 198-FR-015
  it('makes one read of a burst of updates', async () => {
    jest.useFakeTimers();
    const { settle } = await render();
    await settle();

    for (let i = 0; i < 5; i++)
      events.next(event('notification_preferences.updated', `event-${i}`));
    jest.advanceTimersByTime(300);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  // @traces 198-FR-016
  it('speaks English', async () => {
    const { element, settle } = await render(
      [owner({ whatsapp: { available: false, reason: 'phone_not_verified' } })],
      'en',
    );
    await settle();

    expect(
      [...element.querySelectorAll('h3')].map((h) => h.textContent?.trim()),
    ).toEqual(['Requests and quotes', 'Bookings', 'Account and verification']);
    expect(named(element, 'New quote request, Email')).toBeDefined();
    expect(text(element)).toContain('Always sent');
    expect(text(element)).toContain('In the app only');
    expect(text(element)).toContain('Add a verified phone number');
  });
});
