import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationPreferencesDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { DriverNotifications } from './driver-notifications';
import { Live } from '../live';
import { PushDevice, type PushState } from '../push-device';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const KEYS = ['offers', 'bookings', 'due_dates', 'news', 'reviews_history'];
const TITLES = [
  'Ofertă nouă',
  'Programare',
  'Scadențe',
  'Noutăți MotorFix',
  'Recenzii și istoric',
];

const answer = (
  enabled: Partial<Record<string, boolean>> = {},
  version = '2026-10-03',
) =>
  ({
    groups: KEYS.map((key) => ({
      enabled: enabled[key] ?? key !== 'news',
      key,
      types: [],
    })),
    newsConsent: {
      currentTextVersion: version,
      givenAt: null,
      state: 'none',
      textVersion: null,
      withdrawnAt: null,
    },
    phoneVerified: false,
    preferences: [],
    pushDevice: false,
    sms: { cap: 5, used: 0 },
    staff: [],
  }) as unknown as NotificationPreferencesDto;

let read: jest.Mock;
let save: jest.Mock;
let open: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;
let push: {
  state: ReturnType<typeof signal<PushState>>;
  refresh: jest.Mock;
  enable: jest.Mock;
};

async function render(
  first: Promise<NotificationPreferencesDto> = Promise.resolve(answer()),
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(() => first);
  save = jest.fn(async () => answer());
  open = jest.fn(async () => true);
  events = new Subject();
  resync = new Subject();
  push = {
    enable: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    state: signal<PushState>('off'),
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: NotificationsService,
        useValue: {
          notificationPreferencesControllerRead: read,
          notificationPreferencesControllerSave: save,
        },
      },
      { provide: Live, useValue: { events, resync } },
      { provide: Overlays, useValue: { open } },
      { provide: PushDevice, useValue: push },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(DriverNotifications);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  await settle();
  return { element, settle };
}

const switches = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
];
const named = (element: HTMLElement, name: string) =>
  switches(element).find(
    (s) => s.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;
const isOn = (s: HTMLButtonElement) =>
  s.getAttribute('aria-checked') === 'true';
const states = (element: HTMLElement) => switches(element).map(isOn);

afterEach(() => jest.clearAllMocks());

describe('the driver notification switches', () => {
  it('shows the five groups in order, each named by its title and described by its helper line', async () => {
    const { element } = await render();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe('Notificări');
    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual(
      TITLES,
    );
    const offers = named(element, 'Ofertă nouă');
    const hint = element.querySelector(
      `#${offers.getAttribute('aria-describedby')}`,
    );
    expect(hint?.textContent?.trim()).toBe(
      'Când un service răspunde la cererea ta',
    );
    expect(element.textContent).toContain(
      'ITP, RCA, rovinietă, anvelope și revizii',
    );
  });

  it('says what is always sent under the switches', async () => {
    const { element } = await render();

    expect(element.textContent).toContain(
      'Mereu trimise: programarea confirmată, ora nouă propusă de service, programarea anulată sau expirată, mașina e gata.',
    );
  });

  it('shows the saved choices', async () => {
    const { element } = await render(
      Promise.resolve(answer({ due_dates: false, news: true })),
    );

    expect(states(element)).toEqual([true, true, false, true, true]);
  });

  it('shows the defaults, disabled, until the choices are read', async () => {
    const { element } = await render(new Promise(() => undefined));

    expect(states(element)).toEqual([true, true, true, false, true]);
    expect(switches(element).every((s) => s.disabled)).toBe(true);
  });

  it('saves only the group flipped, at once, and shows it flipped', async () => {
    const { element, settle } = await render();

    named(element, 'Scadențe').click();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      body: { groups: [{ enabled: false, key: 'due_dates' }] },
    });
    expect(isOn(named(element, 'Scadențe'))).toBe(false);
  });

  it('does not apply the choices the save answers with', async () => {
    const { element, settle } = await render();
    save.mockResolvedValueOnce(answer({ offers: false }));

    named(element, 'Scadențe').click();
    await settle();

    expect(states(element)).toEqual([true, true, false, false, true]);
  });

  it('puts the switch back and says so when the save fails', async () => {
    const { element, settle } = await render();
    save.mockRejectedValueOnce(new Error('down'));

    named(element, 'Programare').click();
    await settle();

    expect(isOn(named(element, 'Programare'))).toBe(true);
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
  });

  it('reads the choices again when they change elsewhere, and after a reconnect', async () => {
    const { settle } = await render();
    expect(read).toHaveBeenCalledTimes(1);

    events.next({
      at: '2026-10-08T10:00:00.000Z',
      id: 'a',
      kind: 'notification_preferences.updated',
    } as LiveMessage);
    // The re-read waits out a burst of events.
    await new Promise((resolve) => setTimeout(resolve, 350));
    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(3);
  });

  it('shows an error with a retry when the first read fails, and reads again on retry', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Nu am putut încărca setările',
    );
    read.mockResolvedValueOnce(answer({ offers: false }));
    (
      [...element.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Reîncearcă',
      ) as HTMLButtonElement
    ).click();
    await settle();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(states(element)).toEqual([false, true, true, false, true]);
  });

  it('keeps the switches when a later read fails', async () => {
    const { element, settle } = await render();
    read.mockRejectedValueOnce(new Error('down'));

    resync.next();
    await settle();

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(switches(element)).toHaveLength(5);
  });

  it('speaks English to an English driver', async () => {
    const { element } = await render(undefined, 'en');

    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual([
      'New offer',
      'Bookings',
      'Due dates',
      'MotorFix news',
      'Reviews and history',
    ]);
    expect(element.textContent).toContain(
      'Always sent: booking confirmed, new time proposed by the garage, booking cancelled or lapsed, car ready.',
    );
  });
});

