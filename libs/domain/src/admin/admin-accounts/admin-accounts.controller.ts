import {
  AdminAccountsPageDto,
  AdminAccountsQueryDto,
  AdminAccountsSummaryDto,
} from '@motor-fix/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AdminAccountsService } from './admin-accounts.service';
import { Requires } from '../../auth/actor.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountsPageDto })
  @ApiBadRequestResponse({
    description:
      'invalid_cursor; invalid_query: q over 80 characters; invalid_filter: an unknown role or state, or a repeated state; or a query parameter it does not take',
  })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(@Query() query: AdminAccountsQueryDto): Promise<AdminAccountsPageDto> {
    const { cursor, ...search } = query;
    return this.accounts.page(cursor, new Date(), search);
  }

  @Get('summary')
  @Requires('admin.users')
  @ApiOkResponse({ type: AdminAccountsSummaryDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  summary(): Promise<AdminAccountsSummaryDto> {
    return this.accounts.summary(new Date());
  }
}
