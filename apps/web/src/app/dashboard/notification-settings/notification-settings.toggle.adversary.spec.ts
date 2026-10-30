import { TestBed } from '@angular/core/testing';
import {
  type NotificationPreferencesDto,
  NotificationsService,
  type StaffNotificationsDto,
} from '@motor-fix/data-access';
import { toast } from '@motor-fix/ui-cockpit';
import { Subject } from 'rxjs';

import { NotificationSettings } from './notification-settings';
import { Live } from '../live';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const GARAGE = 'a3b5c7d9-0000-4000-8000-000000000001';

const owner = (email = true, push = true): StaffNotificationsDto => ({
  garageId: GARAGE,
  garageName: 'Atelier Test',
  role: 'owner',
  sections: [
    {
      key: 'requests_quotes',
      types: [
        {
          channels: [
            { channel: 'email', enabled: email, locked: false },
            { channel: 'push', enabled: push, locked: false },
            { channel: 'whatsapp', enabled: false, locked: false },
          ],
          type: 'REQUEST_RECEIVED',
        },
      ],
    },
  ],
  whatsapp: { available: true, reason: null },
});

const answer = (staff: StaffNotificationsDto[]) =>
  ({
    groups: [],
    newsConsent: null,
    preferences: [],
    staff,
  }) as unknown as NotificationPreferencesDto;

const EMAIL = 'Cerere de ofertă nouă, E‑mail';
const PUSH = 'Cerere de ofertă nouă, Push';

let read: jest.Mock;
let save: jest.Mock;

async function render(first = owner()) {
  read = jest.fn(async () => answer([first]));
  save = jest.fn(async () => answer([first]));
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
    ],
  });
  const fixture = TestBed.createComponent(NotificationSettings);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await settle();
  const sw = (name: string) =>
    [
      ...element.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
    ].find((s) => s.getAttribute('aria-label') === name) as HTMLButtonElement;
  return { element, settle, sw };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

beforeEach(() => jest.mocked(toast).mockClear());
afterEach(() => TestBed.resetTestingModule());

