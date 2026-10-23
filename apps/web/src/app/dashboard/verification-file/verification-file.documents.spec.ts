import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type AuditEntryDto,
  type DocumentDecisionDto,
  VerificationDocumentsService,
  type VerificationFileDocumentDto,
  type VerificationFileDocumentReviewDto,
  type VerificationFileDto,
} from '@motor-fix/data-access';
import { appliedAt, I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { VerificationFile } from './verification-file';
import { AdminRestoreGarage } from '../admin-restore-garage/admin-restore-garage';
import { DocumentRefuse } from '../document-refuse/document-refuse';
import { Live } from '../live';

// @traces 068-FR-012

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const FILE = 'file-1';
const ioana = { id: 'admin-1', name: 'Ioana' };

const review = (
  extra: Partial<VerificationFileDocumentReviewDto> = {},
): VerificationFileDocumentReviewDto => ({
  decidedAt: null,
  decidedBy: null,
  id: 'new-onrc',
  issuedOn: '2026-10-10',
  pages: 2,
  refusal: null,
  status: 'in_review',
  uploadedAt: '2026-10-12T09:00:00.000Z',
  ...extra,
});

const documentOf = (
  kind: VerificationFileDocumentDto['kind'],
  extra: Partial<VerificationFileDocumentDto> = {},
): VerificationFileDocumentDto => ({
  decidedAt: null,
  decidedBy: null,
  id: `doc-${kind}`,
  issuedOn: '2025-10-01',
  kind,
  pages: 1,
  present: true,
  replaced: [],
  review: null,
  stale: kind === 'onrc_certificate' ? false : null,
  ...extra,
});

function fileOf(
  documents: VerificationFileDocumentDto[],
  timeline: AuditEntryDto[] = [],
): VerificationFileDto {
  return {
    activities: [],
    catalogue: [],
    checks: [],
    documentCycle: null,
    documents,
    file: {
      decidedAt: '2025-10-05T09:00:00.000Z',
      decidedBy: ioana,
      declaredAt: '2025-10-01T09:00:00.000Z',
      declaredByName: 'Andrei Dobre',
      id: FILE,
      openedAt: '2025-10-02T09:00:00.000Z',
      openedBy: ioana,
      rarNumber: 'B 1234/2019',
      reasonCode: null,
      reasonNote: null,
      reopenedAt: null,
      reopenedBy: null,
      reopenReason: null,
      status: 'approved',
      submittedAt: '2025-10-01T09:00:00.000Z',
    },
    garage: {
      address: 'Strada Fabricii 12, Cluj-Napoca',
      brands: ['Dacia'],
      businessKind: 'company',
      cui: '12345678',
      cuiAlsoUsedBy: [],
      cuiWarning: null,
      id: 'garage-1',
      name: 'Atelier Dinamo',
      phone: null,
      photos: [],
      seatAddress: null,
      serviceRadiusKm: null,
    },
    jobs: [],
    previousRejection: null,
    reports: [],
    reportsOpen: 0,
    storageReady: true,
    timeline: { entries: timeline, total: timeline.length },
  } as unknown as VerificationFileDto;
}

const inReview = () =>
  fileOf([
    documentOf('onrc_certificate', { review: review() }),
    documentOf('rar_authorisation', {
      review: review({ id: 'new-rar', issuedOn: '2026-09-01', pages: 1 }),
    }),
  ]);

const decision = (
  extra: Partial<DocumentDecisionDto> = {},
): DocumentDecisionDto => ({
  cycle: null,
  document: {
    decidedAt: '2026-10-23T09:00:00.000Z',
    id: 'new-onrc',
    kind: 'onrc_certificate',
    status: 'valid',
  },
  suspendedFor: null,
  ...extra,
});

let events: Subject<LiveMessage>;
let answer: () => Promise<VerificationFileDto>;
let api: {
  documentReviewControllerAccept: jest.Mock;
  documentReviewControllerRefuse: jest.Mock;
  verificationFileControllerOpen: jest.Mock;
  verificationFileControllerRead: jest.Mock;
};
let pages: { legalDocumentsControllerPageAddress: jest.Mock };
let overlays: { open: jest.Mock };

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  file: VerificationFileDto = inReview(),
  language: 'ro' | 'en' = 'ro',
  part?: 'documents',
) {
  events = new Subject();
  answer = async () => file;
  api = {
    documentReviewControllerAccept: jest.fn(async () => decision()),
    documentReviewControllerRefuse: jest.fn(async () =>
      decision({
        document: {
          decidedAt: '2026-10-23T09:00:00.000Z',
          id: 'new-onrc',
          kind: 'onrc_certificate',
          status: 'refused',
        },
      }),
    ),
    verificationFileControllerOpen: jest.fn(() => answer()),
    verificationFileControllerRead: jest.fn(() => answer()),
  };
  pages = {
    legalDocumentsControllerPageAddress: jest.fn(async () => ({
      expiresAt: '2026-10-23T09:05:00.000Z',
      url: 'https://store.test/signed',
    })),
  };
  overlays = { open: jest.fn() };
  jest
    .spyOn(window, 'open')
    .mockReturnValue({ close: jest.fn(), location: { href: '' } } as never);
  jest.mocked(toast).mockClear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AdminService, useValue: api },
      { provide: VerificationDocumentsService, useValue: pages },
      { provide: Overlays, useValue: overlays },
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: part ? { fileId: FILE, part } : { fileId: FILE },
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
          resync: new Subject<void>(),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  await i18n.enter('public');
  const fixture = TestBed.createComponent(VerificationFile);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const kindRow = (host: HTMLElement, kind: string) =>
  host.querySelector<HTMLElement>(
    `[data-section="documents"] [data-kind="${kind}"]`,
  );
