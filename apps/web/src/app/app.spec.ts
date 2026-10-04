import { TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { App, HEALTH } from './app';

function render(checks: { postgres: string; redis: string }) {
  TestBed.inject(TransferState).set(HEALTH, {
    checks,
    status: checks.postgres === 'ok' && checks.redis === 'ok' ? 'ok' : 'error',
    version: 'abc123',
  });
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('App', () => {
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
    const text = TestBed.createComponent(App);
    text.detectChanges();

    expect((text.nativeElement as HTMLElement).textContent).toContain(
      'PostgreSQL: unknown · Redis: unknown',
    );
  });
});
