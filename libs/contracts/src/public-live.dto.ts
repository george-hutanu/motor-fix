import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

import { IsGarageIdList } from './garage-search.dto';
import { SEARCH_IDS_MAX } from './search-place';

// What a public page shows: the garages of a profile or of one page of
// results, one mechanic and one brand at most. A repeated key arrives as a
// list, which the validators refuse.
export class PublicLiveQueryDto {
  @ApiPropertyOptional({
    description: `The garage a profile shows, or up to ${SEARCH_IDS_MAX} garages a page of results shows, comma-separated`,
    example: '9f1c2a7b-0000-4000-8000-000000000001',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsGarageIdList('garages')
  garages?: string;

  @ApiPropertyOptional({
    description: 'The mechanic a profile shows',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  mechanics?: string;

  @ApiPropertyOptional({
    description: 'The brand whose search results are shown',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  brand?: string;
}
