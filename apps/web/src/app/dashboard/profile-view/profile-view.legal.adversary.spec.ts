import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type DocumentCycleDto,
  type GarageProfileDto,
  GaragesService,
  type LegalCheckDto,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { ProfileView } from './profile-view';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'garage-1';
const I18N = join(__dirname, '../../../../../../libs/i18n/src/garage');

const profile = (): GarageProfileDto =>
  ({
    address: 'Str. Atelierului 14, Militari',
    brandNote: null,
    businessKind: 'company',
    courtesyCar: { paid: false },
    doesNotTake: [],
    facilities: [],
    hours: { fri: [], mon: [], sat: [], sun: [], thu: [], tue: [], wed: [] },
    id: GARAGE,
    jobTypes: [],
    name: 'Atelier Dinamo',
    paymentMethods: { card: true, cash: true, transfer: false },
    phone: '+40722123456',
    photos: [],
    prices: [],
    rating: null,
    refusalPhrase: null,
    responseRate: { state: 'new' },
    reviewCount: 0,
    slug: 'atelier-dinamo',
    verifiedAt: null,
    worksOn: [],
  }) as unknown as GarageProfileDto;

const cycle = (over: Partial<DocumentCycleDto> = {}): DocumentCycleDto => ({
  canUpload: true,
  dueOn: '2027-01-15',
  graceUntil: null,
  inReview: false,
  refusal: null,
  row: 'due',
  state: 'due',
  ...over,
});

const legal = (over: Partial<LegalCheckDto> = {}): LegalCheckDto => ({
  companyName: 'ATELIER DINAMO SRL',
  documents: cycle(),
  isMobile: false,
  lastCheckedOn: '2026-10-01',
  latestRecheck: null,
  rarActivities: [],
  rows: (['company', 'caen', 'rar', 'documents'] as const).map((kind) => ({
    checkedOn: '2026-10-01',
    detail: null,
    kind,
    missing: [],
    state: kind === 'documents' ? ('warning' as const) : ('ok' as const),
  })),
  status: 'approved',
  ...over,
});

const ME = {
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
} as unknown as MeDto;

const http = (status: number) =>
  new HttpErrorResponse({ status, statusText: String(status) });

let events: Subject<LiveMessage>;
let readProfile: jest.Mock;
let readLegal: jest.Mock;
let navigate: jest.Mock;

