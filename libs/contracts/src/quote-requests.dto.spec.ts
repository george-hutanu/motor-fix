import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CandidateGaragesQueryDto,
  CreateQuoteRequestDto,
  REQUEST_DESCRIPTION_MAX,
  REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS,
} from './quote-requests.dto';

const CAR = '0f1e2d3c-0000-4000-8000-000000000001';
const G1 = '0f1e2d3c-0000-4000-8000-000000000002';
const G2 = '0f1e2d3c-0000-4000-8000-000000000003';
const J1 = '0f1e2d3c-0000-4000-8000-000000000004';

const options = { forbidNonWhitelisted: true, whitelist: true };

function send(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateQuoteRequestDto, body);
  const failed = validateSync(dto, options).map((error) => error.property);
  return { dto, failed };
}

const valid = {
  carId: CAR,
  garageIds: [G1],
  jobTypeIds: [J1],
  sources: ['profile_direct'],
};

// @traces 221-FR-005
describe('CreateQuoteRequestDto', () => {
  it('takes a car, one garage with its source and one job', () => {
    expect(send(valid).failed).toEqual([]);
  });

  it('takes no job at all, the service judges the description then', () => {
    expect(send({ ...valid, jobTypeIds: [] }).failed).toEqual([]);
  });

  it('refuses a car that is not an id', () => {
    expect(send({ ...valid, carId: 'logan' }).failed).toEqual(['carId']);
  });

  it('refuses no garage and a repeated garage', () => {
    expect(send({ ...valid, garageIds: [] }).failed).toEqual(['garageIds']);
    expect(send({ ...valid, garageIds: [G1, G1] }).failed).toEqual([
      'garageIds',
    ]);
  });

  it('refuses a garage that is not an id', () => {
    expect(send({ ...valid, garageIds: ['militari'] }).failed).toEqual([
      'garageIds',
    ]);
  });

  it('refuses a source it does not know', () => {
    expect(send({ ...valid, sources: ['banner'] }).failed).toEqual(['sources']);
  });

  it('refuses a repeated job and a job that is not an id', () => {
    expect(send({ ...valid, jobTypeIds: [J1, J1] }).failed).toEqual([
      'jobTypeIds',
    ]);
    expect(send({ ...valid, jobTypeIds: ['oil'] }).failed).toEqual([
      'jobTypeIds',
    ]);
  });

  it('trims the description and keeps an empty one as none', () => {
    expect(
      send({ ...valid, description: '  Scârțâie  ' }).dto.description,
    ).toBe('Scârțâie');
    expect(send({ ...valid, description: '   ' }).dto.description).toBeNull();
  });

  it(`takes ${REQUEST_DESCRIPTION_MAX} characters and refuses one more`, () => {
    const at = 'a'.repeat(REQUEST_DESCRIPTION_MAX);
    expect(send({ ...valid, description: at }).failed).toEqual([]);
    expect(send({ ...valid, description: `${at}a` }).failed).toEqual([
      'description',
    ]);
  });

  it('asks a request without jobs for 10 characters', () => {
    expect(REQUEST_DESCRIPTION_MIN_WITHOUT_JOBS).toBe(10);
  });

  it('refuses a field it does not know', () => {
    expect(send({ ...valid, phone: '+40722000000' }).failed).toEqual(['phone']);
  });

  it('accepts a second garage from the picker', () => {
    expect(
      send({
        ...valid,
        garageIds: [G1, G2],
        sources: ['profile_direct', 'search'],
      }).failed,
    ).toEqual([]);
  });
});

function query(params: Record<string, unknown>) {
  const dto = plainToInstance(CandidateGaragesQueryDto, params);
  const failed = validateSync(dto, options).map((error) => error.property);
  return { dto, failed };
}

// @traces 221-FR-006
describe('CandidateGaragesQueryDto', () => {
  it('takes a car alone', () => {
    expect(query({ carId: CAR }).failed).toEqual([]);
  });

  it('needs a car', () => {
    expect(query({}).failed).toEqual(['carId']);
  });

  it('reads comma-separated jobs as a list', () => {
    const { dto, failed } = query({ carId: CAR, jobTypeIds: `${J1},${G2}` });
    expect(failed).toEqual([]);
    expect(dto.jobTypeIds).toEqual([J1, G2]);
  });

  it('refuses a job that is not an id and a repeated job', () => {
    expect(query({ carId: CAR, jobTypeIds: 'oil' }).failed).toEqual([
      'jobTypeIds',
    ]);
    expect(query({ carId: CAR, jobTypeIds: `${J1},${J1}` }).failed).toEqual([
      'jobTypeIds',
    ]);
  });

  it('takes a place in Romania and refuses one outside it', () => {
    expect(query({ carId: CAR, near: '44.427,26.103' }).failed).toEqual([]);
    expect(query({ carId: CAR, near: '48.857,2.352' }).failed).toEqual([
      'near',
    ]);
  });

  it('refuses a left-out garage that is not an id', () => {
    expect(query({ carId: CAR, exclude: G1 }).failed).toEqual([]);
    expect(query({ carId: CAR, exclude: 'militari' }).failed).toEqual([
      'exclude',
    ]);
  });
});
