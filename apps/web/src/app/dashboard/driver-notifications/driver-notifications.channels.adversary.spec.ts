import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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

type Channel = 'email' | 'push' | 'sms' | 'whatsapp';
const EPSW: Channel[] = ['email', 'push', 'sms', 'whatsapp'];
const EPW: Channel[] = ['email', 'push', 'whatsapp'];
const KEYS = ['offers', 'bookings', 'due_dates', 'news', 'reviews_history'];
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

const HINT = 'Adaugă și confirmă numărul de telefon în Datele tale.';
const USAGE =
  'Ai folosit 5 din 5 SMS luna aceasta; următoarele merg pe WhatsApp.';

const full = (
  options: {
    phoneVerified?: boolean;
    pushDevice?: boolean;
    used?: number;
    chosen?: Partial<Record<string, Channel>>;
    extraTypes?: Record<string, string[]>;
  } = {},
) => {
  const types = { ...GROUP_TYPES };
  for (const [key, extra] of Object.entries(options.extraTypes ?? {})) {
    types[key] = [...types[key], ...extra];
  }
  return {
    groups: KEYS.map((key) => ({
      enabled: key !== 'news',
      key,
      types: types[key],
    })),
    newsConsent: {
      currentTextVersion: '2026-10-03',
      givenAt: null,
      state: 'none',
      textVersion: null,
      withdrawnAt: null,
    },
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
    staff: [],
  } as unknown as NotificationPreferencesDto;
};

let read: jest.Mock;
let save: jest.Mock;
let push: {
  state: ReturnType<typeof signal<PushState>>;
  refresh: jest.Mock;
  enable: jest.Mock;
};

async function render(
  first: NotificationPreferencesDto,
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(async () => first);
  save = jest.fn(async () => first);
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
      {
        provide: Live,
        useValue: { events: new Subject(), resync: new Subject() },
      },
      { provide: Overlays, useValue: { open: jest.fn(async () => true) } },
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
const times = (text: string | null | undefined, part: string) =>
  (text ?? '').split(part).length - 1;

async function opened(
  keys: string[],
  first: NotificationPreferencesDto = full(),
  language: 'ro' | 'en' = 'ro',
) {
  const rendered = await render(first, language);
  for (const key of keys) {
    disclosure(rendered.element, key).click();
    await rendered.settle();
  }
  return rendered;
}

afterEach(() => jest.clearAllMocks());

// @traces 142-FR-002
describe('the channel pickers under odd clicks', () => {
  it('does not save when the channel already chosen is picked again', async () => {
    const { element, settle } = await opened(['due_dates']);

    labelOf(groupOf(element, 'ITP'), 'email').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(checked(groupOf(element, 'ITP'))).toBe('email');
  });

  it('saves two types picked one after the other as two saves, each with its own type', async () => {
    const { element, settle } = await opened(['due_dates']);

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    labelOf(groupOf(element, 'RCA'), 'sms').click();
    await settle();

    expect(save.mock.calls.map(([call]) => call.body.preferences)).toEqual([
      [{ channel: 'whatsapp', enabled: true, garageId: null, type: 'DUE_ITP' }],
      [{ channel: 'sms', enabled: true, garageId: null, type: 'DUE_RCA' }],
    ]);
    expect(checked(groupOf(element, 'ITP'))).toBe('whatsapp');
    expect(checked(groupOf(element, 'RCA'))).toBe('sms');
  });

  it('puts only the failed type back when one of two saves fails', async () => {
    const { element, settle } = await opened(['due_dates']);
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    labelOf(groupOf(element, 'RCA'), 'sms').click();
    await settle();

    expect(checked(groupOf(element, 'ITP'))).toBe('email');
    expect(checked(groupOf(element, 'RCA'))).toBe('sms');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when a disabled SMS option is clicked without a confirmed phone', async () => {
    const { element, settle } = await opened(
      ['due_dates'],
      full({ phoneVerified: false }),
    );

    labelOf(groupOf(element, 'ITP'), 'sms').click();
    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(checked(groupOf(element, 'ITP'))).toBe('email');
  });

  it('renders a type whose saved channel the catalogue no longer lists without throwing', async () => {
    const { element } = await opened(
      ['offers'],
      full({ chosen: { QUOTE_RECEIVED: 'sms' } }),
    );

    const quote = region(element, 'offers')!.querySelectorAll(
      '[role="radiogroup"]',
    );
    expect(quote).toHaveLength(2);
    expect(
      region(element, 'offers')!.querySelectorAll('input[value="sms"]'),
    ).toHaveLength(0);
  });

  it('keeps showing the other types when the group names a type the panel has no name for', async () => {
    const first = full({ extraTypes: { due_dates: ['FUTURE_TYPE'] } });
    const { element } = await opened(['due_dates'], first);

    expect(groupOf(element, 'ITP')).not.toBeNull();
    expect(groupOf(element, 'RCA')).not.toBeNull();
  });
});

// @traces 142-FR-003 142-FR-007
describe('the phone hint and disabled options', () => {
  it('shows a saved SMS choice as checked and disabled once the phone is unconfirmed', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ chosen: { DUE_ITP: 'sms' }, phoneVerified: false }),
    );

    const itp = groupOf(element, 'ITP');
    expect(checked(itp)).toBe('sms');
    expect(radio(itp, 'sms').disabled).toBe(true);
    expect(radio(itp, 'whatsapp').disabled).toBe(true);
  });

  it('disables WhatsApp and says why once under Ofertă nouă, which has no SMS', async () => {
    const { element } = await opened(
      ['offers'],
      full({ phoneVerified: false }),
    );

    const area = region(element, 'offers');
    expect(times(area?.textContent, HINT)).toBe(1);
    expect(
      [
        ...area!.querySelectorAll<HTMLInputElement>('input[value="whatsapp"]'),
      ].map((i) => i.disabled),
    ).toEqual([true, true]);
  });

  it('says it once under every opened group, not once for the panel', async () => {
    const { element } = await opened(
      ['offers', 'bookings', 'due_dates', 'reviews_history'],
      full({ phoneVerified: false }),
    );

    for (const key of ['offers', 'bookings', 'due_dates', 'reviews_history']) {
      expect([key, times(region(element, key)?.textContent, HINT)]).toEqual([
        key,
        1,
      ]);
    }
  });

  it('shows no hint and no picker under the news group, with no phone', async () => {
    const { element } = await opened(['news'], full({ phoneVerified: false }));

    expect(
      region(element, 'news')?.querySelector('[role="radiogroup"]'),
    ).toBeNull();
    expect(region(element, 'news')?.textContent).not.toContain(HINT);
  });

  it('shows no hint in a closed group', async () => {
    const { element } = await render(full({ phoneVerified: false }));

    expect(region(element, 'due_dates')).toBeNull();
    expect(element.textContent).not.toContain(HINT);
  });

  it('closes a group on a second tap of its disclosure', async () => {
    const { element, settle } = await opened(['due_dates']);
    expect(disclosure(element, 'due_dates').getAttribute('aria-expanded')).toBe(
      'true',
    );

    disclosure(element, 'due_dates').click();
    await settle();

    expect(disclosure(element, 'due_dates').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(region(element, 'due_dates')).toBeNull();
  });
});

