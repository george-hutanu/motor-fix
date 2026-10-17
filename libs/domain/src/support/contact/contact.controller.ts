import { SupportContactDto } from '@motor-fix/contracts';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { OpenInMaintenance, Public } from '../../auth/actor.guard';
import { SUPPORT_CONFIG, type SupportConfig } from '../support-config';

// The support address for the contact page, the task and the maintenance
// page, which is why it answers in maintenance too.
@ApiTags('support')
@Controller('support/contact')
export class SupportContactController {
  constructor(@Inject(SUPPORT_CONFIG) private readonly config: SupportConfig) {}

  @Public()
  @OpenInMaintenance()
  @Get()
  @ApiOkResponse({ type: SupportContactDto })
  contact(): SupportContactDto {
    return { email: this.config.email ?? null };
  }
}
