import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, UrlSegment } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationQueueDto,
  type VerificationQueueRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { BehaviorSubject, filter, Subject } from 'rxjs';

import { AdminQueue } from './admin-queue';
import { Live } from '../live';

// @traces 068-FR-011
// @traces 068-FR-017

const row = (
  n: number,
  extra: Partial<VerificationQueueRowDto> = {},
): VerificationQueueRowDto => ({
  area: { kind: 'town', name: 'Cluj-Napoca' },
  brands: 2,
  documentId: `doc-${n}`,
  flagged: false,
  garageId: `garage-${n}`,
  garageName: `Service ${n}`,
  id: `file-${n}`,
  item: 'documents',
  lamp: 'amber',
  resubmitted: false,
  status: 'in_review',
  submittedAt: new Date().toISOString(),
  summary: { en: 'Yearly documents', ro: 'Documente anuale' },
  workingDays: 0,
  ...extra,
});

let events: Subject<LiveMessage>;
let reads: number;
let answer: () => Promise<VerificationQueueDto>;

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  language: 'ro' | 'en' = 'ro',
  providers: unknown[] = [],
): Promise<HTMLElement> {
  events = new Subject();
  reads = 0;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
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
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerQueue: () => {
            reads++;
            return answer();
          },
          verificationFileControllerRead: async () => ({
            file: { status: 'approved' },
          }),
        },
      },
      ...(providers as never[]),
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminQueue);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('li.row')];

beforeEach(() => {
  answer = async () => ({
    items: [row(1), row(2, { lamp: 'red' })],
    total: 2,
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('a yearly documents row in the queue', () => {
  it('names the kind of item beside the garage, with an amber lamp and its words', async () => {
    const el = await open();

    const [first] = rows(el);
    expect(text(first.querySelector('.name'))).toBe('Service 1');
    expect(text(first.querySelector('.tag'))).toBe('Documente anuale');
    const lamp = first.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('amber');
    expect(text(lamp)).toBe('documente noi de verificat');
  });

  it('names the kind once, as the tag beside the garage', async () => {
    const el = await open();

    const [first] = rows(el);
    expect(text(first)?.split('Documente anuale')).toHaveLength(2);
  });

  it('says in words why a red row is urgent', async () => {
    const el = await open();

    const red = rows(el)[1];
    expect(red.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'red',
    );
    expect(text(red.querySelector('mf-lamp'))).toBe(
      'urgent: peste termen sau suspendat',
    );
  });

  it('reads in English', async () => {
    const el = await open('en');

    const [amber, red] = rows(el);
    expect(text(amber.querySelector('.tag'))).toBe('Yearly documents');
    expect(text(amber.querySelector('mf-lamp'))).toBe(
      'new documents to review',
    );
    expect(text(red.querySelector('mf-lamp'))).toBe(
      'urgent: overdue or suspended',
    );
    expect(amber.querySelector('a.open')?.getAttribute('aria-label')).toBe(
      'Open the yearly documents of Service 1',
    );
  });

  it('opens the garage file at its Documente part, a verification row at its top', async () => {
    answer = async () => ({
      items: [row(1), row(2, { documentId: null, item: 'verification' })],
      total: 2,
    });
    const el = await open();

    const [documents, verification] = rows(el);
    expect(verification.querySelector('.documents')).toBeNull();
    expect(verification.querySelector('a.open')?.getAttribute('href')).toBe(
      '/app/admin/garages/file-2',
    );
    const link = documents.querySelector('a.open');
    expect(link?.getAttribute('href')).toBe(
      '/app/admin/garages/file-1#documents',
    );
    expect(link?.getAttribute('aria-label')).toBe(
      'Deschide documentele anuale Service 1',
    );
  });

  it.each([
    'document.uploaded',
    'document.accepted',
    'document.refused',
    'document.overdue',
  ] as const)('reads again on %s from the admin stream', async (kind) => {
    await open();
    expect(reads).toBe(1);

    events.next({ at: '2026-10-23T09:00:00.000Z', id: 'doc-9', kind });
    // The live reads wait a moment to fold a burst of messages into one.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(reads).toBe(2);
  });
});

describe('the file named with its Documente part', () => {
  it('opens the drawer asking for the Documente part', async () => {
    const overlays = { open: jest.fn(() => new Promise(() => undefined)) };
    await open('ro', [
      { provide: Overlays, useValue: overlays },
      {
        provide: ActivatedRoute,
        useValue: {
          fragment: new BehaviorSubject<string | null>('documents'),
          url: new BehaviorSubject([new UrlSegment('file-1', {})]),
        },
      },
    ]);

    expect(overlays.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: { fileId: 'file-1', part: 'documents' },
      }),
    );
  });
});
