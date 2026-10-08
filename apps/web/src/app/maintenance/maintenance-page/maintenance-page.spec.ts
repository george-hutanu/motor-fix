import { RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { MaintenancePage } from './maintenance-page';

async function render() {
  const fixture = TestBed.createComponent(MaintenancePage);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const text = (element: HTMLElement) =>
  element.textContent?.replace(/\s+/g, ' ').trim();

describe('MaintenancePage', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ providers: [provideRouter([])] }),
  );

  it('says in Romanian that MotorFix is down for maintenance', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(text(element.querySelector('main h1') as HTMLElement)).toBe(
      'Mentenanță',
    );
    expect(text(element)).toContain(
      'MotorFix este în mentenanță. Revenim în curând.',
    );
    expect(text(element)).toContain('MotorFix');
  });

  it('says it in English once English is chosen', async () => {
    const fixture = await render();

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(text(element.querySelector('main h1') as HTMLElement)).toBe(
      'Maintenance',
    );
    expect(text(element)).toContain(
      "MotorFix is down for maintenance. We'll be back soon.",
    );
    expect(text(element.querySelector('a') as HTMLElement)).toBe(
      'Admin? Sign in',
    );
  });

  it('offers the language switch', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    expect(element.querySelector('mf-language-switch')).not.toBeNull();
  });

  it('links quietly to the admin sign-in and to nothing else', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    const links = [...element.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/admin']);
    expect(text(links[0] as HTMLElement)).toBe('Administrator? Intră în cont');
  });

  it('has no control but the language switch and the admin link', async () => {
    const element = (await render()).nativeElement as HTMLElement;

    const buttons = [...element.querySelectorAll('button')];
    expect(buttons.every((b) => b.closest('mf-language-switch') !== null)).toBe(
      true,
    );
    expect(element.querySelector('form, input')).toBeNull();
  });

  it('answers 503 with a time to come back when rendered on the server', async () => {
    const init: ResponseInit = {};
    TestBed.configureTestingModule({
      providers: [{ provide: RESPONSE_INIT, useValue: init }],
    });

    await render();

    expect(init.status).toBe(503);
    expect(init.headers).toEqual({ 'Retry-After': '300' });
  });
});
