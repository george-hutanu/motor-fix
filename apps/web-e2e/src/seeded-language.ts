import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { PASSWORD } from './accounts.js';

// A seeded account is shared by every worker, and a dashboard opens in the
// language saved on it, so a tap on the switch must not save it for all of
// them. The save is answered here from the account the page last read,
// carrying the language tapped: the page turns, the account does not. It is
// answered at once, so no request of its own outlives the test.
export function keepSeededLanguage(page: Page) {
  let account: object | undefined;
  return page.route('**/api/v1/me', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      const response = await route.fetch();
      if (response.ok()) account = await response.json();
      return route.fulfill({ response });
    }
    const { language } = request.postDataJSON() as { language: string };
    // Nothing read yet: the save fails, as it would offline.
    return account
      ? route.fulfill({ json: { ...account, language } })
      : route.abort();
  });
}

// The language saved on the account, read by its own sign-in.
export async function savedLanguage(request: APIRequestContext, email: string) {
  const signedIn = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(signedIn.ok()).toBe(true);
  const { accessToken } = (await signedIn.json()) as { accessToken: string };
  const me = await request.get('/api/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return ((await me.json()) as { language: string }).language;
}
