import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';

import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import { quotesWorld } from '../../quotes/quotes.testing';
import { AccountsService } from '../accounts.service';

const DAY = 24 * 60 * 60_000;

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  plate: string;
  // Every id of a row this driver owns or is the driver of.
  ids: string[];
}

// Two drivers who share a garage and its mechanic, each with a row in every
// table the export reads: what one driver's file may hold, and what of the
// other's it must never hold.
export function dataExportWorld(prisma: PrismaClient) {
  const world = quotesWorld(prisma);
  const accounts = new AccountsService(prisma, new AuditService(), noEvents);

  async function driver(
    name: string,
    email: string,
    phone: string,
    plate: string,
    garageId: string,
    mechanicId: string,
  ): Promise<Driver> {
    const { id } = await accounts.createAccount({
      consent: CURRENT_CONSENT,
      email,
      identity: { method: 'google', subject: `${email}-${randomUUID()}` },
      name,
      roles: ['driver'],
    });
    await prisma.account.update({
      data: { city: 'Cluj-Napoca', phone, phoneVerifiedAt: new Date() },
      where: { id },
    });
    const car = await world.car(id, plate);
    const reminder = await prisma.reminder.create({
      data: {
        accountId: id,
        carId: car.id,
        dueOn: new Date(Date.now() + 40 * DAY),
        kind: 'itp',
      },
    });
    const request = await world.request(id, {
      carId: car.id,
      status: 'booked',
    });
    const quote = await world.quote(request.id, garageId, 'accepted');
    const booking = await world.booking(quote.id, 'completed', { mechanicId });
    const job = await world.job(booking.id, 'done', { mechanicId });
    const stage = await prisma.jobStageEntry.create({
      data: {
        actorId: id,
        actorRole: 'driver',
        fromStatus: 'in_work',
        jobId: job.id,
        text: 'Mașina a fost ridicată',
        toStatus: 'done',
      },
    });
    const review = await prisma.review.create({
      data: {
        driverId: id,
        garageId,
        jobId: job.id,
        mechanicId,
        rating: 4,
        text: `Recenzia lui ${name}`,
      },
    });
    const notification = await prisma.notification.create({
      data: {
        accountId: id,
        channel: 'in_app',
        eventId: randomUUID(),
        kind: 'QUOTE_RECEIVED',
        params: { garage: 'Atelier Dinamo' },
        status: 'sent',
        subjectId: quote.id,
      },
    });
    const preference = await prisma.notificationPreference.create({
      data: { accountId: id, channel: 'email', enabled: false, type: 'news' },
    });
    const push = await prisma.pushSubscription.create({
      data: {
        accountId: id,
        auth: `auth-${randomUUID()}`,
        endpoint: `https://push.example.test/${randomUUID()}`,
        label: 'Telefon',
        p256dh: `key-${randomUUID()}`,
      },
    });
    const record = await prisma.consentRecord.create({
      data: {
        accountId: id,
        at: new Date(),
        browserConsentId: randomUUID(),
        decision: 'granted',
        kind: 'analytics',
        language: 'ro',
        textVersion: '2026-10',
      },
    });
    const message = await prisma.supportMessage.create({
      data: {
        accountId: id,
        email,
        language: 'ro',
        message: `Am o întrebare despre contul lui ${name}, vă rog.`,
        name,
        reference: `MF-${randomUUID().slice(0, 8)}`,
        role: 'driver',
        topic: 'account',
      },
    });
    const audit = await prisma.activityLog.create({
      data: {
        action: 'update',
        actorId: id,
        actorName: name.split(' ')[0],
        actorRole: 'driver',
        field: 'phone',
        newValue: phone,
        subjectId: id,
        subjectType: 'account',
      },
    });
    const consents = await prisma.accountConsent.findMany({
      select: { id: true },
      where: { accountId: id },
    });
    return {
      email,
      id,
      ids: [
        id,
        car.id,
        reminder.id,
        request.id,
        quote.id,
        booking.id,
        job.id,
        stage.id,
        review.id,
        notification.id,
        preference.id,
        push.id,
        record.id,
        message.id,
        audit.id,
        ...consents.map((c) => c.id),
      ],
      name,
      phone,
      plate,
    };
  }

  async function twoDrivers() {
    const garage = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { cityName: 'Cluj-Napoca' },
      where: { id: garage.id },
    });
    const mechanic = await prisma.mechanic.create({
      data: { garageId: garage.id, name: 'Mihai Dobre' },
    });
    const a = await driver(
      'Andrei Ion Marin',
      'andrei@example.test',
      '+40710000001',
      'CJ01AAA',
      garage.id,
      mechanic.id,
    );
    const b = await driver(
      'Bianca Elena Pop',
      'bianca@example.test',
      '+40720000002',
      'B99BBB',
      garage.id,
      mechanic.id,
    );
    return { a, b, garage, mechanic };
  }

  return { reset: world.reset, twoDrivers, world };
}

// Every value of `other` that must not appear in `text`.
export function foreignValuesIn(text: string, other: Driver): string[] {
  return [
    ...other.ids,
    other.name,
    other.email,
    other.phone,
    other.plate,
  ].filter((value) => text.includes(value));
}
