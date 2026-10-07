import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class BrandsQueryDto {
  @ApiPropertyOptional({
    description: 'Part of a brand name; accents and case are ignored',
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({
    description: 'The nextCursor of the previous page',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class BrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Škoda' })
  name!: string;

  @ApiProperty({ example: 'skoda' })
  slug!: string;

  @ApiProperty({
    description: '1 is the most popular; null is unranked',
    nullable: true,
    type: 'integer',
  })
  popularity!: number | null;
}

export class BrandPageDto {
  @ApiProperty({
    description: 'By popularity, unranked last, then by name; 20 at most',
    type: [BrandDto],
  })
  items!: BrandDto[];

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Brands matching the search' })
  total!: number;
}
