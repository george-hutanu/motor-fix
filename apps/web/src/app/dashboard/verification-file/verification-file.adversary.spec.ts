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

// @traces 302-FR-003 302-FR-004 302-FR-005 302-FR-006 302-FR-007 302-FR-008 302-FR-009 302-FR-010

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

const later = () => new Promise((resolve) => setTimeout(resolve, 350));

const recorded = (kind: (typeof KINDS)[number], result: string) => ({
  check: check(kind, { recorder: ioana, result: result as 'ok' }),
  rarActivities: [],
  summary: { en: '', ro: '' },
});

describe('hostile text in the file', () => {
  it('renders markup in names, details and recorders as plain text', async () => {
    const host = await open(
      fileOf({
        checks: KINDS.map((kind) =>
          kind === 'company'
            ? check(kind, {
                detail: '<img src=x onerror=alert(1)>',
                recorder: { id: 'a', name: '<b>Eve</b>' },
                result: 'warning',
              })
            : check(kind),
        ),
        garage: {
          brands: ['<script>alert(1)</script>'],
          name: '<img src=x onerror=alert(2)>',
        },
      }),
    );

    expect(host.querySelector('img[src="x"]')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(text(host.querySelector('h3'))).toBe('<img src=x onerror=alert(2)>');
    expect(text(row(host, 'register', 'company'))).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('never turns a photo address into a script link', async () => {
    const host = await open(
      fileOf({
        garage: {
          photos: [
            {
              displayUrl: 'javascript:alert(1)',
              height: 1,
              id: 'p',
              thumbnailUrl: 'https://store.test/t',
              width: 1,
            },
          ],
        },
      }),
    );

    const href = host
      .querySelector('[data-section="header"] a')
      ?.getAttribute('href');
    expect(href ?? '').not.toMatch(/^javascript:/i);
  });

  it('prints no null, undefined or NaN for a mobile mechanic with no seat or radius', async () => {
    const host = await open(
      fileOf({
        garage: {
          address: null,
          businessKind: 'mobile',
          cui: null,
          phone: null,
          seatAddress: null,
          serviceRadiusKm: null,
        },
      }),
    );

    expect(text(section(host, 'header'))).not.toMatch(/null|undefined|NaN/);
  });

  it('reads a one kilometre radius', async () => {
    const host = await open(
      fileOf({
        garage: {
          address: null,
          businessKind: 'mobile',
          seatAddress: 'Str. A 1',
          serviceRadiusKm: 1,
        },
      }),
    );

    expect(text(section(host, 'header'))).toContain('Str. A 1 · rază 1 km');
  });
});

describe('the sections with missing parts', () => {
  it('shows the four manual rows, unchecked, when the file carries no checks', async () => {
    const host = await open(fileOf({ checks: [] }));

    expect(
      [...(section(host, 'manual')?.querySelectorAll('[data-kind]') ?? [])].map(
        (r) => r.getAttribute('data-kind'),
      ),
    ).toEqual(['address', 'photos', 'representative', 'documents']);
    expect(box(host, 'address').checked).toBe(false);
    expect(text(row(host, 'register', 'company'))).toContain('neverificat');
  });

  it('shows the documents section without a row when the file has no document kinds', async () => {
    const host = await open(fileOf({ documents: [] }));

    expect(
      section(host, 'documents')?.querySelectorAll('[data-kind]').length,
    ).toBe(0);
    expect(section(host, 'manual')).not.toBeNull();
  });

  it('opens a page of a sixty-page document with sixty buttons', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: daysAgo(3),
            kind: 'onrc_certificate',
            pages: 60,
            present: true,
            stale: false,
          },
        ],
      }),
    );

    const names = buttons(row(host, 'documents', 'onrc_certificate'));
    expect(names).toHaveLength(60);
    expect(names[59]).toBe('Deschide pagina 60');
  });

  it('reads English wording for a missing and an unreadable-store document', async () => {
    const host = await open(
      fileOf({
        documents: [
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
      'en',
    );

    expect(text(row(host, 'documents', 'rar_authorisation'))).toContain(
      '· missing',
    );
  });
});

describe('the issue date', () => {
  it('never reads a date in the future as a negative age', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: daysAgo(-1),
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: false,
          },
        ],
      }),
    );

    expect(text(row(host, 'documents', 'onrc_certificate'))).not.toMatch(
      /-\d|NaN/,
    );
  });

  it('reads two days ago in English', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: daysAgo(2),
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: false,
          },
        ],
      }),
      'en',
    );

    expect(text(row(host, 'documents', 'onrc_certificate'))).toContain(
      'issued 2 days ago',
    );
  });

  it('shows no warning when the server says the certificate is not stale, even with no date', async () => {
    const host = await open(
      fileOf({
        documents: [
          {
            id: 'doc-onrc',
            issuedOn: null,
            kind: 'onrc_certificate',
            pages: 1,
            present: true,
            stale: false,
          },
        ],
      }),
    );

    expect(
      row(host, 'documents', 'onrc_certificate')?.querySelector('.stale'),
    ).toBeNull();
  });

  it('shows no warning on a document the server leaves unflagged', async () => {
    const host = await open();

    expect(
      row(host, 'documents', 'rar_authorisation')?.querySelector('.stale'),
    ).toBeNull();
  });
});

