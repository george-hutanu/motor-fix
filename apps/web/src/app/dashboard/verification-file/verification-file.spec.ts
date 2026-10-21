import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type AuditEntryDto,
  VerificationDocumentsService,
  type VerificationFileCheckDto,
  type VerificationFileDto,
  type VerificationFileReportDto,
} from '@motor-fix/data-access';
import { appliedAt, I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { VerificationFile } from './verification-file';
import { Live } from '../live';
import { ReportDecision } from '../report-decision/report-decision';

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
const elena = { id: 'driver-1', name: 'Elena D.' };

// An open report from Elena, as the file read returns it.
const report = (
  extra: Partial<VerificationFileReportDto> = {},
): VerificationFileReportDto => ({
  createdAt: NOW.toISOString(),
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  id: 'report-1',
  reporter: elena,
  status: 'open',
  text: 'Adresă greșită pe pagina service-ului.',
  ...extra,
});

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
  reportDecisionControllerDecide: jest.Mock;
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
    reportDecisionControllerDecide: jest.fn(),
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
      provideRouter([]),
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
const row = (host: HTMLElement, name: string, kind: string) =>
  section(host, name)?.querySelector<HTMLElement>(`[data-kind="${kind}"]`) ??
  null;
const buttons = (el: Element | null) =>
  [...(el?.querySelectorAll('button') ?? [])].map((b) => text(b));
const box = (host: HTMLElement, kind: string) =>
  row(host, 'manual', kind)?.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  ) as HTMLInputElement;
const press = (el: Element | null, name: string) =>
  [...(el?.querySelectorAll('button') ?? [])]
    .find((b) => text(b) === name)
    ?.click();

function tick(host: HTMLElement, kind: string, checked: boolean) {
  const input = box(host, kind);
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const entry = (extra: Partial<AuditEntryDto>): AuditEntryDto =>
  ({
    action: 'update',
    actor: { id: 'admin-1', name: 'Ioana', role: 'admin' },
    at: NOW.toISOString(),
    carId: null,
    field: null,
    garageId: 'garage-1',
    id: `entry-${Math.random()}`,
    internal: false,
    jobId: null,
    kind: null,
    newValue: null,
    oldValue: null,
    subjectId: FILE,
    subjectType: 'verification_file',
    text: null,
    viaAssistant: false,
    ...extra,
  }) as AuditEntryDto;

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

describe('opening the file', () => {
  it('opens the file once, then re-reads it without opening again', async () => {
    const host = await open();

    expect(api.verificationFileControllerOpen).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerOpen).toHaveBeenCalledWith({
      id: FILE,
    });
    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.check_recorded',
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(api.verificationFileControllerOpen).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerRead).toHaveBeenCalledTimes(1);
    expect(text(host.querySelector('h3'))).toBe('Atelier Dinamo');
  });

  it('shows skeleton sections marked busy while the file is on its way', async () => {
    const host = await open(() => new Promise(() => undefined));

    const busy = host.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.getAttribute('aria-label')).toBe('Se deschide dosarul');
  });

  it('says it could not open the file and retries the opening', async () => {
    let fail = true;
    const host = await open(async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return fileOf();
    });

    expect(text(host.querySelector('[role="alert"]'))).toContain(
      'Nu am putut deschide dosarul',
    );
    fail = false;
    press(host, 'Reîncearcă');
    await settle();

    expect(api.verificationFileControllerOpen).toHaveBeenCalledTimes(2);
    expect(text(host.querySelector('h3'))).toBe('Atelier Dinamo');
  });
});

describe('the sections', () => {
  it('reads in order: header, rejected before, register, reports, documents, manual, history, footer', async () => {
    const host = await open(
      fileOf({
        previousRejection: {
          decidedAt: NOW.toISOString(),
          reasonCode: 'documents_unreadable',
          reasonNote: 'Certificatul nu se citește.',
        },
        reports: [report()],
      }),
    );

    expect(
      [...host.querySelectorAll('[data-section]')].map((s) =>
        s.getAttribute('data-section'),
      ),
    ).toEqual([
      'header',
      'rejected',
      'register',
      'reports',
      'documents',
      'manual',
      'history',
      'footer',
    ]);
  });

  it("reads a company's header: kind, CUI, address, phone, brands and photos", async () => {
    const host = await open();
    const header = section(host, 'header');

    expect(text(header)).toContain('Societate');
    expect(text(header)).toContain('CUI 12345678');
    expect(text(header)).toContain('Strada Fabricii 12, Cluj-Napoca');
    expect(text(header)).toContain('+40722111222');
    expect(text(header)).toContain('Dacia, Renault');
    const photo = header?.querySelector('a img');
    expect(photo?.getAttribute('src')).toBe('https://store.test/p1.thumb');
    expect(photo?.closest('a')?.getAttribute('href')).toBe(
      'https://store.test/p1.display',
    );
  });

  it.each([
    ['pfa', 'PFA'],
    ['ii', 'Întreprindere individuală'],
  ] as const)('names a %s business', async (businessKind, label) => {
    const host = await open(fileOf({ garage: { businessKind } }));

    expect(text(section(host, 'header'))).toContain(label);
  });

  it("reads a mobile mechanic's seat and radius, in both languages", async () => {
    const mobile = fileOf({
      garage: {
        address: null,
        businessKind: 'mobile',
        seatAddress: 'Strada Lungă 3, Brașov',
        serviceRadiusKm: 25,
      },
    });

    const ro = await open(mobile);
    expect(text(section(ro, 'header'))).toContain('Mecanic mobil');
    expect(text(section(ro, 'header'))).toContain(
      'Sediu social: Strada Lungă 3, Brașov · rază 25 km',
    );
    document.body.innerHTML = '';
    TestBed.resetTestingModule();

    const en = await open(mobile, 'en');
    expect(text(section(en, 'header'))).toContain('Mobile mechanic');
    expect(text(section(en, 'header'))).toContain(
      'Registered seat: Strada Lungă 3, Brașov · 25 km radius',
    );
  });

  it('leaves out the parts the garage has none of', async () => {
    const host = await open(
      fileOf({
        garage: { brands: [], cui: null, phone: null, photos: [] },
      }),
    );
    const header = section(host, 'header');

    expect(text(header)).not.toContain('CUI');
    expect(header?.querySelector('img')).toBeNull();
    expect(header?.querySelector('[data-part="phone"]')).toBeNull();
    expect(header?.querySelector('[data-part="brands"]')).toBeNull();
    expect(section(host, 'reports')).toBeNull();
    expect(section(host, 'rejected')).toBeNull();
  });

  it('shows a report as plain text, never as markup, and a reopening by a report', async () => {
    const host = await open(
      fileOf({
        file: { reopenedAt: NOW.toISOString(), reopenReason: 'garage_report' },
        reports: [report({ text: '<b>Nu există</b> atelierul' })],
      }),
    );
    const reported = section(host, 'reports');

    expect(text(reported)).toContain('<b>Nu există</b> atelierul');
    expect(reported?.querySelector('b')).toBeNull();
    expect(text(reported)).toContain('Redeschis după un raport');
  });

  it('says the file follows a rejected one, with its note', async () => {
    const host = await open(
      fileOf({
        previousRejection: {
          decidedAt: NOW.toISOString(),
          reasonCode: 'documents_unreadable',
          reasonNote: 'Certificatul nu se citește.',
        },
      }),
    );

    expect(text(section(host, 'rejected'))).toMatch(/^Respins anterior: /);
    expect(text(section(host, 'rejected'))).toContain(
      'Certificatul nu se citește.',
    );
  });

  it.each([
    ['ro', 'documents', 'Respins anterior: Documente'],
    ['ro', 'rar', 'Respins anterior: Autorizație RAR'],
    ['en', 'photos', 'Rejected before: Photos'],
    ['en', 'address', 'Rejected before: Address'],
    ['ro', 'documents_unreadable', 'Respins anterior: Alt motiv'],
    ['en', 'other', 'Rejected before: Other reason'],
  ] as const)(
    'names the earlier reason by its label, never its code (%s, %s)',
    async (language, reasonCode, line) => {
      const host = await open(
        fileOf({
          previousRejection: {
            decidedAt: NOW.toISOString(),
            reasonCode,
            reasonNote: null,
          },
        }),
        language,
      );

      expect(text(section(host, 'rejected'))).toContain(line);
      expect(text(section(host, 'rejected'))).not.toContain(reasonCode);
    },
  );

  it('lists the four register checks with their lamp, detail and recorder, "neverificat" when not run', async () => {
    const host = await open(
      fileOf({
        activities: [
          { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
          { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
        ],
        checks: KINDS.map((kind) =>
          kind === 'company'
            ? check(kind, {
                detail: 'Firmă activă',
                recordedAt: NOW.toISOString(),
                recorder: ioana,
                result: 'ok',
              })
            : kind === 'activities'
              ? check(kind, { recorder: ioana, result: 'ok' })
              : check(kind),
        ),
      }),
    );
    const register = section(host, 'register');

    expect(text(register?.querySelector('h4'))).toBe('VERIFICĂRI ÎN REGISTRE');
    expect(
      [...(register?.querySelectorAll('[data-kind]') ?? [])].map((r) =>
        r.getAttribute('data-kind'),
      ),
    ).toEqual(['company', 'caen', 'rar', 'activities']);
    const company = row(host, 'register', 'company');
    expect(text(company)).toContain('Firmă activă la ANAF și ONRC');
    expect(company?.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );
    expect(text(company)).toContain('Firmă activă');
    expect(text(company)).toContain('Ioana');
    expect(text(row(host, 'register', 'caen'))).toContain('neverificat');
    expect(
      row(host, 'register', 'caen')
        ?.querySelector('mf-lamp')
        ?.getAttribute('data-state'),
    ).toBe('grey');
    expect(text(row(host, 'register', 'activities'))).toContain(
      'Mecanică, Frâne',
    );
  });

  it('names the activities in English when the admin reads English', async () => {
    const host = await open(
      fileOf({
        activities: [
          { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
        ],
        checks: KINDS.map((kind) =>
          kind === 'activities' ? check(kind, { result: 'ok' }) : check(kind),
        ),
      }),
      'en',
    );

    expect(text(row(host, 'register', 'activities'))).toContain('Mechanics');
    expect(text(section(host, 'register')?.querySelector('h4'))).toBe(
      'REGISTER CHECKS',
    );
  });
});

describe('the footer', () => {
  it.each(['submitted', 'in_review'] as const)(
    'shows the three decisions, the request for more and the rejection open while the checks wait, with the note, on a %s file',
    async (status) => {
      const host = await open(fileOf({ file: { status } }));
      const footer = section(host, 'footer');

      expect(buttons(footer)).toEqual([
        'Aprobă și publică',
        'Cere completări',
        'Respinge',
      ]);
      // @traces 305-FR-001
      // @traces 304-FR-001
      expect(
        [...(footer?.querySelectorAll('button') ?? [])].map((b) => b.disabled),
      ).toEqual([true, false, false]);
      expect(text(footer)).toContain('Service‑ul primește decizia pe e‑mail.');
    },
  );

  it.each([
    ['approved', 'Aprobat de Ioana'],
    ['rejected', 'Respins de Ioana'],
    ['more_requested', 'Completări cerute de Ioana'],
  ] as const)(
    'reads a %s file as one line, with no buttons and every tick disabled',
    async (status, line) => {
      const host = await open(
        fileOf({
          file: {
            decidedAt: NOW.toISOString(),
            decidedBy: ioana,
            reasonNote: 'Lipsește pagina 2.',
            status,
          },
        }),
      );
      const footer = section(host, 'footer');

      expect(buttons(footer)).toEqual([]);
      expect(text(footer)).toContain(line);
      expect(text(footer)).toContain('Lipsește pagina 2.');
      const manual = section(host, 'manual');
      expect(
        [...(manual?.querySelectorAll('input, button') ?? [])].every(
          (c) => (c as HTMLInputElement).disabled,
        ),
      ).toBe(true);
    },
  );
});

describe('the documents', () => {
  it('reads each document with its age or its pages and a button per page', async () => {
    const host = await open(
      fileOf({
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
            pages: 3,
            present: true,
            stale: null,
          },
        ],
      }),
    );

    const onrc = row(host, 'documents', 'onrc_certificate');
    expect(text(onrc)).toContain(
      'Certificat constatator ONRC · emis acum 6 zile',
    );
    // Its age or its pages, never both.
    expect(text(onrc)).not.toContain('pagini');
    expect(buttons(onrc)).toEqual(['Deschide pagina 1', 'Deschide pagina 2']);
    const rar = row(host, 'documents', 'rar_authorisation');
    expect(text(rar)).toContain('Autorizația tehnică RAR · 3 pagini');
  });

  it.each([
    [0, 'emis azi'],
    [1, 'emis ieri'],
  ])('reads an issue %i days ago as "%s"', async (days, wording) => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: daysAgo(days),
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: false,
          },
        ],
      }),
    );

    const onrc = row(host, 'documents', 'onrc_certificate');
    expect(text(onrc)).toContain(wording);
    expect(text(onrc)).not.toContain('acum 1 zi');
    expect(buttons(onrc)).toEqual(['Deschide']);
  });

  it('reads one page in the singular', async () => {
    const host = await open();

    expect(text(row(host, 'documents', 'rar_authorisation'))).toContain(
      '· 1 pagină',
    );
  });

  it('marks a missing document, with no button', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: daysAgo(6),
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: false,
          },
          {
            id: null,
            issuedOn: null,
            kind: 'rar_authorisation',
            pages: 0,
            present: false,
            stale: null,
          },
        ],
      }),
    );

    const rar = row(host, 'documents', 'rar_authorisation');
    expect(text(rar)).toBe('Autorizația tehnică RAR · lipsește');
    expect(rar?.getAttribute('data-missing')).toBe('');
    expect(buttons(rar)).toEqual([]);
  });

  it.each([
    [daysAgo(40), 'Mai vechi de 30 de zile la data trimiterii'],
    [null, 'Data emiterii lipsește'],
  ])('warns about a stale certificate issued %s', async (issuedOn, warning) => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn,
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: true,
          },
        ],
      }),
    );

    const onrc = row(host, 'documents', 'onrc_certificate');
    expect(text(onrc?.querySelector('.stale'))).toBe(warning);
    expect(buttons(onrc)).toEqual(['Deschide']);
  });

  it('reads "indisponibil" in place of the buttons when the store is down', async () => {
    const host = await open(fileOf({ storageReady: false }));

    const onrc = row(host, 'documents', 'onrc_certificate');
    expect(buttons(onrc)).toEqual([]);
    expect(text(onrc)).toContain('indisponibil');
    expect(box(host, 'address').disabled).toBe(false);
  });

  it('opens a page in a new tab from its signed address', async () => {
    const host = await open();

    press(row(host, 'documents', 'onrc_certificate'), 'Deschide pagina 2');
    await settle();

    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(documents.legalDocumentsControllerPageAddress).toHaveBeenCalledWith({
      documentId: 'doc-onrc',
      id: FILE,
      n: '2',
    });
    expect(tab.location.href).toBe('https://store.test/signed');
    expect(tab.opener).toBeNull();
  });

  it('says on that row only that the document could not be opened, and retries', async () => {
    const host = await open();
    documents.legalDocumentsControllerPageAddress.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 503 }),
    );

    press(row(host, 'documents', 'onrc_certificate'), 'Deschide pagina 1');
    await settle();

    const onrc = row(host, 'documents', 'onrc_certificate');
    expect(text(onrc)).toContain('Nu am putut deschide documentul');
    expect(tab.close).toHaveBeenCalled();
    expect(text(row(host, 'documents', 'rar_authorisation'))).not.toContain(
      'Nu am putut',
    );
    press(onrc, 'Reîncearcă');
    await settle();

    expect(documents.legalDocumentsControllerPageAddress).toHaveBeenCalledTimes(
      2,
    );
    expect(text(row(host, 'documents', 'onrc_certificate'))).not.toContain(
      'Nu am putut',
    );
  });
});

