import { LabourRangeDto, LabourRangeSavedDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';

import { CurrentActor } from '../../../auth/actor.guard';
import { JsonOnly } from '../../../auth/auth.controller';
import type { Actor } from '../../../auth/policy';
import { PriceListService } from '../price-list.service';

// The garage's labour rate: a route of its own, written by the price list.
@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/labour')
export class GarageLabourController {
  constructor(private readonly priceList: PriceListService) {}

  @Patch()
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: "Changes the garage's labour rate, both ends set" })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiOkResponse({ type: LabourRangeSavedDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: not a uuid, or an unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  @ApiUnprocessableEntityResponse({
    description: 'validation_failed: the range, a missing end included',
  })
  set(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: LabourRangeDto,
  ): Promise<LabourRangeSavedDto> {
    return this.priceList.setLabour(actor, garageId, body);
  }
}
