import {
  GarageBrandOwnerAnswerDto,
  GarageBrandOwnerReadDto,
  ReplaceGarageBrandsDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { GarageBrandsService } from './garage-brands.service';
import { CurrentActor } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/brands')
export class GarageBrandsController {
  constructor(private readonly brands: GarageBrandsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The garage's brand answer for its owner, with the price list's jobs",
  })
  @ApiOkResponse({ type: GarageBrandOwnerReadDto })
  @ApiBadRequestResponse({ description: 'validation_failed: not a uuid' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiGoneResponse({ description: 'gone: the garage is suspended' })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
  ): Promise<GarageBrandOwnerReadDto> {
    return this.brands.read(actor, garageId);
  }

  @Put()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary: "Replace the garage's brand answer: taken, refused, the texts",
  })
  @ApiOkResponse({ type: GarageBrandOwnerAnswerDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad or unknown brand, more than 200 brands, a text too long, a taken brand with no fuel (fuels_empty), a job not on the price list (job_not_priced), jobs on a refused brand (jobs_on_refused)',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found' })
  replace(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Body() body: ReplaceGarageBrandsDto,
  ): Promise<GarageBrandOwnerAnswerDto> {
    return this.brands.replace(actor, garageId, body);
  }
}
