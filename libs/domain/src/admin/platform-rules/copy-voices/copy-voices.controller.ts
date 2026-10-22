import {
  ChangeCopyVoiceDto,
  CopyVoicesDto,
  PublicCopyVoicesDto,
} from '@motor-fix/contracts';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CopyVoicesService } from './copy-voices.service';
import {
  CurrentActor,
  OpenInMaintenance,
  Public,
  Requires,
} from '../../../auth/actor.guard';
import type { Actor } from '../../../auth/policy';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/copy-voices')
export class CopyVoicesController {
  constructor(private readonly voices: CopyVoicesService) {}

  @Get()
  @Requires('admin.settings')
  @ApiOkResponse({ type: CopyVoicesDto })
  @ApiNotFoundResponse({ description: 'not_found: not an admin' })
  list(@CurrentActor() actor: Actor): Promise<CopyVoicesDto> {
    return this.voices.list(actor);
  }

  @Patch(':voice')
  @Requires('admin.settings')
  @ApiOkResponse({ type: CopyVoicesDto })
  @ApiBadRequestResponse({ description: 'validation_failed' })
  @ApiNotFoundResponse({ description: 'not_found: not an admin, or no voice' })
  @ApiConflictResponse({ description: 'stale_value' })
  @ApiUnprocessableEntityResponse({
    description: 'last_voice, voice_off, voice_pinned',
  })
  change(
    @CurrentActor() actor: Actor,
    @Param('voice') voice: string,
    @Body() body: ChangeCopyVoiceDto,
  ): Promise<CopyVoicesDto> {
    return this.voices.change(actor, /^\d$/.test(voice) ? +voice : 0, body);
  }
}

// Every page reads it at start; a page that hears a change reads it again
// with `at`, a cache key the server ignores, so no cache answers it.
@ApiTags('platform')
@Controller('copy-voices')
@Public()
@OpenInMaintenance()
export class PublicCopyVoicesController {
  constructor(private readonly voices: CopyVoicesService) {}

  @Get()
  @Header('Cache-Control', 'max-age=60')
  @ApiQuery({ name: 'at', required: false, type: String })
  @ApiOkResponse({ type: PublicCopyVoicesDto })
  settings(@Query('at') _at?: string): Promise<PublicCopyVoicesDto> {
    return this.voices.settings();
  }
}
