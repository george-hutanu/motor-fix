import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationChangeDto,
  type VerificationFileChangesDto,
} from '@motor-fix/data-access';
import { formatDay, formatLei, I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { VerificationChanges } from './verification-changes';
import { Live } from '../live';

// @traces 304-FR-009
// @traces 304-FR-013

const FILE = 'file-1';
const REQUESTED = '2026-10-03T09:00:00.000Z';

const change = (
  extra: Partial<VerificationChangeDto>,
): VerificationChangeDto => ({
  action: 'update',
  area: 'profile',
  at: '2026-10-05T09:00:00.000Z',
  field: null,
  kind: null,
  newValue: null,
  oldValue: null,
  subjectType: 'garage',
  ...extra,
});

const answerOf = (
  changes: VerificationChangeDto[],
  total = changes.length,
): VerificationFileChangesDto => ({
  changes,
  requestedAt: REQUESTED,
  resubmitted: true,
  total,
});

@Component({
  imports: [VerificationChanges],
  template:
    '<mf-verification-changes [fileId]="file" [photos]="photos()" [brands]="brands()" />',
})
class Host {
  readonly file = FILE;
  readonly photos = signal(3);
  readonly brands = signal(2);
}

let events: Subject<LiveMessage>;
let read: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  answer: () => Promise<VerificationFileChangesDto>,
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  read = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { verificationFileControllerChanges: read },
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
  const fixture = TestBed.createComponent(Host);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const panel = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-section="changes"]') as HTMLElement;