describe('the manual checks', () => {
  it('lists the four checks in order, with a problem button each', async () => {
    const host = await open();
    const manual = section(host, 'manual');

    expect(text(manual?.querySelector('h4'))).toBe('VERIFICĂRI MANUALE');
    expect(
      [...(manual?.querySelectorAll('[data-kind]') ?? [])].map((r) => text(r)),
    ).toEqual([
      expect.stringContaining('Adresa din documente e cea de pe profil'),
      expect.stringContaining('Fotografiile sunt ale atelierului'),
      expect.stringContaining('Telefon confirmat prin apel'),
      expect.stringContaining('Documentele sunt complete și lizibile'),
    ]);
    expect(buttons(manual)).toEqual(Array(4).fill('Marchează o problemă'));
    const label = box(host, 'address').closest('label');
    expect(label).not.toBeNull();
  });

  it("reads a mobile mechanic's first two checks in its own words", async () => {
    const host = await open(
      fileOf({ garage: { businessKind: 'mobile', seatAddress: 'Brașov' } }),
    );

    expect(text(row(host, 'manual', 'address'))).toContain(
      'Adresa din documente e sediul social de pe profil',
    );
    expect(text(row(host, 'manual', 'photos'))).toContain(
      'Fotografiile arată duba sau trusa mobilă și sculele principale',
    );
  });

  it('disables the documents tick while a document is missing, the problem button still offered', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: daysAgo(6),
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: false,
          },
          {
            id: null,
            issuedOn: null,
            kind: 'rar_authorisation',
            pages: 0,
            present: false,
            stale: null,
          },
        ],
      }),
    );

    expect(box(host, 'documents').disabled).toBe(true);
    expect(text(row(host, 'manual', 'documents'))).toContain(
      'Lipsește un document',
    );
    const problem = row(host, 'manual', 'documents')?.querySelector('button');
    expect(problem?.disabled).toBe(false);
  });

  it('checks a tick only when its result is ok, and shows a problem with its lamp and detail', async () => {
    const host = await open(
      fileOf({
        checks: KINDS.map((kind) =>
          kind === 'address'
            ? check(kind, { result: 'ok' })
            : kind === 'photos'
              ? check(kind, { detail: 'Poze de pe internet', result: 'failed' })
              : check(kind),
        ),
      }),
    );

    expect(box(host, 'address').checked).toBe(true);
    expect(box(host, 'photos').checked).toBe(false);
    const photos = row(host, 'manual', 'photos');
    expect(photos?.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'red',
    );
    expect(text(photos)).toContain('Poze de pe internet');
    expect(row(host, 'manual', 'address')?.querySelector('mf-lamp')).toBeNull();
  });

  it('records a tick as ok and an untick as not_run, with no detail', async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockImplementation(
      async ({ kind, body }) => ({
        check: check(kind, { recorder: ioana, result: body.result }),
        rarActivities: [],
        summary: { en: '', ro: '' },
      }),
    );

    tick(host, 'address', true);
    await settle();
    expect(api.verificationChecksControllerRecord).toHaveBeenLastCalledWith({
      body: { result: 'ok' },
      id: FILE,
      kind: 'address',
    });
    expect(box(host, 'address').checked).toBe(true);

    tick(host, 'address', false);
    await settle();
    expect(api.verificationChecksControllerRecord).toHaveBeenLastCalledWith({
      body: { result: 'not_run' },
      id: FILE,
      kind: 'address',
    });
    expect(box(host, 'address').checked).toBe(false);
  });

  it("shows the server's answer, not the press", async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockResolvedValue({
      check: check('photos', { detail: 'Altă poză', result: 'warning' }),
      rarActivities: [],
      summary: { en: '', ro: '' },
    });

    tick(host, 'photos', true);
    await settle();

    expect(box(host, 'photos').checked).toBe(false);
    expect(text(row(host, 'manual', 'photos'))).toContain('Altă poză');
  });

  it('disables a check while its own save is on its way', async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockReturnValue(
      new Promise(() => undefined),
    );

    tick(host, 'address', true);
    await settle();

    expect(box(host, 'address').disabled).toBe(true);
    expect(box(host, 'photos').disabled).toBe(false);
  });

  it('reverts a failed save and says so in a toast', async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockRejectedValue(
      new HttpErrorResponse({ status: 0 }),
    );

    tick(host, 'address', true);
    await settle();

    expect(box(host, 'address').checked).toBe(false);
    expect(box(host, 'address').disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith('Nu am putut salva verificarea');
  });

  it('re-reads and turns read-only when another admin just decided', async () => {
    let decided = false;
    const host = await open(async () =>
      decided
        ? fileOf({
            file: {
              decidedAt: NOW.toISOString(),
              decidedBy: ioana,
              status: 'approved',
            },
          })
        : fileOf(),
    );
    api.verificationChecksControllerRecord.mockImplementation(async () => {
      decided = true;
      throw new HttpErrorResponse({
        error: { code: 'verification_file_decided', status: 409 },
        status: 409,
      });
    });

    tick(host, 'address', true);
    await settle();

    expect(api.verificationFileControllerRead).toHaveBeenCalled();
    expect(box(host, 'address').checked).toBe(false);
    expect(box(host, 'address').disabled).toBe(true);
    expect(text(section(host, 'footer'))).toContain('Aprobat de Ioana');
  });

  it('attempts no save on a decided file', async () => {
    const host = await open(
      fileOf({
        file: {
          decidedAt: NOW.toISOString(),
          decidedBy: ioana,
          status: 'rejected',
        },
      }),
    );

    tick(host, 'address', true);
    press(row(host, 'manual', 'address'), 'Marchează o problemă');
    await settle();

    expect(api.verificationChecksControllerRecord).not.toHaveBeenCalled();
    expect(overlays.open).not.toHaveBeenCalled();
  });

  it('marks a problem through the small task and shows what it saved', async () => {
    const host = await open();
    overlays.open.mockResolvedValue({
      check: check('representative', {
        detail: 'Nu răspunde la telefon',
        result: 'warning',
      }),
      rarActivities: [],
      summary: { en: '', ro: '' },
    });

    press(row(host, 'manual', 'representative'), 'Marchează o problemă');
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: { fileId: FILE, kind: 'representative' },
        shape: 'dialog',
      }),
    );
    const representative = row(host, 'manual', 'representative');
    expect(text(representative)).toContain('Nu răspunde la telefon');
    expect(
      representative?.querySelector('mf-lamp')?.getAttribute('data-state'),
    ).toBe('amber');
    expect(box(host, 'representative').checked).toBe(false);
  });
});

describe('the live re-read', () => {
  const later = () => new Promise((resolve) => setTimeout(resolve, 350));

  it.each([
    'verification.opened',
    'verification.check_recorded',
    'verification.decided',
    'verification.reopened',
    'garage_report.decided',
  ] as const)('re-reads on %s for this file', async (kind) => {
    await open();

    events.next({ at: NOW.toISOString(), id: FILE, kind });
    await later();
    await settle();

    expect(api.verificationFileControllerRead).toHaveBeenCalledTimes(1);
  });

  it("never re-reads on another file's event", async () => {
    await open();

    events.next({
      at: NOW.toISOString(),
      id: 'file-2',
      kind: 'verification.check_recorded',
    });
    await later();
    await settle();

    expect(api.verificationFileControllerRead).not.toHaveBeenCalled();
  });

  it('re-reads on a reconnect', async () => {
    await open();

    resync.next();
    await later();
    await settle();

    expect(api.verificationFileControllerRead).toHaveBeenCalledTimes(1);
  });
});

