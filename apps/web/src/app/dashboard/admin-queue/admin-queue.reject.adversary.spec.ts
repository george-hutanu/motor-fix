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

// @traces 305-FR-006

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
  resubmitted: false,
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
async function settleDecision(id: string, status: string, gone: string[]) {
  fileRead.mockResolvedValue({ file: { id, status } });
  answer = async () => waitingWithout(...gone);
  events.next(decided(id));
  await wait();
}

describe('rejected queue rows, attacked', () => {
  it('keeps a rejected and an approved row side by side, each saying its own state', async () => {
    const el = await open();

    await settleDecision('file-2', 'rejected', ['file-2']);
    await settleDecision('file-3', 'approved', ['file-2', 'file-3']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 2')).toBe('Respins');
    expect(stateOf(el, 'Service 3')).toBe('Aprobat, e pe hartă');
  });

  it('keeps a rejected row beside a requested one, in place', async () => {
    const el = await open();

    await settleDecision('file-2', 'more_requested', ['file-2']);
    await settleDecision('file-3', 'rejected', ['file-2', 'file-3']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 3')).toBe('Respins');
  });

  it('keeps the first and the last rejected rows where they stood', async () => {
    const el = await open();

    await settleDecision('file-1', 'rejected', ['file-1']);
    await settleDecision('file-4', 'rejected', ['file-1', 'file-4']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 1')).toBe('Respins');
    expect(stateOf(el, 'Service 4')).toBe('Respins');
  });

  it('keeps one row when the same rejection arrives twice', async () => {
    const el = await open();
    fileRead.mockResolvedValue({ file: { id: 'file-2', status: 'rejected' } });
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

  it('keeps the rejected row on the overview panel with its link', async () => {
    const el = await open({ overview: true });

    await settleDecision('file-2', 'rejected', ['file-2']);

    expect(stateOf(el, 'Service 2')).toBe('Respins');
    expect(rows(el)[1]?.querySelector('a.open')?.getAttribute('href')).toBe(
      '/app/admin/garages/file-2',
    );
  });

  it('keeps the rejected row through a resync', async () => {
    const el = await open();
    await settleDecision('file-2', 'rejected', ['file-2']);

    resync.next();
    await wait();

    expect(names(el)).toContain('Service 2');
    expect(stateOf(el, 'Service 2')).toBe('Respins');
  });

  it('lets the row drop when the file read fails, without an alert', async () => {
    const el = await open();
    fileRead.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    answer = async () => waitingWithout('file-2');

    events.next(decided('file-2'));
    await wait();

    expect(names(el)).toEqual(['Service 1', 'Service 3', 'Service 4']);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it.each(['REJECTED', 'rejected ', '', 'approvedx'])(
    'drops the row when the file reads as %j',
    async (status) => {
      const el = await open();

      await settleDecision('file-2', status, ['file-2']);

      expect(names(el)).toEqual(['Service 1', 'Service 3', 'Service 4']);
    },
  );

  it('drops the row when the read answers with no file at all', async () => {
    const el = await open();
    fileRead.mockResolvedValue({});
    answer = async () => waitingWithout('file-2');

    events.next(decided('file-2'));
    await wait();

    expect(names(el)).toEqual(['Service 1', 'Service 3', 'Service 4']);
  });

  it('shows "Rejected" in English with no lamp, applied time or waiting line, even flagged', async () => {
    answer = async () => ({
      items: [row(1, { flagged: true, lamp: 'red', workingDays: 3 })],
      total: 1,
    });
    const el = await open({}, 'en');

    fileRead.mockResolvedValue({ file: { id: 'file-1', status: 'rejected' } });
    answer = async () => ({ items: [], total: 0 });
    events.next(decided('file-1'));
    await wait();

    const kept = rows(el)[0] as HTMLElement;
    expect(text(kept.querySelector('.state'))).toBe('Rejected');
    expect(kept.querySelector('mf-lamp')).toBeNull();
    expect(kept.querySelector('.waiting')).toBeNull();
    expect(kept.querySelector('.applied')).toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
  });

  it('shows a hostile garage name as text on a rejected row', async () => {
    answer = async () => ({
      items: [row(1, { garageName: '<img src=x onerror=alert(1)>' })],
      total: 1,
    });
    const el = await open();

    await settleDecision('file-1', 'rejected', ['file-1']);

    expect(el.querySelector('img')).toBeNull();
    expect(text(rows(el)[0]?.querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('counts only the waiting files in the heading while rejected rows are kept', async () => {
    const el = await open();

    await settleDecision('file-1', 'rejected', ['file-1']);
    await settleDecision('file-2', 'rejected', ['file-1', 'file-2']);

    expect(text(el.querySelector('h2'))).toBe('Service‑uri de verificat · 2');
    expect(rows(el)).toHaveLength(4);
  });

  it('gives the kept rejected link an accessible name that includes the garage', async () => {
    const el = await open();

    await settleDecision('file-2', 'rejected', ['file-2']);

    expect(
      rows(el)[1]?.querySelector('a.open')?.getAttribute('aria-label'),
    ).toContain('Service 2');
  });

  it('reads nothing for a rejection of a file it does not show', async () => {
    await open();

    events.next(decided('file-99'));
    await wait();

    expect(fileRead).not.toHaveBeenCalled();
  });
});
