import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import {
  adminLine,
  garagesChip,
  renderAdmin,
  settleAdmin,
} from './frame.admin.testing';

afterEach(() => TestBed.resetTestingModule());

// @traces 163-FR-007
describe('the admin header, a chosen city', () => {
  it('names the whole country by default, with the platform count', async () => {
    const { element } = await renderAdmin();

    expect(adminLine(element)).toBe(
      'MotorFix · Toată țara · 5 service‑uri așteaptă verificarea',
    );
  });

  it('names a chosen city with its own count, the menu keeping the platform total', async () => {
    const { element } = await renderAdmin('/app/admin?city=cluj-napoca');

    expect(adminLine(element)).toBe(
      'MotorFix · Cluj-Napoca · 1 service așteaptă verificarea',
    );
    expect(garagesChip(element)).toBe('5');
  });

  it('translates București, and only București, without reading again', async () => {
    const { asked, element, harness } = await renderAdmin(
      '/app/admin?city=bucuresti',
    );
    expect(adminLine(element)).toBe(
      'MotorFix · București · 3 service‑uri așteaptă verificarea',
    );
    const reads = asked.length;

    await TestBed.inject(I18n).use('en');
    await settleAdmin(harness);

    expect(adminLine(element)).toBe(
      'MotorFix · Bucharest · 3 garages are waiting for verification',
    );
    expect(asked).toHaveLength(reads);
  });

  it('names the whole country in English', async () => {
    const { element, harness } = await renderAdmin();
    await TestBed.inject(I18n).use('en');
    await settleAdmin(harness);

    expect(adminLine(element)).toBe(
      'MotorFix · Whole country · 5 garages are waiting for verification',
    );
  });

  it('keeps a city name as recorded in English', async () => {
    const { element, harness } = await renderAdmin(
      '/app/admin?city=cluj-napoca',
    );
    await TestBed.inject(I18n).use('en');
    await settleAdmin(harness);

    expect(adminLine(element)).toBe(
      'MotorFix · Cluj-Napoca · 1 garage is waiting for verification',
    );
  });
});
