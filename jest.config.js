module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/.factory'],
  testMatch: ['**/__tests__/**/*.test.ts'],
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
    '!.factory/test.ts',
    '!.factory/github-integration.ts',
    '!.factory/claude-bridge.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 60,
      statements: 60
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
