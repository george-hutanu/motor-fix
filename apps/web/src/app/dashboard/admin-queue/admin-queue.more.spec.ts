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

// @traces 304-FR-006
// @traces 304-FR-007

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
const heading = (el: HTMLElement) => text(el.querySelector('h2'));
const rowOf = (el: HTMLElement, name: string) =>
  rows(el).find((r) => text(r.querySelector('.name')) === name);

describe('a row asked for more details', () => {
  it('keeps its place in the list with "Cerute completări", the count one lower', async () => {
    const el = await open();

    await settleDecision('file-2', 'more_requested', ['file-2']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 2')).toBe('Cerute completări');
    expect(
      rowOf(el, 'Service 2')?.querySelector('.outcome.more_requested'),
    ).not.toBeNull();
    expect(rowOf(el, 'Service 2')?.querySelector('mf-lamp')).toBeNull();
    expect(rowOf(el, 'Service 2')?.querySelector('a.open')).not.toBeNull();
    expect(heading(el)).toContain('· 3');
  });

  it('keeps its place on the overview panel too, in English', async () => {
    const el = await open({ overview: true }, 'en');

    await settleDecision('file-3', 'more_requested', ['file-3']);

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(stateOf(el, 'Service 3')).toBe('More details requested');
    expect(heading(el)).toContain('· 3');
  });

  it('keeps a requested row beside a rejected one, each saying its own state', async () => {
    const el = await open();

    await settleDecision('file-2', 'more_requested', ['file-2']);
    await settleDecision('file-3', 'rejected', ['file-2', 'file-3']);

    expect(stateOf(el, 'Service 2')).toBe('Cerute completări');
    expect(stateOf(el, 'Service 3')).toBe('Respins');
  });

  it('shows one row per file when a re-read holds the requested file waiting again', async () => {
    const el = await open();
    await settleDecision('file-2', 'more_requested', ['file-2']);

    answer = async () => ({
      items: queueOf(4).items.map((r) =>
        r.id === 'file-2' ? { ...r, resubmitted: true } : r,
      ),
      total: 4,
    });
    events.next({ ...decided('file-2'), kind: 'verification.submitted' });
    await wait();

    expect(names(el)).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(rowOf(el, 'Service 2')?.querySelector('.outcome')).toBeNull();
    expect(rowOf(el, 'Service 2')?.querySelector('mf-lamp')).not.toBeNull();
    expect(heading(el)).toContain('· 4');
  });
});

describe('a file sent back by its garage', () => {
  it('tags a resubmitted row "Actualizat" after the name, and no other', async () => {
    answer = async () => ({
      items: [row(1), row(2, { resubmitted: true }), row(3)],
      total: 3,
    });
    const el = await open();

    const tag = rowOf(el, 'Service 2')?.querySelector('.tag');
    expect(text(tag)).toBe('Actualizat');
    expect(tag?.previousElementSibling?.classList.contains('name')).toBe(true);
    expect(el.querySelectorAll('.tag')).toHaveLength(1);
  });

  it('says "Updated" in English', async () => {
    answer = async () => ({
      items: [row(1, { resubmitted: true })],
      total: 1,
    });
    const el = await open({ overview: true }, 'en');

    expect(text(el.querySelector('.tag'))).toBe('Updated');
  });

  it('shows the tag and the higher count when the resend re-reads the queue', async () => {
    answer = async () => ({ items: [row(1), row(3)], total: 2 });
    const el = await open();
    expect(el.querySelector('.tag')).toBeNull();

    answer = async () => ({
      items: [row(1), row(2, { resubmitted: true }), row(3)],
      total: 3,
    });
    events.next({ ...decided('file-2'), kind: 'verification.submitted' });
    await wait();

    expect(text(rowOf(el, 'Service 2')?.querySelector('.tag'))).toBe(
      'Actualizat',
    );
    expect(heading(el)).toContain('· 3');
  });
});
