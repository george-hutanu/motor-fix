import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Jest transform drops stylesheets, so the global rules are read from the
// source.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

// The declarations of the rule whose selector list is exactly `selector`
// (whitespace and quote style ignored), or undefined when there is none.
function rule(selector: string): string | undefined {
  const wanted = selector.replace(/\s+/g, '').replace(/'/g, '"');
  for (const [, head, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const name = head
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, '')
      .replace(/'/g, '"');
    if (name === wanted) return body;
  }
  return undefined;
}

// @traces 248-FR-009
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

// @traces 248-FR-004
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
      `:where(mf-public-frame > .bar, mf-public-tab-bar, mf-dashboard-tab-bar, mf-consent-bar, mf-list-your-garage nav, mf-list-your-garage .actions, mf-signup-survey .footer, mf-request-drawer .actions) ${FOCUSABLES}`,
    );

    expect(body).toBeDefined();
    expect(body).toMatch(/scroll-margin:\s*0/);
  });

  // On a phone the results list scrolls inside its sheet, a box often shorter
  // than the bars' room together: there a focused control keeps only a small
  // gap to the box's edges, or the sheet would scroll it past its own top,
  // under the brand chips.
  it("keeps only a small gap inside the phone's results sheet", () => {
    const sheet = 'mf-results-sheet > .body';
    const body = rule(`${sheet} ${FOCUSABLES}`);

    expect(body).toMatch(/scroll-margin:\s*var\(--mf-space-2\)/);
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{\s*mf-results-sheet\s*>\s*\.body\s*:where\(/,
    );
  });
});

// @traces 274-FR-018
describe('the one action of an empty state on a 320 px phone', () => {
  it('narrows its tracking with the viewport so the label breaks only between words', () => {
    const body = rule('mf-empty-state a[hlmBtn]') ?? '';

    expect(body).toMatch(
      /letter-spacing:\s*min\(var\(--mf-label-tracking\),[^;]*vw\)/,
    );
  });

  // The grid check measures padding in whole 4 px steps, so the narrow phone
  // gets a fixed step, never a share of the viewport.
  it('keeps its padding on the 4 px grid, a fixed step on a narrow phone', () => {
    const body = rule('mf-empty-state a[hlmBtn]') ?? '';

    expect(body).not.toMatch(/padding[^;]*vw/);
    expect(css).toMatch(
      /@media \(max-width: 389px\) \{\s*mf-empty-state a\[hlmBtn\] \{\s*padding-inline:\s*var\(--mf-space-3\);\s*\}/,
    );
  });
});

// @traces 006-FR-010
describe('the voice texts the page carries for every voice', () => {
  const shown = [
    "html:not([data-voice]) [data-voice-of='1']",
    ...[1, 2, 3, 4, 5].map(
      (n) => `html[data-voice='${n}'] [data-voice-of='${n}']`,
    ),
  ].join(',');

  it('hides each voice’s texts from sight and from screen readers', () => {
    expect(rule('[data-voice-of]')).toMatch(/display:\s*none/);
  });

  it('shows only the texts of the voice the page is marked with, voice 1 without a mark', () => {
    expect(rule(shown)).toMatch(/display:\s*contents/);
  });
});

// A field on Results takes text: the tab bar hides, the consent bar may ask,
// and on a 320 px phone the sheet's low position rises over the map's zoom
// buttons, whose zoom-out would sit under the sheet's handle.
describe('the map’s zoom buttons while Results takes text on a phone', () => {
  it('hides them, out of reach and out of the way of the sheet', () => {
    const body = rule(
      'mf-results:has(mf-results-sheet.typing) mf-results-map .maplibregl-ctrl-top-right',
    );

    expect(body).toBeDefined();
    expect(body).toMatch(/visibility:\s*hidden/);
  });
});

// 1196: on a phone the static map's control sits where the zoom buttons do,
// and gives way to the sheet and the keyboard as they do.
describe('the static map’s control on a phone', () => {
  it.each(['typing', 'over-zoom'])(
    'hides it while the sheet is %s',
    (state) => {
      const body = rule(
        `mf-results:has(mf-results-sheet.${state}) mf-results-map mf-static-map button`,
      );

      expect(body).toBeDefined();
      expect(body).toMatch(/visibility:\s*hidden/);
    },
  );
});

// The sheet's top edge over the zoom buttons (full, or any rest of a stage
// too short to clear them): they hide rather than lie under its handle.
describe('the map’s zoom buttons under the Results sheet on a phone', () => {
  it('hides them while the sheet covers them', () => {
    const body = rule(
      'mf-results:has(mf-results-sheet.over-zoom) mf-results-map .maplibregl-ctrl-top-right',
    );

    expect(body).toBeDefined();
    expect(body).toMatch(/visibility:\s*hidden/);
  });
});

// On a stage too short for the half sheet to clear the map's top (a 320 x 568
// phone), the sheet would cut the legend's lower rows: it hides with the zoom
// buttons and shows again at low.
// @traces 1351-FR-001 1351-FR-007
describe('the map’s legend under the Results sheet on a phone', () => {
  it('hides it whole while the sheet covers the map’s top', () => {
    const body = rule(
      'mf-results:has(mf-results-sheet.over-zoom) mf-results-map .legend',
    );

    expect(body).toBeDefined();
    expect(body).toMatch(/visibility:\s*hidden/);
  });
});

// @traces 248-FR-001
describe('the toasts on a phone', () => {
  // Sonner pins its bottom toasts 20 px over the screen's edge on a phone,
  // over the tab bar, and holds one while a finger rests on it: a tab under
  // it could not be tapped.
  it('sit above the tab bar and the consent bar', () => {
    const body = rule(":root [data-sonner-toaster][data-y-position='bottom']");
    const bottom = body?.match(/bottom:([^;]*)/)?.[1] ?? '';

    expect(bottom).toMatch(/var\(--tab-bar,\s*0px\)/);
    expect(bottom).toMatch(/var\(--consent-bar,\s*0px\)/);
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{\s*:root\s*\[data-sonner-toaster\]\[data-y-position=["']bottom["']\]\s*\{/,
    );
  });
});
