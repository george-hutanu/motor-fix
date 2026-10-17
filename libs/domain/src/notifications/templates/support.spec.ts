import { TEMPLATES } from './registry';
import {
  SUPPORT_ACKNOWLEDGEMENT,
  SUPPORT_MESSAGE,
  supportMessageValues,
} from './support';
import { NOTIFICATION_TYPES } from '../catalogue';
import { checkTemplates } from '../template-check';
import { render } from '../templates';

// @traces 280-FR-015 280-FR-018 280-FR-019 280-FR-022

const contact = 'https://motorfix.test/ro/contact';
const row = {
  email: 'ana@example.test',
  language: 'en',
  message: 'I cannot see the request\nI sent yesterday.',
  name: 'Ana Pop',
  reference: 'MF-2026-000042',
  role: 'driver',
  subjectRef: 'req-42',
  topic: 'account',
};

describe('the support templates', () => {
  it('are registered, go by e-mail only and pass the template check', () => {
    expect(TEMPLATES['SUPPORT_MESSAGE']).toBe(SUPPORT_MESSAGE);
    expect(TEMPLATES['SUPPORT_ACKNOWLEDGEMENT']).toBe(SUPPORT_ACKNOWLEDGEMENT);
    for (const name of ['SUPPORT_MESSAGE', 'SUPPORT_ACKNOWLEDGEMENT']) {
      expect(NOTIFICATION_TYPES[name]).toMatchObject({
        channels: ['email'],
        transactional: true,
      });
    }
    expect(
      checkTemplates({ SUPPORT_ACKNOWLEDGEMENT, SUPPORT_MESSAGE }),
    ).toEqual([]);
  });

  it('hold no address and no domain of their own', () => {
    const texts = JSON.stringify([
      SUPPORT_MESSAGE.email,
      SUPPORT_ACKNOWLEDGEMENT.email,
    ]);
    expect(texts).not.toMatch(/@|https?:|www\./);
  });
});

describe('the e-mail to the support mailbox', () => {
  const values = { ...supportMessageValues(row), contact };

  it('is in Romanian whatever the sender’s language, with every detail', () => {
    const mail = render('SUPPORT_MESSAGE', 'email', 'ro', values);

    expect(mail.subject).toBe('[MF-2026-000042] Contul meu: Ana Pop');
    for (const part of [
      'Ana Pop',
      'ana@example.test',
      'șofer',
      'engleză',
      'req-42',
      'I cannot see the request',
    ]) {
      expect(mail.text).toContain(part);
    }
  });

  it.each([
    ['visitor', 'vizitator'],
    ['garage', 'service'],
    ['admin', 'administrator'],
  ])('names the role %s in Romanian', (role, label) => {
    const mail = render('SUPPORT_MESSAGE', 'email', 'ro', {
      ...supportMessageValues({ ...row, role }),
      contact,
    });
    expect(mail.text).toContain(label);
  });

  it.each([
    ['request_or_booking', 'Cerere sau programare'],
    ['reviews', 'Recenzii'],
    ['listing', 'Listarea service-ului'],
    ['other', 'Altceva'],
  ])('names the topic %s in the subject', (topic, label) => {
    const mail = render('SUPPORT_MESSAGE', 'email', 'ro', {
      ...supportMessageValues({ ...row, topic }),
      contact,
    });
    expect(mail.subject).toBe(`[MF-2026-000042] ${label}: Ana Pop`);
  });

  it('keeps the subject on one line, dropping breaks and control characters', () => {
    const mail = render('SUPPORT_MESSAGE', 'email', 'ro', {
      ...supportMessageValues({
        ...row,
        name: 'Ana\r\nBcc: x@y.test\u0007\u2028Pop',
      }),
      contact,
    });

    expect(mail.subject).toBe(
      '[MF-2026-000042] Contul meu: Ana Bcc: x@y.test Pop',
    );
    expect(mail.subject).not.toMatch(/[\p{Cc}\u2028\u2029]/u);
  });

  it('says so when the message is about no request or booking', () => {
    const mail = render('SUPPORT_MESSAGE', 'email', 'ro', {
      ...supportMessageValues({ ...row, subjectRef: null }),
      contact,
    });
    expect(mail.text).toContain('—');
  });

  it('escapes the sender’s text in the HTML', () => {
    const mail = render('SUPPORT_MESSAGE', 'email', 'ro', {
      ...supportMessageValues({
        ...row,
        message: '<img src=x onerror=alert(1)> și încă ceva',
        name: '<b>Ana</b>',
      }),
      contact,
    });

    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('<b>Ana');
    expect(mail.html).toContain('&lt;img');
  });
});

describe('the acknowledgement to the sender', () => {
  const values = {
    contact,
    message: row.message,
    promise: 'We answer within one working day.',
    reference: row.reference,
  };

  it.each([
    ['ro', 'Am primit mesajul tău (MF-2026-000042)'],
    ['en', 'We have your message (MF-2026-000042)'],
  ])(
    'in %s gives the reference, the promise and a copy',
    (language, subject) => {
      const mail = render('SUPPORT_ACKNOWLEDGEMENT', 'email', language, values);

      expect(mail.subject).toBe(subject);
      expect(mail.text).toContain('MF-2026-000042');
      expect(mail.text).toContain(values.promise);
      expect(mail.text).toContain('I cannot see the request');
      expect(mail.text).toContain(contact);
    },
  );
});
