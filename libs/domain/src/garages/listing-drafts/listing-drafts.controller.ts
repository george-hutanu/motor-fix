import {
  ContinueLinkSentDto,
  CreateListingDraftDto,
  ListingDraftCreatedDto,
  ListingDraftDto,
  ListingDraftSavedDto,
  SaveListingDraftDto,
} from '@motor-fix/contracts';
import {
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ListingDraftsService } from './listing-drafts.service';
import { ListingDraftThrottle } from './listing-drafts.throttle';
import { Public } from '../../auth/actor.guard';
import { JsonOnly } from '../../auth/auth.controller';

export const TOKEN = 'x-listing-token';
export const tokenHeader = ApiHeader({ name: TOKEN, required: true });

// No browser or proxy keeps a draft or its key.
@Injectable()
export class NoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

@ApiTags('listing-drafts')
@UseInterceptors(NoStore)
@Controller('listing-drafts')
export class ListingDraftsController {
  constructor(
    private readonly drafts: ListingDraftsService,
    @Inject(ListingDraftThrottle)
    private readonly throttle: ListingDraftThrottle,
  ) {}

  @Public()
  @Post()
  @UseGuards(JsonOnly)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ListingDraftCreatedDto })
  @ApiPayloadTooLargeResponse({
    description: 'draft_too_large, or payload_too_large past 320 KB',
  })
  @ApiTooManyRequestsResponse({ description: 'draft_rate_limited' })
  async create(
    @Req() req: Request,
    @Body() body: CreateListingDraftDto,
  ): Promise<ListingDraftCreatedDto> {
    const wait = await this.throttle.take(req.ip ?? '');
    if (wait !== null) {
      throw new HttpException(
        {
          code: 'draft_rate_limited',
          message: 'Too many drafts from here; try again later',
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.drafts.create(body);
  }

  @Public()
  @Get('current')
  @tokenHeader
  @ApiOkResponse({ type: ListingDraftDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  current(@Headers(TOKEN) token?: string): Promise<ListingDraftDto> {
    return this.drafts.current(token);
  }

  @Public()
  @Patch(':id')
  @UseGuards(JsonOnly)
  @tokenHeader
  @ApiOkResponse({ type: ListingDraftSavedDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  @ApiPayloadTooLargeResponse({
    description: 'draft_too_large, or payload_too_large past 320 KB',
  })
  save(
    @Param('id') id: string,
    @Body() body: SaveListingDraftDto,
    @Headers(TOKEN) token?: string,
  ): Promise<ListingDraftSavedDto> {
    return this.drafts.save(id, token, body);
  }

  @Public()
  @Post(':id/continue-link')
  @HttpCode(HttpStatus.ACCEPTED)
  @tokenHeader
  @ApiAcceptedResponse({ type: ContinueLinkSentDto })
  @ApiNotFoundResponse({ description: 'not_found' })
  @ApiConflictResponse({ description: 'draft_submitted' })
  @ApiTooManyRequestsResponse({ description: 'link_already_sent' })
  sendLink(
    @Param('id') id: string,
    @Headers(TOKEN) token?: string,
  ): Promise<ContinueLinkSentDto> {
    return this.drafts.sendLink(id, token);
  }
}
