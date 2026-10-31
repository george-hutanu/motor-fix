import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type {
  EventKind,
  LiveMessage,
  VerificationStatusDto,
} from '@motor-fix/contracts';
import type { MeDto } from '@motor-fix/data-access/models/me-dto';
import { GaragesService } from '@motor-fix/data-access/services/garages.service';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { VerificationProgress } from './verification-progress';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'a3c1e5f7-0000-4000-8000-000000000001';
const SENT_AT = '2027-03-02T08:30:00.000Z';
const CORRECT = { en: 'Correct the listing', ro: 'Corectează listarea' };
const CONTACT = { en: 'Contact MotorFix', ro: 'Contactează MotorFix' };

let events: Subject<LiveMessage>;
const api = { verificationStatusControllerRead: jest.fn() };
const overlays = { open: jest.fn() };

const account = (role: 'owner' | 'receptionist' | 'mechanic') =>
  ({
    garageAccess: [
      {
        features: {},
        garageId: GARAGE,
        name: 'Atelier',
        role,
        status: 'draft',
      },
    ],
    garageId: GARAGE,
    role: role === 'owner' ? 'garage' : role,
  }) as unknown as MeDto;

const answer = (
  status: string,
  extra: Partial<VerificationStatusDto> = {},
): VerificationStatusDto =>
  ({
    note: null,
    reason: null,
    requestedItems: [],
    status,
    submittedAt: SENT_AT,
    ...extra,
  }) as VerificationStatusDto;
const rejected = (note = 'Autorizația a expirat.') =>
  answer('rejected', { reason: { code: 'rar', note } });

const pause = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await pause();
  }
}

async function render(
  role: 'owner' | 'receptionist' | 'mechanic' = 'owner',
  language: 'ro' | 'en' = 'ro',
) {
  const me = signal<MeDto | null>(account(role));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: GaragesService, useValue: api },
      {
        provide: Live,
        useValue: {
          close: jest.fn(),
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          open: jest.fn(),
          resync: new Subject<void>().asObservable(),
        },
      },
      { provide: Overlays, useValue: overlays },
      {
        provide: Session,
        useValue: { current: me, reload: jest.fn(), shown: me },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const navigate = jest
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  const fixture = TestBed.createComponent(VerificationProgress);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    i18n,
    navigate,
  };
}

async function emit(fixture: Parameters<typeof settle>[0], kind: EventKind) {
  events.next({ id: 'file-1', kind } as LiveMessage);
  await pause(350);
  await settle(fixture);
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const labels = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].map(text);
const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  ) ?? null;

beforeEach(() => {
  events = new Subject<LiveMessage>();
  overlays.open.mockReset().mockResolvedValue('cancelled');
  api.verificationStatusControllerRead.mockReset();
});
afterEach(() => TestBed.resetTestingModule());

