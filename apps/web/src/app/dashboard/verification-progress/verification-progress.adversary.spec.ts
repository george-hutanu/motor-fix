import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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

const TEXT = {
  en: {
    checkIn: 'We check it within 1–2 working days.',
    contact: 'Contact MotorFix',
    loadFailed: 'We could not load the verification status.',
    offMap:
      'The profile stays off the map until it is approved. If something is missing we tell you what, and you can add it without starting over.',
    retry: 'Retry',
  },
  ro: {
    checkIn: 'O verificăm în 1–2 zile lucrătoare.',
    contact: 'Contactează MotorFix',
    loadFailed: 'Nu am putut încărca starea verificării.',
    offMap:
      'Profilul nu apare pe hartă până la aprobare. Dacă lipsește ceva, îți scriem ce anume și poți completa fără să o iei de la capăt.',
    retry: 'Reîncearcă',
  },
} as const;

let events: Subject<LiveMessage>;
let resyncs: Subject<void>;
let live: {
  close: jest.Mock;
  on: (kinds: readonly EventKind[]) => ReturnType<Subject<LiveMessage>['pipe']>;
  open: jest.Mock;
  resync: ReturnType<Subject<void>['asObservable']>;
};
const api = { verificationStatusControllerRead: jest.fn() };
const overlays = { open: jest.fn() };
let me: ReturnType<typeof signal<MeDto | null>>;
let reload: jest.Mock;

const account = (
  role: 'owner' | 'receptionist' | 'mechanic' = 'owner',
  status: 'draft' | 'approved' = 'draft',
) =>
  ({
    garageAccess: [
      { features: {}, garageId: GARAGE, name: 'Atelier Test', role, status },
    ],
    garageId: GARAGE,
    role: role === 'owner' ? 'garage' : role,
  }) as unknown as MeDto;

const answer = (
  value: VerificationStatusDto['status'],
  extra: Partial<VerificationStatusDto> = {},
): VerificationStatusDto => ({
  reason: null,
  requestedItems: [],
  status: value,
  submittedAt: value === 'draft' ? null : SENT_AT,
  ...extra,
});
const failure = () =>
  new HttpErrorResponse({ status: 503, statusText: 'Unavailable' });

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

async function render({
  language = 'ro',
  role = 'owner',
}: {
  language?: 'ro' | 'en';
  role?: 'owner' | 'receptionist' | 'mechanic';
} = {}) {
  me = signal<MeDto | null>(account(role));
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: api },
      { provide: Live, useValue: live },
      { provide: Overlays, useValue: overlays },
      { provide: Session, useValue: { current: me, reload, shown: me } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(VerificationProgress);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

// An event, then the 300 ms the page waits for a burst to end.
async function emit(
  fixture: Parameters<typeof settle>[0],
  ...kinds: EventKind[]
) {
  for (const kind of kinds) events.next({ id: 'file-1', kind } as LiveMessage);
  await pause(350);
  await settle(fixture);
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const current = (host: HTMLElement) =>
  text(host.querySelector('ol.stages > li[aria-current="step"] .name'));
const announced = (host: HTMLElement) =>
  text(host.querySelector('[role="status"]'));
const buttons = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLButtonElement>('button'),
];
const button = (host: HTMLElement, name: string) =>
  buttons(host).find((b) => text(b) === name) ?? null;

beforeEach(() => {
  events = new Subject<LiveMessage>();
  resyncs = new Subject<void>();
  live = {
    close: jest.fn(),
    on: (kinds) =>
      events.pipe(filter((m) => (kinds as readonly string[]).includes(m.kind))),
    open: jest.fn(),
    resync: resyncs.asObservable(),
  };
  reload = jest.fn(async () => undefined);
  overlays.open.mockReset().mockResolvedValue('cancelled');
  api.verificationStatusControllerRead
    .mockReset()
    .mockResolvedValue(answer('submitted'));
});

afterEach(() => TestBed.resetTestingModule());

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, reject, resolve };
};

