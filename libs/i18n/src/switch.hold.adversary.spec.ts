import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';

import { I18n } from './i18n';
import {
  LanguageChoice,
  LanguageSwitch,
  provideRememberedLanguage,
} from './switch';

@Component({ imports: [LanguageSwitch], template: '<mf-language-switch />' })
class Host {}

async function start() {
  TestBed.configureTestingModule({ providers: [provideRememberedLanguage()] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  await settle();
  await fixture.whenStable();
  return {
    choice: TestBed.inject(LanguageChoice),
    i18n: TestBed.inject(I18n),
  };
}

async function otherTab(newValue: string | null, key = 'mf.lang') {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  await settle();
}

// A switch waits for its texts, loaded by a real import() that can take longer
// than a tick; waiting ends once every switch so far has finished.
let use: MockInstance<I18n['use']>;
beforeEach(() => {
  use = vi.spyOn(I18n.prototype, 'use');
});
async function settle() {
  await Promise.all(use.mock.results.map((result) => result.value));
  await new Promise((resolve) => setTimeout(resolve));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('LanguageChoice.hold under hostile use', () => {
  // @traces 468-FR-001
  it('keeps a later hold closed when a stale release of an earlier hold is called again', async () => {
    const { choice, i18n } = await start();
    const first = choice.hold();
    first();
    const second = choice.hold();

    first();
    await otherTab('en');

    expect(i18n.language()).toBe('ro');
    second();
  });

  // @traces 468-FR-001
  it('does not replay an ignored event when the hold is released', async () => {
    const { choice, i18n } = await start();
    const release = choice.hold();
    await otherTab('en');

    release();
    await settle();

    expect(i18n.language()).toBe('ro');
  });

  // @traces 468-FR-001
  it('follows the next event after the last of ten thousand holds is released', async () => {
    const { choice, i18n } = await start();
    const releases = Array.from({ length: 10_000 }, () => choice.hold());

    for (const release of releases.slice(0, -1)) release();
    await otherTab('en');
    expect(i18n.language()).toBe('ro');

    releases[releases.length - 1]();
    for (const release of releases) release();
    await otherTab('en');

    expect(i18n.language()).toBe('en');
  });

  // @traces 468-FR-001
  it('ignores a value that is not a language whether or not a hold is open', async () => {
    const { choice, i18n } = await start();

    await otherTab('xx');
    const release = choice.hold();
    await otherTab('xx');
    release();
    await otherTab('xx');

    expect(i18n.language()).toBe('ro');
  });

  // @traces 468-FR-001
  it("applies this tab's own choice under a hold and then still ignores the other tab", async () => {
    const { choice, i18n } = await start();
    choice.hold();

    await choice.choose('en');
    await otherTab('ro');

    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  // @traces 468-FR-001
  it('keeps ignoring the other tab for a hold taken before the first render finished', async () => {
    TestBed.configureTestingModule({
      providers: [provideRememberedLanguage()],
    });
    const choice = TestBed.inject(LanguageChoice);
    const release = choice.hold();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();

    await otherTab('en');

    expect(TestBed.inject(I18n).language()).toBe('ro');
    release();
  });

  // @traces 468-FR-001
  it("holds each tab's own service independently of another injector's hold", async () => {
    const { i18n } = await start();
    const stranger = TestBed.inject(LanguageChoice);
    const release = stranger.hold();
    release();

    await otherTab('en');

    expect(i18n.language()).toBe('en');
  });

  // @traces 468-FR-001
  it('still ignores events for other keys while held and after release', async () => {
    const { choice, i18n } = await start();
    const release = choice.hold();
    await otherTab('en', 'other');
    release();
    await otherTab('en', 'other');

    expect(i18n.language()).toBe('ro');
  });
});
