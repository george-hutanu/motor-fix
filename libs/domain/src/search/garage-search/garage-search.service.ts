import {
  FACILITIES,
  type GarageSearchPageDto,
  type ListedGarageDto,
  type SearchPoint,
} from '@motor-fix/contracts';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { brandAnswer } from '../../garages/brand-answer';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { countSearch } from '../../metrics/product-counters';
import { garagesInArea, groupsOf, placed } from '../area/search-area';

const PAGE = 20;
const GROUPS = ['works_on', 'other'] as const;

// Unsigned on purpose: it only says where the next page starts, and a
// tampered one is refused or reads a page the visitor could read anyway.
// It carries the last garage's id, not its name: a name has no length limit
// and the query caps the cursor at 200 characters.
interface Cursor {
  b: string;
  g: (typeof GROUPS)[number];
  i: string;
}

interface After extends Cursor {
  name: string;
}

const invalidCursor = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'invalid_cursor',
    'cursor is not a page of this search',
  );

function decode(cursor: string, brandId: string): Cursor {
  let parsed: Partial<Cursor>;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw invalidCursor();
  }
  const { b, g, i } = parsed ?? {};
  if (b !== brandId || !GROUPS.includes(g as Cursor['g']) || !isUUID(i)) {
    throw invalidCursor();
  }
  return parsed as Cursor;
}

const encode = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

// The brand by its catalogue id, or by its slug as the address bar holds it.
export type BrandKey = string | { slug: string };

const CARD = {
  brandNote: true,
  brands: {
    select: {
      brand: {
        select: { id: true, name: true, popularity: true, slug: true },
      },
      stance: true,
    },
  },
  businessKind: true,
  cityName: true,
  facilities: { select: { facility: true }, where: { status: 'listed' } },
  id: true,
  labourFromBani: true,
  name: true,
  rating: true,
  refusalPhrase: true,
  reviewCount: true,
  serviceRadiusKm: true,
  slug: true,
} satisfies Prisma.GarageSelect;

type CardRow = Prisma.GarageGetPayload<{ select: typeof CARD }>;

// What a card shows. A mobile mechanic's city would tell where its seat is,
// so it gets its area instead.
function cardOf(
  brandId: string,
  {
    brandNote,
    brands,
    cityName,
    facilities,
    labourFromBani,
    rating,
    refusalPhrase,
    serviceRadiusKm,
    ...garage
  }: CardRow,
): ListedGarageDto {
  const mobile = garage.businessKind === 'mobile';
  const listed = new Set(facilities.map((row) => row.facility));
  return {
    ...garage,
    stance:
      brands.find((row) => row.brand.id === brandId)?.stance ?? 'unstated',
    ...brandAnswer(brands, { brandNote, refusalPhrase }),
    facilities: FACILITIES.filter((facility) => listed.has(facility)),
    labourFromLei:
      labourFromBani === null ? null : Math.round(labourFromBani / 100),
    rating: rating === null ? null : rating.toNumber(),
    ...(mobile
      ? { serviceRadiusKm: serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM }
      : cityName !== null && { city: cityName }),
  };
}

@Injectable()
export class GarageSearchService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forBrand(
    key: BrandKey,
    cursor?: string,
    point?: SearchPoint,
  ): Promise<GarageSearchPageDto> {
    const brand = await this.brandOf(key);
    const brandId = brand.id;
    const after =
      cursor === undefined
        ? undefined
        : await this.after(decode(cursor, brandId));
    const area = await this.area(point);
    const groups = groupsOf(brandId, area);
    const [worksOn, doesNotTake] = await Promise.all([
      this.prisma.garage.count({
        where: { ...publicGarages(), ...groups.works_on },
      }),
      this.prisma.garage.count({
        where: { ...publicGarages(), ...groups.other },
      }),
    ]);
    const rows: ListedGarageDto[] = [];
    if (after?.g !== 'other') {
      rows.push(...(await this.read(brandId, groups.works_on, after)));
    }
    if (rows.length <= PAGE) {
      const resume = after?.g === 'other' ? after : undefined;
      rows.push(
        ...(await this.read(brandId, groups.other, resume, rows.length)),
      );
    }
    const items = rows.slice(0, PAGE).map((item) => placed(item, area));
    const last = items.at(-1);
    countFirstPage(cursor, items.length);
    return {
      brand,
      counts: { doesNotTake, worksOn },
      items,
      nextCursor:
        rows.length > PAGE && last
          ? encode({
              b: brandId,
              g: last.stance === 'works_on' ? 'works_on' : 'other',
              i: last.id,
            })
          : null,
      total: worksOn + doesNotTake,
    };
  }

  private async brandOf(key: BrandKey) {
    const brand = await this.prisma.brand.findUnique({
      select: { id: true, name: true, slug: true },
      where: typeof key === 'string' ? { id: key } : key,
    });
    if (!brand) throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
    return brand;
  }

  private async area(point: SearchPoint | undefined) {
    return point && garagesInArea(this.prisma, point);
  }

  // The boundary's name only, by id: a garage suspended since the last page
  // still marks where the next one starts, and is never listed again.
  private async after(cursor: Cursor): Promise<After> {
    const last = await this.prisma.garage.findUnique({
      select: { name: true },
      where: { id: cursor.i },
    });
    if (!last) throw invalidCursor();
    return { ...cursor, name: last.name };
  }

  private async read(
    brandId: string,
    group: Prisma.GarageWhereInput,
    after: After | undefined,
    already = 0,
  ): Promise<ListedGarageDto[]> {
    const garages = await this.prisma.garage.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: CARD,
      take: PAGE + 1 - already,
      where: {
        ...publicGarages(),
        ...group,
        ...(after && {
          OR: [
            { name: { gt: after.name } },
            { id: { gt: after.i }, name: after.name },
          ],
        }),
      },
    });
    return garages.map((garage) => cardOf(brandId, garage));
  }
}

// One search per first page; the pages after it are the same search.
function countFirstPage(cursor: string | undefined, found: number) {
  if (cursor === undefined) countSearch(found > 0 ? 'results' : 'none');
}
