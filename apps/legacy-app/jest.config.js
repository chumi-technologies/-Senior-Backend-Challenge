/**
 * Jest configuration for legacy-app.
 *
 * Added as a dev-only change: the package declared `"test": "jest"` but jest
 * and its TypeScript transformer were never installed, so the baseline test
 * command failed with `jest: command not found`. ts-jest runs in
 * isolatedModules mode so the suite does not require the shared-types package
 * to be pre-built; the workspace type package is mapped to its source.
 */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/test'],
    testMatch: ['**/*.spec.ts'],
    moduleNameMapper: {
        '^@senior-challenge/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    },
    transform: {
        '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
    },
};
