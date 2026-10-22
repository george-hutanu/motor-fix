import { randomUUID } from 'node:crypto';

import type { ListingDraftData, SurveySection } from '@motor-fix/contracts';

import { CompletionService } from './completion.service';
import { AuditService } from '../../../audit/audit.service';
import { AccountsService } from '../../../auth/accounts.service';
import { newToken } from '../../../auth/email-confirmation/email-confirmation';
import type { Actor } from '../../../auth/policy';
import { outbox } from '../../../events/event.port';
import type { PrismaClient } from '../../../generated/prisma/client';
import { NotificationsService } from '../../../notifications/notifications.service';
import { testConfig } from '../../../notifications/notifications.testing';
import { GarageDetailsService } from '../../details/garage-details.service';
import { LegalDocumentsService } from '../../documents/legal-documents/legal-documents.service';
import { GarageMechanicsService } from '../../mechanics/garage-mechanics.service';
import { GaragePhotosService } from '../../photos/garage-photos.service';
import type { ListingPhotosService } from '../../photos/listing-photos/listing-photos.service';
import { GaragePlaceService } from '../../place/garage-place.service';
import { GaragePricesService } from '../../prices/garage-prices/garage-prices.service';
import { VerificationService } from '../../verification/verification.service';
import { ListingDraftsService } from '../listing-drafts.service';
import { ListingSubmitService } from '../submit/submit.service';

export const OWNER_PERMISSIONS = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const SURVEY: SurveySection = {
  foundVia: 'google',
  liftsCount: '1',
  mechanicsCount: '1-2',
  wantsDaySheets: false,
  wantsLiveMedia: true,
};

const key = (area: string, n: number) => `${area}/${randomUUID()}/p${n}`;

export interface World {
  dacia: string;
  tesla: string;
  brakes: string;
  oil: string;
}

// A garage sent through the listing form, as its owner reads it afterwards.
export interface Listed {
  garageId: string;
  fileId: string;
  owner: Actor;
}

