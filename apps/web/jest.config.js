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
    // Workspaces del monorepo al SOURCE del árbol actual (no node_modules):
    // así los tests de contrato validan el código de ESTE checkout/worktree,
    // y ts-jest compila los .ts de packages/ sin build previo.
    '^@eco/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@eco/shared/src/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@eco/database$': '<rootDir>/../../packages/database/src/index.ts',
    '^@eco/database/src/(.*)$': '<rootDir>/../../packages/database/src/$1',
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