describe('opening a page', () => {
  it('cuts the new tab off from the drawer before it navigates', async () => {
    const host = await open();

    press(row(host, 'documents', 'onrc_certificate'), 'Deschide pagina 1');
    await settle();

    expect(tab.location.href).toBe('https://store.test/signed');
    expect(tab.opener).toBeNull();
  });

  it('asks for a fresh address on every press', async () => {
    const host = await open();

    press(row(host, 'documents', 'onrc_certificate'), 'Deschide pagina 1');
    await settle();
    press(row(host, 'documents', 'onrc_certificate'), 'Deschide pagina 1');
    await settle();

    expect(documents.legalDocumentsControllerPageAddress).toHaveBeenCalledTimes(
      2,
    );
  });

  it('closes the blank tab when the address cannot be had', async () => {
    const host = await open();
    documents.legalDocumentsControllerPageAddress.mockRejectedValue(
      new HttpErrorResponse({ status: 404 }),
    );

    press(row(host, 'documents', 'onrc_certificate'), 'Deschide pagina 1');
    await settle();

    expect(tab.close).toHaveBeenCalled();
    expect(text(row(host, 'documents', 'onrc_certificate'))).toContain(
      'Nu am putut deschide documentul',
    );
    expect(text(row(host, 'documents', 'rar_authorisation'))).not.toContain(
      'Nu am putut deschide documentul',
    );
  });
});

describe('opening the file fails', () => {
  it.each([404, 403, 401, 0])(
    'shows the retry on a %i answer',
    async (status) => {
      const host = await open(async () => {
        throw new HttpErrorResponse({ status });
      });

      expect(text(host.querySelector('[role="alert"]'))).toContain(
        'Nu am putut deschide dosarul',
      );
      expect(buttons(host.querySelector('[role="alert"]'))).toContain(
        'Reîncearcă',
      );
      expect(section(host, 'manual')).toBeNull();
    },
  );

  it('shows the error in English', async () => {
    const host = await open(async () => {
      throw new HttpErrorResponse({ status: 500 });
    }, 'en');

    expect(text(host.querySelector('[role="alert"]'))).toContain(
      'Could not open the file',
    );
  });
});

