import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CatalogueNamePipe } from './catalogue-name.pipe';
import { I18n } from './i18n';

interface Item {
  name_ro: string;
  name_en?: string | null;
}

@Component({
  imports: [CatalogueNamePipe],
  template: `<p>{{ item() | catalogueName }}</p>`,
})
class Host {
  readonly item = signal<Item>({ name_en: 'Brakes', name_ro: 'Frâne' });
}

async function render(item?: Item) {
  const fixture = TestBed.createComponent(Host);
  if (item) fixture.componentInstance.item.set(item);
  await fixture.whenStable();
  const view = fixture.nativeElement as HTMLElement;
  return { fixture, text: () => view.querySelector('p')?.textContent };
}

describe('CatalogueNamePipe', () => {
  it('shows the Romanian name in Romanian', async () => {
    const { text } = await render();

    expect(text()).toBe('Frâne');
  });

  it('follows a switch to English in the same view', async () => {
    const { fixture, text } = await render();

    await TestBed.inject(I18n).use('en');
    await fixture.whenStable();

    expect(text()).toBe('Brakes');
  });

  it.each([
    [undefined],
    [null],
    ['  '],
  ])('shows the Romanian name in English when the English one is %p', async (name_en) => {
    await TestBed.inject(I18n).use('en');
    const { text } = await render({ name_en, name_ro: 'Distribuție' });

    expect(text()).toBe('Distribuție');
  });
});
