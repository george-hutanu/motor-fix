import { DeclineService } from './decline.service';
import { AuditService } from '../../audit/audit.service';
import { outbox } from '../../events/event.port';
import { garageActor } from '../quotes.testing';
import { quotesApp } from '../quotes-api.testing';

const { team, world } = quotesApp();
const { prisma } = world;
const service = new DeclineService(prisma, new AuditService(), outbox);

beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

const RECEIVED = new Date('2026-10-26T11:52:00.000Z');

// A driver's request sent to Atelier Dinamo, which has not answered yet.
async function open() {
  const andrei = await world.account('Andrei Ion Marin');
  const dinamo = await team('Atelier Dinamo');
  const request = await world.request(andrei, { createdAt: RECEIVED });
  const recipient = await world.recipient(request.id, dinamo.garage.id);
  return { andrei, dinamo, recipient, request };
}

const owner = (t: { garage: { id: string }; owner: string }) =>
  garageActor(t.owner, t.garage.id);

async function untouched(recipientId: string) {
  expect(
    await prisma.requestRecipient.findUniqueOrThrow({
      where: { id: recipientId },
    }),
  ).toMatchObject({ answeredAt: null, declinedAt: null, status: 'waiting' });
  expect(await prisma.outboxEvent.count()).toBe(0);
  expect(
    await prisma.activityLog.count({ where: { subjectId: recipientId } }),
  ).toBe(0);
}

// @traces 1253-FR-001 1253-FR-002
describe('previewing a decline', () => {
  it('names the car, the driver’s first name, the garage and when the request came, writing nothing', async () => {
    const { dinamo, recipient, request } = await open();

    const preview = await service.preview(owner(dinamo), request.id);

    expect(preview).toEqual({
      car: { brand: 'Mini', model: 'Cooper S', year: 2019 },
      driverFirstName: 'Andrei',
      garageName: 'Atelier Dinamo',
      receivedAt: RECEIVED,
    });
    await untouched(recipient.id);
  });

  it('carries no phone or plate', async () => {
    const { dinamo, request } = await open();

    const preview = await service.preview(owner(dinamo), request.id);

    expect(JSON.stringify(preview)).not.toMatch(/B123ABC|\+40|phone|plate/i);
  });

  it('answers the receptionist and an answering mechanic as it answers the owner', async () => {
    const { dinamo, request } = await open();

    for (const actor of [
      garageActor(dinamo.receptionist, dinamo.garage.id, 'receptionist'),
      garageActor(dinamo.answering, dinamo.garage.id, 'mechanic', {
        canAnswerQuotes: true,
      }),
    ]) {
      await expect(service.preview(actor, request.id)).resolves.toMatchObject({
        garageName: 'Atelier Dinamo',
      });
    }
  });

  it('takes no lock: it answers while a decline holds the recipient', async () => {
    const { dinamo, recipient, request } = await open();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM request_recipient WHERE id = ${recipient.id}::uuid FOR UPDATE`;
      locked();
      await held;
    });
    await holding;

    const preview = await service.preview(owner(dinamo), request.id);
    release();
    await holder;

    expect(preview.garageName).toBe('Atelier Dinamo');
  });
});

// @traces 1253-FR-008
describe('a preview refuses as the decline would', () => {
  it('answers request_not_open for a closed request', async () => {
    const andrei = await world.account('Andrei');
    const dinamo = await team('Atelier Dinamo');
    const request = await world.request(andrei, { status: 'closed' });
    const recipient = await world.recipient(request.id, dinamo.garage.id);

    await expect(
      service.preview(owner(dinamo), request.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'request_not_open' }),
    });
    await untouched(recipient.id);
  });

  it('answers already_answered for a request the garage quoted', async () => {
    const andrei = await world.account('Andrei');
    const dinamo = await team('Atelier Dinamo');
    const request = await world.request(andrei);
    await world.recipient(request.id, dinamo.garage.id, 'quoted');

    await expect(
      service.preview(owner(dinamo), request.id),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'already_answered' }),
    });
  });

  it('answers not found to another garage', async () => {
    const { request } = await open();
    const other = await team('Service Militari');

    await expect(
      service.preview(owner(other), request.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers forbidden to a mechanic who may not answer quotes', async () => {
    const { dinamo, recipient, request } = await open();

    await expect(
      service.preview(
        garageActor(dinamo.plain, dinamo.garage.id, 'mechanic'),
        request.id,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'forbidden' }),
      status: 403,
    });
    await untouched(recipient.id);
  });
});

// @traces 1253-FR-004
describe('running a decline inside the caller’s transaction', () => {
  it('declines with the caller’s writes and leaves nothing when that transaction rolls back', async () => {
    const { dinamo, recipient, request } = await open();

    const answer = await prisma.$transaction((tx) =>
      service.run(tx, owner(dinamo), request.id, 'fully_booked'),
    );
    expect(answer.status).toBe('declined');

    const second = await open();
    await expect(
      prisma.$transaction(async (tx) => {
        await service.run(
          tx,
          owner(second.dinamo),
          second.request.id,
          'fully_booked',
        );
        throw new Error('the confirmation could not be stored');
      }),
    ).rejects.toThrow('the confirmation could not be stored');

    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: recipient.id },
        })
      ).status,
    ).toBe('declined');
    expect(
      (
        await prisma.requestRecipient.findUniqueOrThrow({
          where: { id: second.recipient.id },
        })
      ).status,
    ).toBe('waiting');
    expect(
      await prisma.activityLog.count({
        where: { subjectId: second.recipient.id },
      }),
    ).toBe(0);
  });
});
