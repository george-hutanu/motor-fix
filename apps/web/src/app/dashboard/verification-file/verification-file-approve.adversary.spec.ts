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

// @traces 203-FR-006 203-FR-008
// @traces 204-FR-007 204-FR-009
// @traces 302-FR-003 302-FR-004 302-FR-005 302-FR-006 302-FR-007 302-FR-008 302-FR-009 302-FR-010 302-FR-011

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
    // The server counts the open reports, as read here unless a test says.
    reportsOpen: (rest.reports ?? []).filter((r) => r.status === 'open').length,
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

const ok = (kind: string, rar = 'ok', caen = 'ok') =>
  check(kind as (typeof KINDS)[number], {
    result: (kind === 'rar' ? rar : kind === 'caen' ? caen : 'ok') as never,
  });
const gated = (rar: string, caen: string) =>
  fileOf({ checks: KINDS.map((kind) => ok(kind, rar, caen)) });
const approvedFile = () =>
  fileOf({
    checks: KINDS.map((kind) => check(kind, { result: 'ok' })),
    file: {
      decidedAt: new Date().toISOString(),
      decidedBy: ioana,
      status: 'approved',
    },
  });
const approveButton = (host: HTMLElement) =>
  [...(section(host, 'footer')?.querySelectorAll('button') ?? [])].find((b) =>
    ['Aprobă și publică', 'Approve and publish'].includes(text(b)),
  ) as HTMLButtonElement;
const hint = (host: HTMLElement) =>
  section(host, 'footer')?.querySelector<HTMLElement>(
    '[data-part="gate-hint"]',
  ) ?? null;
const noteRequired = (missing: unknown[] = []) =>
  new HttpErrorResponse({
    error: { code: 'note_required', missing },
    status: 422,
  });
const conflict = (code: string, extra: object = {}) =>
  new HttpErrorResponse({ error: { code, ...extra }, status: 409 });
const approve = () =>
  (drawer as unknown as { approve(): Promise<void> }).approve();

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('the approve button gate, attacked', () => {
  // @traces 303-FR-001
  it('holds the button with the RAR hint when the file has no checks at all', async () => {
    const host = await open(fileOf({ checks: [] }));

    expect(approveButton(host).disabled).toBe(true);
    expect(text(hint(host))).toBe('Verificarea RAR e obligatorie');
  });

  // @traces 303-FR-001
  it('holds the button with the CAEN hint when rar is ok and the caen row is absent', async () => {
    const host = await open(
      fileOf({ checks: KINDS.filter((k) => k !== 'caen').map((k) => ok(k)) }),
    );

    expect(approveButton(host).disabled).toBe(true);
    expect(text(hint(host))).toBe('Verificarea CAEN 4520 e obligatorie');
  });

  // @traces 303-FR-001
  it.each(['not_run', 'warning', 'failed'])(
    'treats a %s rar as holding the button, whatever caen says',
    async (rar) => {
      const host = await open(gated(rar, 'ok'));

      expect(approveButton(host).disabled).toBe(true);
      expect(text(hint(host))).toBe('Verificarea RAR e obligatorie');
    },
  );

  // @traces 303-FR-001
  it('opens no dialog when approve is called while a gate holds', async () => {
    await open(gated('not_run', 'ok'));

    await approve();

    expect(overlays.open).not.toHaveBeenCalled();
    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
  });

  // @traces 303-FR-001
  it('opens no dialog and sends nothing for a file already approved', async () => {
    await open(approvedFile());

    await approve();

    expect(overlays.open).not.toHaveBeenCalled();
    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
  });

  // @traces 303-FR-001
  it('turns the hint to CAEN, then away, as the checks change under the open drawer', async () => {
    let current = gated('not_run', 'not_run');
    const host = await open(async () => current);
    expect(text(hint(host))).toBe('Verificarea RAR e obligatorie');

    current = gated('ok', 'not_run');
    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.check_recorded',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
    expect(text(hint(host))).toBe('Verificarea CAEN 4520 e obligatorie');
    expect(approveButton(host).disabled).toBe(true);

    current = gated('ok', 'ok');
    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.check_recorded',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
    expect(hint(host)).toBeNull();
    expect(approveButton(host).disabled).toBe(false);
  });

  // @traces 303-FR-001
  it('names the hint to assistive technology and leaves the other two buttons disabled while held', async () => {
    const host = await open(gated('not_run', 'not_run'), 'en');

    const button = approveButton(host);
    expect(text(hint(host))).toBe('The RAR check is required');
    expect(button.getAttribute('aria-describedby')).toBe(hint(host)?.id);
    const others = [
      ...(section(host, 'footer')?.querySelectorAll('button') ?? []),
    ].filter((b) => b !== button);
    expect(others.every((b) => b.disabled)).toBe(true);
  });

  // @traces 303-FR-001
  it('shows no hint on an approved file even when its rar check reads not run', async () => {
    const decided = fileOf({
      checks: KINDS.map((kind) => check(kind)),
      file: {
        decidedAt: new Date().toISOString(),
        decidedBy: ioana,
        status: 'approved',
      },
    });
    const host = await open(decided);

    expect(hint(host)).toBeNull();
    expect(approveButton(host)).toBeUndefined();
  });
});

