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
          authControllerSignOut: jest.fn(() => Promise.resolve()),
        },
      },
    ],
  });
  return { meControllerMe, session: TestBed.inject(Session) };
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

  it('does nothing signed out', async () => {
    const { meControllerMe, session } = setup();

    await session.reload();

    expect(meControllerMe).not.toHaveBeenCalled();
    expect(session.current()).toBeNull();
  });
});
