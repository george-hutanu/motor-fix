import { ApiProperty } from '@nestjs/swagger';

import { FieldProblemDto } from './listing-check/listing-check.dto';

// The two ways a send is refused with 409.
export const LISTING_SUBMIT_CONFLICTS = [
  'draft_already_submitted',
  'garage_already_exists',
] as const;

const LISTING_SUBMITTED_STATUSES = ['submitted', 'approved'] as const;

export class ListingSubmittedDto {
  @ApiProperty({ format: 'uuid' })
  garageId!: string;

  @ApiProperty({ format: 'uuid' })
  fileId!: string;

  @ApiProperty({
    description: 'approved only where files are approved on arrival',
    enum: LISTING_SUBMITTED_STATUSES,
  })
  status!: (typeof LISTING_SUBMITTED_STATUSES)[number];

  @ApiProperty({
    description: 'Notes that did not stop the send',
    type: [FieldProblemDto],
  })
  warnings!: FieldProblemDto[];
}
