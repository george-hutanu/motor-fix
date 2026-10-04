import { TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { HEALTH, Home } from './home';

function render(checks: { postgres: string; redis: string }) {
  TestBed.inject(TransferState).set(HEALTH, {
    checks,
    status: checks.postgres === 'ok' && checks.redis === 'ok' ? 'ok' : 'error',
    version: 'abc123',
  });
  const fixture = TestBed.createComponent(Home);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('Home', () => {
  it('shows the name, the version and both checks', () => {
    const text = render({ postgres: 'ok', redis: 'ok' });

    expect(text).toContain('MotorFix');
    expect(text).toContain('abc123');
    expect(text).toContain('PostgreSQL: ok · Redis: ok');
  });

  it('names the part that failed', () => {
    expect(render({ postgres: 'ok', redis: 'error' })).toContain(
      'PostgreSQL: ok · Redis: error',
    );
  });

  it('says the status is unknown when the API did not answer', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('versiune necunoscută');
    expect(text).toContain('PostgreSQL: necunoscut · Redis: necunoscut');
  });

  it('switches the page to English in place', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    await TestBed.inject(I18n).use('en');
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent;

    expect(text).toContain('version unknown');
    expect(text).toContain('PostgreSQL: unknown · Redis: unknown');
  });

  it('has the language switch in its header, and EN turns the page English', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const en = [
      ...element.querySelectorAll('header [role="group"] button'),
    ].find((b) => b.textContent?.trim() === 'EN') as HTMLButtonElement;
    en.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    expect(element.textContent).toContain('version unknown');
    expect(en.getAttribute('aria-pressed')).toBe('true');
  });
});
