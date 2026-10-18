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

// @traces 304-request-garage-details-FR-001
// @traces 304-request-garage-details-FR-011
// @traces 304-request-garage-details-FR-009

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
  verificationFileControllerChanges: jest.Mock;
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
    verificationFileControllerChanges: jest.fn(async () => ({
      changes: [],
      requestedAt: DECIDED_AT,
      resubmitted: true,
      total: 0,
    })),
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
const askButton = (host: HTMLElement) =>
  section(host, 'footer')?.querySelector<HTMLButtonElement>(
    '[data-part="ask"]',
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
const CLOSED = {
  note: 'Lipsesc fotografiile atelierului.',
  requestedItems: ['photos', 'documents'],
};
const unprocessable = (code: string) =>
  new HttpErrorResponse({
    error: { code, errors: [{ code: 'required', field: 'note' }], status: 422 },
    status: 422,
  });

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('asking a garage for more from the drawer', () => {
  it('offers "Cere completări" enabled whatever the checks say, at the tap height', async () => {
    const host = await open(fileOf({ checks: [] }));

    expect(text(askButton(host))).toBe('Cere completări');
    expect(askButton(host).disabled).toBe(false);
    expect(askButton(host).type).toBe('button');
    expect(askButton(host).classList).toContain('action');
  });

  it('opens the dialog titled "Ce lipsește?" and sends nothing by itself', async () => {
    const host = await open();
    overlays.open.mockReturnValue(new Promise(() => undefined));

    askButton(host).click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: {},
        shape: 'dialog',
        title: 'admin.file.more.title',
      }),
    );
    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
  });

  it('opens no second dialog on a second press', async () => {
    const host = await open();
    overlays.open.mockReturnValue(new Promise(() => undefined));

    askButton(host).click();
    askButton(host).click();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it.each(['approved', 'more_requested', 'rejected'] as const)(
    'offers no request on a file %s, and ask() opens nothing',
    async (status) => {
      const host = await open(decidedAs(status));

      await drawer.ask();

      expect(askButton(host)).toBeNull();
      expect(overlays.open).not.toHaveBeenCalled();
    },
  );

  it('sends the dialog answer as a request for more, with no extra keys', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockResolvedValue(undefined);

    askButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerDecision.mock.calls[0]?.[0]).toEqual({
      body: { decision: 'more_requested', ...CLOSED },
      id: FILE,
    });
  });

  it('shows a named spinner on the button and keeps every decision disabled while the call is out', async () => {
    const host = await open(approvable());
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockReturnValue(
      new Promise(() => undefined),
    );

    askButton(host).click();
    await settle();

    expect(askButton(host).getAttribute('aria-busy')).toBe('true');
    expect(
      askButton(host).querySelector('[data-part="spinner"]'),
    ).not.toBeNull();
    expect(footerButtons(host).map((b) => b.disabled)).toEqual([
      true,
      true,
      true,
    ]);
    const approve = section(host, 'footer')?.querySelector(
      '[data-part="approve"]',
    );
    expect(approve?.hasAttribute('aria-busy')).toBe(false);
    expect(approve?.querySelector('[data-part="spinner"]')).toBeNull();
  });

  it('shows the decided footer with the note and the items, and focuses the title', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () =>
        decidedAs('more_requested', {
          reasonCode: null,
          reasonNote: CLOSED.note,
          requestedItems: CLOSED.requestedItems,
        });
    });

    askButton(host).click();
    await settle();

    const footer = text(section(host, 'footer'));
    expect(footer).toContain('Completări cerute de Ioana');
    expect(footer).toContain('Lipsesc fotografiile atelierului.');
    expect(footer).toContain('Privește: Fotografiile, Documente');
    expect(askButton(host)).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('h3'));
  });

  it('reads the decided footer in English', async () => {
    const host = await open(
      decidedAs('more_requested', {
        reasonCode: null,
        reasonNote: CLOSED.note,
        requestedItems: ['rar'],
      }),
      'en',
    );

    expect(text(section(host, 'footer'))).toContain(
      'It concerns: The RAR authorisation',
    );
  });

  it('shows no items line when none was ticked', async () => {
    const host = await open(
      decidedAs('more_requested', {
        reasonCode: null,
        reasonNote: CLOSED.note,
        requestedItems: [],
      }),
    );

    expect(text(section(host, 'footer'))).not.toContain('Privește');
  });

  it('returns focus to the button on cancel, sending nothing', async () => {
    const host = await open();
    overlays.open.mockResolvedValue('cancelled');

    askButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(askButton(host));
  });

  it('names who decided first on a 409 and reads the file again, with no toast', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    const reads = api.verificationFileControllerRead.mock.calls.length;
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => decidedAs('rejected');
      throw new HttpErrorResponse({
        error: {
          code: 'verification_transition_refused',
          currentStatus: 'rejected',
          decidedAt: DECIDED_AT,
          decidedBy: 'Ioana',
        },
        status: 409,
      });
    });

    askButton(host).click();
    await settle();

    expect(text(alertIn(host))).toContain('Deja decis de Ioana la');
    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      reads + 1,
    );
    expect(toast).not.toHaveBeenCalled();
    expect(askButton(host)).toBeNull();
  });

  it.each([
    ['note_required', 'noteRequired'],
    ['note_too_short', 'noteTooShort'],
  ])(
    'opens the dialog again on a 422 %s with what was entered and the note marked',
    async (code, refused) => {
      const host = await open();
      overlays.open
        .mockResolvedValueOnce(CLOSED)
        .mockReturnValueOnce(new Promise(() => undefined));
      api.verificationFileControllerDecision.mockRejectedValue(
        unprocessable(code),
      );

      askButton(host).click();
      await settle();
      await settle();

      expect(overlays.open).toHaveBeenCalledTimes(2);
      expect(overlays.open.mock.calls[1]?.[1]).toEqual(
        expect.objectContaining({ data: { ...CLOSED, refused } }),
      );
      expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a 500', new HttpErrorResponse({ status: 500 })],
    ['a network failure', new HttpErrorResponse({ status: 0 })],
    ['a 422 with another code', unprocessable('something_else')],
    ['a plain Error', new Error('boom')],
  ])(
    'toasts "Nu am putut salva decizia" on %s, reads the file again and never sends twice',
    async (_name, failure) => {
      const host = await open();
      overlays.open.mockResolvedValue(CLOSED);
      api.verificationFileControllerDecision.mockRejectedValue(failure);
      const reads = api.verificationFileControllerRead.mock.calls.length;

      askButton(host).click();
      await settle();

      expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
      expect(api.verificationFileControllerRead.mock.calls.length).toBe(
        reads + 1,
      );
      expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
      expect(overlays.open).toHaveBeenCalledTimes(1);
      expect(askButton(host).disabled).toBe(false);
      expect(askButton(host).hasAttribute('aria-busy')).toBe(false);
    },
  );

  it('shows the committed request after a failure whose re-read finds it', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () =>
        decidedAs('more_requested', {
          reasonCode: null,
          reasonNote: CLOSED.note,
          requestedItems: [],
        });
      throw new HttpErrorResponse({ status: 504 });
    });

    askButton(host).click();
    await settle();

    expect(text(section(host, 'footer'))).toContain(
      'Completări cerute de Ioana',
    );
    expect(askButton(host)).toBeNull();
  });
});

