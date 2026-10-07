import type {
  GarageSearchPageDto,
  ListedGarageDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import { publicGarages } from '../garages/public-garages';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

const PAGE = 20;
const GROUPS = ['works_on', 'other'] as const;

// Unsigned on purpose: it only says where the next page starts, and a
// tampered one is refused or reads a page the visitor could read anyway.
interface Cursor {
  b: string;
  g: (typeof GROUPS)[number];
  n: string;
  i: string;
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
  const { b, g, i, n } = parsed ?? {};
  if (
    b !== brandId ||
    !GROUPS.includes(g as Cursor['g']) ||
    typeof n !== 'string' ||
    !isUUID(i)
  ) {
    throw invalidCursor();
  }
  return parsed as Cursor;
}

const encode = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

@Injectable()
export class GarageSearchService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forBrand(
    brandId: string,
    cursor?: string,
  ): Promise<GarageSearchPageDto> {
    const brand = await this.prisma.brand.findUnique({
      select: { id: true },
      where: { id: brandId },
    });
    if (!brand) throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
    const after = cursor === undefined ? undefined : decode(cursor, brandId);
    const takers = { brandId, stance: 'works_on' as const };
    const groups: Record<Cursor['g'], Prisma.GarageWhereInput> = {
      other: { brands: { none: takers } },
      works_on: { brands: { some: takers } },
    };
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
    const items = rows.slice(0, PAGE);
    const last = items.at(-1);
    return {
      counts: { doesNotTake, worksOn },
      items,
      nextCursor:
        rows.length > PAGE && last
          ? encode({
              b: brandId,
              g: last.stance === 'works_on' ? 'works_on' : 'other',
              i: last.id,
              n: last.name,
            })
          : null,
      total: worksOn + doesNotTake,
    };
  }

  private async read(
    brandId: string,
    group: Prisma.GarageWhereInput,
    after: Cursor | undefined,
    already = 0,
  ): Promise<ListedGarageDto[]> {
    const garages = await this.prisma.garage.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        brands: { select: { stance: true }, where: { brandId } },
        id: true,
        name: true,
        slug: true,
      },
      take: PAGE + 1 - already,
      where: {
        ...publicGarages(),
        ...group,
        ...(after && {
          OR: [
            { name: { gt: after.n } },
            { id: { gt: after.i }, name: after.n },
          ],
        }),
      },
    });
    return garages.map(({ brands, ...garage }) => ({
      ...garage,
      stance: brands[0]?.stance ?? 'unstated',
    }));
  }
}