describe('the history', () => {
  const lines = (host: HTMLElement) =>
    [...(section(host, 'history')?.querySelectorAll('li') ?? [])].map((li) =>
      text(li),
    );

  const history = (entries: AuditEntryDto[], total = entries.length) =>
    fileOf({
      checks: KINDS.map((kind) => check(kind)),
      timeline: { entries, total },
    });

  const ENTRIES = [
    entry({
      action: 'open',
      kind: 'onrc_certificate',
      newValue: { page: 2 },
      subjectId: 'doc-onrc',
      subjectType: 'legal_document',
    }),
    entry({
      field: 'address',
      kind: 'verification_check_recorded',
      newValue: { detail: null, result: 'ok' },
      subjectId: 'check-address',
      subjectType: 'verification_check',
    }),
    entry({
      field: 'status',
      kind: 'verification_opened',
      newValue: 'in_review',
      oldValue: 'submitted',
    }),
    entry({
      action: 'create',
      actor: { id: 'owner-1', name: 'Andrei', role: 'owner' },
      newValue: 'submitted',
    }),
  ];

  it('reads one line per entry, newest first, in Romanian', async () => {
    const host = await open(history(ENTRIES));

    expect(text(section(host, 'history')?.querySelector('h4'))).toBe('ISTORIC');
    expect(lines(host)).toEqual([
      expect.stringMatching(
        /^Certificat constatator ONRC, pagina 2 deschisă de Ioana, azi, \d\d:\d\d$/,
      ),
      expect.stringMatching(/^Adresă: în regulă — Ioana, azi, \d\d:\d\d$/),
      expect.stringMatching(/^Deschis de Ioana, azi, \d\d:\d\d$/),
      expect.stringMatching(/^Trimis de Andrei Dobre, azi, \d\d:\d\d$/),
    ]);
  });

  it('reads the same lines in English', async () => {
    const host = await open(history(ENTRIES), 'en');

    expect(lines(host)).toEqual([
      expect.stringMatching(
        /^ONRC company certificate, page 2 opened by Ioana, today, \d\d:\d\d$/,
      ),
      expect.stringMatching(/^Address: passed — Ioana, today, \d\d:\d\d$/),
      expect.stringMatching(/^Opened by Ioana, today, \d\d:\d\d$/),
      expect.stringMatching(/^Sent by Andrei Dobre, today, \d\d:\d\d$/),
    ]);
  });

  it('reads decisions, a reopening and a resending, MotorFix for the system', async () => {
    const host = await open(
      history([
        entry({
          actor: { id: null, name: 'MotorFix', role: 'system' },
          field: 'status',
          kind: 'verification_reopened',
          newValue: 'in_review',
          oldValue: 'approved',
          text: 'Un raport nou',
        }),
        entry({
          field: 'status',
          kind: 'verification_decided',
          newValue: 'approved',
        }),
        entry({
          field: 'status',
          kind: 'verification_decided',
          newValue: 'rejected',
        }),
        entry({
          field: 'status',
          kind: 'verification_decided',
          newValue: 'more_requested',
        }),
        entry({
          actor: { id: 'owner-1', name: 'Andrei', role: 'owner' },
          field: 'status',
          kind: 'verification_resent',
          newValue: 'submitted',
        }),
      ]),
    );

    expect(lines(host)).toEqual([
      expect.stringMatching(
        /^Redeschis de MotorFix, azi, .* \(Un raport nou\)$/,
      ),
      expect.stringMatching(/^Aprobat de Ioana, azi/),
      expect.stringMatching(/^Respins de Ioana, azi/),
      expect.stringMatching(/^Completări cerute de Ioana, azi/),
      expect.stringMatching(/^Retrimis de Andrei, azi/),
    ]);
  });

  // @traces 259-FR-006
  const refused = (code: string) =>
    entry({
      field: 'decision',
      kind: 'verification_approval_refused',
      newValue: code,
      oldValue: null,
    });
  const REFUSED = [
    'rar_check_required',
    'caen_check_required',
    'note_required',
    'cake_required',
  ].map(refused);

  it('reads each refused approval as one line naming why, in Romanian', async () => {
    const host = await open(history(REFUSED));

    expect(lines(host)).toEqual([
      expect.stringMatching(
        /^Aprobare refuzată: verificarea RAR nu e în regulă — Ioana, azi, \d\d:\d\d$/,
      ),
      expect.stringMatching(
        /^Aprobare refuzată: verificarea CAEN 4520 nu e în regulă — Ioana, azi, \d\d:\d\d$/,
      ),
      expect.stringMatching(
        /^Aprobare refuzată: lipsește nota — Ioana, azi, \d\d:\d\d$/,
      ),
      expect.stringMatching(
        /^Aprobare refuzată: cake_required — Ioana, azi, \d\d:\d\d$/,
      ),
    ]);
  });

  it('reads the refused approvals in English', async () => {
    const host = await open(history(REFUSED), 'en');

    expect(lines(host)).toEqual([
      expect.stringMatching(
        /^Approval refused: the RAR check is not ok — Ioana, today, \d\d:\d\d$/,
      ),
      expect.stringMatching(
        /^Approval refused: the CAEN 4520 check is not ok — Ioana, today, \d\d:\d\d$/,
      ),
      expect.stringMatching(
        /^Approval refused: the note is missing — Ioana, today, \d\d:\d\d$/,
      ),
      expect.stringMatching(
        /^Approval refused: cake_required — Ioana, today, \d\d:\d\d$/,
      ),
    ]);
  });

  it('gives a status change it has no words for its one plain line', async () => {
    const odd = entry({ field: 'status', newValue: 'archived' });
    const ro = await open(history([odd]));
    expect(lines(ro)).toEqual([
      expect.stringMatching(/^Modificat de Ioana, azi, \d\d:\d\d$/),
    ]);
    TestBed.resetTestingModule();

    const en = await open(history([odd]), 'en');
    expect(lines(en)).toEqual([
      expect.stringMatching(/^Changed by Ioana, today, \d\d:\d\d$/),
    ]);
  });

  it('says how many more there are past 50, with no button', async () => {
    const many = Array.from({ length: 50 }, () =>
      entry({
        field: 'status',
        kind: 'verification_opened',
        newValue: 'in_review',
      }),
    );

    const ro = await open(history(many, 57));
    expect(lines(ro)).toHaveLength(50);
    expect(text(section(ro, 'history'))).toContain('și încă 7');
    expect(buttons(section(ro, 'history'))).toEqual([]);
    document.body.innerHTML = '';
    TestBed.resetTestingModule();

    const en = await open(history(many, 57), 'en');
    expect(text(section(en, 'history'))).toContain('and 7 more');
  });

  it('follows a change of language', async () => {
    const host = await open(history(ENTRIES));

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(lines(host)[2]).toMatch(/^Opened by Ioana, today/);
  });
});

describe('the company and CAEN rows', () => {
  const ANAF = 'https://mfinante.gov.ro/ro/web/site/info-pj-selectie-dupa-cui';
  const ONRC = 'https://portal.onrc.ro/';
  const links = (host: HTMLElement, kind: string) =>
    [
      ...(row(host, 'register', kind)?.querySelectorAll<HTMLAnchorElement>(
        'a',
      ) ?? []),
    ].map((a) => ({
      href: a.getAttribute('href'),
      rel: a.getAttribute('rel'),
      target: a.getAttribute('target'),
      text: text(a),
    }));
  const link = (host: HTMLElement, kind: string, name: string) =>
    [
      ...(row(host, 'register', kind)?.querySelectorAll<HTMLAnchorElement>(
        'a',
      ) ?? []),
    ].find((a) => text(a) === name) as HTMLAnchorElement;
  // A click on a link, its new tab left to the browser.
  const follow = async (anchor: HTMLAnchorElement) => {
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener('click', stay);
    anchor.click();
    document.removeEventListener('click', stay);
    await settle();
  };
  const clipboard = (writeText?: jest.Mock) =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  const form = (host: HTMLElement, kind: string) =>
    row(host, 'register', kind)?.querySelector(
      'mf-verification-register-form',
    ) ?? null;
  const recordedCompany = {
    check: {
      automatic: false,
      detail: 'CUI valid · Auto Vest Motors SRL',
      evidence: { lookedUpOn: daysAgo(0), name: 'Auto Vest Motors SRL' },
      fileId: FILE,
      id: 'check-company',
      kind: 'company',
      recordedAt: NOW.toISOString(),
      recordedBy: 'admin-1',
      result: 'ok',
    },
    rarActivities: [],
    summary: { en: 'Company ID checked', ro: 'CUI verificat' },
  };

  it('labels the two rows by what is checked, in both languages', async () => {
    const host = await open();
    expect(text(row(host, 'register', 'company'))).toContain(
      'Firmă activă la ANAF și ONRC',
    );
    expect(text(row(host, 'register', 'caen'))).toContain('Cod CAEN 4520');
    expect(text(row(host, 'register', 'company'))).toContain('neverificat');

    document.body.innerHTML = '';
    TestBed.resetTestingModule();
    const english = await open(fileOf(), 'en');
    expect(text(row(english, 'register', 'company'))).toContain(
      'Active company at ANAF and ONRC',
    );
    expect(text(row(english, 'register', 'caen'))).toContain('CAEN code 4520');
  });

  it('links the public look-ups in a new tab, with no CUI in the address', async () => {
    const host = await open();

    const tabbed = { rel: 'noopener noreferrer', target: '_blank' };
    expect(links(host, 'company')).toEqual([
      { href: ANAF, text: 'ANAF', ...tabbed },
      { href: ONRC, text: 'ONRC', ...tabbed },
    ]);
    expect(links(host, 'caen')).toEqual([
      { href: ONRC, text: 'ONRC', ...tabbed },
    ]);
    expect(links(host, 'activities')).toEqual([]);
  });

  it('copies the CUI when a look-up opens, and says so', async () => {
    const writeText = jest.fn(async () => undefined);
    clipboard(writeText);
    const host = await open();

    await follow(link(host, 'company', 'ANAF'));

    expect(writeText).toHaveBeenCalledWith('12345678');
    expect(toast).toHaveBeenCalledWith('CUI copiat');
  });

  it('still opens the look-up when the clipboard is unavailable, quietly', async () => {
    clipboard();
    const host = await open();

    await expect(follow(link(host, 'caen', 'ONRC'))).resolves.toBeUndefined();

    expect(toast).not.toHaveBeenCalled();
  });

  it('opens the form under the row while the file is undecided, and returns focus when it closes', async () => {
    const host = await open();
    const company = row(host, 'register', 'company');

    press(company, 'Înregistrează');
    await settle();
    expect(form(host, 'company')).not.toBeNull();

    press(company, 'Înregistrează');
    await settle();
    expect(form(host, 'company')).toBeNull();
    expect(text(document.activeElement)).toBe('Înregistrează');
  });

  it('offers no form on a decided file', async () => {
    const host = await open(
      fileOf({
        file: {
          decidedAt: NOW.toISOString(),
          decidedBy: ioana,
          status: 'approved',
        },
      }),
    );

    expect(buttons(row(host, 'register', 'company'))).not.toContain(
      'Înregistrează',
    );
    expect(buttons(row(host, 'register', 'caen'))).not.toContain(
      'Înregistrează',
    );
  });

  it("shows the server's answer once the form saves, and closes it", async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockResolvedValue(recordedCompany);
    const company = () => row(host, 'register', 'company');

    press(company(), 'Înregistrează');
    await settle();
    press(company(), 'OK');
    await settle();
    const name = company()?.querySelector<HTMLInputElement>(
      'input[type="text"]',
    ) as HTMLInputElement;
    name.value = 'Auto Vest Motors SRL';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    press(company(), 'Salvează');
    await settle();

    expect(form(host, 'company')).toBeNull();
    expect(text(company())).toContain('CUI valid · Auto Vest Motors SRL');
    expect(
      company()?.querySelector('mf-lamp')?.getAttribute('data-state'),
    ).toBe('green');
    expect(buttons(company())).toContain('Modifică');
  });

  it('re-reads the file when the form finds it decided', async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockRejectedValue(
      new HttpErrorResponse({
        error: { code: 'verification_file_decided', status: 409 },
        status: 409,
      }),
    );
    const company = () => row(host, 'register', 'company');
    api.verificationFileControllerRead.mockClear();

    press(company(), 'Înregistrează');
    await settle();
    press(company(), 'Problemă');
    await settle();
    const detail = company()?.querySelector<HTMLTextAreaElement>(
      'textarea',
    ) as HTMLTextAreaElement;
    detail.value = 'Firma e radiată';
    detail.dispatchEvent(new Event('input', { bubbles: true }));
    press(company(), 'Salvează');
    await settle();

    expect(api.verificationFileControllerRead).toHaveBeenCalled();
  });

  it('leaves the certificate tick out when the file holds no ONRC certificate', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: null,
            issuedOn: null,
            kind: 'onrc_certificate',
            pages: 0,
            present: false,
            stale: null,
          },
        ] as VerificationFileDto['documents'],
      }),
    );

    press(row(host, 'register', 'caen'), 'Înregistrează');
    await settle();

    expect(text(form(host, 'caen'))).not.toContain('4520 pe certificat');
    expect(text(form(host, 'caen'))).toContain('4520 în ONRC');
  });

  it('reads the stored CAEN ticks as text, the certificate from the evidence', async () => {
    const caen = (evidence: Record<string, unknown>) =>
      fileOf({
        checks: KINDS.map((kind) =>
          kind === 'caen'
            ? check(kind, {
                detail:
                  'Întreținerea și repararea autovehiculelor, la punctul de lucru',
                evidence,
                recorder: ioana,
                result: 'ok',
              } as Partial<VerificationFileCheckDto>)
            : check(kind),
        ),
      });

    const host = await open(
      caen({
        address: true,
        certificate: true,
        certificateUploaded: true,
        onrc: true,
      }),
    );
    expect(text(row(host, 'register', 'caen'))).toContain(
      'certificat · ONRC · adresă',
    );

    document.body.innerHTML = '';
    TestBed.resetTestingModule();
    const without = await open(
      caen({ address: true, certificateUploaded: false, onrc: true }),
    );
    expect(text(row(without, 'register', 'caen'))).toContain(
      'fără certificat · ONRC · adresă',
    );

    document.body.innerHTML = '';
    TestBed.resetTestingModule();
    const english = await open(
      caen({ address: true, certificateUploaded: false, onrc: true }),
      'en',
    );
    expect(text(row(english, 'register', 'caen'))).toContain(
      'no certificate · ONRC · address',
    );
  });

  // @traces 203-FR-008
  it.each([['warning'], ['failed']] as const)(
    'clears the CAEN ticks from a %s row',
    async (result) => {
      const host = await open(
        fileOf({
          checks: KINDS.map((kind) =>
            kind === 'caen'
              ? check(kind, {
                  detail: 'Codul lipsește din ONRC',
                  evidence: {
                    address: true,
                    certificateUploaded: false,
                    onrc: true,
                  },
                  recorder: ioana,
                  result,
                } as Partial<VerificationFileCheckDto>)
              : check(kind),
          ),
        }),
      );

      const caen = row(host, 'register', 'caen');
      expect(caen?.querySelector('[data-part="ticks"]')).toBeNull();
      expect(text(caen)).not.toContain('fără certificat');
      expect(text(caen)).toContain('Codul lipsește din ONRC');
    },
  );
});

