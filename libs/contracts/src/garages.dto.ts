import { ApiProperty } from '@nestjs/swagger';

// A garage as anyone may read it: only an approved one is ever returned.
export class PublicGarageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}
