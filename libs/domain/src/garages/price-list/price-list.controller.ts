import {
  BrandRangeDto,
  BrandRangeSavedDto,
  PriceListDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
@Controller('garages/:garageId/prices')
export class PriceListController {
  constructor(private readonly priceList: PriceListService) {}

  @Get()
  @ApiOperation({
    summary:
      "The garage's price list: each job, whether drivers see it and, when not, why",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiOkResponse({ type: PriceListDto })
  @ApiBadRequestResponse({ description: 'validation_failed: not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<PriceListDto> {
    return this.priceList.read(actor, garageId);
  }

  @Put(':jobTypeId/brands/:brandId')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      "Sets a job's own range for a brand the garage takes, creating it or changing it in place",
  })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiParam({ format: 'uuid', name: 'jobTypeId', type: String })
  @ApiParam({ format: 'uuid', name: 'brandId', type: String })
  @ApiOkResponse({ type: BrandRangeSavedDto })
  @ApiBadRequestResponse({
    description: 'validation_failed: not a uuid, or an unknown field',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiUnsupportedMediaTypeResponse({ description: 'unsupported_media_type' })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: the range, an unknown or untaken brand, a job not on the list or without a default range, or a duplicate',
  })
  setBrandRange(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('jobTypeId', new ParseUUIDPipe()) jobTypeId: string,
    @Param('brandId', new ParseUUIDPipe()) brandId: string,
    @Body() body: BrandRangeDto,
  ): Promise<BrandRangeSavedDto> {
    return this.priceList.setBrandRange(
      actor,
      { brandId, garageId, jobTypeId },
      body,
    );
  }

  @Delete(':jobTypeId/brands/:brandId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Removes a job's own range for a brand" })
  @ApiParam({ format: 'uuid', name: 'garageId', type: String })
  @ApiParam({ format: 'uuid', name: 'jobTypeId', type: String })
  @ApiParam({ format: 'uuid', name: 'brandId', type: String })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ description: 'validation_failed: not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({
    description: 'not_found: no such garage, or no range for the brand',
  })
  removeBrandRange(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('jobTypeId', new ParseUUIDPipe()) jobTypeId: string,
    @Param('brandId', new ParseUUIDPipe()) brandId: string,
  ): Promise<void> {
    return this.priceList.removeBrandRange(actor, {
      brandId,
      garageId,
      jobTypeId,
    });
  }
}
