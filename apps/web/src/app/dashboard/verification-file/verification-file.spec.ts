import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type AuditEntryDto,
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
  verificationFileControllerOpen: jest.Mock;
  verificationFileControllerRead: jest.Mock;
  verificationChecksControllerRecord: jest.Mock;
};
let documents: { legalDocumentsControllerPageAddress: jest.Mock };
let overlays: { open: jest.Mock };
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
    verificationFileControllerOpen: jest.fn(() => answer()),
    verificationFileControllerRead: jest.fn(() => answer()),
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
  it('reads in order: header, reported, rejected before, register, documents, manual, history, footer', async () => {
    const host = await open(
      fileOf({
        previousRejection: {
          decidedAt: NOW.toISOString(),
          reasonCode: 'documents_unreadable',
          reasonNote: 'Certificatul nu se citește.',
        },
        reports: [{ createdAt: NOW.toISOString(), text: 'Adresă greșită' }],
      }),
    );

    expect(
      [...host.querySelectorAll('[data-section]')].map((s) =>
        s.getAttribute('data-section'),
      ),
    ).toEqual([
      'header',
      'reported',
      'rejected',
      'register',
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
    expect(section(host, 'reported')).toBeNull();
    expect(section(host, 'rejected')).toBeNull();
  });

  it('shows a report as plain text, never as markup, and a reopening by a report', async () => {
    const host = await open(
      fileOf({
        file: { reopenedAt: NOW.toISOString(), reopenReason: 'garage_report' },
        reports: [
          { createdAt: NOW.toISOString(), text: '<b>Nu există</b> atelierul' },
        ],
      }),
    );
    const reported = section(host, 'reported');

    expect(text(reported)).toContain('Raportat');
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
    expect(text(company)).toContain('Firmă (ANAF, ONRC)');
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
    'shows the three decisions disabled, with the note, on a %s file',
    async (status) => {
      const host = await open(fileOf({ file: { status } }));
      const footer = section(host, 'footer');

      expect(buttons(footer)).toEqual([
        'Aprobă și publică',
        'Cere completări',
        'Respinge',
      ]);
      expect(
        [...(footer?.querySelectorAll('button') ?? [])].every(
          (b) => b.disabled,
        ),
      ).toBe(true);
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
