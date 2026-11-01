import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { AccountsService, signAccessToken } from '@motor-fix/domain';
import { TURN_WAIT_MS } from '@motor-fix/domain/testing';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';

import { apiBoot, TEST_TOKEN_SECRET } from './api-boot.testing';

// @traces 295-FR-001 295-FR-002 295-FR-008

const api = apiBoot();
let app: INestApplication;
let db: Client;
let admin: string;

const SEEDS: [string, string, object][] = [
  ['api', 'green', { latency_ms: 82 }],
  ['search', 'green', { latency_ms: 140 }],
  ['maps', 'amber', { latency_ms: 1900 }],
  ['email', 'green', { failed_share: 0, latency_ms: 200 }],
  ['notifications', 'green', { failed_share: 0, oldest_waiting_s: 3 }],
  ['backup', 'green', { last_backup_at: new Date().toISOString() }],
];

const seed = async () => {
  await db.query('TRUNCATE status_tile');
  for (const [key, state, detail] of SEEDS) {
    await db.query(
      `INSERT INTO status_tile (key, state, since, detail, checked_at, pending_state, pending_since)
       VALUES ($1::status_tile_key, $2::status_tile_state, now() - interval '20 minutes',
         $3, now(), 'red', now())`,
      [key, state, JSON.stringify(detail)],
    );
  }
};

const counts = async () =>
  (
    await db.query(
      `SELECT (SELECT count(*) FROM outbox_event)::int AS events,
              (SELECT count(*) FROM system_log_entry)::int AS entries,
              (SELECT json_agg(t ORDER BY key) FROM status_tile t) AS tiles`,
    )
  ).rows[0];

const read = () =>
  request(app.getHttpServer())
    .get('/api/v1/admin/status')
    .set('Authorization', admin);

beforeAll(async () => {
  app = await api.start();
  db = new Client({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres',
  });
  await db.connect();
  const { id } = await app.get(AccountsService).createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `admin-${randomUUID()}` },
    name: 'admin',
    roles: ['admin'],
  });
  admin = `Bearer ${signAccessToken({ accountId: id, role: 'admin' }, TEST_TOKEN_SECRET, Date.now())}`;
}, TURN_WAIT_MS);

afterAll(async () => {
  await db.query('TRUNCATE status_tile');
  await db.end();
  await api.stop();
});

describe('GET /admin/status', () => {
  it('answers an admin the six tiles, the problems and their sentences', async () => {
    await seed();

    const res = await read();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'problems',
      'sentences',
      'tiles',
    ]);
    expect(res.body.tiles.map((t: { key: string }) => t.key)).toEqual([
      'api',
      'search',
      'maps',
      'email',
      'notifications',
      'backup',
    ]);
    expect(res.body.tiles[2]).toEqual({
      checkedAt: expect.stringMatching(/Z$/),
      detail: { latency_ms: 1900 },
      key: 'maps',
      short: { en: 'slow · 1.9 s', ro: 'lent · 1,9 s' },
      since: expect.stringMatching(/Z$/),
      stale: false,
      state: 'amber',
    });
    expect(res.body.problems).toEqual(['maps']);
    expect(res.body.sentences.en).toEqual([
      expect.stringMatching(/^Maps have been slow since \d\d:\d\d\. /),
    ]);
    expect(res.body.sentences.ro).toHaveLength(1);
  });

  it('carries no personal data and no unconfirmed check', async () => {
    await seed();

    const res = await read();

    const fields = new Set<string>();
    for (const tile of res.body.tiles) {
      for (const field of Object.keys(tile)) fields.add(field);
      for (const field of Object.keys(tile.detail)) fields.add(field);
    }
    expect([...fields].sort()).toEqual([
      'checkedAt',
      'detail',
      'failed_share',
      'key',
      'last_backup_at',
      'latency_ms',
      'oldest_waiting_s',
      'short',
      'since',
      'stale',
      'state',
    ]);
  });

  it('writes nothing: no tile change, no event, no log entry', async () => {
    await seed();
    const before = await counts();

    await read();
    await read();

    expect(await counts()).toEqual(before);
  });
});
