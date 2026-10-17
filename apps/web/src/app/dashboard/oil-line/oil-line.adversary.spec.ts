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
  readonly odometer = signal(0);
}

async function render(
  next: number,
  odometer: number,
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.next.set(next);
  fixture.componentInstance.odometer.set(odometer);
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

// @traces 029-FR-003
describe('the oil-service line at its edges', () => {
  it('says one kilometre left in red', async () => {
    expect(await render(1001, 1000)).toEqual({
      sentence: 'Schimb de ulei peste 1 km',
      state: 'red',
    });
  });

  it('says overdue by one kilometre with a positive number', async () => {
    expect(await render(999, 1000, 'en')).toEqual({
      sentence: 'Oil service overdue by 1 km',
      state: 'red',
    });
  });

  it('groups a million kilometres per language', async () => {
    expect((await render(1_000_000, 0)).sentence).toBe(
      'Schimb de ulei peste 1.000.000 km',
    );
    TestBed.resetTestingModule();
    expect((await render(1_000_000, 0, 'en')).sentence).toBe(
      'Oil service due in 1,000,000 km',
    );
  });

  it('says due now at zero in English', async () => {
    expect(await render(5000, 5000, 'en')).toEqual({
      sentence: 'Oil service due now',
      state: 'red',
    });
  });

  it('shows a large overdue distance without a minus sign', async () => {
    expect((await render(0, 12345)).sentence).toBe(
      'Schimbul de ulei a trecut de 12.345 km',
    );
  });
});
