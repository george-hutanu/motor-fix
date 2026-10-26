import {
  CarSaleDto,
  CarTransferLinkDto,
  CarTransferSentDto,
  CreateCarTransferDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CarTransfersService } from './transfers.service';
import { CurrentActor, Public, Requires } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';

@ApiTags('cars')
@ApiBearerAuth()
@Controller('cars')
export class CarSaleController {
  constructor(private readonly transfers: CarTransfersService) {}

  @Get(':id/sale')
  @Requires('driver.cars')
  @ApiOperation({
    summary:
      "What selling the caller's car starts from: its repairs and the transfer already sent",
  })
  @ApiOkResponse({ type: CarSaleDto })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: no such car of the caller, or not a driver',
  })
  sale(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CarSaleDto> {
    return this.transfers.sale(actor, id);
  }

  @Post(':id/transfers')
  @Requires('driver.cars')
  @UseGuards(JsonOnly)
  @ApiOperation({
    summary:
      'Send the buyer a link to take the car and the ticked repairs; replaces a transfer already sent',
  })
  @ApiCreatedResponse({ type: CarTransferSentDto })
  @ApiBadRequestResponse({
    description:
      'validation_failed: a bad field or id; invalid_phone; own_phone: the seller’s own number; repair_not_tickable: a tick on a repair that is not the car’s own active logged one',
  })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description: 'not_found: no such car of the caller, or not a driver',
  })
  @ApiConflictResponse({
    description: 'open_request: a request for the car is under way',
  })
  send(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CreateCarTransferDto,
  ): Promise<CarTransferSentDto> {
    return this.transfers.send(actor, id, body);
  }

  @Post(':id/transfers/:transferId/cancel')
  @Requires('driver.cars')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel the transfer sent; its link stops working' })
  @ApiNoContentResponse({ description: 'The transfer is cancelled' })
  @ApiBadRequestResponse({ description: 'validation_failed: a bad id' })
  @ApiUnauthorizedResponse({ description: 'sign_in_required' })
  @ApiNotFoundResponse({
    description:
      'not_found: no such car of the caller, no such transfer of the car, or not a driver',
  })
  @ApiConflictResponse({ description: 'not_sent: the transfer is not sent' })
  cancel(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
  ): Promise<void> {
    return this.transfers.cancel(actor, id, transferId);
  }
}

@ApiTags('cars')
@Public()
@Controller('car-transfers')
export class CarTransferLinkController {
  constructor(private readonly transfers: CarTransfersService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Whether a transfer link still works; nothing about the car',
  })
  @ApiOkResponse({ type: CarTransferLinkDto })
  @ApiNotFoundResponse({ description: 'not_found: no such link' })
  @ApiGoneResponse({
    description:
      'transfer_expired, transfer_cancelled or transfer_accepted: the link no longer works',
  })
  read(@Param('token') token: string): Promise<CarTransferLinkDto> {
    return this.transfers.read(token);
  }
}
