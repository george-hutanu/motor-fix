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
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from './auth.interceptor';
import { Session } from './dashboard/session';

let controller: HttpTestingController | undefined;

function setup(token: string | null, renewsTo: string | null = 'fresh') {
  let current = token;
  const session = {
    renew: jest.fn(async () => {
      current = renewsTo;
      return renewsTo !== null;
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
});
