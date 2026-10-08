import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import { InvitesService, type MeDto } from '@motor-fix/data-access';

import { InvitePage } from './invite';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

const DRIVER = { landing: '/app/driver', role: 'driver' } as MeDto;
const VIEW = {
  email: 'elena@example.ro',
  garage: 'Atelier Dinamo',
  kind: 'receptionist',
  name: 'Elena Stan',
};
const problem = (status: number, code?: string) =>
  new HttpErrorResponse({ error: code ? { code } : null, status });

function setup(opts: { token?: string; signedIn?: boolean } = {}) {
  const current = signal<MeDto | null>(opts.signedIn ? DRIVER : null);
  const check = jest.fn(async (): Promise<unknown> => VIEW);
  const acceptInvite = jest.fn(async (_: unknown): Promise<void> => undefined);
  const switchRole = jest.fn(async (_: string): Promise<MeDto | null> => null);
  const join = jest.fn(async (): Promise<string | null> => 'signed-up');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap(
              opts.token === undefined ? {} : { token: opts.token },
            ),
          },
        },
      },
      {
        provide: InvitesService,
        useValue: {
          invitesControllerAccept: acceptInvite,
          invitesControllerCheck: check,
        },
      },
      {
        provide: Session,
        useValue: { current, load: async () => current(), switchRole },
      },
      { provide: SignInDialog, useValue: { join } },
    ],
  });
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(InvitePage);
  return { acceptInvite, check, fixture, join, navigate, switchRole };
}

const flush = async (fixture: { detectChanges(): void }) => {
  for (let i = 0; i < 6; i++) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
  }
  fixture.detectChanges();
};
const root = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
const text = (f: { nativeElement: unknown }) => root(f).textContent ?? '';
const button = (f: { nativeElement: unknown }, name: string) =>
  [...root(f).querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

afterEach(() => jest.restoreAllMocks());

describe('the invite page under failure and repetition', () => {
  it('sends one accept for a double press', async () => {
    const { acceptInvite, fixture } = setup({ signedIn: true });
    await flush(fixture);

    const accept = button(fixture, 'Acceptă');
    accept?.click();
    accept?.click();
    await flush(fixture);

    expect(acceptInvite).toHaveBeenCalledTimes(1);
  });

  it('offers a retry after a server error and recovers when it passes', async () => {
    const { check, fixture } = setup();
    check.mockRejectedValueOnce(problem(500));
    await flush(fixture);
    expect(button(fixture, 'Acceptă')).toBeUndefined();
    expect(button(fixture, 'Încearcă din nou')).toBeDefined();

    button(fixture, 'Încearcă din nou')?.click();
    await flush(fixture);

    expect(check).toHaveBeenCalledTimes(2);
    expect(button(fixture, 'Acceptă')).toBeDefined();
  });

  it('offers a retry, not the invalid message, when the network is down', async () => {
    const { check, fixture } = setup();
    check.mockRejectedValueOnce(problem(0));
    await flush(fixture);

    expect(text(fixture)).not.toContain('nu mai este valabilă');
    expect(button(fixture, 'Încearcă din nou')).toBeDefined();
  });

  it('treats a 410 with no body as a retryable error, not a spent link', async () => {
    const { check, fixture } = setup();
    check.mockRejectedValueOnce(problem(410));
    await flush(fixture);

    expect(button(fixture, 'Încearcă din nou')).toBeDefined();
  });

  it('keeps the accept button and tells the person when accepting fails on the server', async () => {
    const { acceptInvite, fixture, navigate } = setup({ signedIn: true });
    acceptInvite.mockRejectedValueOnce(problem(500));
    await flush(fixture);

    button(fixture, 'Acceptă')?.click();
    await flush(fixture);

    expect(root(fixture).querySelector('[role="alert"]')).not.toBeNull();
    expect(button(fixture, 'Acceptă')?.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets the person try again after a failed accept and then joins', async () => {
    const { acceptInvite, fixture, navigate } = setup({ signedIn: true });
    acceptInvite.mockRejectedValueOnce(problem(500));
    await flush(fixture);
    button(fixture, 'Acceptă')?.click();
    await flush(fixture);

    button(fixture, 'Acceptă')?.click();
    await flush(fixture);

    expect(acceptInvite).toHaveBeenCalledTimes(2);
    expect(root(fixture).querySelector('[role="alert"]')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('opens the garage dashboard when the role switch returns nothing', async () => {
    const { fixture, navigate, switchRole } = setup({ signedIn: true });
    await flush(fixture);

    button(fixture, 'Acceptă')?.click();
    await flush(fixture);

    expect(switchRole).toHaveBeenCalledWith('receptionist');
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('shows the spent-link message when accepting finds the mechanic feature off', async () => {
    const { acceptInvite, fixture } = setup({ signedIn: true });
    acceptInvite.mockRejectedValueOnce(problem(404, 'feature_off'));
    await flush(fixture);

    button(fixture, 'Acceptă')?.click();
    await flush(fixture);

    expect(text(fixture)).toContain('nu mai este valabilă');
  });

  it('shows the failure, not a crash, when the sign-in dialog throws', async () => {
    const { acceptInvite, fixture, join } = setup();
    join.mockRejectedValueOnce(new Error('boom'));
    await flush(fixture);

    button(fixture, 'Acceptă')?.click();
    await flush(fixture);

    expect(acceptInvite).not.toHaveBeenCalled();
    expect(button(fixture, 'Acceptă')?.disabled).toBe(false);
  });

  it('puts the token in the check body and never in an accept without a press', async () => {
    const { acceptInvite, check, fixture } = setup({ token: 'a/b?c=1#d' });
    await flush(fixture);

    expect(check).toHaveBeenCalledWith({ body: { token: 'a/b?c=1#d' } });
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('sends an empty token to the server when the route has none and shows it as invalid', async () => {
    const { check, fixture } = setup();
    check.mockRejectedValueOnce(problem(410, 'invite_invalid'));
    await flush(fixture);

    expect(check).toHaveBeenCalledWith({ body: { token: '' } });
    expect(text(fixture)).toContain('nu mai este valabilă');
  });

  it('shows a markup-laden name and garage as text for a receptionist', async () => {
    const { check, fixture } = setup();
    check.mockResolvedValueOnce({
      ...VIEW,
      garage: '<img src=x onerror=alert(1)>',
    });
    await flush(fixture);

    expect(root(fixture).querySelector('img')).toBeNull();
    expect(text(fixture)).toContain('<img src=x onerror=alert(1)>');
  });
});
