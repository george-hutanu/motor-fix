import { AcceptanceDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AcceptanceService } from './acceptance.service';
import { CurrentActor, OpenToPending } from '../actor.guard';
import { JsonOnly } from '../auth.controller';
import type { Actor } from '../policy';

@ApiTags('me')
@Controller('me')
export class AcceptanceController {
  constructor(private readonly acceptance: AcceptanceService) {}

  @OpenToPending()
  @Post('acceptance')
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'The texts in force are accepted' })
  @ApiBadRequestResponse({
    description:
      'consent_required naming the versions in force, or a field the body got wrong',
  })
  accept(
    @CurrentActor() actor: Actor,
    @Body() body: AcceptanceDto,
  ): Promise<void> {
    return this.acceptance.accept(actor, body);
  }
}
