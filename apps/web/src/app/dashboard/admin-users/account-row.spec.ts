import { TestBed } from '@angular/core/testing';
import type { AdminAccountDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { accountRow } from './account-row';

const base: AdminAccountDto = {
  carsCount: 0,
  count: { kind: 'requests', value: 0 },
  createdAt: '2026-03-12T09:14:00.000Z',
  garageName: null,
  id: 'a',
  name: 'Andrei M.',
  roles: ['driver'],
  since: '2026-03-12T09:14:00.000Z',
  status: 'active',
};

async function row(
  overrides: Partial<AdminAccountDto>,
  language: 'ro' | 'en' = 'ro',
) {
  const i18n = TestBed.inject(I18n);
  await i18n.enter('admin');
  await i18n.use(language);
  return accountRow({ ...base, ...overrides }, i18n);
}

afterEach(() => TestBed.resetTestingModule());

describe('the detail line', () => {
  it.each([
    [0, 'șofer · fără mașină', 'driver · no car'],
    [1, 'șofer · 1 mașină', 'driver · 1 car'],
    [2, 'șofer · 2 mașini', 'driver · 2 cars'],
    [20, 'șofer · 20 de mașini', 'driver · 20 cars'],
  ])('reads a lone driver with %i cars', async (carsCount, ro, en) => {
    expect((await row({ carsCount })).detail).toBe(ro);
    expect((await row({ carsCount }, 'en')).detail).toBe(en);
  });

  it('joins two roles and names the garage', async () => {
    const both = {
      garageName: 'Atelier Dinamo',
      roles: ['driver', 'garage'] as AdminAccountDto['roles'],
    };

    expect((await row(both)).detail).toBe('șofer + service · Atelier Dinamo');
    expect((await row(both, 'en')).detail).toBe(
      'driver + garage · Atelier Dinamo',
    );
  });

  it.each([
    ['mechanic', 'mecanic · Atelier Test', 'mechanic · Atelier Test'],
    ['receptionist', 'recepție · Atelier Test', 'reception · Atelier Test'],
  ] as const)('names the garage of a %s', async (role, ro, en) => {
    const staff = { garageName: 'Atelier Test', roles: [role] };

    expect((await row(staff)).detail).toBe(ro);
    expect((await row(staff, 'en')).detail).toBe(en);
  });

  it('writes nothing after an admin or a garage with no garage', async () => {
    expect((await row({ roles: ['admin'] })).detail).toBe('admin');
    expect((await row({ roles: ['garage'] })).detail).toBe('service');
  });
});

describe('the state', () => {
  it('reads an active account green with the month it began', async () => {
    expect(await row({})).toMatchObject({
      lamp: 'green',
      state: 'activ · din martie 2026',
    });
    expect((await row({}, 'en')).state).toBe('active · since March 2026');
  });

  it('reads the month in Bucharest, not in UTC', async () => {
    const since = '2026-02-28T22:30:00.000Z';

    expect((await row({ since })).state).toBe('activ · din martie 2026');
  });

  it('reads a suspended account red with the day it began', async () => {
    const suspended = {
      since: '2026-10-02T10:00:00.000Z',
      status: 'suspended' as const,
    };

    expect(await row(suspended)).toMatchObject({
      lamp: 'red',
      state: 'suspendat · din 2 oct. 2026',
    });
    expect((await row(suspended, 'en')).state).toBe(
      'suspended · since 2 Oct 2026',
    );
  });

  it('reads a suspension with no recorded day as the word alone', async () => {
    const suspended = { since: null, status: 'suspended' as const };

    expect((await row(suspended)).state).toBe('suspendat');
    expect((await row(suspended, 'en')).state).toBe('suspended');
  });
});

describe('the count', () => {
  it.each([
    ['requests', 0, '0 cereri', '0 requests'],
    ['requests', 1, '1 cerere', '1 request'],
    ['requests', 14, '14 cereri', '14 requests'],
    ['requests', 1240, '1.240 de cereri', '1,240 requests'],
    ['reviews', 1, '1 recenzie', '1 review'],
    ['reviews', 212, '212 recenzii', '212 reviews'],
    ['reviews', 220, '220 de recenzii', '220 reviews'],
    ['reviews', 3, '3 recenzii', '3 reviews'],
    ['age', 1, 'cont de 1 zi', '1-day-old account'],
    ['age', 0, 'cont de 0 zile', '0-day-old account'],
    ['age', 400, 'cont de 400 de zile', '400-day-old account'],
  ] as const)('reads %s %i', async (kind, value, ro, en) => {
    expect((await row({ count: { kind, value } })).count).toBe(ro);
    expect((await row({ count: { kind, value } }, 'en')).count).toBe(en);
  });
});
