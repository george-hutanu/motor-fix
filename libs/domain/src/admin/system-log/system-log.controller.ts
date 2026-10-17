import {
  SYSTEM_LOG_PAGE,
  SystemLogDto,
  type SystemLogEntryDto,
  SystemLogQueryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Requires } from '../../auth/actor.guard';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class SystemLogController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Newest first; the id only orders entries of the same instant the same
  // way on every read.
  @Get('system-log')
  @Requires('admin.settings')
  @ApiOkResponse({ type: SystemLogDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  async list(@Query() query: SystemLogQueryDto): Promise<SystemLogDto> {
    const rows = await this.prisma.systemLogEntry.findMany({
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: query.limit ?? SYSTEM_LOG_PAGE,
      where: { at: { gte: new Date(query.from) } },
    });
    return {
      items: rows.map(
        (row): SystemLogEntryDto => ({
          at: row.at.toISOString(),
          context: row.context as Record<string, unknown>,
          count: row.count,
          id: row.id,
          kind: row.kind,
          message: row.message,
          severity: row.severity,
          source: row.source,
        }),
      ),
    };
  }
}
