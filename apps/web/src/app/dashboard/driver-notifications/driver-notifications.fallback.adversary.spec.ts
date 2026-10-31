import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationPreferencesDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
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

type Fallback = unknown;
const fb = (
  reason: string,
  from: string = 'sms',
  to: string = 'email',
): Fallback => ({ at: '2026-10-30T10:00:00.000Z', from, reason, to });

const full = (
  fallbacks: Record<string, Fallback> = {},
  chosen: Partial<Record<string, Channel>> = {},
  omit = false,
) => {
  const groups = KEYS.map((key) => ({
    enabled: key !== 'news',
    key,
    types: GROUP_TYPES[key],
  }));
  return {
    groups,
    newsConsent: {
      currentTextVersion: '2026-10-03',
      givenAt: null,
      state: 'none',
      textVersion: null,
      withdrawnAt: null,
    },
    phoneVerified: true,
    preferences: Object.entries(CHANNELS).map(([type, channels]) => ({
      alwaysSent: type === 'JOB_READY',
      channel: chosen[type] ?? 'email',
      channels,
      enabled: type !== 'NEWS',
      garageId: null,
      type,
      ...(omit && !(type in fallbacks)
        ? {}
        : { fallback: fallbacks[type] ?? null }),
    })),
    pushDevice: false,
    sms: { cap: 5, used: 0 },
    staff: [],
  } as unknown as NotificationPreferencesDto;
};

const updated = {
  at: '2026-10-08T10:00:00.000Z',
  id: 'a',
  kind: 'notification_preferences.updated',
} as LiveMessage;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

let read: jest.Mock;
let save: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;
let push: {
  state: ReturnType<typeof signal<PushState>>;
  refresh: jest.Mock;
  enable: jest.Mock;
};

async function render(
  first: NotificationPreferencesDto,
  language: 'ro' | 'en' = 'en',
) {
  read = jest.fn(async () => first);
  save = jest.fn(async () => first);
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
const groupOf = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLElement>(
    `[role="radiogroup"][aria-label="${name}"]`,
  ) as HTMLElement;
const labelOf = (group: HTMLElement, channel: Channel) =>
  group.querySelector<HTMLLabelElement>(
    `label[for="${group.querySelector<HTMLInputElement>(`input[value="${channel}"]`)!.id}"]`,
  ) as HTMLLabelElement;
const hintOf = (element: HTMLElement, type: string) =>
  element.querySelector<HTMLElement>(
    `#driver-notifications-${type}-fallback-hint`,
  );
const allHints = (element: HTMLElement) =>
  element.querySelectorAll('[id$="-fallback-hint"]');
const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function opened(
  keys: string[],
  first: NotificationPreferencesDto,
  language: 'ro' | 'en' = 'en',
) {
  const rendered = await render(first, language);
  for (const key of keys) {
    disclosure(rendered.element, key).click();
    await rendered.settle();
  }
  return rendered;
}

const lateRead = async (settle: () => Promise<void>) => {
  events.next(updated);
  await new Promise((resolve) => setTimeout(resolve, 350));
  await settle();
};

afterEach(() => jest.clearAllMocks());

// @traces 1415-FR-002
describe('the fallback hint with values the panel does not know', () => {
  it.each([
    ['an unknown reason', fb('weird')],
    ['an unknown from', fb('no_device', 'telegram', 'email')],
    ['an unknown to', fb('no_device', 'sms', 'telegram')],
    ['an inherited property name as reason', fb('constructor')],
    ['an inherited property name as reason toString', fb('toString')],
    ['a proto reason', fb('__proto__')],
    [
      'an inherited property name as from',
      fb('send_failed', 'constructor', 'email'),
    ],
    [
      'an inherited property name as to',
      fb('no_device', 'sms', 'hasOwnProperty'),
    ],
    ['a reason in capitals', fb('NO_DEVICE')],
    ['a reason with trailing space', fb('no_device ')],
    ['a numeric reason', fb(5 as unknown as string)],
    ['a missing reason', { from: 'sms', to: 'email' }],
    ['a missing to', { from: 'sms', reason: 'no_device' }],
    ['an empty object', {}],
    ['a string', 'no_device'],
    ['a number', 7],
    ['an array', ['no_device']],
    ['a boolean true', true],
  ])('shows no hint and keeps the picker for %s', async (_title, fallback) => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fallback }),
    );

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(groupOf(element, 'ITP').querySelectorAll('input')).toHaveLength(4);
    expect(groupOf(element, 'ITP').getAttribute('aria-describedby')).toBeNull();
    expect(groupOf(element, 'RCA')).not.toBeNull();
  });

  it('gives a WhatsApp send_failed the phone number advice', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('send_failed', 'whatsapp', 'email') }),
    );

    expect(text(hintOf(element, 'DUE_ITP'))).toBe(
      'The last message came by E-mail: sending by WhatsApp failed. Check your phone number in Your details.',
    );
  });

  it('shows an unknown reason on one type and a known one on its neighbour', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({
        DUE_ITP: fb('weird'),
        DUE_RCA: fb('sms_cap_reached', 'sms', 'whatsapp'),
      }),
    );

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(text(hintOf(element, 'DUE_RCA'))).toBe(
      "The last message came by WhatsApp: you have used this month's SMS.",
    );
  });

  it('does not show the raw fallback fields or the time anywhere', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('no_device', 'sms', 'email') }),
    );

    const shown = text(hintOf(element, 'DUE_ITP'));
    expect(shown).not.toMatch(/2026|undefined|\{to\}|\{from\}|no_device/);
  });
});

