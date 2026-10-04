import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { FILES } from './files';
import { I18n } from './i18n';
import { AREAS, LANGUAGES } from './languages';

const shellEn = {
  brand: 'MotorFix',
  health: {
    status: 'PostgreSQL: {postgres} · Redis: {redis}',
    unknown: 'unknown',
  },
  version: { unknown: 'version unknown' },
};

function spyOnEveryLoader() {
  const spies = new Map<string, jest.SpyInstance>();
  for (const area of AREAS)
    for (const language of LANGUAGES) {
      const files = FILES[area] as Record<string, () => Promise<unknown>>;
      if (files[language])
        spies.set(`${area}/${language}`, jest.spyOn(files, language));
    }
  return spies;
}

const calledLoaders = (spies: Map<string, jest.SpyInstance>) =>
  [...spies].filter(([, spy]) => spy.mock.calls.length > 0).map(([n]) => n);

describe('I18n', () => {
  let i18n: I18n;

  beforeEach(() => {
    i18n = TestBed.inject(I18n);
  });

  afterEach(() => jest.restoreAllMocks());

  it('starts in Romanian with the shell texts ready', () => {
    expect(i18n.language()).toBe('ro');
    expect(i18n.t('shell.brand')).toBe('MotorFix');
    expect(i18n.t('shell.version.unknown')).toBe('versiune necunoscută');
  });

  it('switches to English and declares it on the page', async () => {
    await i18n.use('en');

    expect(i18n.language()).toBe('en');
    expect(i18n.t('shell.version.unknown')).toBe('version unknown');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('en');
  });

  it('switches back to Romanian', async () => {
    await i18n.use('en');
    await i18n.use('ro');

    expect(i18n.t('shell.health.unknown')).toBe('necunoscut');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('ro');
  });

  it('ignores a language it does not support', async () => {
    await i18n.use('de');

    expect(i18n.language()).toBe('ro');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).not.toBe('de');
  });

  it('ends on the last language chosen when switched twice quickly', async () => {
    await Promise.all([i18n.use('en'), i18n.use('ro')]);

    expect(i18n.language()).toBe('ro');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('ro');
  });

  it('fills placeholders and leaves one without a value as written', () => {
    expect(
      i18n.t('shell.health.status', { postgres: 'ok', redis: 'error' }),
    ).toBe('PostgreSQL: ok · Redis: error');
    expect(i18n.t('shell.health.status', { postgres: 'ok' })).toBe(
      'PostgreSQL: ok · Redis: {redis}',
    );
  });

  describe('when English is missing', () => {
    it('shows Romanian for a key missing in English', async () => {
      jest
        .spyOn(FILES.shell, 'en')
        .mockResolvedValue({ ...shellEn, version: {} });

      await i18n.use('en');

      expect(i18n.t('shell.version.unknown')).toBe('versiune necunoscută');
      expect(i18n.t('shell.health.unknown')).toBe('unknown');
    });

    it('shows Romanian for an empty English text', async () => {
      jest
        .spyOn(FILES.shell, 'en')
        .mockResolvedValue({ ...shellEn, version: { unknown: '' } });

      await i18n.use('en');

      expect(i18n.t('shell.version.unknown')).toBe('versiune necunoscută');
    });

    it('keeps Romanian when the English file fails, and tries it again on the next switch', async () => {
      const loader = jest
        .spyOn(FILES.shell, 'en')
        .mockRejectedValueOnce(new Error('offline'));

      await i18n.use('en');

      expect(i18n.language()).toBe('en');
      expect(i18n.t('shell.version.unknown')).toBe('versiune necunoscută');

      await i18n.use('en');

      expect(loader).toHaveBeenCalledTimes(2);
      expect(i18n.t('shell.version.unknown')).toBe('version unknown');
    });
  });

  describe('areas', () => {
    it('loads only the Romanian file of the area entered', async () => {
      const spies = spyOnEveryLoader();

      await i18n.enter('public');

      expect(calledLoaders(spies)).toEqual(['public/ro']);
    });

    it('loads the English file too when English is current, and no other area', async () => {
      const spies = spyOnEveryLoader();

      await i18n.use('en');
      await i18n.enter('garage');

      expect(calledLoaders(spies).sort()).toEqual([
        'garage/en',
        'garage/ro',
        'shell/en',
      ]);
    });

    it('loads the English file of every entered area on a switch', async () => {
      await i18n.enter('driver');
      const spies = spyOnEveryLoader();

      await i18n.use('en');

      expect(calledLoaders(spies).sort()).toEqual(['driver/en', 'shell/en']);
    });

    it('prefixes an area file’s keys with the area', async () => {
      jest
        .spyOn(FILES.public, 'ro')
        .mockResolvedValue({ home: { title: 'Acasă' } });

      await i18n.enter('public');

      expect(i18n.t('public.home.title')).toBe('Acasă');
    });
  });

  describe('counts', () => {
    beforeEach(async () => {
      jest.spyOn(FILES.public, 'ro').mockResolvedValue({
        results: {
          count: {
            few: '{count} service-uri',
            one: '{count} service',
            other: '{count} de service-uri',
          },
        },
      });
      jest.spyOn(FILES.public, 'en').mockResolvedValue({
        results: { count: { one: '{count} garage', other: '{count} garages' } },
      });
      await i18n.enter('public');
    });

    it.each([
      [0, '0 service-uri'],
      [1, '1 service'],
      [3, '3 service-uri'],
      [19, '19 service-uri'],
      [20, '20 de service-uri'],
      [48, '48 de service-uri'],
    ])('reads %i in Romanian as "%s"', (count, text) => {
      expect(i18n.t('public.results.count', { count })).toBe(text);
    });

    it('reads counts in English by the English rules', async () => {
      await i18n.use('en');

      expect(i18n.t('public.results.count', { count: 1 })).toBe('1 garage');
      expect(i18n.t('public.results.count', { count: 3 })).toBe('3 garages');
    });
  });
});
