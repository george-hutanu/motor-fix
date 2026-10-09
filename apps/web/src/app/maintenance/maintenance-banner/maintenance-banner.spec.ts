import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { MaintenanceBanner } from './maintenance-banner';

async function render() {
  const fixture = TestBed.createComponent(MaintenanceBanner);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('MaintenanceBanner', () => {
  it('announces in Romanian that maintenance is on', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    const status = element.querySelector('div[role="status"]');
    expect(status?.textContent?.trim()).toBe('Mentenanță activă');
  });

  it('announces it in English once English is chosen', async () => {
    const fixture = await render();

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    const status = (fixture.nativeElement as HTMLElement).querySelector(
      'div[role="status"]',
    );
    expect(status?.textContent?.trim()).toBe('Maintenance on');
  });
});
