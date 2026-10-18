import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = __dirname;
const styles = readFileSync(join(root, 'styles.css'), 'utf8');

const rule = (selector: string) => {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) return '';
  return styles.slice(start, styles.indexOf('}', start) + 1);
};

let sheet: HTMLStyleElement;
const nodes: HTMLElement[] = [];

beforeEach(() => {
  sheet = document.createElement('style');
  sheet.textContent = styles;
  document.head.append(sheet);
});

afterEach(() => {
  sheet.remove();
  for (const n of nodes.splice(0)) n.remove();
});

function region(html: string) {
  const el = document.createElement('p');
  el.className = 'mf-message';
  el.innerHTML = html;
  document.body.append(el);
  nodes.push(el);
  return el;
}

const hidden = (el: Element) => {
  const s = getComputedStyle(el);
  return s.width === '1px' && s.height === '1px' && s.position === 'absolute';
};

// @traces 248-FR-009
describe('the empty message region rule', () => {
  it('hides a region with no child visually and never with display none', () => {
    const el = region('');

    expect(hidden(el)).toBe(true);
    expect(getComputedStyle(el).display).not.toBe('none');
    expect(getComputedStyle(el).visibility).not.toBe('hidden');
  });

  it('keeps a region that holds only a comment hidden', () => {
    expect(hidden(region('<!---->'))).toBe(true);
  });

  // A whitespace text node defeats :empty; the templates never render one in
  // a region (message-regions.spec.ts checks their content), so the rule only
  // has to hold for a region that is truly empty, as above.

  it('shows the region once text arrives', () => {
    const el = region('');
    el.textContent = 'Parola e greșită';

    expect(hidden(el)).toBe(false);
    expect(getComputedStyle(el).width).not.toBe('1px');
  });

  it('hides it again when the text is cleared', () => {
    const el = region('x');
    el.textContent = '';

    expect(hidden(el)).toBe(true);
  });

  it('shows a region holding only an element', () => {
    expect(hidden(region('<span>!</span>'))).toBe(false);
  });

  it('is the shape of sr-only, so the region stays in the accessibility tree', () => {
    const body = rule('.mf-message:empty');

    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/display:\s*none/);
  });
});

// @traces 248-FR-004
describe('the focusable scroll margin', () => {
  const body = rule(
    ':where(a, button, input, select, textarea, summary, [tabindex])',
  );

  it('clears the public bar above and the tab bar and consent bar below', () => {
    expect(body).toMatch(/scroll-margin-top:[^;]*--public-site-bar/);
    expect(body).toMatch(/scroll-margin-bottom:[^;]*--tab-bar/);
    expect(body).toMatch(/scroll-margin-bottom:[^;]*--consent-bar/);
  });

  it('defaults each bar to 0px so a page without the bar still resolves a length', () => {
    expect(body).toMatch(/var\(--public-site-bar,\s*0px\)/);
    expect(body).toMatch(/var\(--tab-bar,\s*0px\)/);
    expect(body).toMatch(/var\(--consent-bar,\s*0px\)/);
  });

  it('is zero specificity, so a component can override it', () => {
    expect(styles).toMatch(
      /^:where\(a, button, input, select, textarea, summary, \[tabindex\]\) \{/m,
    );
  });

  it('exempts the controls that live inside the bars themselves', () => {
    const exempt = styles.slice(styles.indexOf('mf-public-frame > .bar'));

    for (const host of [
      'mf-public-tab-bar',
      'mf-dashboard-tab-bar',
      'mf-consent-bar',
    ]) {
      expect(exempt).toContain(host);
    }
    expect(exempt).toMatch(/scroll-margin:\s*0/);
  });
});

// @traces 248-FR-013
describe('the end-to-end axe loader', () => {
  it('is named by the one helper only', () => {
    const e2e = join(root, '..', '..', 'web-e2e', 'src');
    const users = readdirSync(e2e)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /axe\.min\.js/.test(readFileSync(join(e2e, f), 'utf8')));

    expect(users).toEqual(['axe.ts']);
  });
});
