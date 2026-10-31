import {
  AdminDemandDto,
  AdminDemandSupplyDto,
  AdminDemandSupplyQueryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { readDemand } from './demand';
import { readDemandSupply } from './supply/supply';
import { Requires } from '../../auth/actor.guard';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class DemandController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('demand')
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: AdminDemandDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  demand(): Promise<AdminDemandDto> {
    return readDemand(this.prisma, new Date());
  }

  @Get('demand/supply')
  @Requires('admin.catalogue')
  @ApiOkResponse({ type: AdminDemandSupplyDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a brand of 0 or over 80 characters, an area that is not one, or an unknown query key',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  supply(
    @Query() query: AdminDemandSupplyQueryDto,
  ): Promise<AdminDemandSupplyDto> {
    return readDemandSupply(this.prisma, new Date(), query);
  }
}
