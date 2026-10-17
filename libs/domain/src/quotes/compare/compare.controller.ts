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

@ApiTags('quote-requests')
@ApiBearerAuth()
@Controller('quote-requests')
export class CompareController {
  constructor(private readonly compare: CompareService) {}

  @Get(':id/quotes')
  @ApiOkResponse({ type: QuoteComparisonDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not the driver’s request' })
  get(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<QuoteComparisonDto> {
    return this.compare.get(actor, id);
  }
}