export function completionWorld(prisma: PrismaClient) {
  const audit = new AuditService();
  const drafts = new ListingDraftsService(
    prisma,
    { sendToDraft: async () => undefined } as never,
    { webUrl: '' } as never,
  );
  const details = new GarageDetailsService(audit);
  const prices = new GaragePricesService(audit, outbox);
  const mechanics = new GarageMechanicsService(audit);
  const place = new GaragePlaceService(audit);
  const photos = new GaragePhotosService(audit);
  const verification = new VerificationService(audit, outbox, {
    skipManualApproval: false,
  });
  const documents = new LegalDocumentsService(
    prisma,
    audit,
    outbox,
    {} as never,
  );
  // The photo keys handed back to storage after a committed sending.
  const released: string[] = [];
  const completion = new CompletionService(
    prisma,
    details,
    prices,
    mechanics,
    place,
    photos,
    documents,
    verification,
    audit,
  );
  const submit = new ListingSubmitService(
    prisma,
    drafts,
    new AccountsService(prisma, audit, outbox),
    details,
    prices,
    mechanics,
    place,
    photos,
    {
      describe: async (keys: string[]) =>
        keys.map((key) => ({ height: 600, key, width: 800 })),
      release: async (keys: string[]) => {
        released.push(...keys);
      },
    } as unknown as ListingPhotosService,
    verification,
    documents,
    new NotificationsService(
      prisma,
      {} as never,
      { publish: async () => 0 } as never,
      testConfig('http://localhost:9'),
      null,
      audit,
    ),
    audit,
    outbox,
    completion,
  );
  const world: World = { brakes: '', dacia: '', oil: '', tesla: '' };

  async function reset() {
    released.length = 0;
    await prisma.$executeRawUnsafe(
      'TRUNCATE account, brand, garage, job_type, listing_draft CASCADE',
    );
    const brand = (name: string) =>
      prisma.brand.create({
        data: { key: name.toLowerCase(), name, slug: name.toLowerCase() },
      });
    const job = (key: string, nameRo: string) =>
      prisma.jobType.create({
        data: { key, nameEn: key, nameRo, status: 'approved' },
      });
    world.dacia = (await brand('Dacia')).id;
    world.tesla = (await brand('Tesla')).id;
    world.brakes = (await job('front-brakes', 'Frâne față')).id;
    world.oil = (await job('oil-change', 'Schimb ulei')).id;
  }

  // The fewest answers a listing is sent with.
  const plain = (): ListingDraftData => ({
    declaredAt: '2026-10-11T10:00:00.000Z',
    declaredByName: 'Ion Popescu',
    documents: {
      onrc_certificate: { pages: [key('listing-documents', 1)] },
      rar_authorisation: { pages: [key('listing-documents', 1)] },
    },
    files: [key('garage-photos', 1)],
    steps: {
      '1': {
        businessKind: 'company',
        knownFor: 'Frâne și distribuție',
        name: 'Service Popescu',
        phone: '0722 123 456',
      },
      '2': {
        brands: [{ brandId: world.dacia, name: 'Dacia', stance: 'works_on' }],
      },
      '3': {
        jobs: [{ fromBani: 15_000, jobTypeId: world.brakes, toBani: 30_000 }],
        labour: { fromBani: 12_000, toBani: 20_000 },
      },
      '4': { mechanics: [{ name: 'Mihai Ionescu' }], onProfile: true },
      '5': {
        payments: ['cash'],
        place: { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 },
      },
      '6': { cui: '18547290', rarNumber: 'BV-123' },
    },
    survey: SURVEY,
  });

  // Every answer the form can hold, each one away from its default.
  const full = (closedDay: string): ListingDraftData => ({
    declaredAt: '2026-10-11T10:00:00.000Z',
    declaredByName: 'Ion Popescu',
    documents: {
      onrc_certificate: {
        issuedOn: '2026-09-01',
        pages: [key('listing-documents', 1), key('listing-documents', 2)],
      },
      rar_authorisation: { pages: [key('listing-documents', 1)] },
    },
    files: [key('garage-photos', 1), key('garage-photos', 2)],
    steps: {
      '1': {
        businessKind: 'mobile',
        knownFor: 'Diagnoză la domiciliu',
        mobileLegalForm: 'pfa',
        name: 'Mecanic Mobil Ion',
        phone: '+40722123456',
      },
      '2': {
        brandNote: 'Doar modele după 2010',
        brands: [
          {
            brandId: world.dacia,
            fuels: ['petrol', 'diesel'],
            name: 'Dacia',
            stance: 'works_on',
            unticked: ['Recondiționare injectoare'],
          },
          { brandId: world.tesla, name: 'Tesla', stance: 'does_not_take' },
        ],
        refusalPhrase: 'Nu lucrăm pe electrice',
      },
      '3': {
        jobs: [
          { fromBani: 15_000, jobTypeId: world.brakes, toBani: 30_000 },
          {
            brandId: world.dacia,
            fromBani: 18_000,
            jobTypeId: world.brakes,
            toBani: 24_000,
          },
          { fromBani: 9_000, jobTypeId: world.oil, toBani: 12_000 },
          {
            fromBani: 20_000,
            name: 'Recondiționare injectoare',
            toBani: 40_000,
          },
        ],
        labour: { fromBani: 12_000, toBani: 20_000 },
      },
      '4': {
        mechanics: [
          { name: 'Andrei Pop', speciality: 'Electrică' },
          { name: 'Mihai Ionescu' },
        ],
        onProfile: true,
      },
      '5': {
        closedDays: [{ day: closedDay, note: 'Inventar' }],
        courtesyCar: { paid: true, pricePerDayBani: 10_000 },
        facilities: ['courtesy_car', 'waiting_area'],
        hours: {
          fri: [['09:00', '18:00']],
          mon: [['09:00', '18:00']],
          sat: [['09:00', '13:00']],
          sun: [],
          thu: [['09:00', '18:00']],
          tue: [['09:00', '18:00']],
          wed: [
            ['09:00', '12:00'],
            ['13:00', '18:00'],
          ],
        },
        payments: ['card', 'transfer'],
        place: {
          address: 'Str. Lungă 1, Brașov',
          lat: 45.65,
          lng: 25.6,
          locality: 'Brașov',
          radiusKm: 25,
        },
      },
      '6': { cui: '18547290', rarNumber: 'BV-123' },
    },
    survey: SURVEY,
  });

  // Sends `data` as a new driver's listing, and answers its owner.
  async function listed(
    account: (name: string, roles: ['driver']) => Promise<string>,
    name: string,
    data: ListingDraftData,
  ): Promise<Listed> {
    const accountId = await account(name, ['driver']);
    const token = newToken();
    const row = await prisma.listingDraft.create({
      data: {
        data: data as never,
        email: `${name}@example.test`,
        language: 'ro',
        step: 6,
        tokens: {
          create: { hash: token.hash, kind: 'browser', sentAt: new Date() },
        },
        updatedAt: new Date(),
      },
    });
    const driver: Actor = {
      accountId,
      garageId: null,
      permissions: OWNER_PERMISSIONS,
      role: 'driver',
      roles: ['driver'],
    };
    const sent = await submit.submit(driver, row.id, token.token, randomUUID());
    return {
      fileId: sent.fileId,
      garageId: sent.garageId,
      owner: {
        accountId,
        garageId: sent.garageId,
        permissions: OWNER_PERMISSIONS,
        role: 'garage',
        roles: ['driver', 'garage'],
      },
    };
  }

  return {
    completion,
    drafts,
    full,
    listed,
    plain,
    released,
    reset,
    submit,
    world,
  };
}
