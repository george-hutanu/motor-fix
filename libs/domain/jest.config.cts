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
  // A worker that runs many Nest apps one after another grows past the heap
  // limit in a small heavy-slot run; past 1 GB it is restarted between files.
  workerIdleMemoryLimit: '1GB',
};
