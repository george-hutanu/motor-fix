module.exports = {
  coverageDirectory: '../../coverage/libs/domain',
  displayName: 'domain',
  moduleFileExtensions: ['ts', 'js', 'html'],
  preset: '../../jest.preset.cjs',
  setupFilesAfterEnv: ['<rootDir>/src/integration-timeout.testing.ts'],
  testEnvironment: '<rootDir>/src/auth/database-turn.environment.cjs',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  // ts-jest grows a worker's heap suite by suite; recycle it before it runs out.
  workerIdleMemoryLimit: '1536MB',
};
