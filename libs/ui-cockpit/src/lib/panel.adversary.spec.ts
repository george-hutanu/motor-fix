import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Panel } from './panel';

@Component({
  imports: [Panel],
  template: `
    <mf-panel [heading]="heading()" [link]="link()"><p>x</p></mf-panel>
  `,
})
class Host {
  readonly heading = signal<string | undefined>('Oferte primite');
  readonly link = signal<string[] | string | undefined>(undefined);
}

async function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}
const section = (f: { nativeElement: HTMLElement }) =>
  f.nativeElement.querySelector('section')!;

afterEach(() => TestBed.resetTestingModule());

describe('Panel link under change', () => {
  it('keeps a plain heading with no anchor when no link is given', async () => {
    const f = await render();

    expect(section(f).querySelector('h2')?.textContent?.trim()).toBe(
      'Oferte primite',
    );
    expect(section(f).querySelector('h2 a')).toBeNull();
  });

  it('adds the anchor when a link arrives later and drops it when it goes away', async () => {
    const f = await render();
    f.componentInstance.link.set(['/app', 'driver', 'requests']);
    f.detectChanges();
    await f.whenStable();
    expect(section(f).querySelector('h2 a')?.getAttribute('href')).toBe(
      '/app/driver/requests',
    );

    f.componentInstance.link.set(undefined);
    f.detectChanges();
    await f.whenStable();
    expect(section(f).querySelector('h2 a')).toBeNull();
    expect(section(f).querySelector('h2')?.textContent?.trim()).toBe(
      'Oferte primite',
    );
  });

  it('accepts a string link', async () => {
    const f = await render();
    f.componentInstance.link.set('/app/driver/cars');
    f.detectChanges();
    await f.whenStable();

    expect(section(f).querySelector('h2 a')?.getAttribute('href')).toBe(
      '/app/driver/cars',
    );
  });

  it('draws no heading and no anchor for a link without a heading', async () => {
    const f = await render();
    f.componentInstance.heading.set(undefined);
    f.componentInstance.link.set(['/app']);
    f.detectChanges();
    await f.whenStable();

    expect(section(f).querySelector('a')).toBeNull();
    expect(section(f).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('keeps a heading that holds markup-like text as text', async () => {
    const f = await render();
    f.componentInstance.heading.set('<img src=x onerror=alert(1)>');
    f.componentInstance.link.set(['/app']);
    f.detectChanges();
    await f.whenStable();

    expect(section(f).querySelector('img')).toBeNull();
    expect(section(f).querySelector('h2 a')?.textContent?.trim()).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
