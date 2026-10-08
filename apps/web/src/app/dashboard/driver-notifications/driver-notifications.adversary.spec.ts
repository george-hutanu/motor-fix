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
    preferences: [],
    staff: [],
  }) as unknown as NotificationPreferencesDto;

let read: jest.Mock;
let save: jest.Mock;
let open: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;

async function render(
  first: Promise<NotificationPreferencesDto> = Promise.resolve(answer()),
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(() => first);
  save = jest.fn(async () => answer());
  open = jest.fn(async () => true);
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
      { provide: Live, useValue: { events, resync } },
      { provide: Overlays, useValue: { open } },
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};
const updated = {
  at: '2026-10-08T10:00:00.000Z',
  id: 'a',
  kind: 'notification_preferences.updated',
} as LiveMessage;

describe('the driver notification switches under hostile timing', () => {
  it('saves two different switches flipped in a row each on its own and shows both', async () => {
    const { element, settle } = await render();

    named(element, 'Scadențe').click();
    named(element, 'Programare').click();
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith({
      body: { groups: [{ enabled: false, key: 'due_dates' }] },
    });
    expect(save).toHaveBeenCalledWith({
      body: { groups: [{ enabled: false, key: 'bookings' }] },
    });
    expect(states(element)).toEqual([true, false, false, false, true]);
  });

  it('puts back only the switch whose save failed when another was flipped after it', async () => {
    const { element, settle } = await render();
    const first = deferred<NotificationPreferencesDto>();
    save.mockReturnValueOnce(first.promise);

    named(element, 'Scadențe').click();
    await settle();
    named(element, 'Programare').click();
    await settle();
    first.reject(new Error('down'));
    await settle();

    expect(isOn(named(element, 'Scadențe'))).toBe(true);
    expect(isOn(named(element, 'Programare'))).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('keeps a switch flipped back to its first position when the earlier save fails', async () => {
    const { element, settle } = await render();
    const first = deferred<NotificationPreferencesDto>();
    save.mockReturnValueOnce(first.promise);

    named(element, 'Scadențe').click();
    await settle();
    named(element, 'Scadențe').click();
    await settle();
    first.reject(new Error('down'));
    await settle();

    expect(save).toHaveBeenLastCalledWith({
      body: { groups: [{ enabled: true, key: 'due_dates' }] },
    });
    expect(isOn(named(element, 'Scadențe'))).toBe(true);
  });

  it('says a failed save in English to an English driver', async () => {
    const { element, settle } = await render(undefined, 'en');
    save.mockRejectedValueOnce(new Error('down'));

    named(element, 'Bookings').click();
    await settle();

    expect(isOn(named(element, 'Bookings'))).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/^[A-Za-z ,.']+$/),
    );
    expect(jest.mocked(toast).mock.calls[0][0] as string).not.toMatch(
      /[ăîșțâ]/i,
    );
  });

  it('keeps the flip shown while a live event re-read answers with older choices before the save settles', async () => {
    const { element, settle } = await render();
    const pending = deferred<NotificationPreferencesDto>();
    save.mockReturnValueOnce(pending.promise);

    named(element, 'Scadențe').click();
    await settle();
    events.next(updated);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(isOn(named(element, 'Scadențe'))).toBe(false);
    pending.resolve(answer());
    await settle();
  });

  it('shows the state of a live re-read once nothing is pending', async () => {
    const { element, settle } = await render();
    read.mockResolvedValueOnce(answer({ news: true, offers: false }));

    events.next(updated);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(states(element)).toEqual([false, true, true, true, true]);
  });

  it('ignores other live events', async () => {
    const { settle } = await render();

    events.next({
      at: '2026-10-08T10:00:00.000Z',
      id: 'b',
      kind: 'something.else',
    } as unknown as LiveMessage);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of live events into one re-read', async () => {
    const { settle } = await render();

    for (let i = 0; i < 20; i++) events.next(updated);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the five switches in order when the answer lists the groups in another order', async () => {
    const shuffled = answer();
    shuffled.groups = [...shuffled.groups].reverse();
    const { element } = await render(Promise.resolve(shuffled));

    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual(
      TITLES,
    );
    expect(states(element)).toEqual([true, true, true, false, true]);
  });

  it('shows the defaults when the answer misses a group', async () => {
    const partial = answer({ offers: false });
    partial.groups = partial.groups.filter((g) => g.key !== 'due_dates');
    const { element } = await render(Promise.resolve(partial));

    expect(switches(element)).toHaveLength(5);
    expect(states(element)).toEqual([false, true, true, false, true]);
  });

  it('shows the defaults when the answer has no groups at all', async () => {
    const empty = answer();
    empty.groups = [];
    const { element } = await render(Promise.resolve(empty));

    expect(switches(element)).toHaveLength(5);
    expect(states(element)).toEqual([true, true, true, false, true]);
  });

  it('shows only the five driver groups when the answer carries an unknown one', async () => {
    const extra = answer();
    extra.groups = [
      ...extra.groups,
      { enabled: true, key: 'garage_staff', types: [] },
    ] as typeof extra.groups;
    const { element } = await render(Promise.resolve(extra));

    expect(switches(element).map((s) => s.getAttribute('aria-label'))).toEqual(
      TITLES,
    );
  });

  it('shows the error again when the retry fails too', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));
    read.mockRejectedValueOnce(new Error('still down'));

    (
      [...element.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Reîncearcă',
      ) as HTMLButtonElement
    ).click();
    await settle();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Nu am putut încărca setările',
    );
  });

  it('does not save when a disabled switch is clicked while loading', async () => {
    const { element, settle } = await render(new Promise(() => undefined));

    named(element, 'Scadențe').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
  });
});

