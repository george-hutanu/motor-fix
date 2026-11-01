import {
  type BodyStyle,
  type CarModel3dDto,
  type CarModels3dQueryDto,
  type Fuel,
  models3dBaseUrl,
} from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { chooseCar, systemsFor } from './car-models-3d';
import { notFound } from '../../auth/http-refusal';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { GENERIC_FILES } from '../models-3d/models-3d';

@Injectable()
export class CarModels3dService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async read(
    query: CarModels3dQueryDto,
    accountId: string | undefined,
  ): Promise<CarModel3dDto> {
    const brand = await this.prisma.brand.findUnique({
      select: {
        active: true,
        bodyStyle: true,
        id: true,
        key: true,
        name: true,
      },
      where: { key: query.brand },
    });
    if (!brand?.active) throw notFound();
    const ownCars = await this.ownCars(query.car, accountId, brand.id);
    const models = await this.prisma.carModel3d.findMany({
      orderBy: { popularity: 'asc' },
      select: { fileKey: true, fuel: true, model: true },
      where: { brandId: brand.id },
    });
    const chosen = chooseCar(ownCars, models, brand.bodyStyle as BodyStyle);
    const fuel: Fuel = chosen.model?.fuel ?? 'petrol';
    const [systems, jobs] = await Promise.all([
      this.prisma.carSystem.findMany({ where: { fuelTypes: { has: fuel } } }),
      this.prisma.jobType.findMany({
        orderBy: [{ nameRo: 'asc' }, { id: 'asc' }],
        select: { carSystem: true, id: true },
        where: { carSystem: { not: null }, status: 'approved' },
      }),
    ]);
    const file = chosen.model
      ? chosen.model.fileKey
      : GENERIC_FILES[chosen.bodyStyle];
    return {
      bodyStyle: brand.bodyStyle as BodyStyle,
      brand: { key: brand.key, name: brand.name },
      fileUrl: `${models3dBaseUrl()}/${file}`,
      fuel,
      model: chosen.model?.model ?? null,
      source: chosen.source,
      systems: systemsFor(systems, fuel, jobs),
    };
  }

  // The caller's cars of the brand, newest first; with car= that car alone,
  // which must be the caller's own and not removed.
  private async ownCars(
    carId: string | undefined,
    accountId: string | undefined,
    brandId: string,
  ): Promise<{ model: string }[]> {
    if (carId) {
      if (!accountId) throw notFound();
      const car = await this.prisma.car.findFirst({
        select: { brandId: true, model: true },
        where: { id: carId, ownerId: accountId, removedAt: null },
      });
      if (!car) throw notFound();
      return car.brandId === brandId ? [car] : [];
    }
    if (!accountId) return [];
    return this.prisma.car.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { model: true },
      where: { brandId, ownerId: accountId, removedAt: null },
    });
  }
}
