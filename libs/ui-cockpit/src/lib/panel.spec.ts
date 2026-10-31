import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

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
  // QA lap 5: side-by-side panels keep level when one title wraps, so a host
  // may reserve the title's lines; by default the title takes its own height.
  it("lets a host reserve its title's height, none by default", () => {
    // Jest's Angular transform drops component styles, so read the source.
    const source = readFileSync(join(__dirname, 'panel.ts'), 'utf8');

    expect(source).toMatch(
      /h2[^{]*\{[^}]*min-block-size:\s*var\(--mf-panel-heading-block,\s*auto\)/,
    );
  });

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

@Component({
  imports: [Panel],
  template: `
    <mf-panel heading="Mașinile mele" [link]="['/app', 'driver', 'cars']">
      <p>conținut</p>
    </mf-panel>
  `,
})
class LinkedHost {}

// @traces 030-FR-006
describe('Panel with a link', () => {
  it('makes its heading a link to the view, still naming the section', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(LinkedHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const section = (fixture.nativeElement as HTMLElement).querySelector(
      'section',
    )!;
    const heading = section.querySelector('h2');
    const link = heading?.querySelector('a');

    expect(link?.getAttribute('href')).toBe('/app/driver/cars');
    expect(link?.textContent?.trim()).toBe('Mașinile mele');
    expect(heading?.classList).toContain('mf-label');
    expect(section.getAttribute('aria-labelledby')).toBe(heading?.id);
  });

  it('keeps a plain heading without a link', () => {
    const [titled] = render();

    expect(titled.querySelector('h2 a')).toBeNull();
  });
});