describe('the news consent step under hostile timing', () => {
  it('keeps news shown on while the step is open and a live re-read says off', async () => {
    const { element, settle } = await render();
    const step = deferred<boolean | 'cancelled'>();
    open.mockReturnValueOnce(step.promise);

    named(element, 'Noutăți MotorFix').click();
    await settle();
    read.mockResolvedValueOnce(answer());
    events.next(updated);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(true);
    expect(save).not.toHaveBeenCalled();
    step.resolve(true);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('sends the version of a read that finished while the step was open', async () => {
    const { element, settle } = await render();
    const step = deferred<boolean | 'cancelled'>();
    open.mockReturnValueOnce(step.promise);

    named(element, 'Noutăți MotorFix').click();
    await settle();
    read.mockResolvedValueOnce(answer({}, '2027-01-01'));
    resync.next();
    await settle();
    step.resolve(true);
    await settle();

    expect(save).toHaveBeenCalledWith({
      body: {
        groups: [{ enabled: true, key: 'news' }],
        newsConsentTextVersion: '2026-10-03',
      },
    });
  });

  it('turns news back off when the step is cancelled during a live re-read', async () => {
    const { element, settle } = await render();
    const step = deferred<boolean | 'cancelled'>();
    open.mockReturnValueOnce(step.promise);

    named(element, 'Noutăți MotorFix').click();
    await settle();
    resync.next();
    await settle();
    step.resolve('cancelled');
    await settle();

    expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('turns news back off and says so when the step is confirmed and the save fails', async () => {
    const { element, settle } = await render();
    save.mockRejectedValueOnce(new Error('down'));

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(false);
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
  });

  it('turns news back off and saves nothing when the step cannot open', async () => {
    const { element, settle } = await render();
    open.mockRejectedValueOnce(new Error('no overlay'));

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(save).not.toHaveBeenCalled();
    expect(isOn(named(element, 'Noutăți MotorFix'))).toBe(false);
    expect(toast).toHaveBeenCalledWith('Setarea nu a putut fi salvată');
  });

  it('shows the newest read when an older one answers last', async () => {
    const { element, settle } = await render();
    let older: (value: NotificationPreferencesDto) => void = () => undefined;
    read.mockImplementationOnce(
      () => new Promise((resolve) => (older = resolve)),
    );
    read.mockResolvedValueOnce(answer({ offers: false }));

    resync.next();
    resync.next();
    await settle();
    older(answer());
    await settle();

    expect(isOn(named(element, 'Ofertă nouă'))).toBe(false);
  });

  it('keeps the latest of three quick flips shown when the first save fails', async () => {
    const { element, settle } = await render();
    let fail: (reason: Error) => void = () => undefined;
    save.mockImplementationOnce(
      () => new Promise((_, reject) => (fail = reject)),
    );
    const scadente = () => named(element, 'Scadențe');

    scadente().click();
    await settle();
    scadente().click();
    await settle();
    scadente().click();
    await settle();
    fail(new Error('down'));
    await settle();

    expect(isOn(scadente())).toBe(false);
  });

  it('opens the step on every turn-on, also after a cancel', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce(false);

    named(element, 'Noutăți MotorFix').click();
    await settle();
    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(open).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never sends the consent version when turning news off', async () => {
    const { element, settle } = await render(
      Promise.resolve(answer({ news: true })),
    );

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect((save.mock.calls[0][0] as { body: object }).body).not.toHaveProperty(
      'newsConsentTextVersion',
    );
  });

  it('does not ask for consent before the current version is known', async () => {
    const { element, settle } = await render(new Promise(() => undefined));

    named(element, 'Noutăți MotorFix').click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
