module.exports = {
  extends: ['eslint-config-salesforce-typescript', 'plugin:sf-plugin/recommended'],
  root: true,
  ignorePatterns: ['**/*.d.ts', 'lib/**', 'node_modules/**'],
  rules: {
    header: 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    // Override upstream rule to allow relative imports from src/lib/ (shared logic).
    // The upstream pattern **/../lib/** incorrectly blocks src/lib/ alongside the lib/ build artifact.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['src/**'], message: "imports from this repo's src folder should be a relative path" },
          { group: ['lib/**'], message: 'import from /src not from /lib. /lib is a build artifact' },
        ],
      },
    ],
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