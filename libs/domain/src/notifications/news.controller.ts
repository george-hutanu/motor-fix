import { NewsSentDto, SendNewsDto } from '@motor-fix/contracts';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { NewsService } from './news.service';
import { CurrentActor, Public, Requires } from '../auth/actor.guard';
import type { Actor } from '../auth/policy';

@ApiTags('notifications')
@Controller()
export class NewsController {
  constructor(private readonly news: NewsService) {}

  // The page the e-mail's link opens and mail apps' one-click button both
  // post here; their form body is ignored.
  @Post('notification-preferences/unsubscribe')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'token', type: String })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'invalid_unsubscribe_link: the link is not one of ours',
  })
  unsubscribe(@Query('token') token?: string): Promise<void> {
    return this.news.unsubscribe(token);
  }

  @Post('admin/news')
  @ApiBearerAuth()
  @Requires('admin.settings')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: NewsSentDto })
  @ApiConflictResponse({
    description: 'news_already_sent_this_month: news went out this month',
  })
  send(
    @CurrentActor() actor: Actor,
    @Body() body: SendNewsDto,
  ): Promise<NewsSentDto> {
    return this.news.send(actor, body);
  }
}
