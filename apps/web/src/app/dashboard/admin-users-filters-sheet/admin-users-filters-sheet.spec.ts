import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  AdminUsersFiltersSheet,
  type UsersFilter,
} from './admin-users-filters-sheet';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
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
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

async function open(
  language: 'ro' | 'en' = 'ro',
  data: UsersFilter = { roles: ['mechanic'], status: 'active' },
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  const result: Promise<OverlayResult<UsersFilter>> =
    host.componentInstance.overlays.open<UsersFilter, UsersFilter>(
      AdminUsersFiltersSheet,
      {
        confirmDiscard: false,
        data,
        shape: 'dialog',
        title: 'admin.users.filters.title',
      },
    );
  await settle();
  // Wrapped, so awaiting the opening does not wait for the sheet to close.
  return { result };
}

const sheet = () =>
  document.querySelector<HTMLElement>(
    'mf-admin-users-filters-sheet',
  ) as HTMLElement;
// A group is named by its legend or its label.
const group = (name: string) =>
  [
    ...sheet().querySelectorAll<HTMLElement>('fieldset, [role="radiogroup"]'),
  ].find(
    (g) =>
      (g.querySelector('legend')?.textContent?.trim() ??
        g.getAttribute('aria-label')) === name,
  ) as HTMLElement;
const options = (g: HTMLElement) =>
  [...g.querySelectorAll<HTMLInputElement>('input')].map((r) => ({
    checked: r.checked,
    name: r.closest('label')?.textContent?.trim(),
    type: r.type,
  }));
const pick = (g: HTMLElement, name: string) =>
  (
    [...g.querySelectorAll<HTMLInputElement>('input')].find(
      (r) => r.closest('label')?.textContent?.trim() === name,
    ) as HTMLInputElement
  ).click();
const apply = (label = 'Aplică') =>
  (
    [...sheet().querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement
  ).click();

// @traces 002-find-account-search-FR-008 002-find-account-search-FR-013
describe("the accounts' filters sheet", () => {
  it('lists the roles as ticks and the states as one choice, the current ones checked', async () => {
    await open();

    expect(group('Roluri').tagName).toBe('FIELDSET');
    expect(options(group('Roluri'))).toEqual([
      { checked: false, name: 'șofer', type: 'checkbox' },
      { checked: false, name: 'service', type: 'checkbox' },
      { checked: false, name: 'recepție', type: 'checkbox' },
      { checked: true, name: 'mecanic', type: 'checkbox' },
      { checked: false, name: 'admin', type: 'checkbox' },
    ]);
    expect(group('Stare').getAttribute('role')).toBe('radiogroup');
    expect(options(group('Stare'))).toEqual([
      { checked: false, name: 'Toate stările', type: 'radio' },
      { checked: true, name: 'activ', type: 'radio' },
      { checked: false, name: 'sub observație', type: 'radio' },
      { checked: false, name: 'suspendat', type: 'radio' },
    ]);
  });

  it('checks "Toate stările" when no state is chosen', async () => {
    await open('ro', { roles: [], status: null });

    expect(options(group('Stare'))[0].checked).toBe(true);
    expect(options(group('Roluri')).every((o) => !o.checked)).toBe(true);
  });

  it('applies the ticked roles in their fixed order and the picked state', async () => {
    const { result } = await open();

    pick(group('Roluri'), 'șofer');
    pick(group('Stare'), 'suspendat');
    await settle();
    apply();
    await settle();

    await expect(result).resolves.toEqual({
      roles: ['driver', 'mechanic'],
      status: 'suspended',
    });
  });

  it('applies no role and every state once all are cleared', async () => {
    const { result } = await open();

    pick(group('Roluri'), 'mecanic');
    pick(group('Stare'), 'Toate stările');
    await settle();
    apply();
    await settle();

    await expect(result).resolves.toEqual({ roles: [], status: null });
  });

  it('changes nothing when closed with Escape', async () => {
    const { result } = await open();

    pick(group('Roluri'), 'șofer');
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('moves focus into itself when it opens', async () => {
    await open();

    expect(
      document.activeElement?.closest('[role="dialog"], dialog'),
    ).not.toBeNull();
  });

  it('reads in English', async () => {
    const { result } = await open('en');

    expect(options(group('Roles')).map((o) => o.name)).toEqual([
      'driver',
      'garage',
      'reception',
      'mechanic',
      'admin',
    ]);
    expect(options(group('State')).map((o) => o.name)).toEqual([
      'All states',
      'active',
      'under watch',
      'suspended',
    ]);
    apply('Apply');
    await settle();
    await expect(result).resolves.toEqual({
      roles: ['mechanic'],
      status: 'active',
    });
  });
});
