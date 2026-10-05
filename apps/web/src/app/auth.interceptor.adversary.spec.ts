import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, MeService } from '@motor-fix/data-access';
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { Session } from './dashboard/session';

let controller: HttpTestingController | undefined;
const unauthorized = { status: 401, statusText: 'Unauthorized' };
const tick = () => new Promise((resolve) => setTimeout(resolve));

function fakeSession(token: string | null, renew: () => Promise<boolean>) {
  let current = token;
  const session = {
    renew: jest.fn(async () => {
      const ok = await renew();
      current = ok ? 'fresh' : null;
      return ok;
    }),
    token: () => current,
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Session, useValue: session },
    ],
  });
  controller = TestBed.inject(HttpTestingController);
  return { http: TestBed.inject(HttpClient), server: controller, session };
}

function realSession(token: string | null) {
  const api = {
    authControllerRefresh: jest.fn(() =>
      Promise.resolve({ accessToken: 'fresh' }),
    ),
    authControllerSignIn: jest.fn(() =>
      Promise.resolve({ accessToken: token }),
    ),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: api },
      { provide: MeService, useValue: { meControllerMe: jest.fn() } },
    ],
  });
  controller = TestBed.inject(HttpTestingController);
  return { api, http: TestBed.inject(HttpClient), server: controller };
}

afterEach(() => controller?.verify());

describe('authInterceptor against odd addresses', () => {
  it.each([
    '//evil.example/api/v1/me',
    'HTTPS://cdn.example.com/api/v1/me',
    'ftp://example.com/api/v1/me',
    '/api/v1/auth/sign-in?next=/app',
    '/api/v1/auth/refresh#x',
  ])('sends no token to %s', (url) => {
    const { http, server } = fakeSession('abc', async () => true);

    http.get(url).subscribe({ error: () => undefined });
    const call = server.expectOne(() => true);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it.each([
    '/api/v1/author',
    '/api/v1/authorisations',
    '/api/v1/me?x=/auth/refresh',
  ])(
    'sends the token to %s, which is not one of the three auth calls',
    (url) => {
      const { http, server } = fakeSession('abc', async () => true);

      http.get(url).subscribe();
      const call = server.expectOne(() => true);

      expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
      call.flush({});
    },
  );
});

describe('authInterceptor on a 401', () => {
  it.each([
    '/api/v1/auth/sign-in',
    '/api/v1/auth/refresh',
    '/api/v1/auth/sign-out',
  ])('does not renew or retry when %s answers 401', async (url) => {
    const { http, server, session } = fakeSession('abc', async () => true);

    const answer = firstValueFrom(http.post(url, {}));
    server.expectOne(url).flush({ code: 'invalid_credentials' }, unauthorized);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).not.toHaveBeenCalled();
  });

  it('repeats a POST with the same method, body and address after renewing', async () => {
    const { http, server } = fakeSession('expired', async () => true);

    const answer = firstValueFrom(http.post('/api/v1/vehicles', { vin: 'X1' }));
    server.expectOne('/api/v1/vehicles').flush({}, unauthorized);
    await tick();
    const retry = server.expectOne('/api/v1/vehicles');
    retry.flush({ id: 1 });

    expect(retry.request.method).toBe('POST');
    expect(retry.request.body).toEqual({ vin: 'X1' });
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh');
    expect(await answer).toEqual({ id: 1 });
  });

  it('hands the caller the original 401, not a hang, when the renewal itself throws', async () => {
    const { http, server } = fakeSession('expired', async () => {
      throw new Error('network');
    });

    const answer = firstValueFrom(http.get('/api/v1/me'));
    server.expectOne('/api/v1/me').flush({}, unauthorized);

    await expect(answer).rejects.toBeDefined();
  });

  it('does not repeat a call that failed with 500, 403 or 404 after a renewal', async () => {
    const { http, server, session } = fakeSession('abc', async () => true);

    for (const status of [500, 403, 404]) {
      const answer = firstValueFrom(http.get(`/api/v1/me?s=${status}`));
      server
        .expectOne(`/api/v1/me?s=${status}`)
        .flush({}, { status, statusText: 'x' });
      await expect(answer).rejects.toMatchObject({ status });
    }

    expect(session.renew).not.toHaveBeenCalled();
  });

  it('renews once for several calls that fail at the same moment, and repeats each with the new token', async () => {
    const { api, http, server } = realSession('expired');
    const session = TestBed.inject(Session);
    await session.signIn('a@b.ro', 'x', true).catch(() => undefined);

    const answers = [1, 2, 3].map((n) =>
      firstValueFrom(http.get(`/api/v1/items/${n}`)),
    );
    for (const n of [1, 2, 3]) {
      server.expectOne(`/api/v1/items/${n}`).flush({}, unauthorized);
    }
    await tick();
    for (const n of [1, 2, 3]) {
      const retry = server.expectOne(`/api/v1/items/${n}`);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh');
      retry.flush({ n });
    }

    expect(await Promise.all(answers)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(api.authControllerRefresh).toHaveBeenCalledTimes(1);
  });

  it('never loops: a retried call that 401s again reaches the caller after exactly one renewal', async () => {
    const { http, server, session } = fakeSession('expired', async () => true);

    const answer = firstValueFrom(http.get('/api/v1/me')).catch((e) => e);
    server.expectOne('/api/v1/me').flush({}, unauthorized);
    await tick();
    server.expectOne('/api/v1/me').flush({}, unauthorized);
    await tick();

    expect(await answer).toMatchObject({ status: 401 });
    expect(session.renew).toHaveBeenCalledTimes(1);
    server.expectNone('/api/v1/me');
  });
});
