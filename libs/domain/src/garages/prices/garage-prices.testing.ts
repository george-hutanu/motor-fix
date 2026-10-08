import { randomUUID } from 'node:crypto';

import type { FieldProblem, StartingPricesInput } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { GaragePricesService } from './garage-prices.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// The refusal's field errors, or a failure when the call did not refuse.
export async function refused(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(422);
  expect(http.getResponse()).toMatchObject({ code: 'validation_failed' });
  return (http.getResponse() as { errors: FieldProblem[] }).errors;
}

// Until a backend waits on a lock `holder` holds, or `ended` has settled.
async function waitBehind(
  prisma: PrismaClient,
  holder: number,
  ended: Promise<unknown>,
) {
  let done = false;
  const end = () => {
    done = true;
  };
  ended.then(end, end);
  const deadline = Date.now() + 15_000;
  while (!done) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND ${holder}::int = ANY (pg_blocking_pids(pid))
      ) AS waiting`;
    if (waiting) return;
    if (Date.now() > deadline) {
      throw new Error(
        'afterRace: the second writer neither waited on the first one nor ended',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Runs `first` in a transaction held open until `second` waits on the lock
// its uncommitted row holds (or ends without meeting it), then commits it;
// answers how `second` ended. The second write finds the value free when it
// reads, so it meets the unique index instead: the race two concurrent
// sendings run.
export async function afterRace<T>(
  prisma: PrismaClient,
  first: (tx: Prisma.TransactionClient) => Promise<unknown>,
  second: () => Promise<T>,
): Promise<T> {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let wrote = (_pid: number) => {};
  const written = new Promise<number>((resolve) => {
    wrote = resolve;
  });
  const winner = prisma.$transaction(
    async (tx) => {
      await first(tx);
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      wrote(pid);
      await held;
    },
    { timeout: 20_000 },
  );
  try {
    // `winner` only settles first when `first` threw.
    const holder = await Promise.race([written, winner.then(() => 0)]);
    const loser = second();
    await waitBehind(prisma, holder, loser);
    release();
    await winner;
    return loser;
  } finally {
    release();
  }
}

// One spec file's garage, owner and catalogue, emptied before every test.
export function pricesWorld() {
  const { account, prisma } = fixtures();
  const prices = new GaragePricesService(new AuditService(), outbox);
  serialDatabase(databaseUrl);
  let since = new Date(0);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE account, brand, garage, job_type CASCADE',
    );
    const [{ now }] = await prisma.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    since = now;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const job = (key: string, status: 'approved' | 'pending' = 'approved') =>
    prisma.jobType
      .create({ data: { key, nameEn: key, nameRo: key, status } })
      .then((row) => row.id);

  const brand = (key: string, name: string, active = true) =>
    prisma.brand
      .create({ data: { active, key, name, slug: key } })
      .then((row) => row.id);

  // Service Auto Nord and its owner Mihai; three approved jobs, one pending;
  // Dacia and Ford in the catalogue and Lada retired from it. The garage
  // works on Dacia and Lada; Ford it has not taken.
  async function world() {
    const garage = await prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    });
    const dacia = await brand('dacia', 'Dacia');
    const lada = await brand('lada', 'Lada', false);
    await prisma.garageBrand.createMany({
      data: [dacia, lada].map((brandId) => ({
        brandId,
        garageId: garage.id,
        stance: 'works_on' as const,
      })),
    });
    return {
      brakes: await job('front-brakes'),
      dacia,
      diagnosis: await job('diagnosis'),
      ford: await brand('ford', 'Ford'),
      garage: garage.id,
      lada,
      mihai: await account('Mihai Ionescu', ['garage']),
      oil: await job('oil-service'),
      tyres: await job('tyre-change', 'pending'),
    };
  }
  type World = Awaited<ReturnType<typeof world>>;

  const save = (w: World, input: StartingPricesInput) =>
    prisma.$transaction((tx) =>
      prices.saveStarting(tx, w.garage, w.mihai, input),
    );

  const rows = (w: World) =>
    prisma.garagePrice.findMany({
      orderBy: { position: 'asc' },
      where: { garageId: w.garage },
    });

  // Scoped to the garage: other specs' entries share the append-only table.
  const history = (w: World) =>
    prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: {
        at: { gte: since },
        garageId: w.garage,
        subjectType: { in: ['garage', 'garage_price', 'job_type'] },
      },
    });

  async function nothingStored(w: World) {
    expect(await rows(w)).toEqual([]);
    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({ labourFromBani: null, labourToBani: null });
    expect(await history(w)).toEqual([]);
    expect(
      await prisma.jobType.count({ where: { proposedByGarageId: w.garage } }),
    ).toBe(0);
    expect(
      await prisma.outboxEvent.count({
        where: {
          kind: 'catalogue_job.proposed',
          payload: { equals: w.garage, path: ['garageId'] },
        },
      }),
    ).toBe(0);
  }

  return {
    history,
    job,
    nothingStored,
    prices,
    prisma,

    rows,
    save,
    since: () => since,
    world,
  };
}

export type PricesWorld = Awaited<
  ReturnType<ReturnType<typeof pricesWorld>['world']>
>;
