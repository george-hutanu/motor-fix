import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { DriverHome } from './driver-home';

async function render(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(DriverHome);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

afterEach(() => TestBed.resetTestingModule());

// @traces 221-FR-015
describe('DriverHome', () => {
  it('leads with Cerere nouă, a link to Home', async () => {
    const link = (await render()).querySelector('a[href="/ro"]');

    expect(link?.textContent?.trim()).toBe('Cerere nouă');
  });

  it('says New request and goes to the English Home in English', async () => {
    const link = (await render('en')).querySelector('a[href="/en"]');

    expect(link?.textContent?.trim()).toBe('New request');
  });
});
