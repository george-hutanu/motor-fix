import { ApiProperty } from '@nestjs/swagger';

import { GaragePermissionsDto } from './me.dto';

const MEMBER_ROLES = ['owner', 'receptionist', 'mechanic'] as const;
const INVITE_KINDS = ['mechanic', 'receptionist'] as const;

// One person with an account at the garage: no e-mail, only who they are to it.
export class GarageMemberDto {
  @ApiProperty({ format: 'uuid' })
  accountId!: string;

  // The account's name; a mechanic's, the name on their card.
  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: MEMBER_ROLES })
  role!: (typeof MEMBER_ROLES)[number];

  // When the membership began; null for a mechanic, whose acceptance time is
  // not stored.
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  since!: string | null;

  // A mechanic's three permissions; null for the owner and a receptionist.
  @ApiProperty({ nullable: true, type: GaragePermissionsDto })
  permissions!: GaragePermissionsDto | null;
}

// An invite sent and not yet accepted, revoked or past its expiry.
export class GarageMemberInviteDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: INVITE_KINDS })
  kind!: (typeof INVITE_KINDS)[number];

  // The address the owner typed: an e-mail or, for a mechanic, a phone.
  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ format: 'date-time' })
  sentAt!: string;
}

// Who has access to the garage: its members, owner first, then the open invites.
export class GarageMembersDto {
  @ApiProperty({ type: [GarageMemberDto] })
  members!: GarageMemberDto[];

  @ApiProperty({ type: [GarageMemberInviteDto] })
  invites!: GarageMemberInviteDto[];
}