describe('turning MotorFix news on and off', () => {
  it('asks for consent first and saves with the version shown once the driver agrees', async () => {
    const { element, settle } = await render(
      Promise.resolve(answer({}, '2026-11-01')),
    );

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(open).toHaveBeenCalledWith(expect.anything(), {
      shape: 'dialog',
      title: 'driver.notifications.consent.title',
    });
    expect(save).toHaveBeenCalledWith({
      body: {
        groups: [{ enabled: true, key: 'news' }],
        newsConsentTextVersion: '2026-11-01',
      },
    });
    expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(true);
  });

  it.each([false, 'cancelled'])(
    'saves nothing and turns it back off when the driver answers %p',
    async (reply) => {
      const { element, settle } = await render();
      open.mockResolvedValueOnce(reply);

      named(element, 'Noutăți MotorFix').click();
      await settle();

      expect(save).not.toHaveBeenCalled();
      expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(false);
    },
  );

  it('turns it off at once, with no consent step', async () => {
    const { element, settle } = await render(
      Promise.resolve(answer({ news: true })),
    );

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({
      body: { groups: [{ enabled: false, key: 'news' }] },
    });
  });

  it('reads the choices again when turning it on is refused, so the next try sends the current version', async () => {
    const { element, settle } = await render();
    save.mockRejectedValueOnce(new Error('news_consent_required'));
    read.mockResolvedValueOnce(answer({}, '2026-12-01'));

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(false);
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
    expect(read).toHaveBeenCalledTimes(2);

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(save).toHaveBeenLastCalledWith({
      body: {
        groups: [{ enabled: true, key: 'news' }],
        newsConsentTextVersion: '2026-12-01',
      },
    });
  });
});

describe('the notification hints on a phone', () => {
  // The Jest transform drops component styles, so they are read from the source.
  const css = readFileSync(
    join(__dirname, 'driver-notifications.css'),
    'utf8',
  ).replace(/\s+/g, ' ');

  it('keep body size on a phone and turn small only from a tablet up', () => {
    const topLevel = css.replace(
      /@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g,
      '',
    );
    const hint = topLevel.match(/(?:^|\})\s*\.hint\s*\{([^}]*)\}/)?.[1];
    expect(hint).toBeDefined();
    expect(hint).not.toContain('font-size');

    const tablet = css.match(
      /@media \(min-width: 768px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
    )?.[1];
    expect(tablet).toMatch(/\.hint\s*\{[^}]*font-size: var\(--mf-size-small\)/);
  });
});