// The surface the decision buttons call.
interface Deciding {
  decide(body: {
    decision: 'approved' | 'more_requested' | 'rejected';
    note?: string;
    reason?: string;
    requestedItems?: string[];
  }): Promise<void>;
  reopen(): Promise<void>;
}
const deciding = () => drawer as unknown as Deciding;

const dan = { id: 'admin-2', name: 'Dan' };
const DECIDED_AT = new Date(NOW.getTime() - 3_600_000).toISOString();
const rejected = (by = ioana) =>
  fileOf({
    file: {
      decidedAt: DECIDED_AT,
      decidedBy: by,
      reasonCode: 'documents',
      reasonNote: 'Lipsește certificatul ONRC.',
      status: 'rejected',
    },
  });
const refusedBy = (code: string, extra: object = {}) =>
  new HttpErrorResponse({
    error: { code, status: 409, ...extra },
    status: 409,
  });
const alertIn = (host: HTMLElement) =>
  section(host, 'footer')?.querySelector('[role="alert"]') ?? null;
const reopenButton = (host: HTMLElement) =>
  [...(section(host, 'header')?.querySelectorAll('button') ?? [])].find((b) =>
    ['Redeschide dosarul', 'Reopen the file'].includes(text(b)),
  ) ?? null;
const REJECT = {
  decision: 'rejected' as const,
  note: 'Lipsește certificatul ONRC.',
  reason: 'documents',
};

// @traces 306-FR-007 306-FR-008
describe('deciding', () => {
  it("sends the decision and shows the server's answer", async () => {
    const host = await open();
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => rejected();
      return rejected();
    });

    await deciding().decide(REJECT);
    await settle();

    expect(api.verificationFileControllerDecision).toHaveBeenCalledWith({
      body: REJECT,
      id: FILE,
    });
    expect(text(section(host, 'footer'))).toContain('Respins de Ioana');
    expect(alertIn(host)).toBeNull();
  });

  it.each([
    ['ro', 'Deja decis de Dan la'],
    ['en', 'Already decided by Dan at'],
  ] as const)(
    'says in %s who decided first, re-reads, and keeps the line over later reads',
    async (language, line) => {
      const host = await open(fileOf(), language);
      api.verificationFileControllerDecision.mockImplementation(async () => {
        answer = async () => rejected(dan);
        throw refusedBy('verification_transition_refused', {
          currentStatus: 'rejected',
          decidedAt: DECIDED_AT,
          decidedBy: 'Dan',
        });
      });
      const reads = api.verificationFileControllerRead.mock.calls.length;

      await deciding().decide({ decision: 'approved' });
      await settle();

      const alert = alertIn(host);
      expect(text(alert)).toBe(
        `${line} ${appliedAt(DECIDED_AT, language, new Date())}`,
      );
      expect(api.verificationFileControllerRead.mock.calls.length).toBe(
        reads + 1,
      );
      expect(text(section(host, 'footer'))).toContain(
        language === 'ro' ? 'Respins de Dan' : 'Rejected by Dan',
      );

      events.next({
        at: NOW.toISOString(),
        id: FILE,
        kind: 'verification.decided',
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settle();

      expect(text(alertIn(host))).toContain(line);
    },
  );

  it('names MotorFix when the system decided first', async () => {
    const host = await open();
    api.verificationFileControllerDecision.mockRejectedValue(
      refusedBy('verification_transition_refused', {
        currentStatus: 'approved',
        decidedAt: DECIDED_AT,
        decidedBy: 'MotorFix',
      }),
    );

    await deciding().decide({ decision: 'approved' });
    await settle();

    expect(text(alertIn(host))).toContain('Deja decis de MotorFix la');
  });

  it('clears the line at the next decision', async () => {
    const host = await open();
    api.verificationFileControllerDecision.mockRejectedValueOnce(
      refusedBy('rar_check_required'),
    );
    await deciding().decide({ decision: 'approved' });
    await settle();
    expect(alertIn(host)).not.toBeNull();
    let settleCall: (value: VerificationFileDto) => void = () => undefined;
    api.verificationFileControllerDecision.mockReturnValueOnce(
      new Promise((resolve) => {
        settleCall = resolve;
      }),
    );

    const second = deciding().decide(REJECT);
    await settle();

    expect(alertIn(host)).toBeNull();
    settleCall(rejected());
    await second;
  });

  it.each([
    ['rar_check_required', 'ro', 'Aprobarea cere verificarea RAR'],
    ['caen_check_required', 'ro', 'Aprobarea cere verificarea CAEN'],
    ['rar_check_required', 'en', 'Approval needs the RAR check'],
    ['caen_check_required', 'en', 'Approval needs the CAEN check'],
  ] as const)(
    'reads %s in %s in the same slot, with no re-read',
    async (code, language, line) => {
      const host = await open(fileOf(), language);
      api.verificationFileControllerDecision.mockRejectedValue(refusedBy(code));
      const reads = api.verificationFileControllerRead.mock.calls.length;

      await deciding().decide({ decision: 'approved' });
      await settle();

      expect(text(alertIn(host))).toBe(line);
      const decisions = section(host, 'footer')?.querySelector('.decisions');
      expect(
        alertIn(host)?.compareDocumentPosition(decisions as Node) ?? 0,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(api.verificationFileControllerRead.mock.calls.length).toBe(reads);
      expect(buttons(section(host, 'footer'))).toContain(
        language === 'ro' ? 'Aprobă și publică' : 'Approve and publish',
      );
    },
  );

  it.each([
    ['ro', 'Aprobarea cere verificarea RAR', 'Verificarea RAR e obligatorie'],
    ['en', 'Approval needs the RAR check', 'The RAR check is required'],
  ] as const)(
    'keeps the RAR note apart from the RAR refusal in %s',
    async (language, refusal, note) => {
      const host = await open(fileOf(), language);
      api.verificationFileControllerDecision.mockRejectedValue(
        refusedBy('rar_check_required'),
      );

      await deciding().decide({ decision: 'approved' });
      await settle();

      const footer = section(host, 'footer');
      expect(text(alertIn(host))).toBe(refusal);
      expect(text(footer?.querySelector('[data-part="gate-hint"]'))).toBe(note);
      expect(text(footer).split(refusal)).toHaveLength(2);
    },
  );

  it('says in a toast that the decision could not be saved on any other failure', async () => {
    const host = await open();
    api.verificationFileControllerDecision.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    await deciding().decide(REJECT);
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(alertIn(host)).toBeNull();
    expect(text(section(host, 'footer'))).not.toContain('Respins de');
  });

  it('sends one request for two presses while the first is on its way', async () => {
    await open();
    let settleCall: (value: VerificationFileDto) => void = () => undefined;
    api.verificationFileControllerDecision.mockReturnValue(
      new Promise((resolve) => {
        settleCall = resolve;
      }),
    );

    const first = deciding().decide(REJECT);
    const second = deciding().decide({ decision: 'approved' });
    const third = deciding().reopen();
    await settle();

    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    expect(overlays.open).not.toHaveBeenCalled();
    settleCall(rejected());
    await Promise.all([first, second, third]);
  });

  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'keeps the e-mail note under the decided line of a %s file',
    async (status) => {
      const host = await open(
        fileOf({
          file: { decidedAt: DECIDED_AT, decidedBy: ioana, status },
        }),
      );
      const footer = section(host, 'footer');

      expect(text(footer)).toContain('Service‑ul primește decizia pe e‑mail.');
      const parts = [...(footer?.querySelectorAll('p') ?? [])].map(text);
      expect(parts.findIndex((p) => p.includes('de Ioana'))).toBeLessThan(
        parts.findIndex((p) => p.includes('Service‑ul primește')),
      );
    },
  );

  it('shows no decided line on a reopened file under review, only the decisions', async () => {
    const host = await open(
      fileOf({
        file: {
          decidedAt: DECIDED_AT,
          decidedBy: ioana,
          reasonCode: 'documents',
          reasonNote: 'Lipsește certificatul ONRC.',
          reopenedAt: NOW.toISOString(),
          reopenedBy: dan,
          status: 'in_review',
        },
      }),
    );
    const footer = section(host, 'footer');

    expect(text(footer)).not.toContain('Respins de');
    expect(buttons(footer)).toEqual([
      'Aprobă și publică',
      'Cere completări',
      'Respinge',
    ]);
    expect(text(footer)).toContain('Service‑ul primește decizia pe e‑mail.');
  });
});

