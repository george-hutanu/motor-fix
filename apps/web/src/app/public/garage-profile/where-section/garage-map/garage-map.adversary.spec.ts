import { PLATFORM_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { GARAGE_MAP, GarageMap } from './garage-map';
import { StaticMap } from '../../../static-map/static-map';

jest.mock('maplibre-gl', () =>
  jest.requireActual('../../../place-step/place-step.testing'),
);

const POINT = { lat: 44.4352671, lng: 26.0123456 };
const destroy = jest.fn();
const gone = jest.fn();
let opened: (value: { destroy(): void }) => void;
let refused: (error: unknown) => void;
let open: jest.Mock;

let fixture: ComponentFixture<GarageMap>;
const element = () => fixture.nativeElement as HTMLElement;
const still = () => element().querySelector('mf-static-map');
const piece = () =>
  fixture.debugElement.query(By.directive(StaticMap))
    ?.componentInstance as StaticMap;

async function render(opener?: jest.Mock, km?: number) {
  open =
    opener ??
    jest.fn(
      () =>
        new Promise<{ destroy(): void }>((resolve, reject) => {
          opened = resolve;
          refused = reject;
        }),
    );
  TestBed.configureTestingModule({
    providers: [
      { provide: GARAGE_MAP, useValue: open },
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: REDUCED_MOTION, useValue: signal(false) },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(GarageMap);
  fixture.componentRef.setInput('point', POINT);
  if (km !== undefined) fixture.componentRef.setInput('km', km);
  fixture.componentInstance.gone.subscribe(gone);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function tap() {
  element().querySelector<HTMLElement>('mf-static-map button')?.click();
  fixture.detectChanges();
}

beforeEach(() => {
  destroy.mockClear();
  gone.mockClear();
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
});

afterEach(() => jest.restoreAllMocks());

// @traces 1366-FR-006
describe('GarageMap, failing in odd orders', () => {
  // @traces 1383-FR-006
  // @traces 1383-FR-008
  it('says it is gone once when the image of an area fails twice', async () => {
    await render(undefined, 20);
    piece().failed.emit();
    piece().failed.emit();
    fixture.detectChanges();

    expect(element().querySelector('.overlay .area')).not.toBeNull();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says it is gone once when the image fails twice', async () => {
    await render();
    piece().failed.emit();
    piece().failed.emit();
    fixture.detectChanges();

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says it is gone once when the opener throws before it returns a promise', async () => {
    await render(
      jest.fn(() => {
        throw new Error('sync');
      }),
    );
    tap();
    await fixture.whenStable();

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says it is gone when the opener rejects with nothing', async () => {
    await render();
    tap();
    refused(undefined);
    await fixture.whenStable();
    await Promise.resolve();

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the opener rejects after the page has gone', async () => {
    // A destroyed output drops the call and warns NG0953, so the warning is
    // what shows the component tried to speak.
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await render();
    tap();
    fixture.destroy();
    refused(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve));

    expect(gone).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('953');
    warn.mockRestore();
  });

  it('does not open the interactive map after the image has failed', async () => {
    await render();
    piece().failed.emit();
    fixture.detectChanges();
    tap();

    expect(open).not.toHaveBeenCalled();
  });

  it('says it is gone once when the image fails while the map is loading and the map then fails', async () => {
    await render();
    tap();
    piece().failed.emit();
    refused(new Error('style'));
    await fixture.whenStable();
    await Promise.resolve();

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('does not say it is gone when the image errors after the interactive map opened', async () => {
    await render();
    tap();
    opened({ destroy });
    await fixture.whenStable();
    fixture.detectChanges();
    piece()?.failed.emit();

    expect(gone).not.toHaveBeenCalled();
  });

  it('opens again after a refused first try never, since the box is gone', async () => {
    await render();
    tap();
    refused(new Error('x'));
    await fixture.whenStable();
    fixture.detectChanges();
    (still() as HTMLElement | null)?.click();

    expect(open).toHaveBeenCalledTimes(1);
  });
});

// @traces 1366-FR-002
describe('GarageMap, at the edges of the globe', () => {
  it.each([
    [{ lat: 0, lng: 0 }],
    [{ lat: -89.9, lng: -179.99 }],
    [{ lat: 84.5, lng: 179.99 }],
  ])('asks for a finite image at zoom 15 for %p', async (point) => {
    await render();
    fixture.componentRef.setInput('point', point);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const src = element().querySelector('img')?.getAttribute('src') ?? '';

    expect(src).toContain('z=15');
    expect(src).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('asks for a new image when the point changes and opens at the new view', async () => {
    await render();
    const before = element().querySelector('img')?.getAttribute('src');
    fixture.componentRef.setInput('point', { lat: 46.77, lng: 23.59 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const after = element().querySelector('img')?.getAttribute('src');
    tap();

    expect(after).not.toBe(before);
    expect(open.mock.calls[0]?.[3].center[1]).toBeCloseTo(46.77, 1);
    expect(open.mock.calls[0]?.[2]).toEqual({ lat: 46.77, lng: 23.59 });
  });
});
