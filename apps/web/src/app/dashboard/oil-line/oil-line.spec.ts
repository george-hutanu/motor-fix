import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { OilLine } from './oil-line';

@Component({
  imports: [OilLine],
  template: `<mf-oil-line [nextServiceKm]="next()" [odometerKm]="odometer()" />`,
})
class Host {
  readonly next = signal(0);
  readonly odometer = signal(148200);
}

async function render(kmLeft: number, language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.next.set(148200 + kmLeft);
  fixture.detectChanges();
  await fixture.whenStable();
  const lamp = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-lamp',
  ) as HTMLElement;
  return {
    sentence: (lamp.textContent ?? '').replace(/\s+/g, ' ').trim(),
    state: lamp.getAttribute('data-state'),
  };
}

afterEach(() => TestBed.resetTestingModule());

// @traces 029-FR-003 029-FR-012
describe('the oil-service line', () => {
  it.each([
    [
      3800,
      'green',
      'Schimb de ulei peste 3.800 km',
      'Oil service due in 3,800 km',
    ],
    [
      1988,
      'green',
      'Schimb de ulei peste 1.988 km',
      'Oil service due in 1,988 km',
    ],
    [
      1987,
      'amber',
      'Schimb de ulei peste 1.987 km',
      'Oil service due in 1,987 km',
    ],
    [247, 'amber', 'Schimb de ulei peste 247 km', 'Oil service due in 247 km'],
    [246, 'red', 'Schimb de ulei peste 246 km', 'Oil service due in 246 km'],
    [0, 'red', 'Schimb de ulei acum', 'Oil service due now'],
    [
      -200,
      'red',
      'Schimbul de ulei a trecut de 200 km',
      'Oil service overdue by 200 km',
    ],
    [
      -1500,
      'red',
      'Schimbul de ulei a trecut de 1.500 km',
      'Oil service overdue by 1,500 km',
    ],
  ])('reads %i km left as a %s lamp', async (kmLeft, state, ro, en) => {
    const romanian = await render(kmLeft);
    expect(romanian).toEqual({ sentence: ro, state });
    TestBed.resetTestingModule();

    expect(await render(kmLeft, 'en')).toEqual({ sentence: en, state });
  });
});
