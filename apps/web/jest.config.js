/**
 * Jest config for the web app's unit tests (node environment).
 *
 * Test files are excluded from tsconfig.json so `next build`'s type-check
 * never sees them; ts-jest compiles them here with its own inline tsconfig.
 * Run with: npm test -w apps/web
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          target: 'es2020',
          esModuleInterop: true,
          isolatedModules: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