describe('the verification page under hostile traffic', () => {
  // @traces 101-FR-005
  it('reads once for a burst of fifty events', async () => {
    const { fixture } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));

    await emit(fixture, ...Array(50).fill('verification.decided'));

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
  });

  // @traces 101-FR-005
  it('reads again for a second burst after the first one was answered', async () => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));
    await emit(fixture, 'verification.opened', 'verification.opened');
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('more_requested', { requestedItems: ['rar'] }),
    );

    await emit(fixture, 'verification.decided', 'verification.decided');

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(3);
    expect(current(host)).toBe('Cerute completări');
  });

  // @traces 101-FR-005
  it('reads once more after a slow read and shows that newer answer', async () => {
    const { fixture, host } = await render();
    const slow = deferred<VerificationStatusDto>();
    api.verificationStatusControllerRead
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(
        answer('rejected', { reason: { code: 'rar', note: 'Nu.' } }),
      );

    await emit(fixture, 'verification.opened');
    await emit(fixture, 'verification.decided');
    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);

    slow.resolve(answer('in_review'));
    await settle(fixture);
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(3);
    expect(current(host)).toBe('Respins');
    expect(announced(host)).toBe('Stadiul verificării: Respins');
  });

  // @traces 101-FR-005
  it('shows no stale failure when an older read fails after a newer one answered', async () => {
    const { fixture, host } = await render();
    const slow = deferred<VerificationStatusDto>();
    api.verificationStatusControllerRead
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(answer('in_review'));

    await emit(fixture, 'verification.opened');
    await emit(fixture, 'verification.decided');
    slow.reject(failure());
    await settle(fixture);

    expect(current(host)).toBe('În verificare');
    expect(text(host)).not.toContain('Nu am putut actualiza stadiul.');
  });

  // @traces 101-FR-005
  it('stops reading when the page is gone', async () => {
    const { fixture } = await render();
    fixture.destroy();

    events.next({ id: 'file-1', kind: 'verification.decided' } as LiveMessage);
    resyncs.next();
    await pause(350);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(1);
  });
});

describe('the announcement of a stage', () => {
  // @traces 101-FR-012
  it('stays silent when the first read only succeeds on a retry', async () => {
    api.verificationStatusControllerRead.mockRejectedValueOnce(failure());
    const { fixture, host } = await render();

    button(host, TEXT.ro.retry)?.click();
    await settle(fixture);

    expect(current(host)).toBe('Trimis · 2 mart. 2027');
    expect(announced(host)).toBe('');
  });

  // @traces 101-FR-012
  it('names the new stage in English', async () => {
    const { fixture, host } = await render({ language: 'en' });
    api.verificationStatusControllerRead.mockResolvedValue(answer('in_review'));

    await emit(fixture, 'verification.decided');

    expect(announced(host)).toBe('Verification stage: Under review');
  });

  // @traces 101-FR-012
  it.each([
    ['more_requested', 'Cerute completări'],
    ['rejected', 'Respins'],
    ['approved', 'Aprobat, pe hartă'],
  ] as const)('names the %s stage it moved to', async (status, name) => {
    const { fixture, host } = await render();
    api.verificationStatusControllerRead.mockResolvedValue(
      answer(status, { reason: { code: 'rar', note: 'n' } }),
    );

    await emit(fixture, 'verification.decided');

    expect(announced(host)).toBe(`Stadiul verificării: ${name}`);
  });

  // @traces 101-FR-012
  it('announces nothing when a re-read finds the same stage', async () => {
    const { fixture, host } = await render();

    await emit(fixture, 'verification.reopened');

    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(2);
    expect(announced(host)).toBe('');
  });

  // @traces 101-FR-012
  it('keeps the live region polite and out of the skeleton', async () => {
    const { host } = await render();

    const region = host.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
});

describe('what the page never shows', () => {
  // @traces 101-FR-004
  it.each(['approved', 'in_review', 'rejected', 'more_requested'] as const)(
    'renders no approval note a %s answer carries by mistake',
    async (status) => {
      api.verificationStatusControllerRead.mockResolvedValue({
        ...answer(status, { reason: { code: 'rar', note: 'Motiv public.' } }),
        approvalNote: 'NOTA INTERNA SECRETA',
        internalNote: 'NOTA INTERNA SECRETA',
        note: 'NOTA INTERNA SECRETA',
      } as unknown as VerificationStatusDto);

      const { host } = await render();

      expect(host.innerHTML).not.toContain('NOTA INTERNA SECRETA');
    },
  );

  // @traces 101-FR-004
  it('renders an approved file as the three stages and no note, reason or button', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(answer('approved'));

    const { host } = await render();

    expect(host.querySelector('.note')).toBeNull();
    expect(host.querySelector('.reason')).toBeNull();
    expect(buttons(host)).toHaveLength(0);
  });

  // @traces 101-FR-004
  it('renders a rejection note as text, never as markup', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('rejected', {
        reason: {
          code: 'rar',
          note: '<img src=x onerror=alert(1)><b>gros</b>',
        },
      }),
    );

    const { host } = await render();

    expect(host.querySelector('.note img')).toBeNull();
    expect(host.querySelector('.note b')).toBeNull();
    expect(text(host.querySelector('.note'))).toBe(
      '<img src=x onerror=alert(1)><b>gros</b>',
    );
  });

  // @traces 101-FR-003
  it('shows "Cerute completări" with no list and no button when the request names no items', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('more_requested', { requestedItems: [] }),
    );

    const { host } = await render();

    expect(current(host)).toBe('Cerute completări');
    expect(host.querySelectorAll('.items li')).toHaveLength(0);
    expect(buttons(host)).toHaveLength(0);
  });

  // @traces 101-FR-003
  it('keeps a repeated requested item and a ten-item list in the order sent', async () => {
    const items = ['photos', 'rar', 'photos', 'other', 'address', 'documents'];
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('more_requested', { requestedItems: items }),
    );

    const { host } = await render();

    expect([...host.querySelectorAll('.items li')].map(text)).toEqual([
      'Fotografiile',
      'Autorizația RAR',
      'Fotografiile',
      'Altceva',
      'Adresa',
      'Documentele',
    ]);
  });

  // @traces 101-FR-004
  it('shows a rejection with a null reason without a note, and still offers the contact button', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(answer('rejected'));

    const { host } = await render();

    expect(current(host)).toBe('Respins');
    expect(host.querySelector('.note')).toBeNull();
    expect(button(host, TEXT.ro.contact)).not.toBeNull();
  });

  // @traces 101-FR-004
  it('opens the contact drawer once per press, even pressed twice', async () => {
    api.verificationStatusControllerRead.mockResolvedValue(
      answer('rejected', { reason: { code: 'rar', note: 'n' } }),
    );
    const { host } = await render();

    button(host, TEXT.ro.contact)?.click();
    button(host, TEXT.ro.contact)?.click();

    expect(overlays.open).toHaveBeenCalledTimes(2);
  });
});

