import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageStaffReviewsPageDto,
  type MeDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { GarageReviewsPanel } from './garage-reviews-panel';
import { Live } from '../../live';
import type { ReplyData } from '../../reply-dialog/open-reply';
import { Session } from '../../session';
import {
  repliedReview,
  staffPage,
  staffReply,
  staffReview,
} from '../garage-reviews.testing';

const GARAGE = 'garage-1';
const SLUG = 'service-auto-militari';

const me = (role: 'owner' | 'receptionist' = 'owner') =>
  ({
    capabilities: ['garage.reviews'],
    garageAccess: [
      { features: {}, garageId: GARAGE, role, status: 'approved' },
    ],
    garageId: GARAGE,
  }) as unknown as MeDto;

@Component({
  imports: [GarageReviewsPanel],
  template: `<mf-garage-reviews-panel [limit]="limit" />`,
})
class Host {
  limit: number | undefined = undefined;
}

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;
let opened: jest.Mock;

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => staffReview({ id: `r-${i + 1}` }));

async function render({
  answer = async () => staffPage({ slug: SLUG }),
  language = 'ro',
  limit,
  role = 'owner',
}: {
  answer?: (query: {
    garageId: string;
    page: number;
  }) => Promise<GarageStaffReviewsPageDto>;
  language?: 'ro' | 'en';
  limit?: number;
  role?: 'owner' | 'receptionist';
} = {}) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(answer);
  opened = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Overlays, useValue: { open: opened } },
      {
        provide: ReviewsService,
        useValue: { garageReviewsControllerRead: read },
      },
      { provide: Session, useValue: { shown: signal(me(role)) } },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.limit = limit;
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { element, fixture, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const shown = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('article[mf-garage-review-row]'),
];
const _link = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLAnchorElement>(`a[data-${name}]`);
const button = (element: HTMLElement, label: string) =>
  [...element.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === label,
  );
