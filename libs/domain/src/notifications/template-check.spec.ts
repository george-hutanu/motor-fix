// @traces 195-FR-009
import { checkTemplates } from './template-check';
import type { Template } from './templates';
import { TEMPLATES } from './templates/registry';

const mail = (subject: string) => ({
  button: { label: 'Open', link: 'app' },
  lines: [subject],
  reason: 'Because.',
  subject,
});

const good: Template = {
  audience: 'driver',
  bell: { en: 'Quote from {garage}', ro: 'Ofertă de la {garage}' },
  email: { en: mail('Quote {range}'), ro: mail('Ofertă {range}') },
  example: { garage: 'Auto Ion', link: 'https://m.fx/q/1', range: [1, 2] },
  push: {
    en: { body: 'Open it.', link: 'link', title: 'New quote' },
    ro: { body: 'Deschide.', link: 'link', title: 'Ofertă nouă' },
  },
  sms: { en: 'New quote: {link}', ro: 'Ofertă nouă: {link}' },
  values: { garage: 'text', link: 'link', range: 'lei' },
  whatsapp: {
    en: { name: 'quote_en', slots: ['{garage}'] },
    ro: { name: 'quote_ro', slots: ['{garage}'] },
  },
};

const only = (name: string, template: Template) =>
  checkTemplates({ [name]: template });

describe('the template check', () => {
  it('passes every template in the repository', () => {
    expect(checkTemplates(TEMPLATES)).toEqual([]);
  });

  it('passes a template that keeps every rule on every channel', () => {
    expect(only('QUOTE_RECEIVED', good)).toEqual([]);
  });

  it('fails a template whose English text is missing, naming the channel', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        bell: { ro: 'Ofertă de la {garage}' },
      }),
    ).toEqual(['QUOTE_RECEIVED bell: no en text']);
  });

  it('fails a template whose Romanian text is missing', () => {
    expect(
      only('QUOTE_RECEIVED', { ...good, sms: { en: 'New quote: {link}' } }),
    ).toEqual(['QUOTE_RECEIVED sms: no ro text']);
  });

  it.each([
    'garage',
    'mechanic',
    'admin',
    'any',
  ] as const)('fails a %s template that uses a plate', (audience) => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        audience,
        example: { ...good.example, plate: 'B 12 ABC' },
        values: { ...good.values, plate: 'text' },
      }),
    ).toEqual(['QUOTE_RECEIVED: plate in a template for a non-driver']);
  });

  it('lets the day sheet and a driver template use a plate', () => {
    const plated = {
      ...good,
      example: { ...good.example, plate: 'B 12 ABC' },
      values: { ...good.values, plate: 'text' as const },
    };
    expect(only('DAY_SHEET', { ...plated, audience: 'garage' })).toEqual([]);
    expect(only('QUOTE_RECEIVED', plated)).toEqual([]);
  });

  it('fails any template that uses a phone number, the day sheet included', () => {
    const phoned = {
      ...good,
      example: { ...good.example, phone: '+40700000000' },
      values: { ...good.values, phone: 'text' as const },
    };
    expect(only('QUOTE_RECEIVED', phoned)).toEqual([
      'QUOTE_RECEIVED: phone number in a template',
    ]);
    expect(only('DAY_SHEET', { ...phoned, audience: 'garage' })).toEqual([
      'DAY_SHEET: phone number in a template',
    ]);
  });

  it('fails a push whose title or body is too long with its example values', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        push: {
          en: { body: 'Open it.', link: 'link', title: 'x'.repeat(51) },
          ro: good.push?.ro,
        },
      }),
    ).toEqual(['QUOTE_RECEIVED push en: push title over 50 characters']);
  });

  it('fails a push with no link', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        push: {
          en: { body: 'Open it.', link: '', title: 'New quote' },
          ro: good.push?.ro,
        },
      }),
    ).toEqual(['QUOTE_RECEIVED push en: no link']);
  });

  it('fails an SMS that is over 70 characters in Romanian with diacritics', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        sms: {
          en: 'New quote: {link}',
          ro: `Ofertă nouă de la ${'ș'.repeat(40)}: {link}`,
        },
      }),
    ).toEqual(['QUOTE_RECEIVED sms ro: sms over 70 characters']);
  });

  it('fails a WhatsApp template with no approved name or an empty slot', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        whatsapp: {
          en: { name: '', slots: ['{garage}'] },
          ro: { name: 'quote_ro', slots: [''] },
        },
      }),
    ).toEqual([
      'QUOTE_RECEIVED whatsapp en: no approved template name',
      'QUOTE_RECEIVED whatsapp ro: empty slot 1',
    ]);
  });

  it('fails Romanian written with a cedilla ş or ţ', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        bell: {
          en: 'Quote from {garage}',
          ro: 'Ofertă nouă de la {garage}, aţi primit',
        },
      }),
    ).toEqual(['QUOTE_RECEIVED bell ro: ş or ţ with a cedilla']);
  });

  it('fails a placeholder the template does not declare', () => {
    expect(
      only('QUOTE_RECEIVED', {
        ...good,
        bell: { en: 'Quote from {who}', ro: 'Ofertă de la {who}' },
      }),
    ).toEqual([
      'QUOTE_RECEIVED bell en: undeclared value who',
      'QUOTE_RECEIVED bell ro: undeclared value who',
    ]);
  });

  it('fails a template whose example values do not render it', () => {
    expect(
      only('QUOTE_RECEIVED', { ...good, example: { link: 'https://m.fx' } }),
    ).toContain('QUOTE_RECEIVED bell en: missing value garage');
  });

  it('fails a template of a type the catalogue does not know', () => {
    expect(only('QUOTE_RECIEVED', good)).toEqual([
      'QUOTE_RECIEVED: not a notification type',
    ]);
    expect(only('QUOTE_RECEIVED.grouped', good)).toEqual([]);
    expect(only('GENERIC', good)).toEqual([]);
  });
});
