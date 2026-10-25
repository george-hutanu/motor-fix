import { randomUUID } from 'node:crypto';

import { DELETED_AUTHOR } from '@motor-fix/contracts';

import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews } from '../reviews.testing';

const { bearer, get, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);

const staffList = (garageId: string, auth?: string, query = '') =>
  get(`/garages/${garageId}/reviews${query}`, auth);

const ids = (body: { items: { id: string }[] }) => body.items.map((r) => r.id);

async function dinamo() {
  const staff = await team('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  return {
    ...staff,
    andrei,
    asOwner: bearer(staff.owner, 'garage'),
    asReceptionist: bearer(staff.receptionist, 'receptionist'),
  };
}

// @traces 074-FR-008
describe('hostile requests to a garage’s own reviews', () => {
  it('answers a well-formed garage id nobody owns with the same 404 body as a stranger', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const nord = await team('Service Nord');
    const stranger = await staffList(garage.id, bearer(nord.owner, 'garage'));

    const missing = await staffList(randomUUID(), asOwner);

    expect(stranger.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(stranger.body);
    expect(andrei).toBeDefined();
  });

  it('reads the same garage when its id is written in capitals', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei);

    const read = await staffList(garage.id.toUpperCase(), asOwner);

    expect(read.status).toBe(200);
    expect(read.body.items).toHaveLength(1);
  });

  it.each([
    ['?page=abc'],
    ['?page=NaN'],
    ['?page=Infinity'],
    ['?page=-0'],
    ['?page=0x2'],
  ])('refuses %s with 400', async (query) => {
    const { asOwner, garage } = await dinamo();

    const read = await staffList(garage.id, asOwner, query);

    expect(read.status).toBe(400);
  });

  it('never answers 5xx for a page number beyond any integer column', async () => {
    const { asOwner, garage } = await dinamo();

    const read = await staffList(
      garage.id,
      asOwner,
      '?page=99999999999999999999',
    );

    expect([200, 400]).toContain(read.status);
  });

  it('never answers 5xx for a page repeated in the query string', async () => {
    const { asOwner, garage } = await dinamo();

    const read = await staffList(garage.id, asOwner, '?page=1&page=2');

    expect([200, 400]).toContain(read.status);
  });

  it('keeps the page size at 20 whatever the query asks for', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei);

    const read = await staffList(garage.id, asOwner, '?pageSize=1000&limit=1');

    if (read.status === 200) expect(read.body.pageSize).toBe(20);
    else expect(read.status).toBe(400);
  });

  it('refuses a mechanic of the garage even with a page the owner could read', async () => {
    const staff = await dinamo();
    await review(staff.garage.id, staff.andrei);

    const read = await staffList(
      staff.garage.id,
      bearer(staff.answering, 'mechanic'),
      '?page=2',
    );

    expect(read.status).toBe(403);
  });
});

// @traces 074-FR-005 074-FR-009
describe('the garage’s list under awkward data', () => {
  it('answers the same twice and writes no event', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei, { status: 'reported' });
    await review(garage.id, andrei);
    const events = await prisma.outboxEvent.count();

    const first = await staffList(garage.id, asOwner);
    const second = await staffList(garage.id, asOwner);

    expect(second.body).toEqual(first.body);
    expect(await prisma.outboxEvent.count()).toBe(events);
  });

  it('lists every review of a tie on the posted date exactly once across two pages', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const made = [];
    for (let i = 0; i < 22; i++) made.push(await review(garage.id, andrei));
    await prisma.review.updateMany({
      data: { postedAt: new Date('2026-10-01T10:00:00.000Z') },
      where: { garageId: garage.id },
    });

    const first = await staffList(garage.id, asOwner);
    const second = await staffList(garage.id, asOwner, '?page=2');
    const again = await staffList(garage.id, asOwner);

    const seen = [...ids(first.body), ...ids(second.body)];
    expect(new Set(seen).size).toBe(22);
    expect(seen.sort()).toEqual(made.map((r) => r.id).sort());
    expect(ids(again.body)).toEqual(ids(first.body));
  });

  it('lists a reported row when the garage has nothing published and no stored rating', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const hidden = await review(garage.id, andrei, { status: 'reported' });

    const read = await staffList(garage.id, asOwner);

    expect(read.body).toMatchObject({
      breakdown: { five: 0, four: 0, one: 0, three: 0, two: 0 },
      rating: null,
      reviewCount: 0,
      total: 1,
    });
    expect(ids(read.body)).toEqual([hidden.id]);
  });

  it.each([['suspended'], ['draft']] as const)(
    'still answers the owner of a %s garage',
    async (status) => {
      const { andrei, asOwner, garage } = await dinamo();
      await review(garage.id, andrei);
      await prisma.garage.update({
        data: { status },
        where: { id: garage.id },
      });

      const read = await staffList(garage.id, asOwner);

      expect(read.status).toBe(200);
      expect(read.body.total).toBe(1);
    },
  );

  it('names the stand-in for a deleted driver and keeps the review listed', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: andrei },
    });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0].author).toEqual({ shortName: DELETED_AUTHOR });
  });

  it('carries a null text and a null mechanic when the review has neither', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei, { text: null });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0]).toMatchObject({ mechanic: null, text: null });
  });

  it('returns markup and emoji in a review’s text untouched', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    const text = '<img src=x onerror=alert(1)> Mulțumesc 🚗 ‮ ăîșțâ';
    await review(garage.id, andrei, { text });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0].text).toBe(text);
  });

  it('lists a job review with no included job as the car and no jobs', async () => {
    const { andrei, asOwner, garage } = await dinamo();
    await review(garage.id, andrei, {
      jobs: [{ included: false, nameEn: 'Oil change', nameRo: 'Schimb ulei' }],
    });

    const read = await staffList(garage.id, asOwner);

    expect(read.body.items[0]).toMatchObject({
      car: { brand: 'BMW', model: '320d' },
      jobs: [],
    });
  });

  it('drops the mechanic of a review whose mechanic was deleted', async () => {
    const { andrei, answeringMechanic, asOwner, garage } = await dinamo();
    const one = await review(garage.id, andrei);
    await prisma.review.update({
      data: { mechanicId: answeringMechanic.id },
      where: { id: one.id },
    });
    await prisma.mechanic.delete({ where: { id: answeringMechanic.id } });

    const read = await staffList(garage.id, asOwner);

    expect(read.status).toBe(200);
    expect(read.body.items[0].mechanic).toBeNull();
  });

  it('answers the receptionist the same figures as the owner', async () => {
    const { andrei, asOwner, asReceptionist, garage } = await dinamo();
    await review(garage.id, andrei, { rating: 2 });
    await review(garage.id, andrei, { status: 'reported' });

    const owner = await staffList(garage.id, asOwner);
    const desk = await staffList(garage.id, asReceptionist);

    for (const key of [
      'rating',
      'reviewCount',
      'breakdown',
      'total',
    ] as const) {
      expect(desk.body[key]).toEqual(owner.body[key]);
    }
    expect(ids(desk.body)).toEqual(ids(owner.body));
  });
});
