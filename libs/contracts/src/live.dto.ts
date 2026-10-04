import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LiveTestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;
}

export const LIVE_BYE_REASONS = ['expired', 'evicted', 'shutdown'] as const;
export type LiveByeReason = (typeof LIVE_BYE_REASONS)[number];

// One message on the live stream. It names what changed, never the change:
// the screen reads the object from the API. No personal data travels here.
export interface LiveMessage {
  kind: string;
  id: string;
  at: string;
  reason?: LiveByeReason;
}