// @traces 1415-FR-001 1415-FR-005
describe('the fallback hint with the field null, absent or on the wrong entries', () => {
  it('shows nothing when no entry carries the field at all', async () => {
    const { element } = await opened(
      ['due_dates', 'offers', 'bookings'],
      full({}, {}, true),
    );

    expect(allHints(element)).toHaveLength(0);
  });

  it('shows the hint for a type whose neighbour has no field', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('no_device', 'push', 'email') }, {}, true),
    );

    expect(allHints(element)).toHaveLength(1);
    expect(groupOf(element, 'ITP').getAttribute('aria-describedby')).toBe(
      'driver-notifications-DUE_ITP-fallback-hint',
    );
    expect(groupOf(element, 'RCA').getAttribute('aria-describedby')).toBeNull();
  });

  it('shows no hint for a type inside a closed group', async () => {
    const { element } = await render(
      full({ DUE_ITP: fb('no_device', 'push', 'email') }),
    );

    expect(allHints(element)).toHaveLength(0);
  });

  it('shows the hint again after a group is closed and reopened', async () => {
    const { element, settle } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('no_device', 'push', 'email') }),
    );
    disclosure(element, 'due_dates').click();
    await settle();
    expect(allHints(element)).toHaveLength(0);

    disclosure(element, 'due_dates').click();
    await settle();

    expect(allHints(element)).toHaveLength(1);
  });

  it('shows one hint per type that carries one, each with its own text', async () => {
    const { element } = await opened(
      ['due_dates', 'offers'],
      full({
        DUE_ITP: fb('no_device', 'push', 'email'),
        DUE_RCA: fb('phone_not_verified', 'sms', 'email'),
        QUOTE_RECEIVED: fb('send_failed', 'push', 'email'),
      }),
    );

    expect(allHints(element)).toHaveLength(3);
    expect(text(hintOf(element, 'DUE_RCA'))).toBe(
      'The last message came by E-mail: your phone number is not confirmed. Confirm it in Your details.',
    );
    expect(text(hintOf(element, 'QUOTE_RECEIVED'))).toBe(
      'The last message came by E-mail: sending by Push failed. Allow notifications in this browser.',
    );
  });

  it('shows the hint under the one-channel news type even when its group is off, with no description', async () => {
    const { element } = await opened(
      ['news'],
      full({ NEWS: fb('no_device', 'push', 'email') }),
    );

    const hint = hintOf(element, 'NEWS');
    expect(text(hint)).toContain('The last message came by E-mail');
    expect(
      element.querySelectorAll('[aria-describedby$="NEWS-fallback-hint"]'),
    ).toHaveLength(0);
    const column = hint!.parentElement!;
    expect(column.lastElementChild).toBe(hint);
    expect(hint!.previousElementSibling?.classList.contains('channel')).toBe(
      true,
    );
  });

  it('puts the hint last in the type column, after the picker', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('no_device', 'push', 'email') }),
    );

    const hint = hintOf(element, 'DUE_ITP')!;
    expect(hint.parentElement!.lastElementChild).toBe(hint);
    expect(hint.tagName).toBe('P');
    expect(hint.classList.contains('hint')).toBe(true);
    expect(hint.getAttribute('role')).toBeNull();
    expect(hint.getAttribute('aria-live')).toBeNull();
  });

  it('renders the same-channel case as given', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('send_failed', 'email', 'email') }),
    );

    expect(text(hintOf(element, 'DUE_ITP'))).toBe(
      'The last message came by E-mail: sending by E-mail failed. Check your e-mail address in Your details.',
    );
  });
});

