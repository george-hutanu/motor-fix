import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { CockpitGaugesSample } from './gauges-sample';
import { provideCockpitTheme } from './provide-cockpit-theme';
import { CockpitSamplePage } from './sample-page';
import * as library from '../index';

const text = (key: string) => TestBed.inject(I18n).t(`cockpit.gauges.${key}`);

async function render() {
  TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
  const fixture = TestBed.createComponent(CockpitGaugesSample);
  await TestBed.inject(I18n).enter('cockpit');
  fixture.detectChanges();
  return { fixture, page: fixture.nativeElement as HTMLElement };
}

const odometers = (page: HTMLElement) =>
  [...page.querySelectorAll('mf-odometer [aria-hidden="true"]')].map((o) =>
    o.textContent?.trim(),
  );

describe('CockpitGaugesSample', () => {
  it('shows the four lamps with their labels', async () => {
    const { page } = await render();
    const lamps = [...page.querySelectorAll('mf-lamp')];

    expect(lamps.map((l) => l.getAttribute('data-state'))).toEqual([
      'green',
      'red',
      'amber',
      'grey',
    ]);
    expect(lamps.map((l) => l.textContent?.trim())).toEqual(
      ['lampGreen', 'lampRed', 'lampAmber', 'lampGrey'].map(text),
    );
    expect(lamps.every((l) => !l.textContent?.includes('cockpit.'))).toBe(true);
  });

  it('shows large and small dials with a rating and with none', async () => {
    const { page } = await render();
    const dials = [...page.querySelectorAll('mf-rating-dial')].map((d) => [
      d.getAttribute('data-size'),
      d.querySelector('.mf-dial-value')?.textContent?.trim(),
    ]);

    expect(dials).toEqual([
      ['large', '4,8'],
      ['large', '—'],
      ['small', '4,8'],
      ['small', '—'],
    ]);
  });

  it('shows a price, a range and no price, and swaps the range on request', async () => {
    const { fixture, page } = await render();

    expect(odometers(page)).toEqual(['1.401 lei', '1.250–1.600 lei', '—']);

    const swap = [...page.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text('swap'),
    );
    swap?.click();
    fixture.detectChanges();

    expect(odometers(page)[1]).toBe('1.400–1.800 lei');
  });

  it('sits on the sample page', async () => {
    TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
    const fixture = TestBed.createComponent(CockpitSamplePage);
    await TestBed.inject(I18n).enter('cockpit');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'mf-cockpit-gauges-sample mf-rating-dial',
      ),
    ).not.toBeNull();
  });

  it('is exported from the library for later screens', () => {
    expect(Object.keys(library)).toEqual(
      expect.arrayContaining(['Lamp', 'Odometer', 'RatingDial']),
    );
  });
});
