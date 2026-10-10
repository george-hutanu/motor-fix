import { MeDto, UpdateMeDto } from '@motor-fix/contracts';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AccountsService } from './accounts.service';
import { CurrentActor } from './actor.guard';
import type { Actor } from './policy';
import { WhoAmI } from './who-am-i';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly view: WhoAmI,
  ) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentActor() actor: Actor): Promise<MeDto> {
    return this.view.read(actor);
  }

  @Patch()
  @ApiOkResponse({ type: MeDto })
  async update(
    @CurrentActor() actor: Actor,
    @Body() body: UpdateMeDto,
  ): Promise<MeDto> {
    await this.accounts.updateMe(actor, body);
    return this.me(actor);
  }
}
