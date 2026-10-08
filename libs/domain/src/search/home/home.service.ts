import type { HomeDto, SearchPoint } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { publicGarages } from '../../garages/public-garages/public-garages';
import type { PrismaClient } from '../../generated/prisma/client';
import { garagesInArea } from '../area/search-area';

@Injectable()
export class HomeService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forBrand(slug: string, point?: SearchPoint): Promise<HomeDto> {
    const brand = await this.prisma.brand.findFirst({
      select: { id: true, name: true, popularity: true, slug: true },
      where: { active: true, slug },
    });
    if (!brand) {
      throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'no such brand');
    }
    const area = point && {
      id: { in: [...(await garagesInArea(this.prisma, point)).keys()] },
    };
    const [total, takers] = await Promise.all([
      this.prisma.garage.count({ where: { ...publicGarages(), ...area } }),
      this.prisma.garage.count({
        where: {
          ...publicGarages(),
          ...area,
          brands: { some: { brandId: brand.id, stance: 'works_on' } },
        },
      }),
    ]);
    return { brand, takers, total };
  }
}
