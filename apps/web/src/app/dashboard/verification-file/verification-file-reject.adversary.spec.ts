import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  VerificationDocumentsService,
  type VerificationFileCheckDto,
  type VerificationFileDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { VerificationFile } from './verification-file';
import { Live } from '../live';

// @traces 305-FR-001 305-FR-007

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const FILE = 'file-1';
const NOW = new Date();
const DAY = 86_400_000;

// A calendar day `n` days before today in Bucharest.
const daysAgo = (n: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(NOW.getTime() - n * DAY),
  );

const KINDS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
] as const;

const check = (
  kind: (typeof KINDS)[number],
  extra: Partial<VerificationFileCheckDto> = {},
): VerificationFileCheckDto => ({
  automatic: false,
  detail: null,
  evidence: null,
  fileId: FILE,
  id: `check-${kind}`,
  kind,
  recordedAt: null,
  recordedBy: null,
  recorder: null,
  result: 'not_run',
  ...extra,
});

const ioana = { id: 'admin-1', name: 'Ioana' };

function fileOf(
  extra: Partial<Omit<VerificationFileDto, 'file' | 'garage'>> & {
    file?: Partial<VerificationFileDto['file']>;
    garage?: Partial<VerificationFileDto['garage']>;
  } = {},
): VerificationFileDto {
  const { file, garage, ...rest } = extra;
  return {
    activities: [],
    catalogue: [
      { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
      { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
    ],
    checks: KINDS.map((kind) => check(kind)),
    documents: [
      {
        id: 'doc-onrc',
        issuedOn: daysAgo(6),
        kind: 'onrc_certificate',
        pages: 2,
        present: true,
        stale: false,
      },
      {
        id: 'doc-rar',
        issuedOn: null,
        kind: 'rar_authorisation',
        pages: 1,
        present: true,
        stale: null,
      },
    ],
    jobs: [
      {
        jobTypeId: 'job-oil',
        nameEn: 'Oil change',
        nameRo: 'Schimb de ulei',
        rarActivity: 'mechanics',
      },
      {
        jobTypeId: 'job-pads',
        nameEn: 'Brake pads',
        nameRo: 'Plăcuțe de frână',
        rarActivity: 'brakes',
      },
    ],
    previousRejection: null,
    reports: [],
    storageReady: true,
    timeline: { entries: [], total: 0 },
    ...rest,
    file: {
      decidedAt: null,
      decidedBy: null,
      declaredAt: NOW.toISOString(),
      declaredByName: 'Andrei Dobre',
      id: FILE,
      openedAt: NOW.toISOString(),
      openedBy: ioana,
      rarNumber: 'B 1234/2019',
      reasonCode: null,
      reasonNote: null,
      reopenedAt: null,
      reopenedBy: null,
      reopenReason: null,
      status: 'in_review',
      submittedAt: NOW.toISOString(),
      ...file,
    },
    garage: {
      address: 'Strada Fabricii 12, Cluj-Napoca',
      brands: ['Dacia', 'Renault'],
      businessKind: 'company',
      cui: '12345678',
      cuiAlsoUsedBy: [],
      cuiWarning: null,
      id: 'garage-1',
      name: 'Atelier Dinamo',
      phone: '+40722111222',
      photos: [
        {
          displayUrl: 'https://store.test/p1.display',
          height: 600,
          id: 'photo-1',
          thumbnailUrl: 'https://store.test/p1.thumb',
          width: 800,
        },
      ],
      seatAddress: null,
      serviceRadiusKm: null,
      ...garage,
    },
  } as VerificationFileDto;
}

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let answer: () => Promise<VerificationFileDto>;
let api: {
  verificationFileControllerCorrect: jest.Mock;
  verificationFileControllerDecision: jest.Mock;
  verificationFileControllerOpen: jest.Mock;
  verificationFileControllerReopen: jest.Mock;
  verificationFileControllerRead: jest.Mock;
  verificationChecksControllerRecord: jest.Mock;
};
let documents: { legalDocumentsControllerPageAddress: jest.Mock };
let overlays: { open: jest.Mock };
let drawer: VerificationFile;
let tab: { close: jest.Mock; location: { href: string }; opener: unknown };

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  file: VerificationFileDto | (() => Promise<VerificationFileDto>) = fileOf(),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  answer = typeof file === 'function' ? file : async () => file;
  api = {
    verificationChecksControllerRecord: jest.fn(),
    verificationFileControllerCorrect: jest.fn(),
    verificationFileControllerDecision: jest.fn(),
    verificationFileControllerOpen: jest.fn(() => answer()),
    verificationFileControllerRead: jest.fn(() => answer()),
    verificationFileControllerReopen: jest.fn(),
  };
  documents = {
    legalDocumentsControllerPageAddress: jest.fn(async () => ({
      expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      url: 'https://store.test/signed',
    })),
  };
  overlays = { open: jest.fn() };
  tab = { close: jest.fn(), location: { href: '' }, opener: {} };
  jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  jest.mocked(toast).mockClear();
  TestBed.configureTestingModule({
    providers: [
      { provide: AdminService, useValue: api },
      { provide: VerificationDocumentsService, useValue: documents },
      { provide: Overlays, useValue: overlays },
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: { fileId: FILE },
          markUnchanged: jest.fn(),
        },
      },
      {
        provide: Live,
        useValue: {
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  await i18n.enter('public');
  const fixture = TestBed.createComponent(VerificationFile);
  drawer = fixture.componentInstance;
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const section = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLElement>(`[data-section="${name}"]`);

const ok = (kind: string) =>
  check(kind as (typeof KINDS)[number], { result: 'ok' });
const approvable = () => fileOf({ checks: KINDS.map((k) => ok(k)) });
const rejectButton = (host: HTMLElement) =>
  section(host, 'footer')?.querySelector<HTMLButtonElement>(
    '[data-part="reject"]',
  ) as HTMLButtonElement;
const footerButtons = (host: HTMLElement) => [
  ...(section(host, 'footer')?.querySelectorAll('button') ?? []),
];
const alertIn = (host: HTMLElement) =>
  section(host, 'footer')?.querySelector('[role="alert"]') ?? null;
const DECIDED_AT = new Date(NOW.getTime() - 3_600_000).toISOString();
const decidedAs = (
  status: 'rejected' | 'approved' | 'more_requested',
  extra: object = {},
) =>
  fileOf({
    file: {
      decidedAt: DECIDED_AT,
      decidedBy: ioana,
      reasonCode: 'rar',
      reasonNote: 'Autorizația RAR a expirat.',
      status,
      ...extra,
    },
  });
const CLOSED = { note: 'Autorizația RAR a expirat.', reason: 'rar' };
const unprocessable = (code: string) =>
  new HttpErrorResponse({
    error: { code, errors: [{ code: 'required', field: 'note' }], status: 422 },
    status: 422,
  });

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('the drawer rejecting, attacked', () => {
  it('opens no dialog and sends nothing while an approval is in flight', async () => {
    const host = await open(approvable());
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockReturnValue(
      new Promise(() => undefined),
    );
    (host.querySelector('[data-part="approve"]') as HTMLElement).click();
    await settle();
    overlays.open.mockClear();

    await drawer.reject();
    await settle();

    expect(overlays.open).not.toHaveBeenCalled();
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
  });

  it.each(['approved', 'more_requested', 'rejected'] as const)(
    'opens no dialog when reject is called on a file %s',
    async (status) => {
      await open(decidedAs(status));

      await drawer.reject();

      expect(overlays.open).not.toHaveBeenCalled();
      expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
    },
  );

  it('keeps the button at least 44 px tall by class, not shrunk by a spinner', async () => {
    const host = await open();

    expect(rejectButton(host).classList).toContain('action');
    expect(rejectButton(host).type).toBe('button');
  });

  it('offers the request for more and the rejection while the approval waits for its checks', async () => {
    const host = await open(fileOf({ checks: [] }), 'en');

    expect(footerButtons(host).map((b) => [text(b), b.disabled])).toEqual([
      ['Approve and publish', true],
      ['Ask for more', false],
      ['Reject', false],
    ]);
  });

  it.each(['reason_required', 'note_required', 'note_too_short'])(
    'asks again on %s as many times as it is refused, one request per confirm',
    async (code) => {
      const host = await open();
      overlays.open.mockResolvedValue(CLOSED);
      api.verificationFileControllerDecision
        .mockRejectedValueOnce(unprocessable(code))
        .mockRejectedValueOnce(unprocessable(code))
        .mockRejectedValueOnce(unprocessable(code))
        .mockImplementationOnce(async () => {
          answer = async () => decidedAs('rejected');
          return decidedAs('rejected');
        });

      rejectButton(host).click();
      for (let i = 0; i < 4; i++) await settle();

      expect(overlays.open).toHaveBeenCalledTimes(4);
      expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(4);
      expect(toast).not.toHaveBeenCalled();
      expect(text(section(host, 'footer'))).toContain('Respins de Ioana');
    },
  );

  it('stops asking when the dialog is cancelled after a 422, leaving the button usable and focused', async () => {
    const host = await open();
    overlays.open
      .mockResolvedValueOnce(CLOSED)
      .mockResolvedValueOnce('cancelled');
    api.verificationFileControllerDecision.mockRejectedValue(
      unprocessable('note_too_short'),
    );

    rejectButton(host).click();
    await settle();
    await settle();

    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    expect(rejectButton(host).disabled).toBe(false);
    expect(rejectButton(host).hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(rejectButton(host));
  });

  it('keeps the dialog controls enabled in the drawer while a 422 dialog is open', async () => {
    const host = await open();
    overlays.open
      .mockResolvedValueOnce(CLOSED)
      .mockReturnValueOnce(new Promise(() => undefined));
    api.verificationFileControllerDecision.mockRejectedValue(
      unprocessable('note_too_short'),
    );

    rejectButton(host).click();
    await settle();
    await settle();

    expect(rejectButton(host).hasAttribute('aria-busy')).toBe(false);
    expect(overlays.open).toHaveBeenCalledTimes(2);
  });

  it('toasts and does not ask again when the re-read after a 422 fails', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => {
        throw new HttpErrorResponse({ status: 500 });
      };
      throw unprocessable('note_too_short');
    });

    rejectButton(host).click();
    await settle();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['approved', 'Aprobat de Ioana'],
    ['more_requested', 'Ioana'],
  ] as const)(
    'does not ask again on a 422 when the re-read shows the file %s by another admin',
    async (status, line) => {
      const host = await open();
      overlays.open.mockResolvedValue(CLOSED);
      api.verificationFileControllerDecision.mockImplementation(async () => {
        answer = async () => decidedAs(status);
        throw unprocessable('note_required');
      });

      rejectButton(host).click();
      await settle();
      await settle();

      expect(overlays.open).toHaveBeenCalledTimes(1);
      expect(text(section(host, 'footer'))).toContain(line);
      expect(rejectButton(host)).toBeNull();
    },
  );

  it.each([
    [
      'a 400 validation_failed',
      new HttpErrorResponse({
        error: { code: 'validation_failed' },
        status: 400,
      }),
    ],
    [
      'a 404',
      new HttpErrorResponse({ error: { code: 'not_found' }, status: 404 }),
    ],
    ['a 403', new HttpErrorResponse({ status: 403 })],
    ['a 429', new HttpErrorResponse({ status: 429 })],
    [
      'a 503 with an HTML body',
      new HttpErrorResponse({ error: '<html>down</html>', status: 503 }),
    ],
    ['a 422 with an unknown code', unprocessable('something_else')],
    [
      'a 409 with an unknown code',
      new HttpErrorResponse({ error: { code: 'other_conflict' }, status: 409 }),
    ],
    ['a plain Error', new Error('boom')],
    ['null', null],
  ])(
    'toasts and reads the file again on %s, asking nothing more',
    async (_name, failure) => {
      const host = await open();
      overlays.open.mockResolvedValue(CLOSED);
      api.verificationFileControllerDecision.mockRejectedValue(failure);
      const reads = api.verificationFileControllerRead.mock.calls.length;

      rejectButton(host).click();
      await settle();

      expect(api.verificationFileControllerRead.mock.calls.length).toBe(
        reads + 1,
      );
      expect(overlays.open).toHaveBeenCalledTimes(1);
      expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
      expect(rejectButton(host).disabled).toBe(false);
    },
  );

  it('says "Nu am putut salva decizia" in English too on a network failure', async () => {
    const host = await open(fileOf(), 'en');
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockRejectedValue(
      new HttpErrorResponse({ status: 0 }),
    );

    rejectButton(host).click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Could not save the decision');
  });

  it('shows who decided on a 409 whose decider is MotorFix, with no toast', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => decidedAs('approved', { decidedBy: null });
      throw new HttpErrorResponse({
        error: {
          code: 'verification_transition_refused',
          currentStatus: 'approved',
          decidedAt: DECIDED_AT,
          decidedBy: 'MotorFix',
        },
        status: 409,
      });
    });

    rejectButton(host).click();
    await settle();

    expect(text(alertIn(host))).toContain('Deja decis de MotorFix la');
    expect(toast).not.toHaveBeenCalled();
    expect(rejectButton(host)).toBeNull();
  });

  it('shows a markup note on the decided footer as text', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () =>
        decidedAs('rejected', { reasonNote: '<img src=x onerror=alert(1)>' });
      return decidedAs('rejected');
    });

    rejectButton(host).click();
    await settle();

    expect(section(host, 'footer')?.querySelector('img')).toBeNull();
    expect(text(section(host, 'footer'))).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it.each(['documents', 'rar', 'address', 'photos', 'other'])(
    'shows a label, never the raw code %s, on the decided footer',
    async (code) => {
      const host = await open(decidedAs('rejected', { reasonCode: code }));

      const footer = text(section(host, 'footer'));
      expect(footer).toMatch(/Motiv: \S/);
      expect(footer).not.toMatch(new RegExp(`Motiv: ${code}\\b`));
    },
  );

  it('sends the dialog answer as it came, with no extra keys', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockResolvedValue(undefined);

    rejectButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision.mock.calls[0]?.[0]).toEqual({
      body: { decision: 'rejected', note: CLOSED.note, reason: CLOSED.reason },
      id: FILE,
    });
  });

  it('moves focus to the title only after the success, not after a failure', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    rejectButton(host).click();
    await settle();

    expect(document.activeElement).not.toBe(host.querySelector('h3'));
  });
});
