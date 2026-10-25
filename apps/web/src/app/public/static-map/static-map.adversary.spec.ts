import { PLATFORM_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { staticMapPath } from '@motor-fix/contracts/map-view';
import { I18n } from '@motor-fix/i18n';

import { StaticMap } from './static-map';

const VIEW = { center: { lat: 44.43, lng: 26.1 }, zoom: 12 };
let box = { height: 500, width: 390 };
let fixture: ComponentFixture<StaticMap>;
const element = () => fixture.nativeElement as HTMLElement;
const image = () => element().querySelector('img');
const activated = jest.fn();
const win = window as unknown as { matchMedia?: unknown };

async function render(withMedia = true) {
  if (withMedia) {
    win.matchMedia = jest.fn(() => ({
      addEventListener: jest.fn(),
      matches: false,
      removeEventListener: jest.fn(),
    }));
  }
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(StaticMap);
  fixture.componentRef.setInput('view', VIEW);
  fixture.componentRef.setInput('pins', { pins: [], total: 0 });
  fixture.componentInstance.activate.subscribe(activated);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

beforeEach(() => {
  box = { height: 500, width: 390 };
  activated.mockClear();
  jest
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => box.width);
  jest
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(() => box.height);
});

afterEach(() => {
  delete win.matchMedia;
  jest.restoreAllMocks();
});

// @traces 1196-FR-013
describe('StaticMap, hostile boxes', () => {
  it('asks for the largest allowed image for a box bigger than any bucket', async () => {
    box = { height: 3000, width: 4000 };
    await render();

    expect(image()?.getAttribute('src')).toBe(
      staticMapPath({
        h: 1024,
        lat: 44.43,
        lng: 26.1,
        theme: 'light',
        w: 1280,
        z: 12,
      }),
    );
  });

  it('asks for no image while the box has no size', async () => {
    box = { height: 0, width: 0 };
    await render();

    expect(image()).toBeNull();
    expect(element().querySelector('.blank')).not.toBeNull();
  });

  it('asks for no image while only one side of the box has size', async () => {
    box = { height: 500, width: 0 };
    await render();

    expect(image()).toBeNull();
  });

  it('asks for the light image on a browser with no matchMedia', async () => {
    await render(false);

    expect(image()?.getAttribute('src')).toContain('theme=light');
  });

  it('keeps the same image for a box that stays in its buckets', async () => {
    await render();
    const first = image()?.getAttribute('src');
    box = { height: 520, width: 380 };
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toBe(first);
  });
});

// @traces 1196-FR-015
describe('StaticMap, activation', () => {
  it('asks for the interactive map once, not twice, when the control inside the host is clicked', async () => {
    await render();
    element().querySelector('button')?.click();

    expect(activated).toHaveBeenCalledTimes(1);
  });

  it('asks again for each further tap, so the host decides to ignore it', async () => {
    await render();
    element().click();
    element().click();

    expect(activated).toHaveBeenCalledTimes(2);
  });

  it('keeps the button as the only element in the tab order', async () => {
    await render();
    const focusable = element().querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    expect(focusable).toHaveLength(1);
    expect(focusable[0].tagName).toBe('BUTTON');
  });
});
