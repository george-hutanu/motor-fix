import { ApiProperty } from '@nestjs/swagger';

// The days an overdue garage keeps its place on the map after its due date.
export const DOCUMENT_GRACE_DAYS = 14;

export const DOCUMENT_CYCLE_STATES = ['due', 'overdue'] as const;
export type DocumentCycleState = (typeof DOCUMENT_CYCLE_STATES)[number];

// When a garage owes its yearly documents again, and where it stands.
export class DocumentCycleDto {
  @ApiProperty({
    description: 'The Europe/Bucharest day both documents are due',
    example: '2027-01-15',
    format: 'date',
  })
  dueOn!: string;

  @ApiProperty({ enum: DOCUMENT_CYCLE_STATES })
  state!: DocumentCycleState;

  @ApiProperty({
    description: 'The last day of the grace; set once the cycle is overdue',
    example: '2027-01-29',
    format: 'date',
    nullable: true,
    type: String,
  })
  graceUntil!: string | null;

  @ApiProperty({ description: 'Whether a yearly upload waits for an admin' })
  inReview!: boolean;
}
