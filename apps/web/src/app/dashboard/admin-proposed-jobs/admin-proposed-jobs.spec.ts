import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type AdminCatalogueJobDto,
  type AdminCatalogueJobsDto,
  AdminService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { AdminProposedJobs } from './admin-proposed-jobs';
import { Live } from '../live';
import { ProposedJobApprove } from '../proposed-job-approve/proposed-job-approve';
import { ProposedJobReject } from '../proposed-job-reject/proposed-job-reject';

// @traces 414-FR-011

const RAR = [{ code: 'mechanics', nameEn: 'mechanics', nameRo: 'mecanică' }];

const job = (
  over: Partial<AdminCatalogueJobDto> = {},
): AdminCatalogueJobDto => ({
  durationMinutes: 90,
  fromBani: 18_000,
  garage: { id: 'g-1', name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
  id: 'job-1',
  name: 'Recondiționare injectoare',
  proposedAt: '2026-10-20T09:00:00.000Z',
  toBani: 42_000,
  ...over,
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;
let open: jest.Mock;

async function render(
  answer: () => Promise<AdminCatalogueJobsDto> = async () => ({
    items: [job()],
    rarActivities: RAR,
  }),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { jobDecisionsControllerQueue: read },
      },
      { provide: Overlays, useValue: { open } },
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
  const fixture = TestBed.createComponent(AdminProposedJobs);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  await settle();
  return { element, settle };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLElement>('[data-row]'),
];
const cell = (row: HTMLElement, name: string) =>
  text(row.querySelector(`[data-${name}]`));
const buttons = (row: HTMLElement) =>
  [...row.querySelectorAll('button')].map(text);
// A burst of live events is one re-read, 300 ms after the last.
const debounce = () => new Promise((r) => setTimeout(r, 350));
const message = (kind: EventKind): LiveMessage => ({
  at: '2026-10-20T09:00:00.000Z',
  id: 'job-9',
  kind,
});

afterEach(() => TestBed.resetTestingModule());

describe('Lucrări propuse: the jobs garages proposed', () => {
  it('shows the shared skeleton while the first read is on its way', async () => {
    const { element } = await render(() => new Promise(() => undefined));

    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(element.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    expect(rows(element)).toEqual([]);
  });

  it('shows a row per job with the text as typed, the garage, the interval, the day and two buttons', async () => {
    const { element } = await render(async () => ({
      items: [
        job(),
        job({
          durationMinutes: undefined,
          garage: undefined,
          id: 'job-2',
          name: 'Chestii motor',
          proposedAt: '2026-10-21T09:00:00.000Z',
          toBani: undefined,
        }),
      ],
      rarActivities: RAR,
    }));

    expect(read).toHaveBeenCalledTimes(1);
    const shown = rows(element);
    expect(shown.map((row) => cell(row, 'job'))).toEqual([
      'Recondiționare injectoare',
      'Chestii motor',
    ]);
    expect(shown.map((row) => cell(row, 'garage'))).toEqual([
      'Atelier Dinamo',
      '—',
    ]);
    expect(shown.map((row) => cell(row, 'interval'))).toEqual([
      '180 – 420 lei · 90 min',
      '180 lei',
    ]);
    expect(cell(shown[0], 'day')).toBe('20 oct. 2026');
    expect(buttons(shown[0])).toEqual(['Aprobă', 'Respinge']);
    expect(
      shown[0].querySelector('button')?.getAttribute('aria-label'),
    ).toContain('Recondiționare injectoare');
  });

  it('says what the list holds under the header', async () => {
    const { element } = await render();

    expect(text(element.querySelector('.line'))).toBe(
      'Lucrări adăugate de service‑uri care așteaptă aprobarea',
    );
  });

  it('names its columns in a table header', async () => {
    const { element } = await render();

    expect([...element.querySelectorAll('th')].map((th) => text(th))).toEqual([
      'Lucrare',
      'Service',
      'Interval',
      'Propusă',
      'Decizie',
    ]);
  });

  it('speaks English in English', async () => {
    const { element } = await render(undefined, 'en');

    const [row] = rows(element);
    expect(cell(row, 'day')).toBe('20 Oct 2026');
    expect(buttons(row)).toEqual(['Approve', 'Reject']);
    expect([...element.querySelectorAll('th')].map((th) => text(th))).toEqual([
      'Job',
      'Garage',
      'Range',
      'Proposed',
      'Decision',
    ]);
  });

  it('says so when nothing waits', async () => {
    const { element } = await render(async () => ({
      items: [],
      rarActivities: RAR,
    }));

    expect(text(element.querySelector('.empty'))).toBe(
      'Nicio lucrare în așteptare.',
    );
  });

  it('shows the shared error line with "Reîncearcă" when the read fails, and reads again on it', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw new Error('down');
      return { items: [job()], rarActivities: RAR };
    });

    const alert = element.querySelector('.failed[role="alert"]');
    expect(alert).not.toBeNull();
    fail = false;
    const retry = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Reîncearcă',
    );
    retry?.click();
    await settle();

    expect(rows(element)).toHaveLength(1);
  });

  it('reads again when a job is proposed or decided, and keeps its rows when that read fails', async () => {
    let fail = false;
    const { element, settle } = await render(async () => {
      if (fail) throw new Error('down');
      return { items: [job()], rarActivities: RAR };
    });

    events.next(message('catalogue_job.proposed'));
    await debounce();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);

    fail = true;
    events.next(message('catalogue_job.decided'));
    await debounce();
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(rows(element)).toHaveLength(1);
    expect(element.querySelector('.failed[role="alert"]')).not.toBeNull();
  });

  it('opens the approve dialog with the job and the RAR activities, and drops the row once approved', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce({ id: 'job-1', status: 'approved' });

    rows(element)[0].querySelector('button')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(
      ProposedJobApprove,
      expect.objectContaining({
        data: { job: job(), rarActivities: RAR },
        shape: 'dialog',
        title: 'admin.proposedJobs.approve.title',
        titleParams: { name: 'Recondiționare injectoare' },
      }),
    );
    expect(rows(element)).toEqual([]);
  });

  it('opens the reject dialog and drops the row once rejected', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce({ id: 'job-1', status: 'rejected' });

    rows(element)[0].querySelectorAll('button')[1]?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(
      ProposedJobReject,
      expect.objectContaining({
        data: { job: job() },
        shape: 'dialog',
        title: 'admin.proposedJobs.reject.title',
        titleParams: { name: 'Recondiționare injectoare' },
      }),
    );
    expect(rows(element)).toEqual([]);
  });

  it('keeps the row when the dialog is cancelled, and reads again when another admin decided first', async () => {
    const { element, settle } = await render();

    rows(element)[0].querySelector('button')?.click();
    await settle();
    expect(rows(element)).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);

    open.mockResolvedValueOnce('decided');
    rows(element)[0].querySelector('button')?.click();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('stacks each row in one column below 768 px, the buttons last', () => {
    const css = readFileSync(
      join(__dirname, 'admin-proposed-jobs.css'),
      'utf8',
    );

    expect(css).toMatch(/@media \(max-width: 767px\)/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it("keeps the header's gutter at both sides, so the line and the panel start under the title", () => {
    const css = readFileSync(
      join(__dirname, 'admin-proposed-jobs.css'),
      'utf8',
    );

    expect(css).toMatch(/^:host \{[^}]*margin-inline: var\(--mf-space-4\);/m);
  });

  it('breaks a job or garage name only between words while a whole word fits, so the table never splits one mid-word', () => {
    const css = readFileSync(
      join(__dirname, 'admin-proposed-jobs.css'),
      'utf8',
    );

    expect(css).toMatch(/^\.job \{[^}]*overflow-wrap: break-word;/m);
    expect(css).toMatch(/^\.meta \{[^}]*overflow-wrap: break-word;/m);
    expect(css).not.toMatch(/^\.(job|meta) \{[^}]*overflow-wrap: anywhere;/m);
  });

  it('stacks the two buttons in the Decision cell from 768 px, so the five columns fit a tablet without sideways scroll', () => {
    const css = readFileSync(
      join(__dirname, 'admin-proposed-jobs.css'),
      'utf8',
    );

    expect(css).not.toMatch(/white-space: nowrap;\s*text-align: end;/);
    expect(css).toMatch(
      /^\.decide button \{[^}]*display: flex;[^}]*width: 100%;/m,
    );
    expect(css).toMatch(/^\.decide button \+ button \{[^}]*margin-top:/m);
  });

  it('lets the buttons wrap on a phone instead of squeezing a label past its box', () => {
    const css = readFileSync(
      join(__dirname, 'admin-proposed-jobs.css'),
      'utf8',
    );
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'));

    expect(phone).toMatch(
      /\.decide \{[^}]*display: flex;[^}]*flex-wrap: wrap;/,
    );
    expect(phone).toMatch(/\.decide button \{[^}]*flex: 1 1 auto;/);
  });
});
