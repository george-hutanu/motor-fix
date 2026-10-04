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
import { SignInDialog } from './sign-in/sign-in-dialog';

let controller: HttpTestingController | undefined;

function setup(
  token: string | null,
  {
    gate = jest.fn(async () => true),
    renew = async () => false,
  }: {
    gate?: jest.Mock<Promise<boolean>, []>;
    renew?: () => Promise<boolean>;
  } = {},
) {
  let current = token;
  const session = {
    renew: jest.fn(async () => renew()),
    token: () => current,
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Session, useValue: session },
      { provide: SignInDialog, useValue: { gate } },
      { provide: PLATFORM_ID, useValue: 'browser' },
    ],
  });
  controller = TestBed.inject(HttpTestingController);
  return {
    gate,
    http: TestBed.inject(HttpClient),
    server: controller,
    setToken: (next: string | null) => {
      current = next;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));
const refused = { status: 401, statusText: 'Unauthorized' };
const signInRequired = { code: 'sign_in_required', status: 401 };

afterEach(() => controller?.verify());

describe('authInterceptor sign-in gate, hostile cases', () => {
  it('hands the original refusal to the caller when the dialog fails to open', async () => {
    const gate = jest.fn(async () => {
      throw new Error('overlay failed');
    });
    const { http, server } = setup(null, { gate });

    const answer = firstValueFrom(http.patch('/api/v1/me', {})).catch(
      (error: unknown) => error,
    );
    server.expectOne('/api/v1/me').flush(signInRequired, refused);
    await tick();

    await expect(answer).resolves.toMatchObject({
      error: { code: 'sign_in_required' },
      status: 401,
    });
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('hands the original refusal to the caller when renewing throws', async () => {
    const { gate, http, server } = setup('expired', {
      gate: jest.fn(async () => false),
      renew: async () => {
        throw new Error('network down');
      },
    });

    const answer = firstValueFrom(http.patch('/api/v1/me', {})).catch(
      (error: unknown) => error,
    );
    server.expectOne('/api/v1/me').flush(signInRequired, refused);
    await tick();

    await expect(answer).resolves.toMatchObject({ status: 401 });
    expect(gate.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('sends an unrelated call at once while a sign-in dialog is still open', async () => {
    const { http, server } = setup(null, {
      gate: jest.fn(() => new Promise<boolean>(() => undefined)),
    });

    http.patch('/api/v1/me', {}).subscribe({ error: () => undefined });
    server.expectOne('/api/v1/me').flush(signInRequired, refused);
    await tick();
    http.get('/api/v1/garages').subscribe();

    const other = server.expectOne('/api/v1/garages');
    expect(other.request.method).toBe('GET');
    other.flush([]);
  });

  it('shows the caller the error of the repeated call when it fails for another reason', async () => {
    const gate = jest.fn(async () => true);
    const { http, server, setToken } = setup(null, { gate });
    gate.mockImplementation(async () => {
      setToken('signed-in');
      return true;
    });

    const answer = firstValueFrom(http.patch('/api/v1/me', {})).catch(
      (error: unknown) => error,
    );
    server.expectOne('/api/v1/me').flush(signInRequired, refused);
    await tick();
    server
      .expectOne('/api/v1/me')
      .flush({ code: 'maintenance' }, { status: 503, statusText: 'Down' });

    await expect(answer).resolves.toMatchObject({ status: 503 });
  });

  it.each([
    ['a plain string', 'sign_in_required'],
    ['null', null],
    ['an array', ['sign_in_required']],
    ['an object without a code', { status: 401 }],
  ])('does not open the dialog for a 401 whose body is %s', async (_t, body) => {
    const { gate, http, server } = setup(null);

    const answer = expect(
      firstValueFrom(http.patch('/api/v1/me', {})),
    ).rejects.toMatchObject({ status: 401 });
    server.expectOne('/api/v1/me').flush(body, refused);
    await tick();

    await answer;
    expect(gate).not.toHaveBeenCalled();
  });

  it('never opens the dialog for the sign-out call', async () => {
    const { gate, http, server } = setup(null);

    const answer = firstValueFrom(http.post('/api/v1/auth/sign-out', {}));
    server.expectOne('/api/v1/auth/sign-out').flush(signInRequired, refused);

    await expect(answer).rejects.toMatchObject({ status: 401 });
    expect(gate).not.toHaveBeenCalled();
  });
});
