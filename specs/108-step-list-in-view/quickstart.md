# Quickstart: Move through the six steps with the step list in view (ST-108)

How to run and verify the page. Details: [contracts/page.md](./contracts/page.md),
[data-model.md](./data-model.md).

## Prerequisites

- Node 24, `npm ci` done; no database or Redis is needed for this page's
  tests (the web dev server and the Jest specs run without them; the
  Playwright suite starts the api and worker, which need `docker compose up -d`).
- Heavy commands go through `scripts/heavy.sh`.

## Unit tests (Jest, jsdom)

```sh
scripts/heavy.sh npx nx test web -- --testPathPatterns 'public/(steps|list-your-garage)' > /tmp/st108-jest.log 2>&1; echo "exit $?"; tail -n 40 /tmp/st108-jest.log
scripts/heavy.sh npx nx test web -- --testPathPatterns 'server/search' > /tmp/st108-sitemap.log 2>&1; echo "exit $?"; tail -n 20 /tmp/st108-sitemap.log
```

Expected: `steps.spec.ts` proves `currentStep` returns 1 before any heading
reaches the line, the last heading at or above it otherwise, and 6 at the
end, and that the six labels resolve in Romanian and English;
`list-your-garage.spec.ts` renders both addresses under
`RouterTestingHarness` (label, heading, introduction, six `h2`, one `nav`
named "Pași" / "Steps", step 1 current, the bar reading "1 / 6 · Service-ul",
Escape closing the list) and the server render (`PLATFORM_ID: 'server'`) with
step 1 current and no listener; `search.spec.ts` lists both addresses in
the sitemap.

## By hand

```sh
scripts/heavy.sh npx nx run web:serve   # http://localhost:4200
```

1. Open `/ro/list-your-garage` at 1280 px: label, heading, intro, the list
   "Pași" beside six numbered headings, step 1 highlighted. Scroll: the
   highlight follows; at the bottom step 6 is highlighted. Tap "4 Mecanici":
   section 4 is under the header and its heading has the focus ring.
2. Resize to 390 px: the list is a bar under the top edge reading
   "1 / 6 · Service-ul"; tap it, tap "5 Fotografii și adresă": the list
   closes, section 5 is under the bar, the bar reads "5 / 6 · Fotografii și
   adresă". Open it again and press Escape: closed, focus on the bar.
3. Switch EN in the page header: the address is `/en/list-your-garage`, every
   text is English, the same step stays current, the tab title is "Put your
   garage on the map".
4. Open `/ro/list-your-garage#pasul-4` fresh: the page lands on section 4 and
   the list highlights it before any script, then follows the scroll.
5. 320 px: no sideways scroll; the bar's text is one line with an ellipsis.
6. `view-source:` of `/ro/list-your-garage`: the `nav`, the six sections and
   `aria-current="step"` on step 1 are in the server's HTML.

## End to end (Playwright)

```sh
scripts/heavy.sh npx nx e2e web-e2e -- --grep 'list-your-garage|on a phone' > /tmp/st108-e2e.log 2>&1; echo "exit $?"; tail -n 40 /tmp/st108-e2e.log
```

Expected: `list-your-garage.spec.ts` passes on the desktop (each of the six
entries jumps, focuses the heading and is the one `aria-current="step"`),
at 390 px (bar text follows the scroll; open → step 5 → closed and current;
Escape returns focus to the bar) and under `reducedMotion: 'reduce'` (the
jump lands at once); `phone.spec.ts` passes for both new addresses (no
sideways scroll at 320 px, no text under 12 px, no target under 44 px).

## Checks

```sh
npx biome check apps/web/src/app/public libs/i18n/src/public apps/web-e2e/src
scripts/heavy.sh npx nx typecheck web
node .claude/scripts/trace-matrix.mjs      # FR-001 … FR-012 each covered
```