describe('the changes panel in the drawer', () => {
  const returned = () =>
    fileOf({
      file: {
        decidedAt: DECIDED_AT,
        decidedBy: ioana,
        requestedAt: DECIDED_AT,
        resubmitted: true,
        status: 'in_review',
      },
    });

  it('shows the panel for a file sent back, read before the checks', async () => {
    const host = await open(returned());

    const panel = section(host, 'changes');
    expect(panel).not.toBeNull();
    expect(api.verificationFileControllerChanges).toHaveBeenCalledWith({
      id: FILE,
    });
    const register = section(host, 'register') as HTMLElement;
    expect(
      (panel as HTMLElement).compareDocumentPosition(register) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no panel and reads no changes for a file never sent back', async () => {
    const host = await open(fileOf({ file: { resubmitted: false } }));

    expect(section(host, 'changes')).toBeNull();
    expect(api.verificationFileControllerChanges).not.toHaveBeenCalled();
  });

  it('keeps every decision usable while the panel has failed', async () => {
    const host = await open(async () => {
      api.verificationFileControllerChanges.mockRejectedValue(
        new HttpErrorResponse({ status: 500 }),
      );
      return returned();
    });

    expect(
      text(section(host, 'changes')?.querySelector('[role="alert"] p')),
    ).toBe('Nu am putut încărca modificările');
    expect(askButton(host).disabled).toBe(false);
    expect(footerButtons(host).some((b) => !b.disabled)).toBe(true);
  });

  it('reads the file again when the garage sends it back while it is open', async () => {
    await open(decidedAs('more_requested'));
    const reads = api.verificationFileControllerRead.mock.calls.length;
    answer = async () => returned();

    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.submitted',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(
      api.verificationFileControllerRead.mock.calls.length,
    ).toBeGreaterThan(reads);
  });
});