const lines = (host: HTMLElement, area: string) =>
  [...host.querySelectorAll(`[data-area="${area}"] li`)].map((li) => text(li));

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('the "Ce s-a schimbat" panel', () => {
  it('is a region named by its title, with the day of the request', async () => {
    const host = await open(async () => answerOf([]));

    const section = panel(host);
    const title = host.querySelector(
      `#${section.getAttribute('aria-labelledby')}`,
    );
    expect(text(title)).toBe('Ce s‑a schimbat');
    expect(text(section.querySelector('.since'))).toBe(
      `de la cererea din ${formatDay(REQUESTED, 'ro')}`,
    );
    expect(read).toHaveBeenCalledWith({ id: FILE });
  });

  it('says so when nothing changed since the request', async () => {
    const host = await open(async () => answerOf([]));

    expect(text(panel(host).querySelector('.empty'))).toBe(
      'Nicio modificare înregistrată de la cerere',
    );
    expect(panel(host).querySelectorAll('li')).toHaveLength(0);
  });

  it('groups the changes as profile, prices, brands, photos, documents', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          action: 'create',
          area: 'documents',
          kind: 'rar_authorisation',
          subjectType: 'legal_document',
        }),
        change({
          action: 'create',
          area: 'photos',
          subjectType: 'garage_photo',
        }),
        change({
          area: 'prices',
          field: 'from_bani',
          newValue: 25_000,
          oldValue: 20_000,
          subjectType: 'garage_price',
        }),
        change({
          action: 'create',
          area: 'brands',
          newValue: { stance: 'works_on' },
          subjectType: 'garage_brand',
        }),
        change({
          field: 'phone',
          newValue: '+40733000111',
          oldValue: '+40722111222',
        }),
      ]),
    );

    expect(
      [...panel(host).querySelectorAll('[data-area]')].map((g) =>
        g.getAttribute('data-area'),
      ),
    ).toEqual(['profile', 'prices', 'brands', 'photos', 'documents']);
    expect([...panel(host).querySelectorAll('h5')].map((h) => text(h))).toEqual(
      ['Profil', 'Prețuri', 'Mărci', 'Fotografii', 'Documente'],
    );
  });

  it('writes a profile field from its value before the request to its latest one', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          at: '2026-10-06T09:00:00.000Z',
          field: 'phone',
          newValue: '+40744000222',
          oldValue: '+40733000111',
        }),
        change({
          at: '2026-10-05T09:00:00.000Z',
          field: 'phone',
          newValue: '+40733000111',
          oldValue: '+40722111222',
        }),
      ]),
    );

    expect(lines(host, 'profile')).toEqual([
      'Telefonul: +40722111222 → +40744000222',
    ]);
  });

  it('writes money in lei and a yes or no for a tick', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          field: 'courtesy_car_price_per_day_bani',
          newValue: 20_000,
          oldValue: 15_000,
        }),
        change({ field: 'payment_card', newValue: true, oldValue: false }),
        change({
          area: 'prices',
          field: 'to_bani',
          newValue: 30_000,
          oldValue: null,
          subjectType: 'garage_price',
        }),
      ]),
    );

    expect(lines(host, 'profile')).toEqual([
      `Mașină de schimb, preț pe zi: ${formatLei(15_000, 'ro')} → ${formatLei(20_000, 'ro')}`,
      'Plată cu cardul: Nu → Da',
    ]);
    expect(lines(host, 'prices')).toEqual([
      `Preț până la: — → ${formatLei(30_000, 'ro')}`,
    ]);
  });

  it('says "modificat" for a value it cannot write, and names a field with no label by its stored name', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          field: 'location',
          newValue: { lat: 46.77, lng: 23.6 },
          oldValue: { lat: 46.7, lng: 23.5 },
        }),
        change({ field: 'hours', newValue: [{ day: 1 }], oldValue: [] }),
        change({ field: 'mystery_field', newValue: 'b', oldValue: 'a' }),
        change({
          action: 'create',
          newValue: { facility: 'wifi' },
          subjectType: 'garage_facility',
        }),
      ]),
    );

    expect(lines(host, 'profile')).toEqual([
      'Locația pe hartă: modificat',
      'Programul: modificat',
      'mystery_field: a → b',
      'Facilitățile: modificat',
    ]);
  });

  it('counts photos and brands back from the entries to the earlier number', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          action: 'create',
          area: 'photos',
          subjectType: 'garage_photo',
        }),
        change({
          action: 'create',
          area: 'photos',
          subjectType: 'garage_photo',
        }),
        change({
          action: 'delete',
          area: 'photos',
          subjectType: 'garage_photo',
        }),
        change({
          action: 'update',
          area: 'photos',
          field: 'position',
          newValue: 0,
          oldValue: 1,
          subjectType: 'garage_photo',
        }),
        change({
          action: 'create',
          area: 'brands',
          newValue: { stance: 'works_on' },
          subjectType: 'garage_brand',
        }),
        change({
          action: 'create',
          area: 'brands',
          newValue: { stance: 'refuses' },
          subjectType: 'garage_brand',
        }),
      ]),
    );

    expect(lines(host, 'photos')).toEqual(['Fotografii: 2 → 3']);
    expect(lines(host, 'brands')).toEqual(['Mărci: 1 → 2']);
  });

  it('says a counted kind changed when its number did not move', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          action: 'update',
          area: 'photos',
          field: 'position',
          newValue: 0,
          oldValue: 1,
          subjectType: 'garage_photo',
        }),
      ]),
    );

    expect(lines(host, 'photos')).toEqual(['Fotografii: modificat']);
  });

  it('writes each document kind as replaced, added or removed', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          action: 'create',
          area: 'documents',
          kind: 'rar_authorisation',
          subjectType: 'legal_document',
        }),
        change({
          action: 'delete',
          area: 'documents',
          kind: 'rar_authorisation',
          subjectType: 'legal_document',
        }),
        change({
          action: 'create',
          area: 'documents',
          kind: 'onrc_certificate',
          subjectType: 'legal_document',
        }),
      ]),
    );

    expect(lines(host, 'documents')).toEqual([
      'Autorizația RAR: înlocuit',
      'Certificatul ONRC: adăugat',
    ]);
  });

  it('writes a removed document as removed', async () => {
    const host = await open(async () =>
      answerOf([
        change({
          action: 'delete',
          area: 'documents',
          kind: 'onrc_certificate',
          subjectType: 'legal_document',
        }),
      ]),
    );

    expect(lines(host, 'documents')).toEqual(['Certificatul ONRC: șters']);
  });

  it('past 200 changes, ends with how many more and stops counting', async () => {
    const host = await open(async () =>
      answerOf(
        [
          change({
            action: 'create',
            area: 'photos',
            subjectType: 'garage_photo',
          }),
          change({
            field: 'phone',
            newValue: '+40733000111',
            oldValue: '+40722111222',
          }),
        ],
        205,
      ),
    );

    expect(lines(host, 'photos')).toEqual(['Fotografii: modificat']);
    expect(text(panel(host).querySelector('.more'))).toBe(
      'și încă 203 modificări',
    );
  });

  it('reads in English', async () => {
    const host = await open(
      async () =>
        answerOf([
          change({ field: 'payment_card', newValue: true, oldValue: false }),
          change({
            action: 'create',
            area: 'photos',
            subjectType: 'garage_photo',
          }),
        ]),
      'en',
    );

    expect(text(panel(host).querySelector('h4'))).toBe('What changed');
    expect(text(panel(host).querySelector('.since'))).toBe(
      `since the request of ${formatDay(REQUESTED, 'en')}`,
    );
    expect(lines(host, 'profile')).toEqual(['Card payment: No → Yes']);
    expect(lines(host, 'photos')).toEqual(['Photos: 2 → 3']);
  });

  it('reads "No change recorded since the request" in English', async () => {
    const host = await open(async () => answerOf([]), 'en');

    expect(text(panel(host).querySelector('.empty'))).toBe(
      'No change recorded since the request',
    );
  });

  it('shows a busy skeleton while the read is on its way', async () => {
    const host = await open(() => new Promise(() => undefined));

    const busy = panel(host).querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.getAttribute('aria-label')).toBe('Se încarcă modificările');
  });

  it('says it could not load the changes and reads them again on "Reîncearcă"', async () => {
    let fail = true;
    const host = await open(async () => {
      if (fail) throw new Error('offline');
      return answerOf([]);
    });

    const alert = panel(host).querySelector('[role="alert"]');
    expect(text(alert?.querySelector('p'))).toBe(
      'Nu am putut încărca modificările',
    );
    const retry = alert?.querySelector('button') as HTMLButtonElement;
    expect(text(retry)).toBe('Reîncearcă');

    fail = false;
    retry.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(panel(host).querySelector('[role="alert"]')).toBeNull();
    expect(text(panel(host).querySelector('.empty'))).toBe(
      'Nicio modificare înregistrată de la cerere',
    );
  });

  it('reads again when the garage sends this file back', async () => {
    const host = await open(async () => answerOf([]));
    read.mockImplementation(async () =>
      answerOf([
        change({
          field: 'phone',
          newValue: '+40733000111',
          oldValue: '+40722111222',
        }),
      ]),
    );

    events.next({
      at: '2026-10-07T09:00:00.000Z',
      id: FILE,
      kind: 'verification.submitted',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(lines(host, 'profile')).toEqual([
      'Telefonul: +40722111222 → +40733000111',
    ]);
  });

  it('ignores another file being sent back', async () => {
    await open(async () => answerOf([]));

    events.next({
      at: '2026-10-07T09:00:00.000Z',
      id: 'file-2',
      kind: 'verification.submitted',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });
});
