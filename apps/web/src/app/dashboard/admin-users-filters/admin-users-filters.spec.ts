import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AccountRole,
  AccountState,
} from '@motor-fix/contracts/account-search';
import { I18n } from '@motor-fix/i18n';

import { AdminUsersFilters } from './admin-users-filters';
import type { UsersFilter } from '../admin-users-filters-sheet/admin-users-filters-sheet';

@Component({
  imports: [AdminUsersFilters],
  template: `<mf-admin-users-filters [q]="q()" [roles]="roles()" [status]="status()" (search)="searched.push($event)" (filter)="filtered.push($event)" />`,
})
class Host {
  readonly q = signal('');
  readonly roles = signal<readonly AccountRole[]>([]);
  readonly status = signal<AccountState | null>(null);
  readonly searched: string[] = [];
  readonly filtered: UsersFilter[] = [];
  readonly filters = viewChild.required(AdminUsersFilters);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

beforeEach(() => {
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: false,
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  jest.useRealTimers();
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function open(
  language: 'ro' | 'en' = 'ro',
  set: (host: Host) => void = () => {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  set(fixture.componentInstance);
  document.body.append(fixture.nativeElement);
  await settle();
  return {
    element: fixture.nativeElement as HTMLElement,
    host: fixture.componentInstance,
  };
}

const box = (el: HTMLElement) =>
  el.querySelector('input[type="search"]') as HTMLInputElement;
const type = (el: HTMLElement, value: string) => {
  box(el).value = value;
  box(el).dispatchEvent(new Event('input'));
};
const clearSearch = (el: HTMLElement) =>
  el.querySelector('button.clear-search') as HTMLButtonElement | null;
const rolesButton = (el: HTMLElement) =>
  el.querySelector('button.roles') as HTMLButtonElement;
const roleGroup = () =>
  document.querySelector<HTMLElement>(
    'fieldset[aria-label="Roluri"], fieldset[aria-label="Roles"]',
  );
const tick = (name: string) =>
  (
    [
      ...(roleGroup() as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ].find(
      (c) => c.closest('label')?.textContent?.trim() === name,
    ) as HTMLInputElement
  ).click();
const state = (el: HTMLElement) =>
  el.querySelector('select.state') as HTMLSelectElement;
const filterButton = (el: HTMLElement) =>
  el.querySelector('button.filter') as HTMLButtonElement;
const sheet = () => document.querySelector('mf-admin-users-filters-sheet');
const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// Real time is too coarse to tell 299 ms from 300 ms; these move a fake clock.
const fakeClock = () =>
  jest.useFakeTimers({
    doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
  });

// @traces 002-FR-008 002-FR-013
describe('the search box', () => {
  it('is a search field named by its visible label, in a search landmark of the same name', async () => {
    const { element } = await open();

    const input = box(element);
    expect(input.placeholder).toBe('Caută după nume, e‑mail sau telefon');
    expect(input.getAttribute('aria-label')).toBe(
      'Caută după nume, e‑mail sau telefon',
    );
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(
      input.closest('form[role="search"]')?.getAttribute('aria-label'),
    ).toBe('Caută după nume, e‑mail sau telefon');
  });

  it('reads in English', async () => {
    const { element } = await open('en');

    expect(box(element).placeholder).toBe('Search by name, e‑mail or phone');
  });

  it('shows the text from the address', async () => {
    const { element, host } = await open('ro', (h) => h.q.set('dinamo'));
    expect(box(element).value).toBe('dinamo');

    host.q.set('');
    await settle();
    expect(box(element).value).toBe('');
  });

  it('offers a clear control only while there is text, which empties the box at once', async () => {
    const { element, host } = await open('ro', (h) => h.q.set('dinamo'));
    expect(clearSearch(element)?.getAttribute('aria-label')).toBe(
      'Golește căutarea',
    );

    clearSearch(element)?.click();
    await settle();

    expect(box(element).value).toBe('');
    expect(host.searched).toEqual(['']);
    host.q.set('');
    await settle();
    expect(clearSearch(element)).toBeNull();
  });

  it('can be focused by the view', async () => {
    const { element, host } = await open();

    host.filters().focusSearch();

    expect(document.activeElement).toBe(box(element));
  });
});

// @traces 002-FR-009 002-FR-010
describe('the search text it commits', () => {
  it('commits the text 300 ms after the last key, once', async () => {
    const { element, host } = await open();
    fakeClock();

    type(element, 'an');
    jest.advanceTimersByTime(200);
    type(element, 'andrei');
    jest.advanceTimersByTime(299);
    expect(host.searched).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(host.searched).toEqual(['andrei']);
  });

  it('commits the text trimmed, its spaces collapsed and in composed form', async () => {
    const { element, host } = await open();
    fakeClock();

    // Ș written as S and a combining comma below.
    type(element, '  S\u0326tefan   Marin ');
    jest.advanceTimersByTime(300);

    expect(host.searched).toEqual(['Ștefan Marin']);
  });

  it('keeps the first 80 characters of a longer text', async () => {
    const { element, host } = await open();
    fakeClock();

    type(element, 'a'.repeat(95));
    jest.advanceTimersByTime(300);

    expect(host.searched).toEqual(['a'.repeat(80)]);
    expect(box(element).maxLength).toBe(80);
  });

  it('keeps what was typed, a trailing space included, when the address catches up with the committed text', async () => {
    const { element, host } = await open();
    fakeClock();

    type(element, 'andrei ');
    jest.advanceTimersByTime(300);
    expect(host.searched).toEqual(['andrei']);

    host.q.set('andrei');
    TestBed.tick();
    expect(box(element).value).toBe('andrei ');

    type(element, 'andrei mar');
    jest.advanceTimersByTime(300);
    expect(host.searched).toEqual(['andrei', 'andrei mar']);
  });

  it('shows a different text the address brings, such as going back', async () => {
    const { element, host } = await open();
    fakeClock();

    type(element, 'andrei ');
    jest.advanceTimersByTime(300);
    host.q.set('andrei');
    TestBed.tick();

    host.q.set('ion');
    TestBed.tick();
    expect(box(element).value).toBe('ion');
  });
});

// @traces 002-FR-008 002-FR-013
describe('the role drop-down', () => {
  it('reads "Toate rolurile" with none ticked, the role with one and the number with more', async () => {
    const { element, host } = await open();
    expect(text(rolesButton(element))).toBe('Toate rolurile');

    host.roles.set(['mechanic']);
    await settle();
    expect(text(rolesButton(element))).toBe('mecanic');

    host.roles.set(['driver', 'mechanic']);
    await settle();
    expect(text(rolesButton(element))).toBe('2 roluri');
  });

  it('reads in English', async () => {
    const { element, host } = await open('en');
    expect(text(rolesButton(element))).toBe('All roles');

    host.roles.set(['driver', 'mechanic', 'admin']);
    await settle();
    expect(text(rolesButton(element))).toBe('3 roles');
  });

  it('opens a group of ticks, the current roles ticked, and says it is open', async () => {
    const { element } = await open('ro', (h) => h.roles.set(['garage']));
    expect(rolesButton(element).getAttribute('aria-expanded')).toBe('false');

    rolesButton(element).click();
    await settle();

    expect(rolesButton(element).getAttribute('aria-expanded')).toBe('true');
    const ticks = [
      ...(roleGroup() as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ].map((c) => [c.closest('label')?.textContent?.trim(), c.checked]);
    expect(ticks).toEqual([
      ['șofer', false],
      ['service', true],
      ['recepție', false],
      ['mecanic', false],
      ['admin', false],
    ]);
  });

  it('emits each tick at once, keeping the state, in the fixed role order', async () => {
    const { element, host } = await open('ro', (h) => {
      h.roles.set(['mechanic']);
      h.status.set('active');
    });

    rolesButton(element).click();
    await settle();
    tick('șofer');
    await settle();

    expect(host.filtered).toEqual([
      { roles: ['driver', 'mechanic'], status: 'active' },
    ]);
  });

  it('keeps a tick just made when a second follows before the address has caught up', async () => {
    const { element, host } = await open();

    rolesButton(element).click();
    await settle();
    tick('mecanic');
    tick('admin');
    await settle();

    expect(host.filtered.at(-1)).toEqual({
      roles: ['mechanic', 'admin'],
      status: null,
    });
  });

  it('is operable from the keyboard: Space ticks, Escape closes and returns focus', async () => {
    const { element, host } = await open();

    rolesButton(element).focus();
    rolesButton(element).click();
    await settle();
    const first = (roleGroup() as HTMLElement).querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    first.focus();
    first.click();
    await settle();
    expect(host.filtered.at(-1)?.roles).toEqual(['driver']);

    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(rolesButton(element).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(rolesButton(element));
  });
});

// @traces 002-FR-008
describe('the state drop-down', () => {
  it('offers every state, named by its label, the current one selected', async () => {
    const { element } = await open('ro', (h) => h.status.set('suspended'));

    expect(state(element).getAttribute('aria-label')).toBe('Stare');
    expect([...state(element).options].map((o) => o.text.trim())).toEqual([
      'Toate stările',
      'activ',
      'sub observație',
      'suspendat',
    ]);
    expect(state(element).value).toBe('suspended');
  });

  it('emits a change at once, keeping the roles; "Toate stările" is no state', async () => {
    const { element, host } = await open('ro', (h) => {
      h.roles.set(['mechanic']);
      h.status.set('active');
    });

    state(element).value = '';
    state(element).dispatchEvent(new Event('change'));

    expect(host.filtered).toEqual([{ roles: ['mechanic'], status: null }]);
  });
});

// @traces 002-FR-008 002-FR-013
describe("the phone's filter button", () => {
  it('summarises the choice', async () => {
    const { element, host } = await open();
    expect(text(filterButton(element))).toBe('Toate rolurile · Toate stările');

    host.roles.set(['mechanic']);
    host.status.set('active');
    await settle();
    expect(text(filterButton(element))).toBe('mecanic · activ');

    host.roles.set(['driver', 'mechanic']);
    await settle();
    expect(text(filterButton(element))).toBe('2 roluri · activ');
    expect(filterButton(element).getAttribute('aria-label')).toBe(
      'Filtre: 2 roluri · activ',
    );
  });

  it('summarises it in English', async () => {
    const { element, host } = await open('en');
    expect(text(filterButton(element))).toBe('All roles · All states');

    host.roles.set(['driver', 'mechanic']);
    host.status.set('active');
    await settle();
    expect(text(filterButton(element))).toBe('2 roles · active');
  });

  it('opens the sheet and emits what it applies', async () => {
    const { element, host } = await open('ro', (h) => h.status.set('active'));

    filterButton(element).click();
    await settle();
    expect(sheet()).not.toBeNull();
    (
      [
        ...(sheet() as Element).querySelectorAll<HTMLInputElement>('input'),
      ].find(
        (c) => c.closest('label')?.textContent?.trim() === 'mecanic',
      ) as HTMLInputElement
    ).click();
    await settle();
    (
      [...(sheet() as Element).querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Aplică',
      ) as HTMLButtonElement
    ).click();
    await settle();

    expect(host.filtered).toEqual([{ roles: ['mechanic'], status: 'active' }]);
  });

  it('emits nothing when the sheet is closed with Escape, and focus returns to the button', async () => {
    const { element, host } = await open();

    filterButton(element).focus();
    filterButton(element).click();
    await settle();
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(sheet()).toBeNull();
    expect(host.filtered).toEqual([]);
    expect(document.activeElement).toBe(filterButton(element));
  });
});
