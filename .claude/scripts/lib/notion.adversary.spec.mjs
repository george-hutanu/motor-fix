import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { NotionError, notionClient, richText, writeProp } from './notion.mjs';

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

  it('treats an HTTP-date Retry-After as absent and falls back to the backoff', async () => {
    let n = 0;
    const { c, client } = make(async () =>
      ++n === 1 ? json({ code: 'rate_limited' }, 429, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }) : json({ ok: 1 }),
    );
    await client.request('GET', '/users/me');
    assert.equal(n, 2);
    assert.ok(c.waits.includes(500));
  });

  it('retries a 409 conflict_error but not a 409 with another code', async () => {
    let n = 0;
    const { client } = make(async () => (++n === 1 ? json({ code: 'conflict_error' }, 409) : json({ ok: 1 })));
    await client.request('PATCH', '/pages/p');
    assert.equal(n, 2);
    let m = 0;
    const other = make(async () => (++m, json({ code: 'validation_error' }, 409)));
    await assert.rejects(other.client.request('PATCH', '/pages/p'), NotionError);
    assert.equal(m, 1);
  });

  it('never retries a POST that fails on the network', async () => {
    let n = 0;
    const { client } = make(async () => {
      n++;
      throw new TypeError('fetch failed');
    });
    await assert.rejects(client.request('POST', '/pages', {}), NotionError);
    assert.equal(n, 1);
  });

  it('with maxRetries 0 surfaces the first 503 without sleeping or retrying', async () => {
    let n = 0;
    const { c, client } = make(async () => (++n, json({ code: 'service_unavailable' }, 503)), { maxRetries: 0 });
    await assert.rejects(client.request('GET', '/users/me'), (e) => e instanceof NotionError && /503/.test(e.message));
    assert.equal(n, 1);
    assert.deepEqual(c.waits.filter((w) => w > 0), []);
  });

  it('splits on code points so an emoji at the 2,000 boundary is never cut', () => {
    const text = `${'a'.repeat(1999)}😀${'b'.repeat(10)}`;
    const parts = richText(text);
    assert.equal(parts.map((p) => p.text.content).join(''), text);
    for (const p of parts) assert.ok(Array.from(p.text.content).length <= 2000);
    assert.ok(parts.every((p) => !/[\uD800-\uDBFF]$/.test(p.text.content) && !/^[\uDC00-\uDFFF]/.test(p.text.content)));
  });

  it('accepts exactly 200,000 characters and refuses one more, and refuses 101 relation ids', () => {
    assert.equal(writeProp('rich_text', 'x'.repeat(200000)).rich_text.length, 100);
    assert.throws(() => writeProp('rich_text', 'x'.repeat(200001)), NotionError);
    assert.equal(writeProp('relation', Array.from({ length: 100 }, (_, i) => `i${i}`)).relation.length, 100);
    assert.throws(() => writeProp('relation', Array.from({ length: 101 }, (_, i) => `i${i}`)), NotionError);
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
