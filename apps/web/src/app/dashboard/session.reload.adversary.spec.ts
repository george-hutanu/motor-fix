import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const DRIVER = {
  capabilities: [],
  city: null,
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

describe('reading the account again, under overlapping changes', () => {
  it('accepts a reload sent after the switch even though an older one is still pending', async () => {
    const { meControllerMe, session } = await signedIn();
    const stale = held(meControllerMe);
    const staleReading = session.reload();
    meControllerMe.mockResolvedValueOnce(GARAGE);
    await session.switchRole('garage');
    const fresh = { ...GARAGE, emailConfirmed: true };
    meControllerMe.mockResolvedValueOnce(fresh);

    await session.reload();
    stale.resolve(DRIVER);
    await staleReading;

    expect(session.current()).toEqual(fresh);
  });

  it('lets a reload that answers mid-switch land, then the switch replaces it', async () => {
    const { meControllerMe, session } = await signedIn();
    const reloadAnswer = held(meControllerMe);
    const reading = session.reload();
    const switchedLoad = held(meControllerMe);

    const switching = session.switchRole('garage');
    await Promise.resolve();
    await Promise.resolve();
    const confirmed = { ...DRIVER, emailConfirmed: true };
    reloadAnswer.resolve(confirmed);
    await reading;
    expect(session.current()).toEqual(confirmed);
    switchedLoad.resolve(GARAGE);
    await switching;

    expect(session.current()).toBe(GARAGE);
  });

  it('keeps the switched account when a reload sent during the switch load answers with the new role', async () => {
    const { meControllerMe, session } = await signedIn();
    const switchedLoad = held(meControllerMe);
    const switching = session.switchRole('garage');
    await Promise.resolve();
    await Promise.resolve();
    const confirmed = { ...GARAGE, emailConfirmed: true };
    meControllerMe.mockResolvedValueOnce(confirmed);

    await session.reload();
    switchedLoad.resolve(GARAGE);
    await switching;

    expect(session.token()).toBe('as-garage');
    expect(session.current()?.role).toBe('garage');
  });

  it('accepts the answer when a failed switch put the original token back', async () => {
    const { meControllerMe, session } = await signedIn();
    const before = session.token();
    await session.load();
    const reloadAnswer = held(meControllerMe);
    const reading = session.reload();
    meControllerMe.mockRejectedValueOnce(new Error('offline'));

    await expect(session.switchRole('garage')).rejects.toThrow('offline');
    const confirmed = { ...DRIVER, emailConfirmed: true };
    reloadAnswer.resolve(confirmed);
    await reading;

    expect(session.token()).toBe(before);
    expect(session.current()).toEqual(confirmed);
  });

  it('drops a reload sent under the switched token once the switch fails and puts the old one back', async () => {
    const { meControllerMe, session } = await signedIn();
    const before = session.token();
    const switchedLoad = held(meControllerMe);
    const switching = session.switchRole('garage');
    await Promise.resolve();
    await Promise.resolve();
    expect(session.token()).toBe('as-garage');
    const reloadAnswer = held(meControllerMe);
    const reading = session.reload();

    switchedLoad.reject(new Error('offline'));
    await expect(switching).rejects.toThrow('offline');
    reloadAnswer.resolve(GARAGE);
    await reading;

    expect(session.token()).toBe(before);
    expect(session.current()).toBe(DRIVER);
  });
});

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

  it('drops a reload sent under a second switch, whose own load decides the account', async () => {
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
    expect(ctx.session.current()).toBe(GARAGE);
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
});
