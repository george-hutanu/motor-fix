import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export const PROFILE_VIEW_SOURCES = [
  'search',
  'map',
  'home',
  'shared_link',
  'saved',
  'profile_direct',
] as const;

export type ProfileViewSource = (typeof PROFILE_VIEW_SOURCES)[number];

export class ProfileViewDto {
  // Documented, never checked: a value outside the list counts as a direct
  // visit, so an old app or a stray value still counts the view.
  @ApiPropertyOptional({
    description: 'Where the visitor came from; anything else is profile_direct',
    enum: PROFILE_VIEW_SOURCES,
  })
  @Allow()
  source?: string;
}
