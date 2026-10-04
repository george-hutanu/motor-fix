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

async function show(item: Item, language: 'ro' | 'en') {
  await TestBed.inject(I18n).use(language);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.item.set(item);
  await fixture.whenStable();
  return {
    fixture,
    text: () =>
      (fixture.nativeElement as HTMLElement).querySelector('p')?.textContent,
  };
}

describe('CatalogueNamePipe adversarial', () => {
  it('shows the English name under English', async () => {
    const { text } = await show({ name_en: 'Brakes', name_ro: 'Frâne' }, 'en');
    expect(text()).toBe('Brakes');
  });

  it('falls back to Romanian when the English name is missing', async () => {
    const { text } = await show({ name_ro: 'Frâne' }, 'en');
    expect(text()).toBe('Frâne');
  });

  it('falls back to Romanian when the English name is null', async () => {
    const { text } = await show({ name_en: null, name_ro: 'Frâne' }, 'en');
    expect(text()).toBe('Frâne');
  });

  it('falls back to Romanian when the English name is empty', async () => {
    const { text } = await show({ name_en: '', name_ro: 'Frâne' }, 'en');
    expect(text()).toBe('Frâne');
  });

  it('falls back to Romanian when the English name is only whitespace', async () => {
    const { text } = await show({ name_en: ' \t\n ', name_ro: 'Frâne' }, 'en');
    expect(text()).toBe('Frâne');
  });

  it('ignores a present English name under Romanian', async () => {
    const { text } = await show({ name_en: 'Brakes', name_ro: 'Frâne' }, 'ro');
    expect(text()).toBe('Frâne');
  });

  it('shows names that look like translation keys literally', async () => {
    const { text } = await show(
      { name_en: 'shell.brand', name_ro: 'shell.brand' },
      'en',
    );
    expect(text()).toBe('shell.brand');
  });

  it('renders markup in a name as text', async () => {
    const { fixture, text } = await show(
      { name_en: '<b>Brakes</b>', name_ro: 'x' },
      'en',
    );
    expect(text()).toBe('<b>Brakes</b>');
    expect(fixture.nativeElement.querySelector('b')).toBeNull();
  });

  it('keeps the English name exactly, including edge spaces and unicode', async () => {
    const { text } = await show(
      { name_en: ' Brakes ‑ ABS ', name_ro: 'x' },
      'en',
    );
    expect(text()).toBe(' Brakes ‑ ABS ');
  });

  it('switches back and forth without a reload', async () => {
    const { fixture, text } = await show(
      { name_en: 'Brakes', name_ro: 'Frâne' },
      'ro',
    );
    const i18n = TestBed.inject(I18n);
    await i18n.use('en');
    await fixture.whenStable();
    expect(text()).toBe('Brakes');
    await i18n.use('ro');
    await fixture.whenStable();
    expect(text()).toBe('Frâne');
  });

  it('follows a new item in the same language', async () => {
    const { fixture, text } = await show(
      { name_en: 'Brakes', name_ro: 'Frâne' },
      'en',
    );
    fixture.componentInstance.item.set({ name_en: 'Oil', name_ro: 'Ulei' });
    await fixture.whenStable();
    expect(text()).toBe('Oil');
  });
});
