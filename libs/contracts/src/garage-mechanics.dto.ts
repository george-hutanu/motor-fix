import { ApiProperty } from '@nestjs/swagger';

export class GarageMechanicDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  speciality!: string | null;

  @ApiProperty()
  onProfile!: boolean;

  @ApiProperty()
  hasAccount!: boolean;

  // One decimal ("4.9"); null exactly when no review counts.
  @ApiProperty({ example: '4.9', nullable: true, type: String })
  rating!: string | null;

  @ApiProperty()
  reviewCount!: number;
}

export class GarageMechanicsDto {
  @ApiProperty({ type: [GarageMechanicDto] })
  items!: GarageMechanicDto[];
}
