import { fuelColumns, isBrandsSection } from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

import type { AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/sign-up.service';
import type { Prisma } from '../../generated/prisma/client';

// Every brand id must be one the catalogue holds, a retired one included: a
// made-up one is a 400, not a foreign-key failure.
export async function assertCatalogued(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  const known = await tx.brand.count({ where: { id: { in: ids } } });
  if (known === ids.length) return;
  throw refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    'A brand is not in the catalogue',
    [{ code: 'unknown_brand', field: 'brands' }],
  );
}

// A job of the garage's price list; `name` is the proposed name a step-3
// entry without a catalogue id carried, so an unticked name can be matched.
export type GarageJobRef = { jobTypeId: string; name?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The job type ids a taken brand's unticked refs name: a uuid by its id, any
// other ref by a proposed job's name.
function untickedIds(refs: string[], jobs: GarageJobRef[], at: number) {
  return refs.map((ref) => {
    const job = UUID.test(ref)
      ? jobs.find((j) => j.jobTypeId.toLowerCase() === ref.toLowerCase())
      : jobs.find((j) => j.name === ref);
    if (job) return job.jobTypeId.toLowerCase();
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'An unticked job is not on the price list',
      [{ code: 'unknown_job', field: `brands[${at}].unticked` }],
    );
  });
}

// Writes a garage's brands, their fuels, the jobs each taken brand does and
// the two texts from the listing's step 2 section, inside the caller's
// transaction. The caller records the event; this writes rows and their
// audit entries. With no jobs (no price list yet) a brand gets no job row.
export async function writeGarageBrands(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: unknown,
  {
    actorId,
    audit,
    jobs,
  }: { actorId: string; audit: AuditPort; jobs: GarageJobRef[] },
): Promise<void> {
  if (!isBrandsSection(section) || section.brands === undefined) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The brands, their fuels or the texts break a rule',
    );
  }
  const listed = [...new Set(jobs.map((j) => j.jobTypeId.toLowerCase()))];
  const rows = section.brands.flatMap(({ brandId, stance, unticked }, at) => {
    if (stance !== 'works_on' || listed.length === 0) return [];
    const off = new Set(untickedIds(unticked ?? [], jobs, at));
    return listed
      .filter((jobTypeId) => !off.has(jobTypeId))
      .map((jobTypeId) => ({
        brandId: brandId.toLowerCase(),
        garageId,
        jobTypeId,
      }));
  });
  await assertCatalogued(
    tx,
    section.brands.map((brand) => brand.brandId),
  );
  await tx.garageBrand.deleteMany({ where: { garageId } });
  await tx.garageBrand.createMany({
    data: section.brands.map(({ brandId, fuels, stance }) => ({
      brandId: brandId.toLowerCase(),
      garageId,
      stance,
      ...fuelColumns(stance === 'works_on' ? fuels : []),
    })),
  });
  await tx.garageBrandJob.createMany({ data: rows });
  await audit.recordMany(
    tx,
    rows.map(({ brandId, jobTypeId }) => ({
      action: 'create',
      actorId,
      actorRole: 'garage',
      garageId,
      newValue: { brandId },
      subjectId: jobTypeId,
      subjectType: 'garage_brand_job',
    })),
  );
  await tx.garage.update({
    data: {
      brandNote: section.brandNote ?? null,
      refusalPhrase: section.refusalPhrase ?? null,
    },
    where: { id: garageId },
  });
}