describe('the correct button on a rejected file, under hostile conditions', () => {
  // @traces 1401-FR-001
  it('puts the correct button first and the contact button second, as the keyboard reads them', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(rejected());

    const { host } = await render();

    expect(labels(host)).toEqual([CORRECT.ro, CONTACT.ro]);
  });

  // @traces 1401-FR-001
  it('shows exactly two buttons on a rejection, whatever markup the note holds', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      rejected(
        '<button>Corectează listarea</button> <img src=x onerror=alert(1)>',
      ),
    );

    const { host } = await render();

    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(host.querySelector('img')).toBeNull();
  });

  // @traces 1401-FR-001
  it('shows the correct button for a rejection with a 1000 code point note of emoji', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      rejected('🚗'.repeat(1000)),
    );

    const { host } = await render();

    expect(button(host, CORRECT.ro)).not.toBeNull();
    expect(button(host, CONTACT.ro)).not.toBeNull();
  });

  // @traces 1401-FR-001
  it('shows the correct button when the rejection carries no reason', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(answer('rejected'));

    const { host } = await render();

    expect(button(host, CORRECT.ro)).not.toBeNull();
  });

  // @traces 1401-FR-001
  it.each(['REJECTED', 'rejected ', 'Rejected', 'declined', '', 'draft'])(
    'shows no correct button for the unknown status %j',
    async (status) => {
      api.verificationStatusControllerRead.mockResolvedValue(answer(status));

      const { host } = await render();

      expect(button(host, CORRECT.ro)).toBeNull();
    },
  );

  // @traces 1401-FR-001
  it('shows no correct button while the first read is pending', async () => {
    api.verificationStatusControllerRead.mockReturnValue(
      new Promise(() => undefined),
    );

    const { host } = await render();

    expect(labels(host)).toEqual([]);
  });

  // @traces 1401-FR-001
  it('shows no correct button when the first read failed', async () => {
    api.verificationStatusControllerRead.mockRejectedValue(
      new HttpErrorResponse({ status: 503 }),
    );

    const { host } = await render();

    expect(button(host, CORRECT.ro)).toBeNull();
    expect(labels(host)).toEqual(['Reîncearcă']);
  });

  // @traces 1401-FR-001
  it('keeps the correct button beside the retry when a later read fails', async () => {
    api.verificationStatusControllerRead.mockResolvedValueOnce(rejected());
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockRejectedValue(
      new HttpErrorResponse({ status: 503 }),
    );

    await emit(fixture, 'verification.decided');

    expect(button(host, CORRECT.ro)).not.toBeNull();
    expect(button(host, 'Reîncearcă')).not.toBeNull();
  });

  // @traces 1401-FR-001
  it.each(['receptionist', 'mechanic'] as const)(
    'never reads the status for a %s of a rejected garage',
    async (role) => {
      api.verificationStatusControllerRead.mockResolvedValue(rejected());

      await render(role);

      expect(api.verificationStatusControllerRead).not.toHaveBeenCalled();
    },
  );

  // @traces 1401-FR-001
  it('swaps the correct button for Completează when the admin asks for more instead', async () => {
    api.verificationStatusControllerRead.mockResolvedValueOnce(rejected());
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('more_requested', { requestedItems: ['rar'] }),
    );

    await emit(fixture, 'verification.reopened');

    expect(labels(host)).toEqual(['Completează']);
  });

  // @traces 1401-FR-001
  it('removes both buttons when the admin reopens the file into review', async () => {
    api.verificationStatusControllerRead.mockResolvedValueOnce(rejected());
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));

    await emit(fixture, 'verification.reopened');

    expect(labels(host)).toEqual([]);
  });

  // @traces 1401-FR-001
  it('brings the button back when a file is rejected again while the page is open', async () => {
    api.verificationStatusControllerRead.mockResolvedValueOnce(
      answer('submitted'),
    );
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(rejected());

    await emit(fixture, 'verification.decided');

    expect(labels(host)).toEqual([CORRECT.ro, CONTACT.ro]);
  });

  // @traces 1401-FR-001
  it.each(['en', 'ro'] as const)(
    'navigates to the %s listing page, and only that one',
    async (language) => {
      api.verificationStatusControllerRead.mockResolvedValue(rejected());
      const { host, navigate } = await render('owner', language);

      button(host, CORRECT[language])?.click();

      expect(navigate.mock.calls.map((c) => String(c[0]))).toEqual([
        `/${language}/list-your-garage`,
      ]);
      expect(overlays.open).not.toHaveBeenCalled();
    },
  );

  // @traces 1401-FR-001
  it('follows a language change made after the page opened', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(rejected());
    const { fixture, host, i18n, navigate } = await render();
    await i18n.use('en');
    await settle(fixture);

    button(host, CORRECT.en)?.click();

    expect(navigate.mock.calls.map((c) => String(c[0]))).toEqual([
      '/en/list-your-garage',
    ]);
  });

  // @traces 1401-FR-001
  it('leaves the contact button opening the drawer and not navigating', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(rejected());
    const { host, navigate } = await render();

    button(host, CONTACT.ro)?.click();

    expect(navigate).not.toHaveBeenCalled();
    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  // @traces 1401-FR-001
  it('gives the correct button no attribute that would rename or hide it', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(rejected());

    const { host } = await render();
    const correct = button(host, CORRECT.ro);

    expect(correct?.getAttribute('aria-label')).toBeNull();
    expect(correct?.getAttribute('aria-hidden')).toBeNull();
    expect(correct?.closest('[aria-hidden="true"]')).toBeNull();
  });
});
