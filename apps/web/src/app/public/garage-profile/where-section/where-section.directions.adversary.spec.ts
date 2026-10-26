import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GARAGE_MAP } from './garage-map/garage-map';
import { WhereSection } from './where-section';
import { sanitise } from '../../../consent/analytics-events';
import { Consent } from '../../../consent/consent';
import { StaticMap } from '../../static-map/static-map';

const OPEN = [['08:00', '19:00']];
const GARAGE: PublicGarageDto = {
  address: 'Str. Atelierului 14, București',
  brandNote: null,
  businessKind: 'company',
  closedDays: [],
  doesNotTake: [],
  facilities: [],
  hours: {
    fri: OPEN,
    mon: OPEN,
    sat: [],
    sun: [],
    thu: OPEN,
    tue: OPEN,
    wed: OPEN,
  },
  id: 'g-1',
  jobTypes: [],
  latitude: 44.43,
  longitude: -26.1,
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'atelier-dinamo',
  verifiedAt: null,
  worksOn: [],
};

@Component({
  imports: [WhereSection],
  template: `<section data-slot="where" mf-where-section [garage]="garage()"></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
}

const track = jest.fn();
let open: jest.Mock;
let fixture: ComponentFixture<Host>;
const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const link = () =>
  section().querySelector('a.directions') as HTMLAnchorElement | null;

async function settle() {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function start(agent: string, opener?: jest.Mock) {
  jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(agent);
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  open = opener ?? jest.fn(() => new Promise(() => undefined));
  TestBed.configureTestingModule({
    providers: [
      { provide: Consent, useValue: { track } },
      { provide: GARAGE_MAP, useValue: open },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use('ro');
  fixture = TestBed.createComponent(Host);
  await settle();
}

beforeEach(() => track.mockClear());
afterEach(() => {
  fixture.destroy();
  jest.restoreAllMocks();
});

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129';

// @traces 1366-FR-008
describe('the directions link per platform in the browser', () => {
  it('hands an iPhone to Apple Maps with no target and no rel', async () => {
    await start(IPHONE);

    expect(link()?.getAttribute('href')).toBe(
      'https://maps.apple.com/?daddr=44.43,-26.1',
    );
    expect(link()?.hasAttribute('target')).toBe(false);
    expect(link()?.hasAttribute('rel')).toBe(false);
  });

  it('hands an Android phone a geo address with no target and no rel', async () => {
    await start(ANDROID);

    expect(link()?.getAttribute('href')).toBe('geo:44.43,-26.1?q=44.43,-26.1');
    expect(link()?.hasAttribute('target')).toBe(false);
    expect(link()?.hasAttribute('rel')).toBe(false);
  });

  it('opens a computer address in a new tab that cannot reach back', async () => {
    await start(DESKTOP);

    expect(link()?.getAttribute('target')).toBe('_blank');
    expect(link()?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('puts the map first, the link last, and keeps the link when the garage moves', async () => {
    await start(DESKTOP);
    const kids = Array.from(section().children).map((c) => c.localName);
    fixture.componentInstance.garage.set({
      ...GARAGE,
      latitude: 1.5,
      longitude: 2.5,
    });
    await settle();

    expect(kids[0]).toBe('mf-garage-map');
    expect(kids[kids.length - 1]).toBe('a');
    expect(link()?.getAttribute('href')).toContain('destination=1.5,2.5');
  });
});

// @traces 1366-FR-011
describe('the directions tap as a product action', () => {
  it.each([
    [IPHONE, 'ios'],
    [ANDROID, 'android'],
    [DESKTOP, 'computer'],
  ])(
    'sends one directions_opened with the platform only for %#',
    async (agent, platform) => {
      await start(agent);
      link()?.addEventListener('click', (e) => e.preventDefault());
      link()?.click();

      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith('directions_opened', { platform });
    },
  );

  it('sends nothing for a context menu', async () => {
    await start(DESKTOP);
    link()?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(track).not.toHaveBeenCalled();
  });

  it('sends one event per tap, two taps two events', async () => {
    await start(DESKTOP);
    link()?.addEventListener('click', (e) => e.preventDefault());
    link()?.click();
    link()?.click();

    expect(track).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for a tap on the map', async () => {
    await start(DESKTOP);
    section().querySelector<HTMLElement>('mf-static-map button')?.click();

    expect(track).not.toHaveBeenCalled();
  });
});

// @traces 1366-FR-011
describe('the closed event set for directions_opened', () => {
  it('keeps the platform it knows', () => {
    expect(sanitise('directions_opened', { platform: 'ios' })).toEqual({
      platform: 'ios',
    });
  });

  it('drops the coordinates, the garage and a platform it does not know', () => {
    expect(
      sanitise('directions_opened', {
        garage: 'atelier-dinamo',
        lat: 44.43,
        lng: 26.1,
        platform: 'windows-phone',
      }),
    ).toEqual({});
  });

  it.each([[null], [undefined], ['ios'], [[]]])(
    'answers %p with no properties',
    (props) => {
      expect(sanitise('directions_opened', props as never)).toEqual({});
    },
  );

  it('keeps a platform given as an uppercase word out', () => {
    expect(sanitise('directions_opened', { platform: 'IOS' })).toEqual({});
  });

  it('keeps an inherited key out', () => {
    expect(
      sanitise('directions_opened', { __proto__: { platform: 'ios' } }),
    ).toEqual({});
  });
});

// @traces 1366-FR-006
describe('the section when the map fails', () => {
  it('drops the map and keeps the link, the address and the hours when the image fails', async () => {
    await start(ANDROID);
    fixture.debugElement
      .query(By.directive(StaticMap))
      .componentInstance.failed.emit();
    await settle();

    expect(section().querySelector('mf-garage-map')).toBeNull();
    expect(link()?.getAttribute('href')).toBe('geo:44.43,-26.1?q=44.43,-26.1');
    expect(section().querySelector('.address')?.textContent).toContain(
      'Atelierului',
    );
    expect(section().querySelector('dl.hours')).not.toBeNull();
    expect(section().querySelector('[role="alert"], [aria-live]')).toBeNull();
  });

  it('drops the map and keeps the link when the opener rejects', async () => {
    await start(
      DESKTOP,
      jest.fn(() => Promise.reject(new Error('tiles'))),
    );
    section().querySelector<HTMLElement>('mf-static-map button')?.click();
    await settle();

    expect(section().querySelector('mf-garage-map')).toBeNull();
    expect(link()).not.toBeNull();
  });

  it('shows the map again when the garage is read again with a new point after a failure', async () => {
    await start(DESKTOP);
    fixture.debugElement
      .query(By.directive(StaticMap))
      .componentInstance.failed.emit();
    await settle();
    fixture.componentInstance.garage.set({
      ...GARAGE,
      latitude: 45,
      longitude: 25,
    });
    await settle();

    expect(link()?.getAttribute('href')).toContain('destination=45,25');
  });
});
