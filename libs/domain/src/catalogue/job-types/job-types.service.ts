import type { JobTypeListDto } from '@motor-fix/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { fold } from '../brands';

const PAGE = 20;
const byRomanianName = new Intl.Collator('ro');

// The catalogue holds tens of jobs, so one read and a filter in memory.
@Injectable()
export class JobTypesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async search(q = ''): Promise<JobTypeListDto> {
    const wanted = fold(q.trim());
    const approved = await this.prisma.jobType.findMany({
      select: { id: true, key: true, nameEn: true, nameRo: true },
      where: { status: 'approved' },
    });
    const items = approved
      .filter(
        (job) =>
          fold(job.nameRo).includes(wanted) ||
          fold(job.nameEn).includes(wanted),
      )
      .sort((a, b) => byRomanianName.compare(a.nameRo, b.nameRo))
      .slice(0, PAGE);
    return { items };
  }
}
