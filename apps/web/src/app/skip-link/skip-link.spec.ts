import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { SkipLink } from './skip-link';

// The Jest transform drops component styles and keeps templates inline, so
// the shell template and the stylesheet are read from the source.
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

const mains: HTMLElement[] = [];

function addMain(id?: string) {
  const main = document.createElement('main');
  if (id) main.id = id;
  document.body.append(main);
  mains.push(main);
  return main;
}

async function render() {
  const fixture = TestBed.createComponent(SkipLink);
  fixture.detectChanges();
  await fixture.whenStable();
  const link = (fixture.nativeElement as HTMLElement).querySelector(
    'a',
  ) as HTMLAnchorElement;
  return { fixture, link };
}

afterEach(() => {
  for (const main of mains.splice(0)) main.remove();
});

// @traces 248-launch-screens-accessible-FR-006
describe('the skip link', () => {
  it('reads "Sari la conținut" and points at the main content', async () => {
    const { link } = await render();

    expect(link.getAttribute('href')).toBe('#main');
    expect(link.textContent?.trim()).toBe('Sari la conținut');
  });

  it('reads "Skip to content" in English', async () => {
    const { fixture, link } = await render();

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(link.textContent?.trim()).toBe('Skip to content');
  });

  it('moves the focus to the first main on a click, without changing the address', async () => {
    const first = addMain();
    addMain();
    const { link } = await render();
    const before = location.href;

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(location.href).toBe(before);
    expect(document.activeElement).toBe(first);
    expect(first.getAttribute('tabindex')).toBe('-1');
  });

  it('leaves the focus where it was when the page has no main', async () => {
    const { link } = await render();
    link.focus();

    link.click();

    expect(document.activeElement).toBe(link);
  });

  it('is the first thing in the app shell, so it is the first stop of Tab on every route', () => {
    const shell = read('../app.html').trim();

    expect(shell.startsWith('<mf-skip-link />')).toBe(true);
  });

  it('finds its target on every page: each main in the app is the #main it points at', () => {
    const app = join(__dirname, '..');
    const templates = readdirSync(app, { encoding: 'utf8', recursive: true })
      .filter((file) => file.endsWith('.html'))
      .map((file) => readFileSync(join(app, file), 'utf8'));
    const mains = templates.flatMap(
      (html) => html.match(/<main\b[^>]*>/g) ?? [],
    );

    expect(mains.length).toBeGreaterThan(0);
    expect(mains.filter((tag) => !/\bid="main"/.test(tag))).toEqual([]);
  });

  it('stays out of sight until it has the keyboard focus, with no transition', () => {
    const css = read('skip-link.css');

    expect(css).toMatch(/:focus-visible/);
    expect(css).not.toMatch(/transition|animation/);
  });
});
