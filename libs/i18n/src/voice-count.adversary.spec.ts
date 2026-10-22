import { TestBed } from '@angular/core/testing';

import { I18n } from './i18n';

describe('voice 3 count plurals', () => {
  let i18n: I18n;

  beforeEach(async () => {
    i18n = TestBed.inject(I18n);
    await i18n.enter('public');
  });

  // @traces 007-brand-headline-FR-006
  it.each([
    [0, '0 service‑uri.'],
    [1, '1 service.'],
    [2, '2 service‑uri.'],
    [19, '19 service‑uri.'],
    [20, '20 de service‑uri.'],
    [101, '101 service‑uri.'],
    [120, '120 de service‑uri.'],
    [1001, '1001 service‑uri.'],
  ])('reads %i takers in Romanian as %s', (count, text) => {
    expect(i18n.t('public.voice.v3.count', { count })).toBe(text);
  });

  it.each([
    [1, '1 garage.'],
    [2, '2 garages.'],
    [0, '0 garages.'],
    [101, '101 garages.'],
  ])('reads %i takers in English as %s', async (count, text) => {
    await i18n.use('en');
    expect(i18n.t('public.voice.v3.count', { count })).toBe(text);
  });

  it('reads the none and top lines in both languages', async () => {
    expect(i18n.t('public.voice.v3.none')).toBe('Niciun service încă.');
    expect(i18n.t('public.voice.v3.top', { rating: '4,9' })).toBe(
      'Nota maximă: 4,9.',
    );
    await i18n.use('en');
    expect(i18n.t('public.voice.v3.none')).toBe('No garage yet.');
    expect(i18n.t('public.voice.v3.top', { rating: '4.9' })).toBe(
      'Top rating: 4.9.',
    );
  });

  it('builds the whole headline from the brand and its figures', () => {
    expect(
      i18n.t('public.voice.v3.headline', { brand: 'BMW', figures: '' }),
    ).toBe('BMW.');
  });
});
