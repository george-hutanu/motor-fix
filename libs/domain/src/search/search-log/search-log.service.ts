import type { SearchPoint } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { geohash5 } from './geohash';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { recordSearchLog } from '../garage-search/garage-search.metrics';

// One row per new search for the Demand view: the brand and the 5-character
// cell of the (already rounded) place, never the account or the point. The
// search does not wait for it, and a failed write is logged and counted,
// never thrown.
@Injectable()
export class SearchLogService {
  private readonly logger = new Logger('SearchLog');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record({ brandId, point }: { brandId: string; point?: SearchPoint }) {
    try {
      await this.prisma.searchLog.create({
        data: { areaCell: point ? geohash5(point) : null, brandId },
        select: { id: true },
      });
      recordSearchLog('written');
    } catch (error) {
      recordSearchLog('failed');
      this.logger.warn(`search log not written: ${(error as Error).message}`);
    }
  }
}
