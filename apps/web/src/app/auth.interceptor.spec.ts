import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { Session } from './dashboard/session';
import { PlatformStatus } from './maintenance/platform-status';
import { SignInDialog } from './sign-in/sign-in-dialog';

let controller: HttpTestingController | undefined;

function setup(
  token: string | null,
  renewsTo: string | null = 'fresh',
  { signsIn = true, platform = 'browser' } = {},
) {
  let current = token;
  const session = {
    renew: jest.fn(async () => {
      current = renewsTo;
      return renewsTo !== null;
    }),
    token: () => current,
  };
  let settle: (signedIn: boolean) => void = () => undefined;
  const outcome = new Promise<boolean>((resolve) => {
    settle = (signedIn) => {
      if (signedIn) current = 'signed-in';
      resolve(signedIn);
    };
  });
  const gate = jest.fn(() => outcome);
  const platformStatus = { on: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Session, useValue: session },
      { provide: PlatformStatus, useValue: platformStatus },
      { provide: SignInDialog, useValue: { gate } },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  controller = TestBed.inject(HttpTestingController);
  return {
    close: () => settle(false),
    gate,
    http: TestBed.inject(HttpClient),
    platformStatus,
    server: controller,
    session,
    signIn: () => settle(signsIn),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

const signInRequired = {
  body: { code: 'sign_in_required', status: 401 },
  options: { status: 401, statusText: 'Unauthorized' },
};

const unauthorized = { status: 401, statusText: 'Unauthorized' };

afterEach(() => controller?.verify());

describe('authInterceptor', () => {
  it('sends the access token with an API call', async () => {
    const { http, server } = setup('abc');

    const answer = firstValueFrom(http.get('/api/v1/me'));
    const call = server.expectOne('/api/v1/me');
    call.flush({ ok: true });

    expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
    expect(await answer).toEqual({ ok: true });
  });

  it.each([
    '/api/v1/auth/sign-in',
    '/api/v1/auth/refresh',
    '/api/v1/auth/sign-out',
    '/assets/logo.svg',
    'https://cdn.example.com/api/v1/me',
    'http://api.internal:3000/api/v1/me',
  ])('sends no token to %s', (url) => {
    const { http, server } = setup('abc');

    http.post(url, {}).subscribe({ error: () => undefined });
    const call = server.expectOne(url);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  // @traces 365-FR-014
  it('sends the token with the assistant approval, a signed-in call under auth', () => {
    const { http, server } = setup('abc');

    http.post('/api/v1/auth/assistant/approve', {}).subscribe();
    const call = server.expectOne('/api/v1/auth/assistant/approve');

    expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
    call.flush({});
  });

  // @traces 139-FR-014
  it('sends the token with the password change, a signed-in call under auth', () => {
    const { http, server } = setup('abc');

    http.post('/api/v1/auth/password', {}).subscribe();
    const call = server.expectOne('/api/v1/auth/password');

    expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
    call.flush({});
  });

  // @traces 139-FR-015
  it('passes a wrong password on without renewing, so it is not sent and counted twice', async () => {
    const { http, server, session } = setup('abc');

    const answer = firstValueFrom(http.post('/api/v1/auth/password', {}));
    server
      .expectOne('/api/v1/auth/password')
      .flush(
        { code: 'invalid_credentials', status: 401 },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).not.toHaveBeenCalled();
    server.expectNone('/api/v1/auth/password');
  });

  it.each(['/api/v1/auth/assistant/token', '/api/v1/auth/assistant/authorize'])(
    'sends no token to the identity server call %s',
    (url) => {
      const { http, server } = setup('abc');

      http.post(url, {}).subscribe({ error: () => undefined });
      const call = server.expectOne(url);

      expect(call.request.headers.has('Authorization')).toBe(false);
      call.flush({});
    },
  );

  it('sends nothing extra when nobody is signed in', () => {
    const { http, server } = setup(null);

    http.get('/api/v1/health/ready').subscribe();
    const call = server.expectOne('/api/v1/health/ready');

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it('renews once on a 401 and repeats the call with the new token', async () => {
    const { http, server, session } = setup('expired');

    const answer = firstValueFrom(http.get('/api/v1/me'));
    server.expectOne('/api/v1/me').flush({}, unauthorized);
    await new Promise((resolve) => setTimeout(resolve));
    const retry = server.expectOne('/api/v1/me');
    retry.flush({ name: 'Andrei' });

    expect(session.renew).toHaveBeenCalledTimes(1);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh');
    expect(await answer).toEqual({ name: 'Andrei' });
  });

  it('gives up after one renewal: a second 401 reaches the caller', async () => {
    const { http, server, session } = setup('expired');

    const answer = firstValueFrom(http.get('/api/v1/me'));
    server.expectOne('/api/v1/me').flush({}, unauthorized);
    await new Promise((resolve) => setTimeout(resolve));
    server.expectOne('/api/v1/me').flush({}, unauthorized);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).toHaveBeenCalledTimes(1);
  });

  it('passes the 401 on when the renewal fails', async () => {
    const { http, server } = setup('expired', null);

    const answer = firstValueFrom(http.get('/api/v1/me'));
    server.expectOne('/api/v1/me').flush({}, unauthorized);

    await expect(answer).rejects.toMatchObject({ status: 401 });
  });

  it('does not renew for a 401 to a call that carried no token', async () => {
    const { http, server, session } = setup(null);

    const answer = firstValueFrom(http.get('/api/v1/me'));
    server.expectOne('/api/v1/me').flush({}, unauthorized);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).not.toHaveBeenCalled();
  });

  it('does not renew for other errors', async () => {
    const { http, server, session } = setup('abc');

    const answer = firstValueFrom(http.get('/api/v1/me'));
    server
      .expectOne('/api/v1/me')
      .flush({}, { status: 403, statusText: 'Forbidden' });

    await expect(answer).rejects.toMatchObject({ status: 403 });
    expect(session.renew).not.toHaveBeenCalled();
  });

  describe('when an account call is refused for want of a session', () => {
    it('renews from the cookie first, even when the call carried no token', async () => {
      const { gate, http, server, session } = setup(null);

      const answer = firstValueFrom(http.patch('/api/v1/me', {}));
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);
      await tick();
      const retry = server.expectOne('/api/v1/me');
      retry.flush({ saved: true });

      expect(session.renew).toHaveBeenCalledTimes(1);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh');
      expect(await answer).toEqual({ saved: true });
      expect(gate).not.toHaveBeenCalled();
    });

    it('asks to sign in when the renewal fails, then sends the call again with the new token', async () => {
      const { gate, http, server, signIn } = setup('expired', null);

      const answer = firstValueFrom(http.patch('/api/v1/me', {}));
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);
      await tick();
      expect(gate).toHaveBeenCalledTimes(1);
      server.expectNone('/api/v1/me');

      signIn();
      await tick();
      const retry = server.expectOne('/api/v1/me');
      retry.flush({ saved: true });

      expect(retry.request.headers.get('Authorization')).toBe(
        'Bearer signed-in',
      );
      expect(await answer).toEqual({ saved: true });
    });

    it('passes the refusal on when the dialog is closed without signing in', async () => {
      const { close, http, server } = setup(null, null);

      const answer = firstValueFrom(http.patch('/api/v1/me', {}));
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);
      await tick();
      close();

      await expect(answer).rejects.toMatchObject({
        error: { code: 'sign_in_required' },
        status: 401,
      });
    });

    it('sends the call again only once: a second refusal reaches the caller', async () => {
      const { gate, http, server, signIn } = setup(null, null);

      const answer = firstValueFrom(http.patch('/api/v1/me', {}));
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);
      await tick();
      signIn();
      await tick();
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);

      await expect(answer).rejects.toMatchObject({ status: 401 });
      expect(gate).toHaveBeenCalledTimes(1);
    });

    it('lets calls refused together wait on the same sign-in and both go on', async () => {
      const { http, server, signIn } = setup(null, null);

      const first = firstValueFrom(http.patch('/api/v1/me', { a: 1 }));
      const second = firstValueFrom(http.get('/api/v1/audit-history'));
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);
      server
        .expectOne('/api/v1/audit-history')
        .flush(signInRequired.body, signInRequired.options);
      await tick();
      signIn();
      await tick();
      server.expectOne('/api/v1/me').flush({ one: true });
      server.expectOne('/api/v1/audit-history').flush({ two: true });

      expect(await first).toEqual({ one: true });
      expect(await second).toEqual({ two: true });
    });

    it.each([
      ['POST', '/api/v1/auth/sign-in'],
      ['POST', '/api/v1/auth/sign-up'],
      ['POST', '/api/v1/auth/refresh'],
      ['GET', '/api/v1/me'],
    ])('never asks to sign in for %s %s', async (method, url) => {
      const { gate, http, server } = setup(null, null);

      const answer = firstValueFrom(http.request(method, url, { body: {} }));
      server.expectOne(url).flush(signInRequired.body, signInRequired.options);

      await expect(answer).rejects.toMatchObject({ status: 401 });
      expect(gate).not.toHaveBeenCalled();
    });

    it.each([
      [403, 'account_suspended'],
      [404, 'not_found'],
      [429, 'too_many_attempts'],
      [503, 'maintenance'],
      [401, 'invalid_credentials'],
    ])('never asks to sign in for a %i %s', async (status, code) => {
      const { gate, http, server, session } = setup(null, null);

      const answer = firstValueFrom(http.patch('/api/v1/me', {}));
      server
        .expectOne('/api/v1/me')
        .flush({ code, status }, { status, statusText: code });

      await expect(answer).rejects.toMatchObject({ status });
      expect(gate).not.toHaveBeenCalled();
      expect(session.renew).not.toHaveBeenCalled();
    });

    it('never asks to sign in while the page is rendered on the server', async () => {
      const { gate, http, server } = setup(null, null, { platform: 'server' });

      const answer = firstValueFrom(http.patch('/api/v1/me', {}));
      server
        .expectOne('/api/v1/me')
        .flush(signInRequired.body, signInRequired.options);

      await expect(answer).rejects.toMatchObject({ status: 401 });
      expect(gate).not.toHaveBeenCalled();
    });
  });
});

