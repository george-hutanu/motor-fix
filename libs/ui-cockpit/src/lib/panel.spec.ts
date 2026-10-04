import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Panel } from './panel';

@Component({
  imports: [Panel],
  template: `
    <mf-panel heading="Garaje">
      <p>conținut</p>
    </mf-panel>
    <mf-panel><p>fără titlu</p></mf-panel>
  `,
})
class Host {}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll('section'),
  ];
}

describe('Panel', () => {
  it('wraps its content in a panel section', () => {
    const [titled] = render();

    expect(titled.classList).toContain('mf-panel');
    expect(titled.textContent).toContain('conținut');
  });

  it('shows the title as a capital label that names the section', () => {
    const [titled] = render();
    const heading = titled.querySelector('h2');

    expect(heading?.textContent?.trim()).toBe('Garaje');
    expect(heading?.classList).toContain('mf-label');
    expect(titled.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(titled.closest('mf-panel')?.hasAttribute('title')).toBe(false);
  });

  it('has no heading without a title', () => {
    const [, untitled] = render();

    expect(untitled.querySelector('h2')).toBeNull();
    expect(untitled.hasAttribute('aria-labelledby')).toBe(false);
  });
});
