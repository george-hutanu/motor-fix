import { TestBed } from '@angular/core/testing';

import { I18n } from './i18n';

const KEY = 'shell.frame.admin.waiting';

async function line(language: 'ro' | 'en', count: number) {
  const i18n = TestBed.inject(I18n);
  await i18n.use(language);
  return i18n.t(KEY, { count });
}

describe('the admin header line in each plural form', () => {
  it.each([
    [1, '1 service așteaptă verificarea'],
    [2, '2 service‑uri așteaptă verificarea'],
    [19, '19 service‑uri așteaptă verificarea'],
    [20, '20 de service‑uri așteaptă verificarea'],
    [99, '99 de service‑uri așteaptă verificarea'],
    [101, '101 service‑uri așteaptă verificarea'],
    [119, '119 service‑uri așteaptă verificarea'],
    [120, '120 de service‑uri așteaptă verificarea'],
  ])('reads %i in Romanian', async (count, text) => {
    expect(await line('ro', count)).toBe(text);
  });

  it.each([
    [1, '1 garage is waiting for verification'],
    [2, '2 garages are waiting for verification'],
    [100, '100 garages are waiting for verification'],
  ])('reads %i in English', async (count, text) => {
    expect(await line('en', count)).toBe(text);
  });

  it('keeps the non-breaking hyphen in the Romanian forms', async () => {
    expect(await line('ro', 3)).not.toContain('-');
  });

  it('fills the counter label with the label and the full number', async () => {
    const i18n = TestBed.inject(I18n);
    await i18n.use('en');

    expect(
      i18n.t('shell.frame.counter', { label: 'Garages', waiting: 1234 }),
    ).toBe('Garages, 1234 waiting');
  });
});
