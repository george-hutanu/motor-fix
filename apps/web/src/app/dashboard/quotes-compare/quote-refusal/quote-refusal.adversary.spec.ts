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
  ])('is not the network for a 502 with %s', async (_name, body) => {
    const said = quoteRefusal(await i18n('ro'), http(502, body));

    expect(said.network).toBe(false);
    expect(said.text).not.toContain('driver.quotes');
    expect(said.text).not.toBe('');
  });

  it.each([
    ['an empty', ''],
    ['a numeric', 7],
    ['a null', null],
    ['an object', { a: 1 }],
  ])(
    'ignores %s message and falls back to the code',
    async (_name, message) => {
      const said = quoteRefusal(
        await i18n('ro'),
        http(409, { code: 'slot_passed', message }),
      );

      expect(said.text).toBe('Ora propusă a trecut');
    },
  );

  it('says the server’s message verbatim, markup and unicode untouched', async () => {
    const message = '<img src=x onerror=alert(1)> Șoșele 🚗';

    const said = quoteRefusal(
      await i18n('ro'),
      http(409, { code: 'invalid_transition', currentStatus: 'lost', message }),
    );

    expect(said.text).toBe(message);
  });

  it.each([
    ['an unknown state', { code: 'invalid_transition', currentStatus: 'zzz' }],
    ['a missing state', { code: 'invalid_transition' }],
    [
      'a prototype state',
      { code: 'invalid_transition', currentStatus: '__proto__' },
    ],
    ['an unknown code', { code: 'constructor' }],
  ])(
    'falls back to the generic line for %s, never a raw key',
    async (_name, body) => {
      const words = await i18n('en');

      const said = quoteRefusal(words, http(409, body));

      expect(said.network).toBe(false);
      expect(said.text).toBe(quoteRefusal(words, http(500, {})).text);
      expect(said.text).not.toContain('driver.quotes');
      expect(said.text).not.toContain('undefined');
    },
  );

  it('reads a 404 with no code as not found', async () => {
    const said = quoteRefusal(await i18n('ro'), http(404, {}));

    expect(said.text).toBe('Oferta nu mai există');
  });
});

// @traces 314-FR-004
describe('every refusal a driver can meet reads in both languages', () => {
  const refusals: [string, Record<string, unknown>][] = [
    ['expired', { code: 'invalid_transition', currentStatus: 'expired' }],
    ['withdrawn', { code: 'invalid_transition', currentStatus: 'withdrawn' }],
    ['accepted', { code: 'invalid_transition', currentStatus: 'accepted' }],
    ['lost', { code: 'invalid_transition', currentStatus: 'lost' }],
    [
      'declined',
      { code: 'invalid_transition', currentStatus: 'declined_by_driver' },
    ],
    ['booking pending', { code: 'booking_pending' }],
    ['slot passed', { code: 'slot_passed' }],
    ['not found', { code: 'not_found' }],
  ];

  it.each(refusals)(
    'has its own Romanian and English line for %s',
    async (_name, body) => {
      const generic = quoteRefusal(await i18n('ro'), http(500, {})).text;
      const ro = quoteRefusal(TestBed.inject(I18n), http(409, body)).text;
      await TestBed.inject(I18n).use('en');
      const genericEn = quoteRefusal(TestBed.inject(I18n), http(500, {})).text;
      const en = quoteRefusal(TestBed.inject(I18n), http(409, body)).text;

      expect(ro).not.toBe(generic);
      expect(en).not.toBe(genericEn);
      expect(en).not.toBe(ro);
    },
  );

  it('says a suspended garage’s refusal as the garage no longer taking requests', async () => {
    const said = quoteRefusal(
      await i18n('ro'),
      http(409, {
        code: 'invalid_transition',
        currentStatus: 'withdrawn',
        message: 'Service‑ul nu mai primește cereri',
      }),
    );

    expect(said.text).toBe('Service‑ul nu mai primește cereri');
  });
});
