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

describe('AsWritten', () => {
  it('shows a Romanian review exactly as written under English, with no translate control', async () => {
    const review = 'Mi-au schimbat plăcuțele în 2 ore. Recomand!';
    await TestBed.inject(I18n).use('en');
    const { host } = await render(review);

    expect(host.textContent).toBe(review);
    expect(host.querySelector('button, a, [role="button"]')).toBeNull();
  });

  it('shows a text that equals a translation key as that text', async () => {
    const { host } = await render('shell.brand');

    expect(host.textContent).toBe('shell.brand');
  });

  it('tells the browser not to translate it', async () => {
    const { host } = await render('Atelier Dinamo');

    expect(host.getAttribute('translate')).toBe('no');
  });

  it('keeps names unchanged when the language changes', async () => {
    const { fixture, host } = await render('Andrei M. · Dacia');

    await TestBed.inject(I18n).use('en');
    await fixture.whenStable();

    expect(host.textContent).toBe('Andrei M. · Dacia');
  });

  it('shows nothing for an empty text', async () => {
    const { host } = await render('');

    expect(host.textContent).toBe('');
  });
});