// @traces 1315-FR-001
// @traces 1315-FR-002
// @traces 1315-FR-008
describe('Notification switches: saves that fail', () => {
  it('ends on the server row after two flips of one switch whose saves both fail', async () => {
    const { settle, sw } = await render();
    const first = deferred<never>();
    const second = deferred<never>();
    save
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    sw(EMAIL).click();
    await settle();
    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    sw(EMAIL).click();
    await settle();
    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    first.reject(new Error('boom'));
    second.reject(new Error('boom'));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('shows the row the server now holds, not the one it had, after a failed save', async () => {
    const { settle, sw } = await render();
    save.mockRejectedValueOnce(new Error('refused'));
    read.mockResolvedValueOnce(answer([owner(false, true)]));

    sw(PUSH).click();
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(sw(PUSH).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // @traces 1411-FR-001
  it('puts the switch back to the value before the press and toasts once when the re-read fails too', async () => {
    const { settle, sw } = await render();
    save.mockRejectedValueOnce(new Error('refused'));
    read.mockRejectedValueOnce(new Error('down'));

    sw(EMAIL).click();
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    expect(sw(PUSH).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // @traces 1411-FR-001
  it('ends on the value before the first press when two flips fail and every re-read fails', async () => {
    const { settle, sw } = await render();
    const first = deferred<never>();
    const second = deferred<never>();
    save
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    read.mockRejectedValue(new Error('down'));

    sw(EMAIL).click();
    await settle();
    sw(EMAIL).click();
    await settle();
    second.reject(new Error('boom'));
    await settle();
    first.reject(new Error('boom'));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(2);
  });

  // @traces 1411-FR-001
  it('goes back to the value a save confirmed, not the one before it, when a later flip fails offline', async () => {
    const { settle, sw } = await render();
    save
      .mockResolvedValueOnce(answer([owner(false, true)]))
      .mockRejectedValueOnce(new Error('refused'));
    read.mockRejectedValue(new Error('down'));

    sw(EMAIL).click();
    await settle();
    sw(EMAIL).click();
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // @traces 1411-FR-001
  it('lets an older failed press change nothing once a newer press of that switch stands', async () => {
    const { settle, sw } = await render();
    const first = deferred<never>();
    save
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(answer([owner(true, true)]));
    read.mockRejectedValue(new Error('down'));

    sw(EMAIL).click();
    await settle();
    sw(EMAIL).click();
    await settle();
    first.reject(new Error('boom'));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('keeps a saved choice when a re-read for another switch answered from before it', async () => {
    const { settle, sw } = await render();
    const emailSave = deferred<NotificationPreferencesDto>();
    save
      .mockImplementationOnce(() => emailSave.promise)
      .mockRejectedValueOnce(new Error('refused'));

    sw(EMAIL).click();
    await settle();
    sw(PUSH).click();
    await settle();
    emailSave.resolve(answer([owner()]));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(sw(PUSH).getAttribute('aria-checked')).toBe('true');
  });

  it('makes no extra read and no toast when the save succeeds', async () => {
    const { settle, sw } = await render();

    sw(EMAIL).click();
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(read).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('sends exactly one write per press and does not resend a refused one', async () => {
    const { settle, sw } = await render();
    save.mockRejectedValue(new Error('refused'));

    sw(EMAIL).click();
    await settle();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      body: {
        preferences: [
          {
            channel: 'email',
            enabled: false,
            garageId: GARAGE,
            type: 'REQUEST_RECEIVED',
          },
        ],
      },
    });
  });
});

// @traces 1411-FR-001
describe('Notification switches: failed save and failed re-read', () => {
  // @traces 1411-FR-001
  it('restores an off switch to off, not on, when its save and re-read fail', async () => {
    const { settle, sw } = await render(owner(false, true));
    save.mockRejectedValueOnce(new Error('refused'));
    read.mockRejectedValueOnce(new Error('down'));

    sw(EMAIL).click();
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(sw(PUSH).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // @traces 1411-FR-001
  it('restores only the failed switch and keeps a different switch whose save held', async () => {
    const { settle, sw } = await render();
    const emailSave = deferred<never>();
    save
      .mockImplementationOnce(() => emailSave.promise)
      .mockResolvedValueOnce(answer([owner(true, false)]));
    read.mockRejectedValue(new Error('down'));

    sw(EMAIL).click();
    await settle();
    sw(PUSH).click();
    await settle();
    emailSave.reject(new Error('refused'));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    expect(sw(PUSH).getAttribute('aria-checked')).toBe('false');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // @traces 1411-FR-001
  it('sends the opposite value on the next press after a restore and makes no further read', async () => {
    const { settle, sw } = await render();
    save.mockRejectedValueOnce(new Error('refused'));
    read.mockRejectedValueOnce(new Error('down'));

    sw(EMAIL).click();
    await settle();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    sw(EMAIL).click();
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({
      body: {
        preferences: [
          {
            channel: 'email',
            enabled: false,
            garageId: GARAGE,
            type: 'REQUEST_RECEIVED',
          },
        ],
      },
    });
    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
  });

  // @traces 1411-FR-001
  it('restores the confirmed value after three flips where the first saved and the next two fail', async () => {
    const { settle, sw } = await render();
    const b = deferred<never>();
    const c = deferred<never>();
    save
      .mockResolvedValueOnce(answer([owner(false, true)]))
      .mockImplementationOnce(() => b.promise)
      .mockImplementationOnce(() => c.promise);
    read.mockRejectedValue(new Error('down'));

    sw(EMAIL).click();
    await settle();
    sw(EMAIL).click();
    await settle();
    sw(EMAIL).click();
    await settle();
    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    b.reject(new Error('boom'));
    c.reject(new Error('boom'));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(toast).toHaveBeenCalledTimes(2);
  });

  // @traces 1411-FR-001
  it('keeps the unsaved value off screen when the newer press fails first and the older save then succeeds', async () => {
    const { settle, sw } = await render();
    const older = deferred<NotificationPreferencesDto>();
    save
      .mockImplementationOnce(() => older.promise)
      .mockRejectedValueOnce(new Error('refused'));
    read.mockRejectedValue(new Error('down'));

    sw(EMAIL).click();
    await settle();
    sw(EMAIL).click();
    await settle();
    await settle();
    older.resolve(answer([owner(false, true)]));
    await settle();

    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('false');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  // @traces 1411-FR-001
  it('toasts exactly once per failed save when the re-read rejects with a non-error value', async () => {
    const { settle, sw } = await render();
    save.mockRejectedValueOnce(undefined);
    read.mockRejectedValueOnce(null);

    sw(PUSH).click();
    await settle();

    expect(sw(PUSH).getAttribute('aria-checked')).toBe('true');
    expect(sw(EMAIL).getAttribute('aria-checked')).toBe('true');
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
