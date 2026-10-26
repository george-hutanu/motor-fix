import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

const KIND = 'QUOTE_LOST';
const link = 'https://motorfix.test/app/garage/requests';
const params = { app: 'https://motorfix.test', car: 'Dacia Logan', link };
const CHANNELS = ['email', 'push', 'whatsapp', 'bell'] as const;

// @traces 223-FR-001 223-FR-011 223-FR-012 223-FR-015 223-FR-016
describe('the lost quote message to garage staff', () => {
  it('is registered for the garage and passes the template check', () => {
    expect(TEMPLATES[KIND]?.audience).toBe('garage');
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('has e-mail, push, WhatsApp and bell texts in both languages', () => {
    for (const channel of CHANNELS) {
      expect(Object.keys(TEMPLATES[KIND]?.[channel] ?? {}).sort()).toEqual([
        'en',
        'ro',
      ]);
    }
  });

  it('declares only the car and the link, never a plate, phone or driver', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'car',
      'link',
    ]);
  });

  it('stays an urgent event on e-mail, push and WhatsApp, never SMS', () => {
    expect(NOTIFICATION_TYPES[KIND].channels).toEqual([
      'email',
      'push',
      'whatsapp',
    ]);
    expect(NOTIFICATION_TYPES[KIND].urgent).toBe(true);
  });

  it('says the customer chose another garage in the bell, naming the car', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Clientul a ales alt service · Dacia Logan',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'The customer chose another garage · Dacia Logan',
    );
  });

  it('titles the push Ofertă pierdută, opening the garage requests', () => {
    const ro = render(KIND, 'push', 'ro', params);
    const en = render(KIND, 'push', 'en', params);

    expect(ro.title).toBe('Ofertă pierdută');
    expect(ro.body).toBe('Clientul a ales alt service · Dacia Logan');
    expect(ro.link).toBe(link);
    expect(en.title).toBe('Quote lost');
    expect(en.body).toBe('The customer chose another garage · Dacia Logan');
    expect(en.link).toBe(link);
  });

  it('writes the e-mail with the car in the subject and the line in the body', () => {
    const ro = render(KIND, 'email', 'ro', params);
    const en = render(KIND, 'email', 'en', params);

    expect(ro.subject).toBe('Ofertă pierdută: Dacia Logan');
    expect(en.subject).toBe('Quote lost: Dacia Logan');
    expect(ro.text).toContain('Clientul a ales alt service.');
    expect(en.text).toContain('The customer chose another garage.');
    for (const mail of [ro, en]) {
      expect(mail.text).toContain('Dacia Logan');
      expect(mail.html).toContain(link);
    }
  });

  it('names its WhatsApp template per language with the car as its slot', () => {
    expect(TEMPLATES[KIND]?.whatsapp?.ro).toEqual({
      name: 'motorfix_quote_lost_ro',
      slots: ['{car}'],
    });
    expect(TEMPLATES[KIND]?.whatsapp?.en).toEqual({
      name: 'motorfix_quote_lost_en',
      slots: ['{car}'],
    });
  });
});