// @traces 306-FR-009 306-FR-010
describe('reopening', () => {
  it.each(['approved', 'rejected', 'more_requested'] as const)(
    'offers "Redeschide dosarul" in the header of a %s file, reachable by keyboard',
    async (status) => {
      const host = await open(
        fileOf({ file: { decidedAt: DECIDED_AT, decidedBy: ioana, status } }),
      );

      const button = reopenButton(host);
      expect(button).not.toBeNull();
      expect(button?.getAttribute('type')).toBe('button');
      expect(button?.disabled).toBe(false);
      expect(button?.tabIndex).toBe(0);
    },
  );

  it('reads "Reopen the file" in English', async () => {
    const host = await open(rejected(), 'en');

    expect(text(reopenButton(host))).toBe('Reopen the file');
  });

  it.each(['submitted', 'in_review'] as const)(
    'offers no reopening on a %s file',
    async (status) => {
      const host = await open(fileOf({ file: { status } }));

      expect(reopenButton(host)).toBeNull();
    },
  );

  it('asks first, then reopens and shows the file under review with the decisions back', async () => {
    const host = await open(rejected());
    overlays.open.mockResolvedValue(true);
    api.verificationFileControllerReopen.mockImplementation(async () => {
      const reopened = fileOf({
        file: {
          decidedAt: DECIDED_AT,
          decidedBy: ioana,
          reopenedAt: NOW.toISOString(),
          reopenedBy: ioana,
          status: 'in_review',
        },
      });
      answer = async () => reopened;
      return reopened;
    });

    reopenButton(host)?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shape: 'dialog',
        title: 'admin.file.reopen.title',
      }),
    );
    expect(api.verificationFileControllerReopen).toHaveBeenCalledWith({
      id: FILE,
    });
    expect(buttons(section(host, 'footer'))).toEqual([
      'Aprobă și publică',
      'Cere completări',
      'Respinge',
    ]);
    expect(reopenButton(host)).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('h3'));
  });

  it('changes nothing and returns to the button when the admin cancels', async () => {
    const host = await open(rejected());
    overlays.open.mockResolvedValue('cancelled');

    reopenButton(host)?.click();
    await settle();

    expect(api.verificationFileControllerReopen).not.toHaveBeenCalled();
    expect(text(section(host, 'footer'))).toContain('Respins de Ioana');
    expect(document.activeElement).toBe(reopenButton(host));
  });

  it('disables the reopen button while the reopening is on its way', async () => {
    const host = await open(rejected());
    overlays.open.mockResolvedValue(true);
    let settleCall: (value: VerificationFileDto) => void = () => undefined;
    api.verificationFileControllerReopen.mockReturnValue(
      new Promise((resolve) => {
        settleCall = resolve;
      }),
    );

    reopenButton(host)?.click();
    await settle();

    expect(reopenButton(host)?.disabled).toBe(true);
    settleCall(rejected());
    await settle();
  });

  it('says in a toast that the file could not be reopened, and changes nothing', async () => {
    const host = await open(rejected());
    overlays.open.mockResolvedValue(true);
    api.verificationFileControllerReopen.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    reopenButton(host)?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut redeschide dosarul');
    expect(text(section(host, 'footer'))).toContain('Respins de Ioana');
    expect(reopenButton(host)).not.toBeNull();
  });

  it('clears an earlier refusal line when the reopening call starts, even if it then fails', async () => {
    const host = await open();
    api.verificationFileControllerDecision.mockRejectedValueOnce(
      refusedBy('verification_transition_refused', {
        currentStatus: 'rejected',
        decidedAt: DECIDED_AT,
        decidedBy: 'Ioana',
      }),
    );
    answer = async () => rejected();
    await deciding().decide({ decision: 'approved' });
    await settle();
    expect(alertIn(host)).not.toBeNull();
    overlays.open.mockResolvedValue(true);
    let failCall: (error: unknown) => void = () => undefined;
    api.verificationFileControllerReopen.mockReturnValue(
      new Promise((_, reject) => {
        failCall = reject;
      }),
    );

    reopenButton(host)?.click();
    await settle();

    expect(alertIn(host)).toBeNull();
    failCall(new HttpErrorResponse({ status: 500 }));
    await settle();
    expect(toast).toHaveBeenCalledWith('Nu am putut redeschide dosarul');
    expect(alertIn(host)).toBeNull();
  });
});

