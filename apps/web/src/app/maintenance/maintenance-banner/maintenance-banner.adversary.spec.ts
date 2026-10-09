import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { MaintenanceBanner } from './maintenance-banner';

async function render() {
  const fixture = TestBed.createComponent(MaintenanceBanner);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('MaintenanceBanner under odd conditions', () => {
  it('holds one status region and nothing to click', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(element.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(element.querySelector('a, button, input')).toBeNull();
  });

  it('is announced politely, never as an alert', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('[aria-live="assertive"]')).toBeNull();
  });

  it('shows no raw translation key in either language', async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).not.toContain('shell.maintenance');

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(element.textContent).not.toContain('shell.maintenance');
  });

  it('comes back to Romanian after English', async () => {
    const fixture = await render();
    const i18n = TestBed.inject(I18n);
    await i18n.use('en');
    fixture.detectChanges();

    await i18n.use('ro');
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[role="status"]')
        ?.textContent?.trim(),
    ).toBe('Mentenanță activă');
  });
});
