import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageReviewRow } from './garage-review-row';
import {
  hoursAgo,
  NOW,
  repliedReview,
  staffReview,
} from '../garage-reviews.testing';

@Component({
  imports: [GarageReviewRow],
  template: `<article mf-garage-review-row [review]="review()" [now]="now" [owner]="owner()" (reply)="pressed = pressed + 1"></article>`,
})
class Host {
  readonly review = signal<GarageStaffReviewDto>(staffReview());
  readonly owner = signal(true);
  readonly now = NOW;
  pressed = 0;
}

let host: Host;

async function render(
  review: GarageStaffReviewDto = staffReview(),
  language: 'ro' | 'en' = 'ro',
  owner = true,
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  host = fixture.componentInstance;
  fixture.componentInstance.review.set(review);
  fixture.componentInstance.owner.set(owner);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement.querySelector('article') as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cell = (row: HTMLElement, name: string) =>
  row.querySelector(`[data-${name}]`);

afterEach(() => TestBed.resetTestingModule());

// @traces 074-FR-003 074-FR-014
describe('a review row on the garage dashboard', () => {
  it('shows the car and job, the score, the text and author · time · mechanic', async () => {
    const row = await render();

    expect(text(cell(row, 'about'))).toBe('BMW 320d · Kit lanț distribuție');
    expect(text(cell(row, 'score'))).toBe('5,0 / 5');
    expect(text(cell(row, 'text'))).toBe('Lucrare curată, predată la timp.');
    expect(text(cell(row, 'author'))).toBe('Andrei M.');
    expect(text(cell(row, 'time'))).toBe('acum 2 ore');
    expect(text(cell(row, 'mechanic'))).toBe('Costel R.');
  });

  it('writes the job and the time in English', async () => {
    const row = await render(staffReview(), 'en');

    expect(text(cell(row, 'about'))).toBe('BMW 320d · Timing chain kit');
    expect(text(cell(row, 'score'))).toBe('5.0 / 5');
    expect(text(cell(row, 'time'))).toBe('2 hours ago');
  });

  it('marks a review under seven days old as new, and an older one not', async () => {
    expect(text(cell(await render(), 'new'))).toBe('Nou');
    TestBed.resetTestingModule();
    const old = await render(staffReview({ postedAt: hoursAgo(7 * 24 + 1) }));
    expect(cell(old, 'new')).toBeNull();
  });

  it('sets its marks as labels, outside the running text', async () => {
    const row = await render(
      staffReview({ editedAt: '2026-10-12T09:00:00.000Z', status: 'reported' }),
    );

    for (const name of ['new', 'edited', 'reported']) {
      expect(cell(row, name)?.closest('p')).toBeNull();
    }
  });

  it('marks an edited review with the day it was edited', async () => {
    const ro = await render(
      staffReview({ editedAt: '2026-10-12T09:00:00.000Z' }),
    );
    expect(text(cell(ro, 'edited'))).toBe('Editată · 12 oct.');
    TestBed.resetTestingModule();
    const en = await render(
      staffReview({ editedAt: '2026-10-12T09:00:00.000Z' }),
      'en',
    );
    expect(text(cell(en, 'edited'))).toBe('Edited · 12 Oct');
    TestBed.resetTestingModule();
    expect(cell(await render(), 'edited')).toBeNull();
  });

  it('marks a reported review as hidden until an admin decides', async () => {
    const ro = await render(staffReview({ status: 'reported' }));
    expect(text(cell(ro, 'reported'))).toBe(
      'Raportată · ascunsă de pe profil până decide un admin',
    );
    TestBed.resetTestingModule();
    const en = await render(staffReview({ status: 'reported' }), 'en');
    expect(text(cell(en, 'reported'))).toBe(
      'Reported · hidden from the profile until an admin decides',
    );
    TestBed.resetTestingModule();
    expect(cell(await render(), 'reported')).toBeNull();
  });

  it('names a deleted author as a MotorFix driver', async () => {
    const ro = await render(
      staffReview({ author: { shortName: DELETED_AUTHOR } }),
    );
    expect(text(cell(ro, 'author'))).toBe('Șofer MotorFix');
    TestBed.resetTestingModule();
    const en = await render(
      staffReview({ author: { shortName: DELETED_AUTHOR } }),
      'en',
    );
    expect(text(cell(en, 'author'))).toBe('MotorFix driver');
  });

  it('says a profile review did not come through MotorFix, with no car, job or mechanic', async () => {
    const row = await render(
      staffReview({ car: null, jobs: [], mechanic: null, source: 'profile' }),
    );

    expect(text(cell(row, 'about'))).toBe('Nu prin MotorFix');
    expect(cell(row, 'mechanic')).toBeNull();
    expect(text(row)).not.toContain('BMW');
  });

  it('leaves the text out when the driver wrote none', async () => {
    const row = await render(staffReview({ text: null }));

    expect(cell(row, 'text')).toBeNull();
  });
});

const replyButton = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>('button[data-reply-button]');

// @traces 1387-review-reply-web-FR-001 1387-review-reply-web-FR-005
describe('the reply button on a review row', () => {
  it('offers the owner "Răspunde" on a review that can be answered, and says so when pressed', async () => {
    const row = await render(staffReview({ canReply: true }));

    expect(text(replyButton(row))).toBe('Răspunde');
    expect(replyButton(row)?.getAttribute('type')).toBe('button');
    replyButton(row)?.click();
    expect(host.pressed).toBe(1);
  });

  it('writes the buttons in English', async () => {
    expect(text(replyButton(await render(staffReview(), 'en')))).toBe('Reply');
    TestBed.resetTestingModule();
    expect(text(replyButton(await render(repliedReview(), 'en')))).toBe(
      'Edit the reply',
    );
  });

  it('offers the owner "Editează răspunsul" on a published review with a reply', async () => {
    const row = await render(repliedReview());

    expect(text(replyButton(row))).toBe('Editează răspunsul');
    expect(replyButton(row)?.hasAttribute('aria-disabled')).toBe(false);
    replyButton(row)?.click();
    expect(host.pressed).toBe(1);
  });

  it('shows a receptionist the reply but no button', async () => {
    const answered = await render(repliedReview(), 'ro', false);
    expect(replyButton(answered)).toBeNull();
    expect(cell(answered, 'reply')).not.toBeNull();
    TestBed.resetTestingModule();
    const open = await render(staffReview({ canReply: false }), 'ro', false);
    expect(replyButton(open)).toBeNull();
    expect(open.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps the edit of a reported reply in the tab order but opening nothing', async () => {
    const row = await render(repliedReview({}, { status: 'reported' }));
    const button = replyButton(row);

    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.disabled).toBe(false);
    button?.click();
    expect(host.pressed).toBe(0);
    const reported = cell(row, 'reply-reported') as HTMLElement;
    expect(reported.id).not.toBe('');
    expect(button?.getAttribute('aria-describedby')?.split(' ')).toContain(
      reported.id,
    );
  });

  it('names the review it answers through the author line', async () => {
    const row = await render(staffReview());
    const ids = replyButton(row)?.getAttribute('aria-describedby')?.split(' ');

    expect(ids?.length).toBeGreaterThan(0);
    const by = row.querySelector(`[id="${ids?.[0]}"]`);
    expect(text(by)).toContain('Andrei M.');
  });

  it('offers no button on a reported review, and still shows its published reply', async () => {
    const row = await render(repliedReview({ status: 'reported' }));

    expect(replyButton(row)).toBeNull();
    expect(text(cell(row, 'reply-text'))).toContain('Mulțumim, Andrei!');
  });

  it('shows nothing and no button once an admin removed the reply', async () => {
    const gone = await render(repliedReview({}, { status: 'removed' }));
    expect(cell(gone, 'reply')).toBeNull();
    expect(replyButton(gone)).toBeNull();
    TestBed.resetTestingModule();
    const nulled = await render(staffReview({ canReply: false, reply: null }));
    expect(cell(nulled, 'reply')).toBeNull();
    expect(replyButton(nulled)).toBeNull();
  });
});

// @traces 1387-review-reply-web-FR-001 1387-review-reply-web-FR-005
describe('the reply under a review on the dashboard', () => {
  it('shows the reply whole, labelled, with the day it was posted', async () => {
    const row = await render(repliedReview());
    const block = cell(row, 'reply') as HTMLElement;

    expect(text(block.querySelector('.reply-label'))).toBe('Răspunsul tău');
    expect(cell(row, 'reply-text')?.textContent).toBe(
      'Mulțumim, Andrei!\nTe mai așteptăm.',
    );
    expect(text(cell(row, 'reply-day'))).toBe('25 oct. 2026');
    expect(cell(row, 'reply-edited')).toBeNull();
    expect(cell(row, 'reply-reported')).toBeNull();
    expect(cell(row, 'review-edited-after')).toBeNull();
  });

  it("writes the reply's label and day in English", async () => {
    const row = await render(repliedReview(), 'en');

    expect(text(cell(row, 'reply')?.querySelector('.reply-label'))).toBe(
      'Your reply',
    );
    expect(text(cell(row, 'reply-day'))).toBe('25 Oct 2026');
  });

  it('marks an edited reply with the day, year included', async () => {
    const edited = {
      editedAt: '2026-10-22T09:00:00.000Z',
      postedAt: '2026-10-20T09:00:00.000Z',
    };
    const ro = await render(repliedReview({}, edited));
    expect(text(cell(ro, 'reply-edited'))).toBe('Editat · 22 oct. 2026');
    TestBed.resetTestingModule();
    const en = await render(repliedReview({}, edited), 'en');
    expect(text(cell(en, 'reply-edited'))).toBe('Edited · 22 Oct 2026');
  });

  it('marks a reported reply as hidden until an admin decides', async () => {
    const ro = await render(repliedReview({}, { status: 'reported' }));
    expect(text(cell(ro, 'reply-reported'))).toBe(
      'Raportat · ascuns până decide un admin',
    );
    TestBed.resetTestingModule();
    const en = await render(repliedReview({}, { status: 'reported' }), 'en');
    expect(text(cell(en, 'reply-reported'))).toBe(
      'Reported · hidden until an admin decides',
    );
  });

  it("tells the owner the review was edited after the reply, against the reply's last change", async () => {
    const reply = { postedAt: '2026-10-20T09:00:00.000Z' };
    const after = await render(
      repliedReview({ editedAt: '2026-10-23T09:00:00.000Z' }, reply),
    );
    expect(text(cell(after, 'review-edited-after'))).toBe(
      'Recenzia a fost editată după răspunsul tău',
    );
    TestBed.resetTestingModule();
    const before = await render(
      repliedReview({ editedAt: '2026-10-19T09:00:00.000Z' }, reply),
    );
    expect(cell(before, 'review-edited-after')).toBeNull();
    TestBed.resetTestingModule();
    const answeredAgain = await render(
      repliedReview(
        { editedAt: '2026-10-23T09:00:00.000Z' },
        { ...reply, editedAt: '2026-10-24T09:00:00.000Z' },
      ),
    );
    expect(cell(answeredAgain, 'review-edited-after')).toBeNull();
    TestBed.resetTestingModule();
    const en = await render(
      repliedReview({ editedAt: '2026-10-23T09:00:00.000Z' }, reply),
      'en',
    );
    expect(text(cell(en, 'review-edited-after'))).toBe(
      'The review was edited after your reply',
    );
  });

  it('keeps the review-edited mark to the owner', async () => {
    const row = await render(
      repliedReview(
        { editedAt: '2026-10-23T09:00:00.000Z' },
        { postedAt: '2026-10-20T09:00:00.000Z' },
      ),
      'ro',
      false,
    );

    expect(cell(row, 'review-edited-after')).toBeNull();
  });

  it('writes the marks in order: day, edited, reported, review edited', async () => {
    const row = await render(
      repliedReview(
        { editedAt: '2026-10-24T09:00:00.000Z' },
        {
          editedAt: '2026-10-22T09:00:00.000Z',
          postedAt: '2026-10-20T09:00:00.000Z',
          status: 'reported',
        },
      ),
    );
    const order = [
      ...row.querySelectorAll<HTMLElement>(
        '[data-reply-day], [data-reply-edited], [data-reply-reported], [data-review-edited-after]',
      ),
    ].map((el) => Object.keys(el.dataset)[0]);

    expect(order).toEqual([
      'replyDay',
      'replyEdited',
      'replyReported',
      'reviewEditedAfter',
    ]);
  });
});

// @traces 1387-review-reply-web-FR-001 1387-review-reply-web-FR-005
describe('the reply’s styles on the row', () => {
  const css = readFileSync(join(__dirname, 'garage-review-row.css'), 'utf8');

  it('gives the reply button a 44 px touch target', () => {
    expect(css).toMatch(/\.actions button\s*{[^}]*min-height:\s*44px/);
  });

  it('keeps the reply’s line breaks and wraps it and its marks at any width', () => {
    expect(css).toMatch(/\.reply-text\s*{[^}]*white-space:\s*pre-line/);
    expect(css).toMatch(/\.reply-text\s*{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.marks\s*{[^}]*flex-wrap:\s*wrap/);
  });
});