describe('the RAR and activities rows', () => {
  const RAR = 'https://portal.rarom.ro/';
  const withCheck = (
    kind: (typeof KINDS)[number],
    extra: Partial<VerificationFileCheckDto>,
    more: Parameters<typeof fileOf>[0] = {},
  ) =>
    fileOf({
      checks: KINDS.map((k) => (k === kind ? check(k, extra) : check(k))),
      ...more,
    });
  const anchor = (host: HTMLElement, name: string) =>
    [
      ...(row(host, 'register', 'rar')?.querySelectorAll<HTMLAnchorElement>(
        'a',
      ) ?? []),
    ].find((a) => text(a) === name) as HTMLAnchorElement | undefined;
  const follow = async (a: HTMLAnchorElement) => {
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener('click', stay);
    a.click();
    document.removeEventListener('click', stay);
    await settle();
  };
  const clipboard = (writeText?: jest.Mock) =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  const input = (el: Element | null | undefined) =>
    el?.querySelector<HTMLInputElement>('input[type="text"]') ?? null;
  const reset = () => {
    document.body.innerHTML = '';
    TestBed.resetTestingModule();
  };

  // @traces 1357-FR-003
  it('labels the rows by what is checked, the RAR row by its result', async () => {
    const host = await open();
    expect(text(row(host, 'register', 'rar'))).toContain(
      'Autorizație RAR găsită în registru',
    );
    expect(text(row(host, 'register', 'rar'))).toContain('neverificat');
    expect(text(row(host, 'register', 'activities'))).toContain(
      'Activitățile autorizate acoperă lista de prețuri',
    );

    reset();
    const failed = await open(
      withCheck('rar', {
        detail: 'numărul introdus nu există în registrul public RAR',
        recorder: ioana,
        result: 'failed',
      }),
    );
    expect(text(row(failed, 'register', 'rar'))).toContain(
      'Autorizația RAR nu apare în registru',
    );

    reset();
    const english = await open(fileOf(), 'en');
    expect(text(row(english, 'register', 'rar'))).toContain(
      'RAR authorisation found in the register',
    );
    expect(text(row(english, 'register', 'activities'))).toContain(
      'Authorised activities cover the price list',
    );
  });

  it('shows the number as stored, or that it is missing', async () => {
    const host = await open();
    expect(text(row(host, 'register', 'rar'))).toContain('B 1234/2019');

    reset();
    const none = await open(fileOf({ file: { rarNumber: null } }));
    expect(text(row(none, 'register', 'rar'))).toContain('număr lipsă');
  });

  it('links the public RAR register in a new tab, with no number in the address', async () => {
    const host = await open();
    const link = anchor(host, 'Registrul RAR');

    expect(link?.getAttribute('href')).toBe(RAR);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('copies the number when the register opens, and says so', async () => {
    const writeText = jest.fn(async () => undefined);
    clipboard(writeText);
    const host = await open();

    await follow(anchor(host, 'Registrul RAR') as HTMLAnchorElement);

    expect(writeText).toHaveBeenCalledWith('B 1234/2019');
    expect(toast).toHaveBeenCalledWith('Număr RAR copiat');
  });

  it('opens the register quietly when there is no number or no clipboard', async () => {
    const writeText = jest.fn(async () => undefined);
    clipboard(writeText);
    const host = await open(fileOf({ file: { rarNumber: null } }));
    await follow(anchor(host, 'Registrul RAR') as HTMLAnchorElement);
    expect(writeText).not.toHaveBeenCalled();

    reset();
    clipboard();
    const bare = await open();
    await follow(anchor(bare, 'Registrul RAR') as HTMLAnchorElement);
    expect(toast).not.toHaveBeenCalled();
  });

  it('corrects the number through the admin call and shows the answer', async () => {
    const host = await open();
    api.verificationFileControllerCorrect.mockResolvedValue(
      fileOf({ file: { rarNumber: 'CJ 221/2021' } }),
    );
    const rar = () => row(host, 'register', 'rar');

    press(rar(), 'Corectează');
    await settle();
    const field = input(rar()?.querySelector('[data-part="correct"]'));
    expect(field?.value).toBe('B 1234/2019');
    expect(document.activeElement).toBe(field);
    (field as HTMLInputElement).value = ' cj 221/2021 ';
    field?.dispatchEvent(new Event('input', { bubbles: true }));
    press(rar()?.querySelector('[data-part="correct"]') ?? null, 'Salvează');
    await settle();

    expect(api.verificationFileControllerCorrect).toHaveBeenCalledWith({
      body: { rarNumber: ' cj 221/2021 ' },
      id: FILE,
    });
    expect(rar()?.querySelector('[data-part="correct"]')).toBeNull();
    expect(text(rar())).toContain('CJ 221/2021');
  });

  // @traces 204-FR-014
  it("gives the correction's Save and Cancel the record form's buttons", async () => {
    const host = await open();
    const rar = () => row(host, 'register', 'rar');

    press(rar(), 'Corectează');
    await settle();
    const buttons = [
      ...(rar()?.querySelectorAll('[data-part="correct"] button') ?? []),
    ];

    expect(buttons.map((b) => b.hasAttribute('hlmbtn'))).toEqual([true, true]);
    expect(buttons.map((b) => b.getAttribute('variant'))).toEqual([
      null,
      'ghost',
    ]);
  });

  it('refuses a number too short before sending, and names the field', async () => {
    const host = await open();
    const rar = () => row(host, 'register', 'rar');

    press(rar(), 'Corectează');
    await settle();
    const field = input(rar()?.querySelector('[data-part="correct"]'));
    (field as HTMLInputElement).value = ' b1 ';
    field?.dispatchEvent(new Event('input', { bubbles: true }));
    press(rar()?.querySelector('[data-part="correct"]') ?? null, 'Salvează');
    await settle();

    expect(api.verificationFileControllerCorrect).not.toHaveBeenCalled();
    expect(text(rar()?.querySelector('[role="alert"]'))).toContain(
      'Numărul RAR',
    );
    expect(field?.getAttribute('aria-invalid')).toBe('true');
  });

  it('re-reads the file when a correction finds it decided', async () => {
    const host = await open();
    api.verificationFileControllerCorrect.mockRejectedValue(
      new HttpErrorResponse({
        error: { code: 'verification_file_decided', status: 409 },
        status: 409,
      }),
    );
    api.verificationFileControllerRead.mockClear();
    const rar = () => row(host, 'register', 'rar');

    press(rar(), 'Corectează');
    await settle();
    const field = input(rar()?.querySelector('[data-part="correct"]'));
    (field as HTMLInputElement).value = 'CJ 221/2021';
    field?.dispatchEvent(new Event('input', { bubbles: true }));
    press(rar()?.querySelector('[data-part="correct"]') ?? null, 'Salvează');
    await settle();

    expect(api.verificationFileControllerRead).toHaveBeenCalled();
  });

  it('offers the correction and the forms only on an undecided file', async () => {
    const host = await open();
    expect(buttons(row(host, 'register', 'rar'))).toEqual(
      expect.arrayContaining(['Corectează', 'Înregistrează']),
    );
    expect(buttons(row(host, 'register', 'activities'))).toContain(
      'Înregistrează',
    );

    reset();
    const decided = await open(
      fileOf({
        file: {
          decidedAt: NOW.toISOString(),
          decidedBy: ioana,
          status: 'approved',
        },
      }),
    );
    expect(buttons(row(decided, 'register', 'rar'))).toEqual([]);
    expect(buttons(row(decided, 'register', 'activities'))).toEqual([]);
  });

  it('hands the RAR form the number and the activities form the catalogue and the jobs', async () => {
    const host = await open();

    press(row(host, 'register', 'rar'), 'Înregistrează');
    await settle();
    const rarForm = row(host, 'register', 'rar')?.querySelector(
      'mf-verification-register-form',
    );
    expect(text(rarForm)).toContain('B 1234/2019');
    expect(text(rarForm)).toContain('aceeași firmă');

    press(row(host, 'register', 'activities'), 'Înregistrează');
    await settle();
    const activitiesForm = row(host, 'register', 'activities')?.querySelector(
      'mf-verification-register-form',
    );
    expect(text(activitiesForm)).toContain('Frâne');
    expect(text(activitiesForm)).toContain('Plăcuțe de frână');
  });

  it('reads the stored RAR ticks as text on an OK row', async () => {
    const host = await open(
      withCheck('rar', {
        detail: 'aceeași firmă și adresă',
        evidence: {
          found: true,
          lookedUpOn: daysAgo(0),
          rarNumber: 'B 1234/2019',
          sameAddress: true,
          sameCompany: true,
        },
        recorder: ioana,
        result: 'ok',
      } as Partial<VerificationFileCheckDto>),
    );

    expect(text(row(host, 'register', 'rar'))).toContain(
      'găsită · firmă · adresă',
    );
    expect(text(row(host, 'register', 'rar'))).toContain(
      'aceeași firmă și adresă',
    );
  });

  // @traces 1357-FR-003
  it('names the ticked activities and the uncovered jobs of a recorded activities row', async () => {
    const more = {
      activities: [
        { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
      ],
    };
    const warning = {
      detail: 'Plăcuțe de frână nu apare în autorizație',
      evidence: { lookedUpOn: daysAgo(0), uncoveredJobTypeIds: ['job-pads'] },
      recorder: ioana,
      result: 'warning',
    } as Partial<VerificationFileCheckDto>;
    const host = await open(withCheck('activities', warning, more));
    const activities = text(row(host, 'register', 'activities'));
    expect(activities).toContain('Mecanică');
    expect(activities).toContain('Neacoperite: Plăcuțe de frână');

    reset();
    const english = await open(withCheck('activities', warning, more), 'en');
    expect(text(row(english, 'register', 'activities'))).toContain(
      'Not covered: Brake pads',
    );
  });

  // @traces 204-FR-009
  it('says no activity is recorded when the list was saved empty, and nothing while unchecked', async () => {
    const warning = {
      detail: 'autorizația nu e lizibilă',
      evidence: { lookedUpOn: daysAgo(0), uncoveredJobTypeIds: [] },
      recorder: ioana,
      result: 'warning',
    } as Partial<VerificationFileCheckDto>;
    const host = await open(
      withCheck('activities', warning, { activities: [] }),
    );
    const line = text(row(host, 'register', 'activities'));
    expect(line).toContain('nicio activitate înregistrată');
    expect(line).toContain('autorizația nu e lizibilă');

    reset();
    const english = await open(
      withCheck('activities', warning, { activities: [] }),
      'en',
    );
    expect(text(row(english, 'register', 'activities'))).toContain(
      'no activity recorded',
    );

    reset();
    const unchecked = await open();
    expect(text(row(unchecked, 'register', 'activities'))).not.toContain(
      'nicio activitate',
    );
  });

  it('notes in the footer that the RAR check is required until it is OK', async () => {
    const host = await open();
    expect(text(section(host, 'footer'))).toContain(
      'Verificarea RAR e obligatorie',
    );

    reset();
    const ok = await open(withCheck('rar', { recorder: ioana, result: 'ok' }));
    expect(text(section(ok, 'footer'))).not.toContain(
      'Verificarea RAR e obligatorie',
    );

    reset();
    const decided = await open(
      fileOf({
        file: {
          decidedAt: NOW.toISOString(),
          decidedBy: ioana,
          status: 'rejected',
        },
      }),
    );
    expect(text(section(decided, 'footer'))).not.toContain(
      'Verificarea RAR e obligatorie',
    );
  });

  it('lists a number correction in the history', async () => {
    const host = await open(
      fileOf({
        timeline: {
          entries: [
            entry({
              field: 'rar_number',
              newValue: 'CJ 221/2021',
              oldValue: null,
            }),
          ],
          total: 1,
        },
      }),
    );

    expect(text(section(host, 'history'))).toContain(
      'Număr RAR: — → CJ 221/2021 — Ioana',
    );
  });
});

// @traces 303-FR-001 303-FR-012
describe('the approve button', () => {
  const approveButton = (host: HTMLElement) =>
    [...(section(host, 'footer')?.querySelectorAll('button') ?? [])].find((b) =>
      ['Aprobă și publică', 'Approve and publish'].includes(text(b)),
    ) as HTMLButtonElement;
  const hint = (host: HTMLElement) =>
    section(host, 'footer')?.querySelector<HTMLElement>(
      '[data-part="gate-hint"]',
    ) ?? null;
  const withChecks = (rar: string, caen: string) =>
    fileOf({
      checks: KINDS.map((kind) =>
        check(kind, {
          result: (kind === 'rar'
            ? rar
            : kind === 'caen'
              ? caen
              : 'ok') as VerificationFileCheckDto['result'],
        }),
      ),
    });

  it.each([
    ['ro', 'Verificarea RAR e obligatorie'],
    ['en', 'The RAR check is required'],
  ] as const)(
    'is disabled while the rar check is not ok, described by the RAR hint in %s',
    async (language, line) => {
      const host = await open(withChecks('not_run', 'ok'), language);

      const button = approveButton(host);
      expect(button.disabled).toBe(true);
      expect(text(hint(host))).toBe(line);
      expect(button.getAttribute('aria-describedby')).toBe(hint(host)?.id);
      expect(hint(host)?.id).toBeTruthy();
    },
  );

  it.each([
    ['ro', 'Verificarea CAEN 4520 e obligatorie'],
    ['en', 'The CAEN 4520 check is required'],
  ] as const)(
    'turns to the CAEN hint in %s once rar is ok and caen is not',
    async (language, line) => {
      const host = await open(withChecks('ok', 'warning'), language);

      expect(approveButton(host).disabled).toBe(true);
      expect(text(hint(host))).toBe(line);
    },
  );

  it('names the RAR hint first when both are not ok', async () => {
    const host = await open(withChecks('failed', 'failed'));

    expect(text(hint(host))).toBe('Verificarea RAR e obligatorie');
  });

  it('is enabled with no hint when both are ok, beside the request for more and the rejection', async () => {
    const host = await open(withChecks('ok', 'ok'));

    const button = approveButton(host);
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(hint(host)).toBeNull();
    const others = [
      ...(section(host, 'footer')?.querySelectorAll('button') ?? []),
    ].filter((b) => b !== button);
    expect(others.map((b) => [text(b), b.disabled])).toEqual([
      ['Cere completări', false],
      ['Respinge', false],
    ]);
  });

  it('shows no hint on a decided file', async () => {
    const host = await open(rejected());

    expect(hint(host)).toBeNull();
  });
});

// @traces 303-FR-002 303-FR-009 303-FR-012
describe('approving', () => {
  const allOk = (extra: Parameters<typeof fileOf>[0] = {}) =>
    fileOf({
      checks: KINDS.map((kind) => check(kind, { result: 'ok' })),
      ...extra,
    });
  const approved = () =>
    allOk({
      file: { decidedAt: DECIDED_AT, decidedBy: ioana, status: 'approved' },
    });
  const approveButton = (host: HTMLElement) =>
    [...(section(host, 'footer')?.querySelectorAll('button') ?? [])].find(
      (b) => text(b) === 'Aprobă și publică',
    ) as HTMLButtonElement;
  const noteRequired = () =>
    new HttpErrorResponse({
      error: {
        code: 'note_required',
        errors: [{ code: 'required', field: 'note' }],
        missing: [{ kind: 'photos', result: 'failed' }],
      },
      status: 422,
    });

  it('opens the approval dialog with nothing listed when every check is ok', async () => {
    const host = await open(allOk());
    overlays.open.mockResolvedValue('cancelled');

    approveButton(host).click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: { missing: [] },
        shape: 'dialog',
        title: 'admin.file.approve.title',
      }),
    );
  });

  it('lists the checks not ok and the documents missing', async () => {
    const host = await open(
      allOk({
        checks: KINDS.map((kind) =>
          check(kind, { result: kind === 'photos' ? 'warning' : 'ok' }),
        ),
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
            id: null,
            issuedOn: null,
            kind: 'rar_authorisation',
            pages: 0,
            present: false,
            stale: null,
          },
        ] as VerificationFileDto['documents'],
      }),
    );
    overlays.open.mockResolvedValue('cancelled');

    approveButton(host).click();
    await settle();

    expect(overlays.open.mock.calls[0]?.[1]?.data).toEqual({
      missing: [
        { kind: 'photos', result: 'warning' },
        { document: 'rar_authorisation' },
      ],
    });
  });

  it.each([
    ['with the note', { note: 'Verificat la telefon' }],
    ['with no note', {}],
  ])(
    'sends the approval %s, shows it, and moves focus to the title',
    async (_, closed) => {
      const host = await open(allOk());
      overlays.open.mockResolvedValue(closed);
      api.verificationFileControllerDecision.mockImplementation(async () => {
        answer = async () => approved();
        return approved();
      });

      approveButton(host).click();
      await settle();

      expect(api.verificationFileControllerDecision).toHaveBeenCalledWith({
        body: { decision: 'approved', ...closed },
        id: FILE,
      });
      expect(text(section(host, 'footer'))).toContain('Aprobat de Ioana');
      expect(document.activeElement).toBe(host.querySelector('h3'));
    },
  );

  it('sends nothing on a cancel and hands focus back to the button', async () => {
    const host = await open(allOk());
    overlays.open.mockResolvedValue('cancelled');

    approveButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(approveButton(host));
  });

  it('shows a spinner on the button while the call is on its way, every decision disabled', async () => {
    const host = await open(allOk());
    overlays.open.mockResolvedValue({});
    let settleCall: (value: VerificationFileDto) => void = () => undefined;
    api.verificationFileControllerDecision.mockReturnValue(
      new Promise((resolve) => {
        settleCall = resolve;
      }),
    );

    approveButton(host).click();
    await settle();

    const button = approveButton(host);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('[data-part="spinner"]')).not.toBeNull();
    expect(
      [...(section(host, 'footer')?.querySelectorAll('button') ?? [])].every(
        (b) => b.disabled,
      ),
    ).toBe(true);
    approveButton(host).click();
    await settle();
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    settleCall(approved());
    await settle();
  });

  it('says the decision could not be saved and reads the file again on any other failure', async () => {
    const host = await open(allOk());
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    const reads = api.verificationFileControllerRead.mock.calls.length;

    approveButton(host).click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      reads + 1,
    );
    expect(approveButton(host).disabled).toBe(false);
  });

  it('shows a decision that committed before the failure, never offering it again', async () => {
    const host = await open(allOk());
    overlays.open.mockResolvedValue({});
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => approved();
      throw new HttpErrorResponse({ status: 0 });
    });

    approveButton(host).click();
    await settle();

    expect(text(section(host, 'footer'))).toContain('Aprobat de Ioana');
    expect(approveButton(host)).toBeUndefined();
  });

  it('reads the file again on note_required and asks again, the note now required', async () => {
    const host = await open(allOk());
    const stale = allOk({
      checks: KINDS.map((kind) =>
        check(kind, { result: kind === 'photos' ? 'failed' : 'ok' }),
      ),
    });
    overlays.open
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ note: 'Poze vechi, atelierul e același' });
    api.verificationFileControllerDecision
      .mockImplementationOnce(async () => {
        answer = async () => stale;
        throw noteRequired();
      })
      .mockImplementationOnce(async () => {
        answer = async () => approved();
        return approved();
      });

    approveButton(host).click();
    await settle();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(2);
    expect(overlays.open.mock.calls[1]?.[1]?.data).toEqual({
      missing: [{ kind: 'photos', result: 'failed' }],
    });
    expect(api.verificationFileControllerDecision).toHaveBeenLastCalledWith({
      body: { decision: 'approved', note: 'Poze vechi, atelierul e același' },
      id: FILE,
    });
    expect(toast).not.toHaveBeenCalled();
    expect(text(section(host, 'footer'))).toContain('Aprobat de Ioana');
  });
  it("asks again with the server's missing list, not one rebuilt from the re-read", async () => {
    const host = await open(allOk());
    overlays.open
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ note: 'Actele vin luni' });
    const missing = [
      { kind: 'address', result: 'warning' },
      { document: 'onrc_certificate' },
    ];
    api.verificationFileControllerDecision
      .mockImplementationOnce(async () => {
        // The re-read shows every check ok: only the server's list names the gaps.
        answer = async () => allOk();
        throw new HttpErrorResponse({
          error: { code: 'note_required', missing },
          status: 422,
        });
      })
      .mockImplementationOnce(async () => {
        answer = async () => approved();
        return approved();
      });

    approveButton(host).click();
    await settle();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(2);
    expect(overlays.open.mock.calls[1]?.[1]?.data).toEqual({ missing });
    expect(text(section(host, 'footer'))).toContain('Aprobat de Ioana');
  });

  it.each([
    ['a line it cannot read', [{ kind: 'rar' }]],
    ['an empty list', []],
    ['no list', undefined],
  ])('falls back to the re-read when the 422 carries %s', async (_, sent) => {
    const host = await open(allOk());
    const stale = allOk({
      checks: KINDS.map((kind) =>
        check(kind, { result: kind === 'photos' ? 'warning' : 'ok' }),
      ),
    });
    overlays.open.mockResolvedValueOnce({}).mockResolvedValueOnce('cancelled');
    api.verificationFileControllerDecision.mockImplementationOnce(async () => {
      answer = async () => stale;
      throw new HttpErrorResponse({
        error: { code: 'note_required', missing: sent },
        status: 422,
      });
    });

    approveButton(host).click();
    await settle();
    await settle();

    expect(overlays.open.mock.calls[1]?.[1]?.data).toEqual({
      missing: [{ kind: 'photos', result: 'warning' }],
    });
  });
});

