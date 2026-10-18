import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { SkipLink } from './skip-link';

const added: HTMLElement[] = [];

function addMain(attrs: Record<string, string> = {}) {
  const main = document.createElement('main');
  for (const [name, value] of Object.entries(attrs))
    main.setAttribute(name, value);
  document.body.append(main);
  added.push(main);
  return main;
}

async function render(language: 'ro' | 'en' = 'ro') {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(SkipLink);
  fixture.detectChanges();
  await fixture.whenStable();
  const link = (fixture.nativeElement as HTMLElement).querySelector(
    'a',
  ) as HTMLAnchorElement;
  return { fixture, link };
}

afterEach(() => {
  for (const el of added.splice(0)) el.remove();
});

// @traces 248-FR-006
describe('the skip link, attacked', () => {
  it('moves the focus to main when activated twice in a row and stays there', async () => {
    const main = addMain();
    const { link } = await render();

    link.click();
    link.click();

    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('cancels the navigation of a keyboard Enter, so the address never gains a hash', async () => {
    addMain();
    const { link } = await render();
    const before = location.href;

    link.focus();
    link.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
    );
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 0,
    });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(location.href).toBe(before);
  });

  it('keeps a main that is already focusable at its own tabindex', async () => {
    const main = addMain({ tabindex: '0' });
    const { link } = await render();

    link.click();

    expect(main.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(main);
  });

  it('still prevents the default action when the page has no main', async () => {
    const { link } = await render();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });

    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(location.hash).toBe('');
  });

  it('is a single link whose only job is the skip, with an accessible name in both languages', async () => {
    const { fixture } = await render();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('a')).toHaveLength(1);
    expect(el.querySelectorAll('a')[0].getAttribute('aria-hidden')).toBeNull();
    expect(el.querySelectorAll('a')[0].getAttribute('tabindex')).toBeNull();
  });
});
