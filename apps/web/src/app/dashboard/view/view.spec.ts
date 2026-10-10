import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import type { MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { of } from 'rxjs';

import { View } from './view';
import { Session } from '../session';
import { type Area, DASHBOARDS } from '../views';

const viewOf = (area: Area, path: string) =>
  DASHBOARDS[area].views.find((view) => view.path === path)!;

async function render(area: Area, path: string, language: 'ro' | 'en' = 'ro') {
  const current = signal({ capabilities: [] } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Session, useValue: { current, shown: current } },
      {
        provide: ActivatedRoute,
        useValue: { data: of({ area, view: viewOf(area, path) }) },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(View);
  // The view asks for its area's texts, which load in the next turns.
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

// @traces 030-FR-009
describe('a view’s own empty state', () => {
  it('tells a driver with no review that one is asked after a repair, with no action', async () => {
    const element = await render('driver', 'reviews');
    const empty = element.querySelector('mf-empty-state');

    expect(text(empty)).toBe(
      'Nicio recenzie încă. După o reparație prin MotorFix îți cerem părerea.',
    );
    expect(empty?.querySelector('svg[data-icon="star"]')).not.toBeNull();
    expect(empty?.querySelector('a, button')).toBeNull();
    expect(text(element)).not.toContain('Nimic aici încă.');
  });

  it('says it in English for an English reader', async () => {
    const element = await render('driver', 'reviews', 'en');

    expect(text(element.querySelector('mf-empty-state'))).toBe(
      'No reviews yet. After a repair through MotorFix we ask what you think.',
    );
  });

  // @traces 030-FR-011
  it('tells a driver with no saved garage so, with Caută altele to Home', async () => {
    const element = await render('driver', 'saved');
    const empty = element.querySelector('mf-empty-state');

    expect(text(empty)).toContain('Nu ai salvat încă niciun service.');
    expect(empty?.querySelector('svg[data-icon="bookmark"]')).not.toBeNull();
    const link = empty?.querySelector('a');
    expect(text(link ?? null)).toBe('Caută altele');
    expect(link?.getAttribute('href')).toBe('/ro');
  });

  it('sends Find others to the English Home in English', async () => {
    const element = await render('driver', 'saved', 'en');
    const link = element.querySelector('mf-empty-state a');

    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'You have not saved any garage yet.',
    );
    expect(text(link)).toBe('Find others');
    expect(link?.getAttribute('href')).toBe('/en');
  });

  it('keeps the plain line of a view with no empty state of its own', async () => {
    const element = await render('garage', 'team');

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(text(element)).toBe(
      'Aici vei vedea mecanicii service‑ului și ce poate face fiecare.',
    );
  });
});
