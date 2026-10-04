import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { FILES } from './files';
import { I18n } from './i18n';

type Loaders = Record<string, () => Promise<unknown>>;
const loaders = (area: 'driver' | 'garage') => FILES[area] as Loaders;

describe('I18n adversarial', () => {
  let i18n: I18n;

  beforeEach(() => {
    i18n = TestBed.inject(I18n);
  });

  afterEach(() => jest.restoreAllMocks());

  it('loads an area once when it is entered twice', async () => {
    const ro = jest
      .spyOn(loaders('garage'), 'ro')
      .mockResolvedValue({ list: { title: 'Ateliere' } });

    await i18n.enter('garage');
    await i18n.enter('garage');

    expect(ro).toHaveBeenCalledTimes(1);
    expect(i18n.t('garage.list.title')).toBe('Ateliere');
  });

  it('loads an area once when it is entered concurrently', async () => {
    const ro = jest
      .spyOn(loaders('garage'), 'ro')
      .mockResolvedValue({ a: 'A' });

    await Promise.all([i18n.enter('garage'), i18n.enter('garage')]);

    expect(ro).toHaveBeenCalledTimes(1);
  });

  it('keeps the language when use is called with the current one', async () => {
    await i18n.use('ro');

    expect(i18n.language()).toBe('ro');
    expect(i18n.t('shell.brand')).toBe('MotorFix');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('ro');
  });

  it('ignores empty, wrongly cased and padded language codes', async () => {
    for (const bad of ['', 'EN', ' en', 'en-US', 'constructor', '__proto__'])
      await i18n.use(bad);

    expect(i18n.language()).toBe('ro');
  });

  it('lets the last of two overlapping use calls win', async () => {
    let release: (v: unknown) => void = () => undefined;
    jest.spyOn(loaders('driver'), 'en').mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    jest.spyOn(loaders('driver'), 'ro').mockResolvedValue({ x: 'ro-x' });
    await i18n.enter('driver');

    const slow = i18n.use('en');
    const fast = i18n.use('ro');
    await fast;
    release({ x: 'en-x' });
    await slow;

    expect(i18n.language()).toBe('ro');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('ro');
  });

  it('keeps other areas working when one area loader rejects', async () => {
    jest.spyOn(loaders('garage'), 'ro').mockRejectedValue(new Error('network'));
    jest.spyOn(loaders('driver'), 'ro').mockResolvedValue({ home: 'Acasa' });

    await i18n.enter('garage').catch(() => undefined);
    await i18n.enter('driver');

    expect(i18n.t('driver.home')).toBe('Acasa');
    expect(i18n.t('garage.list.title')).toBe('garage.list.title');
  });

  it('retries a failed area load on the next enter', async () => {
    const ro = jest
      .spyOn(loaders('garage'), 'ro')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ list: { title: 'Ateliere' } });

    await i18n.enter('garage').catch(() => undefined);
    await i18n.enter('garage');

    expect(ro).toHaveBeenCalledTimes(2);
    expect(i18n.t('garage.list.title')).toBe('Ateliere');
  });

  it('inserts parameter values literally even with replacement patterns', async () => {
    jest
      .spyOn(loaders('garage'), 'ro')
      .mockResolvedValue({ hi: 'Salut {name}, {name}!' });
    await i18n.enter('garage');

    expect(i18n.t('garage.hi', { name: '$&' })).toBe('Salut $&, $&!');
    expect(i18n.t('garage.hi', { name: "$'$`$1" })).toBe(
      "Salut $'$`$1, $'$`$1!",
    );
  });

  it('leaves a placeholder without a parameter as written', () => {
    expect(i18n.t('shell.health.status', { postgres: 'ok' })).toBe(
      'PostgreSQL: ok · Redis: {redis}',
    );
    expect(i18n.t('shell.health.status')).toBe(
      'PostgreSQL: {postgres} · Redis: {redis}',
    );
  });

  it('does not re-expand placeholders found inside a parameter value', () => {
    expect(
      i18n.t('shell.health.status', { postgres: '{redis}', redis: 'down' }),
    ).toBe('PostgreSQL: {redis} · Redis: down');
  });

  it('does not select a plural category when count is a string', async () => {
    jest.spyOn(loaders('garage'), 'ro').mockResolvedValue({
      n: {
        few: '{count} ateliere',
        one: '{count} atelier',
        other: '{count} de ateliere',
      },
    });
    await i18n.enter('garage');

    expect(i18n.t('garage.n', { count: '1' })).toBe('garage.n');
    expect(i18n.t('garage.n', { count: 1 })).toBe('1 atelier');
    expect(i18n.t('garage.n', { count: 0 })).toBe('0 ateliere');
    expect(i18n.t('garage.n', { count: 2 })).toBe('2 ateliere');
    expect(i18n.t('garage.n', { count: 20 })).toBe('20 de ateliere');
  });

  it('treats prototype property names as missing keys', () => {
    expect(i18n.t('constructor')).toBe('constructor');
    expect(i18n.t('__proto__')).toBe('__proto__');
    expect(i18n.t('toString')).toBe('toString');
  });

  it('falls back to Romanian when the English text is an empty string', async () => {
    jest.spyOn(loaders('garage'), 'ro').mockResolvedValue({ a: 'Salut' });
    jest.spyOn(loaders('garage'), 'en').mockResolvedValue({ a: '' });
    await i18n.enter('garage');
    await i18n.use('en');

    expect(i18n.t('garage.a')).toBe('Salut');
  });
});
