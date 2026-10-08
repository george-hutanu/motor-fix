module.exports = {
  coverageDirectory: '../../coverage/libs/domain',
  displayName: 'domain',
  moduleFileExtensions: ['ts', 'js', 'html'],
  preset: '../../jest.preset.cjs',
  testEnvironment: '<rootDir>/src/auth/database-turn.environment.cjs',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
};