async function render(
  options: {
    profile?: () => Promise<GarageProfileDto>;
    legal?: () => Promise<LegalCheckDto>;
    language?: 'ro' | 'en';
  } = {},
) {
  events = new Subject();
  readProfile = jest.fn(options.profile ?? (async () => profile()));
  readLegal = jest.fn(options.legal ?? (async () => legal()));
  navigate = jest.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: {
          garageProfileControllerRead: readProfile,
          legalCheckControllerRead: readLegal,
        },
      },
      { provide: Session, useValue: { shown: signal(ME) } },
      { provide: Router, useValue: { navigateByUrl: navigate } },
      {
        provide: Live,
        useValue: {
          events,
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
  await i18n.enter('garage');
  await i18n.enter('public');
  if (options.language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(ProfileView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async (debounced = false) => {
    if (debounced) await new Promise((r) => setTimeout(r, 350));
    for (let i = 0; i < 5; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await settle();
  return { element, fixture, settle };
}

const text = (e: Element | null | undefined) =>
  (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const row = (el: HTMLElement, kind: string) =>
  el.querySelector<HTMLElement>(`[data-legal-row="${kind}"]`);
const emit = (kind: string, id = GARAGE) =>
  events.next({ at: '2026-10-24T09:00:00.000Z', id, kind });

afterEach(() => TestBed.resetTestingModule());

describe('legal panel on the profile view', () => {
  // @traces 136-FR-001
  it('puts the legal panel after the public profile section with the four rows in order', async () => {
    const { element } = await render();
    const publicPanel = element.querySelector(
      'section[aria-labelledby="mf-profile-public"]',
    );
    const legalPanel = element.querySelector(
      'section[aria-labelledby="legal-check-title"]',
    );
    expect(publicPanel).not.toBeNull();
    expect(legalPanel).not.toBeNull();
    expect(
      (publicPanel as Node).compareDocumentPosition(legalPanel as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
    expect(
      [...element.querySelectorAll('[data-legal-row]')].map((r) =>
        r.getAttribute('data-legal-row'),
      ),
    ).toEqual(['company', 'caen', 'rar', 'documents']);
    expect(readLegal).toHaveBeenCalledTimes(1);
  });

  // @traces 136-FR-002
  it('shows no suspended marker anywhere while the garage is approved', async () => {
    const { element } = await render();
    expect(element.querySelectorAll('[data-suspended]')).toHaveLength(0);
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Verificat');
  });

  // @traces 136-FR-002
  it('never renders an admin note that rides along in the answer', async () => {
    const { element } = await render({
      legal: async () =>
        ({
          ...legal(),
          adminNote: 'SECRET-INTERNAL-NOTE',
          rows: legal().rows.map((r) =>
            r.kind === 'company'
              ? { ...r, adminNote: 'SECRET-INTERNAL-NOTE', state: 'warning' }
              : r,
          ),
        }) as unknown as LegalCheckDto,
    });
    expect(row(element, 'company')?.getAttribute('data-lamp')).toBe('amber');
    expect(text(element)).not.toContain('SECRET-INTERNAL-NOTE');
  });

  // @traces 136-FR-002
  it('shows the mobile mechanic wording on the CAEN row', async () => {
    const { element } = await render({
      legal: async () => legal({ isMobile: true }),
    });
    expect(text(row(element, 'caen'))).toContain('la sediul social');
  });

  // @traces 136-FR-003
  it('reads the due day in Romanian on an amber documents row', async () => {
    const { element } = await render();
    const documents = row(element, 'documents');
    expect(documents?.getAttribute('data-lamp')).toBe('amber');
    expect(text(documents)).toContain(
      'certificat constatator și autorizație RAR · scadent pe 15 ian. 2027',
    );
  });

  // @traces 136-FR-003
  it('reads the due day in English', async () => {
    const { element } = await render({ language: 'en' });
    expect(text(row(element, 'documents'))).toContain(
      'company certificate and RAR authorisation · due on 15 Jan 2027',
    );
  });

  // @traces 136-FR-003
  it.each([
    ['2026-12-31', '31 dec. 2026'],
    ['2027-01-01', '1 ian. 2027'],
    ['2026-11-28', '28 nov. 2026'],
  ])(
    'keeps the calendar day %s unshifted by the time zone',
    async (dueOn, shown) => {
      const { element } = await render({
        legal: async () => legal({ documents: cycle({ dueOn }) }),
      });
      expect(text(row(element, 'documents'))).toContain(`scadent pe ${shown}`);
    },
  );

  // @traces 136-FR-003
  it('keeps the month wording on a valid cycle', async () => {
    const { element } = await render({
      legal: async () =>
        legal({
          documents: cycle({ row: 'valid', state: 'due' }),
          rows: legal().rows.map((r) =>
            r.kind === 'documents' ? { ...r, state: 'ok' as const } : r,
          ),
        }),
    });
    const documents = row(element, 'documents');
    expect(documents?.getAttribute('data-lamp')).toBe('green');
    expect(text(documents)).toContain('de reîncărcat o dată pe an, până în');
    expect(text(documents)).not.toContain('scadent pe');
  });

  // @traces 136-FR-003
  it('lets under review win over due', async () => {
    const { element } = await render({
      legal: async () =>
        legal({
          documents: cycle({ inReview: true, row: 'in_review' }),
        }),
    });
    expect(text(row(element, 'documents'))).toContain('în verificare');
    expect(text(row(element, 'documents'))).not.toContain('scadent pe');
  });

  // @traces 136-FR-003
  it('escapes markup in a refusal note', async () => {
    const { element } = await render({
      legal: async () =>
        legal({
          documents: cycle({
            refusal: {
              decidedAt: '2026-10-20T09:00:00.000Z',
              kind: 'onrc_certificate',
              note: '<img src=x onerror=alert(1)>',
              reason: 'unreadable',
            } as unknown as DocumentCycleDto['refusal'],
            row: 'refused',
          }),
          rows: legal().rows.map((r) =>
            r.kind === 'documents' ? { ...r, state: 'failed' as const } : r,
          ),
        }),
    });
    expect(element.querySelector('img')).toBeNull();
    expect(text(row(element, 'documents'))).toContain(
      'refuzat: <img src=x onerror=alert(1)>',
    );
  });

  // @traces 136-FR-003
  it('reads a garage without a yearly cycle without a deadline', async () => {
    const { element } = await render({
      legal: async () => legal({ documents: null }),
    });
    const documents = text(row(element, 'documents'));
    expect(documents).toContain('certificat constatator și autorizație RAR');
    expect(documents).not.toContain('scadent');
    expect(documents).not.toContain('undefined');
    expect(documents).not.toContain('Invalid');
  });
});

describe('legal panel and the profile read', () => {
  // @traces 136-FR-005
  it('shows the suspended line and the Suspendat panel on a 410', async () => {
    const { element } = await render({
      legal: async () => legal({ status: 'suspended' }),
      profile: async () => {
        throw http(410);
      },
    });
    expect(
      element.querySelector('section[aria-labelledby="mf-profile-public"]'),
    ).toBeNull();
    expect(text(element.querySelector('p[data-suspended]'))).toBe(
      'Profilul nu apare pe hartă cât timp service‑ul este suspendat.',
    );
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Suspendat');
    expect(element.querySelectorAll('[data-legal-row]')).toHaveLength(4);
    expect(navigate).not.toHaveBeenCalled();
  });

  // @traces 136-FR-005
  it.each([403, 404])(
    'never reads or renders the legal panel on a profile %s',
    async (status) => {
      const { element } = await render({
        profile: async () => {
          throw http(status);
        },
      });
      expect(readLegal).not.toHaveBeenCalled();
      expect(element.querySelector('mf-garage-legal-check')).toBeNull();
      expect(element.querySelector('[data-legal-skeleton]')).toBeNull();
      expect(element.querySelector('#legal-check-title')).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/app/garage');
    },
  );

  // @traces 136-FR-005
  it('does not read the legal check while the profile read is pending', async () => {
    let release: (g: GarageProfileDto) => void = () => undefined;
    const { element, settle } = await render({
      profile: () => new Promise((r) => (release = r)),
    });
    expect(readLegal).not.toHaveBeenCalled();
    expect(element.querySelector('#legal-check-title')).toBeNull();
    release(profile());
    await settle();
    expect(readLegal).toHaveBeenCalledTimes(1);
    expect(element.querySelector('#legal-check-title')).not.toBeNull();
  });

  // @traces 136-FR-005
  it('hides only the legal panel when its own read answers 404', async () => {
    const { element } = await render({
      legal: async () => {
        throw http(404);
      },
    });
    expect(
      element.querySelector('section[aria-labelledby="mf-profile-public"]'),
    ).not.toBeNull();
    expect(element.querySelector('#legal-check-title')).toBeNull();
    expect(element.querySelector('[data-error]')).toBeNull();
  });

  // @traces 136-FR-005
  it('hides the legal panel on a 404 while the garage is suspended', async () => {
    const { element } = await render({
      legal: async () => {
        throw http(404);
      },
      profile: async () => {
        throw http(410);
      },
    });
    expect(element.querySelector('p[data-suspended]')).not.toBeNull();
    expect(element.querySelector('#legal-check-title')).toBeNull();
  });

  // @traces 136-FR-001
  it('shows the legal error with retry while the public profile stands, and retry reads again', async () => {
    let calls = 0;
    const { element, settle } = await render({
      legal: async () => {
        calls++;
        if (calls === 1) throw http(500);
        return legal();
      },
    });
    expect(
      element.querySelector('section[aria-labelledby="mf-profile-public"]'),
    ).not.toBeNull();
    expect(element.querySelector('[data-error]')).toBeNull();
    expect(
      text(element.querySelector('#legal-check-title ~ * .error, .error')),
    ).toContain('Nu am putut încărca verificarea');
    const retry = [...element.querySelectorAll('button')].find((b) =>
      text(b).includes('Încearcă din nou'),
    );
    expect(retry).toBeDefined();
    retry?.click();
    await settle();
    expect(readLegal).toHaveBeenCalledTimes(2);
    expect(element.querySelectorAll('[data-legal-row]')).toHaveLength(4);
  });

  // @traces 136-FR-009
  it('keeps the legal panel standing when only the public profile read fails', async () => {
    const { element } = await render({
      profile: async () => {
        throw http(500);
      },
    });
    expect(element.querySelector('[data-error]')).not.toBeNull();
    expect(element.querySelectorAll('[data-legal-row]')).toHaveLength(4);
  });
});

describe('legal panel live', () => {
  // @traces 136-FR-004
  it('reads again on document.due and turns the row amber without a reload', async () => {
    let state: 'valid' | 'due' = 'valid';
    const { element, settle } = await render({
      legal: async () =>
        state === 'valid'
          ? legal({
              documents: cycle({ row: 'valid', state: 'due' }),
              rows: legal().rows.map((r) =>
                r.kind === 'documents' ? { ...r, state: 'ok' as const } : r,
              ),
            })
          : legal(),
    });
    expect(row(element, 'documents')?.getAttribute('data-lamp')).toBe('green');
    state = 'due';
    emit('document.due');
    await settle(true);
    expect(readLegal).toHaveBeenCalledTimes(2);
    expect(row(element, 'documents')?.getAttribute('data-lamp')).toBe('amber');
    expect(text(row(element, 'documents'))).toContain(
      'scadent pe 15 ian. 2027',
    );
  });

  // @traces 136-FR-004
  it.each([
    'verification.decided',
    'verification.check_recorded',
    'verification.reopened',
    'recheck.recorded',
    'garage.suspended',
    'garage.restored',
    'document.uploaded',
    'document.due',
    'document.overdue',
    'document.accepted',
    'document.refused',
  ])('reads the legal check again on %s', async (kind) => {
    const { settle } = await render();
    const before = readLegal.mock.calls.length;
    emit(kind);
    await settle(true);
    expect(readLegal.mock.calls.length).toBe(before + 1);
  });

  // @traces 136-FR-004
  it('ignores a kind the panel does not listen to', async () => {
    const { settle } = await render();
    emit('request.created');
    await settle(true);
    expect(readLegal).toHaveBeenCalledTimes(1);
  });

  // @traces 136-FR-004
  it('shows the last answer when a change arrives during a read', async () => {
    const releases: ((d: LegalCheckDto) => void)[] = [];
    let first = true;
    const { element, settle } = await render({
      legal: () => {
        if (first) {
          first = false;
          return Promise.resolve(legal());
        }
        return new Promise((r) => releases.push(r));
      },
    });
    emit('document.due', 'a');
    await settle(true);
    emit('document.overdue', 'b');
    await settle(true);
    expect(releases).toHaveLength(1);
    releases[0]?.(legal({ documents: cycle({ dueOn: '2027-02-02' }) }));
    await settle(true);
    expect(releases).toHaveLength(2);
    releases[1]?.(legal({ documents: cycle({ dueOn: '2027-03-03' }) }));
    await settle();
    expect(text(row(element, 'documents'))).toContain(
      'scadent pe 3 mart. 2027',
    );
  });

  // @traces 136-FR-004
  it('keeps the old rows when a re-read fails and has no extra skeleton flash', async () => {
    let n = 0;
    const { element, settle } = await render({
      legal: async () => {
        n++;
        if (n === 2) throw http(500);
        return legal();
      },
    });
    emit('document.due');
    await settle(true);
    expect(element.querySelector('[data-legal-skeleton]')).toBeNull();
    expect(
      element.querySelectorAll('[data-legal-row]').length +
        element.querySelectorAll('.error').length,
    ).toBeGreaterThan(0);
  });

  // @traces 136-FR-004
  it('marks the swap silent for assistive technology', async () => {
    const { element, settle } = await render();
    emit('document.due');
    await settle(true);
    expect(element.querySelector('[aria-live]')).toBeNull();
    expect(element.querySelector('[role="status"]')).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 136-FR-005
  it('shows the approved state in both panels after a restore while open', async () => {
    let suspended = true;
    const { element, settle } = await render({
      legal: async () =>
        legal({ status: suspended ? 'suspended' : 'approved' }),
      profile: async () => {
        if (suspended) throw http(410);
        return profile();
      },
    });
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Suspendat');
    suspended = false;
    emit('garage.restored', GARAGE);
    await settle(true);
    expect(element.querySelector('p[data-suspended]')).toBeNull();
    expect(element.querySelectorAll('[data-suspended]')).toHaveLength(0);
    expect(
      element.querySelector('section[aria-labelledby="mf-profile-public"]'),
    ).not.toBeNull();
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Verificat');
  });

  // @traces 136-FR-005
  it('shows both panels turning suspended when garage.suspended arrives', async () => {
    let suspended = false;
    const { element, settle } = await render({
      legal: async () =>
        legal({ status: suspended ? 'suspended' : 'approved' }),
      profile: async () => {
        if (suspended) throw http(410);
        return profile();
      },
    });
    suspended = true;
    emit('garage.suspended', GARAGE);
    await settle(true);
    expect(element.querySelector('p[data-suspended]')).not.toBeNull();
    expect(text(element.querySelector('[data-legal-tag]'))).toBe('Suspendat');
    expect(element.querySelectorAll('[data-legal-row]')).toHaveLength(4);
  });

  // @traces 136-FR-004
  it('survives a burst of one hundred changes with a bounded number of reads', async () => {
    const { settle } = await render();
    for (let i = 0; i < 100; i++) emit('document.due', `b${i}`);
    await settle(true);
    expect(readLegal.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('legal panel text', () => {
  // @traces 136-FR-007
  it('has the due text in both languages with comma-below diacritics only', () => {
    const ro = JSON.parse(readFileSync(join(I18N, 'ro.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(I18N, 'en.json'), 'utf8'));
    expect(ro.legal.documents.cycle.due).toBe('scadent pe {day}');
    expect(en.legal.documents.cycle.due).toBe('due on {day}');
    expect(JSON.stringify(ro)).not.toMatch(/[ŞşŢţ]/);
  });
});
