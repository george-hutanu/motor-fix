import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageReviewRow } from './garage-review-row';
import {
  NOW,
  repliedReview,
  staffReply,
  staffReview,
} from '../garage-reviews.testing';

@Component({
  imports: [GarageReviewRow],
  template: `
    @for (r of reviews(); track r.id) {
      <article mf-garage-review-row [review]="r" [now]="now" [owner]="owner()" (reply)="pressed = pressed + 1"></article>
    }
  `,
})
class Host {
  readonly reviews = signal<GarageStaffReviewDto[]>([]);
  readonly owner = signal(true);
  readonly now = NOW;
  pressed = 0;
}

let host: Host;
let fixture: ReturnType<typeof TestBed.createComponent<Host>>;

async function render(
  reviews: GarageStaffReviewDto[],
  {
    owner = true,
    language = 'ro',
  }: { owner?: boolean; language?: 'ro' | 'en' } = {},
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  fixture = TestBed.createComponent(Host);
  host = fixture.componentInstance;
  host.reviews.set(reviews);
  host.owner.set(owner);
  fixture.detectChanges();
  await fixture.whenStable();
  return [
    ...fixture.nativeElement.querySelectorAll('article'),
  ] as HTMLElement[];
}

async function change(update: () => void) {
  update();
  fixture.detectChanges();
  await fixture.whenStable();
  return [
    ...fixture.nativeElement.querySelectorAll('article'),
  ] as HTMLElement[];
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cell = (row: HTMLElement, name: string) =>
  row.querySelector(`[data-${name}]`);
const button = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>('button[data-reply-button]');

afterEach(() => TestBed.resetTestingModule());

// @traces 1387-FR-001
describe('the review-edited mark against the reply date', () => {
  const reply = { postedAt: '2026-10-20T09:00:00.000Z' };

  it('shows no mark when the review was edited at the very moment the reply was posted', async () => {
    const [row] = await render([
      repliedReview({ editedAt: '2026-10-20T09:00:00.000Z' }, reply),
    ]);

    expect(cell(row, 'review-edited-after')).toBeNull();
  });

  it('shows the mark when the review was edited one millisecond after the reply was posted', async () => {
    const [row] = await render([
      repliedReview({ editedAt: '2026-10-20T09:00:00.001Z' }, reply),
    ]);

    expect(text(cell(row, 'review-edited-after'))).toBe(
      'Recenzia a fost editată după răspunsul tău',
    );
  });

  it('compares against the reply edit, not its first posting, once the reply was edited', async () => {
    const edited = { ...reply, editedAt: '2026-10-22T09:00:00.000Z' };
    const [equal] = await render([
      repliedReview({ editedAt: '2026-10-22T09:00:00.000Z' }, edited),
    ]);
    expect(cell(equal, 'review-edited-after')).toBeNull();
    TestBed.resetTestingModule();

    const [after] = await render([
      repliedReview({ editedAt: '2026-10-22T09:00:00.001Z' }, edited),
    ]);
    expect(cell(after, 'review-edited-after')).not.toBeNull();
  });

  it('shows no mark for a review that was never edited', async () => {
    const [row] = await render([repliedReview({ editedAt: null }, reply)]);

    expect(cell(row, 'review-edited-after')).toBeNull();
  });

  it('puts a separator between each pair of shown marks and none around a single mark', async () => {
    const [all] = await render([
      repliedReview(
        { editedAt: '2026-10-24T09:00:00.000Z' },
        { editedAt: '2026-10-21T09:00:00.000Z', status: 'reported' },
      ),
    ]);
    const dots = all.querySelectorAll('.reply .dot');
    expect(dots).toHaveLength(3);
    for (const dot of dots)
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    TestBed.resetTestingModule();

    const [one] = await render([repliedReview()]);
    expect(one.querySelectorAll('.reply .dot')).toHaveLength(0);
  });
});

// @traces 1387-FR-001
describe('who sees the reply button', () => {
  it('shows a receptionist no button even on a review the API marks as answerable', async () => {
    const [row] = await render([staffReview({ canReply: true })], {
      owner: false,
    });

    expect(button(row)).toBeNull();
    expect(row.querySelector('.actions')).toBeNull();
  });

  it('shows a receptionist the review-edited mark nowhere', async () => {
    const [row] = await render(
      [repliedReview({ editedAt: '2026-10-25T10:00:00.000Z' })],
      { owner: false },
    );

    expect(cell(row, 'review-edited-after')).toBeNull();
    expect(cell(row, 'reply')).not.toBeNull();
  });

  it('takes the button away when the member stops being the owner, without a new render', async () => {
    const [row] = await render([repliedReview()]);
    expect(button(row)).not.toBeNull();

    const [after] = await change(() => host.owner.set(false));

    expect(button(after)).toBeNull();
  });

  it('turns Răspunde into Editează răspunsul when the same row receives the answered review', async () => {
    const [row] = await render([staffReview()]);
    expect(text(button(row))).toBe('Răspunde');

    const [after] = await change(() => host.reviews.set([repliedReview()]));

    expect(text(button(after))).toBe('Editează răspunsul');
    expect(cell(after, 'reply')).not.toBeNull();
  });

  it('shows the reply and no button once the review has been reported with a removed reply', async () => {
    const [row] = await render([
      staffReview({
        canReply: false,
        reply: staffReply({ status: 'removed' }),
        status: 'reported',
      }),
    ]);

    expect(cell(row, 'reply')).toBeNull();
    expect(button(row)).toBeNull();
  });

  it('offers the deleted author’s review the same button and names it through the author line', async () => {
    const [row] = await render([
      staffReview({ author: { shortName: DELETED_AUTHOR } }),
    ]);
    const ids = button(row)?.getAttribute('aria-describedby')?.split(' ') ?? [];

    expect(ids).toHaveLength(1);
    expect(text(row.querySelector(`[id="${ids[0]}"]`))).toContain(
      'Șofer MotorFix',
    );
  });

  it('gives two rows buttons that describe their own author line', async () => {
    const rows = await render([
      staffReview({ id: 'r-1' }),
      staffReview({ author: { shortName: 'Maria P.' }, id: 'r-2' }),
    ]);
    const [a, b] = rows.map(
      (r) => button(r)?.getAttribute('aria-describedby')?.split(' ')[0],
    );

    expect(a).not.toBe(b);
    expect(text(document.getElementById(a ?? ''))).toContain('Andrei M.');
    expect(text(document.getElementById(b ?? ''))).toContain('Maria P.');
  });
});

// @traces 1387-FR-001
describe('the reply text on a row', () => {
  it('draws markup in the reply as plain text and keeps its blank lines', async () => {
    const typed = '<img src=x onerror=1>\n\n<b>Mulțumim</b> &amp; la revedere';
    const [row] = await render([repliedReview({}, { text: typed })]);

    expect(cell(row, 'reply-text')?.textContent).toBe(typed);
    expect(row.querySelector('.reply img, .reply b')).toBeNull();
  });

  it('shows a 1,000 character reply with no break opportunities in full', async () => {
    const typed = 'x'.repeat(1000);
    const [row] = await render([repliedReview({}, { text: typed })]);

    expect(cell(row, 'reply-text')?.textContent).toBe(typed);
  });

  it('shows a reported reply on a reported review with the edit button off and pressing nothing', async () => {
    const [row] = await render([
      repliedReview({ status: 'published' }, { status: 'reported' }),
    ]);

    const edit = button(row);
    edit?.click();
    edit?.click();

    expect(edit?.getAttribute('aria-disabled')).toBe('true');
    expect(host.pressed).toBe(0);
  });

  it('presses an enabled edit button once per click', async () => {
    const [row] = await render([repliedReview()]);

    button(row)?.click();
    button(row)?.click();

    expect(host.pressed).toBe(2);
  });
});
