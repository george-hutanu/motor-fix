import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { EmptyState } from './empty-state';

@Component({
  imports: [EmptyState],
  template: `
    <mf-empty-state icon="car" text="driver.empty.cars" />
  `,
})
class Host {}

const text = (element: Element) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => TestBed.resetTestingModule());

describe('the empty state under hostile use', () => {
  it('renders exactly one icon and one sentence per instance with nothing projected', async () => {
    await TestBed.inject(I18n).enter('driver');
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const [first] = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'mf-empty-state',
    );

    expect(first.querySelectorAll('svg')).toHaveLength(1);
    expect(first.querySelectorAll('p')).toHaveLength(1);
    expect(first.querySelector('a, button')).toBeNull();
  });

  it('follows a language switch made after it rendered', async () => {
    await TestBed.inject(I18n).enter('driver');
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const [first] = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'mf-empty-state',
    );

    expect(text(first.querySelector('p')!)).toBe(
      'Add your first car. We use it to show you the right garages and to remind you about the ITP.',
    );
  });
});
