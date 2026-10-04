import { ApiProperty } from '@nestjs/swagger';

const ROLE = ['driver', 'garage', 'receptionist', 'mechanic', 'admin'] as const;
type Role = (typeof ROLE)[number];

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ enum: ['ro', 'en'] })
  language!: 'ro' | 'en';

  @ApiProperty({ enum: ROLE, isArray: true })
  roles!: Role[];

  @ApiProperty({ description: 'The role in use', enum: ROLE })
  role!: Role;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  garageId!: string | null;

  @ApiProperty({
    description: 'What the role in use may do',
    isArray: true,
    type: String,
  })
  capabilities!: string[];

  @ApiProperty({ enum: ['/app/driver', '/app/garage', '/app/admin'] })
  landing!: '/app/driver' | '/app/garage' | '/app/admin';
}