describe('ticking', () => {
  it('sends one save for a tick pressed twice at once', async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockReturnValue(
      new Promise(() => undefined),
    );

    tick(host, 'address', true);
    tick(host, 'address', true);
    await settle();

    expect(api.verificationChecksControllerRecord).toHaveBeenCalledTimes(1);
  });

  it("sends the other check's save while one is in flight", async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockReturnValue(
      new Promise(() => undefined),
    );

    tick(host, 'address', true);
    tick(host, 'photos', true);
    await settle();

    expect(api.verificationChecksControllerRecord).toHaveBeenCalledTimes(2);
  });

  it.each([404, 409, 422, 500])(
    'reverts and toasts on an unrelated %i answer without turning read-only',
    async (status) => {
      const host = await open();
      api.verificationChecksControllerRecord.mockRejectedValue(
        new HttpErrorResponse({
          error: { code: 'something_else', status },
          status,
        }),
      );

      tick(host, 'photos', true);
      await settle();

      expect(box(host, 'photos').checked).toBe(false);
      expect(box(host, 'photos').disabled).toBe(false);
      expect(toast).toHaveBeenCalledWith('Nu am putut salva verificarea');
      expect(buttons(section(host, 'footer'))).toHaveLength(3);
    },
  );

  it('keeps a check ticked when the failed save was an untick', async () => {
    const host = await open(
      fileOf({
        checks: KINDS.map((kind) =>
          kind === 'address' ? check(kind, { result: 'ok' }) : check(kind),
        ),
      }),
    );
    api.verificationChecksControllerRecord.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    tick(host, 'address', false);
    await settle();

    expect(box(host, 'address').checked).toBe(true);
  });

  it('can tick again after a failure', async () => {
    const host = await open();
    api.verificationChecksControllerRecord.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 500 }),
    );
    api.verificationChecksControllerRecord.mockResolvedValueOnce(
      recorded('photos', 'ok'),
    );

    tick(host, 'photos', true);
    await settle();
    tick(host, 'photos', true);
    await settle();

    expect(box(host, 'photos').checked).toBe(true);
  });

  it('leaves the row unchanged when the problem task is cancelled', async () => {
    const host = await open();
    overlays.open.mockResolvedValue('cancelled');

    press(row(host, 'manual', 'photos'), 'Marchează o problemă');
    await settle();

    expect(box(host, 'photos').checked).toBe(false);
    expect(row(host, 'manual', 'photos')?.querySelector('mf-lamp')).toBeNull();
    expect(api.verificationChecksControllerRecord).not.toHaveBeenCalled();
  });

  it('keeps the documents tick disabled in English while a kind is missing', async () => {
    const host = await open(
      fileOf({
        documents: [
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
      'en',
    );

    expect(box(host, 'documents').disabled).toBe(true);
    expect(text(row(host, 'manual', 'documents'))).toContain(
      'A document is missing',
    );
  });
});

describe('the live re-read, hostile', () => {
  it('folds a burst of events for this file into one re-read', async () => {
    await open();

    for (let i = 0; i < 5; i++) {
      events.next({
        at: NOW.toISOString(),
        id: FILE,
        kind: 'verification.check_recorded',
      });
    }
    await later();
    await settle();

    expect(api.verificationFileControllerRead).toHaveBeenCalledTimes(1);
  });

  it('ignores kinds outside the four, even for this file', async () => {
    await open();

    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'job.created',
    } as LiveMessage);
    await later();
    await settle();

    expect(api.verificationFileControllerRead).not.toHaveBeenCalled();
  });

  it('ignores an event with no id', async () => {
    await open();

    events.next({
      at: NOW.toISOString(),
      kind: 'verification.decided',
    } as unknown as LiveMessage);
    await later();
    await settle();

    expect(api.verificationFileControllerRead).not.toHaveBeenCalled();
  });

  it('turns read-only when the re-read says another admin decided', async () => {
    let decided = false;
    const host = await open(async () =>
      decided
        ? fileOf({
            file: {
              decidedAt: NOW.toISOString(),
              decidedBy: { id: 'admin-2', name: 'Mihai' },
              status: 'rejected',
            },
          })
        : fileOf(),
    );
    decided = true;

    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.decided',
    });
    await later();
    await settle();

    expect(text(section(host, 'footer'))).toContain('Respins de Mihai');
    expect(box(host, 'address').disabled).toBe(true);
    expect(buttons(section(host, 'footer'))).toEqual([]);
  });

  it('keeps showing the file when a re-read fails', async () => {
    const host = await open();
    api.verificationFileControllerRead.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );

    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.opened',
    });
    await later();
    await settle();

    expect(text(host.querySelector('h3'))).toBe('Atelier Dinamo');
    expect(section(host, 'manual')).not.toBeNull();
  });

  it("shows another admin's tick after a re-read", async () => {
    let ticked = false;
    const host = await open(async () =>
      fileOf({
        checks: KINDS.map((kind) =>
          kind === 'photos' && ticked
            ? check(kind, { recorder: ioana, result: 'ok' })
            : check(kind),
        ),
      }),
    );
    ticked = true;

    events.next({
      at: NOW.toISOString(),
      id: FILE,
      kind: 'verification.check_recorded',
    });
    await later();
    await settle();

    expect(box(host, 'photos').checked).toBe(true);
  });
});

describe('the history, at its limits', () => {
  const entries = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      entry({
        field: 'status',
        id: `e-${i}`,
        kind: 'verification_opened',
        newValue: 'in_review',
        oldValue: 'submitted',
      }),
    );
  const historyOf = (n: number, total: number) =>
    fileOf({ timeline: { entries: entries(n), total } });
  const lines = (host: HTMLElement) =>
    section(host, 'history')?.querySelectorAll('li').length ?? 0;

  it('says nothing more when the total equals the 50 shown', async () => {
    const host = await open(historyOf(50, 50));

    expect(lines(host)).toBe(50);
    expect(text(section(host, 'history'))).not.toMatch(/și încă/);
  });

  it('says "și încă 1" when one entry is left out', async () => {
    const host = await open(historyOf(50, 51));

    expect(text(section(host, 'history'))).toContain('și încă 1');
  });

  it('says "and 70 more" in English', async () => {
    const host = await open(historyOf(50, 120), 'en');

    expect(text(section(host, 'history'))).toContain('and 70 more');
  });

  it('keeps the section when the timeline is empty and prints no "more"', async () => {
    const host = await open(historyOf(0, 0));

    expect(section(host, 'history')).not.toBeNull();
    expect(text(section(host, 'history'))).not.toMatch(/și încă/);
  });

  it('draws one line for an entry of a kind it does not know', async () => {
    const host = await open(
      fileOf({
        timeline: {
          entries: [
            entry({
              action: 'teleport' as unknown as 'update',
              field: 'x',
              kind: 'from_the_future',
            }),
          ],
          total: 1,
        },
      }),
    );

    expect(lines(host)).toBe(1);
    expect(text(section(host, 'history'))).not.toMatch(/undefined|\[object/);
  });
});
