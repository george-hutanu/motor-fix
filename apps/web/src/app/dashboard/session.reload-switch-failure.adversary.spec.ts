import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const DRIVER = {
  capabilities: [],
  email: 'andrei@example.ro',
  emailConfirmed: false,
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei Marin',
  role: 'driver',
  roles: ['driver', 'garage'],
} as MeDto;

const GARAGE = {
  ...DRIVER,
  garageId: 'garage-1',
  landing: '/app/garage',
  role: 'garage',
} as MeDto;

function setup() {
  const meControllerMe = jest.fn(() => Promise.resolve(DRIVER));
  const auth = {
    authControllerRefresh: jest.fn(() =>
      Promise.resolve({ accessToken: 'renewed' }),
    ),
    authControllerSignIn: jest.fn(() =>
      Promise.resolve({ accessToken: 'signed-in' }),
    ),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
    authControllerSwitchRole: jest.fn(() =>
      Promise.resolve({ accessToken: 'as-garage' }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      { provide: AuthService, useValue: auth },
    ],
  });
  return { auth, meControllerMe, session: TestBed.inject(Session) };
}

function held(meControllerMe: jest.Mock) {
  const pending: {
    resolve: (me: MeDto) => void;
    reject: (error: Error) => void;
  } = {
    reject: () => undefined,
    resolve: () => undefined,
  };
  meControllerMe.mockImplementationOnce(
    () =>
      new Promise<MeDto>((resolve, reject) => {
        pending.resolve = resolve;
        pending.reject = reject;
      }),
  );
  return pending;
}

async function signedIn() {
  const ctx = setup();
  await ctx.session.signIn('andrei@example.ro', 'parola-lunga', false);
  return ctx;
}

async function tick() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

async function switching(ctx: Awaited<ReturnType<typeof signedIn>>) {
  const load = held(ctx.meControllerMe);
  const switched = ctx.session.switchRole('garage');
  const outcome = switched.catch((error: Error) => error);
  await tick();
  return { load, outcome, switched };
}

