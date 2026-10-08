import { createHmac } from 'node:crypto';

import { newsLinks, unsubscribedAccount, unsubscribeToken } from './news';
import { signAccessToken } from '../../auth/access-token';
import { render } from '../templates';

const SECRET = 'test-secret';
const ACCOUNT = '0b9d6a52-6f3e-4d55-9a57-2f1a3c1b7e10';
const OTHER = '6a1f3a0e-2c4b-4f7e-8d2a-9b5c7e1f0a33';

describe('the unsubscribe token', () => {
  it('names the account it was made for', () => {
    expect(unsubscribedAccount(unsubscribeToken(ACCOUNT, SECRET), SECRET)).toBe(
      ACCOUNT,
    );
  });

  it('is the same every time, so a link never expires', () => {
    expect(unsubscribeToken(ACCOUNT, SECRET)).toBe(
      unsubscribeToken(ACCOUNT, SECRET),
    );
  });

  it('fits a URL path and query without escaping', () => {
    expect(unsubscribeToken(ACCOUNT, SECRET)).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('is refused under another secret', () => {
    expect(
      unsubscribedAccount(unsubscribeToken(ACCOUNT, SECRET), 'other-secret'),
    ).toBeNull();
  });

  it('is refused when its account part is swapped for another account', () => {
    const [, signature] = unsubscribeToken(ACCOUNT, SECRET).split('.');
    const swapped = `${OTHER}.${signature}`;
    expect(unsubscribedAccount(swapped, SECRET)).toBeNull();
  });

  it('is not signed with the secret itself, so no other signature passes for it', () => {
    const plain = createHmac('sha256', SECRET)
      .update(ACCOUNT)
      .digest('base64url');
    expect(unsubscribedAccount(`${ACCOUNT}.${plain}`, SECRET)).toBeNull();
    const access = signAccessToken(
      { accountId: ACCOUNT, role: 'driver' },
      SECRET,
    );
    expect(unsubscribedAccount(access, SECRET)).toBeNull();
  });

  it.each([
    '',
    'no-dot-here',
    '.',
    `${ACCOUNT}.`,
    `.${'A'.repeat(43)}`,
    `not-a-uuid.${'A'.repeat(43)}`,
    `${unsubscribeToken(ACCOUNT, SECRET)}.extra`,
    `${unsubscribeToken(ACCOUNT, SECRET).slice(0, -1)}`,
  ])('refuses the malformed token %p', (token) => {
    expect(unsubscribedAccount(token, SECRET)).toBeNull();
  });
});

describe('the stop links of a news e-mail', () => {
  it('open the page in the driver’s language and post to the API on the web app’s own address', () => {
    const token = unsubscribeToken(ACCOUNT, SECRET);
    expect(newsLinks('https://motorfix.test', 'en', token)).toEqual({
      oneClick: `https://motorfix.test/api/v1/notification-preferences/unsubscribe?token=${token}`,
      unsubscribe: `https://motorfix.test/en/unsubscribe/${token}`,
    });
    expect(newsLinks('https://motorfix.test', 'ro', token).unsubscribe).toBe(
      `https://motorfix.test/ro/unsubscribe/${token}`,
    );
  });
});

describe('the news e-mail', () => {
  const params = {
    app: 'https://motorfix.test',
    oneClick:
      'https://motorfix.test/api/v1/notification-preferences/unsubscribe?token=t',
    text: 'Am deschis primele service-uri din Cluj.',
    title: 'Noutăți din octombrie',
    unsubscribe: 'https://motorfix.test/ro/unsubscribe/t',
  };

  it('has the title as its subject and a visible stop link in Romanian', () => {
    const mail = render('NEWS', 'email', 'ro', params);
    expect(mail.subject).toBe('Noutăți din octombrie');
    expect(mail.text).toContain('Am deschis primele service-uri din Cluj.');
    expect(mail.text).toContain(
      'Nu mai vreau noutăți: https://motorfix.test/ro/unsubscribe/t',
    );
    expect(mail.html).toContain(
      '<a href="https://motorfix.test/ro/unsubscribe/t"',
    );
    expect(mail.html).toContain('>Nu mai vreau noutăți</a>');
  });

  it('has the stop link in English', () => {
    const mail = render('NEWS', 'email', 'en', {
      ...params,
      unsubscribe: 'https://motorfix.test/en/unsubscribe/t',
    });
    expect(mail.text).toContain(
      'Stop MotorFix news: https://motorfix.test/en/unsubscribe/t',
    );
    expect(mail.html).toContain('>Stop MotorFix news</a>');
  });

  it('is not written without its stop link', () => {
    const { unsubscribe: _, ...withoutLink } = params;
    expect(() => render('NEWS', 'email', 'ro', withoutLink)).toThrow(
      /missing value unsubscribe/,
    );
  });

  it('escapes what the admin wrote', () => {
    const mail = render('NEWS', 'email', 'en', {
      ...params,
      text: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
  });

  it('leaves other e-mails without a stop link', () => {
    const mail = render('TEST_MESSAGE', 'email', 'en', { app: params.app });
    expect(mail.html).not.toContain('unsubscribe');
    expect(mail.text).not.toContain('Stop MotorFix news');
  });
});
