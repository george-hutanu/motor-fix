module.exports = {
  coverageDirectory: '../../coverage/apps/api',
  displayName: 'api',
  moduleFileExtensions: ['ts', 'js', 'html'],
  preset: '../../jest.preset.cjs',
  // Gives a spec file's database turn back once all its afterAll hooks ran.
  testEnvironment: '<rootDir>/database-turn.environment.cjs',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
};