// @traces 142-FR-004
describe('the SMS usage line', () => {
  it('shows once under Programare and once under Scadențe at 5 of 5, and under no other group', async () => {
    const { element } = await opened(
      ['offers', 'bookings', 'due_dates', 'reviews_history', 'news'],
      full({ used: 5 }),
    );

    expect(times(region(element, 'bookings')?.textContent, USAGE)).toBe(1);
    expect(times(region(element, 'due_dates')?.textContent, USAGE)).toBe(1);
    for (const key of ['offers', 'reviews_history', 'news']) {
      expect(region(element, key)?.textContent).not.toContain(USAGE);
    }
  });

  it('shows nothing at 0, 1 and 4', async () => {
    for (const used of [0, 1, 4]) {
      TestBed.resetTestingModule();
      const { element } = await opened(['due_dates'], full({ used }));
      expect([
        used,
        region(element, 'due_dates')?.textContent?.includes('Ai folosit'),
      ]).toEqual([used, false]);
    }
  });

  it('shows no usage line in a closed group', async () => {
    const { element } = await render(full({ used: 5 }));

    expect(element.textContent).not.toContain('Ai folosit');
  });
});

// @traces 142-FR-006
describe('picking push in a browser that fails in odd ways', () => {
  it('keeps the channel and saves nothing when the browser step throws', async () => {
    const { element, settle } = await opened(['due_dates']);
    push.enable.mockRejectedValueOnce(new Error('denied'));

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(checked(groupOf(element, 'ITP'))).toBe('email');
  });

  it.each(['off', 'blocked', 'unsupported', 'ios-hint'] as const)(
    'saves push when the browser ends %s but the account has a push device',
    async (state) => {
      const { element, settle } = await opened(
        ['due_dates'],
        full({ pushDevice: true }),
      );
      push.state.set(state);
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

  it('saves with no prompt when this browser is already a saved device', async () => {
    const { element, settle } = await opened(['due_dates']);
    push.state.set('on');

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(push.enable).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('puts the channel back and shows the toast when the save fails after the browser allowed', async () => {
    const { element, settle } = await opened(['due_dates']);
    push.enable.mockImplementationOnce(async () => push.state.set('on'));
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(checked(groupOf(element, 'ITP'))).toBe('email');
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
  });

  it('shows the refusal hint under the picker that was refused and not under the next one', async () => {
    const { element, settle } = await opened(['due_dates']);
    push.enable.mockImplementationOnce(async () =>
      push.state.set('unsupported'),
    );

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    const hint = 'Acest browser nu poate primi notificări.';
    expect(times(region(element, 'due_dates')?.textContent, hint)).toBe(1);
    expect(
      groupOf(element, 'RCA').nextElementSibling?.textContent ?? '',
    ).not.toContain(hint);
  });

  it('asks the browser again on a second pick after a refusal', async () => {
    const { element, settle } = await opened(['due_dates']);

    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();
    labelOf(groupOf(element, 'ITP'), 'push').click();
    await settle();

    expect(push.enable).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});

// @traces 142-FR-007
describe('the pickers in English', () => {
  it('says the phone hint once under Ofertă nouă in English', async () => {
    const { element } = await opened(
      ['offers'],
      full({ phoneVerified: false }),
      'en',
    );

    expect(
      times(
        region(element, 'offers')?.textContent,
        'Add and confirm your phone number in Your details.',
      ),
    ).toBe(1);
    expect(region(element, 'offers')?.textContent).not.toContain('Adaugă');
  });
});
