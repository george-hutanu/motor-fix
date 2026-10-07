# Quickstart: Back closes the open task and keeps the page

How to prove the feature works. Design and evidence: [plan.md](./plan.md); requirements: [spec.md](./spec.md).

## Unit (jsdom)

```sh
sh scripts/heavy.sh npx nx test overlays > /tmp/overlays-test.log 2>&1; echo "exit $?"; tail -n 40 /tmp/overlays-test.log
```

Expected: `libs/overlays/src/overlays.spec.ts` and `panel.spec.ts` green, including the new cases: a `popstate` that removes the task's marker closes the top task only, with `cancelled`; a close by X, Escape, outside, drag, Discard or a result steps back first and the opener's promise settles after the step; a close while the entry is not current moves nothing; the discard question shows on Back and shows again on a second Back; the address never changes and no navigation starts.

## End to end (Playwright)

```sh
sh scripts/heavy.sh npx nx e2e web-e2e -- --grep "Back|history" > /tmp/overlays-e2e.log 2>&1; echo "exit $?"; tail -n 40 /tmp/overlays-e2e.log
```

Scenarios, in `apps/web-e2e/src/overlays.spec.ts` (computer) and `sheet.spec.ts` (390 × 844 and 320 × 640), on `/cockpit` reached from `/`:

1. Open the sample task, `page.goBack()`: the task is gone, the URL is `/cockpit`, the scroll position and focus are the ones before, the last result reads "cancelled".
2. Open, close by X, Escape, outside, the sheet's drag, Discard, or "Done" (a result); then one `page.goBack()` reaches `/`.
3. Open two stacked tasks; one `goBack()` closes the top only, a second the first; the page stays. Two closed by X, then one `goBack()` reaches `/`.
4. Type in the field, `goBack()` twice: the discard question shows and the task is still open; Discard closes it, the page stays, one more `goBack()` reaches `/`.
5. After a Back close, `page.goForward()`: no task reopens, the page stays.
6. In `sign-in.spec.ts`: sign in from `/ro`, land on the role's page, one `goBack()` returns to `/ro`.

## By hand

Serve `apps/web` (`npx nx serve web`), go to `/`, then `/cockpit`, open a task, press the browser's Back: the task closes, the page stays. Close a task with the X, press Back: `/`.