type Channel = 'email' | 'push' | 'sms' | 'whatsapp';
const EPSW: Channel[] = ['email', 'push', 'sms', 'whatsapp'];
const EPW: Channel[] = ['email', 'push', 'whatsapp'];

const GROUP_TYPES: Record<string, string[]> = {
  bookings: ['BOOKING_REMINDER', 'JOB_READY'],
  due_dates: [
    'DUE_ITP',
    'DUE_RCA',
    'DUE_ROVINIETA',
    'SERVICE_DUE',
    'TYRES_SEASON',
  ],
  news: ['NEWS'],
  offers: ['QUOTE_RECEIVED', 'REQUEST_EXPIRED'],
  reviews_history: ['REVIEW_INVITE'],
};
const CHANNELS: Record<string, Channel[]> = {
  BOOKING_REMINDER: EPSW,
  DUE_ITP: EPSW,
  DUE_RCA: EPSW,
  DUE_ROVINIETA: EPSW,
  JOB_READY: EPW,
  NEWS: ['email'],
  QUOTE_RECEIVED: EPW,
  REQUEST_EXPIRED: EPW,
  REVIEW_INVITE: EPW,
  SERVICE_DUE: EPSW,
  TYRES_SEASON: EPSW,
};

const full = (
  options: {
    phoneVerified?: boolean;
    pushDevice?: boolean;
    used?: number;
    chosen?: Partial<Record<string, Channel>>;
  } = {},
) =>
  ({
    ...answer(),
    groups: KEYS.map((key) => ({
      enabled: key !== 'news',
      key,
      types: GROUP_TYPES[key],
    })),
    phoneVerified: options.phoneVerified ?? true,
    preferences: Object.entries(CHANNELS).map(([type, channels]) => ({
      alwaysSent: type === 'JOB_READY',
      channel: options.chosen?.[type] ?? 'email',
      channels,
      enabled: type !== 'NEWS',
      garageId: null,
      type,
    })),
    pushDevice: options.pushDevice ?? false,
    sms: { cap: 5, used: options.used ?? 0 },
  }) as unknown as NotificationPreferencesDto;

const disclosure = (element: HTMLElement, key: string) =>
  element.querySelector<HTMLButtonElement>(
    `button[aria-controls="driver-notifications-${key}-types"]`,
  ) as HTMLButtonElement;
const region = (element: HTMLElement, key: string) =>
  element.querySelector<HTMLElement>(`#driver-notifications-${key}-types`);
const groupOf = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLElement>(
    `[role="radiogroup"][aria-label="${name}"]`,
  ) as HTMLElement;
const options = (group: HTMLElement) =>
  [...group.querySelectorAll('label')].map((l) => l.textContent?.trim());
const radio = (group: HTMLElement, channel: Channel) =>
  group.querySelector<HTMLInputElement>(
    `input[value="${channel}"]`,
  ) as HTMLInputElement;
const labelOf = (group: HTMLElement, channel: Channel) =>
  group.querySelector<HTMLLabelElement>(
    `label[for="${radio(group, channel).id}"]`,
  ) as HTMLLabelElement;
const checked = (group: HTMLElement) =>
  group.querySelector<HTMLInputElement>('input:checked')?.value;

async function opened(
  key: string,
  first: NotificationPreferencesDto = full(),
  language: 'ro' | 'en' = 'ro',
) {
  const rendered = await render(Promise.resolve(first), language);
  disclosure(rendered.element, key).click();
  await rendered.settle();
  return rendered;
}

