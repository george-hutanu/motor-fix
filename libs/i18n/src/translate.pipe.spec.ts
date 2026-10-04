import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { I18n } from './i18n';
import { TranslatePipe } from './translate.pipe';

@Component({
  imports: [TranslatePipe],
  template: `
    <h1>{{ 'shell.brand' | t }}</h1>
    <p>{{ 'shell.version.unknown' | t }}</p>
    <p>{{ 'shell.health.status' | t: { postgres: 'ok', redis: 'error' } }}</p>
  `,
})
class Host {}

describe('TranslatePipe', () => {
  it('re-renders the same view in the new language', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const view = fixture.nativeElement as HTMLElement;
    const version = view.querySelector('p');

    expect(version?.textContent).toBe('versiune necunoscută');

    await TestBed.inject(I18n).use('en');
    await fixture.whenStable();

    expect(view.querySelector('p')).toBe(version);
    expect(version?.textContent).toBe('version unknown');
    expect(view.textContent).toContain('MotorFix');
    expect(view.textContent).toContain('PostgreSQL: ok · Redis: error');
  });
});
