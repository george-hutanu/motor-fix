import { ApiProperty } from '@nestjs/swagger';

export class VerificationPresenceEntryDto {
  @ApiProperty({ description: 'First name and the initial of the last' })
  name!: string;

  @ApiProperty({
    description: 'When this admin opened the file',
    format: 'date-time',
  })
  since!: string;
}

export class VerificationPresenceDto {
  @ApiProperty({
    description:
      'The other admins with the file open, never the caller, the earliest first',
    type: [VerificationPresenceEntryDto],
  })
  others!: VerificationPresenceEntryDto[];
}