describe('the garage of the session', () => {
  // @traces 101-FR-008
  it('reads the status of the matched garage, not of another membership', async () => {
    const other = '00000000-0000-4000-8000-0000000000ff';
    me = signal<MeDto | null>({
      garageAccess: [
        {
          features: {},
          garageId: other,
          name: 'Altul',
          role: 'owner',
          status: 'approved',
        },
        {
          features: {},
          garageId: GARAGE,
          name: 'Atelier Test',
          role: 'owner',
          status: 'draft',
        },
      ],
      garageId: GARAGE,
      role: 'garage',
    } as unknown as MeDto);
    TestBed.configureTestingModule({
      providers: [
        { provide: GaragesService, useValue: api },
        { provide: Live, useValue: live },
        { provide: Overlays, useValue: overlays },
        { provide: Session, useValue: { current: me, reload, shown: me } },
      ],
    });
    const i18n = TestBed.inject(I18n);
    await i18n.enter('garage');
    await i18n.enter('public');
    const fixture = TestBed.createComponent(VerificationProgress);
    await settle(fixture);

    expect(api.verificationStatusControllerRead).toHaveBeenCalledWith({
      garageId: GARAGE,
    });
    expect(api.verificationStatusControllerRead).toHaveBeenCalledTimes(1);
  });

  // @traces 101-FR-008
  it('shows the two lines and makes no call when the session holds no account', async () => {
    me = signal<MeDto | null>(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: GaragesService, useValue: api },
        { provide: Live, useValue: live },
        { provide: Overlays, useValue: overlays },
        { provide: Session, useValue: { current: me, reload, shown: me } },
      ],
    });
    const i18n = TestBed.inject(I18n);
    await i18n.enter('garage');
    await i18n.enter('public');
    const fixture = TestBed.createComponent(VerificationProgress);
    await settle(fixture);

    expect(api.verificationStatusControllerRead).not.toHaveBeenCalled();
    expect(text(fixture.nativeElement)).toContain(TEXT.ro.checkIn);
  });
});
