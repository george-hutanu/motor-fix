import { type APIRequestContext, expect, test } from '@playwright/test';

import { ACCOUNTS, PASSWORD } from './accounts.js';

async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function me(request: APIRequestContext, token: string) {
  const res = await request.get('/api/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string; garageId: string | null };
}

// Adds each `event:` line's kind to `kinds` as the stream delivers it, until
// close() aborts the fetch.
async function collect(body: ReadableStream<Uint8Array>, kinds: string[]) {
  const reader = body.getReader();
  const text = new TextDecoder();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const lines = (rest + text.decode(value, { stream: true })).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines)
      if (line.startsWith('event: ')) kinds.push(line.slice('event: '.length));
  }
}

// A live stream opened as the web app opens it: fetch with the bearer token.
async function openStream(baseURL: string, token: string) {
  const kinds: string[] = [];
  const abort = new AbortController();
  const res = await fetch(new URL('/api/v1/live', baseURL), {
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    signal: abort.signal,
  });
  expect(res.status).toBe(200);
  collect(res.body as ReadableStream<Uint8Array>, kinds).catch(() => undefined);
  return { close: () => abort.abort(), kinds };
}

test.describe("a receptionist's live stream @seeded", () => {
  test('carries an update the receptionist may hear and never a team invite, which reaches the owner on the same garage channel', async ({
    baseURL,
    request,
  }) => {
    const receptionistToken = await accessToken(request, ACCOUNTS.receptionist);
    const ownerToken = await accessToken(request, ACCOUNTS.garage);
    const admin = await accessToken(request, ACCOUNTS.admin);
    const receptionist = await me(request, receptionistToken);
    const owner = await me(request, ownerToken);
    expect(receptionist.garageId).toBe(owner.garageId);
    const base = String(baseURL);
    const streams: { close: () => void }[] = [];

    try {
      const receptionistStream = await openStream(base, receptionistToken);
      streams.push(receptionistStream);
      const ownerStream = await openStream(base, ownerToken);
      streams.push(ownerStream);
      const sent = await request.post('/api/v1/admin/live/test', {
        data: { accountId: receptionist.id },
        headers: { Authorization: `Bearer ${admin}` },
      });
      expect(sent.status()).toBe(202);
      await expect
        .poll(() => receptionistStream.kinds, { timeout: 2_000 })
        .toContain('live.test');

      const invite = await request.post(
        `/api/v1/garages/${owner.garageId}/invites`,
        {
          data: {
            email: `receptie-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
            kind: 'receptionist',
            name: 'Ana Pop',
          },
          headers: { Authorization: `Bearer ${ownerToken}` },
        },
      );
      expect(invite.status()).toBe(201);
      await expect
        .poll(() => ownerStream.kinds, { timeout: 2_000 })
        .toContain('invite.sent');
      // The receptionist's stream has had the same time and more to hear it.
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(receptionistStream.kinds).not.toContain('invite.sent');
    } finally {
      for (const stream of streams) stream.close();
    }
  });
});
