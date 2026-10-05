import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const ME = {
  capabilities: [],
  email: 'andrei@example.ro',
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

// The browser's tabs, as far as BroadcastChannel goes: a message reaches
// every other channel of the same name, never its sender.
class Tabs {
  static open: Tabs[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    Tabs.open.push(this);
  }
  postMessage(data: unknown) {
    for (const tab of Tabs.open) {
      if (tab !== this && tab.name === this.name) {
        tab.onmessage?.({ data } as MessageEvent);
      }
    }
  }
  close() {
    Tabs.open = Tabs.open.filter((tab) => tab !== this);
  }
}

const offline = () =>
  Promise.reject(new HttpErrorResponse({ status: 0, statusText: 'Unknown' }));
const answered = (status: number) =>
  Promise.reject(new HttpErrorResponse({ status }));

function setup({ tabs = 1 } = {}) {
  const api = {
    authControllerRefresh: jest.fn(() =>
      Promise.resolve({ accessToken: 'renewed' }),
    ),
    authControllerSignIn: jest.fn(() =>
      Promise.resolve({ accessToken: 'signed-in' }),
    ),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
    authControllerSignOutEverywhere: jest.fn(() => Promise.resolve()),
    authControllerSignUp: jest.fn(() =>
      Promise.resolve({ accessToken: 'signed-up' }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MeService,
        useValue: { meControllerMe: jest.fn(() => Promise.resolve(ME)) },
      },
      { provide: AuthService, useValue: api },
    ],
  });
  const session = TestBed.inject(Session);
  // A second tab of the same browser: its own Session, the same cookie.
  const other =
    tabs > 1 ? TestBed.runInInjectionContext(() => new Session()) : session;
  return { api, other, session };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));
const PENDING = 'mf-sign-out-pending';

beforeEach(() => {
  localStorage.clear();
  Tabs.open = [];
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = Tabs;
});

afterEach(() => {
  delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
});

describe('signing out on all devices', () => {
  it('forgets the session and asks the server to end every session', async () => {
    const { api, session } = setup();
    await session.load();

    await session.signOutEverywhere();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(api.authControllerSignOut).not.toHaveBeenCalled();
    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });

  it('forgets the session even when the call fails', async () => {
    const { api, session } = setup();
    await session.load();
    api.authControllerSignOutEverywhere.mockImplementationOnce(() =>
      answered(500),
    );

    await session.signOutEverywhere();

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });
});

describe('the other tabs of this browser', () => {
  it.each([
    ['on this device', 'signOut'],
    ['on all devices', 'signOutEverywhere'],
  ] as const)('sign out when one tab signs out %s', async (_, how) => {
    const { other, session } = setup({ tabs: 2 });
    await session.load();
    await other.load();
    const ended = jest.fn();
    other.ended.subscribe(ended);

    await session[how]();

    expect(other.token()).toBeNull();
    expect(other.current()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('are not told when a tab forgets a session the server already revoked', async () => {
    const { api, other, session } = setup({ tabs: 2 });
    await session.load();
    await other.load();
    const ended = jest.fn();
    other.ended.subscribe(ended);

    session.revoked();
    await flush();

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
    expect(other.token()).not.toBeNull();
    expect(ended).not.toHaveBeenCalled();
    expect(api.authControllerSignOut).not.toHaveBeenCalled();
    expect(api.authControllerSignOutEverywhere).not.toHaveBeenCalled();
  });

  it('do not ask the server again: the tab that signed out did', async () => {
    const { api, other, session } = setup({ tabs: 2 });
    await session.load();
    await other.load();

    await session.signOut();
    await flush();

    expect(api.authControllerSignOut).toHaveBeenCalledTimes(1);
  });

  it('does not tell the tab that signed out that it ended', async () => {
    const { session } = setup();
    await session.load();
    const ended = jest.fn();
    session.ended.subscribe(ended);

    await session.signOut();

    expect(ended).not.toHaveBeenCalled();
  });

  it('let a renewal answered after the other tab signed out restore nothing', async () => {
    const { api, other, session } = setup({ tabs: 2 });
    let answerLate: (value: { accessToken: string }) => void = () => undefined;
    api.authControllerRefresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerLate = resolve;
        }),
    );
    const renewing = other.renew();

    await session.signOut();
    answerLate({ accessToken: 'late' });

    expect(await renewing).toBe(false);
    expect(other.token()).toBeNull();
  });

  it('works without BroadcastChannel, signing only this tab out', async () => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    const { other, session } = setup({ tabs: 2 });
    await session.load();
    await other.load();

    await session.signOut();

    expect(session.current()).toBeNull();
    expect(other.current()).not.toBeNull();
  });
});

