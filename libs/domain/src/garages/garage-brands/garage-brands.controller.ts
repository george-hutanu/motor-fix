import {
  GarageBrandOwnerAnswerDto,
  ReplaceGarageBrandsDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
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

  @Put()
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary: "Replace the garage's brand answer: taken, refused, the texts",
  })
  @ApiOkResponse({ type: GarageBrandOwnerAnswerDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad or unknown brand, a text too long, a job not on the price list (job_not_priced), jobs on a refused brand (jobs_on_refused)',
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
