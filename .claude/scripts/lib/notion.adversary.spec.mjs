import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { NotionError, notionClient } from './notion.mjs';

const TOKEN = 'ntn_SECRET_adversary';
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const clock = () => {
  const c = { t: 0, waits: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.waits.push(ms);
    c.t += ms;
  };
  return c;
};
const make = (fetchImpl, extra = {}) => {
  const c = clock();
  return { c, client: notionClient({ token: TOKEN, fetchImpl, sleep: c.sleep, now: c.now, random: () => 0, ...extra }) };
};

describe('adversarial notion client', () => {
  it('paces ten concurrent requests: three free, the rest sleeping at least 7/3 s in total', async () => {
    const { c, client } = make(async () => json({ ok: true }));
    await Promise.all(Array.from({ length: 10 }, () => client.request('GET', '/users/me')));
    assert.ok(c.waits.filter((w) => w > 0).length <= 7);
    assert.ok(c.waits.reduce((a, b) => a + b, 0) >= (7 / 3) * 1000 - 1);
  });

  it('refuses a multi-byte body over 500 KB by bytes without calling fetch, and sends one at the limit', async () => {
    let n = 0;
    const { client } = make(async () => (++n, json({ ok: 1 })));
    const over = { t: '€'.repeat(Math.ceil((500 * 1024) / 3)) };
    await assert.rejects(client.request('POST', '/pages', over), NotionError);
    assert.equal(n, 0);
    const pad = 500 * 1024 - JSON.stringify({ t: '' }).length;
    await client.request('POST', '/pages', { t: 'a'.repeat(pad) });
    assert.equal(n, 1);
  });
});
