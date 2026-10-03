module.exports = {
  displayName: 'scripts',
  preset: '../jest.preset.cjs',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
};