const reviewOf = (host: HTMLElement, kind: string) =>
  kindRow(host, kind)?.querySelector<HTMLElement>('.review') ?? null;
const press = (el: Element | null, name: string) =>
  [...(el?.querySelectorAll('button') ?? [])]
    .find((b) => text(b) === name)
    ?.click();

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('a yearly document under review in the drawer', () => {
  it('shows when it was uploaded, its issue date, its pages and the two decisions', async () => {
    const host = await open();

    const onrc = reviewOf(host, 'onrc_certificate');
    expect(text(onrc?.querySelector('.line'))).toBe(
      'Document nou · încărcat 12 oct. 2026 · emis pe 10 oct. 2026',
    );
    expect(text(onrc?.querySelector('.status'))).toBe('în verificare');
    const labels = [...(onrc?.querySelectorAll('button') ?? [])].map((b) =>
      text(b),
    );
    expect(labels).toEqual([
      'Deschide pagina 1',
      'Deschide pagina 2',
      'Acceptă',
      'Refuză',
    ]);
    expect(
      onrc?.querySelector('[data-part="accept"]')?.getAttribute('aria-label'),
    ).toBe('Acceptă Certificat constatator ONRC');
  });

  it('opens a page of the new document through the existing page address', async () => {
    const host = await open();

    press(reviewOf(host, 'onrc_certificate'), 'Deschide pagina 2');
    await settle();

    expect(pages.legalDocumentsControllerPageAddress).toHaveBeenCalledWith({
      documentId: 'new-onrc',
      id: FILE,
      n: '2',
    });
  });

  it('reads in English', async () => {
    const host = await open(inReview(), 'en');

    const onrc = reviewOf(host, 'onrc_certificate');
    expect(text(onrc?.querySelector('.line'))).toBe(
      'New document · uploaded 12 Oct 2026 · issued on 10 Oct 2026',
    );
    expect(text(onrc?.querySelector('.status'))).toBe('under review');
    const labels = [...(onrc?.querySelectorAll('button') ?? [])].map((b) =>
      text(b),
    );
    expect(labels.slice(-2)).toEqual(['Accept', 'Refuse']);
  });

  it('accepts the one document pressed and reads the file again', async () => {
    const host = await open();
    const before = api.verificationFileControllerRead.mock.calls.length;

    press(reviewOf(host, 'rar_authorisation'), 'Acceptă');
    await settle();

    expect(api.documentReviewControllerAccept).toHaveBeenCalledTimes(1);
    expect(api.documentReviewControllerAccept).toHaveBeenCalledWith({
      id: 'new-rar',
    });
    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      before + 1,
    );
  });

  it('asks for a reason and a note before it refuses, and sends them', async () => {
    const host = await open();
    overlays.open.mockResolvedValue({
      note: 'Pagina 2 lipsește',
      reason: 'documents',
    });

    press(reviewOf(host, 'onrc_certificate'), 'Refuză');
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      DocumentRefuse,
      expect.objectContaining({
        data: { document: 'Certificat constatator ONRC' },
        shape: 'dialog',
        title: 'admin.file.documents.refuse.title',
      }),
    );
    expect(api.documentReviewControllerRefuse).toHaveBeenCalledWith({
      body: { note: 'Pagina 2 lipsește', reason: 'documents' },
      id: 'new-onrc',
    });
  });

  it('sends nothing when the refusal is cancelled', async () => {
    const host = await open();
    overlays.open.mockResolvedValue('cancelled');

    press(reviewOf(host, 'onrc_certificate'), 'Refuză');
    await settle();

    expect(api.documentReviewControllerRefuse).not.toHaveBeenCalled();
  });

  it('reads the file again when the document was decided elsewhere', async () => {
    const host = await open();
    api.documentReviewControllerAccept.mockRejectedValue(
      new HttpErrorResponse({
        error: { code: 'document_not_in_review' },
        status: 409,
      }),
    );
    const before = api.verificationFileControllerRead.mock.calls.length;

    press(reviewOf(host, 'onrc_certificate'), 'Acceptă');
    await settle();

    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      before + 1,
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('says so when a decision cannot be saved', async () => {
    const host = await open();
    api.documentReviewControllerAccept.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    press(reviewOf(host, 'onrc_certificate'), 'Acceptă');
    await settle();

    expect(toast).toHaveBeenCalledWith(
      'Decizia nu a putut fi salvată. Încearcă din nou.',
    );
  });

  it.each([
    'document.uploaded',
    'document.accepted',
    'document.refused',
    'document.overdue',
  ] as const)('reads the file again on %s', async (kind) => {
    await open();
    const before = api.verificationFileControllerRead.mock.calls.length;

    events.next({ at: '2026-10-23T09:00:00.000Z', id: 'any-document', kind });
    // The live reads wait a moment to fold a burst of messages into one.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      before + 1,
    );
  });
});

