// Run directly by Node (type stripping), so this file imports nothing from the
// workspace. Each module's seed rows are added here by the story that owns it.
import { argon2, randomBytes } from 'node:crypto';

import { Client } from 'pg';

if (process.env['APP_ENV'] === 'production') {
  console.error('seed refused: APP_ENV=production');
  process.exit(1);
}

// A public repository: a deployed environment brings its own password.
const local = ['development', 'test'].includes(process.env['APP_ENV'] ?? '');
const password =
  process.env['SEED_PASSWORD'] || (local ? 'parola-de-test' : null);
if (!password) {
  console.error(
    'seed refused: outside development and test it needs SEED_PASSWORD',
  );
  process.exit(1);
}

type Stance = 'works_on' | 'does_not_take';
type Role = 'driver' | 'garage' | 'receptionist' | 'mechanic' | 'admin';

interface Person {
  email: string;
  name: string;
  roles: Role[];
  lastRole: Role;
  status?: 'suspended';
  // A verified number, for the sign-in by WhatsApp code.
  phone?: string;
  // The seeded garage this account works at, and how.
  at?: { garage: string; as: 'owner' | 'receptionist' | 'mechanic' };
}

const GARAGES = [
  { name: 'Atelier Test', slug: 'atelier-test' },
  { name: 'Service Dobre', slug: 'service-dobre' },
  { name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
];

// Listed garages, so Home and search have a known count: 3 of 6 take Dacia.
// Approved in an earlier month, so the admin's growth this month stays 0.
const BRANDS = [
  { key: 'dacia', name: 'Dacia', popularity: 7, slug: 'dacia' },
  { key: 'volkswagen', name: 'Volkswagen', popularity: 5, slug: 'volkswagen' },
];

const LISTED: {
  name: string;
  slug: string;
  stances: Record<string, Stance>;
}[] = [
  {
    name: 'Service Auto Militari',
    slug: 'service-auto-militari',
    stances: { dacia: 'works_on', volkswagen: 'works_on' },
  },
  {
    name: 'Atelier Berceni',
    slug: 'atelier-berceni',
    stances: { dacia: 'works_on' },
  },
  {
    name: 'Auto Pipera',
    slug: 'auto-pipera',
    stances: { dacia: 'works_on', volkswagen: 'does_not_take' },
  },
  {
    name: 'Service Colentina',
    slug: 'service-colentina',
    stances: { dacia: 'does_not_take', volkswagen: 'works_on' },
  },
  {
    name: 'Atelier Drumul Taberei',
    slug: 'atelier-drumul-taberei',
    stances: { volkswagen: 'works_on' },
  },
  { name: 'Service Titan', slug: 'service-titan', stances: {} },
];

// Two garages waiting for an admin, so the admin dashboard has a known count.
const WAITING = [
  { garage: 'service-dobre', status: 'submitted' },
  { garage: 'atelier-dinamo', status: 'in_review' },
];

const PEOPLE: Person[] = [
  {
    email: 'sofer@example.test',
    lastRole: 'driver',
    name: 'Andrei Popescu',
    roles: ['driver'],
  },
  // A second driver, for what one driver must never see of another.
  {
    email: 'sofer2@example.test',
    lastRole: 'driver',
    name: 'Maria Stan',
    roles: ['driver'],
  },
  {
    at: { as: 'owner', garage: 'atelier-test' },
    email: 'service@example.test',
    lastRole: 'garage',
    name: 'Mihai Ionescu',
    roles: ['garage'],
  },
  {
    at: { as: 'receptionist', garage: 'atelier-test' },
    email: 'receptie@example.test',
    lastRole: 'receptionist',
    name: 'Ioana Marin',
    roles: ['receptionist'],
  },
  {
    at: { as: 'mechanic', garage: 'atelier-test' },
    email: 'mecanic@example.test',
    lastRole: 'mechanic',
    name: 'Vlad Stan',
    roles: ['mechanic'],
  },
  {
    email: 'admin@example.test',
    lastRole: 'admin',
    name: 'Admin MotorFix',
    roles: ['admin'],
  },
  {
    at: { as: 'owner', garage: 'service-dobre' },
    email: 'doua-roluri@example.test',
    lastRole: 'garage',
    name: 'Elena Dobre',
    // Not the first owner: their WhatsApp switch shows the missing number.
    phone: '+40700000101',
    roles: ['driver', 'garage'],
  },
  // Switches roles in the end-to-end tests; nothing else may rely on its
  // role used last.
  {
    at: { as: 'owner', garage: 'atelier-dinamo' },
    email: 'comutare@example.test',
    lastRole: 'garage',
    name: 'Mihai Ionescu',
    roles: ['driver', 'garage'],
  },
  // Garage only, with no garage: its first car makes it a driver.
  {
    email: 'masina-noua@example.test',
    lastRole: 'garage',
    name: 'Radu Pavel',
    roles: ['garage'],
  },
  {
    email: 'suspendat@example.test',
    lastRole: 'driver',
    name: 'Radu Suspendat',
    roles: ['driver'],
    status: 'suspended',
  },
];

// The same argon2id form the sign-in checks: 19 MiB, 2 passes, 1 lane.
function hash(secret: string): Promise<string> {
  const nonce = randomBytes(16);
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return new Promise((resolve, reject) =>
    argon2(
      'argon2id',
      {
        memory: 19456,
        message: secret,
        nonce,
        parallelism: 1,
        passes: 2,
        tagLength: 32,
      },
      (error, tag) =>
        error
          ? reject(error)
          : resolve(`$argon2id$v=19$m=19456,t=2,p=1$${b64(nonce)}$${b64(tag)}`),
    ),
  );
}

function link(db: Client, id: string, at: NonNullable<Person['at']>) {
  const garage = '(SELECT id FROM garage WHERE slug = $2)';
  return at.as === 'mechanic'
    ? db.query(
        `INSERT INTO mechanic (id, account_id, garage_id) VALUES (gen_random_uuid(), $1, ${garage})`,
        [id, at.garage],
      )
    : db.query(
        `INSERT INTO garage_member (account_id, garage_id, role) VALUES ($1, ${garage}, $3::garage_member_role)`,
        [id, at.garage, at.as],
      );
}

async function add(db: Client, person: Person, secret: string) {
  // An account that exists is left as it is.
  const created = await db.query<{ id: string }>(
    `INSERT INTO account (id, email, email_verified_at, name, last_role, status, phone, phone_verified_at)
     VALUES (gen_random_uuid(), $1, now(), $2, $3::role, $4::account_status, $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [
      person.email,
      person.name,
      person.lastRole,
      person.status ?? 'active',
      person.phone ?? null,
    ],
  );
  const id = created.rows[0]?.id;
  if (!id) return;
  for (const role of person.roles) {
    await db.query(
      'INSERT INTO account_role (account_id, role) VALUES ($1, $2::role)',
      [id, role],
    );
  }
  await db.query(
    `INSERT INTO account_identity (id, account_id, method, subject, password_hash)
     VALUES (gen_random_uuid(), $1, 'password', $2, $3)`,
    [id, person.email, await hash(secret)],
  );
  if (person.at) await link(db, id, person.at);
}

async function seed(db: Client, secret: string) {
  for (const garage of GARAGES) {
    await db.query(
      `INSERT INTO garage (id, name, slug) VALUES (gen_random_uuid(), $1, $2)
       ON CONFLICT (slug) DO NOTHING`,
      [garage.name, garage.slug],
    );
  }
  // The API's catalogue loader reconciles these rows by key when it boots.
  for (const brand of BRANDS) {
    await db.query(
      `INSERT INTO brand (id, key, name, slug, popularity, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
       ON CONFLICT DO NOTHING`,
      [brand.key, brand.name, brand.slug, brand.popularity],
    );
  }
  for (const garage of LISTED) {
    await db.query(
      `INSERT INTO garage (id, name, slug, status, approved_at)
       VALUES (gen_random_uuid(), $1, $2, 'approved', '2026-01-15T09:00:00Z')
       ON CONFLICT (slug) DO NOTHING`,
      [garage.name, garage.slug],
    );
    for (const [brand, stance] of Object.entries(garage.stances)) {
      // A brand a garage does not take is taken for no fuel.
      const fuels = stance === 'works_on';
      await db.query(
        `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
         SELECT g.id, b.id, $3::garage_brand_stance, $4, $4, $4, $4, now()
         FROM garage g, brand b WHERE g.slug = $1 AND b.key = $2
         ON CONFLICT DO NOTHING`,
        [garage.slug, brand, stance, fuels],
      );
    }
  }
  for (const person of PEOPLE) await add(db, person, secret);
  for (const { garage, status } of WAITING) {
    await db.query(
      `INSERT INTO verification_file (id, garage_id, status)
       SELECT gen_random_uuid(), g.id, $2::verification_file_status FROM garage g
       WHERE g.slug = $1
         AND NOT EXISTS (SELECT 1 FROM verification_file f WHERE f.garage_id = g.id)`,
      [garage, status],
    );
  }
  // A sent file has one check per kind (submit and resend add them); the seed
  // inserts its files directly, so it adds them the same way.
  await db.query(
    `INSERT INTO verification_check (id, file_id, kind)
     SELECT gen_random_uuid(), f.id, k
     FROM verification_file f
     CROSS JOIN unnest(enum_range(NULL::verification_check_kind)) AS k
     ON CONFLICT (file_id, kind) DO NOTHING`,
  );
  // The checks a test run may switch off; production refused the seed above.
  await db.query(
    `INSERT INTO platform_rule (id, key, value, default_value)
     VALUES (gen_random_uuid(), 'skip_manual_approval', 'false', 'false'),
            (gen_random_uuid(), 'skip_rar_check', 'false', 'false')
     ON CONFLICT (key) DO NOTHING`,
  );
}

async function main(secret: string) {
  const db = new Client({ connectionString: process.env['DATABASE_URL'] });
  await db.connect();
  try {
    await db.query('BEGIN');
    await seed(db, secret);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

main(password).catch((error: unknown) => {
  console.error('seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
