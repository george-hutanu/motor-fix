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

  it('offers no action on the row, even to the owner', async () => {
    const row = await render(staffReview({ canReply: true, canReport: true }));

    expect(row.querySelectorAll('button, a, [role="button"]')).toHaveLength(0);
    expect(text(row)).not.toMatch(/Răspunde|Raportează/);
  });
});
