import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { PlacesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { type AddressChoice, AddressField } from './address-field';

@Component({
  imports: [AddressField],
  template: `<mf-address-field
    ids="adv"
    [locate]="true"
    (chosen)="chosen.push($event)"
  />`,
})
class Host {
  readonly chosen: AddressChoice[] = [];
}

type Suggestion = { label: string; lat: number; lng: number };
const row = (n: number): Suggestion => ({
  label: `Strada Exemplu ${n}, Cluj-Napoca`,
  lat: 46.77 + n / 100,
  lng: 23.62,
});

let search: jest.Mock;
let fixture: ComponentFixture<Host>;
let located: { ok: PositionCallback; fail: PositionErrorCallback }[];

async function settle() {
  for (let i = 0; i < 6; i++) {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
  }
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount() {
  TestBed.configureTestingModule({
    providers: [
      { provide: PlacesService, useValue: { placesControllerSearch: search } },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  await settle();
}

const root = () => fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const field = () =>
  root().querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  ) as HTMLInputElement;
const options = () => [
  ...root().querySelectorAll<HTMLButtonElement>('[role="option"]'),
];
const live = () => text(root().querySelector('#adv-message'));
const chosen = () => fixture.componentInstance.chosen;

async function type(value: string, pause = 350) {
  field().value = value;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  await wait(pause);
  await settle();
}
async function key(name: string) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: name,
  });
  field().dispatchEvent(event);
  await settle();
  return event;
}

beforeEach(() => {
  located = [];
  search = jest.fn(async () => ({ items: [row(1)] }));
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: jest.fn(
        (ok: PositionCallback, fail: PositionErrorCallback) =>
          located.push({ fail, ok }),
      ),
    },
  });
});

afterEach(() => {
  fixture?.nativeElement.remove();
  TestBed.resetTestingModule();
  Reflect.deleteProperty(navigator, 'geolocation');
});

// @traces 271-garage-distance-FR-005
describe('the address field under odd typing', () => {
  it('asks nothing for blanks only', async () => {
    await mount();

    await type('          ');

    expect(search).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
  });

  it('counts two letters with a blank after them as two', async () => {
    await mount();

    await type('Cl ');

    expect(search).not.toHaveBeenCalled();
  });

  it('asks for three accented letters', async () => {
    await mount();

    await type('Șoș');

    expect(search).toHaveBeenCalledWith({ lang: 'ro', q: 'Șoș' });
  });

  it('asks nothing when the text is cut back under three before the pause ends', async () => {
    await mount();

    await type('Cluj', 100);
    await type('Cl', 100);
    await wait(400);
    await settle();

    expect(search).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
  });

  it('shows no answer to a text that was cut back under three while it was in flight', async () => {
    let answer: (value: unknown) => void = () => undefined;
    search.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    await mount();
    await type('Cluj');

    await type('Cl');
    answer({ items: [row(1)] });
    await settle();

    expect(options()).toHaveLength(0);
  });

  it('keeps the answer to the latest text when an older one arrives after it', async () => {
    const answers: ((value: unknown) => void)[] = [];
    search.mockImplementation(
      () => new Promise((resolve) => answers.push(resolve)),
    );
    await mount();
    await type('Strada');
    await type('Cluj');

    answers[1]({ items: [row(2)] });
    await settle();
    answers[0]({ items: [row(1), row(3)] });
    await settle();

    expect(options().map(text)).toEqual([row(2).label]);
  });

  it('shows no error from an older look-up that failed after a newer one answered', async () => {
    const answers: { ok: (v: unknown) => void; fail: (e: unknown) => void }[] =
      [];
    search.mockImplementation(
      () =>
        new Promise((ok, fail) => {
          answers.push({ fail, ok });
        }),
    );
    await mount();
    await type('Strada');
    await type('Cluj');

    answers[1].ok({ items: [row(2)] });
    await settle();
    answers[0].fail(new HttpErrorResponse({ status: 503 }));
    await settle();

    expect(live()).toBe('');
    expect(options().map(text)).toEqual([row(2).label]);
  });

  it('says it cannot search for an error that is not an HTTP one', async () => {
    search.mockRejectedValueOnce(new TypeError('boom'));
    await mount();

    await type('Cluj');

    expect(live()).toBe('Nu putem căuta adrese acum');
    expect(options()).toHaveLength(0);
  });

  it('shows a label with markup as plain text', async () => {
    search.mockResolvedValue({
      items: [{ ...row(1), label: '<img src=x onerror=alert(1)>' }],
    });
    await mount();

    await type('Cluj');

    expect(root().querySelector('img')).toBeNull();
    expect(text(options()[0])).toBe('<img src=x onerror=alert(1)>');
  });

  it('survives a look-up that answers with no items at all', async () => {
    search.mockResolvedValue({ items: [] });
    await mount();

    await type('Cluj');

    expect(live()).toBe('Nu am găsit adresa');
    expect(await key('Enter')).toHaveProperty('defaultPrevented', false);
  });
});

describe('the address field walked by keyboard', () => {
  it('does nothing on the arrows while no list is shown', async () => {
    await mount();

    await key('ArrowDown');
    await key('ArrowUp');
    const enter = await key('Enter');

    expect(enter.defaultPrevented).toBe(false);
    expect(chosen()).toEqual([]);
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('forgets the row walked to when a new answer replaces the list', async () => {
    search.mockResolvedValueOnce({ items: [row(1), row(2), row(3)] });
    await mount();
    await type('Strada');
    await key('ArrowDown');
    await key('ArrowDown');
    await key('ArrowDown');
    search.mockResolvedValueOnce({ items: [row(4)] });

    await type('Strada 4');
    const enter = await key('Enter');

    expect(chosen().map((c) => c.label)).not.toContain(row(3).label);
    expect(enter.defaultPrevented).toBe(chosen().length === 1);
  });

  it('gives one place for Enter pressed twice', async () => {
    await mount();
    await type('Cluj');
    await key('ArrowDown');

    await key('Enter');
    await key('Enter');

    expect(chosen()).toHaveLength(1);
  });

  it('gives no place for Enter after the text was changed under three', async () => {
    await mount();
    await type('Cluj');
    await key('ArrowDown');

    await type('Cl');
    await key('Enter');

    expect(chosen()).toEqual([]);
  });

  it('marks exactly one row selected while walking', async () => {
    search.mockResolvedValue({ items: [row(1), row(2), row(3)] });
    await mount();
    await type('Strada');

    await key('ArrowDown');
    await key('ArrowDown');

    expect(
      options().filter((o) => o.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });
});

describe('the address field by location, hostile answers', () => {
  const tap = async () => {
    [...root().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => /locația mea/.test(text(b)))
      ?.click();
    await settle();
  };

  it.each([
    ['NaN', Number.NaN, Number.NaN],
    ['the null island', 0, 0],
    ['a latitude past the pole', 91, 24],
  ])('gives no place for %s', async (_, lat, lng) => {
    await mount();
    await tap();

    located[0].ok({
      coords: { latitude: lat, longitude: lng },
    } as GeolocationPosition);
    await settle();

    expect(chosen()).toEqual([]);
  });

  it('does not ask the browser twice for two quick taps', async () => {
    await mount();

    await tap();
    await tap();

    expect(located).toHaveLength(1);
  });
});