describe('a failed role switch and the reloads around it', () => {
  it('drops two reloads sent under the switched token when the switch fails', async () => {
    const ctx = await signedIn();
    const before = ctx.session.token();
    const sw = await switching(ctx);
    const first = held(ctx.meControllerMe);
    const firstReading = ctx.session.reload();
    const second = held(ctx.meControllerMe);
    const secondReading = ctx.session.reload();

    sw.load.reject(new Error('offline'));
    await sw.outcome;
    second.resolve(GARAGE);
    first.resolve({ ...GARAGE, emailConfirmed: true });
    await firstReading;
    await secondReading;

    expect(ctx.session.token()).toBe(before);
    expect(ctx.session.current()).toBe(DRIVER);
  });

  it('keeps the old account when the dropped reload answers before the switch fails', async () => {
    const ctx = await signedIn();
    const sw = await switching(ctx);
    const reload = held(ctx.meControllerMe);
    const reading = ctx.session.reload();
    reload.resolve(GARAGE);
    await reading;

    sw.load.reject(new Error('offline'));
    await sw.outcome;

    expect(ctx.session.token()).toBe('signed-in');
    expect(ctx.session.current()?.role).toBe('driver');
  });

  it('lands a reload sent before the switch and drops one sent under it, in either answer order', async () => {
    for (const underFirst of [true, false]) {
      TestBed.resetTestingModule();
      const ctx = await signedIn();
      const confirmed = { ...DRIVER, emailConfirmed: true };
      const early = held(ctx.meControllerMe);
      const earlyReading = ctx.session.reload();
      const sw = await switching(ctx);
      const late = held(ctx.meControllerMe);
      const lateReading = ctx.session.reload();

      sw.load.reject(new Error('offline'));
      await sw.outcome;
      if (underFirst) late.resolve(GARAGE);
      else early.resolve(confirmed);
      if (underFirst) early.resolve(confirmed);
      else late.resolve(GARAGE);
      await earlyReading;
      await lateReading;

      expect(ctx.session.token()).toBe('signed-in');
      expect(ctx.session.current()).toEqual(confirmed);
    }
  });

  it('lands a reload sent after the failed switch put the old token back', async () => {
    const ctx = await signedIn();
    const sw = await switching(ctx);
    sw.load.reject(new Error('offline'));
    await sw.outcome;
    const confirmed = { ...DRIVER, emailConfirmed: true };
    ctx.meControllerMe.mockResolvedValueOnce(confirmed);

    await ctx.session.reload();

    expect(ctx.session.current()).toEqual(confirmed);
  });

  it('lands a reload sent before a switch whose token request itself fails', async () => {
    const ctx = await signedIn();
    const early = held(ctx.meControllerMe);
    const reading = ctx.session.reload();
    ctx.auth.authControllerSwitchRole.mockRejectedValueOnce(
      new Error('denied'),
    );

    await expect(ctx.session.switchRole('garage')).rejects.toThrow('denied');
    const confirmed = { ...DRIVER, emailConfirmed: true };
    early.resolve(confirmed);
    await reading;

    expect(ctx.session.token()).toBe('signed-in');
    expect(ctx.session.current()).toEqual(confirmed);
  });

  it('does not let a reload from a failed switch overwrite the account of a later successful switch', async () => {
    const ctx = await signedIn();
    const failed = await switching(ctx);
    const stale = held(ctx.meControllerMe);
    const staleReading = ctx.session.reload();
    failed.load.reject(new Error('offline'));
    await failed.outcome;

    ctx.meControllerMe.mockResolvedValueOnce(GARAGE);
    await ctx.session.switchRole('garage');
    stale.resolve({ ...GARAGE, name: 'Stale Under Failed Token' });
    await staleReading;

    expect(ctx.session.token()).toBe('as-garage');
    expect(ctx.session.current()).toBe(GARAGE);
  });

  it('keeps a reload sent under the second, successful switch after the first failed', async () => {
    const ctx = await signedIn();
    const failed = await switching(ctx);
    failed.load.reject(new Error('offline'));
    await failed.outcome;
    const ok = await switching(ctx);
    const fresh = { ...GARAGE, emailConfirmed: true };
    ctx.meControllerMe.mockResolvedValueOnce(fresh);
    await ctx.session.reload();
    ok.load.resolve(GARAGE);
    await ok.switched;

    expect(ctx.session.token()).toBe('as-garage');
    expect(ctx.session.current()?.role).toBe('garage');
  });

  it('shows nothing when a reload sent under a failed switch answers after sign-out', async () => {
    const ctx = await signedIn();
    const sw = await switching(ctx);
    const reload = held(ctx.meControllerMe);
    const reading = ctx.session.reload();
    sw.load.reject(new Error('offline'));
    await sw.outcome;

    await ctx.session.signOut();
    reload.resolve(GARAGE);
    await reading;

    expect(ctx.session.token()).toBeNull();
    expect(ctx.session.current()).toBeNull();
  });

  it('shows nothing when a reload sent before a failed switch answers after sign-out', async () => {
    const ctx = await signedIn();
    const early = held(ctx.meControllerMe);
    const reading = ctx.session.reload();
    const sw = await switching(ctx);
    sw.load.reject(new Error('offline'));
    await sw.outcome;

    await ctx.session.signOut();
    early.resolve(DRIVER);
    await reading;

    expect(ctx.session.token()).toBeNull();
    expect(ctx.session.current()).toBeNull();
  });

  it('drops the same reload answer on a second identical failed switch', async () => {
    const ctx = await signedIn();
    for (let lap = 0; lap < 2; lap++) {
      const sw = await switching(ctx);
      const reload = held(ctx.meControllerMe);
      const reading = ctx.session.reload();
      sw.load.reject(new Error('offline'));
      await sw.outcome;
      reload.resolve(GARAGE);
      await reading;

      expect(ctx.session.token()).toBe('signed-in');
      expect(ctx.session.current()).toBe(DRIVER);
    }
  });
});
