import { SystemLogDto, SystemLogQueryDto } from '@motor-fix/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { listSystemLog } from './list';
import { Requires } from '../../auth/actor.guard';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class SystemLogController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('system-log')
  @Requires('admin.settings')
  @ApiOkResponse({ type: SystemLogDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad filter, an end not after the start or a cursor this list did not give out',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(@Query() query: SystemLogQueryDto): Promise<SystemLogDto> {
    return listSystemLog(this.prisma, query, new Date());
  }
}
