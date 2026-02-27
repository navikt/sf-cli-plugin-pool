module.exports = {
  extends: ['eslint-config-salesforce-typescript', 'plugin:sf-plugin/recommended'],
  root: true,
  ignorePatterns: ['**/*.d.ts', 'lib/**', 'node_modules/**'],
  rules: {
    header: 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
  },
  overrides: [
    {
      files: ['**/test/**/*.ts', '**/test/**/*.nut.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/prefer-nullish-coalescing': 'off',
      },
    },
  ],
};