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
  // The seeded garage this account works at, and how; a mechanic may also
  // answer quote requests.
  at?: {
    garage: string;
    as: 'owner' | 'receptionist' | 'mechanic';
    answersQuotes?: true;
  };
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

// Every listed garage has a place, so a search near Bucharest or Cluj-Napoca
// finds them; the mobile mechanic's seat is never shown, only its area.
const LISTED: {
  name: string;
  slug: string;
  stances: Record<string, Stance>;
  at: [number, number];
  mobile?: { seat: string; radiusKm: number };
}[] = [
  {
    at: [44.435, 26.015],
    name: 'Service Auto Militari',
    slug: 'service-auto-militari',
    stances: { dacia: 'works_on', volkswagen: 'works_on' },
  },
  {
    at: [44.382, 26.12],
    name: 'Atelier Berceni',
    slug: 'atelier-berceni',
    stances: { dacia: 'works_on' },
  },
  {
    at: [44.5, 26.12],
    name: 'Auto Pipera',
    slug: 'auto-pipera',
    stances: { dacia: 'works_on', volkswagen: 'does_not_take' },
  },
  {
    at: [44.455, 26.15],
    name: 'Service Colentina',
    slug: 'service-colentina',
    stances: { dacia: 'does_not_take', volkswagen: 'works_on' },
  },
  {
    at: [44.42, 26.03],
    name: 'Atelier Drumul Taberei',
    slug: 'atelier-drumul-taberei',
    stances: { volkswagen: 'works_on' },
  },
  {
    at: [44.415, 26.17],
    name: 'Service Titan',
    slug: 'service-titan',
    stances: {},
  },
  {
    at: [46.78, 23.62],
    name: 'Service Mărăști',
    slug: 'service-marasti',
    stances: { dacia: 'works_on' },
  },
  {
    at: [46.9, 23.68],
    mobile: { radiusKm: 20, seat: 'Strada Sediului 1, Cluj-Napoca' },
    name: 'Mecanic Mobil Cluj',
    slug: 'mecanic-mobil-cluj',
    stances: { dacia: 'works_on' },
  },
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
  // The driver of the seeded requests below, apart from the first driver so
  // the screens that start from no car keep doing so.
  {
    email: 'cerere@example.test',
    lastRole: 'driver',
    name: 'Andrei Marin',
    phone: '+40700000102',
    roles: ['driver'],
  },
  // A second driver, for what one driver must never see of another.
  {
    email: 'sofer2@example.test',
    lastRole: 'driver',
    name: 'Maria Stan',
    roles: ['driver'],
  },
  // The owner of a listed garage that takes quote requests, so a test can
  // read what a driver sent it without touching the shared garage account.
  {
    at: { as: 'owner', garage: 'service-auto-militari' },
    email: 'militari@example.test',
    lastRole: 'garage',
    name: 'Ion Militaru',
    roles: ['garage'],
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
    at: { answersQuotes: true, as: 'mechanic', garage: 'atelier-test' },
    email: 'mecanic-oferte@example.test',
    lastRole: 'mechanic',
    name: 'Radu Oferte',
    roles: ['mechanic'],
  },
  {
    email: 'admin@example.test',
    lastRole: 'admin',
    name: 'Admin MotorFix',
    roles: ['admin'],
  },
  // A second admin, for the rules that need another admin to approve.
  {
    email: 'admin2@example.test',
    lastRole: 'admin',
    name: 'Mihai Ionescu',
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
        `INSERT INTO mechanic (id, account_id, garage_id, name, can_answer_quotes) SELECT gen_random_uuid(), $1, ${garage}, name, $3 FROM account WHERE id = $1`,
        [id, at.garage, at.answersQuotes ?? false],
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

async function list(db: Client, garage: (typeof LISTED)[number]) {
  await db.query(
    `INSERT INTO garage (id, name, slug, status, approved_at)
     VALUES (gen_random_uuid(), $1, $2, 'approved', '2026-01-15T09:00:00Z')
     ON CONFLICT (slug) DO NOTHING`,
    [garage.name, garage.slug],
  );
  // An update, not part of the insert: a database seeded before garages
  // had a place gets one too.
  await db.query(
    `UPDATE garage
     SET latitude = $2, longitude = $3, business_kind = $4::business_kind,
         seat_address = $5, service_radius_km = $6
     WHERE slug = $1 AND latitude IS NULL`,
    [
      garage.slug,
      ...garage.at,
      garage.mobile ? 'mobile' : null,
      garage.mobile?.seat ?? null,
      garage.mobile?.radiusKm ?? null,
    ],
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

interface Requester {
  carId: string;
  driverId: string;
  garageId: string;
  mechanic: string;
}

// The requester's car and the staff's garage and mechanic; null when one is
// missing, as on a database seeded before them.
async function requester(db: Client): Promise<Requester | null> {
  // The API's catalogue loader reconciles this row by key when it boots.
  await db.query(
    `INSERT INTO job_type (id, key, name_ro, name_en, status, updated_at)
     VALUES (gen_random_uuid(), 'oil-service', 'Schimb de ulei și filtre',
             'Oil and filter service', 'approved', now())
     ON CONFLICT (key) DO NOTHING`,
  );
  const car = await db.query<{ id: string; owner_id: string }>(
    `INSERT INTO car (id, owner_id, brand_id, model, year, fuel, engine, odometer_km, plate, idempotency_key)
     SELECT gen_random_uuid(), a.id, b.id, 'Logan', 2018, 'petrol', '1.0 TCe', 98000, 'B101QAT', 'seed'
     FROM account a, brand b WHERE a.email = 'cerere@example.test' AND b.key = 'dacia'
     ON CONFLICT (owner_id, idempotency_key) DO UPDATE SET plate = car.plate
     RETURNING id, owner_id`,
  );
  const garage = await db.query<{ id: string; mechanic: string }>(
    `SELECT g.id, m.id AS mechanic FROM garage g
     JOIN mechanic m ON m.garage_id = g.id
     JOIN account a ON a.id = m.account_id AND a.email = 'mecanic@example.test'
     WHERE g.slug = 'atelier-test'`,
  );
  const [mine] = car.rows;
  const [at] = garage.rows;
  if (!mine || !at) return null;
  return {
    carId: mine.id,
    driverId: mine.owner_id,
    garageId: at.id,
    mechanic: at.mechanic,
  };
}

// One request from the requester to the garage, `hours` old; its recipient
// row is returned.
async function send(
  db: Client,
  who: Requester,
  hours: number,
  booked: boolean,
) {
  const request = await db.query<{ id: string }>(
    `INSERT INTO quote_request (id, driver_id, car_id, car_brand, car_model, car_year, car_fuel, car_engine,
                                description, status, created_at, expires_at, idempotency_key)
     VALUES (gen_random_uuid(), $1, $2, 'Dacia', 'Logan', 2018, 'petrol', '1.0 TCe',
             'Scârțâie la frânare', $3::quote_request_status,
             now() - make_interval(hours => $4), now() + interval '7 days', gen_random_uuid()::text)
     RETURNING id`,
    [who.driverId, who.carId, booked ? 'booked' : 'sent', hours],
  );
  const requestId = request.rows[0]?.id;
  await db.query(
    `INSERT INTO request_job (id, request_id, job_type_id, position)
     SELECT gen_random_uuid(), $1, id, 0 FROM job_type WHERE key = 'oil-service'`,
    [requestId],
  );
  const recipient = await db.query<{ id: string }>(
    `INSERT INTO request_recipient (id, request_id, garage_id, status, source, answered_at)
     VALUES (gen_random_uuid(), $1, $2, $3::request_recipient_status, 'search',
             CASE WHEN $4 THEN now() END)
     RETURNING id`,
    [requestId, who.garageId, booked ? 'quoted' : 'waiting', booked],
  );
  return { recipientId: recipient.rows[0]?.id, requestId };
}

// The garage's accepted quote on it, its confirmed booking for the mechanic,
// and the mechanic's job.
async function book(
  db: Client,
  who: Requester,
  sent: { recipientId?: string; requestId?: string },
) {
  const quote = await db.query<{ id: string; slot: Date }>(
    `INSERT INTO quote (id, request_id, recipient_id, garage_id, from_bani, to_bani, duration_minutes,
                        slot, status, accepted_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 45000, 60000, 90,
             now() + interval '2 days', 'accepted', now(), now() + interval '7 days')
     RETURNING id, slot`,
    [sent.requestId, sent.recipientId, who.garageId],
  );
  const booking = await db.query<{ id: string }>(
    `INSERT INTO booking (id, quote_id, request_id, garage_id, driver_id, starts_at, duration_minutes,
                          status, confirm_by, confirmed_at, mechanic_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 90,
             'confirmed', now() + interval '1 day', now(), $6)
     RETURNING id`,
    [
      quote.rows[0]?.id,
      sent.requestId,
      who.garageId,
      who.driverId,
      quote.rows[0]?.slot,
      who.mechanic,
    ],
  );
  // Started by its mechanic, so QA can tick its steps.
  const job = await db.query<{ id: string }>(
    `INSERT INTO job (id, booking_id, garage_id, car_id, driver_id, mechanic_id, status, started_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'in_work', now())
     RETURNING id`,
    [booking.rows[0]?.id, who.garageId, who.carId, who.driverId, who.mechanic],
  );
  await db.query(
    `INSERT INTO job_stage_entry (id, job_id, from_status, to_status, actor_id, actor_role, at)
     SELECT gen_random_uuid(), $1, s.from_status::job_status, s.to_status::job_status,
            m.account_id, 'mechanic'::audit_actor_role, now() + s.n * interval '1 millisecond'
     FROM mechanic m,
          (VALUES (NULL, 'to_do', 0), ('to_do', 'in_work', 1)) AS s(from_status, to_status, n)
     WHERE m.id = $2`,
    [job.rows[0]?.id, who.mechanic],
  );
}

// No route writes a request yet, so the seed writes two straight to the
// tables, from the requester to the staff's garage: one waiting for an
// answer, one quoted, accepted, confirmed and made a job for the seeded
// mechanic. QA reads them through the request and job routes.
async function requests(db: Client) {
  const done = await db.query(
    `SELECT 1 FROM quote_request r JOIN account a ON a.id = r.driver_id
     WHERE a.email = 'cerere@example.test'`,
  );
  if (done.rowCount) return;
  const who = await requester(db);
  if (!who) return;
  await send(db, who, 2, false);
  await book(db, who, await send(db, who, 1, true));
}

// The oil service ticked for Dacia on the listed Bucharest garages that take
// it and on the staff's garage, and shown on Service Auto Militari's price
// list, so its profile offers a job and a request finds the others near it.
async function quoteable(db: Client) {
  await db.query(
    `INSERT INTO garage_brand (garage_id, brand_id, stance, petrol, diesel, hybrid, electric, updated_at)
     SELECT g.id, b.id, 'works_on', true, true, true, true, now()
     FROM garage g, brand b WHERE g.slug = 'atelier-test' AND b.key = 'dacia'
     ON CONFLICT DO NOTHING`,
  );
  await db.query(
    `INSERT INTO garage_brand_job (garage_id, brand_id, job_type_id)
     SELECT gb.garage_id, gb.brand_id, j.id
     FROM garage_brand gb
     JOIN garage g ON g.id = gb.garage_id
     JOIN brand b ON b.id = gb.brand_id AND b.key = 'dacia'
     JOIN job_type j ON j.key = 'oil-service'
     WHERE gb.stance = 'works_on'
       AND g.slug IN ('service-auto-militari', 'atelier-berceni', 'auto-pipera', 'atelier-test')
     ON CONFLICT DO NOTHING`,
  );
  await db.query(
    `INSERT INTO garage_price (id, garage_id, job_type_id, from_bani, to_bani, duration_minutes, position, updated_at, updated_by)
     SELECT gen_random_uuid(), g.id, j.id, 25000, 40000, 60, 0, now(), a.id
     FROM garage g
     JOIN job_type j ON j.key = 'oil-service'
     JOIN account a ON a.email = 'militari@example.test'
     WHERE g.slug = 'service-auto-militari'
       AND NOT EXISTS (
         SELECT 1 FROM garage_price p WHERE p.garage_id = g.id AND p.job_type_id = j.id
       )`,
  );
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
  for (const garage of LISTED) await list(db, garage);
  for (const person of PEOPLE) await add(db, person, secret);
  // The day the suspended driver was suspended, as an admin's change records
  // it; added apart from the account so a database seeded before has it too.
  await db.query(
    `INSERT INTO activity_log (id, at, action, subject_type, subject_id, field,
       old_value, new_value, actor_role, actor_name)
     SELECT gen_random_uuid(), '2026-10-02T10:00:00Z', 'update', 'account', a.id,
       'status', '"active"'::jsonb, '"suspended"'::jsonb, 'admin', 'Admin MotorFix'
     FROM account a
     WHERE a.email = 'suspendat@example.test'
       AND NOT EXISTS (
         SELECT 1 FROM activity_log l
         WHERE l.subject_type = 'account' AND l.subject_id = a.id
           AND l.field = 'status' AND l.new_value = '"suspended"'::jsonb
       )`,
  );
  for (const { garage, status } of WAITING) {
    await db.query(
      `INSERT INTO verification_file (id, garage_id, status)
       SELECT gen_random_uuid(), g.id, $2::verification_file_status FROM garage g
       WHERE g.slug = $1
         AND NOT EXISTS (SELECT 1 FROM verification_file f WHERE f.garage_id = g.id)`,
      [garage, status],
    );
  }
  // A listed garage was approved through a file, which a report reopens.
  await db.query(
    `INSERT INTO verification_file (id, garage_id, status, opened_at, decided_at, decided_by)
     SELECT gen_random_uuid(), g.id, 'approved', g.created_at, g.approved_at, a.id
     FROM garage g, account a
     WHERE g.slug = ANY($1) AND a.email = 'admin@example.test'
       AND NOT EXISTS (SELECT 1 FROM verification_file f WHERE f.garage_id = g.id)`,
    [LISTED.map(({ slug }) => slug)],
  );
  // A file has one check per kind (submit and resend add them); the seed
  // inserts its files directly, so it adds them the same way.
  await db.query(
    `INSERT INTO verification_check (id, file_id, kind)
     SELECT gen_random_uuid(), f.id, k
     FROM verification_file f
     CROSS JOIN unnest(enum_range(NULL::verification_check_kind)) AS k
     ON CONFLICT (file_id, kind) DO NOTHING`,
  );
  await requests(db);
  await quoteable(db);
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
