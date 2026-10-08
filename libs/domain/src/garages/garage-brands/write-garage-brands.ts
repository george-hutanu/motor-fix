import { fuelColumns, isBrandsSection } from '@motor-fix/contracts';
import { HttpStatus } from '@nestjs/common';

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

// Writes a garage's brands, their fuels and the two texts from the listing's
// step 2 section, inside the caller's transaction. The caller records the
// event; this writes rows only.
export async function writeGarageBrands(
  tx: Prisma.TransactionClient,
  garageId: string,
  section: unknown,
): Promise<void> {
  if (!isBrandsSection(section) || section.brands === undefined) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The brands, their fuels or the texts break a rule',
    );
  }
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
  await tx.garage.update({
    data: {
      brandNote: section.brandNote ?? null,
      refusalPhrase: section.refusalPhrase ?? null,
    },
    where: { id: garageId },
  });
}
