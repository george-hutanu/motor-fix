import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationQueueDto,
  type VerificationQueueRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminQueue } from './admin-queue';
import { Live } from '../live';

const row = (
  n: number,
  extra: Partial<VerificationQueueRowDto> = {},
): VerificationQueueRowDto => ({
  area: { kind: 'town', name: 'București' },
  brands: 7,
  flagged: false,
  garageId: `garage-${n}`,
  garageName: `Service ${n}`,
  id: `file-${n}`,
  lamp: 'green',
  mechanics: 3,
  status: 'submitted',
  submittedAt: new Date().toISOString(),
  summary: {
    en: 'Company ID and RAR licence checked',
    ro: 'CUI și autorizație RAR verificate',
  },
  workingDays: 0,
  ...extra,
});

const queueOf = (count: number, total = count): VerificationQueueDto => ({
  items: Array.from({ length: count }, (_, i) => row(i + 1)),
  total,
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: { offset?: number; limit?: number }[];
let fileRead: jest.Mock;
let answer: (read: {
  offset?: number;
  limit?: number;
}) => Promise<VerificationQueueDto>;

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// The overview's queue, as the overview writes it.
@Component({
  imports: [AdminQueue],
  template: '<mf-admin-queue overview />',
})
class Overview {}

async function open(
  {
    overview = false,
    providers = [],
  }: { overview?: boolean; providers?: unknown[] } = {},
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  asked = [];
  fileRead = jest.fn(async () => ({ file: { status: 'in_review' } }));
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
          adminOverviewControllerQueue: (read: {
            offset?: number;
            limit?: number;
          }) => {
            asked.push(read);
            return answer(read);
          },
          verificationFileControllerRead: (read: { id: string }) =>
            fileRead(read),
        },
      },
      ...(providers as never[]),
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(overview ? Overview : AdminQueue);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('li.row')];
const _button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);
beforeEach(() => {
  answer = async ({ limit = 20 }) => queueOf(Math.min(limit, 4), 4);
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

const decided = (id: string): LiveMessage => ({
  at: '2026-10-18T09:00:00.000Z',
  id,
  kind: 'verification.decided',
});
const wait = async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await settle();
};
const names = (el: HTMLElement) =>
  rows(el).map((r) => text(r.querySelector('.name')));
const stateOf = (el: HTMLElement, name: string) =>
  text(
    rows(el)
      .find((r) => text(r.querySelector('.name')) === name)
      ?.querySelector('.state'),
  );
// The server's queue with the given files no longer waiting.
const waitingWithout = (...ids: string[]) => {
  const items = queueOf(4).items.filter((r) => !ids.includes(r.id));
  return { items, total: items.length };
};
async function approve(id: string, gone: string[]) {
  fileRead.mockResolvedValue({ file: { id, status: 'approved' } });
  answer = async () => waitingWithout(...gone);
  events.next(decided(id));
  await wait();
}

describe('approved queue rows, attacked', () => {
  // @traces 303-FR-008
  it('keeps two rows approved one after the other each in its own place', async () => {
    const el = await open();

    await approve('file-2', ['file-2']);
    await approve('file-3', ['file-2', 'file-3']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 2')).toBe('Aprobat, e pe hartă');
    expect(stateOf(el, 'Service 3')).toBe('Aprobat, e pe hartă');
  });

  // @traces 303-FR-008
  it('keeps the places when the later row is approved first', async () => {
    const el = await open();

    await approve('file-3', ['file-3']);
    await approve('file-2', ['file-2', 'file-3']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
  });

  // @traces 303-FR-008
  it('keeps the first and the last row where they stood', async () => {
    const el = await open();

    await approve('file-1', ['file-1']);
    await approve('file-4', ['file-1', 'file-4']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 1')).toBe('Aprobat, e pe hartă');
    expect(stateOf(el, 'Service 4')).toBe('Aprobat, e pe hartă');
  });

  // @traces 303-FR-008
  it('keeps one row when the same event arrives twice', async () => {
    const el = await open();
    fileRead.mockResolvedValue({ file: { id: 'file-2', status: 'approved' } });
    answer = async () => waitingWithout('file-2');

    events.next(decided('file-2'));
    events.next(decided('file-2'));
    await wait();

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
  });

  // @traces 303-FR-008
  it('lets the row drop when the file read fails, without breaking the queue', async () => {
    const el = await open();
    fileRead.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    answer = async () => waitingWithout('file-2');

    events.next(decided('file-2'));
    await wait();

    expect(names(el)).toEqual(['Service 1', 'Service 3', 'Service 4']);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 303-FR-008
  it('keeps the approved row on the overview panel too', async () => {
    const el = await open({ overview: true });

    await approve('file-2', ['file-2']);

    expect(stateOf(el, 'Service 2')).toBe('Aprobat, e pe hartă');
    expect(rows(el)[1]?.querySelector('a.open')?.getAttribute('href')).toBe(
      '/app/admin/garages/file-2',
    );
  });

  // @traces 303-FR-008
  it('keeps the approved row after a manual retry re-read and a resync', async () => {
    const el = await open();
    await approve('file-2', ['file-2']);

    resync.next();
    await wait();

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 2')).toBe('Aprobat, e pe hartă');
  });

  // @traces 303-FR-008
  it('gives the kept link an accessible name that includes the garage', async () => {
    const el = await open();

    await approve('file-2', ['file-2']);

    expect(
      rows(el)[1]?.querySelector('a.open')?.getAttribute('aria-label'),
    ).toContain('Service 2');
  });

  // @traces 303-FR-008
  it('shows a decided row with neither the lamp, the applied time nor the waiting line, even when flagged', async () => {
    answer = async () => ({
      items: [row(1, { flagged: true, lamp: 'red', workingDays: 3 })],
      total: 1,
    });
    const el = await open();

    fileRead.mockResolvedValue({ file: { id: 'file-1', status: 'approved' } });
    answer = async () => ({ items: [], total: 0 });
    events.next(decided('file-1'));
    await wait();

    const kept = rows(el)[0] as HTMLElement;
    expect(text(kept.querySelector('.state'))).toBe('Aprobat, e pe hartă');
    expect(kept.querySelector('mf-lamp')).toBeNull();
    expect(kept.querySelector('.waiting')).toBeNull();
    expect(kept.querySelector('.applied')).toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
  });

  // @traces 303-FR-008
  it('shows a hostile garage name as text on a decided row', async () => {
    answer = async () => ({
      items: [row(1, { garageName: '<img src=x onerror=alert(1)>' })],
      total: 1,
    });
    const el = await open();

    fileRead.mockResolvedValue({ file: { id: 'file-1', status: 'approved' } });
    answer = async () => ({ items: [], total: 0 });
    events.next(decided('file-1'));
    await wait();

    expect(el.querySelector('img')).toBeNull();
    expect(text(rows(el)[0]?.querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  // @traces 303-FR-008
  it('counts only the waiting files in the heading while a row is kept', async () => {
    const el = await open();

    await approve('file-1', ['file-1']);
    await approve('file-2', ['file-1', 'file-2']);

    expect(text(el.querySelector('h2'))).toBe('Service‑uri de verificat · 2');
    expect(rows(el)).toHaveLength(4);
  });
});
