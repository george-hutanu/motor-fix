import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { FirstStepsCard } from './first-steps-card';

async function render(team: unknown, language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(FirstStepsCard);
  if (team !== undefined) fixture.componentRef.setInput('team', team);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { element: fixture.nativeElement as HTMLElement, fixture };
}

const hrefs = (element: HTMLElement) =>
  [...element.querySelectorAll('li > a')].map((a) => a.getAttribute('href'));

afterEach(() => TestBed.resetTestingModule());

// @traces 099-FR-008
describe('the first-steps card under odd use', () => {
  it('leaves the team row out when the input is never set', async () => {
    const { element } = await render(undefined);

    expect(hrefs(element)).toEqual([
      '/app/garage/prices',
      '/app/garage/profile',
    ]);
  });

  it('adds and removes the team row as the input flips', async () => {
    const { element, fixture } = await render(false);
    fixture.componentRef.setInput('team', true);
    fixture.detectChanges();
    expect(hrefs(element)).toHaveLength(3);

    fixture.componentRef.setInput('team', false);
    fixture.detectChanges();
    expect(hrefs(element)).toHaveLength(2);
  });

  it('has exactly one heading and no row outside a link', async () => {
    const { element } = await render(true);

    expect(element.querySelectorAll('h2')).toHaveLength(1);
    expect(element.querySelectorAll('li')).toHaveLength(
      element.querySelectorAll('li > a').length,
    );
  });

  it('holds no digits, which would be invented data', async () => {
    const { element } = await render(true);

    expect(/\d/.test(element.textContent ?? '')).toBe(false);
  });

  it('switches back to Romanian after English', async () => {
    const { element, fixture } = await render(true, 'en');
    await TestBed.inject(I18n).use('ro');
    fixture.detectChanges();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Primii pași',
    );
  });
});
