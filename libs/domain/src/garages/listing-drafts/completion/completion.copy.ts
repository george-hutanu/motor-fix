import {
  type CourtesyCar,
  DOCUMENT_KINDS,
  type DocumentKind,
  FACILITIES,
  FUELS,
  type HeldDocumentDto,
  type ListingDraftData,
  type MarkedBrand,
  type MechanicCard,
  type SurveySection,
  type WeeklyHours,
} from '@motor-fix/contracts';

import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { newestFirst } from '../../verification/verification.service';

type Db = PrismaClient | Prisma.TransactionClient;
type Steps = NonNullable<ListingDraftData['steps']>;

const INCLUDE = {
  brands: {
    include: { brand: { select: { name: true } }, jobs: true },
    orderBy: { brand: { name: 'asc' } },
  },
  closedDays: { orderBy: { day: 'asc' } },
  facilities: true,
  // Step 4's cards only: the owner's own row is none of them, and a removed
  // card is out of the team (056-FR-006, 056-FR-015).
  mechanics: {
    orderBy: { name: 'asc' },
    where: { isOwner: false, removedAt: null },
  },
  photos: { orderBy: { position: 'asc' } },
  prices: {
    include: { jobType: { select: { nameRo: true, status: true } } },
    orderBy: { position: 'asc' },
  },
  survey: true,
  verificationFiles: { orderBy: newestFirst, take: 1 },
} satisfies Prisma.GarageInclude;
type Stored = Prisma.GarageGetPayload<{ include: typeof INCLUDE }>;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

// The fields that hold a value: the form keeps no key for an empty one.
function present<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value != null),
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}

// A catalogue job by its id, a proposed one by the name it was given.
const jobRef = (price: Stored['prices'][number]) =>
  price.jobType.status === 'approved'
    ? { jobTypeId: price.jobTypeId }
    : { name: price.jobType.nameRo };

// Fuels absent mean all four; unticked lists the price list's jobs a taken
// brand has no tick for.
function brandsOf(garage: Stored): MarkedBrand[] {
  const listed = new Map(
    garage.prices.map((price) => {
      const job = jobRef(price);
      return [price.jobTypeId, job.jobTypeId ?? job.name] as const;
    }),
  );
  return garage.brands.map((row) => {
    const fuels = FUELS.filter((fuel) => row[fuel]);
    const ticked = new Set(row.jobs.map((job) => job.jobTypeId));
    const takes = row.stance === 'works_on';
    const unticked = takes
      ? [...listed].flatMap(([id, named]) => (ticked.has(id) ? [] : [named]))
      : [];
    return {
      brandId: row.brandId,
      name: row.brand.name,
      stance: row.stance,
      ...(takes && fuels.length < FUELS.length && { fuels }),
      ...(unticked.length > 0 && { unticked }),
    };
  });
}

function hoursOf(garage: Stored): Steps['5'] {
  const hours = garage.hours as WeeklyHours;
  const closedDays = garage.closedDays.map((row) =>
    present({ day: isoDay(row.day), note: row.note }),
  ) as { day: string; note?: string }[];
  const facilities = FACILITIES.filter((facility) =>
    garage.facilities.some((row) => row.facility === facility),
  );
  const payments = (['cash', 'card', 'transfer'] as const).filter(
    (method) =>
      ({
        card: garage.paymentCard,
        cash: garage.paymentCash,
        transfer: garage.paymentTransfer,
      })[method],
  );
  const courtesyCar = present({
    paid: garage.courtesyCarPaid,
    pricePerDayBani: garage.courtesyCarPricePerDayBani,
  }) as CourtesyCar;
  return {
    ...(Object.keys(hours).length > 0 && { hours }),
    ...(closedDays.length > 0 && { closedDays }),
    ...(facilities.length > 0 && { facilities }),
    ...(payments.length > 0 && { payments }),
    ...(facilities.includes('courtesy_car') && { courtesyCar }),
    ...(garage.latitude !== null && {
      place: present({
        address: garage.address ?? garage.seatAddress,
        lat: garage.latitude,
        lng: garage.longitude,
        locality: garage.cityName,
        radiusKm: garage.serviceRadiusKm,
      }),
    }),
  };
}

function surveyOf(garage: Stored): Pick<ListingDraftData, 'survey'> {
  if (!garage.survey) return {};
  const {
    foundVia,
    liftsCount,
    mechanicsCount,
    wantsDaySheets,
    wantsLiveMedia,
  } = garage.survey;
  const survey = {
    foundVia,
    liftsCount,
    mechanicsCount,
    wantsDaySheets,
    wantsLiveMedia,
  } as SurveySection;
  return { survey };
}

// A live garage read back into the listing form's shape: what each step's
// writer stored, so writing the copy back unchanged changes nothing. The
// documents stay on the file; the copy carries only replacements.
export async function copyOf(
  db: Db,
  garageId: string,
): Promise<ListingDraftData> {
  const garage = await db.garage.findUniqueOrThrow({
    include: INCLUDE,
    where: { id: garageId },
  });
  const file = garage.verificationFiles[0];
  return {
    documents: {},
    files: garage.photos.map((photo) => photo.fileKey),
    steps: {
      '1': present({
        businessKind: garage.businessKind,
        knownFor: garage.knownFor,
        mobileLegalForm: garage.mobileLegalForm,
        name: garage.name,
        phone: garage.phone,
      }),
      '2': {
        brands: brandsOf(garage),
        ...present({
          brandNote: garage.brandNote,
          refusalPhrase: garage.refusalPhrase,
        }),
      },
      '3': {
        jobs: garage.prices.map((price) => ({
          ...present({
            brandId: price.brandId,
            fromBani: price.fromBani,
            toBani: price.toBani,
          }),
          ...jobRef(price),
        })),
        labour: present({
          fromBani: garage.labourFromBani,
          toBani: garage.labourToBani,
        }),
      },
      '4': {
        mechanics: garage.mechanics.map((row) =>
          present({ name: row.name, speciality: row.speciality }),
        ) as MechanicCard[],
        onProfile: garage.mechanics[0]?.onProfile ?? false,
      },
      '5': hoursOf(garage),
      '6': present({ cui: garage.cui, rarNumber: file?.rarNumber }),
    },
    ...present({
      declaredAt: file?.declaredAt?.toISOString(),
      declaredByName: file?.declaredByName,
    }),
    ...surveyOf(garage),
  };
}

// The documents on the file, one per kind: the rows no replacement retired.
export async function heldOf(
  db: Db,
  fileId: string,
): Promise<HeldDocumentDto[]> {
  const rows = await db.legalDocument.findMany({
    where: { replacedAt: null, verificationFileId: fileId },
  });
  return rows
    .map((row) => ({
      issuedOn: row.issuedOn ? isoDay(row.issuedOn) : null,
      kind: row.kind as DocumentKind,
      pages: row.pages.length,
    }))
    .sort(
      (a, b) => DOCUMENT_KINDS.indexOf(a.kind) - DOCUMENT_KINDS.indexOf(b.kind),
    );
}
