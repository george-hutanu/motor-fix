import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

// What a public page shows: one garage, one mechanic and one brand at most. A
// repeated key arrives as a list, which IsUUID refuses.
export class PublicLiveQueryDto {
  @ApiPropertyOptional({
    description: 'The garage a profile shows',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
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