// @traces 142-FR-001 142-FR-007 142-FR-010
describe('the channel of each notification type', () => {
  it('sits behind a closed disclosure under each group switch', async () => {
    const { element, settle } = await render(Promise.resolve(full()));

    const button = disclosure(element, 'due_dates');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(region(element, 'due_dates')).toBeNull();
    button.click();
    await settle();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(region(element, 'due_dates')).not.toBeNull();
    button.click();
    await settle();
    expect(region(element, 'due_dates')).toBeNull();
  });

  it('lists ITP, RCA, Rovinietă, Revizie and Anvelope under Scadențe, each with E-mail, Push, SMS and WhatsApp', async () => {
    const { element } = await opened('due_dates');

    const names = [
      ...region(element, 'due_dates')!.querySelectorAll('[role="radiogroup"]'),
    ].map((g) => g.getAttribute('aria-label'));
    expect(names).toEqual(['ITP', 'RCA', 'Rovinietă', 'Revizie', 'Anvelope']);
    for (const name of names) {
      expect(options(groupOf(element, name as string))).toEqual([
        'E‑mail',
        'Push',
        'SMS',
        'WhatsApp',
      ]);
    }
  });

  it('offers only E-mail, Push and WhatsApp for the types of Ofertă nouă and for review invites', async () => {
    const { element, settle } = await opened('offers');
    disclosure(element, 'reviews_history').click();
    await settle();

    expect(options(groupOf(element, 'Ofertă nouă de la un service'))).toEqual([
      'E‑mail',
      'Push',
      'WhatsApp',
    ]);
    expect(options(groupOf(element, 'Invitație la recenzie'))).toEqual([
      'E‑mail',
      'Push',
      'WhatsApp',
    ]);
  });

  it('shows news as e-mail, with no picker', async () => {
    const { element } = await opened('news');

    const news = region(element, 'news') as HTMLElement;
    expect(news.querySelector('[role="radiogroup"]')).toBeNull();
    expect(news.textContent).toContain('Noutăți MotorFix');
    expect(news.textContent).toContain('E‑mail');
  });

  it('marks an always-sent type and still lets its channel be picked', async () => {
    const { element, settle } = await opened('bookings');

    const ready = groupOf(element, 'Mașina e gata');
    expect(region(element, 'bookings')?.textContent).toContain(
      'Se trimite mereu',
    );
    labelOf(ready, 'whatsapp').click();
    await settle();

    expect(save).toHaveBeenCalledWith({
      body: {
        preferences: [
          {
            channel: 'whatsapp',
            enabled: true,
            garageId: null,
            type: 'JOB_READY',
          },
        ],
      },
    });
  });

  it('checks the channel each type is on', async () => {
    const { element } = await opened(
      'due_dates',
      full({ chosen: { DUE_RCA: 'sms' } }),
    );

    expect(checked(groupOf(element, 'ITP'))).toBe('email');
    expect(checked(groupOf(element, 'RCA'))).toBe('sms');
  });

  it('names the types and channels in English', async () => {
    const { element } = await opened('due_dates', full(), 'en');

    expect(
      [
        ...region(element, 'due_dates')!.querySelectorAll(
          '[role="radiogroup"]',
        ),
      ].map((g) => g.getAttribute('aria-label')),
    ).toEqual(['ITP', 'RCA', 'Road vignette', 'Service', 'Tyres']);
    expect(options(groupOf(element, 'ITP'))).toEqual([
      'E-mail',
      'Push',
      'SMS',
      'WhatsApp',
    ]);
  });
});

// @traces 142-FR-002
describe('picking a channel', () => {
  it('saves that one type at once, with its enabled as read, and shows the pick', async () => {
    const { element, settle } = await opened('due_dates');

    const itp = groupOf(element, 'ITP');
    labelOf(itp, 'whatsapp').click();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      body: {
        preferences: [
          {
            channel: 'whatsapp',
            enabled: true,
            garageId: null,
            type: 'DUE_ITP',
          },
        ],
      },
    });
    expect(checked(groupOf(element, 'ITP'))).toBe('whatsapp');
  });

  it('carries a type that is off as off', async () => {
    const first = full({ pushDevice: true });
    const itp = (
      first.preferences as unknown as { type: string; enabled: boolean }[]
    ).find((p) => p.type === 'DUE_ITP');
    if (itp) itp.enabled = false;
    const { element, settle } = await opened('due_dates', first);

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(save).toHaveBeenCalledWith({
      body: {
        preferences: [
          { channel: 'push', enabled: false, garageId: null, type: 'DUE_ITP' },
        ],
      },
    });
  });

  it('puts the channel back and says so when the save fails', async () => {
    const { element, settle } = await opened('due_dates');
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'sms').click();
    await settle();

    expect(checked(groupOf(element, 'ITP'))).toBe('email');
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
  });

  it('keeps a pick in flight when the choices are read again', async () => {
    const { element, settle } = await opened('due_dates');
    save.mockReturnValueOnce(new Promise(() => undefined));
    read.mockResolvedValue(full());

    labelOf(groupOf(element, 'ITP'), 'sms').click();
    await settle();
    resync.next();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(checked(groupOf(element, 'ITP'))).toBe('sms');
  });
});

