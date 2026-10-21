import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  EventKind,
  LiveMessage,
  VerificationStatusDto,
} from '@motor-fix/contracts';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { ListingStatus } from './listing-status';
import { Live } from '../../dashboard/live';
import { Session } from '../../dashboard/session';

const GARAGE = 'a3c1e5f7-0000-4000-8000-000000000001';

const events = new Subject<LiveMessage>();
const resyncs = new Subject<void>();
const live = {
  close: jest.fn(),
  on: (kinds: readonly EventKind[]) =>
    events.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  open: jest.fn(),
  resync: resyncs.asObservable(),
};
const api = { verificationStatusControllerRead: jest.fn() };
const session = {
  current: signal<unknown>({
    garageAccess: [{ garageId: GARAGE, role: 'owner' }],
    garageId: GARAGE,
    role: 'garage',
  }),
};

const status = (
  value: VerificationStatusDto['status'],
  extra: Partial<VerificationStatusDto> = {},
): VerificationStatusDto => ({
  reason: null,
  requestedItems: [],
  status: value,
  submittedAt: '2026-10-20T08:30:00.000Z',
  ...extra,
});

const pause = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await pause();
  }
}

async function render(inputs: { sent?: string | null } = {}) {
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: api },
      { provide: Live, useValue: live },
      { provide: Session, useValue: session },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(ListingStatus);
  for (const [key, value] of Object.entries(inputs))
    fixture.componentRef.setInput(key, value);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lit = (host: HTMLElement) =>
  [...host.querySelectorAll('ol.stages > li')].map((li) =>
    li.classList.contains('lit'),
  );

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  live.open.mockReset();
  live.close.mockReset();
  api.verificationStatusControllerRead
    .mockReset()
    .mockResolvedValue(status('submitted'));
  session.current.set({
    garageAccess: [{ garageId: GARAGE, role: 'owner' }],
    garageId: GARAGE,
    role: 'garage',
  });
});

afterEach(() => TestBed.resetTestingModule());

// @traces 116-FR-016
describe('the listing status under racing reads', () => {
  it('shows the newer answer when an older read finishes last', async () => {
    const { fixture, host } = await render();
    const slow = deferred<VerificationStatusDto>();
    const fast = deferred<VerificationStatusDto>();
    api.verificationStatusControllerRead
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);

    events.next({ id: 'f', kind: 'verification.opened' } as LiveMessage);
    await pause(350);
    events.next({ id: 'f', kind: 'verification.decided' } as LiveMessage);
    await pause(350);
    fast.resolve(status('approved'));
    await settle(fixture);
    slow.resolve(status('in_review'));
    await settle(fixture);

    expect(lit(host)).toEqual([true, true, true]);
  });

  it('ends on the last status after a burst of twenty events', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(status('approved'));

    for (let i = 0; i < 20; i++) {
      events.next({ id: 'f', kind: 'verification.opened' } as LiveMessage);
    }
    await pause(400);
    await settle(fixture);

    expect(lit(host)).toEqual([true, true, true]);
    expect(
      api.verificationStatusControllerRead.mock.calls.length,
    ).toBeLessThanOrEqual(21);
  });

  it('reads no more after it is destroyed', async () => {
    const { fixture } = await render();
    fixture.destroy();
    api.verificationStatusControllerRead.mockClear();

    events.next({ id: 'f', kind: 'verification.decided' } as LiveMessage);
    resyncs.next();
    await pause(400);

    expect(api.verificationStatusControllerRead).not.toHaveBeenCalled();
  });
});

// @traces 116-FR-017
describe('the listing status for a session without an owned garage', () => {
  it.each([
    ['no session', null],
    [
      'staff of a garage only',
      {
        garageAccess: [{ garageId: GARAGE, role: 'receptionist' }],
        role: 'receptionist',
      },
    ],
    [
      'a mechanic of a garage on the garage role',
      {
        garageAccess: [{ garageId: GARAGE, role: 'mechanic' }],
        garageId: GARAGE,
        role: 'garage',
      },
    ],
    ['a driver with no garage', { garageAccess: [], role: 'driver' }],
  ])('asks the API nothing for %s', async (_name, current) => {
    session.current.set(current);

    await render();

    expect(api.verificationStatusControllerRead).not.toHaveBeenCalled();
  });

  it('reads the garage the account owns when it is staff elsewhere too', async () => {
    const other = 'b4d2f6a8-0000-4000-8000-000000000002';
    session.current.set({
      garageAccess: [
        { garageId: other, role: 'receptionist' },
        { garageId: GARAGE, role: 'owner' },
      ],
      role: 'garage',
    });

    await render();

    expect(api.verificationStatusControllerRead).toHaveBeenCalledWith({
      garageId: GARAGE,
    });
  });
});

// @traces 116-FR-015
describe('the listing status with a status the client does not know', () => {
  it('does not throw and shows no raw translation key', async () => {
    api.verificationStatusControllerRead.mockResolvedValue({
      ...status('submitted'),
      status: 'withdrawn',
    });

    const { host } = await render();

    expect(text(host)).not.toContain('verificationStatus');
  });

  it('shows a note with markup as plain text', async () => {
    const note = '<img src=x onerror=alert(1)>';
    api.verificationStatusControllerRead.mockResolvedValue(
      status('rejected', { reason: { code: 'documents', note } }),
    );

    const { host } = await render();

    expect(host.querySelector('img')).toBeNull();
    expect(text(host.querySelector('.note'))).toBe(note);
  });
});

// @traces 116-FR-015
describe('the listing status given the send answer and a read that differ', () => {
  it('shows the read over what the send answered', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(status('approved'));

    const { host } = await render({ sent: 'submitted' });

    expect(lit(host)).toEqual([true, true, true]);
  });

  it('keeps what the send answered when the first read fails, with the retry', async () => {
    api.verificationStatusControllerRead.mockRejectedValue(new Error('down'));

    const { host } = await render({ sent: 'submitted' });

    expect(lit(host)).toEqual([true, false, false]);
    expect(host.querySelector('.refresh-failed button')).not.toBeNull();
  });

  it('lights nothing and shows no error for a garage in draft', async () => {
    api.verificationStatusControllerRead.mockResolvedValue({
      ...status('draft'),
      submittedAt: null,
    });

    const { host } = await render();

    expect(lit(host)).toEqual([false, false, false]);
    expect(host.querySelector('.refresh-failed')).toBeNull();
  });
});
