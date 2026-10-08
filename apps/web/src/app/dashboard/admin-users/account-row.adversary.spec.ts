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

describe('the detail line at the edges', () => {
  it('shows no cars for a driver who also holds the mechanic role', async () => {
    const out = await row({
      carsCount: 3,
      garageName: 'Atelier Dinamo',
      roles: ['driver', 'mechanic'],
    });

    expect(out.detail).toBe('șofer + mecanic · Atelier Dinamo');
  });

  it('writes the roles alone for a driver and garage with no garage name', async () => {
    const out = await row({ carsCount: 5, roles: ['driver', 'garage'] });

    expect(out.detail).toBe('șofer + service');
  });

  it('writes the roles alone when the garage name is an empty string', async () => {
    const out = await row({ garageName: '', roles: ['mechanic'] });

    expect(out.detail).toBe('mecanic');
  });

  it('keeps a very long garage name whole', async () => {
    const garageName = 'Atelier '.repeat(100).trim();
    const out = await row({ garageName, roles: ['garage'] });

    expect(out.detail).toBe(`service · ${garageName}`);
  });

  it('keeps markup in a garage name as plain text', async () => {
    const out = await row({
      garageName: '<b>{count}</b> {n}',
      roles: ['garage'],
    });

    expect(out.detail).toBe('service · <b>{count}</b> {n}');
  });

  it('joins all five roles in the order given', async () => {
    const out = await row({
      garageName: 'G',
      roles: ['driver', 'garage', 'receptionist', 'mechanic', 'admin'],
    });

    expect(out.detail).toBe('șofer + service + recepție + mecanic + admin · G');
  });
});

describe('the state at the edges', () => {
  it('reads December in Romanian and English', async () => {
    const since = '2025-12-31T21:59:59.000Z';

    expect((await row({ since })).state).toBe('activ · din decembrie 2025');
    expect((await row({ since }, 'en')).state).toBe(
      'active · since December 2025',
    );
  });

  it('reads the Bucharest month across the year boundary', async () => {
    const since = '2025-12-31T22:00:00.000Z';

    expect((await row({ since })).state).toBe('activ · din ianuarie 2026');
  });

  it('reads a suspension at the Bucharest day, not the UTC day', async () => {
    const out = await row({
      since: '2026-10-01T21:30:00.000Z',
      status: 'suspended',
    });

    expect(out.state).toBe('suspendat · din 2 oct. 2026');
  });

  it('reads an active account with no date as the word alone, not a crash', async () => {
    const out = await row({ since: null });

    expect(out).toMatchObject({ lamp: 'green', state: 'activ' });
  });

  it('renders the same row again in the other language without a reload', async () => {
    const i18n = TestBed.inject(I18n);
    await i18n.enter('admin');
    await i18n.use('ro');
    const item = { ...base, count: { kind: 'reviews' as const, value: 1240 } };
    const ro = accountRow(item, i18n);
    await i18n.use('en');
    const en = accountRow(item, i18n);

    expect(ro.count).toBe('1.240 de recenzii');
    expect(en.count).toBe('1,240 reviews');
  });

  it('gives the same row for the same item twice', async () => {
    const i18n = TestBed.inject(I18n);
    await i18n.enter('admin');
    await i18n.use('ro');

    expect(accountRow(base, i18n)).toEqual(accountRow(base, i18n));
  });
});

describe('the count at the edges', () => {
  it.each([
    [2, 'cont de 2 zile', '2-day-old account'],
    [6, 'cont de 6 zile', '6-day-old account'],
    [19, 'cont de 19 zile', '19-day-old account'],
    [20, 'cont de 20 de zile', '20-day-old account'],
    [101, 'cont de 101 zile', '101-day-old account'],
    [119, 'cont de 119 zile', '119-day-old account'],
  ])('reads an age of %i days', async (value, ro, en) => {
    const count = { kind: 'age' as const, value };

    expect((await row({ count })).count).toBe(ro);
    expect((await row({ count }, 'en')).count).toBe(en);
  });

  it.each([
    [2, '2 cereri'],
    [19, '19 cereri'],
    [20, '20 de cereri'],
    [100, '100 de cereri'],
    [101, '101 cereri'],
    [102, '102 cereri'],
    [1_000_000, '1.000.000 de cereri'],
  ])('reads %i requests in Romanian', async (value, ro) => {
    expect((await row({ count: { kind: 'requests', value } })).count).toBe(ro);
  });

  it('reads one million requests grouped in English', async () => {
    const out = await row(
      { count: { kind: 'requests', value: 1_000_000 } },
      'en',
    );

    expect(out.count).toBe('1,000,000 requests');
  });
});
