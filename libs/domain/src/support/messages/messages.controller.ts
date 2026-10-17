import { randomInt } from 'node:crypto';

import {
  CreateSupportMessageDto,
  SupportMessageCreatedDto,
  supportReference,
} from '@motor-fix/contracts';
import {
  BadRequestException,
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { catchError, type Observable, throwError } from 'rxjs';

import { SupportMessagesService } from './messages.service';
import { SupportThrottleGuard } from './throttle';
import { CurrentActor, OptionalActor, Public } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';
import type { Actor } from '../../auth/policy';
import { localDay } from '../../bucharest';
import { countSupportMessage } from '../../metrics/product-counters';

// Counts a body the validation refused; the pipe runs inside the handler's
// call, after the guards, so its 400 passes through here.
@Injectable()
class CountInvalid implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof BadRequestException) {
          countSupportMessage('invalid');
        }
        return throwError(() => error);
      }),
    );
  }
}

@ApiTags('support')
@Controller('support/messages')
export class SupportMessagesController {
  constructor(
    @Inject(SupportMessagesService)
    private readonly messages: SupportMessagesService,
  ) {}

  // Open to visitors; a signed-in sender's account and role come from the
  // session, never the body.
  @Public()
  @OptionalActor()
  @Post()
  @UseGuards(JsonOnly, SupportThrottleGuard)
  @UseInterceptors(CountInvalid)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SupportMessageCreatedDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiTooManyRequestsResponse({ description: 'too_many_messages' })
  @ApiServiceUnavailableResponse({ description: 'maintenance' })
  async create(
    @Body() body: CreateSupportMessageDto,
    @CurrentActor() actor?: Actor,
  ): Promise<SupportMessageCreatedDto> {
    // A filled trap field is a bot: it gets what a person would, and
    // nothing is stored or sent.
    if (body.website) {
      countSupportMessage('trap');
      const year = Number(localDay(new Date()).slice(0, 4));
      return { reference: supportReference(year, randomInt(1, 1_000_000)) };
    }
    const { reference } = await this.messages.create(actor, body);
    countSupportMessage('stored');
    return { reference };
  }
}
