import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage, MeDto } from '@motor-fix/contracts';
import { PlatformService } from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { PlatformStatus } from './platform-status';
import { Live } from '../dashboard/live';
import { Session } from '../dashboard/session';
import { PublicLive } from '../public/live';

type Answer = unknown;

function stream() {
  const events = new Subject<LiveMessage>();
  return {
    events,
    on: (kinds: readonly string[]) =>
      events.pipe(filter((m) => kinds.includes(m.kind))),
    resync: new Subject<void>(),
  };
}

function setUp() {
  const pending: {
    resolve: (a: Answer) => void;
    reject: (e: Error) => void;
  }[] = [];
  const status = jest.fn(
    () =>
      new Promise<Answer>((resolve, reject) => {
        pending.push({ reject, resolve });
      }),
  );
  const current = signal<MeDto | null>(null);
  const live = { ...stream(), state: signal('closed') };
  const publicLive = { ...stream(), register: jest.fn(() => jest.fn()) };
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: PlatformService,
        useValue: { platformStatusControllerStatus: status },
      },
      { provide: Session, useValue: { current } },
      { provide: Live, useValue: live },
      { provide: PublicLive, useValue: publicLive },
    ],
  });
  const platformStatus = TestBed.inject(PlatformStatus);
  TestBed.tick();
  return { current, live, pending, platformStatus, publicLive, status };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

const message = (kind: string, id: string) =>
  ({ at: '2026-10-08T12:00:00.000Z', id, kind }) as unknown as LiveMessage;

const account = (roles: unknown) => ({ roles }) as unknown as MeDto;

afterEach(() => TestBed.resetTestingModule());

describe('PlatformStatus under hostile input', () => {
  it('starts with maintenance off and the page hidden before any answer', () => {
    const { platformStatus } = setUp();

    expect(platformStatus.maintenance()).toBe(false);
    expect(platformStatus.showPage()).toBe(false);
    expect(platformStatus.isAdmin()).toBe(false);
  });

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'maintenance'],
    ['the string "true"', { maintenance: 'true' }],
    ['the number 1', { maintenance: 1 }],
    ['a null flag', { maintenance: null }],
  ])('does not switch the page on for %s', async (_title, body) => {
    const { pending, platformStatus } = setUp();

    const done = platformStatus.read();
    pending[0]?.resolve(body);
    await done;

    expect(platformStatus.maintenance()).toBe(false);
  });

  it('never rejects when the read fails', async () => {
    const { pending, platformStatus } = setUp();

    const done = platformStatus.read();
    pending[0]?.reject(new Error('offline'));

    await expect(done).resolves.toBeUndefined();
    expect(platformStatus.maintenance()).toBe(false);
  });

  it('ends on the last answer after two hundred events answered in reverse order', async () => {
    const { live, pending, platformStatus } = setUp();
    for (let i = 0; i < 200; i++) {
      live.events.next(message('platform_rule.changed', 'maintenance_mode'));
    }
    await settle();
    expect(pending).toHaveLength(200);

    for (let i = pending.length - 1; i >= 0; i--) {
      pending[i]?.resolve({ maintenance: i % 2 === 0 });
      await settle();
    }

    // the newest read (index 199) said false
    expect(platformStatus.maintenance()).toBe(false);
  });

  it('answers the last read when a call refused for maintenance arrives after a read of off', async () => {
    const { pending, platformStatus } = setUp();
    const done = platformStatus.read();
    pending[0]?.resolve({ maintenance: false });
    await done;

    platformStatus.on();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it('lets a read begun after a refusal turn maintenance off again', async () => {
    const { pending, platformStatus } = setUp();
    platformStatus.on();

    const done = platformStatus.read();
    pending[0]?.resolve({ maintenance: false });
    await done;

    expect(platformStatus.maintenance()).toBe(false);
  });

  it('is unchanged by being told twice that a call was refused', () => {
    const { platformStatus } = setUp();

    platformStatus.on();
    platformStatus.on();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it.each([
    [
      'another kind with the rule id',
      'platform_rule.deleted',
      'maintenance_mode',
    ],
    ['an upper-case rule id', 'platform_rule.changed', 'MAINTENANCE_MODE'],
    ['a rule id with a suffix', 'platform_rule.changed', 'maintenance_mode_2'],
    ['an empty id', 'platform_rule.changed', ''],
  ])('ignores %s', async (_title, kind, id) => {
    const { live, publicLive, status } = setUp();

    live.events.next(message(kind, id));
    publicLive.events.next(message(kind, id));
    await settle();

    expect(status).not.toHaveBeenCalled();
  });

  it('keeps listening after a read failed on an event', async () => {
    const { live, pending, platformStatus } = setUp();
    live.events.next(message('platform_rule.changed', 'maintenance_mode'));
    pending[0]?.reject(new Error('boom'));
    await settle();

    live.events.next(message('platform_rule.changed', 'maintenance_mode'));
    pending[1]?.resolve({ maintenance: true });
    await settle();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it.each([
    ['no roles list', undefined],
    ['a null roles list', null],
    ['an empty roles list', []],
    ['a role named in capitals', ['ADMIN']],
    ['a role with a trailing space', ['admin ']],
    ['a look-alike role', ['administrator']],
  ])('shows the page to an account with %s', (_title, roles) => {
    const { current, platformStatus } = setUp();
    current.set(account(roles));

    platformStatus.on();

    expect(platformStatus.isAdmin()).toBe(false);
    expect(platformStatus.showPage()).toBe(true);
  });

  it('follows the session from admin to signed out while maintenance is on', () => {
    const { current, platformStatus } = setUp();
    platformStatus.on();
    current.set(account(['admin']));
    expect(platformStatus.showPage()).toBe(false);

    current.set(null);

    expect(platformStatus.showPage()).toBe(true);
  });

  it('follows the session from signed out to admin while maintenance is on', () => {
    const { current, platformStatus } = setUp();
    platformStatus.on();
    expect(platformStatus.showPage()).toBe(true);

    current.set(account(['admin']));

    expect(platformStatus.showPage()).toBe(false);
  });

  it('hides the page from an account that holds admin among many roles', () => {
    const { current, platformStatus } = setUp();
    platformStatus.on();

    current.set(account(['driver', 'garage', 'receptionist', 'admin']));

    expect(platformStatus.showPage()).toBe(false);
  });
});
