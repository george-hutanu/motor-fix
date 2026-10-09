import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';

import { Connect } from './connect';
import { authInterceptor } from '../../auth.interceptor';
import { LEAVE, Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

const APPROVE = '/api/v1/auth/assistant/approve';
const REQUEST = 'eyJzdGF0ZSI6InMifQ.c2ln';
const REDIRECT = 'https://id.example.com/broker/endpoint?code=c&state=s';

const signInRequired = {
  body: { code: 'sign_in_required', status: 401 },
  options: { status: 401, statusText: 'Unauthorized' },
};

let server: HttpTestingController | undefined;

async function open(
  options: {
    token?: string | null;
    signsIn?: boolean;
    language?: 'ro' | 'en';
    platform?: 'browser' | 'server';
    query?: string;
  } = {},
) {
  let token = options.token ?? null;
  const session = {
    renew: jest.fn(async () => false),
    token: () => token,
  };
  const gate = jest.fn(async () => {
    if (options.signsIn ?? true) token = 'signed-in';
    return options.signsIn ?? true;
  });
  const leave = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ component: Connect, path: 'app/assistant/connect' }]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: Session, useValue: session },
      { provide: SignInDialog, useValue: { gate } },
      { provide: LEAVE, useValue: leave },
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
    ],
  });
  server = TestBed.inject(HttpTestingController);
  const i18n = TestBed.inject(I18n);
  if (options.language === 'en') await i18n.use('en');
  await i18n.enter('assistant');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(
    `/app/assistant/connect${options.query ?? `?request=${REQUEST}`}`,
  );
  await settle(harness);
  return { gate, harness, http: server, leave, session };
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const text = (harness: RouterTestingHarness) =>
  (harness.routeNativeElement?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => server?.verify());

describe('the assistant connect page', () => {
  // @traces 365-FR-014
  it('signs a signed-out person in over the page, then approves once and leaves for the identity server', async () => {
    const { gate, harness, http, leave } = await open();

    const first = http.expectOne(APPROVE);
    expect(first.request.method).toBe('POST');
    expect(first.request.body).toEqual({ request: REQUEST });
    expect(first.request.headers.has('Authorization')).toBe(false);
    first.flush(signInRequired.body, signInRequired.options);
    await settle(harness);

    expect(gate).toHaveBeenCalledTimes(1);
    const second = http.expectOne(APPROVE);
    expect(second.request.headers.get('Authorization')).toBe(
      'Bearer signed-in',
    );
    expect(second.request.body).toEqual({ request: REQUEST });
    second.flush({ redirect: REDIRECT });
    await settle(harness);

    http.expectNone(APPROVE);
    expect(leave).toHaveBeenCalledWith(REDIRECT);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('approves at once for a signed-in person', async () => {
    const { gate, harness, http, leave } = await open({ token: 'abc' });

    const call = http.expectOne(APPROVE);
    expect(call.request.headers.get('Authorization')).toBe('Bearer abc');
    call.flush({ redirect: REDIRECT });
    await settle(harness);

    expect(gate).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledWith(REDIRECT);
  });

  it('shows one status line while it connects, in Romanian', async () => {
    const { harness, http } = await open({ token: 'abc' });

    expect(text(harness)).toBe('Se conectează asistentul…');
    expect(
      harness.routeNativeElement?.querySelector('[role="status"]'),
    ).not.toBeNull();
    http.expectOne(APPROVE);
  });

  it('shows the status line in English', async () => {
    const { harness, http } = await open({ language: 'en', token: 'abc' });

    expect(text(harness)).toBe('Connecting your assistant…');
    http.expectOne(APPROVE);
  });

  it.each([
    [400, 'invalid_request'],
    [410, 'request_expired'],
    [500, 'internal'],
  ])(
    'shows the error state when the approval answers %i',
    async (status, code) => {
      const { harness, http, leave } = await open({ token: 'abc' });

      http
        .expectOne(APPROVE)
        .flush({ code, status }, { status, statusText: 'Refused' });
      await settle(harness);

      expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(
        'Asistentul nu s‑a putut conecta',
      );
      expect(text(harness)).toContain('Întoarce‑te în asistent');
      expect(text(harness)).not.toContain('Se conectează asistentul');
      expect(leave).not.toHaveBeenCalled();
    },
  );

  it('shows the error state in English', async () => {
    const { harness, http } = await open({ language: 'en', token: 'abc' });

    http
      .expectOne(APPROVE)
      .flush(
        { code: 'request_expired', status: 410 },
        { status: 410, statusText: 'Gone' },
      );
    await settle(harness);

    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(
      'Could not connect your assistant',
    );
    expect(text(harness)).toContain('Go back to your assistant');
  });

  it('shows the error state when the person closes the sign-in', async () => {
    const { harness, http, leave } = await open({ signsIn: false });

    http.expectOne(APPROVE).flush(signInRequired.body, signInRequired.options);
    await settle(harness);

    http.expectNone(APPROVE);
    expect(harness.routeNativeElement?.querySelector('h1')).not.toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it('approves nothing without a hand-off request', async () => {
    const { harness, http } = await open({ query: '', token: 'abc' });

    http.expectNone(APPROVE);
    expect(harness.routeNativeElement?.querySelector('h1')).not.toBeNull();
  });

  it('approves nothing while rendered on the server', async () => {
    const { http, leave } = await open({ platform: 'server', token: 'abc' });

    http.expectNone(APPROVE);
    expect(leave).not.toHaveBeenCalled();
  });

  it('wraps its text rather than scrolling sideways on a narrow phone', () => {
    const css = readFileSync(join(__dirname, 'connect.css'), 'utf8').replace(
      /\s+/g,
      ' ',
    );

    expect(css).toMatch(/overflow-wrap: anywhere/);
    expect(css).not.toMatch(/(?:min-)?width: \d{3,}px/);
    expect(css).not.toMatch(/white-space: nowrap/);
  });
});
