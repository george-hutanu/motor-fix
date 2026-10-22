import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { SortControl } from './sort-control';

type Sort = 'rating' | 'distance' | 'price';

@Component({
  imports: [SortControl],
  template: `<mf-sort-control
    [sort]="sort()"
    [placeKnown]="placeKnown()"
    (pick)="picked.push($event)"
  />`,
})
class Host {
  readonly sort = signal<Sort>('rating');
  readonly placeKnown = signal(true);
  readonly picked: Sort[] = [];
}

async function render() {
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 328-FR-009 328-FR-011
describe('SortControl', () => {
  let fixture: Awaited<ReturnType<typeof render>>;
  const host = () => fixture.nativeElement as HTMLElement;
  const buttons = () => [
    ...host().querySelectorAll<HTMLButtonElement>('button'),
  ];
  const button = (name: string) => buttons().find((b) => said(b) === name);

  beforeEach(async () => {
    fixture = await render();
  });

  it('is a group named Sortare of three buttons, the current one pressed', () => {
    expect(host().querySelector('fieldset')?.getAttribute('aria-label')).toBe(
      'Sortare',
    );
    expect(buttons().map(said)).toEqual(['Notă', 'Distanță', 'Preț']);
    expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(buttons().every((b) => b.type === 'button')).toBe(true);
  });

  it('marks the sort it is given', () => {
    fixture.componentInstance.sort.set('price');
    fixture.detectChanges();

    expect(button('Preț')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Notă')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('says which sort was picked', () => {
    button('Distanță')?.click();
    button('Preț')?.click();

    expect(fixture.componentInstance.picked).toEqual(['distance', 'price']);
  });

  it('turns Distanță off without a place, saying why, and keeps the others', () => {
    fixture.componentInstance.placeKnown.set(false);
    fixture.detectChanges();

    const distance = button('Distanță');
    expect(distance?.disabled).toBe(true);
    const why = host().querySelector(
      `#${distance?.getAttribute('aria-describedby')}`,
    );
    expect(said(why)).toBe('Alege un loc');
    expect(button('Notă')?.disabled).toBe(false);
    expect(button('Preț')?.disabled).toBe(false);

    distance?.click();
    expect(fixture.componentInstance.picked).toEqual([]);
  });

  it('describes nothing while a place is known', () => {
    expect(button('Distanță')?.hasAttribute('aria-describedby')).toBe(false);
  });
});