describe('a sign-out that gets no answer', () => {
  it.each([
    ['offline', offline],
    ['a 503', () => answered(503)],
  ])('is kept pending when %s', async (_, failure) => {
    const { api, session } = setup();
    await session.load();
    api.authControllerSignOut.mockImplementationOnce(failure);

    await session.signOut();

    expect(localStorage.getItem(PENDING)).toBe('device');
  });

  it.each([
    ['204', () => Promise.resolve()],
    ['401', () => answered(401)],
  ])('is not kept after a %s answer', async (_, answer) => {
    const { api, session } = setup();
    await session.load();
    api.authControllerSignOutEverywhere.mockImplementationOnce(answer);

    await session.signOutEverywhere();

    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('is sent again when the connection returns, then dropped', async () => {
    const { api, session } = setup();
    await session.load();
    api.authControllerSignOutEverywhere.mockImplementationOnce(offline);
    await session.signOutEverywhere();
    expect(localStorage.getItem(PENDING)).toBe('everywhere');

    window.dispatchEvent(new Event('online'));
    await flush();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('stays pending when the retry gets no answer either', async () => {
    const { api, session } = setup();
    await session.load();
    api.authControllerSignOut
      .mockImplementationOnce(offline)
      .mockImplementationOnce(offline);
    await session.signOut();

    window.dispatchEvent(new Event('online'));
    await flush();

    expect(localStorage.getItem(PENDING)).toBe('device');
  });

  it('is sent before the next session renews from the cookie', async () => {
    localStorage.setItem(PENDING, 'device');
    const { api, session } = setup();
    const order: string[] = [];
    api.authControllerSignOut.mockImplementationOnce(async () => {
      order.push('sign-out');
    });
    api.authControllerRefresh.mockImplementationOnce(async () => {
      order.push('refresh');
      return { accessToken: 'renewed' };
    });

    await session.load();

    expect(order).toEqual(['sign-out', 'refresh']);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it.each([
    ['sign-in', (s: Session) => s.signIn('andrei@example.ro', 'parola', true)],
    [
      'sign-up',
      (s: Session) =>
        s.signUp('Andrei', 'andrei@example.ro', 'parola-lunga', 'ro'),
    ],
  ])('is sent before a %s, so it never ends the new session', async (_, start) => {
    localStorage.setItem(PENDING, 'everywhere');
    const { api, session } = setup();
    const order: string[] = [];
    api.authControllerSignOutEverywhere.mockImplementationOnce(async () => {
      order.push('sign-out-everywhere');
    });
    api.authControllerSignIn.mockImplementationOnce(async () => {
      order.push('start');
      return { accessToken: 'signed-in' };
    });
    api.authControllerSignUp.mockImplementationOnce(async () => {
      order.push('start');
      return { accessToken: 'signed-up' };
    });

    await start(session);

    expect(order).toEqual(['sign-out-everywhere', 'start']);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it.each([
    ['sign-in', (s: Session) => s.signIn('andrei@example.ro', 'parola', true)],
    [
      'sign-up',
      (s: Session) =>
        s.signUp('Andrei', 'andrei@example.ro', 'parola-lunga', 'ro'),
    ],
  ])('is dropped once a %s succeeds, even when its retry got no answer, so it never ends the new session', async (_, start) => {
    localStorage.setItem(PENDING, 'everywhere');
    const { api, session } = setup();
    api.authControllerSignOutEverywhere.mockImplementationOnce(() =>
      answered(503),
    );

    await start(session);
    await session.load();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PENDING)).toBeNull();
    expect(session.token()).not.toBeNull();
  });

  it('is not kept by a retry that was on its way while a sign-in started a new session', async () => {
    const { api, session } = setup();
    let answerSignIn: (value: { accessToken: string }) => void = () =>
      undefined;
    api.authControllerSignIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerSignIn = resolve;
        }),
    );
    let failRetry: () => void = () => undefined;
    api.authControllerSignOutEverywhere.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failRetry = () => reject(new HttpErrorResponse({ status: 503 }));
        }),
    );
    const signingIn = session.signIn('andrei@example.ro', 'parola', true);
    await flush();
    localStorage.setItem(PENDING, 'everywhere');
    window.dispatchEvent(new Event('online'));
    await flush();

    answerSignIn({ accessToken: 'signed-in' });
    await flush();
    failRetry();
    await signingIn;
    await session.load();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});
