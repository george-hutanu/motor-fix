import { randomInt, randomUUID } from 'node:crypto';

import { type APIRequestContext, expect } from '@playwright/test';

import { PASSWORD } from './accounts.js';

// The seeded driver with a Dacia Logan, and the owner of Service Auto
// Militari, the approved seeded garage with mechanics and two lifts.
export const DRIVER = 'cerere@example.test';
export const MILITARI = 'militari@example.test';
const MINUTE = 60_000;

export async function accessToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/sign-in', {
    data: { email, password: PASSWORD, remember: false },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// A slot days ahead, drawn from 300 days of minutes, so a run on a database
// an earlier run left (or a parallel one) finds the mechanic and the lift
// free: two hour-long slots overlap about once in 3,600 draws. A Bucharest
// public holiday is drawn again: confirming refuses it as outside the hours.
async function freeSlot(request: APIRequestContext) {
  const year = new Date().getFullYear();
  const holidays = new Set<string>();
  for (const one of [year, year + 1, year + 2]) {
    const res = await request.get(`/api/v1/public-holidays?year=${one}`);
    expect(res.ok()).toBe(true);
    for (const { day } of (await res.json()) as { day: string }[])
      holidays.add(day);
  }
  const bucharestDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
  });
  const minute = Math.floor(Date.now() / MINUTE);
  // A random slot lands on a holiday rarely; 50 draws all landing on one
  // means the holiday list is wrong, so the helper says so instead of looping.
  for (let draw = 0; draw < 50; draw++) {
    const ahead = 3 * 24 * 60 + randomInt(300 * 24 * 60);
    const slot = new Date((minute + ahead) * MINUTE);
    if (!holidays.has(bucharestDay.format(slot))) return slot.toISOString();
  }
  throw new Error('freeSlot: 50 random slots all fell on a holiday');
}

// One request of the driver's, quoted by Militari and accepted by the driver,
// so its booking waits for the garage's confirmation.
export async function accepted(request: APIRequestContext) {
  return (await acceptedBooking(request)).requestId;
}

async function acceptedBooking(request: APIRequestContext) {
  const militari = await accessToken(request, MILITARI);
  const me = await request.get('/api/v1/me', { headers: bearer(militari) });
  const { garageId } = (await me.json()) as { garageId: string };
  const jobs = await request.get('/api/v1/job-types?keys=oil-service');
  const [oil] = ((await jobs.json()) as { items: { id: string }[] }).items;
  const driver = await accessToken(request, DRIVER);
  const cars = await request.get('/api/v1/cars', { headers: bearer(driver) });
  const { items } = (await cars.json()) as {
    items: { id: string; model: string }[];
  };
  const car = items.find((item) => item.model === 'Logan') ?? items[0];
  const sent = await request.post('/api/v1/quote-requests', {
    data: {
      carId: car.id,
      description: `Schimb de ulei și filtre ${randomUUID().slice(0, 8)}`,
      garageIds: [garageId],
      jobTypeIds: [oil.id],
      sources: ['profile_direct'],
    },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(sent.status()).toBe(201);
  const requestId = ((await sent.json()) as { id: string }).id;
  const quote = await request.post('/api/v1/quotes', {
    data: {
      durationMinutes: 60,
      fromLei: 300,
      requestId,
      slot: await freeSlot(request),
      toLei: 400,
    },
    headers: { ...bearer(militari), 'Idempotency-Key': randomUUID() },
  });
  expect(quote.status()).toBe(201);
  const quoteId = ((await quote.json()) as { id: string }).id;
  const accept = await request.post(`/api/v1/quotes/${quoteId}/accept`, {
    data: { historyShared: false },
    headers: { ...bearer(driver), 'Idempotency-Key': randomUUID() },
  });
  expect(accept.status()).toBe(201);
  const bookingId = ((await accept.json()) as { id: string }).id;
  return { bookingId, requestId };
}

// One request of the driver's, accepted as above and confirmed by Militari
// with its first mechanic on lift 1, so its booking is confirmed.
export async function confirmed(request: APIRequestContext) {
  const { bookingId, requestId } = await acceptedBooking(request);
  const headers = bearer(await accessToken(request, MILITARI));
  const options = await request.get(
    `/api/v1/bookings/${bookingId}/confirm-options`,
    { headers },
  );
  expect(options.ok()).toBe(true);
  const { mechanics } = (await options.json()) as {
    mechanics: { id: string }[];
  };
  const confirm = await request.post(`/api/v1/bookings/${bookingId}/confirm`, {
    data: { lift: 1, ...(mechanics[0] && { mechanicId: mechanics[0].id }) },
    headers,
  });
  expect(confirm.ok()).toBe(true);
  const { startsAt } = (await confirm.json()) as { startsAt: string };
  return { bookingId, requestId, startsAt };
}
