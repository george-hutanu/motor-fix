import { ComponentFixture, getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import '@motor-fix/media/testing';

import { FILES, type Texts } from '../../../libs/i18n/src/files';

// The Angular unit-test builder initialises TestBed before this file; a run
// of Vitest on its own (Stryker, the edit hooks) does it here.
if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting(),
    { errorOnUnknownElements: true, errorOnUnknownProperties: true },
  );
}

// Two habits Jest allowed and the builder does not. A vi.mock factory runs
// above the bundle's helpers, and the build lowers an object spread to one of
// them: a factory builds its object with Object.assign. A setup hook that
// returns a function has it called as its cleanup: a hook that clears a mock
// keeps it in braces.

// Code loaded on demand (`import()` of a dialog or a view) arrives a task
// later under Vitest's module runner, where Jest's require-backed import()
// settled within the same microtasks. A fixture counts as stable once that
// task has run too. Under a faked clock the spec drives the tasks itself, and
// a real one would only stall it.
{
  const whenStable = ComponentFixture.prototype.whenStable;
  ComponentFixture.prototype.whenStable = async function (
    this: ComponentFixture<unknown>,
  ) {
    const stable = await whenStable.call(this);
    if (!vi.isFakeTimers()) await vi.dynamicImportSettled();
    return stable;
  };
}

// An area's texts arrive through import(), which under Vitest's module runner
// takes tasks, not microtasks, so a spec that switches language and flushes a
// few times, or fakes the clock, read Romanian or hung. Each file is read once
// here and handed back already resolved, as Jest's require-backed import() did.
for (const loaders of Object.values(FILES) as Record<
  string,
  () => Promise<Texts>
>[]) {
  for (const [language, load] of Object.entries(loaders)) {
    const texts = await load();
    loaders[language] = () => Promise.resolve(texts);
  }
}

// The server specs run in node (the test-node target): the browser shims
// below apply only where there is a window.
if (typeof window !== 'undefined') {
  // jsdom has no matchMedia; the dashboard's toaster reads the colour-scheme query.
  globalThis.matchMedia ??= (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: false,
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;

  // jsdom has no element scrolling; the results sheet scrolls its list to the top.
  Element.prototype.scrollTo ??= () => undefined;
}
