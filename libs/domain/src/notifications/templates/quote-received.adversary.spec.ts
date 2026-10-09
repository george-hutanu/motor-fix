import { QUOTE_RECEIVED } from './quote-received';
import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

// @traces 344-FR-016

const params = {
  app: 'https://motorfix.test',
  garage: 'Atelier Dinamo',
  link: 'https://motorfix.test/app/driver/requests',
  range: '650–800',
};

describe('QUOTE_RECEIVED single-quote templates', () => {
  it('keeps a Romanian clitic on one line with a non-breaking hyphen', () => {
    expect(JSON.stringify(QUOTE_RECEIVED)).not.toMatch(/ți-a/);
    expect(JSON.stringify(QUOTE_RECEIVED)).toContain('ți\u2011a');
  });

  it('passes the template check', () => {
    expect(checkTemplates(TEMPLATES)).toEqual([]);
  });

  it.each([
    ['ro', 'Ofertă nouă de la Atelier Dinamo: 650–800 lei'],
    ['en', 'New quote from Atelier Dinamo: 650–800 lei'],
  ])('renders the bell in %s', (language, text) => {
    expect(render('QUOTE_RECEIVED', 'bell', language, params)).toBe(text);
  });

  it.each([
    ['ro', 'Ofertă nouă', 'Ofertă nouă de la Atelier Dinamo: 650–800 lei'],
    ['en', 'New quote', 'New quote from Atelier Dinamo: 650–800 lei'],
  ])('renders the push in %s with the link', (language, title, body) => {
    expect(render('QUOTE_RECEIVED', 'push', language, params)).toEqual({
      body,
      link: params.link,
      title,
    });
  });

  it.each([
    ['ro', 'motorfix_quote_received_ro'],
    ['en', 'motorfix_quote_received_en'],
  ])('renders the WhatsApp slots in %s', (language, name) => {
    expect(render('QUOTE_RECEIVED', 'whatsapp', language, params)).toEqual({
      name,
      params: ['Atelier Dinamo', '650–800'],
    });
  });

  it.each(['ro', 'en'])('links the %s e-mail button to the request', (l) => {
    const mail = render('QUOTE_RECEIVED', 'email', l, params);
    expect(mail.text).toContain(params.link);
    expect(mail.subject).toContain('Atelier Dinamo');
    expect(mail.subject).toContain('650–800');
  });

  it('falls back to Romanian for an unknown language', () => {
    expect(render('QUOTE_RECEIVED', 'bell', 'fr', params)).toBe(
      'Ofertă nouă de la Atelier Dinamo: 650–800 lei',
    );
  });

  it('fails the render when the garage is missing', () => {
    const { garage: _garage, ...rest } = params;
    expect(() => render('QUOTE_RECEIVED', 'bell', 'ro', rest)).toThrow(
      /missing value garage/,
    );
  });

  it('fails the render when the range is null', () => {
    expect(() =>
      render('QUOTE_RECEIVED', 'bell', 'en', { ...params, range: null }),
    ).toThrow(/missing value range/);
  });

  it('keeps markup in a garage name out of the e-mail html', () => {
    const mail = render('QUOTE_RECEIVED', 'email', 'en', {
      ...params,
      garage: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
  });

  it('refuses an e-mail link that is not https', () => {
    expect(() =>
      render('QUOTE_RECEIVED', 'email', 'en', {
        ...params,
        link: 'javascript:alert(1)',
      }),
    ).toThrow(/link/);
  });

  it('fails the push render when the garage name pushes the body past 120 characters', () => {
    expect(() =>
      render('QUOTE_RECEIVED', 'push', 'en', {
        ...params,
        garage: 'G'.repeat(120),
      }),
    ).toThrow(/push body over 120/);
  });

  it('still holds the grouped e-mail', () => {
    expect(
      render('QUOTE_RECEIVED.grouped', 'email', 'en', {
        app: params.app,
        count: 3,
      }).subject,
    ).toBe('3 new quotes');
  });
});
