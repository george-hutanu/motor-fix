import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { CompareService } from './compare.service';
import { AuditService } from '../../audit/audit.service';
import type { Actor } from '../../auth/policy';
import { outbox } from '../../events/event.port';
import { SuspensionService } from '../../garages/verification/suspension/suspension.service';
import { staffedGarage } from '../../garages/verification/suspension/suspension.testing';
import { quotesApp } from '../quotes-api.testing';

const { bearer, get, team, world } = quotesApp();
const { prisma } = world;

const compare = (requestId: string, auth?: string) =>
  get(`/quote-requests/${requestId}/quotes`, auth);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

const seen = (id: string) =>
  prisma.quote.findUniqueOrThrow({ where: { id } }).then((q) => q.firstSeenAt);

// @traces 313-FR-001
describe('GET /quote-requests/:id/quotes, the caller first', () => {
  it('answers 401 to a malformed id without a token, before it looks at the id', async () => {
    const res = await compare('not-an-id');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 404 to the driver’s own account when it signs in as a garage', async () => {
    const both = await world.account('Andrei Marin', ['driver', 'garage']);
    const request = await world.request(both, { status: 'quoted' });

    const res = await compare(request.id, bearer(both, 'garage'));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(request.id);
  });

  it('refuses an assistant acting for another driver', async () => {
    const andrei = await world.account('Andrei Marin');
    const maria = await world.account('Maria Ionescu');
    const request = await world.request(andrei, { status: 'quoted' });
    const actor: Actor = {
      accountId: maria,
      assistantGrantId: randomUUID(),
      garageId: null,
      language: 'ro',
      permissions: NONE,
      role: 'driver',
      roles: ['driver'],
      via: 'assistant',
    };

    const refused = await new CompareService(prisma)
      .get(actor, request.id)
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(404);
  });
});

// @traces 313-FR-002
describe('GET /quote-requests/:id/quotes, odd requests', () => {
  it('answers empty lists and the waiting garage for a request nobody has quoted', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'sent' });
    const militari = await world.garage('Service Militari');
    await world.recipient(request.id, militari.id);

    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      declined: [],
      quotes: [],
      waiting: ['Service Militari'],
      withdrawn: [],
    });
    expect(res.body.request.booking).toBeNull();
  });

  it('answers a closed request with its status', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'closed' });

    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('closed');
  });

  it('carries the newest booking when an older one was cancelled', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'booked' });
    const dinamo = await world.garage('Atelier Dinamo');
    const volt = await world.garage('Volt Auto');
    const first = await world.quote(request.id, dinamo.id, 'lost');
    await world.booking(first.id, 'cancelled');
    const second = await world.quote(request.id, volt.id, 'accepted');
    const newest = await world.booking(second.id, 'awaiting_confirmation');
    await prisma.booking.update({
      data: { createdAt: new Date(Date.now() + 60_000) },
      where: { id: newest.id },
    });

    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.body.request.booking).toEqual({
      confirmBy: newest.confirmBy.toISOString(),
      status: 'awaiting_confirmation',
    });
  });

  it('hands a note and a garage name back as plain text, markup and emoji untouched', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const odd = await world.garage('Șoșele "Ünïcode" <b>Auto</b> 🚗');
    const quote = await world.quote(request.id, odd.id);
    const note = "<script>alert(1)</script> '; DROP TABLE quote; -- ăîșț";
    await prisma.quote.update({ data: { note }, where: { id: quote.id } });

    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.body.quotes[0].note).toBe(note);
    expect(res.body.quotes[0].garage.name).toBe(
      'Șoșele "Ünïcode" <b>Auto</b> 🚗',
    );
  });

  it('answers a whole-number rating as the number, not a string', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const dinamo = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { rating: 5, reviewCount: 2 },
      where: { id: dinamo.id },
    });
    await world.quote(request.id, dinamo.id);

    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.body.quotes[0].garage.rating).toBe(5);
    expect(res.body.quotes[0].garage.reviewCount).toBe(2);
  });
});

