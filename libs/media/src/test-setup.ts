import { getTestBed } from '@angular/core/testing';
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
