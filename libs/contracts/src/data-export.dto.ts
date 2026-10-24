import { ApiProperty } from '@nestjs/swagger';

export const DATA_EXPORT_STATUSES = [
  'queued',
  'ready',
  'expired',
  'failed',
] as const;

export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

// The newest copy of their data a person asked for, and when they may ask
// again: the server's word, so the screen never recomputes the wait.
export class DataExportDto {
  @ApiProperty({ enum: DATA_EXPORT_STATUSES })
  status!: DataExportStatus;

  @ApiProperty({ format: 'date-time', type: String })
  requestedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  readyAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  expiresAt!: string | null;

  @ApiProperty({
    description: 'When a new request is allowed; null when it is now',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  canRequestAt!: string | null;
}
