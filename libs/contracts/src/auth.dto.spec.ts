import { plainToInstance } from 'class-transformer';

import { SignUpDto } from './auth.dto';

describe('SignUpDto', () => {
  it('trims the name and the email', () => {
    const dto = plainToInstance(SignUpDto, {
      email: '  ana@example.ro \n',
      name: '\t Ana Pop  ',
      password: 'x',
    });

    expect(dto.name).toBe('Ana Pop');
    expect(dto.email).toBe('ana@example.ro');
  });

  it('leaves a value that is not text as it came', () => {
    const dto = plainToInstance(SignUpDto, { email: 42, name: null });

    expect(dto.email).toBe(42);
    expect(dto.name).toBeNull();
  });
});
