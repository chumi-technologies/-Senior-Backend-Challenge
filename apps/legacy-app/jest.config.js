/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.spec.ts"],
  moduleNameMapper: { "^@senior-challenge/shared-types$": "<rootDir>/../../packages/shared-types/src" },
  moduleFileExtensions: ["ts", "js", "json"],
};
