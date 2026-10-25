import {
  AddMechanicDayOffDto,
  DaysOffBookingsRefusalDto,
  MechanicScheduleDto,
  UpdateMechanicHoursDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { MechanicScheduleService } from './schedule.service';
import { CurrentActor } from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import type { PrismaClient } from '../../../generated/prisma/client';

@ApiTags('garages')
@ApiBearerAuth()
@Controller('garages/:garageId/mechanics/:mechanicId')
export class MechanicScheduleController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly schedule: MechanicScheduleService,
  ) {}

  @Get('hours')
  @ApiOperation({
    summary: "A mechanic's working week and upcoming days off, for the owner",
  })
  @ApiOkResponse({ type: MechanicScheduleDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  read(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('mechanicId', new ParseUUIDPipe()) mechanicId: string,
  ): Promise<MechanicScheduleDto> {
    return this.schedule.read(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      mechanicId.toLowerCase(),
    );
  }

  @Put('hours')
  @ApiOperation({ summary: "Save a mechanic's working week, for the owner" })
  @ApiOkResponse({ type: MechanicScheduleDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: workingHours.<day> invalid, grid, order, count or outside_opening; worksSaturdays invalid or garage_closed_saturday',
  })
  write(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('mechanicId', new ParseUUIDPipe()) mechanicId: string,
    @Body() body: UpdateMechanicHoursDto,
  ): Promise<MechanicScheduleDto> {
    return this.schedule.write(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      mechanicId.toLowerCase(),
      body,
    );
  }

  @Post('days-off')
  @ApiOperation({ summary: 'Add a day or a range off, for the owner' })
  @ApiCreatedResponse({ type: MechanicScheduleDto })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiConflictResponse({
    description:
      'day_off_overlap; bookings_on_days_off, naming the confirmed bookings, until sent with acknowledgeBookings',
    type: DaysOffBookingsRefusalDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'validation_failed: firstDay invalid or past; lastDay invalid, order or too_far; note invalid or too_long',
  })
  addDayOff(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('mechanicId', new ParseUUIDPipe()) mechanicId: string,
    @Body() body: AddMechanicDayOffDto,
  ): Promise<MechanicScheduleDto> {
    return this.schedule.addDayOff(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      mechanicId.toLowerCase(),
      body,
    );
  }

  @Delete('days-off/:dayOffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a day off, or end a running one yesterday, for the owner',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiForbiddenResponse({ description: 'forbidden: staff of this garage' })
  @ApiNotFoundResponse({ description: 'not_found; feature_off' })
  @ApiConflictResponse({ description: 'past_day_off: it already ended' })
  removeDayOff(
    @CurrentActor() actor: Actor,
    @Param('garageId', new ParseUUIDPipe()) garageId: string,
    @Param('mechanicId', new ParseUUIDPipe()) mechanicId: string,
    @Param('dayOffId', new ParseUUIDPipe()) dayOffId: string,
  ): Promise<void> {
    return this.schedule.removeDayOff(
      this.prisma,
      actor,
      garageId.toLowerCase(),
      mechanicId.toLowerCase(),
      dayOffId.toLowerCase(),
    );
  }
}
