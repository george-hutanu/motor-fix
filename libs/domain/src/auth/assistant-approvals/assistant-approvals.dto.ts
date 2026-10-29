import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional } from 'class-validator';

const KINDS = ['book', 'move', 'cancel'] as const;
const STATUSES = [
  'pending',
  'approved',
  'refused',
  'expired',
  'failed',
] as const;

export type ApprovalKind = (typeof KINDS)[number];
export type ApprovalStatus = (typeof STATUSES)[number];

// What a decided approval ended with: the subject the run made, the code it
// failed or expired with.
export type ApprovalOutcome =
  | { subjectId: string; subjectType: string }
  | { code: string }
  | null;

export class AssistantActionOptionDto {
  @ApiProperty({ example: 'shareHistory' })
  key!: string;

  @ApiProperty()
  value!: boolean;
}

export class AssistantActionApprovalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'book_fixture' })
  tool!: string;

  @ApiProperty({ enum: KINDS })
  kind!: ApprovalKind;

  @ApiProperty({
    description: "The assistant client's name; null reads as your assistant",
    nullable: true,
    type: String,
  })
  assistantName!: string | null;

  @ApiProperty({ description: 'The sentence shown at the yes, verbatim' })
  summary!: string;

  @ApiProperty({ type: [AssistantActionOptionDto] })
  options!: AssistantActionOptionDto[];

  @ApiProperty({ enum: STATUSES })
  status!: ApprovalStatus;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  decidedAt!: Date | null;

  @ApiProperty({
    additionalProperties: { type: 'string' },
    description:
      'approved: { subjectType, subjectId }; failed or expired: { code }',
    nullable: true,
    type: 'object',
  })
  outcome!: ApprovalOutcome;
}

export class AssistantActionApprovalListDto {
  @ApiProperty({ description: 'How many approvals are pending' })
  pending!: number;

  @ApiProperty({
    description: 'The pending approvals, oldest first',
    type: [AssistantActionApprovalDto],
  })
  items!: AssistantActionApprovalDto[];
}

export class ApproveAssistantActionDto {
  @ApiPropertyOptional({
    additionalProperties: { type: 'boolean' },
    description: 'New values of the options the approval declares editable',
    type: 'object',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, boolean>;
}
