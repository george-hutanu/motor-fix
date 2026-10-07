import { randomUUID } from 'node:crypto';

import type { FieldProblem, StartingPricesInput } from '@motor-fix/contracts';
import { HttpException } from '@nestjs/common';

import { GaragePricesService } from './garage-prices.service';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
} from '../../notifications/notifications.testing';

// One spec file's garage, owner and catalogue, emptied before every test.
export function pricesWorld() {
  const { account, prisma } = fixtures();
  const prices = new GaragePricesService(new AuditService());
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
  // Dacia and Ford in the catalogue and Lada retired from it.
  async function world() {
    const garage = await prisma.garage.create({
      data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
    });
    return {
      brakes: await job('front-brakes'),
      dacia: await brand('dacia', 'Dacia'),
      diagnosis: await job('diagnosis'),
      ford: await brand('ford', 'Ford'),
      garage: garage.id,
      lada: await brand('lada', 'Lada', false),
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
        subjectType: { in: ['garage', 'garage_price'] },
      },
    });

  // The refusal's field errors, or a failure when the call did not refuse.
  async function refused(run: Promise<unknown>) {
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

  async function nothingStored(w: World) {
    expect(await rows(w)).toEqual([]);
    expect(
      await prisma.garage.findUniqueOrThrow({ where: { id: w.garage } }),
    ).toMatchObject({ labourFromBani: null, labourToBani: null });
    expect(await history(w)).toEqual([]);
  }

  return {
    history,
    job,
    nothingStored,
    prices,
    prisma,
    refused,
    rows,
    save,
    since: () => since,
    world,
  };
}

export type PricesWorld = Awaited<
  ReturnType<ReturnType<typeof pricesWorld>['world']>
>;
