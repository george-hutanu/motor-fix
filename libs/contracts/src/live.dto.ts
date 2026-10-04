import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LiveTestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;
}

export type LiveByeReason = 'expired' | 'evicted' | 'shutdown';

// One message on the live stream. It names what changed, never the change:
// the screen reads the object from the API. No personal data travels here.
export interface LiveMessage {
  kind: string;
  id: string;
  at: string;
  reason?: LiveByeReason;
}
