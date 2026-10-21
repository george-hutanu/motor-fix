import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { quoteRefusal } from './quote-refusal';

afterEach(() => TestBed.resetTestingModule());

async function i18n(language: 'ro' | 'en') {
  const service = TestBed.inject(I18n);
  await service.enter('driver');
  if (language === 'en') await service.use('en');
  return service;
}

const http = (status: number, error: unknown) =>
  new HttpErrorResponse({ error, status });

// @traces 314-FR-004
describe('what a failed accept or decline tells the driver, odd failures', () => {
  it.each([
    ['null', null],
    ['a string', 'boom'],
    ['an Error', new Error('boom')],
    ['undefined', undefined],
  ])('treats %s as the network, free to send again', async (_name, error) => {
    const words = await i18n('ro');

    const said = quoteRefusal(words, error);

    expect(said).toEqual({
      network: true,
      text: 'Nu am putut trimite. Verifică conexiunea și încearcă din nou.',
    });
  });

  it('treats a status 0 answer as the network', async () => {
    const said = quoteRefusal(await i18n('en'), http(0, null));

    expect(said.network).toBe(true);
  });

  it.each([
    ['an html page', '<html>Bad gateway</html>'],
    ['a null body', null],
    ['an array', ['x']],
    ['a number', 42],
  ])('says a plain failure for a 502 with %s', async (_name, body) => {
    const words = await i18n('ro');

    const said = quoteRefusal(words, http(502, body));

    expect(said).toEqual({
      network: false,
      text: words.t('driver.quotes.problem.error'),
    });
  });

  it.each([
    ['an empty', ''],
    ['a numeric', 7],
    ['a null', null],
    ['an object', { a: 1 }],
  ])(
    'says a plain failure for a 409 with %s detail, never a raw key',
    async (_name, detail) => {
      const words = await i18n('en');

      const said = quoteRefusal(
        words,
        http(409, { code: 'invalid_transition', currentStatus: 'zzz', detail }),
      );

      expect(said.text).toBe(words.t('driver.quotes.problem.error'));
      expect(said.text).not.toContain('driver.quotes');
    },
  );

  it('says the server’s words verbatim, markup and unicode untouched', async () => {
    const detail = '<img src=x onerror=alert(1)> Șoșele 🚗';

    const said = quoteRefusal(
      await i18n('ro'),
      http(409, { code: 'invalid_transition', currentStatus: 'lost', detail }),
    );

    expect(said.text).toBe(detail);
  });

  it('reads a 404 as the quote gone, in both languages, whatever its detail', async () => {
    const gone = http(404, { code: 'not_found', detail: 'Not Found' });

    expect(quoteRefusal(await i18n('ro'), gone).text).toBe(
      'Oferta nu mai există',
    );
    expect(quoteRefusal(await i18n('en'), gone).text).toBe(
      'The quote no longer exists',
    );
  });

  it('says a suspended garage’s refusal as the server words it', async () => {
    const said = quoteRefusal(
      await i18n('ro'),
      http(409, {
        code: 'invalid_transition',
        currentStatus: 'withdrawn',
        detail: 'Service‑ul nu mai primește cereri',
      }),
    );

    expect(said.text).toBe('Service‑ul nu mai primește cereri');
  });
});
