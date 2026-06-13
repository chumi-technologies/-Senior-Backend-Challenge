module.exports = {
    testEnvironment: 'node',
    rootDir: '.',
    testMatch: ['**/test/**/*.spec.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }],
    },
};