describe('approving, attacked', () => {
  // @traces 303-FR-002
  it('opens one dialog when approve is called twice before the first answers', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockReturnValue(new Promise(() => undefined));

    approveButton(host).click();
    approveButton(host).click();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  // @traces 303-FR-002
  it('sends the approval without a note key when the dialog closes with an empty answer', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockResolvedValue(undefined);

    approveButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision.mock.calls[0]?.[0]).toEqual({
      body: { decision: 'approved' },
      id: FILE,
    });
  });

  // @traces 303-FR-009
  it('sends exactly one request when the button is pressed again while the call is out', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    let finish: () => void = () => undefined;
    api.verificationFileControllerDecision.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    approveButton(host).click();
    await settle();
    await approve();
    await approve();
    await settle();

    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    expect(overlays.open).toHaveBeenCalledTimes(1);
    finish();
    await settle();
  });

  // @traces 303-FR-009
  it('tells a rar_check_required refusal, with no save-failed toast and the button back', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockRejectedValue(
      conflict('rar_check_required'),
    );

    approveButton(host).click();
    await settle();

    expect(
      section(host, 'footer')?.querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(approveButton(host).disabled).toBe(false);
    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  // @traces 303-FR-009
  it('shows who decided first on a 409 transition refusal and does not ask again', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => approvedFile();
      throw conflict('verification_transition_refused', {
        decidedAt: NOW.toISOString(),
        decidedBy: 'Dan',
      });
    });

    approveButton(host).click();
    await settle();

    expect(text(section(host, 'footer'))).toContain('Deja decis de Dan');
    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
  });

  // @traces 303-FR-009
  it('does not ask again on note_required when the re-read shows another admin decided', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => approvedFile();
      throw noteRequired([{ kind: 'photos', result: 'failed' }]);
    });

    approveButton(host).click();
    await settle();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    expect(text(section(host, 'footer'))).toContain('Aprobat de Ioana');
  });

  // @traces 303-FR-009
  it('toasts and stops when the re-read after note_required fails', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => {
        throw new HttpErrorResponse({ status: 500 });
      };
      throw noteRequired();
    });

    approveButton(host).click();
    await settle();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
  });

  // @traces 303-FR-009
  it("reopens the dialog from the 422 body's missing list, not from the re-read file", async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValueOnce({}).mockResolvedValueOnce('cancelled');
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () =>
        fileOf({
          checks: KINDS.map((kind) =>
            check(kind, { result: kind === 'address' ? 'warning' : 'ok' }),
          ),
        });
      throw noteRequired([{ kind: 'photos', result: 'failed' }]);
    });

    approveButton(host).click();
    await settle();
    await settle();

    expect(overlays.open.mock.calls[1]?.[1]?.data).toEqual({
      missing: [{ kind: 'photos', result: 'failed' }],
    });
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
  });

  // @traces 303-FR-009
  it('leaves the button usable after a network failure that committed nothing', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockRejectedValue(
      new HttpErrorResponse({ status: 0 }),
    );

    approveButton(host).click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(approveButton(host).disabled).toBe(false);
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
  });

  // @traces 303-FR-002
  it('lists both documents and the documents check when the file holds neither', async () => {
    const host = await open(
      fileOf({
        checks: KINDS.map((kind) =>
          check(kind, { result: kind === 'documents' ? 'not_run' : 'ok' }),
        ),
        documents: [],
      }),
    );
    overlays.open.mockResolvedValue('cancelled');

    approveButton(host).click();
    await settle();

    expect(overlays.open.mock.calls[0]?.[1]?.data).toEqual({
      missing: [
        { kind: 'documents', result: 'not_run' },
        { document: 'onrc_certificate' },
        { document: 'rar_authorisation' },
      ],
    });
  });

  // @traces 303-FR-002
  it('counts a document the file lists as not present as missing', async () => {
    const host = await open(
      fileOf({
        checks: KINDS.map((kind) => check(kind, { result: 'ok' })),
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: null,
            kind: 'onrc_certificate',
            pages: 0,
            present: false,
            stale: null,
          },
          {
            id: 'doc-rar',
            issuedOn: null,
            kind: 'rar_authorisation',
            pages: 1,
            present: true,
            stale: null,
          },
        ] as VerificationFileDto['documents'],
      }),
    );
    overlays.open.mockResolvedValue('cancelled');

    approveButton(host).click();
    await settle();

    expect(overlays.open.mock.calls[0]?.[1]?.data).toEqual({
      missing: [{ document: 'onrc_certificate' }],
    });
  });

  // @traces 303-FR-011
  it('hands focus back to the approve button when the dialog is cancelled', async () => {
    const host = await open(gated('ok', 'ok'));
    overlays.open.mockResolvedValue('cancelled');

    approveButton(host).click();
    await settle();
    approveButton(host).click();
    await settle();

    expect(document.activeElement).toBe(approveButton(host));
    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
  });
});

