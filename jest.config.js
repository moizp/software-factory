module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/.factory'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/.factory/__tests__/setup-env.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@octokit/rest$': '<rootDir>/.factory/__tests__/mocks/octokit.js'
  },
  collectCoverageFrom: [
    '.factory/**/*.ts',
    '!.factory/**/*.test.ts',
    '!.factory/**/*.js',
    '!.factory/__tests__/**',
    '!.factory/cli.ts',
    '!.factory/policy-cli.ts',
    '!.factory/test.ts',
    '!.factory/github-integration.ts',
    '!.factory/claude-bridge.ts',
    '!.factory/review/cli.ts',
    '!.factory/route/cli.ts',
    '!.factory/route/github.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 60,
      lines: 55,
      statements: 55
    }
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '.factory/test.ts'],
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }
  }
};
