import { AdminDemandDto } from '@motor-fix/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { readDemand } from './demand';
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
}