describe('the repeated CUI line, attacked', () => {
  const shared = (host: HTMLElement) =>
    section(host, 'header')?.querySelector<HTMLElement>(
      '[data-part="cui-shared"]',
    ) ?? null;
  const withShared = (names: string[]) =>
    fileOf({
      checks: KINDS.map((kind) => check(kind, { result: 'ok' })),
      garage: { cuiAlsoUsedBy: names } as never,
    });

  // @traces 303-FR-007
  it('renders a garage name holding markup as text', async () => {
    const host = await open(withShared(['<b>Auto</b> & Co']));

    expect(text(shared(host))).toBe(
      'CUI folosit și de alt service: <b>Auto</b> & Co',
    );
    expect(shared(host)?.querySelector('b')).toBeNull();
  });

  // @traces 303-FR-007
  it('names all of fifty other garages on one line, in the given order', async () => {
    const names = Array.from({ length: 50 }, (_, i) => `Service ${i + 1}`);
    const host = await open(withShared(names));

    expect(text(shared(host))).toBe(
      `CUI folosit și de alt service: ${names.join(', ')}`,
    );
  });

  // @traces 303-FR-007
  it('keeps the line on a decided file', async () => {
    const host = await open(
      fileOf({
        checks: KINDS.map((kind) => check(kind, { result: 'ok' })),
        file: {
          decidedAt: new Date().toISOString(),
          decidedBy: ioana,
          status: 'approved',
        },
        garage: { cuiAlsoUsedBy: ['Service Dobre'] } as never,
      }),
    );

    expect(text(shared(host))).toBe(
      'CUI folosit și de alt service: Service Dobre',
    );
  });
});
