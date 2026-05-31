import config from './packages/config-eslint/base.js';

export default [
  ...config,
  {
    // Expo config plugins (apps/*/plugins/*.js) are loaded by prebuild
    // via require(), so they must be CommonJS. The TS preset's
    // no-require-imports doesn't apply, and they need Node globals
    // (require, module, etc.) to satisfy no-undef.
    files: ['apps/*/plugins/**/*.js'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
