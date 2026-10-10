import { TestBed } from '@angular/core/testing';
import { AuthService, MeService } from '@motor-fix/data-access';

import { Session } from './session';

function setup() {
  let answer: (value?: unknown) => void = () => undefined;
  let refuse: (error: unknown) => void = () => undefined;
  const api = {
    authControllerRefresh: jest.fn(() => Promise.reject(new Error('401'))),
    passwordChangeControllerChange: jest.fn(
      () =>
        new Promise((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe: jest.fn() } },
      { provide: AuthService, useValue: api },
    ],
  });
  return {
    answer: () => answer(),
    api,
    refuse: (error: unknown) => refuse(error),
    session: TestBed.inject(Session),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => jest.useRealTimers());

// @traces 139-FR-014
describe('changing the password from this tab', () => {
  it('sends the passwords to the password change', async () => {
    const { answer, api, session } = setup();

    const done = session.changePassword({
      currentPassword: 'veche',
      newPassword: 'parola-noua',
    });
    answer();
    await done;

    expect(api.passwordChangeControllerChange).toHaveBeenCalledWith({
      body: { currentPassword: 'veche', newPassword: 'parola-noua' },
    });
  });

  it('keeps this tab signed in through the sign-out it sends the others, while it is sent and for a while after', async () => {
    jest.useFakeTimers({ now: 0 });
    const { answer, session } = setup();
    expect(session.keepsThroughRevoke()).toBe(false);

    const done = session.changePassword({ newPassword: 'parola-noua' });
    expect(session.keepsThroughRevoke()).toBe(true);
    answer();
    await done;
    expect(session.keepsThroughRevoke()).toBe(true);

    jest.advanceTimersByTime(60_000);
    expect(session.keepsThroughRevoke()).toBe(false);
  });

  it('stops keeping it when the change is refused', async () => {
    const { refuse, session } = setup();

    const done = session.changePassword({ newPassword: 'parola-noua' });
    refuse(new Error('invalid_credentials'));
    await expect(done).rejects.toThrow('invalid_credentials');
    await tick();

    expect(session.keepsThroughRevoke()).toBe(false);
  });
});
