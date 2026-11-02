import { AdminStatusDto } from '@motor-fix/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { readStatus } from './read';
import { Requires } from '../auth/actor.guard';
import { PRISMA } from '../auth/prisma';
import type { PrismaClient } from '../generated/prisma/client';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class StatusController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('status')
  @Requires('admin.settings')
  @ApiOkResponse({ type: AdminStatusDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  read(): Promise<AdminStatusDto> {
    return readStatus(this.prisma, new Date());
  }
}