describe('authInterceptor during maintenance', () => {
  it('shows the maintenance page on a call refused for maintenance, and still fails the call', async () => {
    const { http, platformStatus, server } = setup('abc');

    const answer = firstValueFrom(http.get('/api/v1/garages'));
    server
      .expectOne('/api/v1/garages')
      .flush(
        { code: 'maintenance', status: 503 },
        { status: 503, statusText: 'Service Unavailable' },
      );

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).toHaveBeenCalledTimes(1);
  });

  it('shows the page when the call sent again after a renewal is refused for maintenance', async () => {
    const { http, platformStatus, server } = setup('old');

    const answer = firstValueFrom(http.get('/api/v1/garages'));
    server.expectOne('/api/v1/garages').flush(null, unauthorized);
    await tick();
    server
      .expectOne('/api/v1/garages')
      .flush(
        { code: 'maintenance', status: 503 },
        { status: 503, statusText: 'Service Unavailable' },
      );

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, 'unavailable'],
    [500, 'maintenance'],
    [403, 'forbidden'],
  ])('leaves the page alone on a %i %s', async (status, code) => {
    const { http, platformStatus, server } = setup('abc');

    const answer = firstValueFrom(http.get('/api/v1/garages'));
    server
      .expectOne('/api/v1/garages')
      .flush({ code, status }, { status, statusText: code });

    await expect(answer).rejects.toMatchObject({ status });
    expect(platformStatus.on).not.toHaveBeenCalled();
  });
});
