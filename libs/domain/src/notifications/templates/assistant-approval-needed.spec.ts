// @traces 1254-FR-003
import { TEMPLATES } from './registry';
import { checkTemplates } from '../template-check';
import { render, templateName } from '../templates';

const KIND = 'ASSISTANT_APPROVAL_NEEDED';
const link =
  'https://motorfix.test/app/assistant/approvals/6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b';
const params = { link };

describe("the message of an assistant's action waiting for approval", () => {
  it('is the template the notification type picks, and passes the check', () => {
    expect(templateName(KIND, params)).toBe(KIND);
    expect(TEMPLATES[KIND]).toBeDefined();
    expect(checkTemplates({ [KIND]: TEMPLATES[KIND] })).toEqual([]);
  });

  it('says in the bell that the assistant wants to do something', () => {
    expect(render(KIND, 'bell', 'ro', params)).toBe(
      'Asistentul tău vrea să facă ceva. Aprobă în aplicație.',
    );
    expect(render(KIND, 'bell', 'en', params)).toBe(
      'Your assistant wants to do something. Approve it in the app.',
    );
  });

  it.each([
    ['ro', 'Asistentul tău vrea să facă ceva'],
    ['en', 'Your assistant wants to do something'],
  ])('opens the approval from the %s push', (language, title) => {
    const push = render(KIND, 'push', language, params);

    expect(push.title).toBe(title);
    expect(push.link).toBe(link);
  });

  it.each([
    ['ro', 'Aprobă acțiunea asistentului tău'],
    ['en', "Approve your assistant's action"],
  ])('links the %s e-mail to the approval', (language, subject) => {
    const mail = render(KIND, 'email', language, params);

    expect(mail.subject).toBe(subject);
    expect(mail.html).toContain(link);
    expect(mail.text).toContain(link);
  });
});
