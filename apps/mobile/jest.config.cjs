/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  // The migration runner and security helpers are testable in Node; native
  // modules (op-sqlite, keychain, ble, libsodium) are excluded because they
  // only have meaningful behaviour on device and are covered by Detox.
  collectCoverageFrom: [
    'src/db/migrate.ts',
    'src/db/executor.ts',
    'src/db/migrations/**/*.ts',
    'src/features/pairing/state-machine.ts',
    'src/features/pairing/orchestrator.ts',
    'src/features/pairing/persistence.ts',
    'src/security/device-master.ts',
    'src/security/sqlcipher-key.ts',
    'src/state/**/*.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  testTimeout: 15000,
};
