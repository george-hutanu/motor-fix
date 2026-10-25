import { randomUUID } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';

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
      // A city is its key and its name together (garage_city_both).
      data: { cityKey: 'cluj-napoca', cityName: 'Cluj-Napoca' },
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

// Every entry of a ZIP by name, read through its central directory, each
// body inflated and its CRC checked: what any unzip tool would do.
export function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('no end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad entry');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength);
    // Bit 11: the name is UTF-8.
    const decoded = name.toString(flags & 0x800 ? 'utf8' : 'latin1');
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const stored = zip.subarray(start, start + size);
    const body = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    if (crc32(body) !== crc) throw new Error(`bad CRC for ${decoded}`);
    entries.set(decoded, body);
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}
