import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Jest transform drops stylesheets, so the global rules are read from the
// source.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

// The declarations of the rule whose selector list is exactly `selector`
// (whitespace ignored), or undefined when there is none.
function rule(selector: string): string | undefined {
  const wanted = selector.replace(/\s+/g, '');
  for (const [, head, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = head.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
    if (name === wanted) return body;
  }
  return undefined;
}

// @traces 248-launch-screens-accessible-FR-009
describe('the shared rule for an empty message region', () => {
  it('hides an empty .mf-message visually and keeps it in the accessibility tree', () => {
    const body = rule('.mf-message:empty');

    expect(body).toBeDefined();
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/width:\s*1px/);
    expect(body).toMatch(/height:\s*1px/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
  });
});

// @traces 248-launch-screens-accessible-FR-004
describe('the room a focused control keeps clear of the bars', () => {
  const FOCUSABLES =
    ':where(a, button, input, select, textarea, summary, [tabindex])';

  it('scrolls a focused control below the sticky site bar', () => {
    const body = rule(FOCUSABLES);

    expect(body).toBeDefined();
    expect(body).toMatch(/scroll-margin-top:[^;]*var\(--public-site-bar/);
  });

  it('scrolls a focused control above the tab bar and the consent bar', () => {
    const body = rule(FOCUSABLES) ?? '';
    const bottom = body.match(/scroll-margin-bottom:([^;]*)/)?.[1] ?? '';

    expect(bottom).toMatch(/var\(--tab-bar/);
    expect(bottom).toMatch(/var\(--consent-bar/);
  });

  it('keeps no room around a control inside a bar, which never scrolls away', () => {
    const body = rule(
      `:where(mf-public-frame > .bar, mf-public-tab-bar, mf-dashboard-tab-bar, mf-consent-bar) ${FOCUSABLES}`,
    );

    expect(body).toBeDefined();
    expect(body).toMatch(/scroll-margin:\s*0/);
  });
});
