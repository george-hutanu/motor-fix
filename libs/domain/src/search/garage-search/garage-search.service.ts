import {
  FACILITIES,
  type GarageSearchPageDto,
  type ListedGarageDto,
  nearOf,
  SEARCH_IDS_MAX,
  type SearchPoint,
} from '@motor-fix/contracts';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { GarageSearchCache } from './garage-search.cache';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { brandAnswer } from '../../garages/brand-answer';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { countSearch } from '../../metrics/product-counters';
import { garagesInArea, groupsOf, placed } from '../area/search-area';
import { SearchLogService } from '../search-log/search-log.service';

const PAGE = SEARCH_IDS_MAX;
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
  rating: Prisma.Decimal | null;
  reviewCount: number;
}

// Rating high to low with the unrated last, more reviews first, then name and
// id. An unrated garage has no reviews (garage_rating_reviewed).
const ORDER = [
  { rating: { nulls: 'last', sort: 'desc' } },
  { reviewCount: 'desc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.GarageOrderByWithRelationInput[];

// Every garage after the boundary in that order.
function beyond({
  i,
  name,
  rating,
  reviewCount,
}: After): Prisma.GarageWhereInput {
  const later = [{ name: { gt: name } }, { id: { gt: i }, name }];
  if (rating === null) return { OR: later, rating: null };
  return {
    OR: [
      { rating: null },
      { rating: { lt: rating } },
      { rating, reviewCount: { lt: reviewCount } },
      { OR: later, rating, reviewCount },
    ],
  };
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

export async function brandOf(prisma: PrismaClient, key: BrandKey) {
  const brand = await prisma.brand.findUnique({
    select: { id: true, name: true, slug: true },
    where: typeof key === 'string' ? { id: key } : key,
  });
  if (!brand) throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
  return brand;
}

// The approved garages of each group: the counts and total of a search.
export async function countGroups(
  prisma: PrismaClient,
  groups: ReturnType<typeof groupsOf>,
) {
  const [worksOn, doesNotTake] = await Promise.all([
    prisma.garage.count({ where: { ...publicGarages(), ...groups.works_on } }),
    prisma.garage.count({ where: { ...publicGarages(), ...groups.other } }),
  ]);
  return { counts: { doesNotTake, worksOn }, total: worksOn + doesNotTake };
}

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

type Groups = ReturnType<typeof groupsOf>;

@Injectable()
export class GarageSearchService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: GarageSearchCache,
    private readonly searchLog: SearchLogService,
  ) {}

  // A page, from the cache when the same search was read in the last 60
  // seconds. `log` marks a new search: its row is written after the answer,
  // which never waits for it.
  async forBrand(
    key: BrandKey,
    cursor?: string,
    point?: SearchPoint,
    radiusKm?: number,
    log = false,
  ): Promise<GarageSearchPageDto> {
    const brand = await this.brandOf(key);
    const page = await this.cache.entry(
      {
        brandId: brand.id,
        cursor,
        kind: 'page',
        near: point && nearOf(point),
        radiusKm,
      },
      () => this.searched(brand, cursor, point, radiusKm),
    );
    countFirstPage(cursor, page.items.length);
    // Left to the next turn of the event loop: the answer goes out first.
    if (log) {
      setImmediate(() => this.searchLog.record({ brandId: brand.id, point }));
    }
    return page;
  }

  private async searched(
    brand: GarageSearchPageDto['brand'],
    cursor?: string,
    point?: SearchPoint,
    radiusKm?: number,
  ): Promise<GarageSearchPageDto> {
    const brandId = brand.id;
    const after =
      cursor === undefined
        ? undefined
        : await this.after(decode(cursor, brandId));
    const area = await this.area(point, radiusKm);
    const groups = groupsOf(brandId, area);
    const found = await this.counted(groups);
    const rows: ListedGarageDto[] = [];
    if (after?.g !== 'other') {
      rows.push(
        ...(await this.read(brandId, groups.works_on, after, PAGE + 1)),
      );
    }
    if (rows.length <= PAGE) {
      const resume = after?.g === 'other' ? after : undefined;
      rows.push(
        ...(await this.read(
          brandId,
          groups.other,
          resume,
          PAGE + 1 - rows.length,
        )),
      );
    }
    const items = rows.slice(0, PAGE).map((item) => placed(item, area));
    const last = items.at(-1);
    return {
      brand,
      ...found,
      items,
      nextCursor:
        rows.length > PAGE && last
          ? encode({
              b: brandId,
              g: last.stance === 'works_on' ? 'works_on' : 'other',
              i: last.id,
            })
          : null,
    };
  }

  // The cards a page already shows, read again: the public ones among the
  // ids, in the search's order and with its counts. Not a search of its own,
  // so it is never counted.
  async byIds(
    key: BrandKey,
    ids: string[],
    point?: SearchPoint,
    radiusKm?: number,
  ): Promise<GarageSearchPageDto> {
    const brand = await this.brandOf(key);
    const area = await this.area(point, radiusKm);
    const groups = groupsOf(brand.id, area);
    const only = (group: Prisma.GarageWhereInput) => ({
      AND: [group, { id: { in: ids } }],
    });
    const [found, takers, others] = await Promise.all([
      this.counted(groups),
      this.read(brand.id, only(groups.works_on), undefined, ids.length),
      this.read(brand.id, only(groups.other), undefined, ids.length),
    ]);
    return {
      brand,
      ...found,
      items: [...takers, ...others].map((item) => placed(item, area)),
      nextCursor: null,
    };
  }

  private brandOf(key: BrandKey) {
    return brandOf(this.prisma, key);
  }

  private async area(point: SearchPoint | undefined, radiusKm?: number) {
    return point && garagesInArea(this.prisma, { point, radiusKm });
  }

  private counted(groups: Groups) {
    return countGroups(this.prisma, groups);
  }

  // The boundary's place in the order, by id: a garage suspended since the
  // last page still marks where the next one starts, and is never listed
  // again.
  private async after(cursor: Cursor): Promise<After> {
    const last = await this.prisma.garage.findUnique({
      select: { name: true, rating: true, reviewCount: true },
      where: { id: cursor.i },
    });
    if (!last) throw invalidCursor();
    return { ...cursor, ...last };
  }

  private async read(
    brandId: string,
    group: Prisma.GarageWhereInput,
    after: After | undefined,
    take: number,
  ): Promise<ListedGarageDto[]> {
    const garages = await this.prisma.garage.findMany({
      orderBy: ORDER,
      select: CARD,
      take,
      where: {
        ...publicGarages(),
        ...group,
        ...(after && beyond(after)),
      },
    });
    return garages.map((garage) => cardOf(brandId, garage));
  }
}

// One search per first page; the pages after it are the same search.
function countFirstPage(cursor: string | undefined, found: number) {
  if (cursor === undefined) countSearch(found > 0 ? 'results' : 'none');
}
