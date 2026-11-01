import { ComponentFixture, getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import '@motor-fix/media/testing';

// The Angular unit-test builder initialises TestBed before this file; a run
// of Vitest on its own (Stryker, the edit hooks) does it here.
if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting(),
    { errorOnUnknownElements: true, errorOnUnknownProperties: true },
  );
}

// Code loaded on demand (`import()` of a dialog or a view) arrives a task
// later under Vitest's module runner, where Jest's require-backed import()
// settled within the same microtasks. A fixture counts as stable once that
// task has run too; the timer is the real one, whatever a spec fakes.
{
  const realTimeout = globalThis.setTimeout;
  const whenStable = ComponentFixture.prototype.whenStable;
  ComponentFixture.prototype.whenStable = async function (
    this: ComponentFixture<unknown>,
  ) {
    const stable = await whenStable.call(this);
    await new Promise((resolve) => realTimeout(resolve, 0));
    return stable;
  };
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