// @traces 142-FR-003 142-FR-004 142-FR-010
describe('SMS and WhatsApp', () => {
  it('cannot be picked without a confirmed phone, and the group says how to fix it once', async () => {
    const { element } = await opened(
      'due_dates',
      full({ phoneVerified: false }),
    );

    const area = region(element, 'due_dates') as HTMLElement;
    const hint = 'Adaugă și confirmă numărul de telefon în Datele tale.';
    expect(area.textContent?.split(hint)).toHaveLength(2);
    const itp = groupOf(element, 'ITP');
    for (const channel of ['sms', 'whatsapp'] as const) {
      const input = radio(itp, channel);
      expect(input.disabled).toBe(true);
      const described = element.querySelector(
        `#${input.getAttribute('aria-describedby')}`,
      );
      expect(described?.textContent?.trim()).toBe(hint);
    }
    expect(radio(itp, 'push').disabled).toBe(false);
  });

  it('says the same in English', async () => {
    const { element } = await opened(
      'due_dates',
      full({ phoneVerified: false }),
      'en',
    );

    expect(region(element, 'due_dates')?.textContent).toContain(
      'Add and confirm your phone number in Your details.',
    );
  });

  it('can be picked with a confirmed phone, and no hint shows', async () => {
    const { element } = await opened('due_dates');

    expect(radio(groupOf(element, 'ITP'), 'sms').disabled).toBe(false);
    expect(region(element, 'due_dates')?.textContent).not.toContain(
      'Adaugă și confirmă',
    );
  });

  it('says once under an opened group with SMS that the month’s 5 SMS are used, and SMS stays pickable', async () => {
    const { element, settle } = await opened('due_dates', full({ used: 5 }));
    disclosure(element, 'offers').click();
    await settle();

    const line =
      'Ai folosit 5 din 5 SMS luna aceasta; următoarele merg pe WhatsApp.';
    expect(region(element, 'due_dates')?.textContent?.split(line)).toHaveLength(
      2,
    );
    expect(region(element, 'offers')?.textContent).not.toContain(line);
    expect(radio(groupOf(element, 'ITP'), 'sms').disabled).toBe(false);
  });

  it('says nothing about SMS under the cap', async () => {
    const { element } = await opened('due_dates', full({ used: 4 }));

    expect(region(element, 'due_dates')?.textContent).not.toContain(
      'Ai folosit',
    );
  });

  it('says the SMS line in English', async () => {
    const { element } = await opened('due_dates', full({ used: 5 }), 'en');

    expect(region(element, 'due_dates')?.textContent).toContain(
      'You have used 5 of 5 SMS this month; the next ones go by WhatsApp.',
    );
  });
});

