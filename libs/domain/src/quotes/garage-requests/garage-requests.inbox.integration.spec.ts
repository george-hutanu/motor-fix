// @traces 374-FR-004
// @traces 374-FR-010
// @traces 374-FR-012
// @traces 374-FR-013
import { GarageRequestsService } from './garage-requests.service';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;
const service = new GarageRequestsService(prisma);

const PHONE = '+40722111222';

async function driver(name = 'Andrei Ion Marin') {
  const id = await world.account(name);
  await prisma.account.update({ data: { phone: PHONE }, where: { id } });
  return id;
}

const ids = (page: { items: { id: string }[] }) => page.items.map((i) => i.id);

// One request per recipient status the inbox can filter on, plus an
// accepted quote and the two states the filter never lists.
async function inbox() {
  const andrei = await driver();
  const t = await team('Atelier Dinamo');
  const g = t.garage.id;
  const at = (minutes: number) => ({
    createdAt: new Date(Date.now() - minutes * 60_000),
  });
  const waiting = await world.request(andrei, at(1));
  await world.recipient(waiting.id, g);
  const quoted = await world.request(andrei, at(2));
  await world.quote(quoted.id, g);
  const accepted = await world.request(andrei, at(3));
  await world.quote(accepted.id, g, 'accepted');
  const declined = await world.request(andrei, at(4));
  await world.recipient(declined.id, g, 'declined', t.owner);
  const expired = await world.request(andrei, at(5));
  await world.recipient(expired.id, g, 'expired');
  const closed = await world.request(andrei, at(6));
  await world.recipient(closed.id, g, 'closed');
  return { accepted, andrei, closed, declined, expired, quoted, t, waiting };
}

describe('the garage inbox read', () => {
  it('lists every row as today when no status is given', async () => {
    const r = await inbox();
    const owner = garageActor(r.t.owner, r.t.garage.id);

    const all = await service.list(owner, {});

    expect(ids(all)).toEqual([
      r.waiting.id,
      r.quoted.id,
      r.accepted.id,
      r.declined.id,
      r.expired.id,
      r.closed.id,
    ]);
    expect(all.total).toBe(6);
  });

  it.each([
    ['waiting', ['waiting']],
    ['quoted', ['quoted', 'accepted']],
    ['declined', ['declined']],
    ['accepted', ['accepted']],
  ] as const)('filters the %s rows', async (status, expected) => {
    const r = await inbox();
    const owner = garageActor(r.t.owner, r.t.garage.id);

    const page = await service.list(owner, { status });

    expect(ids(page)).toEqual(expected.map((key) => r[key].id));
    expect(page.total).toBe(expected.length);
  });

  it('gives the assistant the dashboard’s rows plus the description and what the garage does not offer', async () => {
    const r = await inbox();
    const owner = garageActor(r.t.owner, r.t.garage.id);
    const request = await prisma.quoteRequest.findUniqueOrThrow({
      include: { car: true, jobs: true },
      where: { id: r.waiting.id },
    });
    const offered = await world.jobType('Plăcuțe frână', 'Brake pads');
    await prisma.requestJob.create({
      data: { jobTypeId: offered.id, position: 1, requestId: request.id },
    });
    await prisma.garageBrand.create({
      data: {
        brandId: request.car.brandId,
        garageId: r.t.garage.id,
        stance: 'works_on',
      },
    });
    await prisma.garageBrandJob.create({
      data: {
        brandId: request.car.brandId,
        garageId: r.t.garage.id,
        jobTypeId: offered.id,
      },
    });

    const listed = await service.list(owner, { status: 'waiting' });
    const answered = await service.inbox(owner, { status: 'waiting' });

    const [item] = answered.items;
    const [summary] = listed.items;
    expect(item).toEqual({
      ...summary,
      description: 'Scârțâie la frânare',
      jobs: summary.jobs.map((job) => ({
        ...job,
        notOffered: job.jobTypeId !== offered.id,
      })),
    });
    expect(item.jobs.map((j) => j.notOffered)).toEqual([true, false]);
    expect(answered.nextCursor).toBeNull();
  });

  it('answers the same rows as the dashboard route', async () => {
    const r = await inbox();
    const owner = garageActor(r.t.owner, r.t.garage.id);

    const res = await get('/garage/requests', bearer(r.t.owner, 'garage'));
    const answered = await service.inbox(owner, {});

    expect(res.status).toBe(200);
    expect(
      answered.items.map(({ description, jobs, ...rest }) => rest),
    ).toEqual(
      res.body.items.map(({ jobs, ...rest }: { jobs: unknown }) => rest),
    );
  });

  it('pages by twenty, newest first, with an opaque cursor', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    const made = [];
    for (let i = 0; i < 21; i++) {
      const request = await world.request(andrei, {
        createdAt: new Date(Date.now() - i * 60_000),
      });
      await world.recipient(request.id, t.garage.id);
      made.push(request.id);
    }
    const owner = garageActor(t.owner, t.garage.id);

    const first = await service.inbox(owner, { status: 'waiting' });
    const second = await service.inbox(owner, {
      cursor: first.nextCursor ?? undefined,
      status: 'waiting',
    });

    expect(ids(first)).toEqual(made.slice(0, 20));
    expect(ids(second)).toEqual(made.slice(20));
    expect(second.nextCursor).toBeNull();
  });

  it('never shows the phone or the plate, even once the quote is accepted and booked', async () => {
    const andrei = await driver();
    const t = await team('Atelier Dinamo');
    await world.chain(andrei, t.garage.id);

    const answered = await service.inbox(garageActor(t.owner, t.garage.id), {});
    const text = JSON.stringify(answered);

    expect(answered.items).toHaveLength(1);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain('B123ABC');
  });

  it('never lists another garage’s rows', async () => {
    const andrei = await driver();
    const dinamo = await team('Atelier Dinamo');
    const militari = await team('Service Militari');
    const theirs = await world.request(andrei);
    await world.recipient(theirs.id, militari.garage.id);

    const answered = await service.inbox(
      garageActor(dinamo.owner, dinamo.garage.id),
      {},
    );

    expect(answered.items).toEqual([]);
  });

  it('lets a mechanic who may answer quotes read it, and refuses one who may not', async () => {
    const r = await inbox();
    const g = r.t.garage.id;

    const answering = await service.inbox(
      garageActor(r.t.answering, g, 'mechanic', { canAnswerQuotes: true }),
      { status: 'waiting' },
    );

    expect(ids(answering)).toEqual([r.waiting.id]);
    await expect(
      service.inbox(garageActor(r.t.plain, g, 'mechanic'), {}),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('changes no row and records nothing when read', async () => {
    const r = await inbox();
    const before = await prisma.requestRecipient.findMany({
      orderBy: { id: 'asc' },
    });
    const logged = await prisma.activityLog.count();

    await service.inbox(garageActor(r.t.owner, r.t.garage.id), {});

    expect(
      await prisma.requestRecipient.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(before);
    expect(await prisma.activityLog.count()).toBe(logged);
  });
});
