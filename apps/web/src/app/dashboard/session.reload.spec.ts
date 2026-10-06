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
  roles: ['driver'],
} as MeDto;

const GARAGE = {
  ...DRIVER,
  garageId: 'garage-1',
  landing: '/app/garage',
  role: 'garage',
  roles: ['driver', 'garage'],
} as MeDto;

function setup() {
  const meControllerMe = jest.fn(() => Promise.resolve(DRIVER));
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      {
        provide: AuthService,
        useValue: {
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
        },
      },
    ],
  });
  return { meControllerMe, session: TestBed.inject(Session) };
}

// The next read of the account waits until the test answers it.
function held(meControllerMe: jest.Mock) {
  let answer: (me: MeDto) => void = () => undefined;
  meControllerMe.mockImplementationOnce(
    () =>
      new Promise<MeDto>((resolve) => {
        answer = resolve;
      }),
  );
  return (me: MeDto) => answer(me);
}

describe('reading the account again', () => {
  it('replaces the account with what the server now says, keeping it on screen meanwhile', async () => {
    const { meControllerMe, session } = setup();
    await session.load();
    let answer: (me: MeDto) => void = () => undefined;
    meControllerMe.mockImplementationOnce(
      () =>
        new Promise<MeDto>((resolve) => {
          answer = resolve;
        }),
    );

    const reading = session.reload();
    expect(session.current()).toBe(DRIVER);
    const confirmed = { ...DRIVER, emailConfirmed: true };
    answer(confirmed);
    await reading;

    expect(session.current()).toEqual(confirmed);
  });

  it('keeps the account it has when the server does not answer', async () => {
    const { meControllerMe, session } = setup();
    await session.load();
    meControllerMe.mockRejectedValueOnce(new Error('offline'));

    await session.reload();

    expect(session.current()).toBe(DRIVER);
  });

  it('restores nothing after a sign-out', async () => {
    const { meControllerMe, session } = setup();
    await session.load();
    let answer: (me: MeDto) => void = () => undefined;
    meControllerMe.mockImplementationOnce(
      () =>
        new Promise<MeDto>((resolve) => {
          answer = resolve;
        }),
    );

    const reading = session.reload();
    await session.signOut();
    answer({ ...DRIVER, emailConfirmed: true });
    await reading;

    expect(session.current()).toBeNull();
  });

  it('keeps the role switched to when the old role answers late', async () => {
    const { meControllerMe, session } = setup();
    await session.load();
    const answer = held(meControllerMe);

    const reading = session.reload();
    meControllerMe.mockResolvedValueOnce(GARAGE);
    await session.switchRole('garage');
    answer({ ...DRIVER, emailConfirmed: true });
    await reading;

    expect(session.token()).toBe('as-garage');
    expect(session.current()).toBe(GARAGE);
  });

  it('keeps the account signed in meanwhile when the old session answers late', async () => {
    const { meControllerMe, session } = setup();
    await session.load();
    const answer = held(meControllerMe);
    const other = { ...DRIVER, id: 'account-2', name: 'Ioana Pop' } as MeDto;

    const reading = session.reload();
    meControllerMe.mockResolvedValueOnce(other);
    await session.signIn('ioana@example.ro', 'parola-lunga', false);
    answer(DRIVER);
    await reading;

    expect(session.current()).toBe(other);
  });

  it('does nothing signed out', async () => {
    const { meControllerMe, session } = setup();

    await session.reload();

    expect(meControllerMe).not.toHaveBeenCalled();
    expect(session.current()).toBeNull();
  });
});
