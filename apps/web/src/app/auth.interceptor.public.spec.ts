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

// @traces 1200-transfer-cache-origin-FR-004

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

const url = `${location.origin}/api/v1/brands/popular?limit=8`;

afterEach(() => server.verify());

describe('authInterceptor and a public read', () => {
  it('sends a public read without the token of a signed-in visitor', () => {
    const { http } = setup('abc');

    http.get(url, { context: publicRead() }).subscribe();
    const call = server.expectOne(url);

    expect(call.request.headers.has('Authorization')).toBe(false);
    call.flush([]);
  });

  it('still sends the token with the same call left unmarked', () => {
    const { http } = setup('abc');

    http.get(url).subscribe();
    const call = server.expectOne(url);

    expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
    call.flush([]);
  });

  it('passes a 401 on a public read through, with no renewal and no dialog', async () => {
    const { gate, http, session } = setup('abc');

    const answer = firstValueFrom(http.get(url, { context: publicRead() }));
    server
      .expectOne(url)
      .flush(
        { code: 'sign_in_required', status: 401 },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(session.renew).not.toHaveBeenCalled();
    expect(gate).not.toHaveBeenCalled();
    server.expectNone(url);
  });

  it('shows the maintenance page when a public read is refused for maintenance', async () => {
    const { http, platformStatus } = setup(null);

    const answer = firstValueFrom(http.get(url, { context: publicRead() }));
    server
      .expectOne(url)
      .flush(
        { code: 'maintenance', status: 503 },
        { status: 503, statusText: 'Service Unavailable' },
      );

    await expect(answer).rejects.toMatchObject({ status: 503 });
    expect(platformStatus.on).toHaveBeenCalledTimes(1);
  });
});
