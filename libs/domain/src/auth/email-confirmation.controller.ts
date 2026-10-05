import { ConfirmEmailAnswerDto, ConfirmEmailDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentActor, Public } from './actor.guard';
import { JsonOnly } from './auth.controller';
import { EmailConfirmationService } from './email-confirmation.service';
import type { Actor } from './policy';

@ApiTags('auth')
@Controller('auth/confirm-email')
export class EmailConfirmationController {
  constructor(private readonly confirmations: EmailConfirmationService) {}

  @Public()
  @UseGuards(JsonOnly)
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ConfirmEmailAnswerDto })
  async confirm(@Body() body: ConfirmEmailDto): Promise<ConfirmEmailAnswerDto> {
    await this.confirmations.confirm(body.token);
    return { status: 'confirmed' };
  }

  @Public()
  @UseGuards(JsonOnly)
  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'A new link was sent' })
  async resend(@Body() body: ConfirmEmailDto): Promise<void> {
    await this.confirmations.askAgainByToken(body.token);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me/email-confirmation')
export class MeEmailConfirmationController {
  constructor(private readonly confirmations: EmailConfirmationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'A new link was sent' })
  async askAgain(@CurrentActor() actor: Actor): Promise<void> {
    await this.confirmations.askAgainFor(actor.accountId);
  }
}
