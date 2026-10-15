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
import { publicRead } from './public-read';
import { SignInDialog } from './sign-in/sign-in-dialog';

let server: HttpTestingController;

function setup(token: string | null) {
  const session = { renew: jest.fn(async () => true), token: () => token };
  const gate = jest.fn(async () => true);
  const platformStatus = { on: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Session, useValue: session },
      { provide: PlatformStatus, useValue: platformStatus },
      { provide: SignInDialog, useValue: { gate } },
      { provide: PLATFORM_ID, useValue: 'browser' },
    ],
  });
  server = TestBed.inject(HttpTestingController);
  return { gate, http: TestBed.inject(HttpClient), platformStatus, session };
}

const origin = location.origin;
const otherPort = `${location.protocol}//${location.hostname}:65111`;
const unauthorized = { status: 401, statusText: 'Unauthorized' };
const signInRequired = {
  body: { code: 'sign_in_required', status: 401 },
  init: unauthorized,
};

afterEach(() => server.verify());

// @traces 1200-transfer-cache-origin-FR-003
describe('authInterceptor path judgement', () => {
  it.each([
    ['/api/v1/auth/../me'],
    [`${origin}/api/v1/auth/../me`],
    ['/api/v1/./me'],
    [`${origin.toUpperCase()}/api/v1/me`],
    ['/api/v1/me#fragment'],
    ['/api/v1/me?next=/api/v1/auth/sign-in'],
  ])('sends the token for %s, which resolves to the API', (address) => {
    const { http } = setup('abc');

    http.get(address).subscribe();
    const call = server.expectOne(() => true);

    expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
    call.flush({});
  });

  it.each([
    ['/api/v1/x/../auth/sign-in'],
    [`${origin}/api/v1/x/../auth/refresh`],
    ['/api/v1/./auth/sign-out'],
    ['/api/v1/x/%2e%2e/auth/sign-in'],
    ['/api/v1/auth/sign-in?x=/api/v1/auth/password'],
  ])(
    'sends no token for %s, which resolves to a signed-out auth route',
    (address) => {
      const { http } = setup('abc');

      http.post(address, {}).subscribe();
      const call = server.expectOne(() => true);

      expect(call.request.headers.has('Authorization')).toBe(false);
      call.flush({});
    },
  );

  it.each([
    ['/API/v1/me'],
    ['/Api/v1/me'],
    ['/api'],
    ['/apix/v1/me'],
    ['/x/api/v1/me'],
    ['/v1/me?path=/api/v1/me'],
    ['//evil.example/api/v1/me'],
    ['\\\\evil.example/api/v1/me'],
    [`${location.protocol}//${location.host}@evil.example/api/v1/me`],
    [`${otherPort}/api/v1/me`],
    [`${location.protocol}//${location.hostname}.evil.example/api/v1/me`],
    ['https://evil.example/api/v1/me'],
  ])('sends no token for %s', (address) => {
    const { http } = setup('abc');

    http.get(address).subscribe();
    const call = server.expectOne(() => true);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it('opens no dialog and renews nothing for a refusal from another port', async () => {
    const { gate, http, session } = setup('abc');

    const answer = firstValueFrom(http.get(`${otherPort}/api/v1/me`));
    server.expectOne(() => true).flush({}, unauthorized);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('opens no dialog when who-am-I is asked by a dotted path', async () => {
    const { gate, http } = setup(null);

    const answer = firstValueFrom(http.get('/api/v1/auth/../me'));
    server
      .expectOne(() => true)
      .flush(signInRequired.body, signInRequired.init);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(gate).not.toHaveBeenCalled();
  });

  it('still asks to sign in for a POST to the who-am-I path', async () => {
    const { gate, http, session } = setup(null);
    session.renew.mockResolvedValue(false);

    const answer = firstValueFrom(http.post(`${origin}/api/v1/me`, {}));
    server
      .expectOne(() => true)
      .flush(signInRequired.body, signInRequired.init);
    await Promise.resolve();

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(gate).toHaveBeenCalledTimes(1);
  });
});

// @traces 1200-transfer-cache-origin-FR-004
describe('authInterceptor and a marked request in odd places', () => {
  it.each([
    ['/api/v1/auth/password'],
    [`${origin}/api/v1/auth/assistant/approve`],
    ['/api/v1/me'],
    [`${origin}/api/v1/garages/a-b?brand=x`],
  ])('sends a marked call to %s without the token', (address) => {
    const { http } = setup('abc');

    http.get(address, { context: publicRead() }).subscribe();
    const call = server.expectOne(() => true);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it('sends a marked call without the token when nobody is signed in', () => {
    const { http } = setup(null);

    http.get('/api/v1/garages/a-b', { context: publicRead() }).subscribe();
    const call = server.expectOne(() => true);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it('strips an Authorization header the caller set on a marked call', () => {
    const { http } = setup('abc');

    http
      .get('/api/v1/garages/a-b', {
        context: publicRead(),
        headers: { Authorization: 'Bearer caller' },
      })
      .subscribe();
    const call = server.expectOne(() => true);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it('does not leak the token to another origin on a marked call', () => {
    const { http } = setup('abc');

    http
      .get('https://evil.example/api/v1/garages/a-b', {
        context: publicRead(),
      })
      .subscribe();
    const call = server.expectOne(() => true);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush({});
  });

  it('opens no dialog and renews nothing for a marked absolute call refused 401 with a token held', async () => {
    const { gate, http, session } = setup('abc');

    const answer = firstValueFrom(
      http.get(`${origin}/api/v1/garages/a-b`, { context: publicRead() }),
    );
    server.expectOne(() => true).flush({}, unauthorized);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
  });

  it('shows the maintenance page once for a marked absolute call refused for maintenance', async () => {
    const { http, platformStatus } = setup('abc');

    const answer = firstValueFrom(
      http.get(`${origin}/api/v1/garages/a-b`, { context: publicRead() }),
    );
    server
      .expectOne(() => true)
      .flush(
        { code: 'maintenance', status: 503 },
        { status: 503, statusText: 'Service Unavailable' },
      );

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).toHaveBeenCalledTimes(1);
  });

  it('keeps the mark per call: a marked call does not strip the token of the next unmarked one', () => {
    const { http } = setup('abc');

    http.get('/api/v1/garages/a-b', { context: publicRead() }).subscribe();
    http.get('/api/v1/garages/a-b').subscribe();
    const [marked, plain] = server.match(() => true);

    expect(marked?.request.headers.has('Authorization')).toBe(false);
    expect(plain?.request.headers.get('Authorization')).toBe('Bearer abc');
    marked?.flush({});
    plain?.flush({});
  });
});