// @traces 303-FR-007 303-FR-012
describe('a CUI held by another garage', () => {
  const shared = (host: HTMLElement) =>
    section(host, 'header')?.querySelector<HTMLElement>(
      '[data-part="cui-shared"]',
    ) ?? null;
  const withShared = (names: string[]) =>
    fileOf({
      checks: KINDS.map((kind) => check(kind, { result: 'ok' })),
      garage: { cuiAlsoUsedBy: names } as Partial<
        VerificationFileDto['garage']
      >,
    });

  it.each([
    ['ro', ['Service Dobre'], 'CUI folosit și de alt service: Service Dobre'],
    [
      'ro',
      ['Auto Ion', 'Service Dobre'],
      'CUI folosit și de alt service: Auto Ion, Service Dobre',
    ],
    ['en', ['Service Dobre'], 'CUI also used by another garage: Service Dobre'],
  ] as const)(
    'is named in the header in %s, as a fact with no alert: %j',
    async (language, names, line) => {
      const host = await open(withShared([...names]), language);

      const el = shared(host);
      expect(text(el)).toBe(line);
      expect(el?.hasAttribute('role')).toBe(false);
    },
  );

  it('shows nothing when no other garage holds it', async () => {
    const host = await open(withShared([]));

    expect(shared(host)).toBeNull();
  });

  it('leaves the approve button as it was', async () => {
    const host = await open(withShared(['Service Dobre']));

    const button = [
      ...(section(host, 'footer')?.querySelectorAll('button') ?? []),
    ].find((b) => text(b) === 'Aprobă și publică');
    expect(button?.disabled).toBe(false);
  });
});

// @traces 069-FR-006 069-FR-008 069-FR-009 069-FR-010
describe('the reports part', () => {
  const EARLIER = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
  const rows = (host: HTMLElement) => [
    ...(section(host, 'reports')?.querySelectorAll('li') ?? []),
  ];

  it.each([
    ['ro', [report()], 'SESIZĂRI · 1 DESCHISĂ'],
    [
      'ro',
      [report(), report({ id: 'report-2' }), report({ id: 'report-3' })],
      'SESIZĂRI · 3 DESCHISE',
    ],
    ['en', [report()], 'REPORTS · 1 OPEN'],
    [
      'en',
      [report(), report({ id: 'report-2', status: 'unfounded' })],
      'REPORTS · 1 OPEN',
    ],
  ] as const)(
    'titles the part in %s with the open count',
    async (language, reports, title) => {
      const host = await open(fileOf({ reports: [...reports] }), language);

      expect(text(section(host, 'reports')?.querySelector('h4'))).toBe(title);
    },
  );

  it('titles the part with the open count the server gives, past the reports it carries, and offers the decisions', async () => {
    const host = await open(
      fileOf({
        file: { status: 'in_review' },
        reports: [report({ status: 'unfounded' })],
        reportsOpen: 2,
      }),
    );

    expect(text(section(host, 'reports')?.querySelector('h4'))).toBe(
      'SESIZĂRI · 2 DESCHISE',
    );
    expect(host.querySelector('[data-part="report-confirmed"]')).not.toBeNull();
  });

  it('reads one row per report: its text, its local date and time, and its reporter linked to the accounts view', async () => {
    const host = await open(
      fileOf({
        reports: [
          report(),
          report({
            createdAt: EARLIER,
            id: 'report-2',
            reporter: { id: 'driver-2', name: 'Andrei M.' },
            text: 'Prețuri care nu sunt cele reale.',
          }),
        ],
      }),
    );
    const [first, second] = rows(host);

    expect(rows(host)).toHaveLength(2);
    expect(text(first)).toContain('Adresă greșită pe pagina service-ului.');
    expect(text(first)).toContain(appliedAt(NOW.toISOString(), 'ro', NOW));
    const link = first?.querySelector('a');
    expect(text(link)).toBe('Elena D.');
    expect(link?.getAttribute('href')).toBe('/app/admin/users?q=driver-1');
    expect(text(second)).toContain('Prețuri care nu sunt cele reale.');
    expect(text(second)).toContain(appliedAt(EARLIER, 'ro', NOW));
    expect(second?.querySelector('a')?.getAttribute('href')).toBe(
      '/app/admin/users?q=driver-2',
    );
  });

  it.each([
    ['ro', 'Cont șters'],
    ['en', 'Deleted account'],
  ] as const)(
    'names a deleted reporter in %s with no link',
    async (language, name) => {
      const host = await open(
        fileOf({ reports: [report({ reporter: null })] }),
        language,
      );
      const [only] = rows(host);

      expect(text(only)).toContain(name);
      expect(only?.querySelector('a')).toBeNull();
    },
  );

  it('reads a decided report with its outcome, the admin, the time and the note or the reason', async () => {
    const host = await open(
      fileOf({
        reports: [
          report({
            decidedAt: EARLIER,
            decidedBy: ioana,
            decisionNote: 'Am sunat, adresa e corectă.',
            status: 'unfounded',
          }),
          report({
            decidedAt: EARLIER,
            decidedBy: ioana,
            decisionNote: 'Prețuri false confirmate la telefon',
            id: 'report-2',
            status: 'confirmed',
          }),
        ],
      }),
    );
    const [unfounded, confirmed] = rows(host);
    const when = appliedAt(EARLIER, 'ro', NOW);

    expect(text(section(host, 'reports')?.querySelector('h4'))).toBe(
      'SESIZĂRI · 0 DESCHISE',
    );
    expect(text(unfounded)).toContain(`Nefondată de Ioana, ${when}`);
    expect(text(unfounded)).toContain(
      'Notă internă: Am sunat, adresa e corectă.',
    );
    expect(text(confirmed)).toContain(`Confirmată de Ioana, ${when}`);
    expect(text(confirmed)).toContain(
      'Motiv: Prețuri false confirmate la telefon',
    );
  });

  it('reads the decided outcomes in English', async () => {
    const host = await open(
      fileOf({
        reports: [
          report({ decidedAt: EARLIER, decidedBy: ioana, status: 'unfounded' }),
          report({
            decidedAt: EARLIER,
            decidedBy: ioana,
            id: 'report-2',
            status: 'confirmed',
          }),
        ],
      }),
      'en',
    );
    const [unfounded, confirmed] = rows(host);
    const when = appliedAt(EARLIER, 'en', NOW);

    expect(text(unfounded)).toContain(`Unfounded, by Ioana, ${when}`);
    expect(text(confirmed)).toContain(`Confirmed by Ioana, ${when}`);
  });

  it('shows no part on a file with no report', async () => {
    const host = await open();

    expect(section(host, 'reports')).toBeNull();
  });

  it('leaves the part as it was when a manual check is recorded', async () => {
    const host = await open(fileOf({ reports: [report()] }));
    const before = text(section(host, 'reports'));
    api.verificationChecksControllerRecord.mockImplementation(
      async ({ kind, body }) => ({
        check: check(kind, { recorder: ioana, result: body.result }),
        rarActivities: [],
        summary: { en: '', ro: '' },
      }),
    );

    tick(host, 'address', true);
    await settle();

    expect(text(section(host, 'reports'))).toBe(before);
  });
});

describe('deciding the reports', () => {
  const DECIDED_AT_REPORT = new Date(NOW.getTime() - 60_000).toISOString();
  const reported = (extra: Partial<VerificationFileReportDto> = {}) =>
    fileOf({ reports: [report(extra)] });
  // The file as the decision answers it: approved again by Ioana, its
  // report closed with the outcome.
  const decidedAs = (status: 'unfounded' | 'confirmed', note: string | null) =>
    fileOf({
      file: {
        decidedAt: DECIDED_AT_REPORT,
        decidedBy: ioana,
        status: 'approved',
      },
      reports: [
        report({
          decidedAt: DECIDED_AT_REPORT,
          decidedBy: ioana,
          decisionNote: note,
          status,
        }),
      ],
    });
  const footerButton = (host: HTMLElement, part: string) =>
    section(host, 'footer')?.querySelector<HTMLButtonElement>(
      `[data-part="${part}"]`,
    ) ?? null;

  it.each([
    ['ro', ['Sesizare nefondată', 'Sesizare confirmată']],
    ['en', ['Report unfounded', 'Report confirmed']],
  ] as const)(
    'offers the two report decisions in %s in place of the three, on an in-review file with an open report',
    async (language, labels) => {
      const host = await open(reported(), language);
      const footer = section(host, 'footer');

      expect(buttons(footer)).toEqual([...labels]);
      const unfounded = footerButton(host, 'report-unfounded');
      const confirmed = footerButton(host, 'report-confirmed');
      expect(unfounded?.disabled).toBe(false);
      expect(confirmed?.disabled).toBe(false);
      expect(unfounded?.classList).toContain('action');
      expect(confirmed?.classList).toContain('danger');
      expect(footer?.querySelector('[data-part="gate-hint"]')).toBeNull();
    },
  );

  it.each([
    [
      'a submitted file with an open report',
      { reports: [report()] },
      'submitted',
    ],
    [
      'an in-review file whose reports are all decided',
      {
        reports: [
          report({
            decidedAt: NOW.toISOString(),
            decidedBy: ioana,
            status: 'unfounded',
          }),
        ],
      },
      'in_review',
    ],
  ] satisfies [
    string,
    { reports: VerificationFileReportDto[] },
    'submitted' | 'in_review',
  ][])('keeps the three decisions on %s', async (_, extra, status) => {
    const host = await open(fileOf({ ...extra, file: { status } }));

    expect(buttons(section(host, 'footer'))).toEqual([
      'Aprobă și publică',
      'Cere completări',
      'Respinge',
    ]);
  });

  it('asks first and sends unfounded with the note, then shows the decided state', async () => {
    const host = await open(reported());
    overlays.open.mockResolvedValue({ note: 'Am sunat, adresa e corectă.' });
    api.reportDecisionControllerDecide.mockImplementation(async () => {
      answer = async () =>
        decidedAs('unfounded', 'Am sunat, adresa e corectă.');
      return answer();
    });

    footerButton(host, 'report-unfounded')?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      ReportDecision,
      expect.objectContaining({
        data: { decision: 'unfounded' },
        shape: 'dialog',
        title: 'admin.file.reportDecision.unfounded',
      }),
    );
    expect(api.reportDecisionControllerDecide).toHaveBeenCalledWith({
      body: { decision: 'unfounded', note: 'Am sunat, adresa e corectă.' },
      id: FILE,
    });
    const footer = section(host, 'footer');
    expect(text(footer)).toContain('Aprobat de Ioana');
    expect(buttons(footer)).toEqual([]);
    expect(text(section(host, 'reports'))).toContain('Nefondată de Ioana');
  });

  it('sends unfounded with no note when none was written', async () => {
    const host = await open(reported());
    overlays.open.mockResolvedValue({});
    api.reportDecisionControllerDecide.mockResolvedValue(
      decidedAs('unfounded', null),
    );

    footerButton(host, 'report-unfounded')?.click();
    await settle();

    expect(api.reportDecisionControllerDecide).toHaveBeenCalledWith({
      body: { decision: 'unfounded' },
      id: FILE,
    });
  });

  it('asks for the reason and sends confirmed with it', async () => {
    const host = await open(reported());
    overlays.open.mockResolvedValue({
      reason: 'Prețuri false confirmate la telefon',
    });
    api.reportDecisionControllerDecide.mockResolvedValue(
      decidedAs('confirmed', 'Prețuri false confirmate la telefon'),
    );

    footerButton(host, 'report-confirmed')?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledWith(
      ReportDecision,
      expect.objectContaining({
        data: { decision: 'confirmed' },
        shape: 'dialog',
        title: 'admin.file.reportDecision.confirmed',
      }),
    );
    expect(api.reportDecisionControllerDecide).toHaveBeenCalledWith({
      body: {
        decision: 'confirmed',
        reason: 'Prețuri false confirmate la telefon',
      },
      id: FILE,
    });
    expect(text(section(host, 'reports'))).toContain('Confirmată de Ioana');
  });

  it.each(['report-unfounded', 'report-confirmed'])(
    'sends nothing when the %s dialog is cancelled, and hands focus back',
    async (part) => {
      const host = await open(reported());
      overlays.open.mockResolvedValue('cancelled');

      footerButton(host, part)?.click();
      await settle();

      expect(api.reportDecisionControllerDecide).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(footerButton(host, part));
    },
  );

  it('opens one dialog however often it is pressed', async () => {
    const host = await open(reported());
    overlays.open.mockReturnValue(new Promise(() => undefined));

    footerButton(host, 'report-unfounded')?.click();
    footerButton(host, 'report-confirmed')?.click();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ro', 'Deja decis de Dan la'],
    ['en', 'Already decided by Dan at'],
  ] as const)(
    'says in %s who decided first and reads the file again',
    async (language, line) => {
      const host = await open(reported(), language);
      overlays.open.mockResolvedValue({});
      api.reportDecisionControllerDecide.mockImplementation(async () => {
        answer = async () => rejected(dan);
        throw refusedBy('verification_transition_refused', {
          decidedAt: DECIDED_AT,
          decidedBy: 'Dan',
        });
      });
      const reads = api.verificationFileControllerRead.mock.calls.length;

      footerButton(host, 'report-unfounded')?.click();
      await settle();

      expect(text(alertIn(host))).toBe(
        `${line} ${appliedAt(DECIDED_AT, language, new Date())}`,
      );
      expect(api.verificationFileControllerRead.mock.calls.length).toBe(
        reads + 1,
      );
    },
  );

  it('says in a toast that the decision could not be saved on any other failure, and reads the file again', async () => {
    const host = await open(reported());
    overlays.open.mockResolvedValue({ reason: 'Motiv' });
    api.reportDecisionControllerDecide.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    const reads = api.verificationFileControllerRead.mock.calls.length;

    footerButton(host, 'report-confirmed')?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(alertIn(host)).toBeNull();
    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      reads + 1,
    );
  });

  it.each([
    ['unfounded', 'ro', 'Sesizări închise ca nefondate de Ioana'],
    ['confirmed', 'ro', 'Sesizări confirmate de Ioana'],
    ['unfounded', 'en', 'Reports closed as unfounded by Ioana'],
    ['confirmed', 'en', 'Reports confirmed by Ioana'],
  ] as const)(
    'writes a %s decision in the history in %s',
    async (decision, language, line) => {
      const host = await open(
        fileOf({
          timeline: {
            entries: [
              entry({
                field: 'reports',
                kind: 'report_decided',
                newValue: { decision, reportIds: ['report-1'] },
                oldValue: 'open',
              }),
            ],
            total: 1,
          },
        }),
        language,
      );

      expect(text(section(host, 'history'))).toContain(line);
    },
  );
});

