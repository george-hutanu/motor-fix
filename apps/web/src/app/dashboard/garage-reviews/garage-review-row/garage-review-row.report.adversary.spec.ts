import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageReviewRow } from './garage-review-row';
import { NOW, staffReview } from '../garage-reviews.testing';

@Component({
  imports: [GarageReviewRow],
  template: `<article mf-garage-review-row [review]="review()" [now]="now" (report)="reports = reports + 1"></article>`,
})
class Host {
  readonly review = signal<GarageStaffReviewDto>(staffReview());
  readonly now = NOW;
  reports = 0;
}

async function render(
  review: GarageStaffReviewDto,
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
  const row = fixture.nativeElement.querySelector('article') as HTMLElement;
  return {
    button: () => row.querySelector<HTMLButtonElement>('[data-report-button]'),
    fixture,
    hint: () => row.querySelector<HTMLElement>('[data-report-hint]'),
    host: fixture.componentInstance,
    row,
  };
}

afterEach(() => TestBed.resetTestingModule());

// @traces 1382-FR-001 1382-FR-002
describe('the report button at its edges', () => {
  it('shows no button on a reported row even when the refusal field is null', async () => {
    const { button } = await render(
      staffReview({ reportRefusal: null, status: 'reported' }),
    );

    expect(button()).toBeNull();
  });

  it('shows no button on a published row whose refusal says it is already reported', async () => {
    const { button } = await render(
      staffReview({ reportRefusal: 'already_reported', status: 'published' }),
    );

    expect(button()).toBeNull();
  });

  it('shows no hint and no button to a receptionist even for a kept review', async () => {
    const { button, hint } = await render(
      staffReview({ canReport: false, reportRefusal: 'already_kept' }),
    );

    expect(button()).toBeNull();
    expect(hint()).toBeNull();
  });

  it('treats a missing refusal field as null and offers an enabled button', async () => {
    const review = staffReview() as Partial<GarageStaffReviewDto>;
    delete review.reportRefusal;
    const { button, hint } = await render(review as GarageStaffReviewDto);

    expect(button()?.getAttribute('aria-disabled')).toBeNull();
    expect(button()?.hasAttribute('aria-describedby')).toBe(false);
    expect(hint()).toBeNull();
  });

  it('emits once per press on an enabled button', async () => {
    const { button, host } = await render(staffReview());

    button()?.click();
    button()?.click();

    expect(host.reports).toBe(2);
  });

  it('emits nothing on any press of a kept review and keeps the button natively enabled', async () => {
    const { button, host } = await render(
      staffReview({ reportRefusal: 'already_kept' }),
    );

    button()?.click();
    button()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(host.reports).toBe(0);
    expect(button()?.disabled).toBe(false);
    expect(button()?.getAttribute('aria-disabled')).toBe('true');
  });

  it('points aria-describedby at exactly the hint element', async () => {
    const { button, hint, row } = await render(
      staffReview({ reportRefusal: 'already_kept' }),
    );

    const id = button()?.getAttribute('aria-describedby') as string;
    expect(id).not.toBe('');
    expect(row.querySelector(`[id="${id}"]`)).toBe(hint());
  });

  it('gives two kept rows different hint ids', async () => {
    TestBed.configureTestingModule({});
    await TestBed.inject(I18n).enter('garage');
    const one = TestBed.createComponent(Host);
    one.componentInstance.review.set(
      staffReview({ id: 'a', reportRefusal: 'already_kept' }),
    );
    const two = TestBed.createComponent(Host);
    two.componentInstance.review.set(
      staffReview({ id: 'b', reportRefusal: 'already_kept' }),
    );
    one.detectChanges();
    two.detectChanges();

    const ids = [one, two].map((f) =>
      (f.nativeElement as HTMLElement)
        .querySelector('[data-report-button]')
        ?.getAttribute('aria-describedby'),
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('turns the button into the tag when the same row is later reported', async () => {
    const { fixture, host, button, row } = await render(staffReview());
    expect(button()).not.toBeNull();

    host.review.set(
      staffReview({ reportRefusal: 'already_reported', status: 'reported' }),
    );
    fixture.detectChanges();

    expect(button()).toBeNull();
    expect(row.querySelector('[data-reported]')).not.toBeNull();
  });

  it('says Report and the English kept hint in English', async () => {
    const { button, hint } = await render(
      staffReview({ reportRefusal: 'already_kept' }),
      'en',
    );

    expect(button()?.textContent?.trim()).toBe('Report');
    expect(hint()?.textContent?.trim()).toBe(
      'Kept by an admin; it can be reported again only after the author edits it.',
    );
  });
});