const message = (kind: string): LiveMessage => ({
  at: '2026-10-25T12:00:00.000Z',
  id: 'r-9',
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => TestBed.resetTestingModule());

const replyButton = (row: HTMLElement | undefined) =>
  row?.querySelector<HTMLButtonElement>('button[data-reply-button]');
const replyText = (row: HTMLElement | undefined) =>
  text(row?.querySelector('[data-reply-text]'));
const dialogData = (call = 0) =>
  opened.mock.calls[call]?.[1]?.data as ReplyData | undefined;

async function press(
  settle: () => Promise<void>,
  element: HTMLElement,
  index = 0,
) {
  replyButton(shown(element)[index])?.click();
  await settle();
}

// @traces 1387-FR-003
describe('the panel holding a saved reply', () => {
  it('holds the replies of two different reviews at once', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(2), slug: SLUG }),
    });
    await settle();
    await press(settle, element, 0);
    await press(settle, element, 1);

    dialogData(0)?.saved(staffReply({ id: 'a', text: 'Primul' }));
    dialogData(1)?.saved(staffReply({ id: 'b', text: 'Al doilea' }));
    await settle();

    expect(replyText(shown(element)[0])).toBe('Primul');
    expect(replyText(shown(element)[1])).toBe('Al doilea');
  });

  it('shows the latest answer when the same review is saved twice', async () => {
    const { element, settle } = await render();
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Întâi' }));
    await settle();
    await press(settle, element);

    dialogData(1)?.saved(
      staffReply({ editedAt: '2026-10-25T11:00:00.000Z', text: 'Apoi' }),
    );
    await settle();

    const row = shown(element)[0];
    expect(replyText(row)).toBe('Apoi');
    expect(text(row?.querySelector('[data-reply-edited]'))).toBe(
      'Editat · 25 oct. 2026',
    );
  });

  it('opens the second press as the edit of the reply it holds', async () => {
    const { element, settle } = await render();
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Ținut' }));
    await settle();

    await press(settle, element);

    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened.mock.calls[1][1].title).toBe(
      'garage.reviews.reply.titleEdit',
    );
    expect(dialogData(1)?.review.reply?.text).toBe('Ținut');
  });

  it('leaves the other rows untouched when one row is answered', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(3), slug: SLUG }),
    });
    await settle();
    await press(settle, element, 1);

    dialogData(0)?.saved(staffReply({ text: 'Doar al doilea' }));
    await settle();

    expect(replyText(shown(element)[0])).toBe('');
    expect(replyText(shown(element)[1])).toBe('Doar al doilea');
    expect(replyText(shown(element)[2])).toBe('');
    expect(text(replyButton(shown(element)[0]))).toBe('Răspunde');
    expect(text(replyButton(shown(element)[2]))).toBe('Răspunde');
  });

  it('drops a held reply when the next read says the review has no reply any more', async () => {
    let items = [staffReview()];
    const { element, settle } = await render({
      answer: async () => staffPage({ items, slug: SLUG }),
    });
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Va dispărea' }));
    await settle();

    items = [staffReview({ canReply: false, reply: null })];
    events.next(message('review.decided'));
    await wait(350);
    await settle();

    const row = shown(element)[0];
    expect(replyText(row)).toBe('');
    expect(row?.querySelector('[data-reply]')).toBeNull();
    expect(replyButton(row)).toBeNull();
  });

  it('shows the state of a reply the next read reports, not the one it held', async () => {
    let items = [staffReview()];
    const { element, settle } = await render({
      answer: async () => staffPage({ items, slug: SLUG }),
    });
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Publicat' }));
    await settle();

    items = [repliedReview({}, { status: 'reported', text: 'Publicat' })];
    events.next(message('review.reported'));
    await wait(350);
    await settle();

    const row = shown(element)[0];
    expect(text(row?.querySelector('[data-reply-reported]'))).toBe(
      'Raportat · ascuns până decide un admin',
    );
    expect(replyButton(row)?.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the held reply when the next read fails', async () => {
    let fail = false;
    const { element, settle } = await render({
      answer: async () => {
        if (fail) throw new HttpErrorResponse({ status: 500 });
        return staffPage({ slug: SLUG });
      },
    });
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Rămâne' }));
    await settle();

    fail = true;
    events.next(message('review.replied'));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(replyText(shown(element)[0])).toBe('Rămâne');
  });

  it('keeps the held reply of the first page when only a later page is read', async () => {
    const first = Array.from({ length: 20 }, (_, i) =>
      staffReview({ id: `r-${i + 1}` }),
    );
    const { element, settle } = await render({
      answer: async ({ page }) =>
        page === 1
          ? staffPage({ items: first, slug: SLUG, total: 21 })
          : staffPage({
              items: [staffReview({ id: 'r-21' })],
              page: 2,
              slug: SLUG,
              total: 21,
            }),
    });
    await settle();
    await press(settle, element, 0);
    dialogData(0)?.saved(staffReply({ text: 'Pe prima' }));
    await settle();

    button(element, 'Vezi mai multe')?.click();
    await settle();

    expect(shown(element)).toHaveLength(21);
    expect(replyText(shown(element)[0])).toBe('Pe prima');
    expect(replyText(shown(element)[20])).toBe('');
  });

  it('drops the held reply of a later page row when the first page is read again', async () => {
    const first = Array.from({ length: 20 }, (_, i) =>
      staffReview({ id: `r-${i + 1}` }),
    );
    const { element, settle } = await render({
      answer: async ({ page }) =>
        page === 1
          ? staffPage({ items: first, slug: SLUG, total: 21 })
          : staffPage({
              items: [staffReview({ id: 'r-21' })],
              page: 2,
              slug: SLUG,
              total: 21,
            }),
    });
    await settle();
    button(element, 'Vezi mai multe')?.click();
    await settle();
    await press(settle, element, 20);
    dialogData(0)?.saved(staffReply({ text: 'Pe a doua' }));
    await settle();

    events.next(message('review.replied'));
    await wait(350);
    await settle();

    expect(shown(element)).toHaveLength(20);
    expect(element.textContent).not.toContain('Pe a doua');
  });

  it('drops the held reply on a resync as on any other read', async () => {
    let items = [staffReview()];
    const { element, settle } = await render({
      answer: async () => staffPage({ items, slug: SLUG }),
    });
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Ținut' }));
    await settle();

    items = [repliedReview({}, { text: 'Din citire' })];
    resync.next();
    await wait(350);
    await settle();

    expect(replyText(shown(element)[0])).toBe('Din citire');
  });

  it('does not let a held reply of one review show on a review that takes its place', async () => {
    let items = [staffReview({ id: 'r-1' })];
    const { element, settle } = await render({
      answer: async () => staffPage({ items, slug: SLUG }),
    });
    await settle();
    await press(settle, element);
    dialogData(0)?.saved(staffReply({ text: 'Al lui r-1' }));
    await settle();

    items = [staffReview({ id: 'r-new' }), staffReview({ id: 'r-1' })];
    events.next(message('review.posted'));
    await wait(350);
    await settle();

    expect(replyText(shown(element)[0])).toBe('');
    expect(shown(element)[0]?.dataset['liveId']).toBe('r-new');
  });

  it('shows the held reply in English with the English button and mark', async () => {
    const { element, settle } = await render({ language: 'en' });
    await settle();
    await press(settle, element);

    dialogData(0)?.saved(staffReply({ editedAt: '2026-10-25T11:00:00.000Z' }));
    await settle();

    const row = shown(element)[0];
    expect(text(replyButton(row))).toBe('Edit the reply');
    expect(text(row?.querySelector('[data-reply-edited]'))).toBe(
      'Edited · 25 Oct 2026',
    );
  });

  it('merges the held reply on the home panel limited to five rows', async () => {
    const { element, settle } = await render({
      answer: async () => staffPage({ items: rows(8), slug: SLUG }),
      limit: 5,
    });
    await settle();
    await press(settle, element, 4);

    dialogData(0)?.saved(staffReply({ text: 'Al cincilea' }));
    await settle();

    expect(shown(element)).toHaveLength(5);
    expect(replyText(shown(element)[4])).toBe('Al cincilea');
  });

  it('does not throw when the answer lands after the panel is gone', async () => {
    const { element, fixture, settle } = await render();
    await settle();
    await press(settle, element);
    const saved = dialogData(0)?.saved;

    fixture.destroy();

    expect(() => saved?.(staffReply())).not.toThrow();
  });

  it('opens no second dialog while the first is still open', async () => {
    let release: (v: 'cancelled') => void = () => undefined;
    const { element, settle } = await render();
    opened.mockImplementation(
      () => new Promise<'cancelled'>((resolve) => (release = resolve)),
    );
    await settle();

    await press(settle, element);
    await press(settle, element);
    release('cancelled');
    await settle();

    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('lets the owner press again when the dialog failed to load', async () => {
    const { element, settle } = await render();
    opened.mockRejectedValueOnce(new Error('chunk load failed'));
    await settle();

    await press(settle, element);
    await press(settle, element);

    expect(opened).toHaveBeenCalledTimes(2);
    expect(text(replyButton(shown(element)[0]))).toBe('Răspunde');
  });
});