// @traces 142-FR-006 142-FR-010
describe('picking push', () => {
  it('saves with no prompt when this browser is already a device', async () => {
    push.state.set('on');
    const { element, settle } = await opened(
      'due_dates',
      full({ pushDevice: true }),
    );
    push.refresh.mockImplementationOnce(async () => push.state.set('on'));

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(push.enable).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('offers this browser too when another device is saved', async () => {
    const { element, settle } = await opened(
      'due_dates',
      full({ pushDevice: true }),
    );
    push.enable.mockImplementationOnce(async () => push.state.set('on'));

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(push.enable).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each(['off', 'blocked', 'unsupported'] as const)(
    'still saves when the browser ends %s and another device is saved',
    async (state) => {
      const { element, settle } = await opened(
        'due_dates',
        full({ pushDevice: true }),
      );
      push.enable.mockImplementationOnce(async () => push.state.set(state));

      labelOf(groupOf(element, 'ITP'), 'push').click();
      await settle();

      expect(save).toHaveBeenCalledWith({
        body: {
          preferences: [
            { channel: 'push', enabled: true, garageId: null, type: 'DUE_ITP' },
          ],
        },
      });
      expect(checked(groupOf(element, 'ITP'))).toBe('push');
    },
  );

  it('asks the browser first, and saves once this browser is a device', async () => {
    const { element, settle } = await opened('due_dates');
    push.enable.mockImplementationOnce(async () => push.state.set('on'));

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(push.refresh).toHaveBeenCalled();
    expect(push.enable).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      body: {
        preferences: [
          { channel: 'push', enabled: true, garageId: null, type: 'DUE_ITP' },
        ],
      },
    });
  });

  it.each([
    [
      'off',
      'Permite notificările când browserul te întreabă, apoi alege Push din nou.',
    ],
    [
      'blocked',
      'Notificările sunt blocate în browser. Deschide setările site‑ului, permite notificările pentru MotorFix și reîncarcă pagina.',
    ],
    ['unsupported', 'Acest browser nu poate primi notificări.'],
    [
      'ios-hint',
      'Pe iPhone sau iPad, adaugă MotorFix pe ecranul principal: apasă Partajează, apoi Adaugă pe ecranul principal. Deschide aplicația de acolo și activează notificările.',
    ],
  ] as const)(
    'keeps the channel and explains when the browser ends %s',
    async (state, hint) => {
      const { element, settle } = await opened('due_dates');
      push.enable.mockImplementationOnce(async () => push.state.set(state));
      push.refresh.mockImplementationOnce(async () =>
        push.state.set(state === 'off' ? 'off' : state),
      );

      labelOf(groupOf(element, 'ITP'), 'push').click();
      await settle();

      expect(save).not.toHaveBeenCalled();
      expect(checked(groupOf(element, 'ITP'))).toBe('email');
      expect(region(element, 'due_dates')?.textContent).toContain(hint);
      const picker = groupOf(element, 'ITP');
      const described = element.querySelector(
        `#${picker.getAttribute('aria-describedby')}`,
      );
      expect(described?.textContent).toContain(hint);
      expect(picker.nextElementSibling).toBe(described);
    },
  );
  it('says how to allow a dismissed prompt in English', async () => {
    const { element, settle } = await opened('due_dates', full(), 'en');

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(region(element, 'due_dates')?.textContent).toContain(
      'Allow notifications when the browser asks, then pick Push again.',
    );
  });
});

type Fallback = {
  from: string;
  to: string;
  reason: string;
  at?: string;
};

// A full read with one type's last message gone by another channel.
const fallen = (
  fallbacks: Record<string, Fallback | null | undefined>,
  options: Parameters<typeof full>[0] = {},
) => {
  const read = full(options);
  for (const entry of read.preferences as unknown as {
    type: string;
    fallback?: Fallback | null;
  }[]) {
    if (!(entry.type in fallbacks)) continue;
    const fallback = fallbacks[entry.type];
    if (fallback === undefined) continue;
    entry.fallback = fallback && {
      at: '2026-10-30T08:00:00.000Z',
      ...fallback,
    };
  }
  return read;
};
const hintOf = (element: HTMLElement, type: string) =>
  element.querySelector<HTMLElement>(
    `#driver-notifications-${type}-fallback-hint`,
  );
const hintText = (element: HTMLElement, type: string) =>
  hintOf(element, type)?.textContent?.trim();

// @traces 1415-FR-002 1415-FR-006
describe('the fallback hint text', () => {
  it.each([
    [
      'no_device',
      'push',
      'whatsapp',
      'ro',
      'Ultimul mesaj a venit pe WhatsApp: nu ai niciun dispozitiv cu notificări push. Permite notificările în acest browser.',
    ],
    [
      'no_device',
      'push',
      'whatsapp',
      'en',
      'The last message came by WhatsApp: you have no device with push notifications. Allow notifications in this browser.',
    ],
    [
      'phone_not_verified',
      'sms',
      'email',
      'ro',
      'Ultimul mesaj a venit pe E‑mail: numărul de telefon nu este confirmat. Confirmă‑l în Datele tale.',
    ],
    [
      'phone_not_verified',
      'sms',
      'email',
      'en',
      'The last message came by E-mail: your phone number is not confirmed. Confirm it in Your details.',
    ],
    [
      'sms_cap_reached',
      'sms',
      'whatsapp',
      'ro',
      'Ultimul mesaj a venit pe WhatsApp: ai folosit toate SMS‑urile lunii.',
    ],
    [
      'sms_cap_reached',
      'sms',
      'whatsapp',
      'en',
      "The last message came by WhatsApp: you have used this month's SMS.",
    ],
    [
      'send_failed',
      'email',
      'push',
      'ro',
      'Ultimul mesaj a venit pe Push: trimiterea pe E‑mail a eșuat. Verifică adresa de e‑mail în Datele tale.',
    ],
    [
      'send_failed',
      'email',
      'push',
      'en',
      'The last message came by Push: sending by E-mail failed. Check your e-mail address in Your details.',
    ],
    [
      'send_failed',
      'sms',
      'email',
      'ro',
      'Ultimul mesaj a venit pe E‑mail: trimiterea pe SMS a eșuat. Verifică numărul de telefon în Datele tale.',
    ],
    [
      'send_failed',
      'whatsapp',
      'email',
      'en',
      'The last message came by E-mail: sending by WhatsApp failed. Check your phone number in Your details.',
    ],
    [
      'send_failed',
      'push',
      'sms',
      'ro',
      'Ultimul mesaj a venit pe SMS: trimiterea pe Push a eșuat. Permite notificările în acest browser.',
    ],
    [
      'send_failed',
      'push',
      'email',
      'en',
      'The last message came by E-mail: sending by Push failed. Allow notifications in this browser.',
    ],
  ] as const)(
    'says why for %s from %s to %s in %s',
    async (reason, from, to, language, text) => {
      const { element } = await opened(
        'due_dates',
        fallen({ DUE_ITP: { from, reason, to } }),
        language,
      );

      expect(hintText(element, 'DUE_ITP')).toBe(text);
    },
  );

  it.each([
    ['an unknown reason', { from: 'sms', reason: 'carrier_down', to: 'email' }],
    ['an unknown from', { from: 'fax', reason: 'send_failed', to: 'email' }],
    ['an unknown to', { from: 'sms', reason: 'no_device', to: 'pigeon' }],
  ])('shows nothing for %s and keeps the panel', async (_, fallback) => {
    const { element } = await opened(
      'due_dates',
      fallen({ DUE_ITP: fallback }),
    );

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(groupOf(element, 'ITP').hasAttribute('aria-describedby')).toBe(
      false,
    );
    expect(checked(groupOf(element, 'RCA'))).toBe('email');
  });
});

// @traces 1415-FR-001 1415-FR-005 1415-FR-006
describe('where the fallback hint shows', () => {
  const smsFailed = { from: 'sms', reason: 'send_failed', to: 'email' };

  it('shows nothing for a null fallback and for a read without one', async () => {
    const { element } = await opened('due_dates', fallen({ DUE_ITP: null }));

    expect(
      region(element, 'due_dates')?.querySelector('[id$="-fallback-hint"]'),
    ).toBeNull();
  });

  it('shows the hint only under the type that carries a fallback, after its picker', async () => {
    const { element } = await opened(
      'due_dates',
      fallen({ DUE_RCA: smsFailed }),
    );

    const hints = region(element, 'due_dates')!.querySelectorAll(
      '[id$="-fallback-hint"]',
    );
    expect(hints).toHaveLength(1);
    expect(groupOf(element, 'RCA').nextElementSibling).toBe(
      hintOf(element, 'DUE_RCA'),
    );
    expect(hintOf(element, 'DUE_RCA')?.classList).toContain('hint');
    expect(groupOf(element, 'ITP').hasAttribute('aria-describedby')).toBe(
      false,
    );
  });

  it('puts the hint under the channel label of a one-channel type', async () => {
    const { element } = await opened(
      'news',
      fallen({ NEWS: { from: 'email', reason: 'send_failed', to: 'email' } }),
    );

    const hint = hintOf(element, 'NEWS') as HTMLElement;
    expect(hint.textContent?.trim()).toBe(
      'Ultimul mesaj a venit pe E‑mail: trimiterea pe E‑mail a eșuat. Verifică adresa de e‑mail în Datele tale.',
    );
    expect(hint.previousElementSibling?.classList).toContain('channel');
    expect(
      element.querySelector('[aria-describedby$="NEWS-fallback-hint"]'),
    ).toBeNull();
  });

  it('shows the hint with the group switched off', async () => {
    const read = fallen({ DUE_ITP: smsFailed });
    const group = (
      read.groups as unknown as { key: string; enabled: boolean }[]
    ).find((g) => g.key === 'due_dates');
    if (group) group.enabled = false;
    const { element } = await opened('due_dates', read);

    expect(isOn(named(element, 'Scadențe'))).toBe(false);
    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
  });

  it('is not a live region', async () => {
    const { element } = await opened(
      'due_dates',
      fallen({ DUE_ITP: smsFailed }),
    );

    const hint = hintOf(element, 'DUE_ITP') as HTMLElement;
    expect(hint.hasAttribute('role')).toBe(false);
    expect(hint.hasAttribute('aria-live')).toBe(false);
  });
});

// @traces 1415-FR-001 1415-FR-006
describe('the picker described by the fallback hint', () => {
  it('names the fallback hint alone', async () => {
    const { element } = await opened(
      'due_dates',
      fallen({ DUE_ITP: { from: 'push', reason: 'no_device', to: 'email' } }),
    );

    expect(groupOf(element, 'ITP').getAttribute('aria-describedby')).toBe(
      'driver-notifications-DUE_ITP-fallback-hint',
    );
  });

  it('names the push hint first, then the fallback hint', async () => {
    const { element, settle } = await opened(
      'due_dates',
      fallen({ DUE_ITP: { from: 'push', reason: 'no_device', to: 'email' } }),
    );
    push.enable.mockImplementationOnce(async () => push.state.set('blocked'));

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(groupOf(element, 'ITP').getAttribute('aria-describedby')).toBe(
      'driver-notifications-DUE_ITP-push-hint driver-notifications-DUE_ITP-fallback-hint',
    );
    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
  });
});

// @traces 1415-FR-003 1415-FR-006
describe('the fallback hint after a pick', () => {
  const smsFailed = { from: 'sms', reason: 'send_failed', to: 'email' };

  it('goes away at once when the pick saves, with no re-read', async () => {
    const { element, settle } = await opened(
      'due_dates',
      fallen({ DUE_ITP: smsFailed }),
    );

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(groupOf(element, 'ITP').hasAttribute('aria-describedby')).toBe(
      false,
    );
  });

  it('stays when the save fails', async () => {
    const { element, settle } = await opened(
      'due_dates',
      fallen({ DUE_ITP: smsFailed }),
    );
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
  });

  it('stays cleared when a read started before the save answers late', async () => {
    const { element, settle } = await opened(
      'due_dates',
      fallen({ DUE_ITP: smsFailed }),
    );
    let answerRead: (value: NotificationPreferencesDto) => void = () =>
      undefined;
    read.mockReturnValueOnce(
      new Promise<NotificationPreferencesDto>((resolve) => {
        answerRead = resolve;
      }),
    );
    resync.next();
    await settle();

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();
    answerRead(fallen({ DUE_ITP: smsFailed }));
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('follows a live update: changed, dropped, or back after a cleared pick', async () => {
    const { element, settle } = await opened(
      'due_dates',
      fallen({ DUE_ITP: smsFailed, DUE_RCA: smsFailed }),
    );

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();
    expect(hintOf(element, 'DUE_ITP')).toBeNull();

    read.mockResolvedValue(
      fallen(
        {
          DUE_ITP: { from: 'whatsapp', reason: 'send_failed', to: 'email' },
          DUE_RCA: null,
        },
        { chosen: { DUE_ITP: 'whatsapp' } },
      ),
    );
    resync.next();
    await settle();

    expect(hintText(element, 'DUE_ITP')).toBe(
      'Ultimul mesaj a venit pe E‑mail: trimiterea pe WhatsApp a eșuat. Verifică numărul de telefon în Datele tale.',
    );
    expect(hintOf(element, 'DUE_RCA')).toBeNull();
  });
});
