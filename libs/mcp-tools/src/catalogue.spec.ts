import { catalogue } from './catalogue';
import { USER_TEXT_NOTICE } from './registry';

// What an assistant must never be able to do for a person.
const FORBIDDEN = [
  /pay(ment)?s?\b|card|invoice|refund|charge/i,
  /password|passcode/i,
  /e-?mail/i,
  /delet(e|ion)|remove.*account|close.*account/i,
  /legal|document|certificate|upload/i,
  /media|photo|image|video|audio|file/i,
  /live|stream|broadcast/i,
];

describe('catalogue', () => {
  // @traces 365-FR-007
  it('ships exactly get_my_account', () => {
    expect(catalogue.map((t) => t.name)).toEqual(['get_my_account']);
  });

  // @traces 365-FR-010
  it.each(FORBIDDEN.map((pattern) => [pattern.source, pattern] as const))(
    'holds no tool about %s',
    (_source, pattern) => {
      for (const tool of catalogue) {
        expect(`${tool.name} ${tool.description}`).not.toMatch(pattern);
      }
    },
  );

  it('keeps the notice clear of the forbidden words', () => {
    for (const pattern of FORBIDDEN) {
      expect(USER_TEXT_NOTICE).not.toMatch(pattern);
    }
  });

  it.each([
    'pay_invoice',
    'change_password',
    'change_email',
    'delete_account',
    'upload_legal_document',
    'send_photo',
    'start_live_stream',
  ])('would refuse a tool named %s', (name) => {
    expect(FORBIDDEN.some((pattern) => pattern.test(name))).toBe(true);
  });
});
