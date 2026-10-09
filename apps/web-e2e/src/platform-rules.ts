import { type APIRequestContext, expect } from '@playwright/test';

import { ACCOUNTS, PASSWORD } from './accounts.js';

export async function accessToken(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email: ACCOUNTS.admin, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

// Maintenance goes back off, so the suite can run twice against one database.
export async function restore(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${await accessToken(request)}` };
  const read = await request.get('/api/v1/admin/platform-rules', { headers });
  const { rules } = (await read.json()) as {
    rules: { key: string; value: unknown }[];
  };
  const seen = rules.find((r) => r.key === 'maintenance_mode')?.value;
  if (seen === false) return;
  const saved = await request.patch(
    '/api/v1/admin/platform-rules/maintenance_mode',
    { data: { seen, value: false }, headers },
  );
  expect(saved.ok()).toBe(true);
}
