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

function setup(token: string | null) {
  const session = { renew: jest.fn(async () => false), token: () => token };
  const gate = jest.fn(async () => false);
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
  controller = TestBed.inject(HttpTestingController);
  return {
    gate,
    http: TestBed.inject(HttpClient),
    platformStatus,
    server: controller,
    session,
  };
}

const down = { status: 503, statusText: 'Service Unavailable' };
const problem = {
  code: 'maintenance',
  detail: 'MotorFix is down for maintenance',
  retryAfterSeconds: 300,
  status: 503,
  title: 'Service Unavailable',
  type: 'about:blank',
};

afterEach(() => {
  controller?.verify();
  controller = undefined;
});

describe('authInterceptor maintenance handling under odd answers', () => {
  it.each([
    ['null', null],
    ['an empty object', {}],
    ['an array', [problem]],
    ['a plain string', 'maintenance'],
    ['a code in capitals', { ...problem, code: 'MAINTENANCE' }],
    ['a code nested in a detail', { detail: { code: 'maintenance' } }],
  ])('leaves the page alone on a 503 with %s', async (_title, body) => {
    const { http, platformStatus, server } = setup('abc');

    const answer = firstValueFrom(http.get('/api/v1/garages'));
    server.expectOne('/api/v1/garages').flush(body, down);

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).not.toHaveBeenCalled();
  });

  it('shows the page on the full refusal body the API sends', async () => {
    const { http, platformStatus, server } = setup('abc');

    const answer = firstValueFrom(http.get('/api/v1/garages'));
    server.expectOne('/api/v1/garages').flush(problem, down);

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).toHaveBeenCalledTimes(1);
  });

  it('shows the page for a visitor with no token, without asking to sign in or renewing', async () => {
    const { gate, http, platformStatus, server, session } = setup(null);

    const answer = firstValueFrom(http.get('/api/v1/garages'));
    server.expectOne('/api/v1/garages').flush(problem, down);

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).toHaveBeenCalledTimes(1);
    expect(gate).not.toHaveBeenCalled();
    expect(session.renew).not.toHaveBeenCalled();
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'shows the page when a %s is refused for maintenance',
    async (method) => {
      const { http, platformStatus, server } = setup('abc');

      const answer = firstValueFrom(
        http.request(method, '/api/v1/quote-requests', { body: {} }),
      );
      server.expectOne('/api/v1/quote-requests').flush(problem, down);

      await expect(answer).rejects.toMatchObject({ status: 503 });
      expect(platformStatus.on).toHaveBeenCalledTimes(1);
    },
  );

  it('does not send the access token to another origin that answers a maintenance refusal', async () => {
    const { http, platformStatus, server } = setup('secret');

    const answer = firstValueFrom(http.get('https://example.org/api/v1/x'));
    const request = server.expectOne('https://example.org/api/v1/x');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(problem, down);

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).not.toHaveBeenCalled();
  });

  it('shows the page once per refused call when many are refused together', async () => {
    const { http, platformStatus, server } = setup('abc');

    const answers = Array.from({ length: 50 }, (_, i) =>
      firstValueFrom(http.get(`/api/v1/garages/${i}`)).catch((e) => e),
    );
    for (let i = 0; i < 50; i++) {
      server.expectOne(`/api/v1/garages/${i}`).flush(problem, down);
    }
    const results = await Promise.all(answers);

    expect(results.every((r) => r.status === 503)).toBe(true);
    expect(platformStatus.on).toHaveBeenCalledTimes(50);
  });
});
