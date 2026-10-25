import { TEMPLATES } from './registry';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { bellText, render, templateName } from '../templates';

const KIND = 'REQUEST_CANCELLED';
const CLOSED = 'REQUEST_CANCELLED.account_closed';
const link = 'https://motorfix.test/app/garage/requests';
const params = (reason?: string) => ({
  app: 'https://motorfix.test',
  car: 'Dacia Logan',
  driver: 'Andrei M.',
  link,
  ...(reason && { reason }),
});
const CHANNELS = ['email', 'push', 'whatsapp', 'bell'] as const;

// @traces 223-FR-003 223-FR-005 223-FR-011 223-FR-012 223-FR-015
describe('the cancelled request message to garage staff', () => {
  it('is registered in both wordings for the garage and passes the template check', () => {
    for (const name of [KIND, CLOSED]) {
      expect(TEMPLATES[name]?.audience).toBe('garage');
      expect(checkTemplates({ [name]: TEMPLATES[name] })).toEqual([]);
      for (const channel of CHANNELS) {
        expect(Object.keys(TEMPLATES[name]?.[channel] ?? {}).sort()).toEqual([
          'en',
          'ro',
        ]);
      }
    }
  });

  it('picks the closed wording for a closed account and the driver’s for any other reason', () => {
    expect(templateName(KIND, { reason: 'account_closed' })).toBe(CLOSED);
    for (const reason of ['cancelled', 'expired', 'accont_closed', undefined]) {
      expect(templateName(KIND, { reason })).toBe(KIND);
    }
  });

  it('declares no plate and no phone', () => {
    expect(Object.keys(TEMPLATES[KIND]?.values ?? {}).sort()).toEqual([
      'car',
      'driver',
      'link',
    ]);
    expect(Object.keys(TEMPLATES[CLOSED]?.values ?? {}).sort()).toEqual([
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

  it('says the request was closed in the bell when the account closed', () => {
    const closed = params('account_closed');
    expect(bellText(KIND, 'ro', closed)).toBe(
      'Cererea a fost închisă · Dacia Logan',
    );
    expect(bellText(KIND, 'en', closed)).toBe(
      'The request was closed · Dacia Logan',
    );
  });

  it('names the driver who cancelled in the bell otherwise', () => {
    expect(bellText(KIND, 'ro', params('cancelled'))).toBe(
      'Andrei M. a anulat cererea · Dacia Logan',
    );
    expect(bellText(KIND, 'en', params())).toBe(
      'Andrei M. cancelled the request · Dacia Logan',
    );
  });

  it('pushes each wording, opening the garage requests', () => {
    const closedRo = render(CLOSED, 'push', 'ro', params('account_closed'));
    const closedEn = render(CLOSED, 'push', 'en', params('account_closed'));
    const byDriverRo = render(KIND, 'push', 'ro', params('cancelled'));
    const byDriverEn = render(KIND, 'push', 'en', params('cancelled'));

    expect(closedRo.body).toBe('Cererea a fost închisă · Dacia Logan');
    expect(closedEn.body).toBe('The request was closed · Dacia Logan');
    expect(byDriverRo.body).toBe('Andrei M. a anulat cererea · Dacia Logan');
    expect(byDriverEn.body).toBe(
      'Andrei M. cancelled the request · Dacia Logan',
    );
    for (const push of [closedRo, closedEn, byDriverRo, byDriverEn]) {
      expect(push.link).toBe(link);
    }
  });

  it('writes its own e-mail in each wording, not the generic text', () => {
    const generic = render('GENERIC', 'email', 'ro', params());
    const closedRo = render(CLOSED, 'email', 'ro', params('account_closed'));
    const closedEn = render(CLOSED, 'email', 'en', params('account_closed'));
    const byDriverRo = render(KIND, 'email', 'ro', params('cancelled'));
    const byDriverEn = render(KIND, 'email', 'en', params('cancelled'));

    expect(closedRo.text).toContain('Cererea a fost închisă.');
    expect(closedEn.text).toContain('The request was closed.');
    expect(byDriverRo.text).toContain('Andrei M. a anulat cererea.');
    expect(byDriverEn.text).toContain('Andrei M. cancelled the request.');
    for (const mail of [closedRo, closedEn, byDriverRo, byDriverEn]) {
      expect(mail.subject).toContain('Dacia Logan');
      expect(mail.subject).not.toBe(generic.subject);
      expect(mail.html).toContain(link);
    }
  });
});
