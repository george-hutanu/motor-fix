import { CarRepairDto, LogRepairDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { LogRepairService } from './log-repair.service';
import { CurrentActor, Requires } from '../../auth/actor.guard';
import type { Actor } from '../../auth/policy';

@ApiTags('cars')
@ApiBearerAuth()
@Controller('cars')
export class LogRepairController {
  constructor(private readonly repairs: LogRepairService) {}

  @Post(':id/repairs')
  @Requires('driver.cars')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Log a repair done at any garage on one of the caller’s cars',
  })
  @ApiCreatedResponse({ type: CarRepairDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad field, an unknown field or id, or unknown_garage: the garage is not approved',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: not a car the caller owns now, or removed',
  })
  @ApiUnprocessableEntityResponse({
    description: 'date_before_car_year: the day is before the car’s year',
  })
  @ApiConflictResponse({
    description:
      'check_needed: a day after today or a reading below an earlier one; resend with confirm true',
  })
  log(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: LogRepairDto,
  ): Promise<CarRepairDto> {
    return this.repairs.log(actor, id, body);
  }
}
