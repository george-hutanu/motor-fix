import {
  CatalogueJobProposalDto,
  PriceRangeSavedDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { PriceListService } from './price-list.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/catalogue-jobs')
export class CatalogueJobsController {
  constructor(private readonly priceList: PriceListService) {}

  @Post()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Proposes a job the catalogue lacks and adds it to the end of the price list with its default range, waiting for approval',
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiCreatedResponse({ type: PriceRangeSavedDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: not a uuid, a name under 3 or over 80 characters, or an unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  @ApiUnprocessableEntityResponse({
    description:
      "validation_failed: the range; on name, duplicate (this garage's proposal still waiting), exists (an approved job's name; the entry carries its jobTypeId) or too_many (a fifty-first job)",
  })
  propose(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: CatalogueJobProposalDto,
  ): Promise<PriceRangeSavedDto> {
    return this.priceList.propose(actor, garageId, body);
  }
}
