import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
