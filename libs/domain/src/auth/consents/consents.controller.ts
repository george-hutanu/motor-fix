import {
  ConsentRecordedDto,
  MyConsentsDto,
  RecordConsentDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { ConsentsService } from './consents.service';
import { CurrentActor, Public } from '../actor.guard';
import { JsonOnly } from '../auth.controller';
import type { Actor } from '../policy';

const timeAhead = ApiBadRequestResponse({
  description: 'consent_time_ahead, or a field the body got wrong',
});
const rateLimited = ApiTooManyRequestsResponse({
  description: 'consent_rate_limited',
});

@ApiTags('consents')
@Controller()
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  // A visitor's choice; a session sent along changes nothing.
  @Public()
  @Post('consents')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ConsentRecordedDto })
  @timeAhead
  @rateLimited
  record(
    @Req() req: Request,
    @Body() body: RecordConsentDto,
  ): Promise<ConsentRecordedDto> {
    return this.consents.record(body, req.ip ?? '');
  }

  @Post('me/consents')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: ConsentRecordedDto })
  @timeAhead
  @rateLimited
  recordMine(
    @Req() req: Request,
    @Body() body: RecordConsentDto,
    @CurrentActor() actor: Actor,
  ): Promise<ConsentRecordedDto> {
    return this.consents.record(body, req.ip ?? '', actor);
  }

  @Get('me/consents')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MyConsentsDto })
  mine(@CurrentActor() actor: Actor): Promise<MyConsentsDto> {
    return this.consents.mine(actor.accountId);
  }
}
