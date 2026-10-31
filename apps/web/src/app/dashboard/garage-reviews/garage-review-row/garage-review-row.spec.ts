import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageReviewRow } from './garage-review-row';
import { hoursAgo, NOW, staffReview } from '../garage-reviews.testing';

@Component({
  imports: [GarageReviewRow],
  template: `<article mf-garage-review-row [review]="review()" [now]="now"></article>`,
})
class Host {
  readonly review = signal<GarageStaffReviewDto>(staffReview());
  readonly now = NOW;
}

async function render(
  review: GarageStaffReviewDto = staffReview(),
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({});
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.review.set(review);
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

  it('offers the receptionist no action on the row', async () => {
    const row = await render(
      staffReview({ canReply: false, canReport: false }),
    );

    expect(row.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
    expect(text(row)).not.toMatch(/Răspunde|Raportează/);
  });
});

// @traces 1382-FR-001 1382-FR-002 1382-FR-007
describe('the report button on a review row', () => {
  const reportButton = (row: HTMLElement) =>
    row.querySelector<HTMLButtonElement>('button[data-report-button]');

  it('shows Raportează on a published row the owner may report, in the actions line after the author line', async () => {
    const row = await render(staffReview());

    const button = reportButton(row);
    expect(text(button)).toBe('Raportează');
    expect(button?.type).toBe('button');
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute('aria-disabled')).toBe(false);
    expect(button?.closest('.actions')).not.toBeNull();
    const by = row.querySelector('p.by') as HTMLElement;
    expect(
      by.compareDocumentPosition(button as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cell(row, 'report-hint')).toBeNull();
  });

  it('shows no button to a row the garage may not report', async () => {
    const row = await render(staffReview({ canReport: false }));

    expect(reportButton(row)).toBeNull();
  });

  it('shows no button on a reported row, its tag in its place', async () => {
    const row = await render(
      staffReview({ reportRefusal: 'already_reported', status: 'reported' }),
    );

    expect(reportButton(row)).toBeNull();
    expect(cell(row, 'reported')).not.toBeNull();
  });

  it('keeps a review an admin kept reachable but aria-disabled, with the hint joined to it', async () => {
    const row = await render(staffReview({ reportRefusal: 'already_kept' }));

    const button = reportButton(row) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const hint = cell(row, 'report-hint') as HTMLElement;
    expect(text(hint)).toBe(
      'Păstrată de un admin; poate fi raportată din nou doar după ce autorul o editează.',
    );
    expect(hint.id).toBeTruthy();
    expect(button.getAttribute('aria-describedby')?.split(' ')).toContain(
      hint.id,
    );
  });

  it('asks to report on a press, and asks nothing for a kept review', async () => {
    const pressed = jest.fn();

    @Component({
      imports: [GarageReviewRow],
      template: `<article mf-garage-review-row [review]="review()" [now]="now" (report)="pressed()"></article>`,
    })
    class Listening {
      readonly review = signal<GarageStaffReviewDto>(staffReview());
      readonly now = NOW;
      readonly pressed = pressed;
    }
    TestBed.configureTestingModule({});
    await TestBed.inject(I18n).enter('garage');
    const listening = TestBed.createComponent(Listening);
    listening.detectChanges();
    const element = listening.nativeElement as HTMLElement;
    reportButton(element)?.click();
    expect(pressed).toHaveBeenCalledTimes(1);

    listening.componentInstance.review.set(
      staffReview({ reportRefusal: 'already_kept' }),
    );
    listening.detectChanges();
    reportButton(element)?.click();
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('reads Report and the kept hint in English', async () => {
    const row = await render(
      staffReview({ reportRefusal: 'already_kept' }),
      'en',
    );

    expect(text(reportButton(row))).toBe('Report');
    expect(text(cell(row, 'report-hint'))).toBe(
      'Kept by an admin; it can be reported again only after the author edits it.',
    );
  });
});
