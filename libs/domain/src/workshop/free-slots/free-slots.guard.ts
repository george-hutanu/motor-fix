import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

import { FreeSlotsService } from './free-slots.service';
import { notFound } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';

// FR-002: who may ask is decided before anything else, the query's
// validation included: guards run before the pipes, so an outsider with a
// bad query is told 404, never 400.
@Injectable()
export class FreeSlotsGuard implements CanActivate {
  constructor(private readonly slots: FreeSlotsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ actor: Actor; params: { garageId?: string } }>();
    const garageId = request.params.garageId ?? '';
    if (!isUUID(garageId)) throw notFound();
    await this.slots.access(request.actor, garageId.toLowerCase());
    return true;
  }
}
