import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const GARAGE = {
  capabilities: ['garage.requests', 'garage.team'],
  city: null,
  email: 'ioana@example.ro',
  emailConfirmed: true,
  garageAccess: [],
  garageId: 'garage-1',
  id: 'account-1',
  landing: '/app/garage',
  language: 'ro',
  name: 'Ioana Pop',
  role: 'garage',
  roles: ['driver', 'garage'],
} as MeDto;

const DRIVER = {
  ...GARAGE,
  capabilities: [],
  garageAccess: [],
  garageId: null,
  id: 'account-2',
  landing: '/app/driver',
  name: 'Andrei Marin',
  role: 'driver',
  roles: ['driver'],
} as MeDto;

function setup() {
  const authControllerRefresh = jest.fn(() =>
    Promise.resolve({ accessToken: 'renewed' }),
  );
  const meControllerMe = jest.fn(() => Promise.resolve(GARAGE));
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      {
        provide: AuthService,
        useValue: {
          authControllerRefresh,
          authControllerSignIn: jest.fn(() =>
            Promise.resolve({ accessToken: 'signed-in' }),
          ),
          authControllerSignOut: jest.fn(() => Promise.resolve()),
        },
      },
    ],
  });
  return {
    authControllerRefresh,
    meControllerMe,
    session: TestBed.inject(Session),
  };
}

// A dialog the test closes when it wants to.
function gate() {
  let close: (signedIn: boolean) => void = () => undefined;
  const open = new Promise<boolean>((resolve) => {
    close = resolve;
  });
  return { close, open };
}

// Signed in, then the renewal fails: the session forgets the account.
async function lapsed() {
  const setupped = setup();
  await setupped.session.load();
  setupped.authControllerRefresh.mockRejectedValueOnce(new Error('expired'));
  await setupped.session.renew();
  return setupped;
}

describe('the account on screen behind the gate dialog', () => {
  it('shows the session account while the session holds one', async () => {
    const { session } = setup();
    expect(session.shown()).toBeNull();

    await session.load();

    expect(session.shown()).toBe(GARAGE);
  });

  it('keeps the account a failed renewal forgot while the gate is open, and lets it go when it closes', async () => {
    const { session } = await lapsed();
    expect(session.current()).toBeNull();
    const dialog = gate();

    const waiting = session.keepShownWhile(dialog.open);
    expect(session.shown()).toBe(GARAGE);
    expect(session.current()).toBeNull();
    expect(session.token()).toBeNull();

    dialog.close(false);
    await expect(waiting).resolves.toBe(false);
    expect(session.shown()).toBeNull();
  });

  it('shows the kept account until the sign-in has loaded the new one, then the new one', async () => {
    const { meControllerMe, session } = await lapsed();
    const dialog = gate();
    const waiting = session.keepShownWhile(dialog.open);

    meControllerMe.mockResolvedValueOnce(DRIVER);
    const signingIn = session.signIn('andrei@example.ro', 'parola', false);
    expect(session.shown()).toBe(GARAGE);
    await signingIn;
    expect(session.shown()).toBe(DRIVER);

    dialog.close(true);
    await waiting;
    expect(session.shown()).toBe(DRIVER);
  });

  it('lets the kept account go at sign-out while the gate is open', async () => {
    const { session } = await lapsed();
    const dialog = gate();
    const waiting = session.keepShownWhile(dialog.open);

    await session.signOut();

    expect(session.shown()).toBeNull();
    dialog.close(false);
    await waiting;
    expect(session.shown()).toBeNull();
  });

  it('keeps nothing when the gate opens with no account forgotten', async () => {
    const { session } = setup();
    const dialog = gate();

    const waiting = session.keepShownWhile(dialog.open);

    expect(session.shown()).toBeNull();
    dialog.close(false);
    await waiting;
  });

  it('keeps nothing after a sign-out, even when a renewal had failed before it', async () => {
    const { session } = await lapsed();
    await session.signOut();
    const dialog = gate();

    const waiting = session.keepShownWhile(dialog.open);

    expect(session.shown()).toBeNull();
    dialog.close(false);
    await waiting;
  });

  it('keeps nothing the next time the gate opens once it was closed without a sign-in', async () => {
    const { session } = await lapsed();
    const first = gate();
    const closing = session.keepShownWhile(first.open);
    first.close(false);
    await closing;

    const second = gate();
    const waiting = session.keepShownWhile(second.open);

    expect(session.shown()).toBeNull();
    second.close(false);
    await waiting;
  });

  it('lets the kept account go when the gate fails to open', async () => {
    const { session } = await lapsed();

    const failed = Promise.reject(new Error('overlay failed'));
    failed.catch(() => undefined);

    await expect(session.keepShownWhile(failed)).rejects.toThrow(
      'overlay failed',
    );

    expect(session.shown()).toBeNull();
  });
});
