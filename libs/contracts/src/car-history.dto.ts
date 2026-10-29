import { ApiProperty } from '@nestjs/swagger';

export class CarRepairDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  doneOn!: string;

  @ApiProperty({ description: 'What was done' })
  what!: string;

  @ApiProperty()
  garageName!: string;

  @ApiProperty({ enum: ['motorfix', 'logged'] })
  source!: 'motorfix' | 'logged';

  @ApiProperty({
    description: 'Created before the reader held the car: it came with it',
  })
  fromPreviousOwner!: boolean;
}

export class CarRepairListDto {
  @ApiProperty({ description: 'Newest first', type: [CarRepairDto] })
  items!: CarRepairDto[];
}

export class SoldCarDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  brandName!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  year!: number;

  @ApiProperty({ format: 'date' })
  saleDate!: string;
}

export class SoldCarListDto {
  @ApiProperty({ description: 'Newest sale first', type: [SoldCarDto] })
  items!: SoldCarDto[];
}
