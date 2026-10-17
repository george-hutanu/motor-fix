import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type AdminGaragesSummaryDto,
  AdminService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminGarages } from './admin-garages';
import { Live } from '../live';

// @traces 066-FR-006 066-FR-008 066-FR-009

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let reads: number;
let summary: () => Promise<AdminGaragesSummaryDto>;

const failure = () => Promise.reject(new HttpErrorResponse({ status: 500 }));

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  resync = new Subject();
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
          resync,
        },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGarages: async () => ({ items: [], total: 0 }),
          adminOverviewControllerGaragesSummary: () => {
            reads++;
            return summary();
          },
          adminOverviewControllerQueue: async () => ({ items: [], total: 0 }),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminGarages);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const counts = (el: HTMLElement) => el.querySelector('.counts');
const message = (kind: EventKind): LiveMessage => ({
  at: '2026-10-15T09:00:00.000Z',
  id: 'any-garage',
  kind,
});

beforeEach(() => {
  summary = async () => ({ listed: 214, suspended: 2, waiting: 3 });
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('the counts line', () => {
  it('reads the three counts in Romanian', async () => {
    const el = await open();

    expect(text(counts(el))).toBe(
      '214 listate · 3 de verificat · 2 suspendate',
    );
  });

  it('uses the singular forms for one', async () => {
    summary = async () => ({ listed: 1, suspended: 1, waiting: 1 });
    const el = await open();

    expect(text(counts(el))).toBe('1 listat · 1 de verificat · 1 suspendat');
  });

  it('uses the "de" forms past 19, with the numbers grouped', async () => {
    summary = async () => ({ listed: 21, suspended: 21, waiting: 1250 });
    const el = await open();

    expect(text(counts(el))).toBe(
      '21 de listate · 1.250 de verificat · 21 de suspendate',
    );
  });

  it('reads them in English', async () => {
    summary = async () => ({ listed: 1250, suspended: 1, waiting: 3 });
    const el = await open('en');

    expect(text(counts(el))).toBe('1,250 listed · 3 to verify · 1 suspended');
  });

  it('shows a skeleton line while the counts load', async () => {
    summary = () => new Promise(() => {});
    const el = await open();

    expect(counts(el)?.getAttribute('aria-busy')).toBe('true');
    expect(counts(el)?.querySelector('.skeleton')).not.toBeNull();
  });

  it('shows a dash and the reason when the counts cannot be read, never 0', async () => {
    summary = failure;
    const el = await open();

    expect(text(counts(el))).toContain('—');
    expect(text(counts(el))).not.toMatch(/\d/);
    expect(
      counts(el)?.querySelector('button')?.getAttribute('aria-label'),
    ).toBe('Cifrele nu au putut fi citite');
  });

  it('gives the reason in English', async () => {
    summary = failure;
    const el = await open('en');

    expect(
      counts(el)?.querySelector('button')?.getAttribute('aria-label'),
    ).toBe('The figures could not be read');
  });

  it('shows the dash, not the last numbers, when a re-read fails', async () => {
    const el = await open();
    summary = failure;

    resync.next();
    await settle();

    expect(text(counts(el))).toContain('—');
    expect(text(counts(el))).not.toContain('214');
  });

  it('heads the view, before the queue and then the suspended garages', async () => {
    const el = await open();

    const order = [
      ...el.querySelectorAll('.counts, mf-admin-queue, mf-admin-suspended'),
    ].map((node) => node.tagName.toLowerCase());
    expect(order).toEqual(['p', 'mf-admin-queue', 'mf-admin-suspended']);
  });
});

describe('live', () => {
  it.each<EventKind>([
    'garage.suspended',
    'garage.restored',
    'verification.submitted',
    'verification.opened',
    'verification.check_recorded',
    'verification.decided',
    'verification.reopened',
  ])('reads the counts again on %s', async (kind) => {
    const el = await open();
    summary = async () => ({ listed: 213, suspended: 3, waiting: 3 });

    events.next(message(kind));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(reads).toBe(2);
    expect(text(counts(el))).toBe(
      '213 listate · 3 de verificat · 3 suspendate',
    );
  });

  it('reads the counts again when the connection comes back', async () => {
    await open();

    resync.next();
    await settle();

    expect(reads).toBe(2);
  });
});
