import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

import { PriceAddDto } from './price-list.dto';
import { JOB_NAME_MAX } from './price-range';

// A name the owner proposes alone is at least three characters, a word the
// admins can judge; the listing's proposals keep their own two.
const PROPOSED_JOB_NAME_MIN = 3;

// A job the catalogue lacks, proposed by the owner with its default range;
// the range is left to the one range check, as an add's is.
export class CatalogueJobProposalDto extends OmitType(PriceAddDto, [
  'jobTypeId',
] as const) {
  @ApiProperty({
    example: 'Recondiționare injectoare',
    maxLength: JOB_NAME_MAX,
    minLength: PROPOSED_JOB_NAME_MIN,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(PROPOSED_JOB_NAME_MIN, JOB_NAME_MAX)
  @Matches(/^\P{Cc}*$/u, { message: 'name must not hold control characters' })
  name!: string;
}
