import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import {
  address,
  adminLine,
  renderAdmin,
  settleAdmin,
} from './frame.admin.testing';

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

const select = (element: HTMLElement) =>
  element.querySelector('mf-admin-filters select') as HTMLSelectElement;
const radios = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLInputElement>(
    'mf-admin-filters .segments input',
  ),
];

// @traces 163-FR-009
describe("the Panou address keeps the admin's choice", () => {
  it('opens the city and the period the address names', async () => {
    const { asked, element } = await renderAdmin(
      '/app/admin?city=cluj-napoca&period=30d',
    );

    expect(asked.at(-1)).toEqual({ city: 'cluj-napoca', period: '30d' });
    expect(select(element).value).toBe('cluj-napoca');
    expect(radios(element).find((r) => r.checked)?.value).toBe('30d');
    expect(address()).toBe('/app/admin?city=cluj-napoca&period=30d');
  });

  it('writes a choice into the address, and leaves the defaults out', async () => {
    const { element, harness } = await renderAdmin();

    select(element).value = 'cluj-napoca';
    select(element).dispatchEvent(new Event('change'));
    await settleAdmin(harness);
    radios(element)[2].click();
    await settleAdmin(harness);
    expect(address()).toBe('/app/admin?city=cluj-napoca&period=7d');

    select(element).value = 'all';
    select(element).dispatchEvent(new Event('change'));
    await settleAdmin(harness);
    radios(element)[0].click();
    await settleAdmin(harness);
    expect(address()).toBe('/app/admin');
  });

  it('writes the city before the period, whichever was chosen first', async () => {
    const { element, harness } = await renderAdmin();

    radios(element)[2].click();
    await settleAdmin(harness);
    select(element).value = 'cluj-napoca';
    select(element).dispatchEvent(new Event('change'));
    await settleAdmin(harness);

    expect(address()).toBe('/app/admin?city=cluj-napoca&period=7d');
  });

  it.each([
    ['an unknown period', '/app/admin?period=week'],
    ['a city in capitals', '/app/admin?city=Cluj-Napoca'],
    ['a city with diacritics', '/app/admin?city=bucurești'],
    ['the default city written out', '/app/admin?city=all'],
    ['the default period written out', '/app/admin?period=default'],
  ])('corrects %s to the defaults, quietly', async (_, url) => {
    const { asked, element } = await renderAdmin(url);

    expect(address()).toBe('/app/admin');
    expect(asked.every((p) => p?.city === undefined)).toBe(true);
    expect(adminLine(element)).toBe(
      'MotorFix · Toată țara · 5 service‑uri așteaptă verificarea',
    );
  });

  it('falls back to the whole country for a city nobody has, keeping the period', async () => {
    const { asked, element } = await renderAdmin(
      '/app/admin?city=timisoara&period=30d',
    );

    expect(asked.at(-1)).toEqual({ period: '30d' });
    expect(address()).toBe('/app/admin?period=30d');
    expect(adminLine(element)).toBe(
      'MotorFix · Toată țara · 5 service‑uri așteaptă verificarea',
    );
    expect(select(element).value).toBe('all');
  });

  it('drops the choice off Panou, the header reading the whole country', async () => {
    const { asked, element, harness } = await renderAdmin(
      '/app/admin?city=cluj-napoca&period=7d',
    );

    await TestBed.inject(Router).navigateByUrl('/app/admin/garages');
    await settleAdmin(harness);

    expect(asked.at(-1)).toEqual({});
    expect(adminLine(element)).toBe(
      'MotorFix · Toată țara · 5 service‑uri așteaptă verificarea',
    );
    expect(element.querySelector('mf-admin-filters')).toBeNull();
  });
});
