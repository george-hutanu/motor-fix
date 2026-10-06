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
import { I18n } from '@motor-fix/i18n';

import { InvitePage } from './invite';
import { Session } from '../dashboard/session';
import { SignInDialog } from '../sign-in/sign-in-dialog';

const TOKEN = 'A'.repeat(43);
const MECHANIC = { landing: '/app/garage', role: 'mechanic' } as MeDto;
const DRIVER = { landing: '/app/driver', role: 'driver' } as MeDto;

const view = (
  kind: 'mechanic' | 'receptionist',
  garage = 'Atelier Dinamo',
) => ({
  email: 'elena@example.ro',
  garage,
  kind,
  name: 'Elena Stan',
});

const gone = (code: string, status = 410) =>
  new HttpErrorResponse({ error: { code, message: code }, status });

interface Options {
  answer?: unknown;
  signedIn?: MeDto | null;
  joined?: 'signed-in' | 'signed-up' | null;
  platform?: string;
}

function setup({
  answer = view('mechanic'),
  signedIn = null,
  joined = null,
  platform = 'browser',
}: Options = {}) {
  const current = signal<MeDto | null>(signedIn);
  const check = jest.fn(async () => {
    if (answer instanceof HttpErrorResponse) throw answer;
    return answer;
  });
  const acceptInvite = jest.fn(async (_: unknown): Promise<void> => undefined);
  const switchRole = jest.fn(async () => {
    current.set(MECHANIC);
    return MECHANIC;
  });
  const join = jest.fn(async () => {
    if (joined) current.set(DRIVER);
    return joined;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: convertToParamMap({ token: TOKEN }) },
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

const element = (fixture: { nativeElement: unknown }) =>
  fixture.nativeElement as HTMLElement;
const text = (fixture: { nativeElement: unknown }) =>
  element(fixture).textContent ?? '';
const accept = (fixture: { nativeElement: unknown }) =>
  [...element(fixture).querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Acceptă',
  ) as HTMLButtonElement | undefined;

const INVALID = 'Invitația nu mai este valabilă. Cere service‑ului una nouă.';

afterEach(() => jest.restoreAllMocks());

describe('the invite link page', () => {
  // @traces 131-FR-012
  it('checks the link and says who invites whom, as what', async () => {
    const { check, fixture } = setup();
    await flush(fixture);

    expect(check).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(text(fixture)).toContain(
      'Atelier Dinamo te invită să te alături echipei ca mecanic.',
    );
    expect(text(fixture)).toContain('profilul public');
    expect(accept(fixture)).toBeDefined();
  });

  it('names a receptionist invite as such, without the public profile line', async () => {
    const { fixture } = setup({ answer: view('receptionist') });
    await flush(fixture);

    expect(text(fixture)).toContain(
      'Atelier Dinamo te invită să te alături echipei ca recepționer.',
    );
    expect(text(fixture)).not.toContain('profilul public');
  });

  it.each([
    ['used, revoked or unknown', gone('invite_invalid')],
    ['expired', gone('invite_expired')],
    ['for mechanics switched off', gone('feature_off', 404)],
  ])('says a link that is %s is no longer valid', async (_, answer) => {
    const { fixture } = setup({ answer });
    await flush(fixture);

    expect(text(fixture)).toContain(INVALID);
    expect(accept(fixture)).toBeUndefined();
  });

  // @traces 131-FR-012
  it('accepts for a signed-in person only on "Acceptă", then opens the garage dashboard in the invited role', async () => {
    const { acceptInvite, fixture, join, navigate, switchRole } = setup({
      signedIn: DRIVER,
    });
    await flush(fixture);
    expect(acceptInvite).not.toHaveBeenCalled();

    accept(fixture)?.click();
    await flush(fixture);

    expect(join).not.toHaveBeenCalled();
    expect(acceptInvite).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(switchRole).toHaveBeenCalledWith('mechanic');
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  // @traces 131-FR-012
  it('accepts at once once a signed-out invitee creates the account from the link', async () => {
    const { acceptInvite, fixture, join, navigate } = setup({
      joined: 'signed-up',
    });
    await flush(fixture);

    accept(fixture)?.click();
    await flush(fixture);

    expect(join).toHaveBeenCalledWith({
      email: 'elena@example.ro',
      name: 'Elena Stan',
    });
    expect(acceptInvite).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('waits for "Acceptă" again after an invitee signs in to an existing account', async () => {
    const { acceptInvite, fixture } = setup({ joined: 'signed-in' });
    await flush(fixture);

    accept(fixture)?.click();
    await flush(fixture);
    expect(acceptInvite).not.toHaveBeenCalled();

    accept(fixture)?.click();
    await flush(fixture);
    expect(acceptInvite).toHaveBeenCalledWith({ body: { token: TOKEN } });
  });

  it('stays as it was when the sign-in dialog is closed', async () => {
    const { acceptInvite, fixture, navigate } = setup({ joined: null });
    await flush(fixture);

    accept(fixture)?.click();
    await flush(fixture);

    expect(acceptInvite).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(accept(fixture)).toBeDefined();
  });

  it('after joining, retries only the role switch when it failed, never "no longer valid"', async () => {
    const { acceptInvite, fixture, navigate, switchRole } = setup({
      signedIn: DRIVER,
    });
    switchRole.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    acceptInvite
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(gone('invite_invalid'));
    await flush(fixture);

    accept(fixture)?.click();
    await flush(fixture);
    expect(navigate).not.toHaveBeenCalled();
    expect(text(fixture)).not.toContain(INVALID);

    accept(fixture)?.click();
    await flush(fixture);

    expect(acceptInvite).toHaveBeenCalledTimes(1);
    expect(switchRole).toHaveBeenCalledTimes(2);
    expect(text(fixture)).not.toContain(INVALID);
    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('says the link is no longer valid when accepting finds it used', async () => {
    const { acceptInvite, fixture, navigate, switchRole } = setup({
      signedIn: DRIVER,
    });
    acceptInvite.mockRejectedValueOnce(gone('invite_invalid'));
    await flush(fixture);

    accept(fixture)?.click();
    await flush(fixture);

    expect(text(fixture)).toContain(INVALID);
    expect(switchRole).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  // @traces 131-FR-013
  it('shows a typed garage name as text, never as markup', async () => {
    const { fixture } = setup({
      answer: view('mechanic', '<b>Dinamo</b>'),
    });
    await flush(fixture);

    expect(element(fixture).querySelector('b')).toBeNull();
    expect(text(fixture)).toContain('<b>Dinamo</b>');
  });

  // @traces 131-FR-013
  it('reads English', async () => {
    const { fixture } = setup();
    await TestBed.inject(I18n).use('en');
    await flush(fixture);

    expect(text(fixture)).toContain(
      'Atelier Dinamo invites you to join the team as a mechanic.',
    );
    expect(
      [...element(fixture).querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Accept',
      ),
    ).toBe(true);
  });

  it('checks nothing on the server', async () => {
    const { check, fixture } = setup({ platform: 'server' });
    await flush(fixture);

    expect(check).not.toHaveBeenCalled();
  });
});
