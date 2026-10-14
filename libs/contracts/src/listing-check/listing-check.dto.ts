import { ApiProperty } from '@nestjs/swagger';

export class FieldProblemDto {
  @ApiProperty({ example: 'cui_in_use' })
  code!: string;

  @ApiProperty({
    description: 'The draft path of the value',
    example: 'steps.6.cui',
  })
  field!: string;
}

export class ListingCheckDto {
  @ApiProperty({
    description: 'Notes that do not stop the listing from being sent',
    type: [FieldProblemDto],
  })
  warnings!: FieldProblemDto[];
}