describe('a decided yearly document in the drawer', () => {
  it('shows who accepted the current document and when', async () => {
    const host = await open(
      fileOf([
        documentOf('onrc_certificate', {
          decidedAt: '2026-10-12T09:00:00.000Z',
          decidedBy: ioana,
        }),
        documentOf('rar_authorisation'),
      ]),
    );

    expect(
      text(kindRow(host, 'onrc_certificate')?.querySelector('.decided')),
    ).toMatch(/^Acceptat de Ioana, /);
    expect(
      kindRow(host, 'rar_authorisation')?.querySelector('.decided'),
    ).toBeNull();
  });

  it('shows a refused document with its decision, reason and note, and no buttons to decide', async () => {
    const host = await open(
      fileOf([
        documentOf('onrc_certificate', {
          review: review({
            decidedAt: '2026-10-13T09:00:00.000Z',
            decidedBy: ioana,
            refusal: { note: 'Pagina 2 lipsește', reason: 'documents' },
            status: 'refused',
          }),
        }),
        documentOf('rar_authorisation'),
      ]),
    );

    const refused = reviewOf(host, 'onrc_certificate');
    expect(text(refused?.querySelector('.status'))).toMatch(
      /^Refuzat de Ioana, /,
    );
    expect(text(refused?.querySelector('.refusal'))).toBe(
      'Motiv: Documente necorespunzătoare — Pagina 2 lipsește',
    );
    expect(refused?.querySelector('[data-part="accept"]')).toBeNull();
    expect(refused?.querySelector('[data-part="refuse"]')).toBeNull();
  });

  it('shows the suspension line after an acceptance on a suspended garage while documents are still missing, and no way back', async () => {
    const host = await open();
    api.documentReviewControllerAccept.mockResolvedValue(
      decision({ suspendedFor: 'documents_overdue' }),
    );

    press(reviewOf(host, 'onrc_certificate'), 'Acceptă');
    await settle();

    expect(
      text(host.querySelector('[data-section="documents"] .suspended')),
    ).toBe('Service‑ul este suspendat: documente anuale neîncărcate');
    expect(text(host)).not.toContain('Repune pe hartă');
  });

  it('offers the way back on the map once the last missing document is accepted', async () => {
    const host = await open();
    overlays.open.mockResolvedValueOnce('cancelled');
    api.documentReviewControllerAccept.mockResolvedValue(
      decision({
        cycle: {
          canUpload: false,
          dueOn: '2027-10-01',
          graceUntil: null,
          inReview: false,
          refusal: null,
          row: 'valid',
          state: 'due',
        } as DocumentDecisionDto['cycle'],
        suspendedFor: 'documents_overdue',
      }),
    );

    press(reviewOf(host, 'onrc_certificate'), 'Acceptă');
    await settle();

    expect(
      host.querySelector('[data-section="documents"] .suspended'),
    ).toBeNull();
    const restore = host.querySelector<HTMLButtonElement>(
      '[data-section="documents"] [data-part="restore-documents"]',
    );
    expect(text(restore)).toBe('Repune pe hartă');

    restore?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      AdminRestoreGarage,
      expect.objectContaining({
        data: expect.objectContaining({
          cause: 'documents_overdue',
          documentsDue: true,
          garageId: 'garage-1',
        }),
        shape: 'dialog',
        title: 'admin.restore.dialog',
      }),
    );
  });
});

