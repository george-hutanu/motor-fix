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
  // JEST_IDLE_MEMORY (set by lifecycle.mjs check) overrides it.
  workerIdleMemoryLimit: process.env['JEST_IDLE_MEMORY'] || '1536MB',
};