// @traces 1415-FR-002
describe('the fallback hint in Romanian', () => {
  it('writes the Romanian text with U+2011 hyphens and the Romanian channel labels', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('sms_cap_reached', 'sms', 'whatsapp') }),
      'ro',
    );

    expect(text(hintOf(element, 'DUE_ITP'))).toBe(
      'Ultimul mesaj a venit pe WhatsApp: ai folosit toate SMS‑urile lunii.',
    );
  });

  it('writes the Romanian send_failed advice by the failed channel', async () => {
    const { element } = await opened(
      ['due_dates'],
      full({ DUE_ITP: fb('send_failed', 'email', 'push') }),
      'ro',
    );

    expect(text(hintOf(element, 'DUE_ITP'))).toBe(
      'Ultimul mesaj a venit pe Push: trimiterea pe E\u2011mail a eșuat. Verifică adresa de e‑mail în Datele tale.',
    );
  });
});

// @traces 1415-FR-003
describe('the fallback hint when picks and reads overlap', () => {
  const withHints = () =>
    full({
      DUE_ITP: fb('no_device', 'push', 'email'),
      DUE_RCA: fb('phone_not_verified', 'sms', 'email'),
    });

  it('removes only the picked type hint on a saved pick', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(hintOf(element, 'DUE_RCA')).not.toBeNull();
    expect(groupOf(element, 'ITP').getAttribute('aria-describedby')).toBeNull();
    expect(groupOf(element, 'RCA').getAttribute('aria-describedby')).toBe(
      'driver-notifications-DUE_RCA-fallback-hint',
    );
  });

  it('removes the hint without a re-read', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    const reads = read.mock.calls.length;

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(read).toHaveBeenCalledTimes(reads);
  });

  it('keeps the hint while the save is still pending', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    const pending = deferred<NotificationPreferencesDto>();
    save.mockReturnValueOnce(pending.promise);

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
    pending.resolve(withHints());
    await settle();
    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('keeps the hint when the save fails', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
  });

  it('keeps the hint when the save answers 500 with an error object', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    save.mockRejectedValueOnce({ status: 500 });

    labelOf(groupOf(element, 'ITP'), 'sms').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
  });

  it('keeps the hint when the push pick is refused before any save', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    push.enable.mockRejectedValueOnce(new Error('denied'));

    labelOf(groupOf(element, 'RCA'), 'push').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(hintOf(element, 'DUE_RCA')).not.toBeNull();
  });

  it('shows the push hint first and the fallback hint after it in the description on a refused push pick', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    push.state.set('denied' as PushState);
    push.enable.mockImplementationOnce(async () =>
      push.state.set('denied' as PushState),
    );

    labelOf(groupOf(element, 'RCA'), 'push').click();
    await settle();

    expect(groupOf(element, 'RCA').getAttribute('aria-describedby')).toBe(
      'driver-notifications-DUE_RCA-push-hint driver-notifications-DUE_RCA-fallback-hint',
    );
    const p = element.querySelector('#driver-notifications-DUE_RCA-push-hint')!;
    expect(p.nextElementSibling).toBe(hintOf(element, 'DUE_RCA'));
  });

  it('keeps a removed hint removed through a later failed save of the same type', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'sms').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('removes the hint when a first pick fails and the second pick of the same type saves', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    labelOf(groupOf(element, 'ITP'), 'sms').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('removes the hint when a first pick saves and the second pick of the same type fails', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    save.mockResolvedValueOnce(withHints());
    save.mockRejectedValueOnce(new Error('down'));

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    labelOf(groupOf(element, 'ITP'), 'sms').click();
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('keeps a removed hint removed when ten picks of the same type save in a row', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());

    const order: Channel[] = ['whatsapp', 'sms', 'push', 'email'];
    push.state.set('on');
    for (let i = 0; i < 10; i++) {
      labelOf(groupOf(element, 'ITP'), order[i % 4]).click();
    }
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(hintOf(element, 'DUE_RCA')).not.toBeNull();
  });

  it('shows the hint the next read gives after a pick removed it', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();
    expect(hintOf(element, 'DUE_ITP')).toBeNull();

    await lateRead(settle);

    expect(text(hintOf(element, 'DUE_ITP'))).toContain(
      'The last message came by E-mail',
    );
  });

  it('shows a changed hint and removes a gone one after a live re-read', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    read.mockResolvedValueOnce(
      full({ DUE_RCA: fb('sms_cap_reached', 'sms', 'push') }),
    );

    await lateRead(settle);

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(text(hintOf(element, 'DUE_RCA'))).toBe(
      "The last message came by Push: you have used this month's SMS.",
    );
  });

  it('refreshes the hints on a resync read', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    read.mockResolvedValueOnce(full({}));

    resync.next();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(allHints(element)).toHaveLength(0);
  });

  it('keeps the hints when a live re-read fails', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    read.mockRejectedValueOnce(new Error('down'));

    await lateRead(settle);

    expect(allHints(element)).toHaveLength(2);
  });

  it('shows a hint the live re-read adds to a type that had none', async () => {
    const { element, settle } = await opened(['due_dates'], full());
    read.mockResolvedValueOnce(withHints());

    await lateRead(settle);

    expect(allHints(element)).toHaveLength(2);
  });

  it('drops a hint when a live re-read answers with the field absent', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    read.mockResolvedValueOnce(full({}, {}, true));

    await lateRead(settle);

    expect(allHints(element)).toHaveLength(0);
  });

  it('drops a hint when a live re-read answers with an unknown reason', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    read.mockResolvedValueOnce(full({ DUE_ITP: fb('weird') }));

    await lateRead(settle);

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    expect(groupOf(element, 'ITP')).not.toBeNull();
  });

  it('does not bring back a removed hint from a read that began before the pick saved, if it completes after the save', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    const slowRead = deferred<NotificationPreferencesDto>();
    read.mockReturnValueOnce(slowRead.promise);
    events.next(updated);
    await new Promise((resolve) => setTimeout(resolve, 350));

    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();
    expect(hintOf(element, 'DUE_ITP')).toBeNull();
    slowRead.resolve(withHints());
    await settle();

    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('shows what the read gives when the read completes after the save and says null', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    const slowRead = deferred<NotificationPreferencesDto>();
    read.mockReturnValueOnce(slowRead.promise);
    events.next(updated);
    await new Promise((resolve) => setTimeout(resolve, 350));
    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();

    slowRead.resolve(
      full({ DUE_RCA: fb('phone_not_verified', 'sms', 'email') }),
    );
    await settle();

    expect(allHints(element)).toHaveLength(1);
    expect(hintOf(element, 'DUE_RCA')).not.toBeNull();
  });

  it('keeps the other types hint when the picked type save settles after a live read', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());
    const pending = deferred<NotificationPreferencesDto>();
    save.mockReturnValueOnce(pending.promise);
    labelOf(groupOf(element, 'ITP'), 'whatsapp').click();
    await settle();
    read.mockResolvedValueOnce(withHints());

    await lateRead(settle);
    pending.resolve(withHints());
    await settle();

    expect(hintOf(element, 'DUE_RCA')).not.toBeNull();
    expect(hintOf(element, 'DUE_ITP')).toBeNull();
  });

  it('picking the channel already chosen does not remove the hint', async () => {
    const { element, settle } = await opened(['due_dates'], withHints());

    labelOf(groupOf(element, 'ITP'), 'email').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(hintOf(element, 'DUE_ITP')).not.toBeNull();
  });
});
