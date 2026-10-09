import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'QUOTE_RECEIVED';
const link = 'https://motorfix.test/app/driver/requests/r-1';
const params = {
  app: 'https://motorfix.test',
  garage: 'Atelier Dinamo',
  link,
  range: '650–800',
};

// @traces 344-FR-016
describe('the new quote message to the driver', () => {
  it('is registered for the driver and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('driver');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('has e-mail, push, WhatsApp and bell texts in both languages', () => {
    for (const channel of ['email', 'push', 'whatsapp', 'bell'] as const) {
      expect(Object.keys(TEMPLATES[KIND]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('stays on e-mail, push and WhatsApp in the catalogue', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
  });

  it('reads "Ofertă nouă de la {garage}: {range} lei" in the push and the bell', () => {
    const push = render(KIND, 'push', 'ro', params);

    expect(push.body).toBe('Ofertă nouă de la Atelier Dinamo: 650–800 lei');
    expect(push.link).toBe(link);
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Ofertă nouă de la Atelier Dinamo: 650–800 lei',
    );
  });

  it('reads the same line in English', () => {
    expect(render(KIND, 'push', 'en', params).body).toBe(
      'New quote from Atelier Dinamo: 650–800 lei',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'New quote from Atelier Dinamo: 650–800 lei',
    );
  });

  it.each(['ro', 'en'])(
    'sends an e-mail in %s whose button opens the driver’s request',
    (language) => {
      const mail = render(KIND, 'email', language, params);

      expect(mail.subject).toContain('Atelier Dinamo');
      expect(mail.subject).toContain('650–800 lei');
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(link);
    },
  );

  it.each(['ro', 'en'])(
    'names the approved WhatsApp template in %s, with the garage and the range',
    (language) => {
      expect(render(KIND, 'whatsapp', language, params)).toEqual({
        name: `motorfix_quote_received_${language}`,
        params: ['Atelier Dinamo', '650–800'],
      });
    },
  );

  it('takes the garage, the range and the link only', () => {
    const values = Object.keys(TEMPLATES[KIND]?.values ?? {}).sort();

    expect(values).toEqual(['garage', 'link', 'range']);
  });

  it('keeps the grouped e-mail as it was', () => {
    const grouped = render('QUOTE_RECEIVED.grouped', 'email', 'ro', {
      app: 'https://motorfix.test',
      count: 3,
    });

    expect(grouped.subject).toBe('3 oferte noi');
    expect(TEMPLATES['QUOTE_RECEIVED.grouped']?.values).toEqual({
      count: 'count',
    });
  });
});
