import { ApiProperty } from '@nestjs/swagger';

export const VERIFICATION_STAGE_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'more_requested',
  'rejected',
  'approved',
] as const;
export type VerificationStageStatus =
  (typeof VERIFICATION_STAGE_STATUSES)[number];

export class VerificationRejectionDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  note!: string;
}

export class VerificationStatusDto {
  @ApiProperty({
    description: 'A suspended garage reads approved',
    enum: VERIFICATION_STAGE_STATUSES,
  })
  status!: VerificationStageStatus;

  @ApiProperty({
    description: 'The latest sending; null for a draft',
    format: 'date-time',
    nullable: true,
    type: String,
  })
  submittedAt!: string | null;

  @ApiProperty({
    description: 'What a request for more asks for; empty otherwise',
    type: [String],
  })
  requestedItems!: string[];

  @ApiProperty({
    description: 'Only for a rejection',
    nullable: true,
    type: VerificationRejectionDto,
  })
  reason!: VerificationRejectionDto | null;
}
