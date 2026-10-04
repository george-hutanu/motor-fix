import { createHash, timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import type { EmailConfig } from './email-config';
import {
  NOTIFICATIONS_CONFIG,
  NotificationsService,
} from './notifications.service';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Brevo's transactional webhook; Brevo sends the configured bearer token.
@ApiExcludeController()
@Controller('webhooks/brevo')
export class BrevoWebhookController {
  constructor(
    private readonly notifications: NotificationsService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: EmailConfig,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async receive(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const secret = this.config.webhookSecret;
    const given = authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!secret || !given || !timingSafeEqual(digest(given), digest(secret))) {
      throw new HttpException(
        { code: 'sign_in_required', message: 'Unknown webhook caller' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const messageId = body?.['message-id'];
    if (body?.['event'] === 'hard_bounce' && typeof messageId === 'string') {
      await this.notifications.recordBounce(messageId);
    }
  }
}
