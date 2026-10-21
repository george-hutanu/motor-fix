import { QuoteComparisonDto } from '@motor-fix/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CompareService } from './compare.service';
import { CurrentActor } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';
import { CacheService } from '../../cache/cache.service';
import { warmAccept } from '../accept/accept.warm';

@ApiTags('quote-requests')
@ApiBearerAuth()
@Controller('quote-requests')
export class CompareController {
  constructor(
    private readonly compare: CompareService,
    private readonly cache: CacheService,
  ) {}

  @Get(':id/quotes')
  @ApiOkResponse({ type: QuoteComparisonDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s request' })
  async get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<QuoteComparisonDto> {
    const comparison = await this.compare.get(actor, id);
    await warmAccept(this.cache, actor, comparison);
    return comparison;
  }
}
