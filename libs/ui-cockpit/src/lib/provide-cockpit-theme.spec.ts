import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { provideCockpitTheme } from './provide-cockpit-theme';

const css = readFileSync(join(__dirname, '../styles/cockpit.css'), 'utf8');
const background = (scheme: 'dark' | 'light') => {
  const block =
    scheme === 'dark'
      ? css
      : css.slice(css.indexOf('@media (prefers-color-scheme: light)'));
  return /--mf-bg:\s*([^;]+);/.exec(block)?.[1];
};

describe('provideCockpitTheme', () => {
  afterEach(() => {
    for (const tag of document.head.querySelectorAll(
      'meta[name="theme-color"]',
    ))
      tag.remove();
  });

  it('keeps overlays out of the browser top layer so toasts stay above them', () => {
    TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });

    expect(TestBed.inject(OVERLAY_DEFAULT_CONFIG)).toEqual({
      usePopover: false,
    });
  });

  it('colours the browser bar with the page background of each scheme', () => {
    TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
    const head = TestBed.inject(DOCUMENT).head;

    const tags = [...head.querySelectorAll('meta[name="theme-color"]')].map(
      (tag) => [tag.getAttribute('media'), tag.getAttribute('content')],
    );

    expect(tags).toEqual([
      ['(prefers-color-scheme: dark)', background('dark')],
      ['(prefers-color-scheme: light)', background('light')],
    ]);
    expect(background('dark')).toBe('#0b0c0e');
    expect(background('light')).toBe('#f4f4f1');
  });

  it('adds the tags once when the page that has them starts again', () => {
    TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
    TestBed.inject(DOCUMENT);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideCockpitTheme()] });
    TestBed.inject(DOCUMENT);

    expect(
      document.head.querySelectorAll('meta[name="theme-color"]'),
    ).toHaveLength(2);
  });
});