// @traces 313-FR-003
describe('GET /quote-requests/:id/quotes, many rows', () => {
  it('breaks a thirty-way tie on the sent time by id, ascending', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const same = new Date(Date.now() - 60_000);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const garage = await world.garage(`Garaj ${i}`);
      ids.push((await world.quote(request.id, garage.id)).id);
    }
    await prisma.quote.updateMany({
      data: { sentAt: same },
      where: { requestId: request.id },
    });

    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.body.quotes.map((q: { id: string }) => q.id)).toEqual(
      [...ids].sort(),
    );
  });
});

// @traces 313-FR-011
describe('GET /quote-requests/:id/quotes, first seen on every row', () => {
  it('stamps expired, lost and declined rows too, and not a suspended garage’s hidden quote', async () => {
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const rows = [];
    for (const status of ['expired', 'lost', 'declined_by_driver'] as const) {
      const garage = await world.garage(`Garaj ${status}`);
      rows.push(await world.quote(request.id, garage.id, status));
    }
    const est = await world.garage('Garaj Est');
    const hidden = await world.quote(request.id, est.id);
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: est.id },
    });

    await compare(request.id, bearer(andrei, 'driver'));

    for (const row of rows) expect(await seen(row.id)).not.toBeNull();
    expect(await seen(hidden.id)).toBeNull();
  });

  it('does not stamp on a malformed id or an unknown one', async () => {
    const { garage } = await team('Atelier Dinamo');
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    const quote = await world.quote(request.id, garage.id);

    await compare('nope', bearer(andrei, 'driver'));
    await compare(randomUUID(), bearer(andrei, 'driver'));

    expect(await seen(quote.id)).toBeNull();
  });
});

// @traces 313-FR-010
describe('suspending a garage, seen from the comparison', () => {
  beforeEach(() => prisma.$executeRawUnsafe('TRUNCATE outbox_event'));

  const suspend = async (garageId: string) => {
    const admin = await world.account('Ioana Popa', ['admin']);
    const actor: Actor = {
      accountId: admin,
      garageId: null,
      permissions: NONE,
      role: 'admin',
      roles: ['admin'],
    };
    return new SuspensionService(prisma, new AuditService(), outbox).suspend(
      actor,
      garageId,
      'admin',
      'Autorizație RAR expirată',
    );
  };
  const withdrawals = () =>
    prisma.outboxEvent.findMany({ where: { kind: 'quote.withdrawn' } });

  it('moves the garage’s waiting quote from the rows to a suspended line', async () => {
    const dinamo = await staffedGarage(prisma, world.account);
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    await world.quote(request.id, dinamo.id);

    await suspend(dinamo.id);
    const res = await compare(request.id, bearer(andrei, 'driver'));

    expect(res.body.quotes).toEqual([]);
    expect(res.body.withdrawn).toEqual([
      { garageName: 'Atelier Dinamo', reason: 'suspended' },
    ]);
  });

  it('records one event per waiting quote when one driver has two, none for another garage’s quote', async () => {
    const dinamo = await staffedGarage(prisma, world.account);
    const volt = await world.garage('Volt Auto');
    const andrei = await world.account('Andrei Marin');
    const one = await world.request(andrei, { status: 'quoted' });
    const two = await world.request(andrei, { status: 'quoted' });
    const a = await world.quote(one.id, dinamo.id);
    const b = await world.quote(two.id, dinamo.id);
    await world.quote(one.id, volt.id);

    await suspend(dinamo.id);

    const events = await withdrawals();
    expect(events.map((e) => e.subjectId).sort()).toEqual([a.id, b.id].sort());
  });

  it('records none when the garage is already suspended and the second attempt is refused', async () => {
    const dinamo = await staffedGarage(prisma, world.account);
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    await world.quote(request.id, dinamo.id);
    await suspend(dinamo.id);

    await expect(suspend(dinamo.id)).rejects.toBeInstanceOf(HttpException);

    expect(await withdrawals()).toHaveLength(1);
  });

  it('records none for a draft garage whose suspension is refused', async () => {
    const dinamo = await staffedGarage(prisma, world.account);
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: dinamo.id },
    });
    const andrei = await world.account('Andrei Marin');
    const request = await world.request(andrei, { status: 'quoted' });
    await world.quote(request.id, dinamo.id);

    await expect(suspend(dinamo.id)).rejects.toBeInstanceOf(HttpException);

    expect(await withdrawals()).toHaveLength(0);
  });
});
