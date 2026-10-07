import { CarDto, CarListDto, CreateCarDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CarsService } from './cars.service';
import { CurrentActor, Requires } from '../auth/actor.guard';
import { JsonOnly } from '../auth/auth.controller';
import type { Actor } from '../auth/policy';
import { refusal } from '../auth/sign-up.service';

const KEY = 'Idempotency-Key';

@ApiTags('cars')
@ApiBearerAuth()
@Controller('cars')
export class CarsController {
  constructor(private readonly cars: CarsService) {}

  @Post()
  @UseGuards(JsonOnly)
  @ApiOperation({ summary: "Add a car to the caller's account" })
  @ApiHeader({
    description:
      'One per save the person means; a repeat answers the first car',
    name: KEY,
    required: true,
  })
  @ApiCreatedResponse({ type: CarDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad field, unknown_brand, too_far_ahead or a missing key',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: this account adds no car' })
  @ApiConflictResponse({ description: 'car_limit: 20 cars already' })
  create(
    @CurrentActor() actor: Actor,
    @Headers(KEY) key: string | undefined,
    @Body() body: CreateCarDto,
  ): Promise<CarDto> {
    if (!key || key.length > 64) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'Idempotency-Key must hold 1 to 64 characters',
        [{ code: 'required', field: 'idempotency-key' }],
      );
    }
    return this.cars.create(actor, key, body);
  }

  @Get()
  @Requires('driver.cars')
  @ApiOperation({ summary: "The caller's cars, newest first" })
  @ApiOkResponse({ type: CarListDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({ description: 'not_found: not a driver' })
  list(@CurrentActor() actor: Actor): Promise<CarListDto> {
    return this.cars.list(actor);
  }
}
