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
    'src/features/api/cache.ts',
    'src/features/api/client.ts',
    'src/features/api/device-key.ts',
    'src/features/api/signing.ts',
    'src/features/connection-channel/build-engine.ts',
    'src/features/connection-channel/outbox.ts',
    'src/features/connection-channel/projector.ts',
    'src/features/connection-channel/ratchet-store.ts',
    'src/features/connection-channel/saved-post-store.ts',
    'src/features/connection-channel/seen.ts',
    'src/features/connection-channel/sync-engine.ts',
    'src/features/connection-channel/ticker.ts',
    'src/features/connection-channel/uuid.ts',
    'src/features/ledger/store.ts',
    'src/features/notes/store.ts',
    'src/features/pairing/state-machine.ts',
    'src/features/pairing/orchestrator.ts',
    'src/features/pairing/persistence.ts',
    'src/features/safeword/verifier.ts',
    'src/features/safeword/session.ts',
    'src/features/safeword/lockout.ts',
    'src/features/safeword/background-lock-policy.ts',
    'src/features/boot/bootstrap.ts',
    'src/features/boot/connection-load.ts',
    'src/security/device-master.ts',
    'src/security/sqlcipher-key.ts',
    'src/state/**/*.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  testTimeout: 15000,
  // better-sqlite3 is a native module and flakes when multiple Jest worker
  // processes hammer it concurrently (the "rolls back a failed migration"
  // assertion was the canary). Serialise tests in this package only — the
  // mobile suite is small enough that this costs ~1 s in total.
  maxWorkers: 1,
};
