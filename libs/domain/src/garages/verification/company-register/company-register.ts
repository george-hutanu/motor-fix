import type {
  VerificationCheckEvidenceDto,
  VerificationCheckResult,
} from '@motor-fix/contracts';
import { Injectable } from '@nestjs/common';

interface CompanyLookup {
  result: VerificationCheckResult;
  detail?: string;
  evidence?: VerificationCheckEvidenceDto;
}

// Where an automatic look-up of a company in the registers will plug in. Its
// own story adds the adapter and the call site; nothing calls it at launch.
interface CompanyRegister {
  lookUp(cui: string): Promise<CompanyLookup>;
}

export const COMPANY_REGISTER: unique symbol = Symbol('COMPANY_REGISTER');

// The launch register: the admin looks the company up by hand.
@Injectable()
export class ManualCompanyRegister implements CompanyRegister {
  async lookUp(_cui: string): Promise<CompanyLookup> {
    return { result: 'not_run' };
  }
}
