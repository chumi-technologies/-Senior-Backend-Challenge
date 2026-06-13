module.exports = {
    testEnvironment: 'node',
    rootDir: '.',
    testMatch: ['**/test/**/*.spec.ts'],
    testPathIgnorePatterns: ['/node_modules/', '\\.int\\.spec\\.ts$'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
    },
    moduleNameMapper: {
        '^@senior-challenge/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    },
};
