import { type APIRequestContext, expect } from '@playwright/test';

import { ACCOUNTS, PASSWORD } from './accounts.js';

// The restore runs after a test has left the request's keep-alive socket idle
// for longer than the server keeps it, so a call can meet a reset socket
// (ECONNRESET); only that is retried, never an answer.
const RESET = { maxRetries: 2 };

export async function accessToken(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/sign-in', {
    ...RESET,
    data: { email: ACCOUNTS.admin, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

// Maintenance goes back off, so the suite can run twice against one database.
export async function restore(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${await accessToken(request)}` };
  const read = await request.get('/api/v1/admin/platform-rules', {
    ...RESET,
    headers,
  });
  const { rules } = (await read.json()) as {
    rules: { key: string; value: unknown }[];
  };
  const seen = rules.find((r) => r.key === 'maintenance_mode')?.value;
  if (seen === false) return;
  const saved = await request.patch(
    '/api/v1/admin/platform-rules/maintenance_mode',
    { ...RESET, data: { seen, value: false }, headers },
  );
  expect(saved.ok()).toBe(true);
}
