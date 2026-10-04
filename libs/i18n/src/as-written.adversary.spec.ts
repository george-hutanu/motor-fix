import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AsWritten } from './as-written';
import { I18n } from './i18n';

@Component({
  imports: [AsWritten],
  template: `<mf-as-written [text]="text()" />`,
})
class Host {
  readonly text = signal('');
}

async function render(text: string) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.text.set(text);
  await fixture.whenStable();
  const host = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-as-written',
  ) as HTMLElement;
  return { fixture, host };
}

describe('AsWritten adversarial', () => {
  it('marks the display so browser translation leaves it alone', async () => {
    const { host } = await render('Salut');
    expect(host.getAttribute('translate')).toBe('no');
  });

  it('shows markup as literal text without creating elements', async () => {
    const text = '<b>bold</b><img src=x onerror=alert(1)>';
    const { host } = await render(text);
    expect(host.textContent).toBe(text);
    expect(host.querySelector('b, img')).toBeNull();
  });

  it('shows an empty text as nothing', async () => {
    const { host } = await render('');
    expect(host.textContent).toBe('');
  });

  it('keeps whitespace, newlines and edge spaces exactly', async () => {
    const text = '  a\n\n  b\t c  ';
    const { host } = await render(text);
    expect(host.textContent).toBe(text);
  });

  it('keeps unicode, emoji and the non-breaking hyphen intact', async () => {
    const text = 'Ștefan Țărnă \u{1F697} service‑ul 日本語 مرحبا';
    const { host } = await render(text);
    expect(host.textContent).toBe(text);
  });

  it('keeps a plain hyphen as written', async () => {
    const { host } = await render('service-ul');
    expect(host.textContent).toBe('service-ul');
  });

  it.each([
    'shell.brand',
    'garage.title',
    '{{ 1 + 1 }}',
    '{name}',
    '$t(shell.brand)',
  ])('shows %s literally', async (text) => {
    const { host } = await render(text);
    expect(host.textContent).toBe(text);
  });

  it('shows a very long text in full', async () => {
    const text = 'cuvânt '.repeat(20000);
    const { host } = await render(text);
    expect(host.textContent).toBe(text);
  });

  it('does not change when the language changes', async () => {
    const review = 'Mi-au schimbat plăcuțele';
    const { fixture, host } = await render(review);
    await TestBed.inject(I18n).use('en');
    await fixture.whenStable();
    expect(host.textContent).toBe(review);
    await TestBed.inject(I18n).use('ro');
    await fixture.whenStable();
    expect(host.textContent).toBe(review);
  });

  it('follows a changed input text', async () => {
    const { fixture, host } = await render('unu');
    fixture.componentInstance.text.set('doi');
    await fixture.whenStable();
    expect(host.textContent).toBe('doi');
  });

  it('offers no interactive control', async () => {
    const { host } = await render('Atelier Dinamo');
    expect(
      host.querySelector('button, a, input, select, [role], [tabindex]'),
    ).toBeNull();
  });
});
