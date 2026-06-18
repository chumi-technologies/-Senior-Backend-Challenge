/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: {
        paths: {
          '@senior-challenge/shared-types': ['../../packages/shared-types/src/types.ts'],
        },
      },
    }],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@senior-challenge/shared-types$': '<rootDir>/../../packages/shared-types/src/types.ts',
  },
};
