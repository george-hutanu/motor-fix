import { Module } from '@nestjs/common';

import { AssistantApprovalsController } from './approvals.controller';

// Needs AuthModule's global providers: the approvals, Prisma, the account
// loader and the maintenance switch.
@Module({ controllers: [AssistantApprovalsController] })
export class AssistantApprovalsModule {}
