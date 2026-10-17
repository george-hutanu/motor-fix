import { COMPANY_REGISTER, ManualCompanyRegister } from './company-register';
import { GaragesModule } from '../../garages.module';

// @traces 203-FR-005

describe('the company register at launch', () => {
  it('answers not run, with no detail and no evidence, for any CUI', async () => {
    const register = new ManualCompanyRegister();
    await expect(register.lookUp('18547290')).resolves.toEqual({
      result: 'not_run',
    });
    await expect(register.lookUp('')).resolves.toEqual({ result: 'not_run' });
  });

  it('reaches no outside service', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    await new ManualCompanyRegister().lookUp('18547290');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('is the register the garages module provides', () => {
    const { providers } = GaragesModule.register(
      {} as never,
      { module: class {} },
      {} as never,
    );
    expect(providers).toContainEqual({
      provide: COMPANY_REGISTER,
      useClass: ManualCompanyRegister,
    });
  });
});
