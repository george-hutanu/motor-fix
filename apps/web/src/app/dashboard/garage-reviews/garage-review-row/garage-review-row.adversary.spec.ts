import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageReviewRow } from './garage-review-row';
import { hoursAgo, NOW, staffReview } from '../garage-reviews.testing';

@Component({
  imports: [GarageReviewRow],
  template: `<article mf-garage-review-row [review]="review()" [now]="now" [owner]="true"></article>`,
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

// @traces 074-FR-003
describe('a review row at its edges', () => {
  it('reads a review posted exactly seven days ago as a date with no new tag', async () => {
    const row = await render(staffReview({ postedAt: hoursAgo(7 * 24) }));

    expect(text(cell(row, 'time'))).toBe('18 oct. 2026');
    expect(cell(row, 'new')).toBeNull();
  });

  it('reads a review posted a minute under seven days ago as days with the new tag', async () => {
    const row = await render(
      staffReview({ postedAt: hoursAgo(7 * 24 - 1 / 60) }),
    );

    expect(text(cell(row, 'time'))).toBe('acum 6 zile');
    expect(text(cell(row, 'new'))).toBe('Nou');
  });

  it('reads a date in English as day, month and year', async () => {
    const row = await render(
      staffReview({ postedAt: '2026-10-13T08:00:00.000Z' }),
      'en',
    );

    expect(text(cell(row, 'time'))).toBe('13 Oct 2026');
  });

  it('keeps the new tag and draws no minus sign for a review dated slightly ahead of the clock', async () => {
    const row = await render(
      staffReview({ postedAt: new Date(NOW.getTime() + 60_000).toISOString() }),
    );

    expect(text(cell(row, 'new'))).toBe('Nou');
    expect(text(cell(row, 'time'))).not.toMatch(/-|NaN|undefined/);
  });

  it('draws no NaN or undefined for a posted date that is not a date', async () => {
    const row = await render(staffReview({ postedAt: 'yesterday-ish' }));

    expect(text(row)).not.toMatch(/NaN|undefined|Invalid/);
  });

  it('joins several included jobs with a comma after the car', async () => {
    const jobs = ['Schimb ulei', 'Filtru aer', 'Plăcuțe frână'].map(
      (nameRo, position) => ({
        id: `j-${position}`,
        jobTypeId: `t-${position}`,
        nameEn: '',
        nameRo,
        position,
      }),
    );

    const row = await render(staffReview({ jobs }));

    expect(text(cell(row, 'about'))).toBe(
      'BMW 320d · Schimb ulei, Filtru aer, Plăcuțe frână',
    );
  });

  it('shows the Romanian job name in English when the English one is blank', async () => {
    const row = await render(
      staffReview({
        jobs: [
          {
            id: 'j-1',
            jobTypeId: 't-1',
            nameEn: '   ',
            nameRo: 'Kit lanț distribuție',
            position: 0,
          },
        ],
      }),
      'en',
    );

    expect(text(cell(row, 'about'))).toBe('BMW 320d · Kit lanț distribuție');
  });

  it('shows the car alone, with no dangling separator, for a job review with no jobs', async () => {
    const row = await render(staffReview({ jobs: [] }));

    expect(text(cell(row, 'about'))).toBe('BMW 320d');
  });

  it('shows "Nu prin MotorFix" for a profile review even if a car arrives', async () => {
    const row = await render(staffReview({ source: 'profile' }));

    expect(text(cell(row, 'about'))).toBe('Nu prin MotorFix');
    expect(text(row)).not.toContain('BMW');
  });

  it('survives a job review that arrives with no car', async () => {
    const row = await render(staffReview({ car: null }));

    expect(text(cell(row, 'score'))).toBe('5,0 / 5');
    expect(text(row)).not.toMatch(/undefined|null/);
  });

  it('draws no text block for an empty string', async () => {
    const row = await render(staffReview({ text: '' }));

    expect(cell(row, 'text')).toBeNull();
  });

  it('shows markup in the text as plain characters, never as elements', async () => {
    const hostile = '<img src=x onerror=alert(1)><script>boom()</script> **b**';
    const row = await render(staffReview({ text: hostile }));

    expect(row.querySelector('img, script')).toBeNull();
    expect(text(cell(row, 'text'))).toBe(hostile);
  });

  it('shows a ten-thousand-character unbroken text whole', async () => {
    const long = 'a'.repeat(10_000);

    const row = await render(staffReview({ text: long }));

    expect(text(cell(row, 'text'))).toBe(long);
  });

  it('lets the text wrap at any width', () => {
    const css = readFileSync(join(__dirname, 'garage-review-row.css'), 'utf8');

    expect(css).toMatch(/\.text\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it.each([[1], [2], [3], [4]])('writes a %s-star score', async (rating) => {
    const row = await render(staffReview({ rating }));

    expect(text(cell(row, 'score'))).toBe(`${rating},0 / 5`);
  });

  it('shows an author with a long unicode name whole', async () => {
    const row = await render(
      staffReview({ author: { shortName: 'Ștefan Ț.' } }),
    );

    expect(text(cell(row, 'author'))).toBe('Ștefan Ț.');
  });

  it('shows both the new tag and the reported tag on a fresh reported review', async () => {
    const row = await render(staffReview({ status: 'reported' }));

    expect(text(cell(row, 'new'))).toBe('Nou');
    expect(text(cell(row, 'reported'))).toContain('Raportată');
  });
});
