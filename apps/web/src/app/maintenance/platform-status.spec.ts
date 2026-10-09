import { ApplicationRef, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { LiveMessage, MeDto } from '@motor-fix/contracts';
import { PlatformService } from '@motor-fix/data-access';
import { Subject } from 'rxjs';

import { PlatformStatus } from './platform-status';
import { Live } from '../dashboard/live';
import { Session } from '../dashboard/session';
import { PublicLive } from '../public/live';

type Answer = { maintenance: boolean } | Error;

function fakeStream() {
  const events = new Subject<LiveMessage>();
  const resync = new Subject<void>();
  return {
    events,
    on: () => events.asObservable(),
    resync,
  };
}

async function setUp({ platform = 'browser', answers = [] as Answer[] } = {}) {
  const pending: ((answer: Answer) => void)[] = [];
  const status = jest.fn(
    () =>
      new Promise<{ maintenance: boolean }>((resolve, reject) => {
        const settle = (answer: Answer) =>
          answer instanceof Error ? reject(answer) : resolve(answer);
        const next = answers.shift();
        if (next) settle(next);
        else pending.push(settle);
      }),
  );
  const current = signal<MeDto | null>(null);
  const live = { ...fakeStream(), state: signal('closed') };
  const leave = jest.fn();
  const publicLive = {
    ...fakeStream(),
    register: jest.fn(() => leave),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
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
  // The streams are wired once their code has loaded.
  await platformStatus.listening;
  TestBed.tick();
  return {
    answer: (answer: Answer) => pending.shift()?.(answer),
    current,
    leave,
    live,
    pending,
    platformStatus,
    publicLive,
    status,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

const changed = (id: string): LiveMessage =>
  ({
    at: '2026-10-08T12:00:00.000Z',
    id,
    kind: 'platform_rule.changed',
  }) as LiveMessage;

const account = (roles: MeDto['roles']) => ({ roles }) as MeDto;

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

describe('PlatformStatus', () => {
  it('reads whether maintenance is on', async () => {
    const { platformStatus } = await setUp({
      answers: [{ maintenance: true }],
    });

    await platformStatus.read();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it('keeps what it knew when the read fails', async () => {
    const { platformStatus } = await setUp({
      answers: [{ maintenance: true }, new Error('offline')],
    });
    await platformStatus.read();

    await platformStatus.read();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it('turns maintenance on when told a call was refused for it', async () => {
    const { platformStatus } = await setUp();

    platformStatus.on();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it.each([
    ['nobody', null, true],
    ['a driver', ['driver'], true],
    ['a garage owner', ['driver', 'garage'], true],
    ['an admin', ['driver', 'admin'], false],
  ] as const)(
    'shows the page to %s while maintenance is on',
    async (_who, roles, shown) => {
      const { current, platformStatus } = await setUp();
      current.set(roles ? account([...roles]) : null);

      platformStatus.on();

      expect(platformStatus.showPage()).toBe(shown);
      expect(platformStatus.isAdmin()).toBe(!shown);
    },
  );

  it('shows the page to nobody while maintenance is off', async () => {
    const { platformStatus } = await setUp();

    expect(platformStatus.showPage()).toBe(false);
  });

  it.each(['live', 'publicLive'] as const)(
    're-reads the status when the rule changes on the %s stream',
    async (stream) => {
      const fakes = await setUp({ answers: [{ maintenance: true }] });

      fakes[stream].events.next(changed('maintenance_mode'));
      await settle();

      expect(fakes.status).toHaveBeenCalledTimes(1);
      expect(fakes.platformStatus.maintenance()).toBe(true);
    },
  );

  it('ignores a change of another rule', async () => {
    const { live, status } = await setUp();

    live.events.next(changed('lead_fee'));
    await settle();

    expect(status).not.toHaveBeenCalled();
  });

  it.each(['live', 'publicLive'] as const)(
    're-reads the status when the %s stream opens again',
    async (stream) => {
      const fakes = await setUp({ answers: [{ maintenance: true }] });

      fakes[stream].resync.next();
      await settle();

      expect(fakes.status).toHaveBeenCalledTimes(1);
      expect(fakes.platformStatus.maintenance()).toBe(true);
    },
  );

  it('ends in the last answer when a quick on and off cross on the way', async () => {
    const { answer, live, platformStatus } = await setUp();

    live.events.next(changed('maintenance_mode'));
    live.events.next(changed('maintenance_mode'));
    answer({ maintenance: true });
    await settle();
    answer({ maintenance: false });
    await settle();

    expect(platformStatus.maintenance()).toBe(false);
  });

  it('acts on the newest read even when an older one answers last', async () => {
    const { live, pending, platformStatus } = await setUp();
    live.events.next(changed('maintenance_mode'));
    live.events.next(changed('maintenance_mode'));

    pending[1]?.({ maintenance: false });
    await settle();
    pending[0]?.({ maintenance: true });
    await settle();

    expect(platformStatus.maintenance()).toBe(false);
  });

  it('holds the public stream, once the page has settled, while the signed-in stream is closed', async () => {
    jest.useFakeTimers();
    const { leave, live, publicLive } = await setUp();
    await TestBed.inject(ApplicationRef).whenStable();
    await jest.advanceTimersByTimeAsync(1_000);
    TestBed.tick();
    expect(publicLive.register).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    TestBed.tick();
    expect(publicLive.register).toHaveBeenCalledTimes(1);
    expect(publicLive.register).toHaveBeenCalledWith({});

    live.state.set('open');
    TestBed.tick();
    expect(leave).toHaveBeenCalledTimes(1);

    live.state.set('closed');
    TestBed.tick();
    expect(publicLive.register).toHaveBeenCalledTimes(2);
  });

  it('waits for the network to go quiet before holding the public stream', async () => {
    jest.useFakeTimers();
    const seen: (() => void)[] = [];
    const real = globalThis.PerformanceObserver;
    globalThis.PerformanceObserver = class {
      constructor(callback: () => void) {
        seen.push(callback);
      }
      disconnect() {}
      observe() {}
    } as unknown as typeof PerformanceObserver;
    try {
      const { publicLive } = await setUp();
      await TestBed.inject(ApplicationRef).whenStable();
      await jest.advanceTimersByTimeAsync(1_500);
      // A map still fetching its tiles: a download ends.
      for (const ended of seen) ended();
      await jest.advanceTimersByTimeAsync(1_500);
      TestBed.tick();
      expect(publicLive.register).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(500);
      TestBed.tick();
      expect(publicLive.register).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.PerformanceObserver = real;
    }
  });

  it('keeps a call refused for maintenance over an older read that answers later', async () => {
    const { pending, live, platformStatus } = await setUp();
    live.events.next(changed('maintenance_mode'));

    platformStatus.on();
    pending[0]?.({ maintenance: false });
    await settle();

    expect(platformStatus.maintenance()).toBe(true);
  });

  it('opens no stream and listens to nothing on the server', async () => {
    const { live, publicLive, status } = await setUp({ platform: 'server' });

    live.events.next(changed('maintenance_mode'));
    await settle();

    expect(publicLive.register).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
