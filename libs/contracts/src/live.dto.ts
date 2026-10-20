import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class LiveTestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;
}

export type LiveByeReason = 'expired' | 'evicted' | 'shutdown';

// Why a stream ended on the server's side: a bye, or the planned reconnect
// before the platform's 15-minute limit.
export type LiveCloseReason = LiveByeReason | 'reconnect';

// One message on the live stream. It names what changed, never the change:
// the screen reads the object from the API. No personal data travels here.
export interface LiveMessage {
  kind: string;
  id: string;
  at: string;
  reason?: LiveByeReason;
  // The account's unread in-app count, on notification.created and .read.
  unreadCount?: number;
}
