import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A key of its own, derived from the API's token secret, so an unsubscribe
// signature can never pass for any other one.
const sign = (accountId: string, secret: string) => {
  const key = createHmac('sha256', secret).update('news-unsubscribe').digest();
  return createHmac('sha256', key).update(accountId).digest('base64url');
};

// "<account id>.<signature>": it never expires, so every news e-mail's link
// keeps working.
export const unsubscribeToken = (accountId: string, secret: string) =>
  `${accountId}.${sign(accountId, secret)}`;

// The account a token was made for, or null when it is not one of ours.
export function unsubscribedAccount(
  token: string,
  secret: string,
): string | null {
  const [accountId, signature, ...rest] = token.split('.');
  if (!UUID.test(accountId) || !signature || rest.length > 0) return null;
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(accountId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? accountId
    : null;
}

// The page the e-mail's link opens, and the address mail apps post to for
// one-click unsubscribe: the web app forwards /api/ to the API.
export const newsLinks = (webUrl: string, language: string, token: string) => ({
  oneClick: `${webUrl}/api/v1/notification-preferences/unsubscribe?token=${token}`,
  unsubscribe: `${webUrl}/${language}/unsubscribe/${token}`,
});