// @traces 305-FR-001 305-FR-007 305-FR-011
describe('rejecting', () => {
  const rejectButton = (host: HTMLElement) =>
    section(host, 'footer')?.querySelector<HTMLButtonElement>(
      '[data-part="reject"]',
    ) as HTMLButtonElement;
  const CLOSED = { note: 'Autorizația RAR a expirat.', reason: 'rar' };
  const refusedWith = (code: string, field: string) =>
    new HttpErrorResponse({
      error: { code, errors: [{ code: 'required', field }], status: 422 },
      status: 422,
    });
  const decidedRar = () =>
    fileOf({
      file: {
        decidedAt: DECIDED_AT,
        decidedBy: ioana,
        reasonCode: 'rar',
        reasonNote: 'Autorizația RAR a expirat.',
        status: 'rejected',
      },
    });

  it.each(['not_run', 'failed', 'ok'] as const)(
    'is enabled on an undecided file whatever the checks say (%s)',
    async (result) => {
      const host = await open(
        fileOf({ checks: KINDS.map((kind) => check(kind, { result })) }),
      );

      expect(text(rejectButton(host))).toBe('Respinge');
      expect(rejectButton(host).disabled).toBe(false);
    },
  );

  it('is not offered on a decided file', async () => {
    const host = await open(rejected());

    expect(rejectButton(host)).toBeNull();
  });

  it('opens the rejection dialog, one at a time', async () => {
    const host = await open();
    let close: (value: unknown) => void = () => undefined;
    overlays.open.mockReturnValue(
      new Promise((resolve) => {
        close = resolve;
      }),
    );

    rejectButton(host).click();
    rejectButton(host).click();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(overlays.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: {},
        shape: 'dialog',
        title: 'admin.file.reject.title',
      }),
    );
    close('cancelled');
    await settle();
  });

  it('sends the rejection once, shows it, and moves focus to the title', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => decidedRar();
      return decidedRar();
    });

    rejectButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    expect(api.verificationFileControllerDecision).toHaveBeenCalledWith({
      body: { decision: 'rejected', ...CLOSED },
      id: FILE,
    });
    const footer = section(host, 'footer');
    expect(text(footer)).toContain('Respins de Ioana');
    expect(text(footer)).toContain('Autorizația RAR a expirat.');
    expect(document.activeElement).toBe(host.querySelector('h3'));
  });

  it('sends nothing on a cancel and hands focus back to the button', async () => {
    const host = await open();
    overlays.open.mockResolvedValue('cancelled');

    rejectButton(host).click();
    await settle();

    expect(api.verificationFileControllerDecision).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(rejectButton(host));
  });

  it('shows a spinner on the button while the call is on its way, every decision disabled', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    let settleCall: (value: VerificationFileDto) => void = () => undefined;
    api.verificationFileControllerDecision.mockReturnValue(
      new Promise((resolve) => {
        settleCall = resolve;
      }),
    );

    rejectButton(host).click();
    await settle();

    const button = rejectButton(host);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('[data-part="spinner"]')).not.toBeNull();
    const approve = section(host, 'footer')?.querySelector(
      '[data-part="approve"]',
    );
    expect(approve?.querySelector('[data-part="spinner"]')).toBeNull();
    expect(approve?.hasAttribute('aria-busy')).toBe(false);
    expect(
      [...(section(host, 'footer')?.querySelectorAll('button') ?? [])].every(
        (b) => b.disabled,
      ),
    ).toBe(true);
    rejectButton(host).click();
    await settle();
    expect(api.verificationFileControllerDecision).toHaveBeenCalledTimes(1);
    settleCall(decidedRar());
    await settle();
  });

  it.each([
    ['ro', 'Deja decis de Dan la'],
    ['en', 'Already decided by Dan at'],
  ] as const)(
    'says in %s who decided first and reads the file again',
    async (language, line) => {
      const host = await open(fileOf(), language);
      overlays.open.mockResolvedValue(CLOSED);
      api.verificationFileControllerDecision.mockImplementation(async () => {
        answer = async () => rejected(dan);
        throw refusedBy('verification_transition_refused', {
          currentStatus: 'rejected',
          decidedAt: DECIDED_AT,
          decidedBy: 'Dan',
        });
      });
      const reads = api.verificationFileControllerRead.mock.calls.length;

      rejectButton(host).click();
      await settle();

      expect(text(alertIn(host))).toBe(
        `${line} ${appliedAt(DECIDED_AT, language, new Date())}`,
      );
      expect(api.verificationFileControllerRead.mock.calls.length).toBe(
        reads + 1,
      );
      expect(overlays.open).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['reason_required', 'reason', 'reasonRequired'],
    ['note_required', 'note', 'noteRequired'],
    ['note_too_short', 'note', 'noteTooShort'],
  ] as const)(
    'reads the file again on %s and re-opens the dialog with the values and the field marked',
    async (code, field, refused) => {
      const host = await open();
      overlays.open
        .mockResolvedValueOnce({ note: 'Prea scurt', reason: 'address' })
        .mockResolvedValueOnce(CLOSED);
      api.verificationFileControllerDecision
        .mockRejectedValueOnce(refusedWith(code, field))
        .mockImplementationOnce(async () => {
          answer = async () => decidedRar();
          return decidedRar();
        });
      const reads = api.verificationFileControllerRead.mock.calls.length;

      rejectButton(host).click();
      await settle();
      await settle();

      expect(overlays.open).toHaveBeenCalledTimes(2);
      expect(overlays.open.mock.calls[1]?.[1]?.data).toEqual({
        note: 'Prea scurt',
        reason: 'address',
        refused,
      });
      expect(api.verificationFileControllerRead.mock.calls.length).toBe(
        reads + 2,
      );
      expect(api.verificationFileControllerDecision).toHaveBeenLastCalledWith({
        body: { decision: 'rejected', ...CLOSED },
        id: FILE,
      });
      expect(toast).not.toHaveBeenCalled();
      expect(text(section(host, 'footer'))).toContain('Respins de Ioana');
    },
  );

  it('does not ask again when the re-read finds the file decided', async () => {
    const host = await open();
    overlays.open.mockResolvedValueOnce(CLOSED);
    api.verificationFileControllerDecision.mockImplementationOnce(async () => {
      answer = async () => rejected(dan);
      throw refusedWith('note_too_short', 'note');
    });

    rejectButton(host).click();
    await settle();
    await settle();

    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(text(section(host, 'footer'))).toContain('Respins de Dan');
  });

  it('says the decision could not be saved and reads the file again on any other failure', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    const reads = api.verificationFileControllerRead.mock.calls.length;

    rejectButton(host).click();
    await settle();

    expect(toast).toHaveBeenCalledWith('Nu am putut salva decizia');
    expect(api.verificationFileControllerRead.mock.calls.length).toBe(
      reads + 1,
    );
    expect(rejectButton(host).disabled).toBe(false);
  });

  it('shows a rejection that committed before the failure, never offering it again', async () => {
    const host = await open();
    overlays.open.mockResolvedValue(CLOSED);
    api.verificationFileControllerDecision.mockImplementation(async () => {
      answer = async () => decidedRar();
      throw new HttpErrorResponse({ status: 0 });
    });

    rejectButton(host).click();
    await settle();

    expect(text(section(host, 'footer'))).toContain('Respins de Ioana');
    expect(rejectButton(host)).toBeNull();
  });
});

// @traces 305-FR-008
describe('a file after a rejection', () => {
  it.each([
    ['ro', 'Respins anterior: Autorizație RAR'],
    ['en', 'Rejected before: RAR authorisation'],
  ] as const)(
    'reads the earlier rejection above the checks, as text, in %s',
    async (language, line) => {
      const host = await open(
        fileOf({
          previousRejection: {
            decidedAt: DECIDED_AT,
            reasonCode: 'rar',
            reasonNote: '<b>Autorizația</b> RAR a expirat.',
          },
        }),
        language,
      );

      const rejectedBefore = section(host, 'rejected');
      expect(text(rejectedBefore)).toContain(line);
      expect(text(rejectedBefore)).toContain(
        '<b>Autorizația</b> RAR a expirat.',
      );
      expect(rejectedBefore?.querySelector('b')).toBeNull();
      expect(
        rejectedBefore?.compareDocumentPosition(
          section(host, 'register') as Node,
        ),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    },
  );
});