describe('the drawer opened at its Documente part', () => {
  it('moves the focus to the Documente heading', async () => {
    const host = await open(inReview(), 'ro', 'documents');

    expect(document.activeElement).toBe(
      host.querySelector('[data-section="documents"] h4'),
    );
  });

  it('brings the Documente part to the top, so its decisions show without a scroll', async () => {
    const scrolled: { el: Element; arg: unknown }[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg?: unknown) {
      scrolled.push({ arg, el: this });
    };
    try {
      const host = await open(inReview(), 'ro', 'documents');

      expect(scrolled).toEqual([
        {
          arg: { block: 'start' },
          el: host.querySelector('[data-section="documents"]'),
        },
      ]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('the yearly documents in the history', () => {
  const entry = (extra: Partial<AuditEntryDto>): AuditEntryDto =>
    ({
      action: 'update',
      actor: ioana,
      at: '2026-10-12T09:00:00.000Z',
      field: null,
      id: `entry-${Math.random()}`,
      kind: 'onrc_certificate',
      newValue: null,
      oldValue: null,
      subjectType: 'legal_document',
      text: null,
      ...extra,
    }) as AuditEntryDto;

  it('names each upload, acceptance and refusal of a document, and the cycle changes', async () => {
    const host = await open(
      fileOf(
        [documentOf('onrc_certificate'), documentOf('rar_authorisation')],
        [
          entry({
            action: 'create',
            actor: { id: 'owner-1', name: 'Andrei', role: 'owner' },
            newValue: { issuedOn: '2026-10-10', pages: 2 },
          }),
          entry({ field: 'status', newValue: 'valid' }),
          entry({
            field: 'status',
            kind: 'rar_authorisation',
            newValue: { note: 'x', reason: 'other', status: 'refused' },
          }),
          entry({
            actor: { id: null, name: 'MotorFix', role: 'system' },
            field: 'documents_state',
            kind: 'documents_overdue',
            newValue: { graceUntil: '2026-11-06', state: 'overdue' },
            subjectType: 'garage',
          }),
          entry({
            field: 'documents_due_on',
            kind: null,
            newValue: '2027-10-12',
            subjectType: 'garage',
          }),
        ],
      ),
    );

    const when = appliedAt('2026-10-12T09:00:00.000Z', 'ro', new Date());
    const lines = [...host.querySelectorAll('[data-section="history"] li')].map(
      (li) => text(li).replace(`, ${when}`, ''),
    );
    expect(lines).toEqual([
      'Certificat constatator ONRC: încărcat de Andrei',
      'Certificat constatator ONRC: acceptat de Ioana',
      'Autorizația tehnică RAR: refuzat de Ioana',
      'Documente anuale restante — MotorFix',
      'Documente anuale: termen nou 12 oct. 2027 — Ioana',
    ]);
  });
});
