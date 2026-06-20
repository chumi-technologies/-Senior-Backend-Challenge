/**
 * Jest config for the legacy-app characterization tests.
 *
 * Kept minimal: ts-jest transform, node environment, and a module-name mapping so the
 * workspace package `@senior-challenge/shared-types` resolves to source without a build.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  setupFiles: ['reflect-metadata'],
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  moduleNameMapper: {
    '^@senior-challenge/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
};
