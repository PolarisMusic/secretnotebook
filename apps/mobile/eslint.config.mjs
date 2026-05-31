import config from '@secretnotebook/config-eslint/react-native';

export default [
  ...config,
  {
    // Config plugins are loaded by expo's prebuild via require(), so
    // they must be CommonJS. The `no-require-imports` rule from the
    // shared TS preset doesn't apply here.
    files: ['plugins/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
