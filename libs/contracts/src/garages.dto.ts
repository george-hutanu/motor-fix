import { ApiProperty } from '@nestjs/swagger';

import { GarageBrandAnswerDto } from './garage-brands.dto';

// A garage as anyone may read it: only an approved one is ever returned.
export class PublicGarageDto extends GarageBrandAnswerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}
