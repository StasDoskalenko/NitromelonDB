module.exports = {
  verbose: true,
  bail: true,
  moduleNameMapper: {},
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],
  rootDir: __dirname,
  modulePaths: ['<rootDir>/src'],
  moduleDirectories: ['<rootDir>/node_modules'],
  restoreMocks: true,
  testMatch: ['**/__tests__/**/?(spec|test).js', '**/?(*.)(spec|test).js'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/dev', '<rootDir>/examples'],
  // End-to-end sync tests need a running server: yarn test:sync-e2e
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/sync/__tests__/e2e/'],
  // collectCoverage: true,
  // collectCoverageFrom: ['!**/node_modules/**', 'src/**'],
  // coverageDirectory: 'coverage',
  // coverageReporters: ['html', 'json'],
  cacheDirectory: '.cache/jest',
}
